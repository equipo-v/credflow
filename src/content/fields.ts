// Lógica pura del Puente de mensajes (docs/specs/puente-mensajes.md, secciones 3 y 4.3).
import { buildFingerprints } from "../shared/fingerprints";
import type { FieldType, RegisterFingerprints } from "../shared/types";

const CARD_TOKENS = new Set(["cc-number", "cc-csc"]);

/** Tipo de campo sensible según sus atributos, o null si no es sensible (sección 3). */
export function fieldTypeOf(attributes: {
  type: string;
  autocomplete: string;
}): Exclude<FieldType, "custom"> | null {
  if (attributes.type.toLowerCase() === "password") return "password";
  const tokens = attributes.autocomplete.toLowerCase().split(/\s+/);
  if (tokens.some((token) => CARD_TOKENS.has(token))) return "card";
  return null;
}

/**
 * Mensaje para el Motor con el contrato exacto (sección 4.3), o null si el valor es demasiado corto.
 * El valor no sale de esta función: solo sus huellas.
 */
export function buildRegisterMessage(
  fieldType: FieldType,
  value: string
): RegisterFingerprints | null {
  const fingerprints = buildFingerprints(value);
  if (fingerprints.length === 0) return null;
  return { kind: "REGISTER_FINGERPRINTS", fieldType, fingerprints };
}

/** Tiempo tras el cual un clic vuelve a enviar las huellas (sección 4.2): menor que su caducidad de 30 s. */
export const REFRESH_AFTER_MS = 10_000;

/**
 * ¿Hay que reenviar las huellas de un campo ante un clic? Solo si el usuario escribió en él y su último envío
 * fue hace más de REFRESH_AFTER_MS (o todavía no se envió).
 */
export function shouldRefresh(
  state: { typed: boolean; lastSentAt: number | null },
  now: number
): boolean {
  if (!state.typed) return false;
  return state.lastSentAt === null || now - state.lastSentAt > REFRESH_AFTER_MS;
}
