# AGENTS.md — Reglas para el agente de IA de CredFlow

Por decisión del equipo, el único agente de IA del proyecto por ahora es **Claude Code**. Este archivo define
sus reglas. Si una instrucción de un chat contradice este archivo, gana este archivo y el agente debe señalar
la contradicción en lugar de seguirla.

Antigravity participó al inicio (configuración del proyecto, PR #2, y verificación manual de `webRequest`, PR #3)
y Codex estuvo previsto como revisor. Ambos quedan fuera por el momento; si vuelven, se actualizan los roles.

## Proyecto

CredFlow es una extensión de Chrome (Manifest V3) que sigue los datos sensibles que el usuario escribe
(contraseñas y datos de tarjeta) y detecta cuando salen hacia un tercero no autorizado o por un canal sin cifrar.
Ve credenciales y tiene acceso a todos los sitios: **la propia extensión es el activo más sensible del proyecto**.

## Roles

Con un solo agente, la separación de funciones la da la revisión humana: quien escribe el código no es quien lo aprueba.

| Actividad | Quién | Regla |
| --- | --- | --- |
| Especificar | Claude Code | Escribe la especificación de cada componente en `docs/specs/`. Una persona del equipo la aprueba antes de implementar. |
| Implementar y probar | Claude Code | Implementa solo lo especificado, con una prueba por cada criterio de aceptación. |
| Autorrevisión | Claude Code | Antes de pedir revisión, aplica la "Guía de revisión" a su propio cambio y deja el resultado en el PR. Es un apoyo: **no sustituye la revisión humana**. |
| Revisar y aprobar | Darwin Garcia (responsable de seguridad) | Revisa cada PR con la lista de verificación de la plantilla y la "Guía de revisión", y lo aprueba y fusiona. |
| Asignar tareas | Víctor Gómez (líder técnico) | Decide el orden de los componentes y resuelve las ambigüedades de las especificaciones. |

## Componentes

| Componente | Archivos | Especificación |
| --- | --- | --- |
| Configuración del proyecto | `package.json`, configuraciones, `manifest.json`, `public/` | `AGENTS.md` (Stack) |
| Verificación técnica de `webRequest` | `lab/spike-webrequest/` | `docs/specs/motor-analisis.md`, sección 2 |
| Contratos compartidos (tipos, validadores, huellas) | `src/shared/` | `docs/specs/motor-analisis.md`, secciones 3 y 5 |
| Motor de análisis | `src/background/` (excepto `audit/`) | `docs/specs/motor-analisis.md` |
| Registro de auditoría | `src/background/audit/` | Pendiente |
| Puente de mensajes e interceptor de página | `src/content/` | Pendiente |
| Popup y alertas | `src/popup/` | Pendiente |
| Laboratorio de pruebas | `lab/` (excepto `spike-webrequest/`) | Pendiente |

Las pruebas de cada componente van en `tests/`.

## Flujo de trabajo

1. Cada componente tiene una especificación en `docs/specs/`. **No se implementa nada que no esté especificado.**
2. Cada tarea se desarrolla en una rama `feature/<componente>` (o `docs/…`, `fix/…`) y entra a `main` solo por
   Pull Request con la plantilla del repositorio.
3. Los contratos de `src/shared/` se definen antes que los componentes que los usan; un cambio en ellos se señala
   explícitamente en el PR, porque afecta a varios componentes.
4. Antes de pedir revisión, el agente ejecuta `npm run lint`, `npm test` y `npm run build`, y hace la autorrevisión.
5. Una persona revisa la lista de verificación del PR, lo aprueba y lo fusiona.
6. Si la especificación es ambigua o no se puede cumplir, se detiene el trabajo y se pregunta al equipo; no se improvisa.

## Stack (fijo)

- TypeScript 6.0.x en modo `strict` (no usar TypeScript 7: `typescript-eslint` aún no lo admite).
- Chrome Manifest V3. Node.js 24 LTS para build, pruebas y laboratorio.
- Build: Vite + `@crxjs/vite-plugin`. Pruebas: Vitest (unitarias) y Playwright (extremo a extremo).
- Lint: ESLint + `typescript-eslint` + `eslint-plugin-no-unsanitized`. Formato: Prettier.

## Dependencias

Lista cerrada. **Ninguna dependencia nueva sin aprobación escrita de una persona del equipo en el PR.**

- En ejecución (se incluyen en la extensión): `tldts`. Ninguna otra.
- Solo desarrollo: `typescript`, `vite`, `@crxjs/vite-plugin`, `vitest`, `playwright`, `@types/chrome`, `@eslint/js`,
  `eslint`, `typescript-eslint`, `eslint-plugin-no-unsanitized`, `prettier`.

Antes de proponer un paquete, verifica que existe en el registro de npm con ese nombre exacto
(los nombres inventados o parecidos son un vector de ataque conocido). Instala siempre con `npm ci` y versiones fijadas.

## Reglas de seguridad (no negociables)

1. **Nunca persistir datos sensibles.** Los valores escritos por el usuario y sus huellas solo viven en memoria,
   con caducidad de 30 s. Nunca en `chrome.storage`, IndexedDB, logs, `console.*`, mensajes de error ni exportaciones.
2. **Nunca mostrar datos sensibles.** La interfaz muestra el tipo de campo, nunca su valor.
3. **Nunca `innerHTML`, `outerHTML`, `insertAdjacentHTML` ni `document.write`.** Todo texto se inserta con `textContent`;
   el SVG se construye con `createElementNS`.
4. **Sin código remoto ni dinámico:** nada de `eval`, `new Function`, `setTimeout` con string ni scripts cargados desde la red.
5. **Sin conexiones salientes.** La extensión no hace `fetch` a ningún servidor externo.
6. **Todo lo que viene de la página es no confiable.** Los mensajes del mundo `MAIN` se validan contra un esquema estricto
   (campos permitidos, tipos, longitudes máximas) y se verifica `sender.id === chrome.runtime.id`.
   La capa de red (`webRequest`) es la evidencia autoritativa; la capa de página solo es orientativa.
7. **Permisos mínimos.** Solo `webRequest`, `storage`, `notifications`, `alarms` y `host_permissions: ["<all_urls>"]`.
   Agregar un permiso requiere actualizar la especificación y el modelo STRIDE (`docs/stride.md`).
8. **Errores genéricos.** Los fallos se capturan; la interfaz muestra mensajes genéricos sin trazas. Un error al analizar
   una petición no detiene el análisis de las siguientes.

## Convenciones de código

- Código en inglés (nombres de variables, funciones, tipos); comentarios y documentación en español.
- Funciones de lógica pura (huellas, clasificación, validadores) separadas de las llamadas a APIs de Chrome,
  para poder probarlas con Vitest sin navegador.
- Sin `any`. Los datos externos entran como `unknown` y se validan antes de usarse.

## Pruebas

- Cada criterio de aceptación de una especificación tiene al menos una prueba.
- Antes de abrir un PR: `npm run lint`, `npm test` y `npm run build` deben pasar.
- El laboratorio (`lab/`) usa solo credenciales ficticias.

## Guía de revisión

La aplica la persona que revisa cada Pull Request, y el agente en su autorrevisión antes de pedir revisión.

Antes de revisar: leer la especificación que implementa el PR (indicada en su descripción), sus criterios
de aceptación y `docs/stride.md`.

Qué revisar, en orden de prioridad:

1. **Reglas de seguridad de este archivo.** Seguir el flujo de los datos sensibles, no solo buscar palabras:
   ¿algún valor o huella llega a almacenamiento, `console.*`, errores, eventos o exportaciones? ¿Hay APIs de HTML
   inseguras o código dinámico? ¿Conexiones salientes? ¿Los datos de la página se validan y el `tabId` sale del remitente?
   ¿El manifiesto tiene solo los permisos permitidos?
2. **Dependencias.** Cualquier paquete fuera de la lista cerrada, sin aprobación escrita en el PR o no verificado en npm
   es un hallazgo bloqueante.
3. **Especificación.** Cada regla y cada criterio de aceptación: ¿se cumple? ¿Su prueba verifica de verdad lo que dice?
4. **Alcance.** ¿El PR cambia solo lo que dice su descripción? ¿Toca componentes sin especificación aprobada?
5. **Calidad.** Tipado sin `any`, lógica pura separada de las APIs de Chrome, código en inglés y comentarios en español.

Formato de cada hallazgo: severidad (**bloqueante**, **importante** o **menor**), archivo y línea, regla o criterio
afectado, escenario concreto en que causa daño y qué debería cambiar. Al final: conteo por severidad, criterios de
aceptación cubiertos y no cubiertos, y recomendación (aprobar, aprobar con cambios menores o no aprobar).

Si el problema está en la especificación y no en el código, se reporta como "Observación para la especificación".
Si no hay hallazgos, se dice explícitamente qué se verificó. No se inventan hallazgos.
