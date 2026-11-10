// Pruebas de extremo a extremo y grabación de la demo (docs/specs/laboratorio.md, sección 4).
// Requiere la extensión compilada en dist/ (npm run test:e2e la compila antes).
// CREDFLOW_CHROMIUM_PATH permite usar un Chromium ya instalado en lugar del que descarga Playwright.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
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

async function tabIdOf(url) {
  return worker.evaluate(async (u) => {
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
  if (beforeTyping) await beforeTyping(page);
  await page.click('input[name="usuario"]');
  await page.keyboard.type("ana.prueba");
  await page.click('input[type="password"]');
  await page.keyboard.type(PASSWORD, { delay: 20 });
  if (submit === "click") await page.click('button[type="submit"]');
  else await page.keyboard.press("Enter"); // envío inmediato, sin esperar los 300 ms
  await page.waitForTimeout(1200);
  return { page, tabId: await tabIdOf(page.url()) };
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
  return worker.evaluate(
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
  await page.close();
});

await check("Robo dentro de un Blob → no inspeccionable, alta (CA-17, CA-L2)", async () => {
  const { page, tabId } = await runScenario(`${TIENDA}/?escenario=robo-blob`);
  const { rows } = await popupFor(tabId, "robo-blob");
  assert.deepEqual(await badgeOf(tabId), { text: "1", color: AMBER });
  assert.ok(verdicts(rows).includes("Envío no inspeccionable a un tercero"));
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
  assert.deepEqual(verdicts(rows), ["Enviada al mismo sitio"]);
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
