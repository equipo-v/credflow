// Canal interno por el que el Motor entrega los eventos de flujo al Registro de auditoría y al Popup.
import type { FlowEvent } from "../shared/types";

type Listener = (event: FlowEvent) => void;

const listeners = new Set<Listener>();

export function subscribeToFlowEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishFlowEvent(event: FlowEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Un consumidor que falla no debe impedir que los demás reciban el evento (AGENTS.md, regla 8).
    }
  }
}
