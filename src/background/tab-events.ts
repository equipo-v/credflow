// Eventos de flujo por pestaña (docs/specs/popup-alertas.md, secciones 2 y 3). Lógica pura: la persistencia en
// chrome.storage.session está en tab-store.ts. Solo guarda FlowEvent, que no contiene valores, huellas, rutas ni consultas.
import { ENCODINGS, FIELD_TYPES } from "../shared/constants";
import type { FieldType, FlowEvent, WatchedField } from "../shared/types";

export const MAX_EVENTS_PER_TAB = 50;
const MAX_WATCHED = 10;

/** Alertas acumuladas de una pestaña: no se pierden al descartar eventos antiguos de la lista. */
export type AlertSummary = { alerts: number; critical: boolean };

export type TabState = { events: FlowEvent[]; summary: AlertSummary; watched: WatchedField[] };

export class TabEventLog {
  private readonly byTab = new Map<number, TabState>();

  /** Agrega el evento y devuelve el resumen de alertas actualizado de su pestaña. */
  add(event: FlowEvent): AlertSummary {
    let state = this.byTab.get(event.tabId);
    state ??= this.create(event.tabId);
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

  /**
   * Registra que el usuario escribió en un campo sensible de la pestaña (docs/specs/popup-alertas.md, sección 5).
   * Se guarda una entrada por tipo de campo y sitio, con la hora del primer registro. Devuelve true si es nueva.
   */
  markWatched(tabId: number, fieldType: FieldType, site: string, now: Date): boolean {
    const state = this.byTab.get(tabId) ?? this.create(tabId);
    if (state.watched.some((w) => w.fieldType === fieldType && w.site === site)) return false;
    state.watched.push({ fieldType, site, since: now.toISOString() });
    if (state.watched.length > MAX_WATCHED) state.watched.shift();
    return true;
  }

  watched(tabId: number): WatchedField[] {
    return [...(this.byTab.get(tabId)?.watched ?? [])];
  }

  private create(tabId: number): TabState {
    const state: TabState = { events: [], summary: { alerts: 0, critical: false }, watched: [] };
    this.byTab.set(tabId, state);
    return state;
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
    return state
      ? { events: [...state.events], summary: { ...state.summary }, watched: [...state.watched] }
      : null;
  }

  /** Restaura el estado guardado de una pestaña (tras un reinicio del Service Worker). */
  restore(tabId: number, state: TabState): void {
    this.byTab.set(tabId, {
      events: state.events.slice(-MAX_EVENTS_PER_TAB),
      summary: { ...state.summary },
      watched: state.watched.slice(-MAX_WATCHED),
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
  "site_encrypted",
  "encrypted_third_party",
]);
const SEVERITIES = new Set(["critical", "high", "none"]);
const LOCATIONS = new Set(["body", "url", "header", "websocket"]);

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
    LOCATIONS.has(value.location as string) &&
    (value.script === undefined || value.script === null || typeof value.script === "string") &&
    (value.evidence === undefined || value.evidence === "network" || value.evidence === "page") &&
    typeof value.truncated === "boolean" &&
    VERDICTS.has(value.verdict as string) &&
    SEVERITIES.has(value.severity as string)
  );
}

function isWatchedField(value: unknown): value is WatchedField {
  return (
    isRecord(value) &&
    (FIELD_TYPES as readonly unknown[]).includes(value.fieldType) &&
    typeof value.site === "string" &&
    typeof value.since === "string"
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
  // Los eventos guardados por versiones anteriores no tienen script ni evidence: se completan.
  const events = raw.events
    .filter((event): event is FlowEvent => isFlowEvent(event, tabId))
    .map((event) => ({
      ...event,
      script: event.script ?? null,
      evidence: event.evidence ?? "network",
    }));
  // Estados guardados por versiones anteriores no tienen "watched": se toma como lista vacía.
  const watched = Array.isArray(raw.watched) ? raw.watched.filter(isWatchedField) : [];
  return {
    events: events.slice(-MAX_EVENTS_PER_TAB),
    summary: { alerts, critical },
    watched: watched.slice(-MAX_WATCHED),
  };
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
