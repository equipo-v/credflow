# Verificación técnica: `webRequest` y el cuerpo de las peticiones

| Campo | Valor |
| --- | --- |
| Especificación | `docs/specs/motor-analisis.md`, sección 2 |
| Fecha | 2 de noviembre de 2026 |
| Navegador | Chromium 153.0.8010.12 (incluido en Playwright 1.63), modo headless |
| Cómo reproducir | `npm run spike:webrequest` (prueba automatizada con Playwright) |
| Resultado | **Funciona, con puntos ciegos.** La capa de red es viable; los cuerpos `Blob`, `File` y `ReadableStream` necesitan una regla adicional. |

## Relación con la verificación manual

Antigravity hizo antes una verificación manual en Google Chrome 156 estable (`lab/spike-webrequest/README.md`)
con tres casos: formulario, `fetch` con JSON y `sendBeacon` con texto. Los tres coinciden con esta prueba.
Esta verificación la amplía a 17 formas de envío, es automatizada y encontró el punto ciego de los cuerpos `Blob`.

## Qué se probó

Una extensión mínima Manifest V3 (`lab/spike-webrequest/extension/`) registra `chrome.webRequest.onBeforeRequest`
con `extraInfoSpec: ["requestBody"]` y **sin** `"blocking"`. Una página de laboratorio en `localhost` envía la
contraseña ficticia `Prueba#2026` a otro host (`127.0.0.1`) de 17 formas distintas, y la prueba comprueba si la
extensión recibió el cuerpo y si en él aparece la contraseña (original, Base64 o codificada para URL).

## Resultados

| # | Forma de envío | Tipo (`details.type`) | Cuerpo entregado | Formato | Contraseña encontrada |
| --- | --- | --- | --- | --- | --- |
| 1 | `fetch` con JSON (contraseña en Base64) | xmlhttprequest | Sí | raw | Sí |
| 2 | `sendBeacon` con texto | ping | Sí | raw | Sí |
| 3 | XHR con texto | xmlhttprequest | Sí | raw | Sí |
| 4 | `fetch` con `FormData` (campo de texto) | xmlhttprequest | Sí | formData | Sí |
| 5 | `fetch` con `keepalive` | xmlhttprequest | Sí | raw | Sí |
| 6 | `fetch` con `ArrayBuffer` | xmlhttprequest | Sí | raw | Sí |
| 7 | `fetch` con `Uint8Array` | xmlhttprequest | Sí | raw | Sí |
| 8 | `fetch` con `URLSearchParams` | xmlhttprequest | Sí | formData | Sí |
| 9 | Envío de formulario HTML | main_frame | Sí | formData | Sí |
| 10 | Contraseña en la consulta de la URL | xmlhttprequest | No hay cuerpo | — | Sí (en la URL) |
| 11 | `fetch` con `Blob` binario | xmlhttprequest | **No** (`error: "Unknown error."`) | — | **No** |
| 12 | `fetch` con `Blob` de texto | xmlhttprequest | **No** (`error`) | — | **No** |
| 13 | `fetch` con `File` | xmlhttprequest | **No** (`error`) | — | **No** |
| 14 | `sendBeacon` con `Blob` | ping | **No** (`error`) | — | **No** |
| 15 | XHR con `Blob` | xmlhttprequest | **No** (`error`) | — | **No** |
| 16 | `fetch` con `ReadableStream` | xmlhttprequest | **No** (`error`) | — | **No** |
| 17 | `FormData` con un archivo (`Blob`) adjunto | xmlhttprequest | Parcial: el contenido del archivo no llega | raw | **No** |

También se confirmó que un content script declarado en el manifiesto con `"world": "MAIN"` se ejecuta en el
contexto de la página.

## Conclusiones

1. **La capa de red es viable.** `requestBody` llega sin bloqueo en una extensión instalada normalmente, en los
   formatos más usados para enviar credenciales (texto, JSON, formularios, binarios en memoria).
2. **Punto ciego confirmado:** cuando el cuerpo es un `Blob`, un `File` o un `ReadableStream`, Chrome entrega
   `requestBody.error` en lugar del contenido. Un script malicioso puede evadir la detección por huellas
   simplemente envolviendo la contraseña en un `Blob`. Esto afecta a la amenaza 2 del modelo STRIDE (evasión).
3. **La URL siempre está disponible**, así que las huellas en la consulta se detectan aunque no haya cuerpo.

## Cambios propuestos a la especificación

- Nuevo veredicto `opaque_body`: en una pestaña con huellas activas, una petición a un tercero no autorizado cuyo
  cuerpo no se pudo inspeccionar (`requestBody.error`, o una parte `raw` con `file` en lugar de `bytes`) se reporta
  con severidad **alta**. La extensión no puede afirmar que salió la contraseña, pero sí que salió algo que no pudo
  revisar justo después de que el usuario la escribiera.
- La capa de página (interceptor en el mundo `MAIN`) inspecciona el contenido de los `Blob` y `File` antes de que
  se envíen y lo reporta como evidencia orientativa.

## Pendiente de verificar

- Confirmar en **Google Chrome estable** los casos con `Blob`, `File` y `ReadableStream`. Los tres casos básicos ya se
  confirmaron en Chrome 156 en la verificación manual; esta prueba usó el Chromium de Playwright en modo headless.
  Para repetirla: cargar `lab/spike-webrequest/extension/` en `chrome://extensions`, abrir el sitio del laboratorio
  y ejecutar `casos.fetchBlob()` desde la consola.
- La versión mínima de Chrome que acepta `"world": "MAIN"` en el manifiesto (hoy declarada como 111 en
  `manifest.json`, sin confirmar con documentación oficial).
