# Especificación: Motor de análisis (Service Worker)

| Campo | Valor |
| --- | --- |
| Componente | Motor de análisis |
| Ubicación | `src/background/` |
| Depende de | Puente de mensajes (`src/content/bridge.ts`), Configuración del administrador (`chrome.storage.managed`) |
| Lo usan | Registro de auditoría, Popup y alertas |
| Estado | Borrador para revisión del equipo |

## 1. Propósito

Detectar cuándo un dato sensible escrito por el usuario sale del navegador en una petición HTTP(S), y clasificar
ese flujo según su destino y su canal. Es la **capa autoritativa** de CredFlow: solo este componente confirma
una exfiltración.

## 2. Verificación técnica previa (hecha)

Resultado completo en `docs/verificaciones/webrequest-requestbody.md` (reproducible con
`node lab/spike-webrequest/run.mjs`).

- `chrome.webRequest.onBeforeRequest` con `extraInfoSpec: ["requestBody"]` y **sin** `"blocking"` entrega el cuerpo
  en Manifest V3 para texto, JSON, formularios, `URLSearchParams`, `ArrayBuffer`, `Uint8Array`, `keepalive`
  y `sendBeacon` con texto. **La capa de red es viable.**
- **Punto ciego:** con cuerpos `Blob`, `File` o `ReadableStream`, Chrome entrega `requestBody.error` en lugar del
  contenido, y en un multipart con archivo el contenido del archivo no llega. Se cubre con el veredicto
  `opaque_body` (sección 4.4).
- Por verificar: repetir la prueba en Google Chrome estable (se usó el Chromium de Playwright).

## 3. Entradas

### 3.1. Registro de huellas (desde el Puente de mensajes)

Mensaje recibido con `chrome.runtime.onMessage`:

```ts
type RegisterFingerprints = {
  kind: "REGISTER_FINGERPRINTS";
  fieldType: "password" | "card" | "custom";
  fingerprints: Array<{
    encoding: "original" | "base64" | "url" | "hex" | "reversed" | null; // null solo en opaque_body
    value: string;
  }>;
};
```

El `tabId` se toma de `sender.tab.id`, **nunca** del contenido del mensaje.

### 3.2. Peticiones salientes

`chrome.webRequest.onBeforeRequest` para `<all_urls>`, con `extraInfoSpec: ["requestBody"]`. Campos usados:
`requestId`, `tabId`, `url`, `method`, `type`, `initiator`, `requestBody`, `timeStamp`.

### 3.3. Configuración del administrador

Leída de `chrome.storage.managed` al iniciar y en `chrome.storage.onChanged` (área `managed`):

```ts
type ManagedConfig = {
  authorizedProviders: string[]; // dominios registrables, p. ej. "accounts.google.com" → se compara por eTLD+1
};
```

Si no hay configuración, `authorizedProviders` es una lista vacía.

### 3.4. Destinos de confianza del usuario

El usuario puede marcar desde el popup un destino como "de confianza" (`docs/specs/popup-alertas.md`, sección 6).
Se guardan en `chrome.storage.local` con la clave `trustedSites`: una lista de hasta 100 dominios registrables. El
Motor la lee al iniciar y en cada cambio (`chrome.storage.onChanged`, área `local`), la valida (solo nombres de host
válidos, normalizados a eTLD+1) y la **une** a `authorizedProviders`: un destino de confianza se trata igual que un
proveedor autorizado. No contiene datos sensibles.

## 4. Reglas

### 4.1. Validación del mensaje de registro

Se descarta el mensaje (sin error visible para la página) si no se cumple **todo** lo siguiente:

1. `sender.id === chrome.runtime.id` y `sender.tab?.id` es un número ≥ 0.
2. `kind === "REGISTER_FINGERPRINTS"` y no hay campos adicionales.
3. `fieldType` es uno de los tres valores permitidos.
4. `fingerprints` es un arreglo de 1 a 5 elementos, sin `encoding` repetidos.
5. Cada `value` es un string de 6 a 1024 caracteres.

### 4.2. Almacenamiento de huellas

- Solo en memoria: `Map<tabId, Array<{ fieldType, encoding, value, expiresAt }>>`.
- `expiresAt = ahora + 30 000 ms`. Un registro nuevo del mismo campo reemplaza al anterior.
- Las huellas vencidas se eliminan antes de cada búsqueda y, además, cada registro se elimina con un temporizador
  al cumplir sus 30 s, aunque la pestaña no haga más peticiones (ASVS 4.0.3 V8.3.6).
