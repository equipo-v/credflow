// Verificación técnica: ¿entrega webRequest el cuerpo de la petición sin "blocking" en MV3?
// Guarda en memoria un resumen de cada petición POST para que la prueba lo lea.
self.captured = [];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== 'POST') return;
    const body = details.requestBody;
    let rawText = null;
    if (body && body.raw) {
      rawText = body.raw
        .filter((part) => part.bytes)
        .map((part) => new TextDecoder('utf-8').decode(part.bytes))
        .join('');
    }
    self.captured.push({
      url: details.url,
      type: details.type,
      hasRequestBody: Boolean(body),
      hasFormData: Boolean(body && body.formData),
      formData: body && body.formData ? body.formData : null,
      hasRaw: Boolean(body && body.raw),
      rawText,
      error: body && body.error ? body.error : null,
    });
  },
  { urls: ['<all_urls>'] },
  ['requestBody'],
);
