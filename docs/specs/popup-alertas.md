# Especificación: Popup y alertas (versión para la demo)

| Campo | Valor |
| --- | --- |
| Componente | Popup y alertas |
| Ubicación | `src/popup/` (interfaz), `src/background/tab-events.ts` (eventos por pestaña) y `manifest.json` (`action`) |
| Depende de | Motor de análisis (eventos `FlowEvent`), contratos compartidos |
| Estado | Borrador para revisión del equipo |

## 1. Propósito

Mostrarle al usuario, en la pestaña donde ocurre, que una credencial salió hacia un tercero o por un canal inseguro:
con el ícono de la extensión y con una lista de los flujos detectados en el popup. Esta versión es la mínima para la
demo; el grafo de flujos, las notificaciones del sistema y el panel de administración con PIN quedan para después.

## 2. Eventos por pestaña (Service Worker)

- `src/background/tab-events.ts` se suscribe a `subscribeToFlowEvents` y guarda, por pestaña, los **últimos 50**
  `FlowEvent` y el resumen de alertas (número de alertas y si hubo alguna crítica). Al llegar al límite descarta el
  evento más antiguo; el resumen no se reduce.
- Los guarda en **`chrome.storage.session`** (clave `tab:<tabId>`), además de en memoria, para que **sobrevivan a los
  reinicios del Service Worker**: Chrome lo detiene tras unos 30 s sin actividad. `storage.session` vive en la memoria
  del navegador, no se escribe en disco, se borra al cerrar Chrome y, con su nivel de acceso predeterminado, los
  content scripts no pueden leerlo. Solo contiene `FlowEvent`, que por contrato no tiene valores, huellas, rutas ni
  consultas, así que cumple la regla 1 de `AGENTS.md`.
- Lo leído de `storage.session` se valida antes de usarse; si no es válido, se descarta.
- Los eventos de una pestaña se borran cuando la pestaña se cierra. Al cerrar Chrome se borran todos. La persistencia
  en disco sigue siendo tarea del Registro de auditoría.

## 3. Alerta en el ícono

- `manifest.json` declara `action` con `default_popup` y `default_title: "CredFlow"`. No requiere permisos nuevos.
- Cada vez que una pestaña recibe un evento con severidad `critical` o `high`, el texto del ícono de esa pestaña
  (`chrome.action.setBadgeText`) muestra cuántos eventos de esas severidades tiene (máximo `"99+"`).
- Color del fondo (`chrome.action.setBadgeBackgroundColor`): rojo `#D93025` si hay al menos un evento `critical`;
  ámbar `#E37400` si solo hay `high`.
- Los eventos con severidad `none` (mismo sitio, proveedor autorizado) no cambian el ícono.
- Chrome borra el texto del ícono de una pestaña cuando esta navega a otra página. Por eso el ícono **se vuelve a
  aplicar** desde el resumen guardado cada vez que la pestaña termina de cargar (`chrome.tabs.onUpdated` con
  `status: "complete"`). Ese evento no requiere el permiso `tabs`, porque solo se usan el `tabId` y el estado.

## 4. Contrato entre el popup y el Service Worker

Nuevo contrato en `src/shared/types.ts`:

```ts
type GetTabEvents = { kind: "GET_TAB_EVENTS"; tabId: number };
type WatchedField = { fieldType: FieldType; site: string; since: string };
type TabEventsResponse = { events: FlowEvent[]; watched: WatchedField[] };
```

- El popup averigua la pestaña activa con `chrome.tabs.query({ active: true, currentWindow: true })`. Esta llamada no
  requiere el permiso `tabs`, porque solo se usa el `id`.
- Para las pruebas E2E, el popup también se puede abrir como página con el fragmento `#tabId=N` (N entero no negativo,
  validado con una expresión regular). Solo afecta a qué pestaña se consulta; la respuesta sigue limitada a páginas de
  la propia extensión.
- El Service Worker **solo responde** si el mensaje viene de una página de la propia extensión: `sender.id` es el de la
  extensión y `sender.url` empieza por `chrome-extension://<id de la extensión>/`. Un content script siempre envía con
  la URL de la página web en la que corre, así que no puede pedir los eventos de otras pestañas. No se usa la ausencia
  de `sender.tab` como criterio: una página de la extensión abierta en una pestaña también lo tiene.
