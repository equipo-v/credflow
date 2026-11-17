import { describe, expect, it } from "vitest";
import { scriptFromStack } from "../../../src/content/stack";

const PAGE = "https://tienda.lab/login?next=/cuenta#top";

describe("scriptFromStack (CA-I2)", () => {
  it("devuelve la primera URL ajena a la extensión, sin consulta ni posición", () => {
    const stack = [
      "Error",
      "    at currentScript (chrome-extension://abcdefghijklmnop/assets/main-world.js:1:200)",
      "    at window.fetch (chrome-extension://abcdefghijklmnop/assets/main-world.js:1:900)",
      "    at enviar (https://cdn.malo.example/js/analytics.js?v=3:12:7)",
      "    at https://tienda.lab/app.js:4:1",
    ].join("\n");
    expect(scriptFromStack(stack, PAGE)).toBe("https://cdn.malo.example/js/analytics.js");
  });

  it("acepta marcos sin paréntesis y quita la posición", () => {
    expect(scriptFromStack("Error\n    at http://localhost:8124/analytics.js:30:15", PAGE)).toBe(
      "http://localhost:8124/analytics.js"
    );
  });

  it("sin URL en la traza, devuelve la página sin consulta ni fragmento", () => {
    expect(scriptFromStack("Error\n    at <anonymous>:1:1", PAGE)).toBe("https://tienda.lab/login");
    expect(scriptFromStack(undefined, PAGE)).toBe("https://tienda.lab/login");
  });
});
