// Service Worker de CredFlow: conecta el Motor de análisis con las APIs de Chrome.
// La lógica está en módulos puros (analyze, fingerprint-store, request-body) que se prueban sin navegador.
import type { TabEventsResponse } from "../shared/types";
import {
  isExtensionPageSender,
  parseGetTabEvents,
  parseRegisterFingerprints,
  trustedSenderTabId,
} from "../shared/validators";
import { analyzeRequest } from "./analyze";
import { FingerprintStore } from "./fingerprint-store";
import { ErrorMonitor } from "./error-monitor";
import { publishDiagnostic, publishFlowEvent, subscribeToFlowEvents } from "./flow-events";
import { parseManagedConfig, type ManagedConfig } from "./managed-config";
import { siteOfUrl } from "./site";
import { badgeFor, TabEventLog } from "./tab-events";

const store = new FingerprintStore();
const lastPageSite = new Map<number, string>();
const errors = new ErrorMonitor();
const tabEvents = new TabEventLog();
let config: ManagedConfig = parseManagedConfig(undefined);

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
}

void loadManagedConfig();

// Eventos por pestaña y alerta en el ícono (docs/specs/popup-alertas.md, secciones 2 y 3).
subscribeToFlowEvents((event) => {
  const badge = badgeFor(tabEvents.add(event));
  if (!badge) return;
  void chrome.action.setBadgeText({ tabId: event.tabId, text: badge.text }).catch(() => undefined);
  void chrome.action
    .setBadgeBackgroundColor({ tabId: event.tabId, color: badge.color })
    .catch(() => undefined);
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "managed") void loadManagedConfig();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  try {
    // Petición del popup: solo se responde a páginas de la propia extensión (popup-alertas.md, sección 4).
    const request = parseGetTabEvents(message);
    if (request !== null) {
      if (!isExtensionPageSender(sender, chrome.runtime.id)) return;
      const response: TabEventsResponse = { events: tabEvents.list(request.tabId) };
      sendResponse(response);
      return;
    }
    const tabId = trustedSenderTabId(sender, chrome.runtime.id);
    if (tabId === null) return;
    const parsed = parseRegisterFingerprints(message);
    if (parsed === null) return;
    store.register(tabId, parsed, Date.now());
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
          authorizedSites: config.authorizedSites,
          lastKnownPageSite: lastPageSite.get(details.tabId) ?? null,
          now: new Date(now),
          newId: () => crypto.randomUUID(),
        }
      );
      if (event) publishFlowEvent(event);
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
  lastPageSite.delete(tabId);
  tabEvents.clear(tabId);
});
