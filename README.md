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

## Demo

```bash
npm ci
npm run build          # genera la extensión en dist/
npm run lab            # inicia la tienda de laboratorio en http://localhost:8124
```

1. En Chrome, abre `chrome://extensions`, activa el **modo de desarrollador** y usa **Cargar descomprimida** con la
   carpeta `dist/`.
2. Abre un escenario, por ejemplo `http://localhost:8124/?escenario=robo`, escribe la contraseña ficticia
   `Prueba#2026` y pulsa **Iniciar sesión**.
3. El ícono de CredFlow se pone rojo; al abrirlo se ve el flujo hacia el dominio de métricas.
4. Para ver el robo desde el lado del atacante, mira la terminal de `npm run lab` o abre el panel del atacante en
   `http://127.0.0.1:8124/panel`. Solo se muestra la contraseña ficticia; cualquier otro valor aparece oculto.

Escenarios: `limpio`, `robo`, `robo-blob` y `url` (`docs/specs/laboratorio.md`).

Pruebas automáticas de la demo, con capturas en `test-results/demo/`:

```bash
npx playwright install chromium   # solo la primera vez
npm run test:e2e
```
