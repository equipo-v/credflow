// Registro de auditoría cifrado y encadenado (docs/specs/registro-auditoria.md).
// La lógica no depende de IndexedDB: recibe un AuditStorage, para poder probarla con Vitest.
import type {
  AuditEntry,
  AuditExport,
  AuditRecordExport,
  AuditStatus,
  AuditVerification,
  FlowEvent,
} from "../../shared/types";
import { chainHash, GENESIS_HASH, HASH_ALGORITHM } from "./chain";

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_RECORDS = 1000;
const HEAD_AAD = "credflow-audit:head";

/** Lo que se guarda en disco: solo seq y hora en claro; el resto, cifrado. */
export type StoredRecord = {
  seq: number;
  at: number;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
};
export type StoredHead = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };

export interface AuditStorage {
  getKey(): Promise<CryptoKey | null>;
  putKey(key: CryptoKey): Promise<void>;
  /** Registros ordenados por seq. */
  records(): Promise<StoredRecord[]>;
  putRecord(record: StoredRecord): Promise<void>;
  deleteRecords(seqs: number[]): Promise<void>;
  getHead(): Promise<StoredHead | null>;
  putHead(head: StoredHead): Promise<void>;
  /** Borra registros, cabeza y clave. */
  clear(): Promise<void>;
}

type Plain = { entry: AuditEntry; prevHash: string; hash: string };
type Head = { lastSeq: number; lastHash: string };

const aad = (seq: number): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`credflow-audit:${seq}`);

/** Entrada sin tabId (sección 2). */
export function toEntry(event: FlowEvent): AuditEntry {
  const entry: Partial<FlowEvent> = { ...event };
  delete entry.tabId;
  return entry as AuditEntry;
}

function isPlain(value: unknown): value is Plain {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.prevHash === "string" &&
    typeof v.hash === "string" &&
    typeof v.entry === "object" &&
    v.entry !== null
  );
}

function isHead(value: unknown): value is Head {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.lastSeq === "number" && typeof v.lastHash === "string";
}

export class AuditLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: AuditStorage,
    private readonly now: () => number = Date.now
  ) {}

  /** Ejecuta en orden: dos eventos seguidos no deben romper la cadena (sección 3). */
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async encrypt(key: CryptoKey, value: unknown, additional: Uint8Array<ArrayBuffer>) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additional },
      key,
      new TextEncoder().encode(JSON.stringify(value))
    );
    return { iv, data };
  }

  private async decrypt(
    key: CryptoKey,
    iv: Uint8Array<ArrayBuffer>,
    data: ArrayBuffer,
    additional: Uint8Array<ArrayBuffer>
  ): Promise<unknown> {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additional },
      key,
      data
    );
    return JSON.parse(new TextDecoder().decode(plain)) as unknown;
  }

  /** Clave existente o una nueva; sin clave, los registros guardados no se pueden leer y se borran (sección 3). */
  private async key(): Promise<CryptoKey> {
    const existing = await this.storage.getKey();
    if (existing) return existing;
    await this.storage.clear();
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await this.storage.putKey(key);
    return key;
  }

  private async readHead(key: CryptoKey): Promise<Head | null> {
    const stored = await this.storage.getHead();
    if (!stored) return null;
    const head = await this.decrypt(
      key,
      stored.iv,
      stored.data,
      new TextEncoder().encode(HEAD_AAD)
    );
    return isHead(head) ? head : null;
  }

  /** Agrega un evento al final de la cadena y aplica la retención (secciones 3 y 4). */
  append(event: FlowEvent): Promise<void> {
    return this.serialized(async () => {
      const key = await this.key();
      const head = await this.readHead(key).catch(() => null);
      const seq = (head?.lastSeq ?? 0) + 1;
      const prevHash = head?.lastHash ?? GENESIS_HASH;
      const entry = toEntry(event);
      const hash = await chainHash(prevHash, entry);
      const { iv, data } = await this.encrypt(
        key,
        { entry, prevHash, hash } satisfies Plain,
        aad(seq)
      );
      await this.storage.putRecord({ seq, at: this.now(), iv, data });
      const newHead = await this.encrypt(
        key,
        { lastSeq: seq, lastHash: hash } satisfies Head,
        new TextEncoder().encode(HEAD_AAD)
      );
      await this.storage.putHead(newHead);
      await this.prune();
    });
  }

  private async prune(): Promise<void> {
    const records = await this.storage.records();
    const limit = this.now() - RETENTION_MS;
    const old = records.filter((r) => r.at < limit).map((r) => r.seq);
    const kept = records.filter((r) => r.at >= limit);
    const excess = kept.slice(0, Math.max(0, kept.length - MAX_RECORDS)).map((r) => r.seq);
    if (old.length + excess.length > 0) await this.storage.deleteRecords([...old, ...excess]);
  }

  /** Descifra y verifica la cadena completa (sección 5). */
  private async readAll(): Promise<{
    records: AuditRecordExport[];
    verification: AuditVerification;
  }> {
    const stored = await this.storage.records();
    const key = await this.storage.getKey();
    const records: AuditRecordExport[] = [];
    const verdict = (problem: AuditVerification["problem"]) => ({
      records,
      verification: {
        valid: problem === null,
        problem,
        count: stored.length,
        firstSeq: stored[0]?.seq ?? null,
        lastSeq: stored.at(-1)?.seq ?? null,
        anchor: records[0]?.prevHash ?? null,
      },
    });
    if (stored.length === 0) return verdict(null);
    if (!key) return verdict("decrypt");

    let previous: AuditRecordExport | null = null;
    for (const record of stored) {
      let plain: unknown;
      try {
        plain = await this.decrypt(key, record.iv, record.data, aad(record.seq));
      } catch {
        return verdict("decrypt");
      }
      if (!isPlain(plain)) return verdict("decrypt");
      const current: AuditRecordExport = { seq: record.seq, ...plain };
      if (previous && current.seq !== previous.seq + 1) return verdict("gap");
      if (previous && current.prevHash !== previous.hash) return verdict("hash");
      if ((await chainHash(current.prevHash, current.entry)) !== current.hash)
        return verdict("hash");
      records.push(current);
      previous = current;
    }
    let head: Head | null;
    try {
      head = await this.readHead(key);
    } catch {
      return verdict("head");
    }
    if (!head || !previous || head.lastSeq !== previous.seq || head.lastHash !== previous.hash)
      return verdict("head");
    return verdict(null);
  }

  verify(): Promise<AuditVerification> {
    return this.serialized(async () => (await this.readAll()).verification);
  }

  exportAll(): Promise<AuditExport> {
    return this.serialized(async () => {
      await this.prune();
      const { records, verification } = await this.readAll();
      return {
        format: "credflow-audit/1",
        exportedAt: new Date(this.now()).toISOString(),
        algorithm: HASH_ALGORITHM,
        verification,
        records,
      };
    });
  }

  status(): Promise<AuditStatus> {
    return this.serialized(async () => {
      const records = await this.storage.records();
      const iso = (at: number | undefined) =>
        at === undefined ? null : new Date(at).toISOString();
      return {
        count: records.length,
        oldest: iso(records[0]?.at),
        newest: iso(records.at(-1)?.at),
      };
    });
  }

  clear(): Promise<void> {
    return this.serialized(() => this.storage.clear());
  }
}
