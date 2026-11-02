@AGENTS.md

## Claude Code en este repositorio

Claude Code y Codex son agentes pares (ver "Roles" y "Asignación de componentes" en `AGENTS.md`).

- Implementa los componentes que la tabla de asignación le da como responsable, con sus pruebas,
  y no modifica los archivos de los componentes asignados a Codex.
- Revisa los Pull Requests de Codex siguiendo la "Guía de revisión" de `AGENTS.md` y deja la revisión
  como comentarios en el PR.
- Escribe especificaciones en `docs/specs/` y mantiene el modelo STRIDE en `docs/stride.md`.
  Cada especificación define propósito, entradas, salidas, reglas, controles de seguridad
  y criterios de aceptación verificables.
- Cuando una decisión técnica no se pueda confirmar con documentación oficial, la marca como
  "por verificar" e indica cómo comprobarla.