- El mensaje se valida con un esquema estricto: exactamente `kind` y `tabId`, y `tabId` entero mayor o igual que 0.
- Respuesta: los eventos de esa pestaña, del más reciente al más antiguo.

## 5. Interfaz del popup

- Ancho de 380 px. Encabezado con el nombre de la extensión y el sitio de la pestaña (`pageSite` del evento más reciente).
- Una fila por evento con: hora local (HH:MM:SS), destino (`destinationOrigin`), tipo de campo en texto
  ("Contraseña" o "Tarjeta"; nunca el valor), veredicto en texto y severidad.
- Cada severidad lleva color **e** ícono de texto, para que el color no sea el único indicador:

| Veredicto | Texto | Severidad |
| --- | --- | --- |
| `third_party` | Enviada a un tercero no autorizado | ✗ crítica (rojo) |
| `insecure_channel` | Enviada por un canal sin cifrar | ✗ crítica (rojo) |
| `opaque_body` | Envío no inspeccionable a un tercero | ! alta (ámbar) |
| `credential_in_url` | Credencial en la URL | ! alta (ámbar) |
| `authorized_provider` | Enviada a un proveedor autorizado | ✓ normal (verde) |
| `same_site` | Enviada al mismo sitio | ✓ normal (verde) |
| `site_encrypted` | La página cifra la contraseña antes de enviarla · CredFlow no puede ver su contenido | ℹ informativo (azul) |
| `encrypted_third_party` | Contraseña cifrada enviada a un tercero | ! alta (ámbar) |

- **Campos vigilados:** cuando el Motor recibe huellas de una pestaña, registra en el estado de la pestaña el tipo de
  campo, el sitio (eTLD+1 de `sender.url`, que pone Chrome) y la hora del primer registro. El popup muestra arriba una
  tarjeta azul por tipo de campo: "Contraseña ingresada en este sitio · CredFlow vigila a dónde se envía". Así el popup
  nunca queda vacío cuando el usuario escribió una contraseña, aunque no se detecte ninguna salida. No cambia el ícono.
- Sin eventos ni campos vigilados: el texto "Sin flujos sensibles en esta pestaña".
- Al final, una sección plegable **"Cómo probar CredFlow"** (`<details>`), con texto fijo en el HTML, para quien pruebe
  la extensión sin conocer el proyecto: qué campos vigila, el mínimo de 6 caracteres, qué envíos detecta, qué
  significa cada color, cómo habilitar las páginas abiertas como archivo (`file://`), que en `localhost` el HTTP no se
  marca como inseguro, que algunos sitios cifran la contraseña (aviso azul, o ámbar si va a otro dominio) y que
  CredFlow detecta pero no bloquea.
- Si la respuesta no llega o falla: el texto genérico "No se pudo cargar la información", sin detalles técnicos.
- Todo el texto se inserta con `textContent`; no se usa `innerHTML` ni se cargan recursos externos. La CSP del manifiesto
  ya lo impide.

### 5.1. Script y evidencia

- Si el evento tiene `script`, la fila muestra una línea "Script: <nombre del archivo> (<origen>)", por ejemplo
  "Script: analytics.js (http://localhost:8124)".
- Si el evento tiene `evidence: "page"`, la fila agrega "Detectado en la página (encabezado / Blob / WebSocket)", para
  distinguirlo de lo detectado en la red.

### 5.2. Destinos de confianza

- Las filas con veredicto `third_party`, `opaque_body` o `encrypted_third_party` tienen un botón **"Confiar en
  <sitio de destino>"**. Al pulsarlo cambia a **"¿Confirmar?"**; un segundo clic agrega el sitio a `trustedSites` en
  `chrome.storage.local` (`docs/specs/motor-analisis.md`, sección 3.4). Las alertas ya mostradas no se borran; los
  envíos siguientes a ese sitio se clasifican como `authorized_provider`.
- No se ofrece para `insecure_channel`: un canal sin cifrar sigue siendo inseguro aunque el destino sea de confianza.
- Al final del popup, una sección plegable **"Destinos de confianza"** lista los sitios guardados, cada uno con un
  botón **"Quitar"**.
