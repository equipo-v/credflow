// Canales internos por los que el Motor entrega sus eventos al Registro de auditoría y al Popup.
import type { DiagnosticEvent, FlowEvent } from "../shared/types";

type Listener<T> = (event: T) => void;

function createChannel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event: T): void {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Un consumidor que falla no debe impedir que los demás reciban el evento (AGENTS.md, regla 8).
        }
      }
    },
  };
}

const flowChannel = createChannel<FlowEvent>();
const diagnosticChannel = createChannel<DiagnosticEvent>();

export const subscribeToFlowEvents = flowChannel.subscribe;
export const publishFlowEvent = flowChannel.publish;
export const subscribeToDiagnostics = diagnosticChannel.subscribe;
export const publishDiagnostic = diagnosticChannel.publish;