- Al cerrar la pestaña (`chrome.tabs.onRemoved`) se eliminan sus huellas.
- Si el Service Worker se reinicia, las huellas se pierden. Es aceptable: el usuario volverá a escribir.

### 4.3. Búsqueda

Para cada petición de una pestaña con huellas activas:

1. Se arma el texto a analizar:
   - **URL:** la URL completa y su versión decodificada con `decodeURIComponent` (si falla, solo la original).
   - **Cuerpo:** si hay `formData`, todos los valores unidos; si hay `raw`, los bytes decodificados con
     `TextDecoder("utf-8")` sin modo estricto.
2. Límite de análisis: los primeros **256 KB** del cuerpo. Si el cuerpo es mayor, se analiza ese tramo y el evento
   se marca con `truncated: true`.
3. Coincidencia exacta y sensible a mayúsculas de cada huella; para `hex`, sin distinguir mayúsculas.
4. Se registra **un solo evento por petición**: el de la primera huella encontrada, priorizando el cuerpo sobre la URL.
5. **Cuerpo opaco:** si `requestBody.error` existe, o alguna parte de `raw` trae `file` en lugar de `bytes`, el cuerpo
   no se puede inspeccionar. Se sigue buscando en la URL y, si no hay coincidencia, se aplica la sección 4.5.

### 4.4. Clasificación

Se evalúa en este orden y gana la primera regla que aplique:

| # | Condición | Veredicto | Severidad |
| --- | --- | --- | --- |
| 1 | El esquema de la URL es `http:` o `ws:` y el host no es de bucle local | `insecure_channel` | crítica |
| 2 | El eTLD+1 del destino es distinto del de la página y no está en `authorizedProviders` | `third_party` | crítica |
| 3 | La huella se encontró en la URL (cualquier destino) | `credential_in_url` | alta |
| 4 | El eTLD+1 del destino está en `authorizedProviders` | `authorized_provider` | ninguna |
| 5 | El eTLD+1 del destino es igual al de la página | `same_site` | ninguna |

- El sitio de la página se obtiene de `details.initiator`. Si no existe, se usa el último sitio conocido de la pestaña.
- El eTLD+1 se calcula con `tldts` (`getDomain`). Si `tldts` no puede calcularlo (por ejemplo, una IP), se compara
  el host completo.
- **Hosts de bucle local:** `localhost`, `*.localhost`, cualquier dirección `127.0.0.0/8` y `[::1]`. Se tratan como
  seguros aunque usen `http:` o `ws:`, como los orígenes "potencialmente confiables" de la norma W3C *Secure Contexts*:
  ese tráfico no sale del equipo. Esto permite el laboratorio de `docs/specs/laboratorio.md`.

### 4.5. Cuerpos no inspeccionables

Chrome no entrega el contenido de los cuerpos `Blob`, `File` ni `ReadableStream` (ver la verificación técnica).
Para que envolver el dato en un `Blob` no sirva para evadir la detección:

- Si la pestaña tiene huellas activas, el cuerpo es opaco, no hubo coincidencia en la URL y el destino es un tercero
  no autorizado (eTLD+1 distinto del de la página y fuera de `authorizedProviders`), se emite un evento con veredicto
  `opaque_body`, severidad **alta**, `location: "body"` y `encoding: null`.
- Si el destino es el mismo sitio o un proveedor autorizado, no se emite evento.
- Si además el esquema es `http:` o `ws:` y el host no es de bucle local, el veredicto es `insecure_channel` / crítica,
  como en la regla 1.

### 4.6. Errores de análisis

Un error al procesar un mensaje o una petición se captura y no detiene el análisis de las siguientes. Para que los
errores no pasen desapercibidos (una página podría provocarlos a propósito para evadir el análisis):

- El Motor cuenta en memoria los errores en ventanas de 60 s.
- Cuando una ventana llega a **5 errores**, emite un `DiagnosticEvent` con `kind: "analysis_errors"`, la hora en UTC,
  el número de errores y la duración de la ventana. Como máximo emite uno por ventana.
- El evento no contiene datos de la petición ni del mensaje que falló: ni URL, ni cuerpo, ni huellas, ni el texto
  del error.

### 4.7. Contraseña cifrada por la página

Algunos sitios (Facebook, Instagram, varios bancos) cifran o transforman la contraseña en el navegador antes de
enviarla. Ninguna huella coincide, así que sin esta regla CredFlow no mostraría nada.

- Se aplica cuando la pestaña tiene huellas activas, ni el cuerpo ni la URL contienen una huella y el cuerpo se pudo
  leer (no es opaco).
