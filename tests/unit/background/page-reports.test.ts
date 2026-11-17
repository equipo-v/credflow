import { describe, expect, it } from "vitest";
import { AttributionLog, MAX_REPORTS_PER_TAB } from "../../../src/background/page-reports";
import {
  analyzePageReport,
  analyzeRequest,
  type PageContext,
} from "../../../src/background/analyze";
import type { ActiveFingerprint } from "../../../src/background/fingerprint-store";
import { buildFingerprints } from "../../../src/shared/fingerprints";
import type { PageReport } from "../../../src/shared/types";

const URL_M = "https://metricas.lab/collect";
const SCRIPT = "https://tienda.lab/analytics.js";
const PASSWORD = "Prueba#2026";
const FPS: ActiveFingerprint[] = buildFingerprints(PASSWORD).map((fp) => ({
  ...fp,
  fieldType: "password",
}));

describe("AttributionLog (CA-25)", () => {
  it("atribuye un reporte de la misma pestaña y URL recibido hasta 3 s antes", () => {
    const log = new AttributionLog();
    log.addReport(1, URL_M, SCRIPT, 1_000);
    expect(log.scriptFor(1, URL_M, 3_900)).toBe(SCRIPT);
    expect(log.scriptFor(1, URL_M, 4_100)).toBeNull();
    expect(log.scriptFor(2, URL_M, 1_500)).toBeNull();
    expect(log.scriptFor(1, "https://otro.lab/", 1_500)).toBeNull();
  });

  it("completa un evento de red cuando el reporte llega hasta 3 s después", () => {
    const log = new AttributionLog();
    log.awaitReport(1, URL_M, "evento-1", 1_000);
    log.awaitReport(1, URL_M, "evento-2", 1_000);
    expect(log.addReport(1, "https://otro.lab/", SCRIPT, 1_500)).toEqual([]);
    expect(log.addReport(1, URL_M, SCRIPT, 2_000)).toEqual(["evento-1", "evento-2"]);
    // Ya atribuidos: no se repiten.
    expect(log.addReport(1, URL_M, SCRIPT, 2_100)).toEqual([]);
    log.awaitReport(1, URL_M, "evento-3", 10_000);
    expect(log.addReport(1, URL_M, SCRIPT, 13_500)).toEqual([]);
  });

  it("sin reporte el evento queda con script null", () => {
    const event = analyzeRequest(
      {
        tabId: 1,
        url: URL_M,
        method: "POST",
        type: "ping",
        initiator: "https://tienda.lab",
        requestBody: { raw: [{ bytes: new TextEncoder().encode(btoa(PASSWORD)).buffer }] },
      },
      {
        fingerprints: FPS,
        authorizedSites: new Set(),
        lastKnownPageSite: null,
        now: new Date(),
        newId: () => "e",
        scriptFor: (url) => new AttributionLog().scriptFor(1, url, 0),
      }
    );
    expect(event?.script).toBeNull();
  });

  it("caduca a los 10 s y guarda como máximo 50 reportes por pestaña", () => {
    const log = new AttributionLog();
    for (let i = 0; i < MAX_REPORTS_PER_TAB + 10; i++)
      log.addReport(1, `${URL_M}?${i}`, SCRIPT, 1_000);
    expect(log.size(1)).toBe(MAX_REPORTS_PER_TAB);
    log.prune(11_001);
    expect(log.size(1)).toBe(0);
  });

  it("un reporte sin script no se guarda", () => {
    const log = new AttributionLog();
    log.addReport(1, URL_M, null, 1_000);
    expect(log.size(1)).toBe(0);
  });
});

function report(extra: PageReport["extra"], url = URL_M): PageReport {
  return { kind: "PAGE_REPORT", api: "fetch", url, script: SCRIPT, extra };
}

function ctx(overrides: Partial<PageContext> = {}): PageContext {
  return {
    fingerprints: FPS,
    authorizedSites: new Set(),
    pageSite: "tienda.lab",
    now: new Date("2026-11-17T12:00:00Z"),
    newId: () => "p1",
    ...overrides,
  };
}

describe("analyzePageReport (CA-26)", () => {
  it("contraseña en un encabezado hacia otro sitio → third_party con evidencia de página", () => {
    const event = analyzePageReport(
      3,
      report({ location: "header", text: `x-token: ${btoa(PASSWORD)}` }),
      ctx()
    );
    expect(event).toMatchObject({
      verdict: "third_party",
      severity: "critical",
      evidence: "page",
      location: "header",
      encoding: "base64",
      script: SCRIPT,
      destinationSite: "metricas.lab",
      tabId: 3,
    });
  });

  it("Blob y WebSocket usan las ubicaciones body y websocket", () => {
    expect(
      analyzePageReport(1, report({ location: "blob", text: PASSWORD }), ctx())?.location
    ).toBe("body");
    const ws = analyzePageReport(
      1,
      {
        ...report({ location: "websocket", text: `{"p":"${PASSWORD}"}` }, "wss://metricas.lab/ws"),
        api: "websocket",
      },
      ctx()
    );
    expect(ws).toMatchObject({ location: "websocket", verdict: "third_party" });
  });

  it("WebSocket sin cifrar (ws:) hacia un host externo → insecure_channel", () => {
    const event = analyzePageReport(
      1,
      {
        ...report({ location: "websocket", text: PASSWORD }, "ws://metricas.lab/ws"),
        api: "websocket",
      },
      ctx()
    );
    expect(event?.verdict).toBe("insecure_channel");
  });

  it("sin huellas activas, sin extra o sin coincidencia no produce nada", () => {
    expect(
      analyzePageReport(
        1,
        report({ location: "header", text: PASSWORD }),
        ctx({ fingerprints: [] })
      )
    ).toBeNull();
    expect(analyzePageReport(1, report(null), ctx())).toBeNull();
    expect(
      analyzePageReport(1, report({ location: "header", text: "accept: */*" }), ctx())
    ).toBeNull();
  });

  it("el evento no contiene el valor, la huella ni la ruta (regla 1)", () => {
    const event = analyzePageReport(
      1,
      report({ location: "header", text: `x: ${btoa(PASSWORD)}` }),
      ctx()
    );
    const json = JSON.stringify(event);
    for (const fp of FPS) expect(json).not.toContain(fp.value);
    expect(json).not.toContain("/collect");
  });
});
