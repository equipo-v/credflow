import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FingerprintStore } from "../../../src/background/fingerprint-store";
import type { RegisterFingerprints } from "../../../src/shared/types";

const message = (
  fieldType: RegisterFingerprints["fieldType"],
  value: string
): RegisterFingerprints => ({
  kind: "REGISTER_FINGERPRINTS",
  fieldType,
  fingerprints: [{ encoding: "original", value }],
});

describe("FingerprintStore", () => {
  it("devuelve las huellas vigentes de la pestaña", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), 0);
    expect(store.active(1, 1_000)).toEqual([
      { encoding: "original", value: "Prueba#2026", fieldType: "password" },
    ]);
    expect(store.active(2, 1_000)).toEqual([]);
  });

  // CA-3
  it("una huella registrada hace más de 30 s no está activa", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), 0);
    expect(store.active(1, 29_999)).toHaveLength(1);
    expect(store.active(1, 30_000)).toEqual([]);
    expect(store.active(1, 31_000)).toEqual([]);
  });

  // CA-4
  it("al cerrar la pestaña se eliminan sus huellas", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), 0);
    store.register(2, message("password", "OtraClave99"), 0);
    store.clearTab(1);
    expect(store.active(1, 1)).toEqual([]);
    expect(store.active(2, 1)).toHaveLength(1);
  });

  it("un registro nuevo del mismo campo reemplaza al anterior y renueva la caducidad", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), 0);
    store.register(1, message("password", "Nueva#2027"), 20_000);
    expect(store.active(1, 40_000)).toEqual([
      { encoding: "original", value: "Nueva#2027", fieldType: "password" },
    ]);
  });

  it("mantiene por separado campos de distinto tipo", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), 0);
    store.register(1, message("card", "4111111111111111"), 0);
    expect(
      store
        .active(1, 1)
        .map((fp) => fp.fieldType)
        .sort()
    ).toEqual(["card", "password"]);
  });

  it("no comparte referencias con el mensaje recibido", () => {
    const store = new FingerprintStore();
    const msg = message("password", "Prueba#2026");
    store.register(1, msg, 0);
    msg.fingerprints[0]!.value = "modificada";
    expect(store.active(1, 1)[0]?.value).toBe("Prueba#2026");
  });
});

describe("FingerprintStore: eliminación por temporizador", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // CA-18
  it("elimina el registro a los 30 s aunque no llegue ninguna petición", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), Date.now());
    expect(store.tabCount).toBe(1);
    vi.advanceTimersByTime(29_999);
    expect(store.tabCount).toBe(1);
    vi.advanceTimersByTime(1);
    expect(store.tabCount).toBe(0);
  });

  it("el temporizador de un registro reemplazado no borra el registro nuevo", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), Date.now());
    vi.advanceTimersByTime(20_000);
    store.register(1, message("password", "Nueva#2027"), Date.now());
    vi.advanceTimersByTime(10_000); // vence el plazo del primero
    expect(store.active(1, Date.now())).toHaveLength(1);
    vi.advanceTimersByTime(20_000); // vence el plazo del segundo
    expect(store.tabCount).toBe(0);
  });

  it("cerrar la pestaña cancela sus temporizadores", () => {
    const store = new FingerprintStore();
    store.register(1, message("password", "Prueba#2026"), Date.now());
    store.clearTab(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
