// Búsqueda de huellas y clasificación de una petición (secciones 4.3, 4.4 y 4.5).
// Lógica pura: no usa APIs de Chrome, para poder probarla con Vitest.
import type { Encoding, FieldType, FlowEvent, Severity, Verdict } from "../shared/types";
import type { ActiveFingerprint } from "./fingerprint-store";
import { bodyFields, hasEncryptedPassword } from "./encrypted-field";
import { readRequestBody, type RequestBodyLike } from "./request-body";
import { isLoopbackHost, siteOfUrl } from "./site";

export type RequestInfo = {
  tabId: number;
  url: string;
  method: string;
  type: string;
  initiator?: string | undefined;
  requestBody?: RequestBodyLike | undefined;
};

export type AnalysisContext = {
  fingerprints: ActiveFingerprint[];
  /** Sitios (eTLD+1) de los proveedores autorizados por el administrador. */
  authorizedSites: ReadonlySet<string>;
  /** Último sitio conocido de la pestaña, si la petición no trae initiator. */
  lastKnownPageSite: string | null;
  now: Date;
  newId: () => string;
};

type Match = { fieldType: FieldType; encoding: Encoding; location: "body" | "url" };

function findIn(text: string, fingerprints: ActiveFingerprint[]): ActiveFingerprint | null {
  if (text === "") return null;
  let lower: string | null = null;
  for (const fp of fingerprints) {
    if (fp.encoding === "hex") {
      lower ??= text.toLowerCase();
      if (lower.includes(fp.value.toLowerCase())) return fp;
    } else if (text.includes(fp.value)) {
      return fp;
    }
  }
  return null;
}

function urlText(url: string): string {
  try {
    return url + "\n" + decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** Canal sin cifrar: http: o ws: hacia un host que no es de bucle local (sección 4.4, regla 1). */
function isInsecureChannel(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "ws:") && !isLoopbackHost(url.hostname);
}

/**
 * Analiza una petición saliente y devuelve el evento de flujo, o null si no hay nada que reportar.
 * El evento nunca incluye el valor, la huella, ni la ruta o la consulta de la URL.
 */
export function analyzeRequest(request: RequestInfo, ctx: AnalysisContext): FlowEvent | null {
  if (ctx.fingerprints.length === 0) return null;

  let destination: URL;
  try {
    destination = new URL(request.url);
  } catch {
    return null;
  }

  const body = readRequestBody(request.requestBody);
  const bodyMatch = findIn(body.text, ctx.fingerprints);
  const urlMatch = bodyMatch ? null : findIn(urlText(request.url), ctx.fingerprints);
  const found = bodyMatch ?? urlMatch;
  const match: Match | null = found
    ? { fieldType: found.fieldType, encoding: found.encoding, location: bodyMatch ? "body" : "url" }
    : null;

  // Sin coincidencia: puede que la propia página cifre la contraseña antes de enviarla (sección 4.7).
  const encrypted =
    !match && !body.opaque && hasEncryptedPassword(bodyFields(request.requestBody, body.text));
  if (!match && !body.opaque && !encrypted) return null;

  const destinationSite = siteOfUrl(request.url) ?? destination.host;
  // Sin sitio de página conocido, ningún destino se considera "mismo sitio".
  const pageSite = siteOfUrl(request.initiator) ?? ctx.lastKnownPageSite ?? "";
  const authorized = ctx.authorizedSites.has(destinationSite);
  const thirdParty = destinationSite !== pageSite && !authorized;
  const insecure = isInsecureChannel(destination);

  let verdict: Verdict;
  let severity: Severity;
  if (match) {
    if (insecure) [verdict, severity] = ["insecure_channel", "critical"];
    else if (thirdParty) [verdict, severity] = ["third_party", "critical"];
    else if (match.location === "url") [verdict, severity] = ["credential_in_url", "high"];
    else if (authorized) [verdict, severity] = ["authorized_provider", "none"];
    else [verdict, severity] = ["same_site", "none"];
  } else if (encrypted) {
    // Contraseña cifrada por la página (sección 4.7): informativo, salvo que vaya a un tercero.
    if (thirdParty) [verdict, severity] = ["encrypted_third_party", "high"];
    else [verdict, severity] = ["site_encrypted", "none"];
  } else {
    // Cuerpo opaco sin coincidencia (sección 4.5).
    if (insecure) [verdict, severity] = ["insecure_channel", "critical"];
    else if (thirdParty) [verdict, severity] = ["opaque_body", "high"];
    else return null;
  }

  // Con el cuerpo opaco o cifrado no se sabe qué campo salió: se reporta el del registro más reciente disponible.
  const fieldType = match?.fieldType ?? ctx.fingerprints[0]?.fieldType ?? "custom";

  return {
    id: ctx.newId(),
    timestamp: ctx.now.toISOString(),
    tabId: request.tabId,
    pageSite,
    destinationOrigin: destination.origin,
    destinationSite,
    method: request.method,
    requestType: request.type,
    fieldType,
    encoding: match?.encoding ?? null,
    location: match?.location ?? "body",
    truncated: body.truncated,
    verdict,
    severity,
  };
}
