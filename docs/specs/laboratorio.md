# Especificación: Laboratorio de pruebas y demo

| Campo | Valor |
| --- | --- |
| Componente | Laboratorio de pruebas |
| Ubicación | `lab/demo/` (sitio y servidor) y `tests/e2e/` (pruebas de extremo a extremo) |
| Depende de | La extensión compilada (`dist/`) |
| Estado | Borrador para revisión del equipo |

## 1. Propósito

Simular, en el propio equipo y sin Internet, una tienda en línea cuyo formulario de inicio de sesión es atacado por un
script de "analítica" comprometido (ataque tipo Magecart), para demostrar que CredFlow detecta el robo y para comprobar
automáticamente los criterios de aceptación de extremo a extremo.

## 2. Sitios

Un servidor Node.js sin dependencias (`lab/demo/server.mjs`) escucha en el puerto **8124** y sirve dos sitios que
CredFlow considera distintos:

| Sitio | URL | Papel |
| --- | --- | --- |
| Tienda | `http://localhost:8124` | Sitio legítimo con el formulario de inicio de sesión |
| Métricas | `http://127.0.0.1:8124` | Dominio del atacante que recibe la credencial robada |

El servidor responde `204` a cualquier `POST` a `/recibir/*`, permite CORS para que el envío entre sitios funcione y
**no guarda en disco** lo que recibe. Lo que muestra está limitado por la sección 6.

Ambos sitios usan HTTP sin cifrar en la dirección de bucle local. Ver la sección 5 sobre cómo afecta al veredicto.

## 3. Escenarios

La tienda (`/`) carga el formulario y un `analytics.js` cuyo comportamiento se elige con el parámetro `?escenario=`:

| Escenario | Qué hace el script | Veredicto esperado |
| --- | --- | --- |
| `limpio` | Nada. El formulario se envía a la propia tienda (`POST /recibir/login`). | `same_site`, sin alerta |
| `robo` | Al enviar el formulario, manda la contraseña en Base64 con `navigator.sendBeacon` a Métricas. | `third_party`, crítica |
| `robo-blob` | Igual, pero dentro de un `Blob` con `fetch`. | `opaque_body`, alta (red) y `third_party`, crítica, con evidencia de página (Blob) |
| `url` | Manda la contraseña en la consulta de la URL a la propia tienda. | `credential_in_url`, alta |
| `robo-navega` | Como `robo`, pero el formulario se envía de verdad y la tienda redirige a `/bienvenida`, como un sitio real. | `third_party`, crítica; el ícono sigue en rojo tras navegar |
| `cifrado` | Como Facebook: cifra la contraseña con Web Crypto (RSA-OAEP) y envía `encpass=#PWD_BROWSER:5:<hora>:<cifrado>` a la propia tienda. | `site_encrypted`, informativo |
| `cifrado-robo` | Cifra igual, pero el script envía el valor cifrado al dominio de métricas. | `encrypted_third_party`, alta |
| `robo-encabezado` | El script manda la contraseña en Base64 dentro del encabezado `X-Token` de un `fetch` a Métricas (el cuerpo va vacío). | `third_party`, crítica, con evidencia de página (encabezado) |
| `robo-websocket` | El script abre un WebSocket con Métricas (`ws://127.0.0.1:<puerto>/ws`) y envía la contraseña en un mensaje. | `third_party`, crítica, con evidencia de página (WebSocket) |

La contraseña ficticia del laboratorio es `Prueba#2026`. La página muestra en grande el escenario activo y un texto
que aclara que es un laboratorio con datos ficticios.

## 4. Demo manual y pruebas automáticas

- **Demo manual:** `npm run lab` inicia el servidor e imprime las URLs de cada escenario. Se carga `dist/` en
  `chrome://extensions` (modo desarrollador), se abre un escenario, se escribe la contraseña y se envía el formulario.
- **Pruebas automáticas:** `npm run test:e2e` compila la extensión, inicia el servidor, abre Chromium con la extensión
  cargada mediante Playwright y recorre cada escenario escribiendo la contraseña **con eventos de teclado reales**.
  Comprueba el ícono, el popup y, cuando aplique, que no hubo evento. Guarda una captura de pantalla del popup por
  escenario en `test-results/` como evidencia.
