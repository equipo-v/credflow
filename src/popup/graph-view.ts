// Dibujo del grafo de flujos (docs/specs/popup-alertas.md, sección 5.3).
// Solo createElementNS y textContent (AGENTS.md, regla 3).
import type { FlowEvent } from "../shared/types";
import { buildFlowGraph, graphAriaLabel, layoutGraph, type PlacedNode } from "./graph";

const SVG = "http://www.w3.org/2000/svg";
const LEVELS = ["critical", "high", "info", "ok", "more"] as const;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function markers(): SVGDefsElement {
  const defs = svg("defs", {});
  for (const level of LEVELS) {
    const marker = svg("marker", {
      id: `arrow-${level}`,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    });
    marker.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: `head ${level}` }));
    defs.append(marker);
  }
  return defs;
}

/** Punto a cierta distancia de "to" sobre la recta, para que la flecha no tape la etiqueta. */
function shorten(from: PlacedNode, to: PlacedNode, by: number): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: to.x - (dx / length) * by, y: to.y - (dy / length) * by };
}

export function renderGraph(container: HTMLElement, events: FlowEvent[]): void {
  container.replaceChildren();
  if (events.length === 0) return;
  const graph = buildFlowGraph(events);
  const layout = layoutGraph(graph, 348, 190);
  const root = svg("svg", {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width: "100%",
    role: "img",
    "aria-label": graphAriaLabel(graph),
    class: "graph",
  });
  root.append(markers());
  const { center } = layout;
  for (const node of layout.nodes) {
    const level = node.level ?? "more";
    const start = shorten(node, center, 22);
    const end = shorten(center, node, 10);
    const edge = svg("line", {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      class: `edge ${level}`,
      "marker-end": `url(#arrow-${level})`,
    });
    edge.append(svg("title", {}, node.label));
    root.append(edge);
  }
  for (const node of layout.nodes) {
    const level = node.level ?? "more";
    root.append(
      svg("circle", { cx: node.x, cy: node.y, r: 5, class: `node ${level}` }),
      svg(
        "text",
        {
          x: node.x,
          y: node.y < center.y ? node.y - 9 : node.y + 16,
          "text-anchor": "middle",
          class: `label ${level}`,
        },
        node.label
      )
    );
  }
  root.append(
    svg("rect", {
      x: center.x - 60,
      y: center.y - 13,
      width: 120,
      height: 26,
      rx: 13,
      class: "center",
    }),
    svg(
      "text",
      { x: center.x, y: center.y + 4, "text-anchor": "middle", class: "center-label" },
      center.label
    )
  );
  container.append(root);
}
