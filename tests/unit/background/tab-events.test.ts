import { describe, expect, it } from "vitest";
import { badgeFor, MAX_EVENTS_PER_TAB, TabEventLog } from "../../../src/background/tab-events";
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
