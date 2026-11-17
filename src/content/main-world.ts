// Interceptor de página: content script en el mundo MAIN (docs/specs/interceptor-pagina.md).
// Observa fetch, XMLHttpRequest, sendBeacon y WebSocket.send para informar qué script hizo cada envío y, en los
// casos que la red no ve (encabezados, Blob y WebSocket), su contenido. Es evidencia orientativa: la página comparte
// este mundo y puede evadirlo. Siempre llama a la función original y nunca cambia su resultado.
import { scriptFromStack } from "./stack";

const MAX_TEXT = 64 * 1024;
const EVENT_NAME = "credflow:report";

type Api = "fetch" | "xhr" | "beacon" | "websocket";
type Extra = { location: "header" | "blob" | "websocket"; text: string } | null;

// Referencias tomadas antes de que corran los scripts de la página (run_at: document_start).
const originalFetch = window.fetch;
const originalOpen = XMLHttpRequest.prototype.open;
const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
const originalXhrSend = XMLHttpRequest.prototype.send;
const originalBeacon = typeof navigator.sendBeacon === "function" ? navigator.sendBeacon : null;
const originalWsSend = WebSocket.prototype.send;
const dispatch = EventTarget.prototype.dispatchEvent;
const stringify = JSON.stringify;
const decoder = new TextDecoder();

function absoluteUrl(raw: string | URL): string | null {
  try {
    const url = new URL(raw, location.href);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function currentScript(): string | null {
  try {
    return scriptFromStack(new Error().stack, location.href);
  } catch {
    return null;
  }
}

function report(api: Api, url: string | null, script: string | null, extra: Extra): void {
  if (url === null) return;
  try {
    const detail = stringify({ kind: "PAGE_REPORT", api, url, script, extra });
    dispatch.call(document, new CustomEvent(EVENT_NAME, { detail }));
  } catch {
    // El interceptor nunca debe romper la página.
  }
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

/** Lee un Blob (hasta 64 KB) y lo reporta cuando termina, sin bloquear el envío. */
function reportBlob(
  api: Api,
  url: string | null,
  script: string | null,
  blob: Blob,
  location: "blob" | "websocket"
): void {
  blob
    .slice(0, MAX_TEXT)
    .text()
    .then(
      (text) => report(api, url, script, { location, text: clip(text) }),
      () => report(api, url, script, null)
    );
}

function headersText(headers: HeadersInit | undefined): string {
  if (!headers) return "";
  const lines: string[] = [];
  try {
    new Headers(headers).forEach((value, name) => lines.push(`${name}: ${value}`));
  } catch {
    return "";
  }
  return clip(lines.join("\n"));
}

function binaryText(data: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data, 0, Math.min(data.byteLength, MAX_TEXT))
      : new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, MAX_TEXT));
  return decoder.decode(bytes);
}

// fetch
window.fetch = function (
  this: unknown,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const script = currentScript();
    const request = input instanceof Request ? input : null;
    const url = absoluteUrl(request ? request.url : (input as string | URL));
    const headers = [headersText(request?.headers), headersText(init?.headers)]
      .filter(Boolean)
      .join("\n");
    report("fetch", url, script, headers ? { location: "header", text: clip(headers) } : null);
    if (init?.body instanceof Blob) reportBlob("fetch", url, script, init.body, "blob");
  } catch {
    // Sin reporte; la llamada original sigue igual.
  }
  return originalFetch.call(this, input, init);
} as typeof fetch;

// XMLHttpRequest: la URL y los encabezados se guardan por objeto hasta send().
const xhrState = new WeakMap<XMLHttpRequest, { url: string | null; headers: string[] }>();

XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
  try {
    const raw = args[1];
    xhrState.set(this, {
      url: typeof raw === "string" || raw instanceof URL ? absoluteUrl(raw) : null,
      headers: [],
    });
  } catch {
    // Sin estado: send() no reporta.
  }
  return (originalOpen as (...a: unknown[]) => void).apply(this, args);
} as typeof XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.setRequestHeader = function (
  this: XMLHttpRequest,
  name: string,
  value: string
): void {
  try {
    xhrState.get(this)?.headers.push(`${String(name)}: ${String(value)}`);
  } catch {
    // Ignorado.
  }
  return originalSetHeader.call(this, name, value);
};

XMLHttpRequest.prototype.send = function (
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null
): void {
  try {
    const state = xhrState.get(this);
    if (state) {
      const script = currentScript();
      const headers = state.headers.join("\n");
      report(
        "xhr",
        state.url,
        script,
        headers ? { location: "header", text: clip(headers) } : null
      );
      if (body instanceof Blob) reportBlob("xhr", state.url, script, body, "blob");
    }
  } catch {
    // Ignorado.
  }
  return originalXhrSend.call(this, body);
};

// navigator.sendBeacon
if (originalBeacon) {
  navigator.sendBeacon = function (
    this: Navigator,
    url: string | URL,
    data?: BodyInit | null
  ): boolean {
    try {
      const target = absoluteUrl(url);
      const script = currentScript();
      report("beacon", target, script, null);
      if (data instanceof Blob) reportBlob("beacon", target, script, data, "blob");
    } catch {
      // Ignorado.
    }
    return originalBeacon.call(this, url, data);
  };
}

// WebSocket.send: el contenido de los mensajes no pasa por webRequest.
WebSocket.prototype.send = function (
  this: WebSocket,
  data: string | ArrayBuffer | Blob | ArrayBufferView<ArrayBuffer>
): void {
  try {
    const url = absoluteUrl(this.url);
    const script = currentScript();
    if (typeof data === "string")
      report("websocket", url, script, { location: "websocket", text: clip(data) });
    else if (data instanceof Blob) reportBlob("websocket", url, script, data, "websocket");
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
      report("websocket", url, script, { location: "websocket", text: clip(binaryText(data)) });
  } catch {
    // Ignorado.
  }
  return originalWsSend.call(this, data);
};
