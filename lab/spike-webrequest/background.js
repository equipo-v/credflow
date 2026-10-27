// Service Worker de prueba para Spike WebRequest
// Verifica captura de requestBody en chrome.webRequest.onBeforeRequest sin blocking

const capturedRequests = [];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Filtrar únicamente peticiones dirigidas al servidor de prueba local
    if (details.url.includes("127.0.0.1") || details.url.includes("localhost")) {
      let rawDecoded = null;
      if (details.requestBody && details.requestBody.raw) {
        rawDecoded = details.requestBody.raw.map((elem) => {
          if (elem.bytes) {
            try {
              return new TextDecoder("utf-8").decode(elem.bytes);
            } catch {
              return "[Error al decodificar bytes UTF-8]";
            }
          }
          return null;
        });
      }

      const item = {
        url: details.url,
        method: details.method,
        type: details.type,
        hasRequestBody: Boolean(details.requestBody),
        hasFormData: Boolean(details.requestBody && details.requestBody.formData),
        hasRaw: Boolean(details.requestBody && details.requestBody.raw),
        formData: details.requestBody?.formData || null,
        rawDecoded: rawDecoded,
        rawCount: details.requestBody?.raw?.length || 0,
        timestamp: new Date().toISOString()
      };

      capturedRequests.push(item);
      console.log("[SPIKE-BACKGROUND] Captured onBeforeRequest:", JSON.stringify(item));

      // Reportar al servidor de prueba para consolidar la evidencia
      if (!details.url.includes("/api/spike-extension-log") && !details.url.includes("/api/server-logs")) {
        fetch("http://127.0.0.1:8765/api/spike-extension-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item)
        }).catch(() => {});
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"] // SIN "blocking", únicamente extraInfoSpec: ["requestBody"]
);

// Listener para permitir al frontend de prueba consultar las capturas del Service Worker
chrome.runtime.onMessageExternal?.addListener((request, sender, sendResponse) => {
  if (request && request.type === "GET_SPIKE_RESULTS") {
    sendResponse({ results: capturedRequests });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === "GET_SPIKE_RESULTS") {
    sendResponse({ results: capturedRequests });
  }
  return true;
});
