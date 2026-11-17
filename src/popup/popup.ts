// Popup de CredFlow (docs/specs/popup-alertas.md, sección 5).
// Todo el texto se inserta con textContent: nunca innerHTML.
import type { GetTabEvents, TabEventsResponse } from "../shared/types";
import { canTrust, evidenceLabel, rowFor, scriptLabel, watchedRowFor } from "./format";
import { readTrusted, trustSite, untrustSite } from "./trust";

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
  const match = /^#tabId=(\d{1,16})$/.exec(location.hash);
  if (match?.[1]) {
    const tabId = Number(match[1]);
    return Number.isSafeInteger(tabId) ? tabId : null;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.id === "number" && tab.id >= 0 ? tab.id : null;
}

function isResponse(value: unknown): value is TabEventsResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as TabEventsResponse).events) &&
    Array.isArray((value as TabEventsResponse).watched)
  );
}

/** Botón "Confiar en <sitio>" con confirmación en dos clics (sección 5.2). */
function trustButton(site: string): HTMLElement {
  const box = element("div", "actions", "");
  const button = element("button", "", `Confiar en ${site}`);
  button.type = "button";
  let armed = false;
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.textContent = "¿Confirmar?";
      return;
    }
    button.disabled = true;
    trustSite(site).then(
      () => {
        button.textContent = `${site} es de confianza ✓`;
        void renderTrusted();
      },
      () => {
        button.textContent = GENERIC_ERROR;
      }
    );
  });
  box.append(button);
  return box;
}

/** Lista de destinos de confianza con su botón "Quitar". */
async function renderTrusted(): Promise<void> {
  const list = byId("trusted-list");
  const empty = byId("trusted-empty");
  try {
    const sites = await readTrusted();
    list.replaceChildren(
      ...sites.map((site) => {
        const item = element("li", "", "");
        const remove = element("button", "", "Quitar");
        remove.type = "button";
        remove.addEventListener("click", () => {
          remove.disabled = true;
          void untrustSite(site).then(renderTrusted, () => undefined);
        });
        item.append(element("span", "", site), remove);
        return item;
      })
    );
    empty.hidden = sites.length > 0;
  } catch {
    empty.textContent = GENERIC_ERROR;
  }
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
    const site = latest?.pageSite ?? response.watched.at(-1)?.site;
    byId("site").textContent = site ? `Sitio: ${site}` : "";
    if (response.events.length === 0 && response.watched.length === 0) {
      status.textContent = "Sin flujos sensibles en esta pestaña";
      return;
    }
    // Primero los campos vigilados (azul), luego los flujos detectados.
    for (const watched of response.watched) {
      const row = watchedRowFor(watched);
      const item = element("li", "event info watched", "");
      item.append(
        element("span", "severity", "ℹ vigilando"),
        element("div", "verdict", row.title),
        element("div", "meta", `${row.note} · ${row.site}`),
        element("div", "meta", row.time)
      );
      list.append(item);
    }
    for (const event of response.events) {
      const row = rowFor(event);
      const item = element("li", `event ${row.severity}`, "");
      item.append(
        element("span", "severity", row.severityLabel),
        element("div", "verdict", row.verdict)
      );
      if (row.note) item.append(element("div", "meta", row.note));
      item.append(element("div", "meta", `${row.field} → ${row.destination}`));
      const script = scriptLabel(event.script);
      if (script) item.append(element("div", "meta", script));
      const evidence = evidenceLabel(event);
      if (evidence) item.append(element("div", "meta", evidence));
      item.append(element("div", "meta", row.time));
      if (canTrust(event)) item.append(trustButton(event.destinationSite));
      list.append(item);
    }
  } catch {
    status.textContent = GENERIC_ERROR;
  }
}

void render();
void renderTrusted();
