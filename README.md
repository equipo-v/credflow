# CredFlow

Extensión de Chrome (Manifest V3) que muestra a dónde viajan las credenciales que escribes y alerta cuando salen
hacia un tercero no autorizado o por un canal sin cifrar.

Proyecto de aula del curso *Herramienta de Seguridad en Redes desde Cero* — Equipo V:
Víctor Gómez Echeverri y Darwin Garcia Andrade.

## Estructura

```
credflow/
├── docs/
│   ├── specs/          # especificaciones de cada componente (Claude Code)
│   └── stride.md       # modelo de amenazas
├── src/
│   ├── background/     # Service Worker: webRequest, huellas, veredictos, log
│   ├── content/        # main-world.ts (interceptores) y bridge.ts (mundo aislado)
│   ├── popup/          # grafo de flujos y panel de alertas
│   └── shared/         # tipos, validadores y constantes
├── lab/                # servidor y páginas del laboratorio de pruebas
├── tests/              # unit/ (Vitest) y e2e/ (Playwright)
├── AGENTS.md           # reglas comunes para los agentes de IA
└── CLAUDE.md           # rol de Claude Code
```

## Cómo trabajamos

Claude Code especifica → Antigravity implementa → Codex revisa → una persona del equipo aprueba.
Las reglas están en [AGENTS.md](AGENTS.md).
