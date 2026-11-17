// Configuración del administrador recibida por política de Chrome (sección 3.3) y destinos de confianza
// del usuario (sección 3.4).
import { siteOfHost } from "./site";

export type ManagedConfig = {
  authorizedSites: ReadonlySet<string>;
};

const MAX_PROVIDERS = 200;
export const MAX_TRUSTED_SITES = 100;
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Interpreta lo leído de chrome.storage.managed. Ignora entradas que no sean nombres de host válidos;
 * si no hay configuración, la lista de proveedores autorizados queda vacía.
 */
export function parseManagedConfig(raw: unknown): ManagedConfig {
  const list =
    typeof raw === "object" && raw !== null && "authorizedProviders" in raw
      ? raw.authorizedProviders
      : [];
  return { authorizedSites: sitesFromList(list, MAX_PROVIDERS) };
}

/** Lista de destinos de confianza leída de chrome.storage.local (clave trustedSites), validada. */
export function parseTrustedSites(raw: unknown): ReadonlySet<string> {
  return sitesFromList(raw, MAX_TRUSTED_SITES);
}

/** Nombres de host válidos de una lista, normalizados a eTLD+1; ignora todo lo demás. */
function sitesFromList(list: unknown, max: number): Set<string> {
  const sites = new Set<string>();
  if (!Array.isArray(list)) return sites;
  for (const item of list.slice(0, max)) {
    if (typeof item !== "string") continue;
    const host = item.trim().toLowerCase();
    if (HOSTNAME.test(host)) sites.add(siteOfHost(host));
  }
  return sites;
}
