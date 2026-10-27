## Qué cambia

<!-- Componente y especificación que implementa este PR, por ejemplo: docs/specs/motor-analisis.md -->

Especificación: `docs/specs/...`

## Criterios de aceptación cubiertos

- [ ] CA-…

## Lista de verificación de seguridad (la revisa una persona antes de aprobar)

- [ ] Ningún valor sensible ni huella se escribe en almacenamiento, logs, `console.*`, errores o exportaciones.
- [ ] La interfaz no muestra valores sensibles.
- [ ] No hay `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` ni `new Function`.
- [ ] No hay conexiones a servidores externos.
- [ ] Los datos que llegan de la página se validan antes de usarse.
- [ ] No se agregaron dependencias, o están aprobadas por escrito en este PR y verificadas en npm.
- [ ] No se agregaron permisos al `manifest.json`, o la especificación y el STRIDE se actualizaron.
- [ ] `npm run lint`, `npm test` y `npm run build` pasan.

## Revisión de Codex

- [ ] Se solicitó la revisión con `@codex review` y se atendieron sus comentarios.
