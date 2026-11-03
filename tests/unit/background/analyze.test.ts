import { describe, expect, it } from "vitest";
import {
  analyzeRequest,
  type AnalysisContext,
  type RequestInfo,
} from "../../../src/background/analyze";
import type { ActiveFingerprint } from "../../../src/background/fingerprint-store";
import { buildFingerprints } from "../../../src/shared/fingerprints";

const PASSWORD = "Prueba#2026";
const FPS: ActiveFingerprint[] = buildFingerprints(PASSWORD).map((fp) => ({
  ...fp,
  fieldType: "password",
}));
const encoder = new TextEncoder();

function ctx(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    fingerprints: FPS,
    authorizedSites: new Set(),
    lastKnownPageSite: null,
    now: new Date("2026-11-03T12:00:00Z"),
    newId: () => "evento-1",
    ...overrides,
  };
}

function raw(text: string): RequestInfo["requestBody"] {
  return { raw: [{ bytes: encoder.encode(text).buffer }] };
}

function req(overrides: Partial<RequestInfo>): RequestInfo {
  return {
    tabId: 3,
    url: "https://tienda.lab/api/login",
    method: "POST",
    type: "xmlhttprequest",
    initiator: "https://tienda.lab",
    ...overrides,
  };
}

describe("analyzeRequest: clasificación", () => {
  // CA-5
  it("contraseña en Base64 dentro de JSON hacia otro sitio → third_party / critical", () => {
    const event = analyzeRequest(
      req({
        url: "https://metrics.lab/collect",
        requestBody: raw(JSON.stringify({ c: btoa(PASSWORD) })),
      }),
      ctx()
    );
    expect(event).toMatchObject({
      verdict: "third_party",
      severity: "critical",
      encoding: "base64",
      location: "body",
      destinationSite: "metrics.lab",
      pageSite: "tienda.lab",
    });
  });

  // CA-6
  it("formulario por http: al mismo sitio → insecure_channel / critical", () => {
    const event = analyzeRequest(
      req({
        url: "http://tienda.lab/login",
        type: "main_frame",
        initiator: "http://tienda.lab",
        requestBody: { formData: { usuario: ["ana"], clave: [PASSWORD] } },
      }),
      ctx()
    );
    expect(event).toMatchObject({
      verdict: "insecure_channel",
      severity: "critical",
      location: "body",
    });
  });

  // CA-7
  it("contraseña en la consulta de una URL del mismo sitio → credential_in_url / high", () => {
    const event = analyzeRequest(
      req({ url: `https://tienda.lab/login?clave=${encodeURIComponent(PASSWORD)}`, method: "GET" }),
      ctx()
    );
    expect(event).toMatchObject({
      verdict: "credential_in_url",
      severity: "high",
      location: "url",
    });
  });

  // CA-8
  it("envío a un proveedor autorizado → authorized_provider / none", () => {
    const event = analyzeRequest(
      req({ url: "https://accounts.google.com/signin", requestBody: raw(`password=${PASSWORD}`) }),
      ctx({ authorizedSites: new Set(["google.com"]) })
    );
    expect(event).toMatchObject({ verdict: "authorized_provider", severity: "none" });
  });

  // CA-9
  it("envío al mismo sitio por HTTPS en el cuerpo → same_site / none", () => {
    const event = analyzeRequest(req({ requestBody: raw(`clave=${PASSWORD}`) }), ctx());
    expect(event).toMatchObject({ verdict: "same_site", severity: "none", location: "body" });
  });

  // CA-10
  it("subdominios del mismo dominio registrable son el mismo sitio", () => {
    const event = analyzeRequest(
      req({
        url: "https://api.example.co.uk/login",
        initiator: "https://tienda.example.co.uk",
        requestBody: raw(PASSWORD),
      }),
      ctx()
    );
    expect(event).toMatchObject({ verdict: "same_site", pageSite: "example.co.uk" });
  });

  it("prioriza el cuerpo sobre la URL", () => {
    const event = analyzeRequest(
      req({ url: `https://tienda.lab/x?c=${PASSWORD}`, requestBody: raw(PASSWORD) }),
      ctx()
    );
    expect(event?.location).toBe("body");
  });

  it("detecta las cinco codificaciones, hex sin distinguir mayúsculas", () => {
    const hex = Array.from(encoder.encode(PASSWORD), (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    const bodies: Array<[string, string]> = [
      [PASSWORD, "original"],
      [btoa(PASSWORD), "base64"],
      [`x=${encodeURIComponent(PASSWORD)}`, "url"],
      [hex.toUpperCase(), "hex"],
      [[...PASSWORD].reverse().join(""), "reversed"],
    ];
    for (const [body, encoding] of bodies) {
      const event = analyzeRequest(
        req({ url: "https://metrics.lab/c", requestBody: raw(body) }),
        ctx()
      );
      expect(event?.encoding).toBe(encoding);
    }
  });

  it("usa el último sitio conocido de la pestaña si no hay initiator", () => {
    const event = analyzeRequest(
      req({ initiator: undefined, url: "https://metrics.lab/c", requestBody: raw(PASSWORD) }),
      ctx({ lastKnownPageSite: "tienda.lab" })
    );
    expect(event).toMatchObject({ pageSite: "tienda.lab", verdict: "third_party" });
  });

  it("no reporta nada si no aparece ninguna huella", () => {
    expect(
      analyzeRequest(req({ url: "https://metrics.lab/c", requestBody: raw("hola") }), ctx())
    ).toBeNull();
  });

  it("no reporta nada sin huellas activas", () => {
    const event = analyzeRequest(
      req({ url: "https://metrics.lab/c", requestBody: raw(PASSWORD) }),
      ctx({ fingerprints: [] })
    );
    expect(event).toBeNull();
  });
});

describe("analyzeRequest: protección de datos (CA-11)", () => {
  it("ningún evento contiene el valor, una huella, la ruta ni la consulta", () => {
    const requests = [
      req({ url: `https://metrics.lab/ruta/secreta?c=${encodeURIComponent(PASSWORD)}` }),
      req({ url: "https://metrics.lab/ruta/secreta", requestBody: raw(btoa(PASSWORD)) }),
      req({ url: "http://tienda.lab/ruta/secreta", requestBody: { formData: { c: [PASSWORD] } } }),
      req({ url: "https://metrics.lab/ruta/secreta", requestBody: { error: "Unknown error." } }),
    ];
    for (const request of requests) {
      const event = analyzeRequest(request, ctx());
      expect(event).not.toBeNull();
      const serialized = JSON.stringify(event);
      for (const fp of FPS) expect(serialized).not.toContain(fp.value);
      expect(serialized).not.toContain("ruta");
      expect(serialized).not.toContain("secreta");
      expect(event?.destinationOrigin).toMatch(/^https?:\/\/[a-z0-9.]+$/);
    }
  });
});

describe("analyzeRequest: cuerpos grandes y opacos", () => {
  // CA-12
  it("un cuerpo de 1 MB se analiza solo en sus primeros 256 KB y marca truncated", () => {
    const big = "a".repeat(1024 * 1024 - PASSWORD.length) + PASSWORD;
    const late = analyzeRequest(
      req({ url: "https://metrics.lab/c", requestBody: raw(big) }),
      ctx()
    );
    expect(late).toBeNull(); // la contraseña está después de los 256 KB

    const early = PASSWORD + "a".repeat(1024 * 1024);
    const event = analyzeRequest(
      req({ url: "https://metrics.lab/c", requestBody: raw(early) }),
      ctx()
    );
    expect(event).toMatchObject({ verdict: "third_party", truncated: true });
  });

  // CA-14
  it("cuerpo opaco hacia un tercero no autorizado → opaque_body / high con encoding null", () => {
    const event = analyzeRequest(
      req({ url: "https://metrics.lab/c", requestBody: { error: "Unknown error." } }),
      ctx()
    );
    expect(event).toMatchObject({
      verdict: "opaque_body",
      severity: "high",
      encoding: null,
      location: "body",
    });
  });

  it("una parte raw con file en lugar de bytes cuenta como cuerpo opaco", () => {
    const event = analyzeRequest(
      req({
        url: "https://metrics.lab/c",
        requestBody: { raw: [{ bytes: encoder.encode("--x\r\n").buffer }, { file: "x.txt" }] },
      }),
      ctx()
    );
    expect(event?.verdict).toBe("opaque_body");
  });

  it("cuerpo opaco con la contraseña en la URL → se reporta la coincidencia de la URL", () => {
    const event = analyzeRequest(
      req({ url: `https://metrics.lab/c?k=${PASSWORD}`, requestBody: { error: "Unknown error." } }),
      ctx()
    );
    expect(event).toMatchObject({ verdict: "third_party", location: "url" });
  });

  it("cuerpo opaco por http: → insecure_channel / critical", () => {
    const event = analyzeRequest(
      req({ url: "http://metrics.lab/c", requestBody: { error: "Unknown error." } }),
      ctx()
    );
    expect(event).toMatchObject({
      verdict: "insecure_channel",
      severity: "critical",
      encoding: null,
    });
  });

  // CA-15
  it("cuerpo opaco al mismo sitio → sin evento", () => {
    expect(analyzeRequest(req({ requestBody: { error: "Unknown error." } }), ctx())).toBeNull();
  });

  it("cuerpo opaco a un proveedor autorizado → sin evento", () => {
    const event = analyzeRequest(
      req({ url: "https://accounts.google.com/x", requestBody: { error: "Unknown error." } }),
      ctx({ authorizedSites: new Set(["google.com"]) })
    );
    expect(event).toBeNull();
  });

  // CA-16
  it("cuerpo opaco sin huellas activas → sin evento", () => {
    const event = analyzeRequest(
      req({ url: "https://metrics.lab/c", requestBody: { error: "Unknown error." } }),
      ctx({ fingerprints: [] })
    );
    expect(event).toBeNull();
  });
});
