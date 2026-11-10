import { describe, expect, it } from "vitest";
import { formatTime, rowFor } from "../../../src/popup/format";
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
