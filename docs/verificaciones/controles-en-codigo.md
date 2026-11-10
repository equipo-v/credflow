# Investigación: cómo se aplican los controles de seguridad en el código de CredFlow

| Campo | Valor |
| --- | --- |
| Fecha | 3 de noviembre de 2026 |
| Código revisado | Rama `feature/motor-analisis`, commit `6e4bbe7` (configuración, contratos compartidos y Motor de análisis) |
| Normas | OWASP ASVS 4.0.3 (texto tomado del repositorio oficial `OWASP/ASVS`, etiqueta `v4.0.3`) y NIST SP 800-218 (SSDF) v1.1 |
| Vulnerabilidades | `npm audit` (base de avisos de GitHub). La búsqueda directa en el NVD (`nvd.nist.gov`) no fue posible desde el entorno de desarrollo; los CVE citados se pueden buscar allí para confirmar. |

Resultado: **9 controles investigados**. 5 están bien implementados, 3 tienen aspectos por mejorar y 1 tiene un fallo.

## Resumen

| # | Control | Archivo y línea | Norma | Resultado |
| --- | --- | --- | --- | --- |
| 1 | Validación estricta de lo que llega de la página | `src/shared/validators.ts:43-61` | ASVS 5.1.3, 5.1.4 | Bien |
| 2 | Verificación del remitente del mensaje | `src/shared/validators.ts:67-75`, `src/background/index.ts:31` | ASVS 4.1.3 | Bien |
| 3 | Credenciales solo en memoria y su eliminación | `src/background/fingerprint-store.ts:23-47` | ASVS 8.2.2, 8.3.6 | Falta mejorar |
| 4 | Los eventos no contienen credenciales | `src/background/analyze.ts:104-118` | ASVS 7.1.1 | Bien |
| 5 | Sin ejecución dinámica ni XSS | `eslint.config.js:13-45`, `manifest.json:15-17` | ASVS 5.2.4, 5.3.3, 14.4.3 | Bien (mejora menor) |
| 6 | Límite de tamaño de lo que se analiza | `src/shared/constants.ts:14`, `src/background/request-body.ts:23-88` | ASVS 12.1.1 | Bien |
| 7 | Manejo de errores | `src/background/index.ts:17-20, 36-38, 69-71` | ASVS 7.4.1, 7.4.2 | Falta mejorar |
| 8 | Mínimo privilegio en los permisos | `manifest.json:6-14` | ASVS 4.1.3 | Falta mejorar |
| 9 | Componentes de terceros sin vulnerabilidades conocidas | `package.json`, `package-lock.json` | ASVS 14.2.1, SSDF PW.4.4 | **Fallo** |

## 1. Validación estricta de lo que llega de la página

- **¿Implementado?** Sí.
- **Dónde:** `src/shared/validators.ts:43-61` (`parseRegisterFingerprints`), con `hasExactKeys` en las líneas 18-21 y
  `parseFingerprint` en las líneas 31-37. Se aplica en `src/background/index.ts:33` antes de guardar nada.
- **Qué dice la norma:**
  - ASVS 5.1.3: *"Verify that all input (HTML form fields, REST requests, URL parameters, HTTP headers, cookies, batch
    files, RSS feeds, etc) is validated using positive validation (allow lists)."*
  - ASVS 5.1.4: *"Verify that structured data is strongly typed and validated against a defined schema including allowed
    characters, length and pattern […]"*
- **Hallazgo: bien.** La validación es positiva: solo acepta las claves exactas permitidas (`kind`, `fieldType`,
  `fingerprints`), valores de listas cerradas (`FIELD_TYPES`, `ENCODINGS`), de 1 a 5 huellas sin codificaciones
  repetidas y de 6 a 1024 caracteres. Rechaza objetos con prototipo distinto (línea 14-15), lo que evita que propiedades
  heredadas pasen la validación. Lo cubren 15 pruebas (criterio CA-1).
- **Mejora menor:** no hay límite de cuántos mensajes puede enviar una pestaña por segundo. Hoy solo el content script de
  la propia extensión puede enviarlos, pero conviene agregarlo cuando se implemente el Puente de mensajes.

## 2. Verificación del remitente del mensaje

- **¿Implementado?** Sí.
- **Dónde:** `src/shared/validators.ts:67-75` (`trustedSenderTabId`), usado en `src/background/index.ts:31`.
- **Qué dice la norma:** ASVS 4.1.3: *"Verify that the principle of least privilege exists - users should only be able to
  access functions, data files, URLs, controllers, services, and other resources, for which they possess specific
  authorization. This implies protection against spoofing and elevation of privilege."*
- **Hallazgo: bien.** Solo se aceptan mensajes cuyo `sender.id` es el de la propia extensión (línea 71), y el `tabId` se
  toma del remitente (línea 72), nunca del contenido del mensaje. Así una página no puede registrar huellas en nombre de
  otra pestaña. Lo cubren las pruebas del criterio CA-2.

