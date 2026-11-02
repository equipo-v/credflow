## Qué cambia

<!-- Componente y especificación que implementa este PR, por ejemplo: docs/specs/motor-analisis.md -->

Especificación: `docs/specs/...`

Issue: Closes #

Agente responsable: Claude Code / Codex

Agente revisor: Claude Code / Codex

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

## Revisión del otro agente

- [ ] El agente revisor (el que no es responsable) revisó el PR según la "Guía de revisión" de `AGENTS.md`.
      Si el responsable es Claude Code, se pidió con `@codex review`.
- [ ] Se atendieron sus hallazgos, o se justificó por escrito por qué no se aceptan.
- [ ] El PR no modifica archivos de componentes asignados al otro agente.