- Del cuerpo se extraen pares campo-valor: de `formData`; del texto `raw` si tiene forma de formulario codificado
  (`a=1&b=2`); y del texto `raw` si es JSON, recorriendo objetos hasta 3 niveles.
- Hay **contraseña cifrada** si algún campo cumple una de estas condiciones:
  1. **Formato conocido:** el valor empieza por `#PWD_BROWSER:` (Facebook) o `#PWD_INSTAGRAM_BROWSER:` (Instagram).
  2. **Heurística:** el nombre del campo contiene `pass`, `pwd`, `clave`, `contrasena`, `contraseña`, `encpass`,
     `cipher` o `crypt` (sin distinguir mayúsculas), y su valor tiene **32 caracteres o más** y solo caracteres de
     Base64, Base64 URL o hexadecimal (opcionalmente con un prefijo de formato separado por `:` o `$`, como los hashes
     `$2b$...`).
- Veredicto:
  - Destino del mismo sitio o proveedor autorizado → **`site_encrypted`**, severidad **ninguna** (informativo).
  - Destino de un tercero no autorizado → **`encrypted_third_party`**, severidad **alta**: cifrar no impide el robo
    si quien recibe tiene la clave.
- El evento lleva `encoding: null`, `location: "body"` y el tipo del primer campo vigilado. **No** incluye el nombre
  ni el valor del campo detectado.
- CredFlow no puede comprobar que el cifrado sea fuerte; el texto para el usuario dice que la página "cifra o
  transforma" la contraseña, no que sea segura.

### 4.8. Atribución del script

- El Motor guarda en memoria, por pestaña, los últimos 50 `PageReport` recibidos (`docs/specs/interceptor-pagina.md`),
  con su hora de llegada, durante 10 s.
- Al crear un evento a partir de la capa de red, busca un reporte de la misma pestaña con **la misma URL** recibido
  hasta 3 s antes o después; si lo hay, el evento lleva su `script`. Si no, `script: null`.

### 4.9. Evidencia de la página

Para lo que la red no ve, un `PageReport` con `extra` genera su propio análisis:

- Solo si la pestaña tiene huellas activas. Se buscan las huellas en `extra.text` con las mismas reglas de la
  sección 4.3.
- Si hay coincidencia, se clasifica con las reglas de la sección 4.4 usando la URL del reporte (sitio de la página =
  el del remitente). La ubicación del evento es `header`, `body` (para `blob`) o `websocket`.
- El evento lleva `evidence: "page"` y el `script` del reporte. Los eventos de la capa de red llevan
  `evidence: "network"`.
- Un evento de página nunca reemplaza ni elimina un evento de red.

## 5. Salida

Evento emitido hacia el Registro de auditoría y el Popup:

```ts
type FlowEvent = {
  id: string;                 // crypto.randomUUID()
  timestamp: string;          // ISO 8601 en UTC
  tabId: number;
  pageSite: string;           // eTLD+1 de la página
  destinationOrigin: string;  // solo el origen (esquema + host + puerto), nunca la ruta ni la consulta
  destinationSite: string;    // eTLD+1 del destino
  method: string;
  requestType: string;        // details.type
  fieldType: "password" | "card" | "custom";
  encoding: "original" | "base64" | "url" | "hex" | "reversed";
  location: "body" | "url" | "header" | "websocket";
  truncated: boolean;
  verdict:
    | "insecure_channel"
    | "third_party"
    | "opaque_body"
    | "credential_in_url"
    | "authorized_provider"
    | "same_site"
    | "site_encrypted"
    | "encrypted_third_party";
  severity: "critical" | "high" | "none";
  script: string | null;      // script que hizo la petición (sección 4.8), origen + ruta
  evidence: "network" | "page"; // capa que produjo el evento (sección 4.9)
};
```

El evento **nunca** contiene el valor ni la huella, ni la URL completa: la ruta y la consulta pueden incluir el dato sensible.

## 6. Controles de seguridad

| Control | Referencia |
| --- | --- |
| Huellas solo en memoria con caducidad de 30 s; ningún valor en eventos, logs ni `console.*` | ASVS 4.0.3 V8.2.2, V7.1.1; STRIDE #4 |
| Validación estricta del mensaje y `tabId` tomado del remitente | ASVS 4.0.3 V5.1.3; STRIDE #1 |
| Límite de 256 KB por cuerpo y análisis solo en pestañas con huellas activas | ASVS 4.0.3 V11.1.4; STRIDE #5 |
| Un error al analizar una petición se captura y no detiene el listener | ASVS 4.0.3 V7.4.1 |
| Un cuerpo no inspeccionable hacia un tercero se reporta como `opaque_body`, para que un `Blob` no sirva de evasión | STRIDE #2 |

