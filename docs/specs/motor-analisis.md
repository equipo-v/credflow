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

## 2. Requisito previo: verificación técnica (hacer primero)

Antes de implementar el resto, construir una extensión mínima que confirme que
`chrome.webRequest.onBeforeRequest`, registrado con `extraInfoSpec: ["requestBody"]` y **sin** `"blocking"`,
entrega `details.requestBody` (`formData` y `raw`) en una extensión Manifest V3 instalada en modo desarrollador.

- Si funciona: continuar con esta especificación.
- Si no funciona: **detener** y reportarlo en el issue; la capa de red debe rediseñarse antes de continuar.

Probar al menos: envío de formulario (`application/x-www-form-urlencoded`), `fetch` con cuerpo JSON
y `navigator.sendBeacon` con texto.

## 3. Entradas

### 3.1. Registro de huellas (desde el Puente de mensajes)

Mensaje recibido con `chrome.runtime.onMessage`:

```ts
type RegisterFingerprints = {
  kind: "REGISTER_FINGERPRINTS";
  fieldType: "password" | "card" | "custom";
  fingerprints: Array<{
    encoding: "original" | "base64" | "url" | "hex" | "reversed";
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
- Las huellas vencidas se eliminan antes de cada búsqueda.
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

### 4.4. Clasificación

Se evalúa en este orden y gana la primera regla que aplique:

| # | Condición | Veredicto | Severidad |
| --- | --- | --- | --- |
| 1 | El esquema de la URL es `http:` o `ws:` | `insecure_channel` | crítica |
| 2 | El eTLD+1 del destino es distinto del de la página y no está en `authorizedProviders` | `third_party` | crítica |
| 3 | La huella se encontró en la URL (cualquier destino) | `credential_in_url` | alta |
| 4 | El eTLD+1 del destino está en `authorizedProviders` | `authorized_provider` | ninguna |
| 5 | El eTLD+1 del destino es igual al de la página | `same_site` | ninguna |

- El sitio de la página se obtiene de `details.initiator`. Si no existe, se usa el último sitio conocido de la pestaña.
- El eTLD+1 se calcula con `tldts` (`getDomain`). Si `tldts` no puede calcularlo (por ejemplo, una IP), se compara
  el host completo.

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
  location: "body" | "url";
  truncated: boolean;
  verdict: "insecure_channel" | "third_party" | "credential_in_url" | "authorized_provider" | "same_site";
  severity: "critical" | "high" | "none";
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

## 8. Fuera de alcance

- Mensajes WebSocket posteriores al handshake y tráfico de Service Workers o Web Workers de la página.
- Datos cifrados por el atacante antes de enviarse (los reporta el interceptor de página, no este componente).
- Bloquear peticiones.
