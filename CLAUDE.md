@AGENTS.md

## Claude Code en este repositorio

Claude Code es el único agente de IA del proyecto (ver "Roles" en `AGENTS.md`).

- Escribe las especificaciones en `docs/specs/` y mantiene el modelo STRIDE en `docs/stride.md`.
  Cada especificación define propósito, entradas, salidas, reglas, controles de seguridad
  y criterios de aceptación verificables.
- Implementa y prueba los componentes una vez que el equipo aprueba su especificación.
- Antes de pedir revisión, aplica la "Guía de revisión" a su propio cambio y deja el resultado en el PR.
  La aprobación siempre la da una persona del equipo.
- Cuando una decisión técnica no se pueda confirmar con documentación oficial, la marca como
  "por verificar" e indica cómo comprobarla.