## 7. Criterios de aceptación

Cada criterio necesita al menos una prueba (unitaria con Vitest salvo que se indique E2E).

- **CA-1** Un mensaje con un campo adicional, un `encoding` repetido, 6 huellas o un `value` de 5 caracteres se descarta.
- **CA-2** Un mensaje cuyo `sender.id` no es el de la extensión se descarta.
- **CA-3** Una huella registrada hace más de 30 s no produce coincidencias.
- **CA-4** Al cerrar la pestaña se eliminan sus huellas.
- **CA-5** Una contraseña en Base64 dentro de un cuerpo JSON enviado a otro sitio produce `third_party` / `critical`
  con `encoding: "base64"` y `location: "body"`.
- **CA-6** Un formulario enviado por `http:` al mismo sitio produce `insecure_channel` / `critical`.
- **CA-7** Una contraseña en la consulta de una URL del mismo sitio produce `credential_in_url` / `high`.
- **CA-8** Un envío a un dominio de `authorizedProviders` produce `authorized_provider` / `none`.
- **CA-9** Un envío al mismo sitio por HTTPS en el cuerpo produce `same_site` / `none`.
- **CA-10** `tienda.example.co.uk` y `api.example.co.uk` se consideran el mismo sitio (prueba de `tldts`).
- **CA-11** Ningún `FlowEvent` contiene el valor, una huella, la ruta ni la consulta de la URL (prueba que serializa
  el evento y busca la huella).
- **CA-12** Un cuerpo de 1 MB se analiza solo en sus primeros 256 KB y el evento lleva `truncated: true`.
- **CA-13 (E2E)** En el laboratorio, la página de la tienda con el script de "analítica" genera una alerta
  `third_party` hacia el dominio de métricas.
- **CA-14** Con huellas activas, una petición a un tercero no autorizado con `requestBody.error` produce
  `opaque_body` / `high` con `encoding: null`.
- **CA-15** Con huellas activas, una petición al mismo sitio con `requestBody.error` no produce evento.
- **CA-16** Sin huellas activas en la pestaña, una petición con `requestBody.error` no produce evento.
- **CA-18** Un registro se elimina de la memoria al cumplir 30 s aunque no llegue ninguna petición de esa pestaña.
- **CA-19** Cinco errores dentro de 60 s producen un único `DiagnosticEvent` sin datos de la petición; cuatro errores no
  producen ninguno, y una ventana nueva vuelve a contar desde cero.
- **CA-20** Un envío por `http:` a `localhost`, `127.0.0.1`, `app.localhost` o `[::1]` no produce `insecure_channel`;
  el mismo envío a `http://tienda.lab` sí.
- **CA-17 (E2E)** En el laboratorio, enviar la contraseña dentro de un `Blob` con `fetch` hacia el dominio de
  métricas produce una alerta `opaque_body`.

- **CA-21** Con huellas activas, un formulario al mismo sitio con `encpass=#PWD_BROWSER:5:...` produce `site_encrypted`
  sin severidad; el mismo cuerpo hacia un tercero produce `encrypted_third_party` / `high`.
- **CA-22** Un JSON con `{"login": {"password": "<64 caracteres hexadecimales>"}}` produce `site_encrypted`; un campo con
  un valor corto (`password=abc`) o con un nombre que no es de contraseña (`token=<64 hex>`) no lo produce.
- **CA-23** El evento `site_encrypted` no contiene el nombre ni el valor del campo detectado.

- **CA-24** Con un destino en `trustedSites`, un envío a ese destino produce `authorized_provider` / `none`; una lista
  con entradas inválidas (URL completas, números) las ignora.
- **CA-25** Un evento de red lleva el `script` de un `PageReport` de la misma pestaña y URL recibido 3 s antes o después,
  y `script: null` si no hay ninguno.
- **CA-26** Un `PageReport` con la contraseña en `extra` (encabezado, `Blob` o WebSocket) hacia otro sitio produce un
  evento `third_party` con `evidence: "page"` y la ubicación correspondiente; sin huellas activas no produce nada.

## 8. Fuera de alcance

- Mensajes WebSocket posteriores al handshake y tráfico de Service Workers o Web Workers de la página.
- Datos cifrados por el atacante antes de enviarse (los reporta el interceptor de página, no este componente).
- Bloquear peticiones.
