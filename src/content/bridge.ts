// Puente de mensajes: content script en el mundo aislado (docs/specs/puente-mensajes.md).
// Detecta lo que el usuario escribe en campos sensibles y envía las huellas al Motor de análisis.
// El valor solo existe dentro de sendFingerprints: no se guarda en el DOM, en variables globales ni en logs.
import { buildRegisterMessage, fieldTypeOf, shouldRefresh } from "./fields";

const DEBOUNCE_MS = 300;

type FieldState = {
  timer: ReturnType<typeof setTimeout> | null;
  /** Hubo cambios desde el último envío. No se guarda nada del valor (sección 4.4). */
  dirty: boolean;
  /** El usuario escribió en el campo con eventos de confianza. Sin esto, nunca se envía. */
  typed: boolean;
  /** Hora del último envío (un número, nunca el valor), para el refresco ante un clic. */
  lastSentAt: number | null;
};

// Por campo solo se guarda el temporizador y la marca de cambios pendientes (sección 4.4).
const states = new WeakMap<HTMLInputElement, FieldState>();

function sensitiveField(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof HTMLInputElement)) return null;
  return fieldTypeOf({ type: target.type, autocomplete: target.autocomplete }) ? target : null;
}

function stateOf(field: HTMLInputElement): FieldState {
  let state = states.get(field);
  if (!state) {
    state = { timer: null, dirty: false, typed: false, lastSentAt: null };
    states.set(field, state);
  }
  return state;
}

function sendFingerprints(field: HTMLInputElement, force = false): void {
  const state = stateOf(field);
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  // Solo se envían campos donde el usuario escribió de verdad: un script de la página no puede cambiar el valor
  // por código y forzar el envío con requestSubmit() (sección 4.1).
  if (!state.typed) return;
  // Si el valor no cambió desde el último envío, no se reenvía (sección 4.2). Al enviar el formulario se
  // reenvía siempre, por si el Service Worker se reinició y perdió las huellas.
  if (!state.dirty && !force) return;
  state.dirty = false;
  const fieldType = fieldTypeOf({ type: field.type, autocomplete: field.autocomplete });
  if (!fieldType) return;
  const message = buildRegisterMessage(fieldType, field.value);
  if (!message) return;
  state.lastSentAt = Date.now();
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // El Service Worker puede estar reiniciándose: se descarta en silencio (sección 4.3).
    });
  } catch {
    // La extensión pudo recargarse y este content script quedar huérfano.
  }
}

function flushAll(form: HTMLFormElement): void {
  for (const element of Array.from(form.elements)) {
    const field = sensitiveField(element);
    if (field) sendFingerprints(field, true);
  }
}

document.addEventListener(
  "input",
  (event) => {
    // Un script de la página no puede inyectar valores con eventos sintéticos (sección 4.1).
    if (!event.isTrusted) return;
    const field = sensitiveField(event.target);
    if (!field) return;
    const state = stateOf(field);
    state.typed = true;
    state.dirty = true;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => sendFingerprints(field), DEBOUNCE_MS);
  },
  true
);

// Envío inmediato antes de que la página pueda mandar el valor (sección 4.2).
document.addEventListener(
  "blur",
  (event) => {
    if (!event.isTrusted) return;
    const field = sensitiveField(event.target);
    if (field) sendFingerprints(field);
  },
  true
);

document.addEventListener(
  "keydown",
  (event) => {
    if (!event.isTrusted || event.key !== "Enter") return;
    const field = sensitiveField(event.target);
    if (field) sendFingerprints(field);
  },
  true
);

document.addEventListener(
  "submit",
  (event) => {
    if (event.target instanceof HTMLFormElement) flushAll(event.target);
  },
  true
);

// Refresco ante un clic de confianza (sección 4.2): si el usuario escribió hace tiempo y ahora pulsa un botón que envía
// la contraseña por JavaScript, las huellas pudieron caducar en el Motor. pointerdown ocurre antes del clic que la
// página procesa, así que el Motor las recibe antes del envío.
document.addEventListener(
  "pointerdown",
  (event) => {
    if (!event.isTrusted) return;
    const now = Date.now();
    for (const input of Array.from(document.querySelectorAll("input"))) {
      const state = states.get(input);
      if (state && shouldRefresh(state, now) && sensitiveField(input))
        sendFingerprints(input, true);
    }
  },
  true
);
