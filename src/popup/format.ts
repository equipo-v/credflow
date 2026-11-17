// Textos de una fila del popup a partir de un evento (docs/specs/popup-alertas.md, sección 5).
// Lógica pura: solo usa campos del contrato FlowEvent y nunca muestra valores.
import type { FieldType, FlowEvent, Severity, Verdict, WatchedField } from "../shared/types";

export type SeverityLevel = "critical" | "high" | "ok" | "info";

export type EventRow = {
  time: string;
  destination: string;
  field: string;
  verdict: string;
  /** Texto adicional bajo el veredicto, si lo hay. */
  note: string;
  severityLabel: string;
  severity: SeverityLevel;
};

const VERDICT_TEXT: Record<Verdict, string> = {
  third_party: "Enviada a un tercero no autorizado",
  insecure_channel: "Enviada por un canal sin cifrar",
  opaque_body: "Envío no inspeccionable a un tercero",
  credential_in_url: "Credencial en la URL",
  authorized_provider: "Enviada a un proveedor autorizado",
  same_site: "Enviada al mismo sitio",
  site_encrypted: "La página cifra la contraseña antes de enviarla",
  encrypted_third_party: "Contraseña cifrada enviada a un tercero",
};

const VERDICT_NOTE: Partial<Record<Verdict, string>> = {
  site_encrypted: "CredFlow no puede ver su contenido",
  encrypted_third_party: "Cifrarla no impide el robo si quien la recibe tiene la clave",
};

const INFO = { level: "info", label: "ℹ informativo" } as const;

const FIELD_TEXT: Record<FieldType, string> = {
  password: "Contraseña",
  card: "Tarjeta",
  custom: "Campo sensible",
};

// El color nunca es el único indicador: cada severidad lleva también un símbolo y un texto.
const SEVERITY: Record<Severity, { level: SeverityLevel; label: string }> = {
  critical: { level: "critical", label: "✗ crítica" },
  high: { level: "high", label: "! alta" },
  none: { level: "ok", label: "✓ normal" },
};

function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

/** Hora local HH:MM:SS de una marca ISO 8601; "--:--:--" si no es válida. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

export function rowFor(event: FlowEvent): EventRow {
  // site_encrypted no es un envío "normal" visible: es informativo (azul).
  const severity = event.verdict === "site_encrypted" ? INFO : SEVERITY[event.severity];
  return {
    time: formatTime(event.timestamp),
    destination: event.destinationOrigin,
    field: FIELD_TEXT[event.fieldType],
    verdict: VERDICT_TEXT[event.verdict],
    note: VERDICT_NOTE[event.verdict] ?? "",
    severityLabel: severity.label,
    severity: severity.level,
  };
}

export type WatchedRow = { title: string; note: string; site: string; time: string };

/** Tarjeta azul de un campo vigilado (sección 5): el usuario escribió aquí y CredFlow vigila sus envíos. */
export function watchedRowFor(watched: WatchedField): WatchedRow {
  const title =
    watched.fieldType === "card"
      ? "Datos de tarjeta ingresados en este sitio"
      : `${FIELD_TEXT[watched.fieldType]} ingresada en este sitio`;
  return {
    title,
    note: "CredFlow vigila a dónde se envía",
    site: watched.site,
    time: formatTime(watched.since),
  };
}

/** Veredictos que ofrecen "Confiar en…" (sección 5.2). Nunca insecure_channel: el canal sigue sin cifrar. */
const TRUSTABLE: ReadonlySet<Verdict> = new Set<Verdict>([
  "third_party",
  "opaque_body",
  "encrypted_third_party",
]);

export function canTrust(event: FlowEvent): boolean {
  return TRUSTABLE.has(event.verdict);
}

/** "Script: analytics.js (http://localhost:8124)" a partir de origen + ruta (sección 5.1). */
export function scriptLabel(script: string | null): string {
  if (!script) return "";
  try {
    const url = new URL(script);
    const file = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return `Script: ${file || "(código en la página)"} (${url.origin})`;
  } catch {
    return "";
  }
}

const EVIDENCE_PLACE: Record<FlowEvent["location"], string> = {
  header: "encabezado",
  body: "Blob",
  websocket: "WebSocket",
  url: "URL",
};

/** Indica que el evento lo detectó el interceptor de página y dónde (sección 5.1). */
export function evidenceLabel(event: FlowEvent): string {
  return event.evidence === "page"
    ? `Detectado en la página (${EVIDENCE_PLACE[event.location]})`
    : "";
}
