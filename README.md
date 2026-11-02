# CredFlow

Extensión de Chrome (Manifest V3) que muestra a dónde viajan las credenciales que escribes y alerta cuando salen
hacia un tercero no autorizado o por un canal sin cifrar.

Proyecto de aula del curso *Herramienta de Seguridad en Redes desde Cero* — Equipo V:
Víctor Gómez Echeverri y Darwin Garcia Andrade.

## Estructura

```
credflow/
├── docs/
│   ├── specs/          # especificaciones de cada componente
│   └── stride.md       # modelo de amenazas
├── src/
│   ├── background/     # Service Worker: webRequest, huellas, veredictos, log
│   ├── content/        # main-world.ts (interceptores) y bridge.ts (mundo aislado)
│   ├── popup/          # grafo de flujos y panel de alertas
│   └── shared/         # tipos, validadores y constantes
├── lab/                # servidor y páginas del laboratorio de pruebas
├── tests/              # unit/ (Vitest) y e2e/ (Playwright)
├── AGENTS.md           # reglas comunes, roles y asignación de componentes de los agentes de IA
└── CLAUDE.md           # rol de Claude Code
```

## Cómo trabajamos

Dos agentes de IA trabajan como pares: Claude Code y Codex especifican, implementan y se revisan mutuamente.
Cada componente tiene un agente responsable y el otro revisa sus Pull Requests; una persona del equipo aprueba.
Las reglas y la asignación de componentes están en [AGENTS.md](AGENTS.md).
