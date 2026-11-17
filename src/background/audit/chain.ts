// Cadena SHA-256 del registro de auditoría (docs/specs/registro-auditoria.md, secciones 3 y 5). Lógica pura.
import type { AuditEntry, AuditExport, AuditVerification } from "../../shared/types";

export const GENESIS_HASH = "0".repeat(64);
export const HASH_ALGORITHM =
  'hash = SHA-256 en hexadecimal de (prevHash + "\\n" + JSON canónico de entry, con las claves ordenadas alfabéticamente); el primer registro de la historia usa prevHash = 64 ceros';

/** JSON con las claves de los objetos ordenadas, para que el hash no dependa del orden de inserción. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function chainHash(prevHash: string, entry: AuditEntry): Promise<string> {
  const data = new TextEncoder().encode(`${prevHash}\n${canonicalJson(entry)}`);
  return hex(await crypto.subtle.digest("SHA-256", data));
}

/**
 * Verifica la cadena de un archivo exportado (sección 6): seq consecutivos, enlaces prevHash y hashes recalculados.
 * No puede comprobar la cabeza (no viaja en el archivo): para eso está verification, calculada por la extensión.
 */
export async function verifyExport(file: AuditExport): Promise<AuditVerification> {
  const records = file.records;
  const first = records[0];
  const result = (valid: boolean, problem: AuditVerification["problem"]): AuditVerification => ({
    valid,
    problem,
    count: records.length,
    firstSeq: first?.seq ?? null,
    lastSeq: records.at(-1)?.seq ?? null,
    anchor: first?.prevHash ?? null,
  });
  let previous: { seq: number; hash: string } | null = null;
  for (const record of records) {
    if (previous && record.seq !== previous.seq + 1) return result(false, "gap");
    if (previous && record.prevHash !== previous.hash) return result(false, "hash");
    if ((await chainHash(record.prevHash, record.entry)) !== record.hash)
      return result(false, "hash");
    previous = { seq: record.seq, hash: record.hash };
  }
  return result(true, null);
}
