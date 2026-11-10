// Servidor del laboratorio de CredFlow (docs/specs/laboratorio.md). Sin dependencias.
// Sirve la tienda y el dominio de "métricas" del atacante en el mismo puerto y solo escucha en bucle local.
//
// Vista del atacante (sección 6): con showStolen, muestra en la terminal y en /panel lo que recibe cada sitio.
// Solo muestra en claro la contraseña ficticia del laboratorio; cualquier otro valor se oculta, por si alguien
// escribe una credencial real por error. Nada se guarda en disco y el panel se vacía al detener el servidor.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = 8124;
export const LAB_PASSWORD = "Prueba#2026";
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const FILES = new Set(["index.html", "analytics.js", "tienda.css"]);
const MAX_BODY = 64 * 1024;
const MAX_PANEL = 20;

/** Busca la contraseña ficticia en el texto recibido, en claro o en Base64. */
export function findLabPassword(text) {
  if (text.includes(LAB_PASSWORD)) return "en texto plano";
  // Palabras candidatas a Base64 (el "=" de relleno separa también "clave=valor"; Buffer no lo exige).
  for (const token of text.split(/[^A-Za-z0-9+/_-]+/)) {
    if (token.length < 8) continue;
    try {
      if (Buffer.from(token, "base64").toString("utf8").includes(LAB_PASSWORD)) return "en Base64";
    } catch {
      // No era Base64.
    }
  }
  return null;
}

/** Qué recibió el servidor, sin guardar nunca un valor que no sea la contraseña ficticia. */
export function describeArrival({ host, pathname, search, body }) {
  const role = host.startsWith("127.0.0.1") ? "atacante" : "tienda";
  let text = body;
  try {
    text += "\n" + decodeURIComponent(search.replace(/\+/g, " "));
    text += "\n" + decodeURIComponent(body.replace(/\+/g, " "));
  } catch {
    // Codificación inválida: se analiza el texto tal cual.
  }
  const found = findLabPassword(text);
  const where = search && found && !findLabPassword(body) ? " (en la URL)" : "";
  return {
    role,
    channel: pathname.replace("/recibir/", ""),
    summary: found
      ? `contraseña: ${LAB_PASSWORD} (${found})${where}`
      : body || search
        ? "datos recibidos (ocultos: no contienen la contraseña del laboratorio)"
        : "sin datos",
    stolen: role === "atacante" && found !== null,
  };
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function panelHtml(entries) {
  const rows = entries
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.time)}</td><td>${escapeHtml(e.channel)}</td><td>${escapeHtml(e.summary)}</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="refresh" content="2">
<title>Panel del atacante · laboratorio</title><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#1f2125;color:#e8eaed}
.aviso{margin:0;padding:8px 16px;background:#3a3221;color:#fdd663;text-align:center}
main{max-width:760px;margin:32px auto;padding:0 16px}h1{color:#f28b82}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #3c4043;text-align:left}
.vacio{color:#9aa0a6}</style></head><body>
<p class="aviso">Simulación del laboratorio de CredFlow · solo se muestra la contraseña ficticia</p>
<main><h1>Panel del atacante</h1><p>Credenciales que el script comprometido envió al dominio de métricas
(<code>127.0.0.1</code>). Se actualiza cada 2 segundos.</p>
${rows ? `<table><tr><th>Hora</th><th>Canal</th><th>Dato robado</th></tr>${rows}</table>` : '<p class="vacio">Todavía no ha llegado nada.</p>'}
</main></body></html>`;
}

function createHandler({ showStolen }) {
  const panel = [];
  return function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url ?? "/", "http://lab");
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    if (url.pathname.startsWith("/recibir/")) {
      if (!showStolen) {
        // Sin la vista del atacante, el cuerpo se descarta sin leerlo.
        req.resume();
        req.on("end", () => res.writeHead(204).end());
        return;
      }
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
      });
      req.on("end", () => {
        res.writeHead(204).end();
        const arrival = describeArrival({
          host: req.headers.host ?? "",
          pathname: url.pathname,
          search: url.search,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        const time = new Date().toLocaleTimeString("es-CO", { hour12: false });
        const who = arrival.role === "atacante" ? "\x1b[31mATACANTE\x1b[0m" : "\x1b[32mtienda  \x1b[0m";
        console.log(`[${time}] ${who} ← ${arrival.channel.padEnd(10)} ${arrival.summary}`);
        if (arrival.stolen) {
          panel.unshift({ time, channel: arrival.channel, summary: arrival.summary });
          panel.length = Math.min(panel.length, MAX_PANEL);
        }
      });
      return;
    }

    if (url.pathname === "/panel" && showStolen) {
      return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(panelHtml(panel));
    }

    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!FILES.has(file)) return res.writeHead(404).end();
    readFile(path.join(SITE, file)).then(
      (data) => res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] }).end(data),
      () => res.writeHead(500).end()
    );
  };
}

/** Inicia el servidor en 127.0.0.1 y [::1] (así funciona "localhost" con IPv4 e IPv6). */
export async function startLab({ port = PORT, showStolen = false } = {}) {
  const handler = createHandler({ showStolen });
  const servers = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const server = createServer(handler);
    await new Promise((resolve) => {
      server.once("error", resolve); // si el equipo no tiene IPv6, se sigue solo con IPv4
      server.listen(port, host, resolve);
    });
    if (server.listening) servers.push(server);
  }
  if (servers.length === 0) throw new Error(`No se pudo usar el puerto ${port}`);
  return { close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const showStolen = !process.argv.includes("--silencioso");
  await startLab({ showStolen });
  const scenarios = ["limpio", "robo", "robo-blob", "url"];
  console.log(`Laboratorio de CredFlow (contraseña ficticia: ${LAB_PASSWORD})\n`);
  for (const s of scenarios) console.log(`  ${s.padEnd(10)} http://localhost:${PORT}/?escenario=${s}`);
  console.log(`\n  Canal sin cifrar (requiere "127.0.0.1 tienda.lab" en el archivo hosts):`);
  console.log(`  ${"inseguro".padEnd(10)} http://tienda.lab:${PORT}/?escenario=limpio`);
  if (showStolen) {
    console.log(`\n  Panel del atacante: http://127.0.0.1:${PORT}/panel`);
    console.log("  Aquí abajo aparece lo que recibe cada sitio (--silencioso para desactivarlo).");
  }
  console.log("\nCtrl+C para detener.\n");
}
