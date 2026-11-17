import { describe, expect, it } from "vitest";
import { parseManagedConfig, parseTrustedSites } from "../../../src/background/managed-config";
import { analyzeRequest } from "../../../src/background/analyze";
import { buildFingerprints } from "../../../src/shared/fingerprints";

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

describe("parseTrustedSites (CA-24)", () => {
  it("ignora URL completas, números y valores que no son listas", () => {
    expect([
      ...parseTrustedSites(["metricas.lab", "https://x.com/a", 42, "", "Sub.Malo.Example"]),
    ]).toEqual(["metricas.lab", "malo.example"]);
    expect(parseTrustedSites("metricas.lab").size).toBe(0);
    expect(parseTrustedSites(undefined).size).toBe(0);
  });

  it("un envío a un destino de confianza produce authorized_provider / none", () => {
    const fingerprints = buildFingerprints("Prueba#2026").map((fp) => ({
      ...fp,
      fieldType: "password" as const,
    }));
    const event = analyzeRequest(
      {
        tabId: 1,
        url: "https://metricas.lab/collect",
        method: "POST",
        type: "ping",
        initiator: "https://tienda.lab",
        requestBody: {
          raw: [{ bytes: new TextEncoder().encode("p=" + btoa("Prueba#2026")).buffer }],
        },
      },
      {
        fingerprints,
        authorizedSites: parseTrustedSites(["metricas.lab"]),
        lastKnownPageSite: null,
        now: new Date(),
        newId: () => "e",
      }
    );
    expect(event).toMatchObject({ verdict: "authorized_provider", severity: "none" });
  });
});
