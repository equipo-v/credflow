import { describe, expect, it } from "vitest";
import {
  analyzeRequest,
  type AnalysisContext,
  type RequestInfo,
} from "../../../src/background/analyze";
import { bodyFields, hasEncryptedPassword } from "../../../src/background/encrypted-field";
import type { ActiveFingerprint } from "../../../src/background/fingerprint-store";
import { buildFingerprints } from "../../../src/shared/fingerprints";

const PASSWORD = "Prueba#2026";
const FPS: ActiveFingerprint[] = buildFingerprints(PASSWORD).map((fp) => ({
  ...fp,
  fieldType: "password",
}));
const HEX64 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const FB = "#PWD_BROWSER:5:1731750000:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdEfGh==";
const encoder = new TextEncoder();

const ctx = (): AnalysisContext => ({
  fingerprints: FPS,
  authorizedSites: new Set(),
  lastKnownPageSite: null,
  now: new Date("2026-11-16T12:00:00Z"),
  newId: () => "e1",
});
const raw = (text: string): RequestInfo["requestBody"] => ({
  raw: [{ bytes: encoder.encode(text).buffer }],
});
const req = (url: string, requestBody: RequestInfo["requestBody"]): RequestInfo => ({
  tabId: 1,
  url,
  method: "POST",
  type: "main_frame",
  initiator: "https://www.facebook.com",
  requestBody,
});

describe("bodyFields", () => {
  it("lee formData, formularios codificados y JSON anidado hasta 3 niveles", () => {
    expect(bodyFields({ formData: { email: ["a@b.c"], encpass: [FB] } }, "")).toEqual([
      ["email", "a@b.c"],
      ["encpass", FB],
    ]);
    expect(bodyFields(undefined, "email=a%40b.c&pass=xyz")).toEqual([
      ["email", "a@b.c"],
      ["pass", "xyz"],
    ]);
    expect(
      bodyFields(undefined, JSON.stringify({ login: { user: "ana", password: HEX64 } }))
    ).toEqual([
      ["user", "ana"],
      ["password", HEX64],
    ]);
    expect(bodyFields(undefined, "texto libre sin formato")).toEqual([]);
  });
});

describe("hasEncryptedPassword", () => {
  it("reconoce los formatos de Facebook e Instagram en cualquier campo", () => {
    expect(hasEncryptedPassword([["encpass", FB]])).toBe(true);
    expect(
      hasEncryptedPassword([["enc_password", "#PWD_INSTAGRAM_BROWSER:10:1731750000:AbC="]])
    ).toBe(true);
  });

  it("reconoce por heurística un campo de contraseña con valor largo en Base64, hex o hash con prefijo", () => {
    expect(hasEncryptedPassword([["password", HEX64]])).toBe(true);
    expect(hasEncryptedPassword([["clave_cifrada", btoa("x".repeat(40))]])).toBe(true);
    expect(hasEncryptedPassword([["pwd", "$2b$12$" + "a".repeat(53)]])).toBe(true);
  });

  it("no se activa con valores cortos, con texto normal ni con campos que no son de contraseña (CA-22)", () => {
    expect(hasEncryptedPassword([["password", "abc"]])).toBe(false);
    expect(
      hasEncryptedPassword([["password", "una frase con espacios que es bastante larga"]])
    ).toBe(false);
    expect(hasEncryptedPassword([["token", HEX64]])).toBe(false);
    expect(hasEncryptedPassword([["csrf", FB.slice(1)]])).toBe(false);
  });
});

describe("analyzeRequest: contraseña cifrada por la página (CA-21 a CA-23)", () => {
  it("formulario al mismo sitio con encpass → site_encrypted, sin severidad", () => {
    const event = analyzeRequest(
      req("https://www.facebook.com/login/device-based/regular/login/", {
        formData: { email: ["ana"], encpass: [FB] },
      }),
      ctx()
    );
    expect(event).toMatchObject({
      verdict: "site_encrypted",
      severity: "none",
      encoding: null,
      location: "body",
    });
  });

  it("el mismo cuerpo hacia un tercero → encrypted_third_party, alta", () => {
    const event = analyzeRequest(
      req("https://colector.evil/x", { formData: { encpass: [FB] } }),
      ctx()
    );
    expect(event).toMatchObject({ verdict: "encrypted_third_party", severity: "high" });
  });

  it("JSON con password en hexadecimal → site_encrypted", () => {
    const event = analyzeRequest(
      req("https://www.facebook.com/api", raw(JSON.stringify({ login: { password: HEX64 } }))),
      ctx()
    );
    expect(event?.verdict).toBe("site_encrypted");
  });

  it("si la contraseña aparece en claro, gana la coincidencia de huellas", () => {
    const event = analyzeRequest(
      req("https://www.facebook.com/api", { formData: { pass: [PASSWORD], encpass: [FB] } }),
      ctx()
    );
    expect(event?.verdict).toBe("same_site");
  });

  it("sin huellas activas no se reporta nada", () => {
    const event = analyzeRequest(
      req("https://www.facebook.com/api", { formData: { encpass: [FB] } }),
      {
        ...ctx(),
        fingerprints: [],
      }
    );
    expect(event).toBeNull();
  });

  it("el evento no contiene el nombre ni el valor del campo detectado (CA-23)", () => {
    const event = analyzeRequest(
      req("https://www.facebook.com/login", { formData: { encpass: [FB], password: [HEX64] } }),
      ctx()
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("encpass");
    expect(serialized).not.toContain(FB.slice(14, 40));
    expect(serialized).not.toContain(HEX64);
  });
});
