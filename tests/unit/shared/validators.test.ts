import { describe, expect, it } from "vitest";
import {
  isExtensionPageSender,
  parseGetTabEvents,
  parseRegisterFingerprints,
  trustedSenderTabId,
} from "../../../src/shared/validators";

const valid = {
  kind: "REGISTER_FINGERPRINTS",
  fieldType: "password",
  fingerprints: [
    { encoding: "original", value: "Prueba#2026" },
    { encoding: "base64", value: "UHJ1ZWJhIzIwMjY=" },
  ],
};

describe("parseRegisterFingerprints", () => {
  it("acepta un mensaje válido", () => {
    expect(parseRegisterFingerprints(valid)).toEqual(valid);
  });

  // CA-1
  it("descarta un mensaje con un campo adicional", () => {
    expect(parseRegisterFingerprints({ ...valid, tabId: 7 })).toBeNull();
  });

  it("descarta una huella con un campo adicional", () => {
    const msg = { ...valid, fingerprints: [{ encoding: "original", value: "Prueba#2026", x: 1 }] };
    expect(parseRegisterFingerprints(msg)).toBeNull();
  });

  it("descarta un encoding repetido", () => {
    const msg = {
      ...valid,
      fingerprints: [
        { encoding: "original", value: "Prueba#2026" },
        { encoding: "original", value: "OtraClave99" },
      ],
    };
    expect(parseRegisterFingerprints(msg)).toBeNull();
  });

  it("descarta 6 huellas", () => {
    const encodings = ["original", "base64", "url", "hex", "reversed", "original"];
    const msg = {
      ...valid,
      fingerprints: encodings.map((encoding) => ({ encoding, value: "abcdef" })),
    };
    expect(parseRegisterFingerprints(msg)).toBeNull();
  });

  it("descarta un value de 5 caracteres", () => {
    const msg = { ...valid, fingerprints: [{ encoding: "original", value: "abcde" }] };
    expect(parseRegisterFingerprints(msg)).toBeNull();
  });

  it("descarta un value de más de 1024 caracteres", () => {
    const msg = { ...valid, fingerprints: [{ encoding: "original", value: "a".repeat(1025) }] };
    expect(parseRegisterFingerprints(msg)).toBeNull();
  });

  it("descarta una lista de huellas vacía", () => {
    expect(parseRegisterFingerprints({ ...valid, fingerprints: [] })).toBeNull();
  });

  it("descarta kind, fieldType o encoding desconocidos", () => {
    expect(parseRegisterFingerprints({ ...valid, kind: "OTHER" })).toBeNull();
    expect(parseRegisterFingerprints({ ...valid, fieldType: "email" })).toBeNull();
    const msg = { ...valid, fingerprints: [{ encoding: "rot13", value: "abcdef" }] };
    expect(parseRegisterFingerprints(msg)).toBeNull();
  });

  it("descarta tipos incorrectos y valores que no son objetos simples", () => {
    expect(parseRegisterFingerprints(null)).toBeNull();
    expect(parseRegisterFingerprints("REGISTER_FINGERPRINTS")).toBeNull();
    expect(parseRegisterFingerprints([valid])).toBeNull();
    expect(parseRegisterFingerprints(new Map(Object.entries(valid)))).toBeNull();
    const msg = { ...valid, fingerprints: [{ encoding: "original", value: 123456 }] };
    expect(parseRegisterFingerprints(msg)).toBeNull();
  });

  it("no se deja engañar por un prototipo con propiedades heredadas", () => {
    const inherited = Object.create({ kind: "REGISTER_FINGERPRINTS" }) as Record<string, unknown>;
    inherited.fieldType = "password";
    inherited.fingerprints = valid.fingerprints;
    expect(parseRegisterFingerprints(inherited)).toBeNull();
  });

  it("devuelve copias, no las referencias recibidas", () => {
    const result = parseRegisterFingerprints(valid);
    expect(result).not.toBe(valid);
    expect(result?.fingerprints).not.toBe(valid.fingerprints);
  });
});

describe("trustedSenderTabId", () => {
  const EXT = "abcdefghijklmnopabcdefghijklmnop";

  it("devuelve el tabId del remitente de la propia extensión", () => {
    expect(trustedSenderTabId({ id: EXT, tab: { id: 12 } }, EXT)).toBe(12);
  });

  // CA-2
  it("rechaza un remitente que no es la extensión", () => {
    expect(trustedSenderTabId({ id: "otra-extension", tab: { id: 12 } }, EXT)).toBeNull();
    expect(trustedSenderTabId({ tab: { id: 12 } }, EXT)).toBeNull();
  });

  it("rechaza remitentes sin pestaña o con tabId inválido", () => {
    expect(trustedSenderTabId({ id: EXT }, EXT)).toBeNull();
    expect(trustedSenderTabId({ id: EXT, tab: {} }, EXT)).toBeNull();
    expect(trustedSenderTabId({ id: EXT, tab: { id: -1 } }, EXT)).toBeNull();
    expect(trustedSenderTabId({ id: EXT, tab: { id: 1.5 } }, EXT)).toBeNull();
  });
});

describe("parseGetTabEvents (CA-U3)", () => {
  it("acepta exactamente kind y tabId", () => {
    expect(parseGetTabEvents({ kind: "GET_TAB_EVENTS", tabId: 4 })).toEqual({
      kind: "GET_TAB_EVENTS",
      tabId: 4,
    });
  });

  it("rechaza campos adicionales y tabId negativos o no enteros", () => {
    expect(parseGetTabEvents({ kind: "GET_TAB_EVENTS", tabId: 4, all: true })).toBeNull();
    expect(parseGetTabEvents({ kind: "GET_TAB_EVENTS", tabId: -1 })).toBeNull();
    expect(parseGetTabEvents({ kind: "GET_TAB_EVENTS", tabId: 1.5 })).toBeNull();
    expect(parseGetTabEvents({ kind: "GET_TAB_EVENTS", tabId: "4" })).toBeNull();
    expect(parseGetTabEvents({ kind: "REGISTER_FINGERPRINTS", tabId: 4 })).toBeNull();
  });
});

describe("isExtensionPageSender (CA-U4)", () => {
  const EXT = "abcdefghijklmnopabcdefghijklmnop";
  const popupUrl = `chrome-extension://${EXT}/src/popup/popup.html`;

  it("acepta el popup de la propia extensión, también abierto en una pestaña", () => {
    expect(isExtensionPageSender({ id: EXT, url: popupUrl }, EXT)).toBe(true);
    expect(isExtensionPageSender({ id: EXT, url: popupUrl, tab: { id: 3 } }, EXT)).toBe(true);
  });

  it("rechaza content scripts, otras extensiones y URLs ajenas", () => {
    // Un content script envía con la URL de la página web en la que corre.
    expect(
      isExtensionPageSender({ id: EXT, url: "https://tienda.lab/", tab: { id: 3 } }, EXT)
    ).toBe(false);
    expect(isExtensionPageSender({ id: "otra", url: popupUrl }, EXT)).toBe(false);
    expect(isExtensionPageSender({ id: EXT, url: "https://evil.com/" }, EXT)).toBe(false);
    expect(isExtensionPageSender({ id: EXT, url: `chrome-extension://${EXT}.evil/x` }, EXT)).toBe(
      false
    );
    expect(isExtensionPageSender({ id: EXT }, EXT)).toBe(false);
  });
});