## 3. Credenciales solo en memoria y su eliminación

- **¿Implementado?** Parcialmente.
- **Dónde:** `src/background/fingerprint-store.ts`: caducidad de 30 s al registrar (líneas 23-26), eliminación de las
  vencidas al consultar (líneas 30-43) y limpieza al cerrar la pestaña (líneas 45-47, llamada desde
  `src/background/index.ts:77-80`).
- **Qué dice la norma:**
  - ASVS 8.2.2: *"Verify that data stored in browser storage (such as localStorage, sessionStorage, IndexedDB, or cookies)
    does not contain sensitive data."*
  - ASVS 8.3.6: *"Verify that sensitive information contained in memory is overwritten as soon as it is no longer required
    to mitigate memory dumping attacks, using zeroes or random data."*
- **Hallazgo: cumple 8.2.2, falta mejorar para 8.3.6.**
  - 8.2.2 se cumple: ninguna huella se escribe en `chrome.storage` ni en IndexedDB; solo existen en un `Map` en memoria.
  - **Problema:** las huellas vencidas solo se eliminan cuando llega otra petición de la misma pestaña (líneas 35-36).
    Si el usuario escribe su contraseña y la página no hace más peticiones, las huellas siguen en memoria más allá de los
    30 s, hasta que se cierre la pestaña o Chrome suspenda el Service Worker.
  - **Límite técnico:** en JavaScript las cadenas son inmutables, así que no se pueden sobrescribir con ceros como pide
    8.3.6. Lo máximo posible es soltar la referencia apenas vence, para que el recolector de basura la libere.
- **Mejora propuesta:** programar la eliminación de cada registro al cumplirse sus 30 s (por ejemplo con `setTimeout`),
  en lugar de esperar a la siguiente petición.

## 4. Los eventos no contienen credenciales

- **¿Implementado?** Sí.
- **Dónde:** `src/background/analyze.ts:104-118`, donde se construye el `FlowEvent`. La línea 109 guarda solo
  `destination.origin` (sin ruta ni consulta) y la línea 114 guarda el nombre de la codificación, no la huella.
  `eslint.config.js:19` prohíbe `console.*`.
- **Qué dice la norma:** ASVS 7.1.1: *"Verify that the application does not log credentials or payment details. Session
  tokens should only be stored in logs in an irreversible, hashed form."*
- **Hallazgo: bien.** Ni el valor, ni las huellas, ni la ruta de la URL (donde podría ir la contraseña) llegan al evento,
  que es lo que después se guardará en el registro de auditoría. Una prueba serializa cada evento y comprueba que no
  contiene ninguna huella ni la ruta (criterio CA-11).

## 5. Sin ejecución dinámica ni XSS

- **¿Implementado?** Sí, como control preventivo en el análisis estático y en el manifiesto.
- **Dónde:** `eslint.config.js`: `no-unsanitized` (líneas 13-14), `no-eval` y `no-new-func` (17-18), prohibición de
  `innerHTML`, `outerHTML` e `insertAdjacentHTML` (28) y `@typescript-eslint/no-implied-eval` para `setTimeout` con texto
  (45). `manifest.json:15-17`: política de seguridad de contenido `script-src 'self'; object-src 'none'`.
- **Qué dice la norma:**
  - ASVS 5.2.4: *"Verify that the application avoids the use of eval() or other dynamic code execution features. […]"*
  - ASVS 5.3.3: *"Verify that context-aware, preferably automated - or at worst, manual - output escaping protects against
    reflected, stored, and DOM based XSS."*
  - ASVS 14.4.3: *"Verify that a Content Security Policy (CSP) response header is in place that helps mitigate impact for
    XSS attacks like HTML, DOM, JSON, and JavaScript injection vulnerabilities."*
- **Hallazgo: bien.** Se comprobó con un archivo de prueba que el lint bloquea las 7 prácticas prohibidas. La CSP impide
  cargar scripts externos en las páginas de la extensión.
- **Mejora menor:** agregar `base-uri 'none'` a la CSP. Además, 5.3.3 todavía no se puede comprobar en la interfaz
  porque el Popup no existe aún.

## 6. Límite de tamaño de lo que se analiza

- **¿Implementado?** Sí.
- **Dónde:** `src/shared/constants.ts:14` (`MAX_BODY_BYTES = 256 KB`), aplicado en `src/background/request-body.ts`
  (formularios en la línea 35 y datos binarios en `readRaw`, líneas 44-77).
- **Qué dice la norma:** ASVS 12.1.1: *"Verify that the application will not accept large files that could fill up storage
  or cause a denial of service."*
