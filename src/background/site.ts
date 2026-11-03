// Cálculo del sitio (eTLD+1) de una URL u origen (sección 4.4).
import { getDomain } from "tldts";

/** eTLD+1 del host; si tldts no puede calcularlo (IP, localhost), el host completo. */
export function siteOfHost(hostname: string): string {
  const host = hostname.toLowerCase();
  return getDomain(host) ?? host;
}

/** Sitio de una URL u origen, o null si no se puede interpretar (por ejemplo, el origen opaco "null"). */
export function siteOfUrl(url: string | undefined): string | null {
  if (!url || url === "null") return null;
  try {
    const { hostname } = new URL(url);
    return hostname ? siteOfHost(hostname) : null;
  } catch {
    return null;
  }
}
