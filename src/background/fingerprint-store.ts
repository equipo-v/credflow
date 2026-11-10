// Almacén de huellas en memoria (sección 4.2 de docs/specs/motor-analisis.md).
// Las huellas nunca salen de este objeto hacia almacenamiento, logs ni eventos (AGENTS.md, regla 1).
import { FINGERPRINT_TTL_MS } from "../shared/constants";
import type { FieldType, Fingerprint, RegisterFingerprints } from "../shared/types";

export type ActiveFingerprint = Fingerprint & { fieldType: FieldType };

type Entry = {
  fingerprints: Fingerprint[];
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

export class FingerprintStore {
  // Un registro por tipo de campo y pestaña: un registro nuevo del mismo campo reemplaza al anterior.
  private readonly byTab = new Map<number, Map<FieldType, Entry>>();

  register(tabId: number, message: RegisterFingerprints, now: number): void {
    let fields = this.byTab.get(tabId);
    if (!fields) {
      fields = new Map();
      this.byTab.set(tabId, fields);
    }
    const previous = fields.get(message.fieldType);
    if (previous) clearTimeout(previous.timer);
    const entry: Entry = {
      fingerprints: message.fingerprints.map((fp) => ({ ...fp })),
      expiresAt: now + FINGERPRINT_TTL_MS,
      // Elimina el registro al vencer aunque la pestaña no haga más peticiones (ASVS 8.3.6).
      timer: setTimeout(() => this.remove(tabId, message.fieldType, entry), FINGERPRINT_TTL_MS),
    };
    fields.set(message.fieldType, entry);
  }

  /** Devuelve las huellas vigentes de la pestaña, eliminando antes las vencidas. */
  active(tabId: number, now: number): ActiveFingerprint[] {
    const fields = this.byTab.get(tabId);
    if (!fields) return [];
    const result: ActiveFingerprint[] = [];
    for (const [fieldType, entry] of fields) {
      if (entry.expiresAt <= now) {
        clearTimeout(entry.timer);
        fields.delete(fieldType);
        continue;
      }
      for (const fp of entry.fingerprints) result.push({ ...fp, fieldType });
    }
    if (fields.size === 0) this.byTab.delete(tabId);
    return result;
  }

  clearTab(tabId: number): void {
    for (const entry of this.byTab.get(tabId)?.values() ?? []) clearTimeout(entry.timer);
    this.byTab.delete(tabId);
  }

  /** Número de pestañas con registros en memoria (para pruebas y diagnóstico; no expone huellas). */
  get tabCount(): number {
    return this.byTab.size;
  }

  private remove(tabId: number, fieldType: FieldType, entry: Entry): void {
    const fields = this.byTab.get(tabId);
    // Solo elimina si sigue siendo el mismo registro (uno nuevo del mismo campo lo pudo reemplazar).
    if (fields?.get(fieldType) !== entry) return;
    fields.delete(fieldType);
    if (fields.size === 0) this.byTab.delete(tabId);
  }
}
