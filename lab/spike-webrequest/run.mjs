// Verificación técnica (sección 2 de docs/specs/motor-analisis.md).
// Carga la extensión mínima en Chromium, ejecuta cada forma de envío y reporta si
// chrome.webRequest.onBeforeRequest entregó el cuerpo de la petición.
//
// Uso: npm run spike:webrequest  (requiere `npx playwright install chromium` la primera vez)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(here, 'extension');
const sitePath = path.join(here, 'site');
const PORT = 8123;
const PAGE = `http://localhost:${PORT}`;
const OTHER = `http://127.0.0.1:${PORT}`; // otro host: simula un sitio de terceros

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.url.startsWith('/recibir/')) {
    req.resume();
    req.on('end', () => res.writeHead(204).end());
    return;
  }
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  try {
    const data = await readFile(path.join(sitePath, path.basename(file)));
    const type = file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type }).end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'credflow-spike-'));
// CREDFLOW_CHROMIUM_PATH permite usar un Chromium ya instalado en lugar del que descarga Playwright.
const executablePath = process.env.CREDFLOW_CHROMIUM_PATH || undefined;
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');

const page = await context.newPage();
await page.addInitScript((other) => {
  window.OTRO_SITIO = other;
}, OTHER);
await page.goto(PAGE);

const mainWorld = await page.evaluate(() => window.__credflowMainWorld === true);

const cases = [
  'fetchJson',
  'sendBeaconTexto',
  'xhrTexto',
  'fetchMultipart',
  'fetchBlob',
  'fetchKeepalive',
  'fetchBlobTexto',
  'fetchArrayBuffer',
  'fetchUint8Array',
  'fetchUrlSearchParams',
  'fetchFile',
  'beaconBlob',
  'xhrBlob',
  'fetchStream',
  'multipartConArchivo',
  'urlConsulta',
  'enviarFormulario',
];
for (const name of cases) {
  if (name === 'enviarFormulario') {
    await Promise.all([
      page.waitForRequest((r) => r.url().includes('/recibir/formulario')),
      page.evaluate(() => window.casos.enviarFormulario()),
    ]);
  } else {
    await page.evaluate((n) => window.casos[n](), name);
  }
  await page.waitForTimeout(400);
}

const captured = await worker.evaluate(() => self.captured);
const browserVersion =
  context.browser()?.version() ?? (await worker.evaluate(() => navigator.userAgent));

const PASSWORD = 'Prueba#2026';
const b64 = Buffer.from(PASSWORD).toString('base64');
const rows = captured.map((c) => {
  const formText = c.formData ? JSON.stringify(c.formData) : '';
  const text = (c.rawText ?? '') + formText + decodeURIComponent(c.url);
  const found =
    text.includes(PASSWORD) || text.includes(b64) || text.includes(encodeURIComponent(PASSWORD));
  return {
    caso: new URL(c.url).pathname.replace('/recibir/', ''),
    tipo: c.type,
    requestBody: c.hasRequestBody,
    formato: c.hasFormData ? 'formData' : c.hasRaw ? 'raw' : '-',
    huellaEncontrada: found,
    soloEnUrl: found && !((c.rawText ?? '') + formText).match(/Prueba|UHJ1ZWJh/),
    error: c.error,
  };
});

console.log(`Navegador: ${browserVersion}`);
console.log(
  `Content script en mundo MAIN declarado en el manifiesto: ${mainWorld ? 'SÍ funciona' : 'NO funciona'}`,
);
console.table(rows);

await context.close();
server.close();
