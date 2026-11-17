// Lista de destinos de confianza en chrome.storage.local (docs/specs/popup-alertas.md, sección 5.2).
// Solo el popup la modifica; el Motor la valida al leerla (motor-analisis.md, sección 3.4).
const KEY = "trustedSites";
const MAX = 100;

/** Lista sin duplicados ni valores inválidos, con el sitio agregado al final (respeta el máximo). */
export function withSite(list: unknown, site: string): string[] {
  const clean = cleanList(list).filter((s) => s !== site);
  return [...clean, site].slice(-MAX);
}

export function withoutSite(list: unknown, site: string): string[] {
  return cleanList(list).filter((s) => s !== site);
}

export function cleanList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((s): s is string => typeof s === "string" && s.length > 0))];
}

export async function readTrusted(): Promise<string[]> {
  return cleanList((await chrome.storage.local.get(KEY))[KEY]);
}

export async function trustSite(site: string): Promise<void> {
  await chrome.storage.local.set({ [KEY]: withSite(await readTrusted(), site) });
}

export async function untrustSite(site: string): Promise<void> {
  await chrome.storage.local.set({ [KEY]: withoutSite(await readTrusted(), site) });
}
