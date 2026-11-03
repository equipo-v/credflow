// Cuenta los errores de análisis para que no pasen desapercibidos (sección 4.6 de la especificación).
// Solo guarda contadores: nunca la petición, el mensaje ni el texto del error.
import { ERROR_THRESHOLD, ERROR_WINDOW_MS } from "../shared/constants";
import type { DiagnosticEvent } from "../shared/types";

export class ErrorMonitor {
  private windowStart = Number.NEGATIVE_INFINITY;
  private count = 0;

  /** Registra un error y devuelve un evento de diagnóstico si en esta ventana se alcanzó el umbral. */
  record(now: number): DiagnosticEvent | null {
    if (now - this.windowStart >= ERROR_WINDOW_MS) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count += 1;
    if (this.count !== ERROR_THRESHOLD) return null;
    return {
      kind: "analysis_errors",
      timestamp: new Date(now).toISOString(),
      errorCount: this.count,
      windowSeconds: ERROR_WINDOW_MS / 1000,
    };
  }
}
