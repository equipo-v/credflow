# Especificación: Interceptor de página (mundo MAIN)

| Campo | Valor |
| --- | --- |
| Componente | Interceptor de página |
| Ubicación | `src/content/main-world.ts` (mundo `MAIN`), `src/content/bridge.ts` (reenvío) y entrada `content_scripts` en `manifest.json` |
| Depende de | Contratos compartidos (`src/shared/types.ts`, `src/shared/validators.ts`) |
| Lo usa | Motor de análisis (`docs/specs/motor-analisis.md`, secciones 4.8 y 4.9) |
| Estado | Borrador para revisión del equipo |

## 1. Propósito

La capa de red (`webRequest`) dice **a dónde** salió una contraseña, pero no **qué script** la envió, y no ve tres
lugares por donde puede salir: los **encabezados HTTP**, los cuerpos **`Blob`/`File`** y los **mensajes de
WebSocket**. El interceptor corre en el mismo mundo que el código de la página, observa sus llamadas de red y le
informa al Motor quién las hizo y, en esos tres casos, qué contenido llevaban.

Es **evidencia orientativa** (AGENTS.md, regla 6): el código de la página comparte este mundo y puede engañarlo o
desactivarlo. La capa de red sigue siendo la autoritativa.

## 2. Dónde se ejecuta

- Content script declarado en `manifest.json` con `world: "MAIN"`, `matches: ["<all_urls>"]`, `all_frames: true` y
  `run_at: "document_start"`, para instalarse antes que los scripts de la página. Se genera como IIFE autocontenido
  (`standaloneFiles` de CRXJS). No requiere permisos nuevos.
- No tiene acceso a las APIs de extensión: se comunica con el Puente (mundo aislado) con un `CustomEvent` en
  `document`, de nombre fijo `credflow:report`, cuyo `detail` es un texto JSON.

## 3. Qué intercepta

| API | Datos que reporta |
| --- | --- |
| `fetch(input, init)` | URL absoluta, script que llamó; encabezados de `init.headers` o del `Request`; si el cuerpo es `Blob` o `File`, su texto (hasta 64 KB) |
| `XMLHttpRequest` (`open`, `setRequestHeader`, `send`) | URL, script, valores de los encabezados; si el cuerpo es `Blob`, su texto |
| `navigator.sendBeacon(url, data)` | URL, script; si `data` es `Blob`, su texto |
| `WebSocket.prototype.send(data)` | URL del socket, script; el mensaje como texto (string, `Blob`, `ArrayBuffer` o vista; hasta 64 KB) |

- Siempre se llama a la función original con los mismos argumentos y se devuelve su resultado: el interceptor no
  cambia ni bloquea el comportamiento de la página. Cualquier error propio se captura en silencio.
- Los cuerpos de texto, `FormData`, `URLSearchParams` y binarios en memoria **no** se reportan: la capa de red ya los ve.
- `ReadableStream` no se lee (leerlo lo consumiría).

## 4. Atribución por traza de pila

- En cada llamada se crea `new Error().stack` y se toma la **primera URL** que no sea `chrome-extension://`.
- Se reporta solo el **origen y la ruta** de esa URL (sin consulta, fragmento ni número de línea), por ejemplo
  `https://cdn.ejemplo.com/js/analytics.js`. Si no hay URL (código en línea), se reporta la URL de la página sin
  consulta ni fragmento.

## 5. Reenvío por el Puente

- El Puente escucha `credflow:report` y **solo reenvía** al Motor si en ese documento el usuario escribió en un campo
  sensible en los últimos 60 s; así no se envía al Motor cada petición de la página.
- Valida el `detail` con el contrato `PageReport` (sección 6) antes de reenviarlo; si no es válido, lo descarta.
- No agrega ni guarda nada más; el `tabId` lo pone Chrome en el remitente.

## 6. Contrato `PageReport`

```ts
type PageReport = {
  kind: "PAGE_REPORT";
  api: "fetch" | "xhr" | "beacon" | "websocket";
  url: string;            // http:, https:, ws: o wss:; máximo 2048 caracteres
  script: string | null;  // origen + ruta; máximo 2048 caracteres
  extra: { location: "header" | "blob" | "websocket"; text: string } | null; // text: máximo 64 KB
};
```

Validación estricta: exactamente esas claves, `api` y `location` de las listas cerradas, longitudes máximas y URL
con esquema permitido.

## 7. Controles de seguridad

| Control | Referencia |
| --- | --- |
| Evidencia orientativa: un reporte nunca anula ni elimina un evento de la red; los eventos que produce se marcan como `evidence: "page"` | AGENTS.md regla 6; STRIDE #1 |
| El contenido de `extra` puede incluir la contraseña: viaja solo en memoria al Motor, se compara con las huellas y se descarta; nunca se guarda ni se incluye en eventos | AGENTS.md regla 1; STRIDE #4 |
| Validación estricta del `PageReport` en el Puente y en el Motor | ASVS 4.0.3 V5.1.3, V5.1.4 |
| Reenvío solo tras escritura real reciente, para limitar mensajes | STRIDE #5 |
| La página puede restaurar las funciones originales y evadir el interceptor; la capa de red sigue detectando lo que puede ver | STRIDE #2 (riesgo aceptado) |

## 8. Criterios de aceptación

- **CA-I1** El validador de `PageReport` acepta un reporte válido y rechaza claves adicionales, `api` desconocida,
  URL con esquema `javascript:` o `data:`, y textos o URL más largos que el máximo.
- **CA-I2** La función que obtiene el script de una traza devuelve la primera URL ajena a la extensión sin consulta ni
  número de línea, y la URL de la página si no hay ninguna.
- **CA-I3 (E2E)** En el escenario `robo`, el popup muestra el script que envió la contraseña.
- **CA-I4 (E2E)** Una contraseña enviada en un encabezado HTTP a otro sitio produce un evento con evidencia de página.
- **CA-I5 (E2E)** Una contraseña enviada por WebSocket a otro sitio produce un evento con evidencia de página.
- **CA-I6 (E2E)** En el escenario `robo-blob`, además del evento `opaque_body` de la red, aparece un evento con
  evidencia de página que identifica la contraseña dentro del `Blob`.
- **CA-I7 (E2E)** La página sigue funcionando igual: los envíos interceptados llegan a su destino.

## 9. Fuera de alcance

- `ReadableStream`, `EventSource`, `WebTransport` y `RTCDataChannel`.
- Resistencia a una página que restaure las funciones originales antes del interceptor.
