// Atribución por traza de pila (docs/specs/interceptor-pagina.md, sección 4). Lógica pura.

const URL_IN_STACK = /\b([a-z][a-z0-9+.-]*:\/\/[^\s()]+)/gi;

/** Origen + ruta de una URL, sin consulta, fragmento ni posición; null si no es válida. */
function originAndPath(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/(?::\d+){1,2}$/, ""));
    const origin = url.origin === "null" ? `${url.protocol}//` : url.origin;
    return origin + url.pathname;
  } catch {
    return null;
  }
}

/**
 * Primer script de la traza que no pertenece a una extensión, como origen + ruta. Si no hay ninguno (código en línea),
 * la URL de la página sin consulta ni fragmento.
 */
export function scriptFromStack(stack: string | undefined, pageUrl: string): string | null {
  for (const match of (stack ?? "").matchAll(URL_IN_STACK)) {
    const raw = match[1];
    if (!raw || raw.startsWith("chrome-extension://")) continue;
    const script = originAndPath(raw);
    if (script) return script;
  }
  return originAndPath(pageUrl);
}