- Solo el popup (página de la extensión) escribe esta lista. Los content scripts no tienen ningún mensaje para
  modificarla, así que una página no puede marcar como de confianza el dominio al que roba.

## 6. Controles de seguridad

| Control | Referencia |
| --- | --- |
| Solo las páginas de la extensión pueden pedir eventos (no los content scripts) | ASVS 4.0.3 V4.1.3; STRIDE #1 |
| Mensaje validado con esquema estricto | ASVS 4.0.3 V5.1.3, V5.1.4 |
| Texto insertado solo con `textContent`; CSP sin scripts externos | ASVS 4.0.3 V5.3.3, V14.4.3; STRIDE #6 |
| El popup nunca muestra valores, solo el tipo de campo | AGENTS.md, regla 2 |
| Mensaje genérico ante errores | ASVS 4.0.3 V7.4.1 |
| Máximo 50 eventos por pestaña en memoria | STRIDE #5 |

## 7. Criterios de aceptación

- **CA-U1** `tab-events` guarda como máximo 50 eventos por pestaña y descarta el más antiguo.
- **CA-U2** El texto del ícono cuenta solo los eventos `critical` y `high`; muestra `"99+"` a partir de 100; el color es
  rojo si hay algún `critical` y ámbar si solo hay `high`.
- **CA-U3** El validador de `GET_TAB_EVENTS` rechaza campos adicionales y `tabId` negativos o no enteros.
- **CA-U4** El Service Worker no responde a `GET_TAB_EVENTS` si `sender.url` no es una página de la propia extensión
  (por ejemplo, un content script con la URL de una página web).
- **CA-U5** La función que convierte un evento en los textos de una fila devuelve los textos de la tabla de la sección 5
  y nunca incluye campos fuera del contrato.
- **CA-U6 (E2E)** En el escenario de robo del laboratorio, el ícono de la pestaña muestra "1" en rojo y el popup muestra
  una fila "Enviada a un tercero no autorizado" con el destino de métricas.
- **CA-U7** `src/popup/` no usa `innerHTML`, `outerHTML`, `insertAdjacentHTML` ni `document.write` (lo comprueba
  `npm run lint`), y una prueba verifica que `popup.html` no carga scripts ni estilos de otro origen.

- **CA-U8 (E2E)** Si el Service Worker se detiene después de detectar un robo, el popup sigue mostrando el evento.
- **CA-U9 (E2E)** Tras un robo seguido de una navegación de la pestaña a otra página, el ícono sigue mostrando la alerta.
- **CA-U10** `popup.html` contiene la sección "Cómo probar CredFlow" con el mínimo de 6 caracteres y la instrucción
  para habilitar `file://`.
- **CA-U11** El validador de lo leído de `storage.session` descarta datos con forma incorrecta.
- **CA-U12** `rowFor` produce los textos de `site_encrypted` (informativo, azul) y `encrypted_third_party` (alta).
- **CA-U13 (E2E)** En el escenario `cifrado` del laboratorio, el popup muestra "Contraseña ingresada en este sitio" y
  "La página cifra la contraseña antes de enviarla", y el ícono no cambia.
- **CA-U14 (E2E)** En el escenario `cifrado-robo`, el popup muestra "Contraseña cifrada enviada a un tercero" y el
  ícono queda en ámbar.

- **CA-U15** Una fila de un evento con `script` muestra el nombre del archivo y su origen; con `evidence: "page"`,
  indica dónde se detectó.
- **CA-U16** La función que decide si una fila ofrece "Confiar en…" lo hace para `third_party`, `opaque_body` y
  `encrypted_third_party`, y no para `insecure_channel` ni para los demás.
- **CA-U17 (E2E)** Tras confiar en el dominio de métricas desde el popup, un nuevo robo a ese dominio aparece como
  "Enviada a un proveedor autorizado"; tras quitarlo, vuelve a ser "Enviada a un tercero no autorizado".

## 8. Fuera de alcance

- Grafo de flujos, notificaciones del sistema y panel de administración con PIN.
- Eventos de diagnóstico en la interfaz.
- Persistencia de los eventos (Registro de auditoría).
