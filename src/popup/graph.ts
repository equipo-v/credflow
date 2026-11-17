// Grafo de flujos del popup (docs/specs/popup-alertas.md, sección 5.3). Lógica pura: agrupa y calcula posiciones.
import type { FlowEvent } from "../shared/types";
import { rowFor, type SeverityLevel } from "./format";

export const MAX_DESTINATIONS = 8;
export const MAX_LABEL = 22;

const RANK: Record<SeverityLevel, number> = { critical: 3, high: 2, info: 1, ok: 0 };
export const LEVEL_SYMBOL: Record<SeverityLevel, string> = {
  critical: "✗",
  high: "!",
  info: "ℹ",
  ok: "✓",
};
export const LEVEL_TEXT: Record<SeverityLevel, string> = {
  critical: "crítica",
  high: "alta",
  info: "informativo",
  ok: "normal",
};

export type GraphDestination = { site: string; level: SeverityLevel; count: number };
export type FlowGraph = { center: string; destinations: GraphDestination[]; hidden: number };

/** Un destino por sitio con su peor nivel y su número de envíos, por gravedad; máximo 8 (CA-U18). */
export function buildFlowGraph(events: FlowEvent[]): FlowGraph {
  const bySite = new Map<string, GraphDestination>();
  for (const event of events) {
    const level = rowFor(event).severity;
    const current = bySite.get(event.destinationSite);
    if (!current)
      bySite.set(event.destinationSite, { site: event.destinationSite, level, count: 1 });
    else {
      current.count += 1;
      if (RANK[level] > RANK[current.level]) current.level = level;
    }
  }
  const sorted = [...bySite.values()].sort(
    (a, b) => RANK[b.level] - RANK[a.level] || b.count - a.count || a.site.localeCompare(b.site)
  );
  return {
    center: events[0]?.pageSite || "esta página",
    destinations: sorted.slice(0, MAX_DESTINATIONS),
    hidden: Math.max(0, sorted.length - MAX_DESTINATIONS),
  };
}

export function clipLabel(text: string): string {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

export type PlacedNode = { x: number; y: number; label: string; level: SeverityLevel | null };
export type GraphLayout = {
  width: number;
  height: number;
  center: PlacedNode;
  nodes: PlacedNode[];
};

/** Centro en el medio y destinos repartidos en una elipse dentro del área (CA-U19). */
export function layoutGraph(graph: FlowGraph, width: number, height: number): GraphLayout {
  const cx = width / 2;
  const cy = height / 2;
  const items: Array<{ label: string; level: SeverityLevel | null }> = graph.destinations.map(
    (d) => ({
      label: `${LEVEL_SYMBOL[d.level]} ${clipLabel(d.site)}${d.count > 1 ? ` ×${d.count}` : ""}`,
      level: d.level,
    })
  );
  if (graph.hidden > 0) items.push({ label: `+${graph.hidden} más`, level: null });
  const rx = width / 2 - 70;
  const ry = height / 2 - 26;
  const nodes = items.map((item, i) => {
    // Con un solo destino va a la derecha; con más, repartidos empezando arriba.
    const angle = items.length === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * i) / items.length;
    return {
      x: Math.round(cx + rx * Math.cos(angle)),
      y: Math.round(cy + ry * Math.sin(angle)),
      ...item,
    };
  });
  return {
    width,
    height,
    center: { x: cx, y: cy, label: clipLabel(graph.center), level: null },
    nodes,
  };
}

/** Resumen en texto para lectores de pantalla (CA-U20). */
export function graphAriaLabel(graph: FlowGraph): string {
  const parts = graph.destinations.map(
    (d) => `${d.site}, ${LEVEL_TEXT[d.level]}, ${d.count} ${d.count === 1 ? "envío" : "envíos"}`
  );
  if (graph.hidden > 0) parts.push(`y ${graph.hidden} destinos más`);
  return `Flujos desde ${graph.center}: ${parts.join("; ")}`;
}
