import { describe, expect, it } from "vitest";
import { buildFingerprints } from "../../../src/shared/fingerprints";
import { parseRegisterFingerprints } from "../../../src/shared/validators";

describe("buildFingerprints", () => {
  it("genera las cinco codificaciones de una contraseña", () => {
    const result = buildFingerprints("Prueba#2026");
    expect(result).toEqual([
      { encoding: "original", value: "Prueba#2026" },
      { encoding: "base64", value: btoa("Prueba#2026") },
      { encoding: "url", value: "Prueba%232026" },
      { encoding: "hex", value: "5072756562612332303236" },
      { encoding: "reversed", value: "6202#abeurP" },
    ]);
  });

  it("no genera huellas para valores de menos de 6 caracteres", () => {
    expect(buildFingerprints("abcde")).toEqual([]);
  });

  it("omite la codificación URL cuando es idéntica al original", () => {
    const encodings = buildFingerprints("abcdef123").map((fp) => fp.encoding);
    expect(encodings).not.toContain("url");
    expect(encodings).toContain("original");
  });

  it("omite la versión invertida de un palíndromo", () => {
    const encodings = buildFingerprints("abccba").map((fp) => fp.encoding);
    expect(encodings).not.toContain("reversed");
  });

  it("omite las huellas que superan 1024 caracteres", () => {
    const encodings = buildFingerprints("a".repeat(600)).map((fp) => fp.encoding);
    expect(encodings).not.toContain("hex"); // 1200 caracteres
    expect(encodings).toContain("original");
  });

  it("codifica en Base64 los bytes UTF-8 de valores no ASCII", () => {
    const base64 = buildFingerprints("contraseña1").find((fp) => fp.encoding === "base64");
    expect(base64?.value).toBe("Y29udHJhc2XDsWEx"); // Base64 de los bytes UTF-8, no de "ñ" como un byte
  });

  it("invierte por puntos de código sin romper caracteres fuera del BMP", () => {
    const reversed = buildFingerprints("ab🔑cdef").find((fp) => fp.encoding === "reversed");
    expect(reversed?.value).toBe("fedc🔑ba");
  });

  it("produce mensajes que el validador del Motor acepta", () => {
    for (const value of ["Prueba#2026", "a".repeat(600), "contraseña1", "ab🔑cdef"]) {
      const msg = {
        kind: "REGISTER_FINGERPRINTS",
        fieldType: "password",
        fingerprints: buildFingerprints(value),
      };
      expect(parseRegisterFingerprints(msg)).not.toBeNull();
    }
  });
});
