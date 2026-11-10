// Eventos de flujo por pestaña (docs/specs/popup-alertas.md, secciones 2 y 3). Lógica pura: la persistencia en
// chrome.storage.session está en tab-store.ts. Solo guarda FlowEvent, que no contiene valores, huellas, rutas ni consultas.
import { ENCODINGS, FIELD_TYPES } from "../shared/constants";
import type { FlowEvent } from "../shared/types";

export const MAX_EVENTS_PER_TAB = 50;

/** Alertas acumuladas de una pestaña: no se pierden al descartar eventos antiguos de la lista. */
export type AlertSummary = { alerts: number; critical: boolean };

export type TabState = { events: FlowEvent[]; summary: AlertSummary };

export class TabEventLog {
  private readonly byTab = new Map<number, TabState>();

  /** Agrega el evento y devuelve el resumen de alertas actualizado de su pestaña. */
  add(event: FlowEvent): AlertSummary {
    let state = this.byTab.get(event.tabId);
    if (!state) {
      state = { events: [], summary: { alerts: 0, critical: false } };
      this.byTab.set(event.tabId, state);
    }
    state.events.push(event);
    if (state.events.length > MAX_EVENTS_PER_TAB) state.events.shift();
    if (event.severity !== "none") {
      state.summary = {
        alerts: state.summary.alerts + 1,
        critical: state.summary.critical || event.severity === "critical",
      };
    }
    return state.summary;
  }

  /** Eventos de la pestaña, del más reciente al más antiguo. */
  list(tabId: number): FlowEvent[] {
    return [...(this.byTab.get(tabId)?.events ?? [])].reverse();
  }

  clear(tabId: number): void {
    this.byTab.delete(tabId);
  }

  has(tabId: number): boolean {
    return this.byTab.has(tabId);
  }

  summary(tabId: number): AlertSummary {
    return this.byTab.get(tabId)?.summary ?? { alerts: 0, critical: false };
  }

  /** Copia del estado de la pestaña, para guardarla en chrome.storage.session. */
  snapshot(tabId: number): TabState | null {
    const state = this.byTab.get(tabId);
    return state ? { events: [...state.events], summary: { ...state.summary } } : null;
  }

  /** Restaura el estado guardado de una pestaña (tras un reinicio del Service Worker). */
  restore(tabId: number, state: TabState): void {
    this.byTab.set(tabId, {
      events: state.events.slice(-MAX_EVENTS_PER_TAB),
      summary: { ...state.summary },
    });
  }
}

const VERDICTS = new Set([
  "insecure_channel",
  "third_party",
  "opaque_body",
  "credential_in_url",
  "authorized_provider",
  "same_site",
]);
const SEVERITIES = new Set(["critical", "high", "none"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFlowEvent(value: unknown, tabId: number): value is FlowEvent {
  if (!isRecord(value)) return false;
  const strings = [
    "id",
    "timestamp",
    "pageSite",
    "destinationOrigin",
    "destinationSite",
    "method",
    "requestType",
  ];
  return (
    strings.every((key) => typeof value[key] === "string") &&
    value.tabId === tabId &&
    (FIELD_TYPES as readonly unknown[]).includes(value.fieldType) &&
    (value.encoding === null || (ENCODINGS as readonly unknown[]).includes(value.encoding)) &&
    (value.location === "body" || value.location === "url") &&
    typeof value.truncated === "boolean" &&
    VERDICTS.has(value.verdict as string) &&
    SEVERITIES.has(value.severity as string)
  );
}

/**
 * Valida el estado leído de chrome.storage.session (sección 2). Devuelve null si la forma no es la esperada;
 * los eventos individuales con forma incorrecta se descartan.
 */
export function parseStoredTabState(raw: unknown, tabId: number): TabState | null {
  if (!isRecord(raw) || !Array.isArray(raw.events) || !isRecord(raw.summary)) return null;
  const { alerts, critical } = raw.summary;
  if (typeof alerts !== "number" || !Number.isInteger(alerts) || alerts < 0) return null;
  if (typeof critical !== "boolean") return null;
  const events = raw.events.filter((event): event is FlowEvent => isFlowEvent(event, tabId));
  return { events: events.slice(-MAX_EVENTS_PER_TAB), summary: { alerts, critical } };
}

export type Badge = { text: string; color: string };

const RED = "#D93025";
const AMBER = "#E37400";

/** Texto y color del ícono de una pestaña, o null si no tiene alertas (sección 3). */
export function badgeFor(summary: AlertSummary): Badge | null {
  if (summary.alerts === 0) return null;
  return {
    text: summary.alerts >= 100 ? "99+" : String(summary.alerts),
    color: summary.critical ? RED : AMBER,
  };
}
