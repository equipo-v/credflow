// Service Worker de CredFlow: conecta el Motor de análisis con las APIs de Chrome.
// La lógica está en módulos puros (analyze, fingerprint-store, request-body) que se prueban sin navegador.
import type { PageReport, TabEventsResponse } from "../shared/types";
import {
  isExtensionPageSender,
  parseGetTabEvents,
  parsePageReport,
  parseRegisterFingerprints,
  trustedSenderTabId,
} from "../shared/validators";
import { analyzePageReport, analyzeRequest } from "./analyze";
import { AttributionLog, REPORT_TTL_MS } from "./page-reports";
import { FingerprintStore } from "./fingerprint-store";
import { ErrorMonitor } from "./error-monitor";
import { publishDiagnostic, publishFlowEvent, subscribeToFlowEvents } from "./flow-events";
import { parseManagedConfig, parseTrustedSites, type ManagedConfig } from "./managed-config";
import { siteOfUrl } from "./site";
import { badgeFor, type AlertSummary } from "./tab-events";
import {
  forgetTab,
  recordEvent,
  recordWatched,
  setEventScript,
  summaryOf,
  tabInfoOf,
} from "./tab-store";

const store = new FingerprintStore();
const lastPageSite = new Map<number, string>();
const errors = new ErrorMonitor();
const attribution = new AttributionLog();
let config: ManagedConfig = parseManagedConfig(undefined);
let trustedSites: ReadonlySet<string> = new Set();
/** Proveedores autorizados por el administrador más destinos de confianza del usuario (sección 3.4). */
let authorizedSites: ReadonlySet<string> = new Set();

function refreshAuthorizedSites(): void {
  authorizedSites = new Set([...config.authorizedSites, ...trustedSites]);
}

async function loadTrustedSites(): Promise<void> {
  try {
    trustedSites = parseTrustedSites((await chrome.storage.local.get("trustedSites")).trustedSites);
  } catch {
    trustedSites = new Set();
  }
  refreshAuthorizedSites();
}

/** Registra un error sin ningún dato de lo que falló y avisa si se repiten (sección 4.6). */
function recordError(): void {
  try {
    const diagnostic = errors.record(Date.now());
    if (diagnostic) publishDiagnostic(diagnostic);
  } catch {
    // El registro de errores nunca debe provocar otro error.
  }
}

async function loadManagedConfig(): Promise<void> {
  try {
    config = parseManagedConfig(await chrome.storage.managed.get("authorizedProviders"));
  } catch {
    // Sin política configurada: lista vacía.
    config = parseManagedConfig(undefined);
  }
  refreshAuthorizedSites();
}

void loadManagedConfig();
void loadTrustedSites();

// Eventos por pestaña y alerta en el ícono (docs/specs/popup-alertas.md, secciones 2 y 3).
function applyBadge(tabId: number, summary: AlertSummary): void {
  const badge = badgeFor(summary);
  if (!badge) return;
  void chrome.action.setBadgeText({ tabId, text: badge.text }).catch(() => undefined);
  void chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => undefined);
}

subscribeToFlowEvents((event) => {
  recordEvent(event).then(
    (summary) => applyBadge(event.tabId, summary),
    () => recordError()
  );
});

// Chrome borra el texto del ícono cuando la pestaña navega: se vuelve a aplicar al terminar de cargar (sección 3).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  summaryOf(tabId).then(
    (summary) => applyBadge(tabId, summary),
    () => undefined
  );
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "managed") void loadManagedConfig();
  if (areaName === "local") void loadTrustedSites();
});

/** Reporte del interceptor de página (motor-analisis.md, secciones 4.8 y 4.9). */
function handlePageReport(tabId: number, report: PageReport, senderSite: string | null): void {
  const now = Date.now();
  for (const eventId of attribution.addReport(tabId, report.url, report.script, now)) {
    if (report.script) void setEventScript(tabId, eventId, report.script).catch(() => undefined);
  }
  // Los reportes caducan aunque no lleguen más mensajes (la URL puede contener el dato sensible).
  setTimeout(() => attribution.prune(Date.now()), REPORT_TTL_MS + 500);
  const event = analyzePageReport(tabId, report, {
    fingerprints: store.active(tabId, now),
    authorizedSites,
    pageSite: senderSite ?? lastPageSite.get(tabId) ?? null,
    now: new Date(now),
    newId: () => crypto.randomUUID(),
  });
  if (event) publishFlowEvent(event);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  try {
    // Petición del popup: solo se responde a páginas de la propia extensión (popup-alertas.md, sección 4).
    const request = parseGetTabEvents(message);
    if (request !== null) {
      if (!isExtensionPageSender(sender, chrome.runtime.id)) return;
      // Respuesta asíncrona: los eventos pueden tener que leerse de chrome.storage.session.
      tabInfoOf(request.tabId).then(
        (response) => sendResponse(response),
        () => sendResponse({ events: [], watched: [] } satisfies TabEventsResponse)
      );
      return true;
    }
    const tabId = trustedSenderTabId(sender, chrome.runtime.id);
    if (tabId === null) return;
    const pageReport = parsePageReport(message);
    if (pageReport !== null) {
      handlePageReport(tabId, pageReport, siteOfUrl(sender.url));
      return;
    }
    const parsed = parseRegisterFingerprints(message);
    if (parsed === null) return;
    store.register(tabId, parsed, Date.now());
    // Campo vigilado para el popup (popup-alertas.md, sección 5). sender.url lo pone Chrome, no la página.
    void recordWatched(tabId, parsed.fieldType, siteOfUrl(sender.url) ?? "sitio desconocido").catch(
      () => undefined
    );
  } catch {
    // Mensaje descartado sin error visible para la página (sección 4.1).
    recordError();
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      if (details.tabId < 0) return;
      const now = Date.now();
      const fingerprints = store.active(details.tabId, now);
      const event = analyzeRequest(
        {
          tabId: details.tabId,
          url: details.url,
          method: details.method,
          type: details.type,
          initiator: details.initiator,
          requestBody: details.requestBody ?? undefined,
        },
        {
          fingerprints,
          authorizedSites,
          lastKnownPageSite: lastPageSite.get(details.tabId) ?? null,
          now: new Date(now),
          newId: () => crypto.randomUUID(),
          scriptFor: (url) => attribution.scriptFor(details.tabId, url, now),
        }
      );
      if (event) {
        // Si el reporte de la página llega después de la petición, el script se completa entonces (sección 4.8).
        if (event.script === null)
          attribution.awaitReport(details.tabId, details.url, event.id, now);
        publishFlowEvent(event);
      }
      if (details.type === "main_frame") {
        const site = siteOfUrl(details.url);
        if (site) lastPageSite.set(details.tabId, site);
      }
    } catch {
      // Un error al analizar una petición no detiene el análisis de las siguientes (AGENTS.md, regla 8).
      recordError();
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  store.clearTab(tabId);
  attribution.clearTab(tabId);
  lastPageSite.delete(tabId);
  void forgetTab(tabId);
});
