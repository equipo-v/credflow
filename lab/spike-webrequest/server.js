import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8765;
const serverLogs = [];
const extensionLogs = [];

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const htmlPath = path.join(__dirname, "index.html");
    const content = fs.readFileSync(htmlPath, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/server-logs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(serverLogs));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/extension-logs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(extensionLogs));
    return;
  }

  // Handle POST requests
  if (req.method === "POST") {
    let bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", () => {
      const fullBuffer = Buffer.concat(bodyChunks);
      const text = fullBuffer.toString("utf-8");

      if (url.pathname === "/api/spike-extension-log") {
        try {
          const parsed = JSON.parse(text);
          extensionLogs.push(parsed);
          console.log("[SERVER] Received extension webRequest log:", parsed.method, parsed.url);
        } catch (e) {
          console.error("[SERVER] Error parsing extension log:", e);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      let caseName = "Desconocido";
      if (url.pathname === "/api/form-submit") caseName = "Formulario urlencoded";
      else if (url.pathname === "/api/fetch-json") caseName = "Fetch JSON";
      else if (url.pathname === "/api/send-beacon") caseName = "Beacon texto";

      serverLogs.push({
        caseName,
        url: url.pathname,
        contentType: req.headers["content-type"] || "no-content-type",
        bodySummary: text,
        timestamp: new Date().toISOString()
      });

      console.log(`[SERVER] Captured ${caseName}: length=${fullBuffer.length} bytes`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "success", received: text }));
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[TEST-SERVER] Running on http://127.0.0.1:${PORT}`);
});
