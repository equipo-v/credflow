// Persistencia de los eventos por pestaña en chrome.storage.session (docs/specs/popup-alertas.md, sección 2).
// storage.session vive en la memoria del navegador: sobrevive a los reinicios del Service Worker, no se escribe en
// disco y se borra al cerrar Chrome. Solo se guardan FlowEvent, que no contienen datos sensibles.
import type { FlowEvent } from "../shared/types";
import { parseStoredTabState, TabEventLog, type AlertSummary } from "./tab-events";

const log = new TabEventLog();
const loaded = new Set<number>();
let queue: Promise<unknown> = Promise.resolve();

const keyOf = (tabId: number): string => `tab:${tabId}`;

/** Ejecuta las operaciones en orden, para que dos eventos seguidos no se pisen al leer y escribir. */
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}

async function ensureLoaded(tabId: number): Promise<void> {
  if (loaded.has(tabId)) return;
  const key = keyOf(tabId);
  try {
    const stored: unknown = (await chrome.storage.session.get(key))[key];
    const state = parseStoredTabState(stored, tabId);
    if (state && !log.has(tabId)) log.restore(tabId, state);
  } catch {
    // Si no se puede leer, se sigue solo con lo que hay en memoria.
  }
  loaded.add(tabId);
}

async function save(tabId: number): Promise<void> {
  const snapshot = log.snapshot(tabId);
  if (!snapshot) return;
  try {
    await chrome.storage.session.set({ [keyOf(tabId)]: snapshot });
  } catch {
    // Sin persistencia, los eventos siguen en memoria hasta el próximo reinicio del Service Worker.
  }
}

/** Guarda el evento y devuelve el resumen de alertas actualizado de su pestaña. */
export function recordEvent(event: FlowEvent): Promise<AlertSummary> {
  return serialized(async () => {
    await ensureLoaded(event.tabId);
    const summary = log.add(event);
    await save(event.tabId);
    return summary;
  });
}

export function eventsOf(tabId: number): Promise<FlowEvent[]> {
  return serialized(async () => {
    await ensureLoaded(tabId);
    return log.list(tabId);
  });
}

export function summaryOf(tabId: number): Promise<AlertSummary> {
  return serialized(async () => {
    await ensureLoaded(tabId);
    return log.summary(tabId);
  });
}

export function forgetTab(tabId: number): Promise<void> {
  return serialized(async () => {
    log.clear(tabId);
    loaded.delete(tabId);
    try {
      await chrome.storage.session.remove(keyOf(tabId));
    } catch {
      // Se borrará al cerrar Chrome.
    }
  });
}
