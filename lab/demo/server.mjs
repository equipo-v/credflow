// Servidor del laboratorio de CredFlow (docs/specs/laboratorio.md). Sin dependencias.
// Sirve la tienda y el dominio de "métricas" del atacante en el mismo puerto; solo escucha en bucle local
// y no guarda ni muestra lo que recibe.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = 8124;
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const FILES = new Set(["index.html", "analytics.js", "tienda.css"]);

function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  const { pathname } = new URL(req.url ?? "/", "http://lab");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (pathname.startsWith("/recibir/")) {
    // Se descarta el cuerpo sin leerlo ni guardarlo.
    req.resume();
    req.on("end", () => res.writeHead(204).end());
    return;
  }
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!FILES.has(file)) return res.writeHead(404).end();
  readFile(path.join(SITE, file)).then(
    (data) => res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] }).end(data),
    () => res.writeHead(500).end()
  );
}

/** Inicia el servidor en 127.0.0.1 y [::1] (así funciona "localhost" con IPv4 e IPv6). */
export async function startLab(port = PORT) {
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
  await startLab();
  const scenarios = ["limpio", "robo", "robo-blob", "url"];
  console.log("Laboratorio de CredFlow (contraseña ficticia: Prueba#2026)\n");
  for (const s of scenarios) console.log(`  ${s.padEnd(10)} http://localhost:${PORT}/?escenario=${s}`);
  console.log(`\n  Canal sin cifrar (requiere "127.0.0.1 tienda.lab" en el archivo hosts):`);
  console.log(`  ${"inseguro".padEnd(10)} http://tienda.lab:${PORT}/?escenario=limpio`);
  console.log("\nCtrl+C para detener.");
}
