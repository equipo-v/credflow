import { describe, expect, it } from "vitest";
import { cleanList, withSite, withoutSite } from "../../../src/popup/trust";

describe("lista de destinos de confianza (CA-U16)", () => {
  it("agrega sin duplicar y descarta valores inválidos", () => {
    expect(withSite(["a.com", 3, "", "a.com"], "b.com")).toEqual(["a.com", "b.com"]);
    expect(withSite(["a.com", "b.com"], "a.com")).toEqual(["b.com", "a.com"]);
    expect(withSite("basura", "a.com")).toEqual(["a.com"]);
  });

  it("respeta el máximo de 100 sitios conservando los más recientes", () => {
    const many = Array.from({ length: 100 }, (_, i) => `s${i}.com`);
    const result = withSite(many, "nuevo.com");
    expect(result).toHaveLength(100);
    expect(result.at(-1)).toBe("nuevo.com");
    expect(result).not.toContain("s0.com");
  });

  it("quita un sitio", () => {
    expect(withoutSite(["a.com", "b.com"], "a.com")).toEqual(["b.com"]);
    expect(cleanList(undefined)).toEqual([]);
  });
});
