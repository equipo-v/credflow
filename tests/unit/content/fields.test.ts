import { describe, expect, it } from "vitest";
import { buildRegisterMessage, fieldTypeOf } from "../../../src/content/fields";
import { parseRegisterFingerprints } from "../../../src/shared/validators";

describe("fieldTypeOf (CA-P1)", () => {
  it("type=password es un campo de contraseña", () => {
    expect(fieldTypeOf({ type: "password", autocomplete: "" })).toBe("password");
    expect(fieldTypeOf({ type: "PASSWORD", autocomplete: "current-password" })).toBe("password");
  });

  it("autocomplete con cc-number o cc-csc es un campo de tarjeta, también entre otros tokens", () => {
    expect(fieldTypeOf({ type: "text", autocomplete: "cc-number" })).toBe("card");
    expect(fieldTypeOf({ type: "tel", autocomplete: "section-pago billing cc-csc" })).toBe("card");
  });

  it("cualquier otro campo no es sensible", () => {
    expect(fieldTypeOf({ type: "text", autocomplete: "" })).toBeNull();
    expect(fieldTypeOf({ type: "email", autocomplete: "username" })).toBeNull();
    expect(fieldTypeOf({ type: "text", autocomplete: "cc-name" })).toBeNull();
    expect(fieldTypeOf({ type: "text", autocomplete: "xcc-number" })).toBeNull();
  });
});

describe("buildRegisterMessage (CA-P2)", () => {
  it("produce exactamente kind, fieldType y fingerprints, aceptado por el validador del Motor", () => {
    const message = buildRegisterMessage("password", "Prueba#2026");
    expect(Object.keys(message ?? {}).sort()).toEqual(["fieldType", "fingerprints", "kind"]);
    expect(parseRegisterFingerprints(message)).toEqual(message);
  });

  it("devuelve null con menos de 6 caracteres", () => {
    expect(buildRegisterMessage("password", "abc12")).toBeNull();
    expect(buildRegisterMessage("password", "")).toBeNull();
  });
});
