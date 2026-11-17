// Servidor del laboratorio de CredFlow (docs/specs/laboratorio.md). Sin dependencias.
// Sirve la tienda y el dominio de "métricas" del atacante en el mismo puerto y solo escucha en bucle local.
//
// Vista del atacante (sección 6): con showStolen, muestra en la terminal y en /panel lo que recibe cada sitio.
// Solo muestra en claro la contraseña ficticia del laboratorio; cualquier otro valor se oculta, por si alguien
// escribe una credencial real por error. Nada se guarda en disco y el panel se vacía al detener el servidor.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = 8124;
export const LAB_PASSWORD = "Prueba#2026";
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const FILES = new Set(["index.html", "analytics.js", "tienda.css", "bienvenida.html"]);
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
  /** Muestra en la terminal y en el panel lo que llegó (sección 6). */
  function show(arrival) {
    const time = new Date().toLocaleTimeString("es-CO", { hour12: false });
    const who = arrival.role === "atacante" ? "\x1b[31mATACANTE\x1b[0m" : "\x1b[32mtienda  \x1b[0m";
    console.log(`[${time}] ${who} ← ${arrival.channel.padEnd(10)} ${arrival.summary}`);
    if (arrival.stolen) {
      panel.unshift({ time, channel: arrival.channel, summary: arrival.summary });
      panel.length = Math.min(panel.length, MAX_PANEL);
    }
  }
  handler.show = show;
  handler.showStolen = showStolen;
  return handler;
  function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Token");
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url ?? "/", "http://lab");
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    // Inicio de sesión "real" del escenario robo-navega: se registra como /recibir/login y redirige.
    const isLogin = url.pathname === "/login" && req.method === "POST";
    if (url.pathname.startsWith("/recibir/") || isLogin) {
      const reply = () =>
        isLogin ? res.writeHead(302, { Location: "/bienvenida.html" }).end() : res.writeHead(204).end();
      if (!showStolen) {
        // Sin la vista del atacante, el cuerpo se descarta sin leerlo.
        req.resume();
        req.on("end", reply);
        return;
      }
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
      });
      req.on("end", () => {
        reply();
        const arrival = describeArrival({
          host: req.headers.host ?? "",
          pathname: isLogin ? "/recibir/login" : url.pathname,
          search: url.search,
          // El escenario robo-encabezado manda la contraseña en X-Token, no en el cuerpo.
          body: [Buffer.concat(chunks).toString("utf8"), String(req.headers["x-token"] ?? "")]
            .filter(Boolean)
            .join("\n"),
        });
        show(arrival);
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
  }
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Lee los marcos de un WebSocket (RFC 6455) acumulados en buffer. Devuelve los mensajes de texto completos y lo que
 * sobra; close indica un marco de cierre. Solo admite marcos enmascarados (los del navegador) de hasta 64 KB.
 */
export function readFrames(buffer) {
  const messages = [];
  let offset = 0;
  let close = false;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let header = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      return { messages, rest: Buffer.alloc(0), close: true }; // demasiado grande para el laboratorio
    }
    if (!masked || length > MAX_BODY) return { messages, rest: Buffer.alloc(0), close: true };
    if (buffer.length - offset < header + 4 + length) break;
    const mask = buffer.subarray(offset + header, offset + header + 4);
    const payload = Buffer.from(buffer.subarray(offset + header + 4, offset + header + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
    if (opcode === 0x8) close = true;
    offset += header + 4 + length;
  }
  return { messages, rest: buffer.subarray(offset), close };
}

/** Acepta WebSocket solo en /ws y muestra lo que llega por él (escenario robo-websocket). */
function handleUpgrade(handler) {
  return function onUpgrade(req, socket) {
    const url = new URL(req.url ?? "/", "http://lab");
    const key = req.headers["sec-websocket-key"];
    if (url.pathname !== "/ws" || typeof key !== "string") return socket.destroy();
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    let pending = Buffer.alloc(0);
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > MAX_BODY + 16) return socket.destroy();
      const { messages, rest, close } = readFrames(pending);
      pending = rest;
      for (const body of messages) {
        if (!handler.showStolen) continue;
        handler.show(
          describeArrival({ host: req.headers.host ?? "", pathname: "/recibir/websocket", search: "", body })
        );
      }
      if (close) socket.end(Buffer.from([0x88, 0x00]));
    });
  };
}

/** Inicia el servidor en 127.0.0.1 y [::1] (así funciona "localhost" con IPv4 e IPv6). */
export async function startLab({ port = PORT, showStolen = false } = {}) {
  const handler = createHandler({ showStolen });
  const servers = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const server = createServer(handler);
    server.on("upgrade", handleUpgrade(handler));
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
  const scenarios = [
    "limpio",
    "robo",
    "robo-blob",
    "url",
    "robo-navega",
    "cifrado",
    "cifrado-robo",
    "robo-encabezado",
    "robo-websocket",
  ];
  console.log(`Laboratorio de CredFlow (contraseña ficticia: ${LAB_PASSWORD})\n`);
  for (const s of scenarios) console.log(`  ${s.padEnd(16)} http://localhost:${PORT}/?escenario=${s}`);
  console.log(`\n  Canal sin cifrar (requiere "127.0.0.1 tienda.lab" en el archivo hosts):`);
  console.log(`  ${"inseguro".padEnd(10)} http://tienda.lab:${PORT}/?escenario=limpio`);
  if (showStolen) {
    console.log(`\n  Panel del atacante: http://127.0.0.1:${PORT}/panel`);
    console.log("  Aquí abajo aparece lo que recibe cada sitio (--silencioso para desactivarlo).");
  }
  console.log("\nCtrl+C para detener.\n");
}
