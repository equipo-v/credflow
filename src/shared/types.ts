// Contratos entre componentes. Cualquier cambio aquí requiere la revisión del otro agente (AGENTS.md).
import type { ENCODINGS, FIELD_TYPES } from "./constants";

export type FieldType = (typeof FIELD_TYPES)[number];

export type Encoding = (typeof ENCODINGS)[number];

export type Fingerprint = {
  encoding: Encoding;
  value: string;
};

/**
 * Mensaje del Puente de mensajes al Motor de análisis (sección 3.1 de la especificación).
 * El tabId no viaja en el mensaje: el Motor lo toma de sender.tab.id.
 */
export type RegisterFingerprints = {
  kind: "REGISTER_FINGERPRINTS";
  fieldType: FieldType;
  fingerprints: Fingerprint[];
};

export type Verdict =
  | "insecure_channel"
  | "third_party"
  | "opaque_body"
  | "credential_in_url"
  | "authorized_provider"
  | "same_site"
  | "site_encrypted"
  | "encrypted_third_party";

export type Severity = "critical" | "high" | "none";

/**
 * Evento que produce el Motor de análisis (sección 5 de la especificación).
 * Nunca contiene el valor, una huella, ni la ruta o la consulta de la URL.
 */
export type FlowEvent = {
  id: string;
  /** ISO 8601 en UTC. */
  timestamp: string;
  tabId: number;
  /** eTLD+1 de la página. */
  pageSite: string;
  /** Solo esquema + host + puerto. */
  destinationOrigin: string;
  /** eTLD+1 del destino. */
  destinationSite: string;
  method: string;
  requestType: string;
  fieldType: FieldType;
  /** null solo en opaque_body. */
  encoding: Encoding | null;
  location: "body" | "url";
  truncated: boolean;
  verdict: Verdict;
  severity: Severity;
};

/**
 * Evento de diagnóstico del Motor (sección 4.6 de la especificación).
 * Nunca contiene datos de la petición o del mensaje que falló.
 */
export type DiagnosticEvent = {
  kind: "analysis_errors";
  /** ISO 8601 en UTC. */
  timestamp: string;
  errorCount: number;
  windowSeconds: number;
};

/** Petición del popup al Service Worker (docs/specs/popup-alertas.md, sección 4). */
export type GetTabEvents = {
  kind: "GET_TAB_EVENTS";
  tabId: number;
};

/** Campo sensible en el que el usuario escribió en una pestaña (docs/specs/popup-alertas.md, sección 5). */
export type WatchedField = {
  fieldType: FieldType;
  /** eTLD+1 de la página donde se escribió. */
  site: string;
  /** ISO 8601 en UTC del primer registro. */
  since: string;
};

export type TabEventsResponse = {
  events: FlowEvent[];
  watched: WatchedField[];
};
