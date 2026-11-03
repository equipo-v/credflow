// Lectura del cuerpo de una petición tal como lo entrega chrome.webRequest (sección 4.3).
import { MAX_BODY_BYTES } from "../shared/constants";

/** Subconjunto de chrome.webRequest.WebRequestBody que usa el Motor. */
export type RequestBodyLike = {
  error?: string | undefined;
  formData?: Record<string, string[] | undefined> | undefined;
  raw?: Array<{ bytes?: ArrayBuffer | undefined; file?: string | undefined }> | undefined;
};

export type BodyContent = {
  /** Texto analizable (puede estar vacío). */
  text: string;
  /** Se cortó en MAX_BODY_BYTES. */
  truncated: boolean;
  /** Hubo una parte que Chrome no deja inspeccionar (sección 4.3, punto 5). */
  opaque: boolean;
};

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

function readFormData(
  formData: Record<string, string[] | undefined>,
  maxBytes: number
): BodyContent {
  let text = "";
  let size = 0;
  for (const values of Object.values(formData)) {
    for (const value of values ?? []) {
      const bytes = encoder.encode(value).byteLength + 1;
      if (size + bytes > maxBytes) {
        const remaining = Math.max(0, maxBytes - size);
        text += decoder.decode(encoder.encode(value).slice(0, remaining));
        return { text, truncated: true, opaque: false };
      }
      text += value + "\n";
      size += bytes;
    }
  }
  return { text, truncated: false, opaque: false };
}

function readRaw(
  raw: Array<{ bytes?: ArrayBuffer | undefined; file?: string | undefined }>,
  maxBytes: number
): BodyContent {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  let opaque = false;
  for (const part of raw) {
    if (!part.bytes) {
      // Una parte con `file` (o sin bytes) no se puede inspeccionar.
      opaque = true;
      continue;
    }
    if (truncated) continue;
    const bytes = new Uint8Array(part.bytes);
    const remaining = maxBytes - size;
    if (bytes.byteLength > remaining) {
      chunks.push(bytes.subarray(0, remaining));
      size = maxBytes;
      truncated = true;
    } else {
      chunks.push(bytes);
      size += bytes.byteLength;
    }
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: decoder.decode(all), truncated, opaque };
}

export function readRequestBody(
  body: RequestBodyLike | undefined,
  maxBytes: number = MAX_BODY_BYTES
): BodyContent {
  if (!body) return { text: "", truncated: false, opaque: false };
  if (body.error !== undefined) return { text: "", truncated: false, opaque: true };
  if (body.formData) return readFormData(body.formData, maxBytes);
  if (body.raw) return readRaw(body.raw, maxBytes);
  return { text: "", truncated: false, opaque: false };
}
