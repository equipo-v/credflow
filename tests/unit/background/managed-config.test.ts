import { describe, expect, it } from "vitest";
import { parseManagedConfig } from "../../../src/background/managed-config";

describe("parseManagedConfig", () => {
  it("sin configuración, la lista queda vacía", () => {
    expect(parseManagedConfig(undefined).authorizedSites.size).toBe(0);
    expect(parseManagedConfig({}).authorizedSites.size).toBe(0);
    expect(
      parseManagedConfig({ authorizedProviders: "accounts.google.com" }).authorizedSites.size
    ).toBe(0);
  });

  it("normaliza cada proveedor a su dominio registrable", () => {
    const { authorizedSites } = parseManagedConfig({
      authorizedProviders: ["accounts.google.com", " LOGIN.Microsoftonline.com "],
    });
    expect([...authorizedSites].sort()).toEqual(["google.com", "microsoftonline.com"]);
  });

  it("ignora entradas que no son nombres de host válidos", () => {
    const { authorizedSites } = parseManagedConfig({
      authorizedProviders: ["https://evil.com/path", 42, "", "a..b", "ok.example.org"],
    });
    expect([...authorizedSites]).toEqual(["example.org"]);
  });
});
