// Popup de CredFlow (docs/specs/popup-alertas.md, sección 5).
// Todo el texto se inserta con textContent: nunca innerHTML.
import type { GetTabEvents, TabEventsResponse } from "../shared/types";
import { rowFor } from "./format";

const GENERIC_ERROR = "No se pudo cargar la información";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error("popup");
  return node;
}

/**
 * Pestaña a mostrar: la activa de la ventana. Las pruebas E2E abren el popup como página y pasan
 * la pestaña en el fragmento (#tabId=N); el valor se valida como entero no negativo.
 */
async function targetTabId(): Promise<number | null> {
  const match = /^#tabId=(\d{1,9})$/.exec(location.hash);
  if (match?.[1]) return Number(match[1]);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.id === "number" && tab.id >= 0 ? tab.id : null;
}

function isResponse(value: unknown): value is TabEventsResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as TabEventsResponse).events)
  );
}

async function render(): Promise<void> {
  const status = byId("status");
  const list = byId("events");
  try {
    const tabId = await targetTabId();
    if (tabId === null) {
      status.textContent = GENERIC_ERROR;
      return;
    }
    const request: GetTabEvents = { kind: "GET_TAB_EVENTS", tabId };
    const response: unknown = await chrome.runtime.sendMessage(request);
    if (!isResponse(response)) {
      status.textContent = GENERIC_ERROR;
      return;
    }
    const [latest] = response.events;
    byId("site").textContent = latest ? `Sitio: ${latest.pageSite}` : "";
    if (response.events.length === 0) {
      status.textContent = "Sin flujos sensibles en esta pestaña";
      return;
    }
    for (const event of response.events) {
      const row = rowFor(event);
      const item = element("li", `event ${row.severity}`, "");
      item.append(
        element("span", "severity", row.severityLabel),
        element("div", "verdict", row.verdict),
        element("div", "meta", `${row.field} → ${row.destination}`),
        element("div", "meta", row.time)
      );
      list.append(item);
    }
  } catch {
    status.textContent = GENERIC_ERROR;
  }
}

void render();
