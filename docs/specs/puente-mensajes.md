# Especificación: Puente de mensajes (content script)

| Campo | Valor |
| --- | --- |
| Componente | Puente de mensajes |
| Ubicación | `src/content/bridge.ts` y entrada `content_scripts` en `manifest.json` |
| Depende de | Contratos compartidos (`src/shared/fingerprints.ts`, `src/shared/types.ts`) |
| Lo usa | Motor de análisis (`docs/specs/motor-analisis.md`, sección 3.1) |
| Estado | Borrador para revisión del equipo |

## 1. Propósito

Detectar cuándo el usuario escribe en un campo sensible de la página, generar las huellas del valor y enviárselas al
Motor de análisis para que pueda reconocerlas en las peticiones salientes. Es la única pieza que ve el valor escrito, y
lo mantiene en memoria solo el tiempo necesario para generar las huellas.

## 2. Dónde se ejecuta

- Content script declarado en `manifest.json`, en el **mundo aislado** (el predeterminado), no en el mundo `MAIN`:
  el código de la página no puede leer sus variables ni sus mensajes.
- `matches: ["<all_urls>"]`, `all_frames: true` y `run_at: "document_start"`. No requiere permisos nuevos:
  `<all_urls>` ya está en `host_permissions`.
- El interceptor de APIs en el mundo `MAIN` (atribución por traza de pila) queda **fuera de esta especificación**.

## 3. Campos sensibles

Un elemento es sensible si es un `<input>` y cumple una de estas condiciones:

| Condición | `fieldType` |
| --- | --- |
| `type="password"` | `password` |
| El atributo `autocomplete` contiene el token `cc-number` o `cc-csc` | `card` |

Cualquier otro campo se ignora. El tipo `custom` (campos definidos por el administrador) queda fuera de esta especificación.

## 4. Reglas

### 4.1. Detección de lo que escribe el usuario

- Un único listener del evento `input` en `document`, en fase de captura. Así se detectan también los campos que la
  página agrega después de cargar, sin recorrer el DOM.
- Se ignoran los eventos con `event.isTrusted === false`: un script de la página no puede inyectar valores falsos
  disparando eventos sintéticos (STRIDE #1). El autocompletado del navegador genera eventos de confianza y sí se procesa.
- Un campo solo se envía si el usuario escribió en él con eventos de confianza. Así, un script que cambia el valor por
  código y luego llama a `requestSubmit()` no consigue que se registren huellas al enviar el formulario.

### 4.2. Cuándo se envían las huellas

- Tras **300 ms sin escribir** en ese campo (espera por campo, para no enviar un mensaje por cada tecla).
- **De inmediato**, cancelando la espera, cuando el campo pierde el foco (`blur`), cuando el usuario pulsa Enter en él
  o cuando se envía su formulario (`submit`, en fase de captura). Esto evita que un envío rápido ocurra antes de que el
  Motor tenga las huellas.
- Si el valor no cambió desde el último envío de ese campo, no se reenvía.
- **Refresco antes de envíos por JavaScript:** las huellas caducan a los 30 s en el Motor. Si el usuario escribe y
  tarda en actuar, un envío hecho por un script al pulsar un botón (sin formulario) ya no se detectaría. Por eso, ante
  un clic de confianza (`pointerdown` en fase de captura, `isTrusted`) en cualquier parte de la página, se reenvían las
  huellas de los campos sensibles del documento en los que el usuario escribió, si su último envío fue hace más de
  **10 s**. El clic ocurre antes de que la página procese su manejador, así que el Motor recibe las huellas antes del
  envío.
- Por campo solo se guarda la hora del último envío (un número), nunca el valor.

### 4.3. Contenido del mensaje

- Las huellas se generan con `buildFingerprints(value)` de `src/shared/fingerprints.ts`.
- Si el resultado está vacío (valor de menos de 6 caracteres), no se envía nada.
- Se envía con `chrome.runtime.sendMessage` un objeto `RegisterFingerprints` exacto:
  `{ kind: "REGISTER_FINGERPRINTS", fieldType, fingerprints }`, sin ningún otro campo (ni `tabId`, ni URL).
- Si el envío falla (por ejemplo, el Service Worker se está reiniciando), el error se captura y se descarta en silencio.

### 4.4. Manejo del valor

- El valor solo existe en variables locales de la función que genera las huellas. No se guarda en el DOM, en
  `chrome.storage`, en `console.*` ni en variables globales.
- Para la espera de 300 ms se guarda por campo solo el identificador del temporizador y una marca de "ya enviado"
  (en un `WeakMap` cuya clave es el elemento), nunca el valor.

## 5. Pruebas sin navegador

La lógica que no necesita el DOM se escribe como funciones puras para probarla con Vitest:
`fieldTypeOf({ type, autocomplete })` y la construcción del mensaje. El comportamiento con eventos reales se prueba
de extremo a extremo con Playwright en el laboratorio (`docs/specs/laboratorio.md`), porque `jsdom` no está en la lista
de dependencias permitidas.

## 6. Controles de seguridad

| Control | Referencia |
| --- | --- |
| Mundo aislado: la página no ve el valor ni los mensajes | STRIDE #1 y #4 |
| Se ignoran los eventos sintéticos (`isTrusted === false`) | ASVS 4.0.3 V5.1.3; STRIDE #1 |
| El valor nunca se persiste, registra ni guarda fuera de la función | ASVS 4.0.3 V8.2.2, V7.1.1; STRIDE #4 |
| Mensaje con el contrato exacto; el `tabId` lo pone Chrome en el remitente | ASVS 4.0.3 V5.1.4 |
| Espera de 300 ms por campo: limita el número de mensajes por segundo | STRIDE #5 |

## 7. Criterios de aceptación

- **CA-P1** `fieldTypeOf` devuelve `password` para `type="password"`, `card` para `autocomplete` con `cc-number` o
  `cc-csc` (también entre otros tokens, por ejemplo `"section-pago cc-number"`) y `null` para cualquier otro campo.
- **CA-P2** La construcción del mensaje produce exactamente `{ kind, fieldType, fingerprints }` y devuelve `null` si el
  valor tiene menos de 6 caracteres.
- **CA-P3 (E2E)** Al escribir la contraseña ficticia en el laboratorio, el Motor recibe las huellas: un envío posterior
  a otro sitio genera un evento.
- **CA-P4 (E2E)** Un evento `input` sintético (creado por un script de la página) no registra huellas.
- **CA-P5 (E2E)** Un campo de contraseña agregado a la página después de cargar también se vigila.
- **CA-P6 (E2E)** Si el formulario se envía inmediatamente después de escribir (sin esperar 300 ms), el envío se detecta.
  *Por verificar:* que el mensaje del Puente llegue al Service Worker antes que la petición del formulario. Si la
  prueba muestra que no siempre ocurre, se reporta al equipo antes de continuar.
- **CA-P7 (E2E)** Escribir en un campo de texto normal no envía ningún mensaje.

- **CA-P8 (E2E)** Si el usuario escribe la contraseña, espera más de 30 s y pulsa un botón que la envía por
  JavaScript a otro sitio, el envío se detecta.
- **CA-P9** La decisión de reenviar (`shouldRefresh`) es verdadera solo si hubo escritura real y pasaron más de 10 s desde
  el último envío.

## 8. Fuera de alcance

- Interceptor en el mundo `MAIN` y atribución por traza de pila.
- Campos `custom` definidos por el administrador.
- Exfiltración letra por letra (un keylogger que envía cada tecla): las huellas son del valor completo.
- Campos dentro de Shadow DOM cerrado.
