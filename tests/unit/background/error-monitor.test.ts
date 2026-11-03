import { describe, expect, it } from "vitest";
import { ErrorMonitor } from "../../../src/background/error-monitor";

describe("ErrorMonitor (CA-19)", () => {
  it("cuatro errores en 60 s no producen evento", () => {
    const monitor = new ErrorMonitor();
    for (let i = 0; i < 4; i++) expect(monitor.record(1_000 + i)).toBeNull();
  });

  it("cinco errores en 60 s producen un único evento sin datos de la petición", () => {
    const monitor = new ErrorMonitor();
    const events = Array.from({ length: 8 }, (_, i) =>
      monitor.record(Date.UTC(2026, 10, 3) + i * 1_000)
    );
    const emitted = events.filter((e) => e !== null);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      kind: "analysis_errors",
      timestamp: "2026-11-03T00:00:04.000Z",
      errorCount: 5,
      windowSeconds: 60,
    });
    expect(Object.keys(emitted[0] ?? {}).sort()).toEqual([
      "errorCount",
      "kind",
      "timestamp",
      "windowSeconds",
    ]);
  });

  it("una ventana nueva vuelve a contar desde cero", () => {
    const monitor = new ErrorMonitor();
    for (let i = 0; i < 4; i++) monitor.record(i);
    expect(monitor.record(60_000)).toBeNull(); // nueva ventana: 1 error
    for (let i = 1; i < 4; i++) expect(monitor.record(60_000 + i)).toBeNull();
    expect(monitor.record(60_010)?.errorCount).toBe(5);
  });
});
