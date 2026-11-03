// Service Worker de CredFlow: conecta el Motor de análisis con las APIs de Chrome.
// La lógica está en módulos puros (analyze, fingerprint-store, request-body) que se prueban sin navegador.
import { parseRegisterFingerprints, trustedSenderTabId } from "../shared/validators";
import { analyzeRequest } from "./analyze";
import { FingerprintStore } from "./fingerprint-store";
import { publishFlowEvent } from "./flow-events";
import { parseManagedConfig, type ManagedConfig } from "./managed-config";
import { siteOfUrl } from "./site";

const store = new FingerprintStore();
const lastPageSite = new Map<number, string>();
let config: ManagedConfig = parseManagedConfig(undefined);

async function loadManagedConfig(): Promise<void> {
  try {
    config = parseManagedConfig(await chrome.storage.managed.get("authorizedProviders"));
  } catch {
    // Sin política configurada: lista vacía.
    config = parseManagedConfig(undefined);
  }
}

void loadManagedConfig();

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "managed") void loadManagedConfig();
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  try {
    const tabId = trustedSenderTabId(sender, chrome.runtime.id);
    if (tabId === null) return;
    const parsed = parseRegisterFingerprints(message);
    if (parsed === null) return;
    store.register(tabId, parsed, Date.now());
  } catch {
    // Mensaje descartado sin error visible para la página (sección 4.1).
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
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  store.clearTab(tabId);
  lastPageSite.delete(tabId);
});
