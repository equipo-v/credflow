// Constantes compartidas entre componentes (docs/specs/motor-analisis.md).

/** Tiempo de vida de una huella en memoria (sección 4.2). */
export const FINGERPRINT_TTL_MS = 30_000;

/** Longitud mínima y máxima de cada huella, en caracteres (sección 4.1). */
export const MIN_FINGERPRINT_LENGTH = 6;
export const MAX_FINGERPRINT_LENGTH = 1024;

/** Número máximo de huellas por mensaje: una por codificación (sección 4.1). */
export const MAX_FINGERPRINTS = 5;

/** Bytes del cuerpo que se analizan por petición (sección 4.3). */
export const MAX_BODY_BYTES = 256 * 1024;

export const FIELD_TYPES = ["password", "card", "custom"] as const;

/** Límites del reporte del interceptor de página (docs/specs/interceptor-pagina.md, sección 6). */
export const MAX_REPORT_URL = 2048;
export const MAX_REPORT_TEXT = 64 * 1024;

export const ENCODINGS = ["original", "base64", "url", "hex", "reversed"] as const;

/** Ventana y umbral para emitir un evento de diagnóstico por errores de análisis (sección 4.6). */
export const ERROR_WINDOW_MS = 60_000;
export const ERROR_THRESHOLD = 5;
