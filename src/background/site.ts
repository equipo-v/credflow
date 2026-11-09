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

/**
 * Host de bucle local: localhost, *.localhost, 127.0.0.0/8 o [::1] (sección 4.4).
 * El tráfico a estos hosts no sale del equipo, como los orígenes "potencialmente confiables" de W3C Secure Contexts.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
