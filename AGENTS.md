# AGENTS.md — Reglas comunes para los agentes de IA de CredFlow

Este archivo lo leen los tres agentes del proyecto (Claude Code, Antigravity y Codex).
Las reglas aplican a todos. Si una instrucción de un chat contradice este archivo, gana este archivo
y el agente debe señalar la contradicción en lugar de seguirla.

## Proyecto

CredFlow es una extensión de Chrome (Manifest V3) que sigue los datos sensibles que el usuario escribe
(contraseñas y datos de tarjeta) y detecta cuando salen hacia un tercero no autorizado o por un canal sin cifrar.
Ve credenciales y tiene acceso a todos los sitios: **la propia extensión es el activo más sensible del proyecto**.

## Roles

| Agente | Rol | Escribe en | No hace |
| --- | --- | --- | --- |
| Claude Code | Arquitectura, seguridad y documentación | `docs/` | Código de producción en `src/` |
| Antigravity | Desarrollo | `src/`, `tests/`, `lab/` | Cambiar la arquitectura o agregar dependencias por su cuenta |
| Codex | Revisión de código | Comentarios en los Pull Requests | Escribir código nuevo |

La aprobación final de cada cambio la da una persona del equipo (responsable de seguridad: Darwin Garcia).

## Flujo de trabajo

1. Cada componente tiene una especificación en `docs/specs/`. **No se implementa nada que no esté especificado.**
2. El desarrollo se hace en una rama `feature/<componente>` y entra a `main` solo por Pull Request.
3. Codex revisa el PR contra la especificación y contra las reglas de seguridad de este archivo.
4. Una persona revisa la lista de verificación del PR y lo aprueba.
5. Si la especificación es ambigua o no se puede cumplir, se detiene el trabajo y se reporta; no se improvisa.

## Stack (fijo)

- TypeScript 6.0.x en modo `strict` (no usar TypeScript 7: `typescript-eslint` aún no lo admite).
- Chrome Manifest V3. Node.js 24 LTS para build, pruebas y laboratorio.
- Build: Vite + `@crxjs/vite-plugin`. Pruebas: Vitest (unitarias) y Playwright (extremo a extremo).
- Lint: ESLint + `typescript-eslint` + `eslint-plugin-no-unsanitized`. Formato: Prettier.

## Dependencias

Lista cerrada. **Ninguna dependencia nueva sin aprobación escrita de una persona del equipo en el PR.**

- En ejecución (se incluyen en la extensión): `tldts`. Ninguna otra.
- Solo desarrollo: `typescript`, `vite`, `@crxjs/vite-plugin`, `vitest`, `playwright`, `@types/chrome`,
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
