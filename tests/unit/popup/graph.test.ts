import { describe, expect, it } from "vitest";
import {
  buildFlowGraph,
  clipLabel,
  graphAriaLabel,
  layoutGraph,
  MAX_DESTINATIONS,
} from "../../../src/popup/graph";
import { exportFileName, historyLabel } from "../../../src/popup/format";
import type { FlowEvent, Severity, Verdict } from "../../../src/shared/types";
import viewSource from "../../../src/popup/graph-view.ts?raw";

function ev(site: string, verdict: Verdict, severity: Severity): FlowEvent {
  return {
    id: site + verdict,
    timestamp: "2026-11-17T10:00:00.000Z",
    tabId: 1,
    pageSite: "localhost",
    destinationOrigin: `https://${site}`,
    destinationSite: site,
    method: "POST",
    requestType: "ping",
    fieldType: "password",
    encoding: null,
    location: "body",
    truncated: false,
    verdict,
    severity,
    script: null,
    evidence: "network",
  };
}

describe("buildFlowGraph (CA-U18)", () => {
  it("un destino por sitio con su peor nivel y número de envíos, ordenado por gravedad", () => {
    const graph = buildFlowGraph([
      ev("localhost", "same_site", "none"),
      ev("metricas.lab", "opaque_body", "high"),
      ev("metricas.lab", "third_party", "critical"),
      ev("cdn.lab", "site_encrypted", "none"),
    ]);
    expect(graph.center).toBe("localhost");
    expect(graph.destinations).toEqual([
      { site: "metricas.lab", level: "critical", count: 2 },
      { site: "cdn.lab", level: "info", count: 1 },
      { site: "localhost", level: "ok", count: 1 },
    ]);
    expect(graph.hidden).toBe(0);
  });

  it("muestra como máximo 8 destinos y el resto como «+N más»", () => {
    const events = Array.from({ length: 11 }, (_, i) => ev(`s${i}.lab`, "third_party", "critical"));
    const graph = buildFlowGraph(events);
    expect(graph.destinations).toHaveLength(MAX_DESTINATIONS);
    expect(graph.hidden).toBe(3);
    const layout = layoutGraph(graph, 348, 190);
    expect(layout.nodes.at(-1)?.label).toBe("+3 más");
  });
});

describe("layoutGraph (CA-U19)", () => {
  it("centro en el medio, destinos dentro del área y sin superponerse", () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      ev(`destino-${i}.lab`, "third_party", "critical")
    );
    const layout = layoutGraph(buildFlowGraph(events), 348, 190);
    expect(layout.center).toMatchObject({ x: 174, y: 95 });
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(348);
      expect(node.y).toBeGreaterThanOrEqual(15);
      expect(node.y).toBeLessThanOrEqual(175);
    }
    for (const [i, a] of layout.nodes.entries()) {
      for (const b of layout.nodes.slice(i + 1))
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30);
    }
  });

  it("recorta etiquetas de más de 22 caracteres", () => {
    expect(clipLabel("un-dominio-muy-largo-de-prueba.example")).toBe("un-dominio-muy-largo-…");
    expect(clipLabel("corto.lab")).toBe("corto.lab");
    const layout = layoutGraph(
      buildFlowGraph([ev("un-dominio-muy-largo-de-prueba.example", "third_party", "critical")]),
      348,
      190
    );
    expect(layout.nodes[0]?.label).toBe("✗ un-dominio-muy-largo-…");
  });
});

describe("grafo seguro y accesible (CA-U20)", () => {
  it("el dibujo no usa APIs de HTML y el aria-label nombra cada destino con su nivel", () => {
    expect(viewSource).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(viewSource).toContain("createElementNS");
    const label = graphAriaLabel(
      buildFlowGraph([
        ev("127.0.0.1", "third_party", "critical"),
        ev("localhost", "same_site", "none"),
      ])
    );
    expect(label).toBe(
      "Flujos desde localhost: 127.0.0.1, crítica, 1 envío; localhost, normal, 1 envío"
    );
  });
});

describe("textos del historial (sección 5.4)", () => {
  it("resume el historial y nombra el archivo exportado", () => {
    expect(historyLabel({ count: 0, oldest: null })).toBe("Sin eventos guardados.");
    expect(historyLabel({ count: 3, oldest: "2026-11-17T15:00:00.000Z" })).toMatch(
      /^3 eventos guardados desde el \d{2}\/11\/2026 \(se conservan 30 días\)\.$/
    );
    expect(exportFileName(new Date(2026, 10, 7, 9, 5, 3))).toBe(
      "credflow-auditoria-20261107-090503.json"
    );
  });
});
