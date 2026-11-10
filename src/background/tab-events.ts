// Eventos de flujo por pestaña, en memoria (docs/specs/popup-alertas.md, secciones 2 y 3).
// Solo guarda FlowEvent, que por contrato no contiene valores, huellas, rutas ni consultas.
import type { FlowEvent } from "../shared/types";

export const MAX_EVENTS_PER_TAB = 50;

/** Alertas acumuladas de una pestaña: no se pierden al descartar eventos antiguos de la lista. */
export type AlertSummary = { alerts: number; critical: boolean };

type TabState = { events: FlowEvent[]; summary: AlertSummary };

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
