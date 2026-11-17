import { describe, expect, it } from "vitest";
import {
  badgeFor,
  MAX_EVENTS_PER_TAB,
  parseStoredTabState,
  TabEventLog,
} from "../../../src/background/tab-events";
import type { FlowEvent, Severity } from "../../../src/shared/types";

let counter = 0;
function event(tabId: number, severity: Severity): FlowEvent {
  counter += 1;
  return {
    id: `e${counter}`,
    timestamp: "2026-11-09T12:00:00.000Z",
    tabId,
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
    verdict: severity === "none" ? "same_site" : "third_party",
    severity,
  };
}

describe("TabEventLog (CA-U1)", () => {
  it("guarda como máximo 50 eventos por pestaña y descarta el más antiguo", () => {
    const log = new TabEventLog();
    const added = Array.from({ length: MAX_EVENTS_PER_TAB + 5 }, () => {
      const e = event(1, "critical");
      log.add(e);
      return e;
    });
    const listed = log.list(1);
    expect(listed).toHaveLength(50);
    expect(listed[0]?.id).toBe(added.at(-1)?.id); // más reciente primero
    expect(listed.at(-1)?.id).toBe(added[5]?.id); // los 5 primeros se descartaron
  });

  it("separa las pestañas y las limpia al cerrarlas", () => {
    const log = new TabEventLog();
    log.add(event(1, "critical"));
    log.add(event(2, "high"));
    log.clear(1);
    expect(log.list(1)).toEqual([]);
    expect(log.list(2)).toHaveLength(1);
  });
});

describe("badgeFor (CA-U2)", () => {
  it("cuenta solo las severidades critical y high", () => {
    const log = new TabEventLog();
    log.add(event(1, "none"));
    expect(badgeFor(log.add(event(1, "none")))).toBeNull();
    expect(badgeFor(log.add(event(1, "high")))).toEqual({ text: "1", color: "#E37400" });
    expect(badgeFor(log.add(event(1, "critical")))).toEqual({ text: "2", color: "#D93025" });
  });

  it("muestra 99+ a partir de 100 alertas, aunque la lista solo guarde 50", () => {
    const log = new TabEventLog();
    let summary = log.add(event(1, "high"));
    for (let i = 1; i < 99; i++) summary = log.add(event(1, "high"));
    expect(badgeFor(summary)?.text).toBe("99");
    summary = log.add(event(1, "high"));
    expect(badgeFor(summary)).toEqual({ text: "99+", color: "#E37400" });
  });
});

describe("parseStoredTabState (CA-U11)", () => {
  it("restaura un estado válido", () => {
    const e = event(7, "critical");
    const state = parseStoredTabState({ events: [e], summary: { alerts: 1, critical: true } }, 7);
    // Un estado sin "watched" (guardado por la versión anterior) se lee con la lista vacía.
    expect(state).toEqual({ events: [e], summary: { alerts: 1, critical: true }, watched: [] });
  });

  it("descarta formas incorrectas", () => {
    for (const raw of [
      undefined,
      null,
      "texto",
      [],
      { events: "x", summary: { alerts: 1, critical: true } },
      { events: [], summary: { alerts: -1, critical: true } },
      { events: [], summary: { alerts: 1.5, critical: false } },
      { events: [], summary: { alerts: 1, critical: "sí" } },
      { events: [] },
    ]) {
      expect(parseStoredTabState(raw, 7)).toBeNull();
    }
  });

  it("descarta los eventos con forma incorrecta o de otra pestaña", () => {
    const good = event(7, "high");
    const state = parseStoredTabState(
      {
        events: [good, { ...good, verdict: "inventado" }, { ...good, tabId: 8 }, { id: 1 }, "x"],
        summary: { alerts: 5, critical: false },
      },
      7
    );
    expect(state?.events).toEqual([good]);
    expect(state?.summary.alerts).toBe(5);
  });

  it("snapshot y restore conservan los eventos y el resumen", () => {
    const log = new TabEventLog();
    log.add(event(3, "high"));
    log.add(event(3, "critical"));
    const snapshot = log.snapshot(3);
    const other = new TabEventLog();
    if (snapshot) other.restore(3, snapshot);
    expect(other.list(3)).toEqual(log.list(3));
    expect(other.summary(3)).toEqual({ alerts: 2, critical: true });
  });
});

describe("TabEventLog: campos vigilados", () => {
  it("registra una entrada por tipo de campo y sitio, con la hora del primer registro", () => {
    const log = new TabEventLog();
    const t1 = new Date("2026-11-16T10:00:00Z");
    expect(log.markWatched(4, "password", "facebook.com", t1)).toBe(true);
    expect(log.markWatched(4, "password", "facebook.com", new Date("2026-11-16T10:05:00Z"))).toBe(
      false
    );
    expect(log.markWatched(4, "card", "facebook.com", t1)).toBe(true);
    expect(log.watched(4)).toEqual([
      { fieldType: "password", site: "facebook.com", since: "2026-11-16T10:00:00.000Z" },
      { fieldType: "card", site: "facebook.com", since: "2026-11-16T10:00:00.000Z" },
    ]);
    expect(log.summary(4)).toEqual({ alerts: 0, critical: false }); // no cambia el ícono
  });

  it("se guardan y restauran, y el validador descarta entradas inválidas", () => {
    const log = new TabEventLog();
    log.markWatched(5, "password", "ejemplo.com", new Date(0));
    const snapshot = log.snapshot(5);
    const state = parseStoredTabState(
      {
        ...snapshot,
        watched: [...(snapshot?.watched ?? []), { fieldType: "email", site: "x", since: "y" }, 3],
      },
      5
    );
    expect(state?.watched).toEqual(log.watched(5));
  });
});
