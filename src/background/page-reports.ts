// Atribución del script que hizo una petición (docs/specs/motor-analisis.md, sección 4.8).
// Lógica pura: guarda en memoria la URL y el script de los PageReport recientes, nunca su contenido (extra).
// La URL puede contener el dato sensible: solo vive en memoria y caduca a los 10 s.

export const REPORT_TTL_MS = 10_000;
export const MATCH_WINDOW_MS = 3_000;
export const MAX_REPORTS_PER_TAB = 50;

type Report = { url: string; script: string; at: number };
type Pending = { url: string; eventId: string; at: number };

export class AttributionLog {
  private readonly reports = new Map<number, Report[]>();
  private readonly pending = new Map<number, Pending[]>();

  /**
   * Guarda un reporte con script y devuelve los eventos de red ya creados para la misma URL (hasta 3 s antes) que
   * esperaban atribución; se quitan de la espera.
   */
  addReport(tabId: number, url: string, script: string | null, now: number): string[] {
    this.prune(now);
    if (script === null) return [];
    const list = this.reports.get(tabId) ?? [];
    list.push({ url, script, at: now });
    if (list.length > MAX_REPORTS_PER_TAB) list.shift();
    this.reports.set(tabId, list);

    const waiting = this.pending.get(tabId) ?? [];
    const matched = waiting.filter((p) => p.url === url && now - p.at <= MATCH_WINDOW_MS);
    this.pending.set(
      tabId,
      waiting.filter((p) => !matched.includes(p))
    );
    return matched.map((p) => p.eventId);
  }

  /** Script del reporte más reciente de la misma pestaña y URL recibido hasta 3 s antes, o null. */
  scriptFor(tabId: number, url: string, now: number): string | null {
    const list = this.reports.get(tabId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const report = list[i];
      if (report && report.url === url && Math.abs(now - report.at) <= MATCH_WINDOW_MS)
        return report.script;
    }
    return null;
  }

  /** Un evento de red sin script espera hasta 3 s un reporte de la misma URL. */
  awaitReport(tabId: number, url: string, eventId: string, now: number): void {
    const list = this.pending.get(tabId) ?? [];
    list.push({ url, eventId, at: now });
    if (list.length > MAX_REPORTS_PER_TAB) list.shift();
    this.pending.set(tabId, list);
  }

  /** Elimina lo caducado: reportes de más de 10 s y esperas de más de 3 s. */
  prune(now: number): void {
    for (const [tabId, list] of this.reports) {
      const kept = list.filter((r) => now - r.at <= REPORT_TTL_MS);
      if (kept.length) this.reports.set(tabId, kept);
      else this.reports.delete(tabId);
    }
    for (const [tabId, list] of this.pending) {
      const kept = list.filter((p) => now - p.at <= MATCH_WINDOW_MS);
      if (kept.length) this.pending.set(tabId, kept);
      else this.pending.delete(tabId);
    }
  }

  clearTab(tabId: number): void {
    this.reports.delete(tabId);
    this.pending.delete(tabId);
  }

  /** Para las pruebas: cuántos reportes guarda la pestaña. */
  size(tabId: number): number {
    return this.reports.get(tabId)?.length ?? 0;
  }
}
