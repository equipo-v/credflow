// Validadores de los datos que cruzan de la página a la extensión.
// Todo lo que llega de la página es no confiable (AGENTS.md, regla 6): entra como unknown y sale tipado o null.
import {
  ENCODINGS,
  FIELD_TYPES,
  MAX_FINGERPRINT_LENGTH,
  MAX_FINGERPRINTS,
  MAX_REPORT_TEXT,
  MAX_REPORT_URL,
  MIN_FINGERPRINT_LENGTH,
} from "./constants";
import type {
  AuditRequest,
  Encoding,
  FieldType,
  Fingerprint,
  GetTabEvents,
  PageReport,
  RegisterFingerprints,
} from "./types";

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

/** Valida GET_TAB_EVENTS: exactamente kind y tabId, con tabId entero mayor o igual que 0. */
export function parseGetTabEvents(message: unknown): GetTabEvents | null {
  if (!isPlainObject(message) || !hasExactKeys(message, ["kind", "tabId"])) return null;
  const { kind, tabId } = message;
  if (kind !== "GET_TAB_EVENTS") return null;
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) return null;
  return { kind, tabId };
}

/**
 * Comprueba que el remitente es una página de la propia extensión (el popup), no un content script
 * (docs/specs/popup-alertas.md, sección 4). Un content script siempre tiene la URL de la página web donde corre;
 * solo las páginas de la extensión tienen una URL chrome-extension://<id>/, y la extensión no expone recursos a la web.
 */
export function isExtensionPageSender(
  sender: { id?: string | undefined; url?: string | undefined; tab?: unknown },
  extensionId: string
): boolean {
  if (sender.id !== extensionId || typeof sender.url !== "string") return false;
  return sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

const REPORT_APIS = ["fetch", "xhr", "beacon", "websocket"] as const;
const REPORT_LOCATIONS = ["header", "blob", "websocket"] as const;
const REPORT_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

function isReportUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REPORT_URL)
    return false;
  try {
    return REPORT_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Valida un PageReport del interceptor (docs/specs/interceptor-pagina.md, sección 6). */
export function parsePageReport(message: unknown): PageReport | null {
  if (
    !isPlainObject(message) ||
    !hasExactKeys(message, ["kind", "api", "url", "script", "extra"])
  ) {
    return null;
  }
  const { kind, api, url, script, extra } = message;
  if (kind !== "PAGE_REPORT") return null;
  if (typeof api !== "string" || !(REPORT_APIS as readonly string[]).includes(api)) return null;
  if (!isReportUrl(url)) return null;
  if (script !== null && (typeof script !== "string" || script.length > MAX_REPORT_URL))
    return null;
  let parsedExtra: PageReport["extra"] = null;
  if (extra !== null) {
    if (!isPlainObject(extra) || !hasExactKeys(extra, ["location", "text"])) return null;
    const { location, text } = extra;
    if (
      typeof location !== "string" ||
      !(REPORT_LOCATIONS as readonly string[]).includes(location)
    ) {
      return null;
    }
    if (typeof text !== "string" || text.length > MAX_REPORT_TEXT) return null;
    parsedExtra = { location: location as "header" | "blob" | "websocket", text };
  }
  return { kind, api: api as PageReport["api"], url, script, extra: parsedExtra };
}

const AUDIT_KINDS = ["AUDIT_STATUS", "AUDIT_EXPORT", "AUDIT_CLEAR"] as const;

/** Valida un mensaje del popup al registro de auditoría (docs/specs/registro-auditoria.md, sección 7). */
export function parseAuditRequest(message: unknown): AuditRequest | null {
  if (!isPlainObject(message) || !hasExactKeys(message, ["kind"])) return null;
  const { kind } = message;
  if (typeof kind !== "string" || !(AUDIT_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as AuditRequest["kind"] };
}
