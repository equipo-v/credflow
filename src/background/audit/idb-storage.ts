// Almacenamiento del registro de auditoría en IndexedDB (docs/specs/registro-auditoria.md, sección 3).
// Solo guarda registros cifrados, la cabeza cifrada y la clave no exportable: nunca valores ni huellas.
import type { AuditStorage, StoredHead, StoredRecord } from "./audit-log";

const DB_NAME = "credflow-audit";
const RECORDS = "records";
const META = "meta";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("audit"));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(RECORDS, { keyPath: "seq" });
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("audit"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("audit"));
    tx.onabort = () => reject(new Error("audit"));
  });
}

export class IdbAuditStorage implements AuditStorage {
  private db: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    this.db ??= open().catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async meta<T>(key: string): Promise<T | null> {
    const db = await this.database();
    const value: unknown = await request(db.transaction(META).objectStore(META).get(key));
    return (value as T | undefined) ?? null;
  }

  private async putMeta(key: string, value: unknown): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(value, key);
    await done(tx);
  }

  async getKey(): Promise<CryptoKey | null> {
    const key = await this.meta<unknown>("key");
    return key instanceof CryptoKey ? key : null;
  }

  putKey(key: CryptoKey): Promise<void> {
    return this.putMeta("key", key);
  }

  async records(): Promise<StoredRecord[]> {
    const db = await this.database();
    const all: unknown = await request(db.transaction(RECORDS).objectStore(RECORDS).getAll());
    return Array.isArray(all) ? (all as StoredRecord[]) : [];
  }

  async putRecord(record: StoredRecord): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(RECORDS, "readwrite");
    tx.objectStore(RECORDS).put(record);
    await done(tx);
  }

  async deleteRecords(seqs: number[]): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(RECORDS, "readwrite");
    for (const seq of seqs) tx.objectStore(RECORDS).delete(seq);
    await done(tx);
  }

  getHead(): Promise<StoredHead | null> {
    return this.meta<StoredHead>("head");
  }

  putHead(head: StoredHead): Promise<void> {
    return this.putMeta("head", head);
  }

  async clear(): Promise<void> {
    const db = await this.database();
    const tx = db.transaction([RECORDS, META], "readwrite");
    tx.objectStore(RECORDS).clear();
    tx.objectStore(META).clear();
    await done(tx);
  }
}
