// Almacén de huellas en memoria (sección 4.2 de docs/specs/motor-analisis.md).
// Las huellas nunca salen de este objeto hacia almacenamiento, logs ni eventos (AGENTS.md, regla 1).
import { FINGERPRINT_TTL_MS } from "../shared/constants";
import type { FieldType, Fingerprint, RegisterFingerprints } from "../shared/types";

export type ActiveFingerprint = Fingerprint & { fieldType: FieldType };

type Entry = {
  fingerprints: Fingerprint[];
  expiresAt: number;
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
    fields.set(message.fieldType, {
      fingerprints: message.fingerprints.map((fp) => ({ ...fp })),
      expiresAt: now + FINGERPRINT_TTL_MS,
    });
  }

  /** Devuelve las huellas vigentes de la pestaña, eliminando antes las vencidas. */
  active(tabId: number, now: number): ActiveFingerprint[] {
    const fields = this.byTab.get(tabId);
    if (!fields) return [];
    const result: ActiveFingerprint[] = [];
    for (const [fieldType, entry] of fields) {
      if (entry.expiresAt <= now) {
        fields.delete(fieldType);
        continue;
      }
      for (const fp of entry.fingerprints) result.push({ ...fp, fieldType });
    }
    if (fields.size === 0) this.byTab.delete(tabId);
    return result;
  }

  clearTab(tabId: number): void {
    this.byTab.delete(tabId);
  }
}
