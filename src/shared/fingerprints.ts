// Generación de huellas a partir del valor escrito por el usuario.
// Vive en shared/ para que el Puente (que las genera) y el Motor (que las busca) usen la misma definición.
// El valor y las huellas solo existen en memoria: nunca se registran ni se persisten (AGENTS.md, regla 1).
import { MAX_FINGERPRINT_LENGTH, MIN_FINGERPRINT_LENGTH } from "./constants";
import type { Fingerprint } from "./types";

const encoder = new TextEncoder();

function toBase64(value: string): string {
  // Base64 de los bytes UTF-8; para texto ASCII coincide con btoa(value), que es lo que suele usar un skimmer.
  let binary = "";
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(value: string): string {
  let hex = "";
  for (const byte of encoder.encode(value)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Devuelve las huellas del valor en las cinco codificaciones, omitiendo las que quedan fuera de los
 * límites de longitud y las que repiten el texto de otra. Si el valor es demasiado corto devuelve [].
 */
export function buildFingerprints(value: string): Fingerprint[] {
  if (value.length < MIN_FINGERPRINT_LENGTH) return [];

  const candidates: Fingerprint[] = [
    { encoding: "original", value },
    { encoding: "base64", value: toBase64(value) },
    { encoding: "url", value: encodeURIComponent(value) },
    { encoding: "hex", value: toHex(value) },
    { encoding: "reversed", value: [...value].reverse().join("") },
  ];

  const seen = new Set<string>();
  return candidates.filter((fp) => {
    const valid =
      fp.value.length >= MIN_FINGERPRINT_LENGTH &&
      fp.value.length <= MAX_FINGERPRINT_LENGTH &&
      !seen.has(fp.value);
    seen.add(fp.value);
    return valid;
  });
}
