// Configuración del administrador recibida por política de Chrome (sección 3.3).
import { siteOfHost } from "./site";

export type ManagedConfig = {
  authorizedSites: ReadonlySet<string>;
};

const MAX_PROVIDERS = 200;
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Interpreta lo leído de chrome.storage.managed. Ignora entradas que no sean nombres de host válidos;
 * si no hay configuración, la lista de proveedores autorizados queda vacía.
 */
export function parseManagedConfig(raw: unknown): ManagedConfig {
  const sites = new Set<string>();
  if (typeof raw === "object" && raw !== null && "authorizedProviders" in raw) {
    const list: unknown = raw.authorizedProviders;
    if (Array.isArray(list)) {
      for (const item of list.slice(0, MAX_PROVIDERS)) {
        if (typeof item !== "string") continue;
        const host = item.trim().toLowerCase();
        if (HOSTNAME.test(host)) sites.add(siteOfHost(host));
      }
    }
  }
  return { authorizedSites: sites };
}
