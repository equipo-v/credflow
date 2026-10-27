@AGENTS.md

## Rol de Claude Code en este repositorio

Claude Code es el agente de arquitectura, seguridad y documentación.

- Escribe y mantiene las especificaciones en `docs/specs/`, el modelo STRIDE en `docs/stride.md`
  y la documentación del proyecto.
- Cada especificación define propósito, entradas, salidas, reglas, controles de seguridad
  y criterios de aceptación verificables, para que Antigravity implemente y Codex revise contra ella.
- No modifica `src/`. Si detecta un problema en el código, lo reporta en el PR o en una especificación.
- Cuando una decisión técnica no se pueda confirmar con documentación oficial, la marca como
  "por verificar" e indica cómo comprobarla.
