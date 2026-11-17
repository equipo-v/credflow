// Detección de contraseñas cifradas o transformadas por la propia página (docs/specs/motor-analisis.md, sección 4.7).
// Lógica pura. Solo responde sí o no: nunca devuelve el nombre ni el valor del campo detectado.
import type { RequestBodyLike } from "./request-body";

/** Prefijos de formatos conocidos de contraseñas cifradas en el navegador. */
const KNOWN_PREFIXES = ["#PWD_BROWSER:", "#PWD_INSTAGRAM_BROWSER:"];

/** Fragmentos de nombre de campo que indican una contraseña. */
const PASSWORD_NAME = /pass|pwd|clave|contrasena|contraseña|encpass|cipher|crypt/i;

/**
 * Valor que parece cifrado o derivado: 32 caracteres o más de Base64, Base64 URL o hexadecimal, opcionalmente con
 * un prefijo de formato separado por ":" o "$" (por ejemplo, los hashes "$2b$12$...").
 */
const OPAQUE_VALUE = /^(?:[$:]?[A-Za-z0-9]{1,24}[$:])*[A-Za-z0-9+/_-]{32,}={0,2}$/;

const MAX_DEPTH = 3;
const MAX_FIELDS = 200;

type Field = [name: string, value: string];

function fieldsFromJson(value: unknown, name: string, depth: number, out: Field[]): void {
  if (out.length >= MAX_FIELDS) return;
  if (typeof value === "string") {
    out.push([name, value]);
  } else if (typeof value === "object" && value !== null && depth < MAX_DEPTH) {
    for (const [key, child] of Object.entries(value)) {
      fieldsFromJson(child, Array.isArray(value) ? name : key, depth + 1, out);
    }
  }
}

/** Pares campo-valor del cuerpo: formData, texto con forma de formulario o JSON (hasta 3 niveles). */
export function bodyFields(body: RequestBodyLike | undefined, text: string): Field[] {
  const out: Field[] = [];
  if (body?.formData) {
    for (const [name, values] of Object.entries(body.formData)) {
      for (const value of values ?? []) if (out.length < MAX_FIELDS) out.push([name, value]);
    }
    return out;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      fieldsFromJson(JSON.parse(trimmed) as unknown, "", 0, out);
    } catch {
      // No era JSON válido.
    }
    return out;
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    for (const [name, value] of new URLSearchParams(trimmed)) {
      if (out.length < MAX_FIELDS) out.push([name, value]);
    }
  }
  return out;
}

/** ¿Algún campo del cuerpo es una contraseña cifrada o transformada por la página? */
export function hasEncryptedPassword(fields: readonly Field[]): boolean {
  return fields.some(([name, value]) => {
    if (KNOWN_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
    return PASSWORD_NAME.test(name) && OPAQUE_VALUE.test(value);
  });
}
