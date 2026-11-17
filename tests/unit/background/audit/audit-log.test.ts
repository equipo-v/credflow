import { describe, expect, it } from "vitest";
import {
  AuditLog,
  MAX_RECORDS,
  RETENTION_MS,
  type AuditStorage,
  type StoredHead,
  type StoredRecord,
} from "../../../../src/background/audit/audit-log";
import { GENESIS_HASH, verifyExport } from "../../../../src/background/audit/chain";
import { buildFingerprints } from "../../../../src/shared/fingerprints";
import type { FlowEvent } from "../../../../src/shared/types";

class MemoryStorage implements AuditStorage {
  key: CryptoKey | null = null;
  head: StoredHead | null = null;
  map = new Map<number, StoredRecord>();
  getKey = () => Promise.resolve(this.key);
  putKey = (key: CryptoKey) => {
    this.key = key;
    return Promise.resolve();
  };
  records = () => Promise.resolve([...this.map.values()].sort((a, b) => a.seq - b.seq));
  putRecord = (r: StoredRecord) => {
    this.map.set(r.seq, r);
    return Promise.resolve();
  };
  deleteRecords = (seqs: number[]) => {
    for (const s of seqs) this.map.delete(s);
    return Promise.resolve();
  };
  getHead = () => Promise.resolve(this.head);
  putHead = (h: StoredHead) => {
    this.head = h;
    return Promise.resolve();
  };
  clear = () => {
    this.map.clear();
    this.head = null;
    this.key = null;
    return Promise.resolve();
  };
}

function event(n: number, verdict: FlowEvent["verdict"] = "third_party"): FlowEvent {
  return {
    id: `e${n}`,
    timestamp: new Date(1_700_000_000_000 + n).toISOString(),
    tabId: 7,
    pageSite: "tienda.lab",
    destinationOrigin: "https://metricas.lab",
    destinationSite: "metricas.lab",
    method: "POST",
    requestType: "ping",
    fieldType: "password",
    encoding: "base64",
    location: "body",
    truncated: false,
    verdict,
    severity: "critical",
    script: "https://tienda.lab/analytics.js",
    evidence: "network",
  };
}

async function logWith(n: number, now = () => 1_700_000_000_000) {
  const storage = new MemoryStorage();
  const log = new AuditLog(storage, now);
  for (let i = 1; i <= n; i++) await log.append(event(i));
  return { storage, log };
}

describe("AuditLog: cadena (CA-A1)", () => {
  it("forma una cadena válida con seq consecutivos y prevHash enlazados", async () => {
    const { log } = await logWith(3);
    const file = await log.exportAll();
    expect(file.verification).toMatchObject({
      valid: true,
      problem: null,
      count: 3,
      firstSeq: 1,
      lastSeq: 3,
    });
    expect(file.records.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(file.records[0]?.prevHash).toBe(GENESIS_HASH);
    expect(file.records[1]?.prevHash).toBe(file.records[0]?.hash);
    expect(file.records[2]?.prevHash).toBe(file.records[1]?.hash);
  });
});

describe("AuditLog: cifrado (CA-A2, CA-A7)", () => {
  it("lo guardado no contiene en claro sitios ni veredicto, y las entradas no llevan tabId ni huellas", async () => {
    const { storage, log } = await logWith(1);
    const stored = [...storage.map.values()];
    const raw = stored.map((r) => new TextDecoder("latin1").decode(r.data)).join("");
    for (const text of ["metricas.lab", "tienda.lab", "third_party", "analytics.js"])
      expect(raw).not.toContain(text);
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual(["at", "data", "iv", "seq"]);

    const json = JSON.stringify(await log.exportAll());
    expect(json).not.toContain("tabId");
    for (const fp of buildFingerprints("Prueba#2026")) expect(json).not.toContain(fp.value);
  });
});

describe("AuditLog: alteraciones (CA-A3, CA-A4)", () => {
  it("un byte alterado o un registro movido de posición → decrypt", async () => {
    const { storage, log } = await logWith(3);
    const record = storage.map.get(2);
    if (!record) throw new Error("falta");
    const bytes = new Uint8Array(record.data.slice(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    storage.map.set(2, { ...record, data: bytes.buffer });
    expect((await log.verify()).problem).toBe("decrypt");

    const other = await logWith(3);
    const r3 = other.storage.map.get(3);
    const r2 = other.storage.map.get(2);
    if (!r2 || !r3) throw new Error("falta");
    other.storage.map.set(2, { ...r3, seq: 2 });
    other.storage.map.set(3, { ...r2, seq: 3 });
    expect((await other.log.verify()).problem).toBe("decrypt");
  });

  it("borrar un registro intermedio → gap; borrar el último → head", async () => {
    const a = await logWith(3);
    a.storage.map.delete(2);
    expect((await a.log.verify()).problem).toBe("gap");
    const b = await logWith(3);
    b.storage.map.delete(3);
    expect(await b.log.verify()).toMatchObject({ valid: false, problem: "head" });
  });
});

describe("AuditLog: retención (CA-A5)", () => {
  it("elimina los de más de 30 días y conserva la cadena con su ancla", async () => {
    let now = 0;
    const storage = new MemoryStorage();
    const log = new AuditLog(storage, () => now);
    await log.append(event(1));
    await log.append(event(2));
    now = RETENTION_MS + 10;
    await log.append(event(3));
    const file = await log.exportAll();
    expect(file.records.map((r) => r.seq)).toEqual([3]);
    expect(file.verification).toMatchObject({ valid: true, firstSeq: 3 });
    expect(file.verification.anchor).not.toBe(GENESIS_HASH);
  });

  it("conserva como máximo 1000 registros", async () => {
    const { log } = await logWith(MAX_RECORDS + 3);
    const status = await log.status();
    expect(status.count).toBe(MAX_RECORDS);
    const file = await log.exportAll();
    expect(file.verification).toMatchObject({ valid: true, firstSeq: 4, lastSeq: MAX_RECORDS + 3 });
  }, 60_000);
});

describe("Exportación verificable (CA-A6)", () => {
  it("incluye algoritmo y verificación; verifyExport la acepta y detecta un veredicto cambiado", async () => {
    const { log } = await logWith(3);
    const file = await log.exportAll();
    expect(file.format).toBe("credflow-audit/1");
    expect(file.algorithm).toContain("SHA-256");
    expect((await verifyExport(file)).valid).toBe(true);
    const tampered = structuredClone(file);
    const target = tampered.records[1];
    if (!target) throw new Error("falta");
    target.entry.verdict = "same_site";
    expect(await verifyExport(tampered)).toMatchObject({ valid: false, problem: "hash" });
  });
});

describe("Clave perdida (CA-A9)", () => {
  it("sin clave y con registros, se borran y la cadena empieza en seq 1", async () => {
    const { storage, log } = await logWith(2);
    storage.key = null;
    expect((await log.verify()).problem).toBe("decrypt");
    await log.append(event(9));
    const file = await log.exportAll();
    expect(file.records.map((r) => r.seq)).toEqual([1]);
    expect(file.records[0]?.prevHash).toBe(GENESIS_HASH);
    expect(file.verification.valid).toBe(true);
  });

  it("borrar el historial deja el contador en 0", async () => {
    const { log } = await logWith(2);
    await log.clear();
    expect((await log.status()).count).toBe(0);
  });
});
