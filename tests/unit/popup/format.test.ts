import { describe, expect, it } from "vitest";
import {
  canTrust,
  evidenceLabel,
  formatTime,
  rowFor,
  scriptLabel,
  watchedRowFor,
} from "../../../src/popup/format";
import type { FlowEvent, Severity, Verdict } from "../../../src/shared/types";
import html from "../../../src/popup/popup.html?raw";

function event(verdict: Verdict, severity: Severity): FlowEvent {
  return {
    id: "e1",
    timestamp: "2026-11-09T15:04:05.000Z",
    tabId: 1,
    pageSite: "localhost",
    destinationOrigin: "http://127.0.0.1:8124",
    destinationSite: "127.0.0.1",
    method: "POST",
    requestType: "ping",
    fieldType: "password",
    encoding: "base64",
    location: "body",
    truncated: false,
    script: null,
    evidence: "network",
    verdict,
    severity,
  };
}

describe("rowFor (CA-U5)", () => {
  it("usa los textos de la especificación para cada veredicto", () => {
    const cases: Array<[Verdict, Severity, string, string]> = [
      ["third_party", "critical", "Enviada a un tercero no autorizado", "✗ crítica"],
      ["insecure_channel", "critical", "Enviada por un canal sin cifrar", "✗ crítica"],
      ["opaque_body", "high", "Envío no inspeccionable a un tercero", "! alta"],
      ["credential_in_url", "high", "Credencial en la URL", "! alta"],
      ["authorized_provider", "none", "Enviada a un proveedor autorizado", "✓ normal"],
      ["same_site", "none", "Enviada al mismo sitio", "✓ normal"],
    ];
    for (const [verdict, severity, text, label] of cases) {
      const row = rowFor(event(verdict, severity));
      expect(row.verdict).toBe(text);
      expect(row.severityLabel).toBe(label);
    }
  });

  it("muestra el tipo de campo y el origen, nunca otros datos", () => {
    const row = rowFor(event("third_party", "critical"));
    expect(row.field).toBe("Contraseña");
    expect(row.destination).toBe("http://127.0.0.1:8124");
    expect(Object.keys(row).sort()).toEqual([
      "destination",
      "field",
      "note",
      "severity",
      "severityLabel",
      "time",
      "verdict",
    ]);
  });

  it("formatea la hora y tolera marcas inválidas", () => {
    expect(formatTime("2026-11-09T15:04:05.000Z")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatTime("no es una fecha")).toBe("--:--:--");
  });
});

describe("popup.html (CA-U7)", () => {
  it("no carga scripts ni estilos de otro origen", () => {
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref.startsWith("./")).toBe(true);
  });
});

describe("popup.html: sección Cómo probar CredFlow (CA-U10)", () => {
  it("incluye el mínimo de 6 caracteres y cómo habilitar file://", () => {
    const text = html.replace(/\s+/g, " ");
    expect(text).toContain("Cómo probar CredFlow");
    expect(text).toContain("al menos 6 caracteres");
    expect(text).toContain("Permitir el acceso a las URL del archivo");
  });
});

describe("rowFor: contraseñas cifradas por la página (CA-U12)", () => {
  it("site_encrypted es informativo (azul) y explica que no se ve el contenido", () => {
    const row = rowFor(event("site_encrypted", "none"));
    expect(row).toMatchObject({
      verdict: "La página cifra la contraseña antes de enviarla",
      note: "CredFlow no puede ver su contenido",
      severity: "info",
      severityLabel: "ℹ informativo",
    });
  });

  it("encrypted_third_party es alta (ámbar)", () => {
    const row = rowFor(event("encrypted_third_party", "high"));
    expect(row).toMatchObject({
      verdict: "Contraseña cifrada enviada a un tercero",
      severity: "high",
      severityLabel: "! alta",
    });
  });

  it("la tarjeta de campo vigilado dice qué se ingresó y dónde", () => {
    const row = watchedRowFor({
      fieldType: "password",
      site: "facebook.com",
      since: "2026-11-16T10:00:00Z",
    });
    expect(row).toMatchObject({
      title: "Contraseña ingresada en este sitio",
      note: "CredFlow vigila a dónde se envía",
      site: "facebook.com",
    });
    expect(watchedRowFor({ fieldType: "card", site: "x.com", since: "" }).title).toBe(
      "Datos de tarjeta ingresados en este sitio"
    );
  });
});

describe("canTrust (CA-U16)", () => {
  it("ofrece «Confiar en…» solo para tercero, opaco y cifrado a tercero", () => {
    expect(canTrust(event("third_party", "critical"))).toBe(true);
    expect(canTrust(event("opaque_body", "high"))).toBe(true);
    expect(canTrust(event("encrypted_third_party", "high"))).toBe(true);
    for (const v of [
      "insecure_channel",
      "credential_in_url",
      "same_site",
      "authorized_provider",
      "site_encrypted",
    ] as const) {
      expect(canTrust(event(v, "critical"))).toBe(false);
    }
  });
});

describe("scriptLabel y evidenceLabel (CA-U15)", () => {
  it("muestra el archivo y el origen del script, sin consulta", () => {
    expect(scriptLabel("https://cdn.malo.example/js/analytics.js")).toBe(
      "Script: analytics.js (https://cdn.malo.example)"
    );
    expect(scriptLabel("http://localhost:8124/")).toBe(
      "Script: (código en la página) (http://localhost:8124)"
    );
  });

  it("no muestra nada sin script o con un valor inválido", () => {
    expect(scriptLabel(null)).toBe("");
    expect(scriptLabel("no es una url")).toBe("");
  });

  it("indica la evidencia de página y su ubicación", () => {
    expect(evidenceLabel(event("third_party", "critical"))).toBe("");
    expect(
      evidenceLabel({ ...event("third_party", "critical"), evidence: "page", location: "header" })
    ).toBe("Detectado en la página (encabezado)");
    expect(
      evidenceLabel({
        ...event("third_party", "critical"),
        evidence: "page",
        location: "websocket",
      })
    ).toBe("Detectado en la página (WebSocket)");
  });
});
