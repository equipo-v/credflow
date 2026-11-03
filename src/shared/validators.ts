// Validadores de los datos que cruzan de la página a la extensión.
// Todo lo que llega de la página es no confiable (AGENTS.md, regla 6): entra como unknown y sale tipado o null.
import {
  ENCODINGS,
  FIELD_TYPES,
  MAX_FINGERPRINT_LENGTH,
  MAX_FINGERPRINTS,
  MIN_FINGERPRINT_LENGTH,
} from "./constants";
import type { Encoding, FieldType, Fingerprint, RegisterFingerprints } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

function isEncoding(value: unknown): value is Encoding {
  return typeof value === "string" && (ENCODINGS as readonly string[]).includes(value);
}

function parseFingerprint(value: unknown): Fingerprint | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["encoding", "value"])) return null;
  const { encoding, value: text } = value;
  if (!isEncoding(encoding) || typeof text !== "string") return null;
  if (text.length < MIN_FINGERPRINT_LENGTH || text.length > MAX_FINGERPRINT_LENGTH) return null;
  return { encoding, value: text };
}

/**
 * Valida el mensaje REGISTER_FINGERPRINTS (sección 4.1 de la especificación).
 * Devuelve null si cualquier regla falla; quien lo llame descarta el mensaje sin error visible.
 */
export function parseRegisterFingerprints(message: unknown): RegisterFingerprints | null {
  if (!isPlainObject(message) || !hasExactKeys(message, ["kind", "fieldType", "fingerprints"])) {
    return null;
  }
  const { kind, fieldType, fingerprints } = message;
  if (kind !== "REGISTER_FINGERPRINTS" || !isFieldType(fieldType)) return null;
  if (!Array.isArray(fingerprints)) return null;
  if (fingerprints.length < 1 || fingerprints.length > MAX_FINGERPRINTS) return null;

  const parsed: Fingerprint[] = [];
  const seen = new Set<Encoding>();
  for (const item of fingerprints) {
    const fingerprint = parseFingerprint(item);
    if (fingerprint === null || seen.has(fingerprint.encoding)) return null;
    seen.add(fingerprint.encoding);
    parsed.push(fingerprint);
  }
  return { kind, fieldType, fingerprints: parsed };
}

/**
 * Comprueba que el mensaje viene de un content script de esta extensión en una pestaña real
 * y devuelve el tabId del remitente, o null si no se debe aceptar (sección 4.1, reglas 1).
 */
export function trustedSenderTabId(
  sender: { id?: string | undefined; tab?: { id?: number | undefined } | undefined },
  extensionId: string
): number | null {
  if (sender.id !== extensionId) return null;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) return null;
  return tabId;
}