- Las pruebas E2E cubren CA-13 y CA-17 del Motor, CA-P3 a CA-P8 del Puente y CA-U6 a CA-U9 del Popup.

## 5. Cambio necesario en el Motor: direcciones de bucle local

Con la regla 1 actual del Motor, **toda** petición `http:` es `insecure_channel`. Como el laboratorio usa HTTP en
`localhost`, todos los escenarios darían "canal sin cifrar" y no se podrían distinguir.

Se propone, en `docs/specs/motor-analisis.md` (sección 4.4), tratar como seguras las direcciones de bucle local
(`localhost`, `*.localhost`, `127.0.0.0/8` y `[::1]`), como hace la norma W3C *Secure Contexts* con los orígenes
"potencialmente confiables". El tráfico a esas direcciones no sale del equipo, así que no hay canal de red que cifrar.

El escenario de canal sin cifrar (`insecure_channel`) se prueba en las pruebas automáticas con un nombre de host que
no es de bucle local (`http://tienda.lab:8124`), redirigido a `127.0.0.1` con la opción de Chromium
`--host-resolver-rules`. En la demo manual es opcional y requiere agregar `tienda.lab` al archivo `hosts`.

## 6. Vista del atacante

Para que la demo muestre el robo desde el lado del atacante, `npm run lab` activa por defecto una vista de lo que recibe
cada sitio (`--silencioso` la desactiva; las pruebas E2E la usan desactivada):

- **Terminal:** una línea por cada petición a `/recibir/*`, con la hora, quién la recibe (`tienda` o `ATACANTE`, según
  si el host es `localhost` o `127.0.0.1`), el canal (`login`, `beacon`, `blob`, `consulta`) y el dato.
- **Panel del atacante:** `http://127.0.0.1:8124/panel`, una página que se recarga cada 2 s y lista las últimas 20
  credenciales que llegaron al dominio de métricas. Se guarda solo en memoria y se vacía al detener el servidor. El
  contenido se escapa antes de insertarlo en el HTML.
- **Solo se muestra la contraseña ficticia.** El servidor busca `Prueba#2026` en claro, codificada para URL o en
  Base64, e indica cómo llegó. Cualquier otro valor se reemplaza por "datos recibidos (ocultos: no contienen la
  contraseña del laboratorio)". Así, si alguien escribe por error una contraseña real, no aparece en pantalla. El
  usuario nunca se muestra.

## 7. Controles

| Control | Referencia |
| --- | --- |
| Solo credenciales ficticias | AGENTS.md (Pruebas) |
| El servidor solo escucha en `127.0.0.1` y `localhost`, no en la red local | Evita exponer el laboratorio a otros equipos |
| El servidor no guarda en disco lo que recibe y solo muestra la contraseña ficticia; cualquier otro valor se oculta | ASVS 4.0.3 V7.1.1 |
| Sin dependencias nuevas: servidor con `node:http`, pruebas con `playwright` (ya permitido) | AGENTS.md (Dependencias) |

## 8. Criterios de aceptación

- **CA-L1** `npm run lab` inicia el servidor solo en interfaces de bucle local y responde en las dos URLs.
- **CA-L2** Cada escenario de la sección 3 produce exactamente el veredicto esperado y ningún otro evento crítico.
- **CA-L3** `npm run test:e2e` termina con éxito en un equipo sin conexión a Internet y deja una captura por escenario.
- **CA-L6** El servidor acepta el handshake de WebSocket solo en `/ws`, lee mensajes de texto de hasta 64 KB y la
  vista del atacante muestra la contraseña ficticia que llega por WebSocket o en el encabezado `X-Token`.
- **CA-L4** Ningún archivo del laboratorio ni de las pruebas contiene una credencial real.
- **CA-L5** La vista del atacante muestra `Prueba#2026` cuando llega en claro, codificada para URL o en Base64, y oculta
  cualquier otro valor; el panel solo lista lo recibido por el dominio de métricas.

## 9. Fuera de alcance

- HTTPS con certificados en el laboratorio.
- Escenarios de keyloggers.
