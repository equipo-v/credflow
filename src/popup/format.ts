// Textos de una fila del popup a partir de un evento (docs/specs/popup-alertas.md, sección 5).
// Lógica pura: solo usa campos del contrato FlowEvent y nunca muestra valores.
import type { FieldType, FlowEvent, Severity, Verdict } from "../shared/types";

export type SeverityLevel = "critical" | "high" | "ok";

export type EventRow = {
  time: string;
  destination: string;
  field: string;
  verdict: string;
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
};

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
  const severity = SEVERITY[event.severity];
  return {
    time: formatTime(event.timestamp),
    destination: event.destinationOrigin,
    field: FIELD_TEXT[event.fieldType],
    verdict: VERDICT_TEXT[event.verdict],
    severityLabel: severity.label,
    severity: severity.level,
  };
}
