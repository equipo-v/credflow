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