- **Hallazgo: bien.** Una página que envía cuerpos enormes no puede agotar la memoria ni el procesador del Service Worker:
  solo se analizan los primeros 256 KB y el evento se marca como truncado (criterio CA-12). Además, el análisis solo
  ocurre en pestañas con huellas activas.

## 7. Manejo de errores

- **¿Implementado?** Parcialmente.
- **Dónde:** `src/background/index.ts`: lectura de la política (líneas 17-20), mensajes (36-38) y análisis de cada
  petición (69-71). También `src/background/flow-events.ts`, donde un consumidor que falla no afecta a los demás.
- **Qué dice la norma:**
  - ASVS 7.4.1: *"Verify that a generic message is shown when an unexpected or security sensitive error occurs,
    potentially with a unique ID which support personnel can use to investigate."*
  - ASVS 7.4.2: *"Verify that exception handling (or a functional equivalent) is used across the codebase to account for
    expected and unexpected error conditions."*
- **Hallazgo: cumple 7.4.2, falta mejorar.** Todo el código expuesto a datos de la página está dentro de `try/catch`, y un
  error en una petición no detiene el análisis de las siguientes. Pero los errores se descartan **sin dejar ningún
  rastro**: si una página provoca errores a propósito para evadir el análisis, nadie se enteraría. 7.4.1 aún no aplica
  porque no hay interfaz.
- **Mejora propuesta:** contar los errores en memoria y emitir un evento de diagnóstico (sin datos de la petición) cuando
  se repitan, para que el Registro de auditoría lo guarde.

## 8. Mínimo privilegio en los permisos

- **¿Implementado?** Parcialmente.
- **Dónde:** `manifest.json:6-14`.
- **Qué dice la norma:** ASVS 4.1.3 (texto en el control 2): solo se debe tener acceso a los recursos para los que hay una
  autorización específica.
- **Hallazgo: falta mejorar.** `webRequest`, `storage` y `<all_urls>` se usan y están justificados. Pero
  **`notifications` y `alarms` están declarados y ningún archivo del código los usa** (búsqueda de `chrome.notifications`
  y `chrome.alarms` sin resultados). Son permisos que la extensión tiene sin necesitarlos todavía.
- **Mejora propuesta:** quitarlos del manifiesto hasta que el Popup y alertas, o el barrido del control 3, los necesiten.

## 9. Componentes de terceros sin vulnerabilidades conocidas

- **¿Implementado?** Parcialmente: las versiones están fijadas, pero no se verifica que estén libres de vulnerabilidades.
- **Dónde:** `package.json` y `package-lock.json`.
- **Qué dice la norma:**
  - ASVS 14.2.1: *"Verify that all components are up to date, preferably using a dependency checker during build or
    compile time."*
  - NIST SSDF PW.4.4 (resumen): verificar que los componentes de terceros adquiridos cumplen los requisitos de la
    organización durante todo su ciclo de vida.
- **Hallazgo: fallo.** `npm audit` reporta **15 vulnerabilidades: 2 críticas y 13 moderadas**. Las principales:

| Aviso | CVE | Paquete | Severidad | Qué permite |
| --- | --- | --- | --- | --- |
| [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) | CVE-2026-104848 | `tinypool` ≤ 2.1.0 (usado por `vitest` 3.2.7) | Crítica (CVSS 9.5) | Contaminación de prototipo que lleva a ejecución remota de código en los procesos de prueba |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | CVE-2026-84373 | `vitest` / `@vitest/mocker` 2.1.0 a 4.1.x | Moderada (CVSS 5.9) | Lectura de archivos locales a través del servidor de pruebas |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | CVE-2026-118764 | `minimatch` < 11.0.1 (usado por `eslint` y `typescript-eslint`) | Moderada (CVSS 6.9) | Denegación de servicio con patrones de archivos manipulados |

  - **Impacto real:** todas están en herramientas de **desarrollo** (pruebas y lint). Ninguna se incluye en la extensión
    que recibe el usuario, cuya única dependencia en ejecución, `tldts`, no tiene avisos. El riesgo está en los equipos de
    desarrollo y en la integración continua.
  - **Causa:** la configuración fijó versiones antiguas (`vitest` 3.2.7, `eslint` 9) y no hay ningún verificador de
    dependencias en el build, como pide 14.2.1.
- **Mejora propuesta:** actualizar `vitest` a una versión corregida (4.1.12 o superior, o la 5.x) y la cadena de ESLint;
  agregar `npm audit --audit-level=high` al proceso de build o a la integración continua, para que una vulnerabilidad
  alta o crítica detenga el build.

## Próximos pasos

1. Corregir el fallo del control 9 (actualizar dependencias y agregar `npm audit` al build).
2. Aplicar las mejoras de los controles 3, 7 y 8.
3. Repetir esta revisión cuando existan el Puente de mensajes y el Popup, para comprobar 5.3.3 y 7.4.1 en la interfaz.
