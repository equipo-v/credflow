# Investigación: análisis estático (SAST) y revisión de secretos

| Campo | Valor |
| --- | --- |
| Fecha | 3 de noviembre de 2026 |
| Código analizado | Rama `feature/motor-analisis`, commit `6e4bbe7` (44 archivos rastreados por Git) |
| SAST | Semgrep 1.183.0 con las reglas oficiales de `semgrep/semgrep-rules` para JavaScript, TypeScript y secretos (427 reglas), más ESLint con las reglas de seguridad del proyecto |
| Secretos | Gitleaks 8.24.3 sobre todo el historial de Git (todas las ramas) y sobre los archivos actuales |

Resultado: **2 hallazgos de Semgrep, ninguno explotable en la extensión. 0 errores de ESLint. 0 secretos.**

## Análisis estático

### Cómo se ejecutó

El registro de reglas `semgrep.dev` no era accesible desde el entorno de desarrollo, así que se usaron las mismas reglas
descargadas del repositorio oficial `github.com/semgrep/semgrep-rules`:

```bash
semgrep scan --config <reglas javascript, typescript y generic/secrets> --metrics off \
  --exclude node_modules --exclude dist --exclude package-lock.json .
```

### Hallazgos

| # | Regla | Archivo y línea | Severidad | Interpretación | Acción |
| --- | --- | --- | --- | --- | --- |
| 1 | `javascript.lang.security.audit.detect-redos` | `src/background/managed-config.ts:24` | Advertencia | **Falso positivo en la práctica.** La expresión regular que valida nombres de host tiene cuantificadores anidados, el patrón que la regla busca. Pero: (a) el *lookahead* `(?=.{1,253}$)` limita la entrada a 253 caracteres; (b) cada etiqueta tiene un máximo fijo de 63 caracteres y el punto separa las repeticiones, así que no hay retroceso exponencial; (c) la entrada viene de la política del administrador, no de páginas web. Se midió con entradas diseñadas para el peor caso (guiones largos, 120 etiquetas, 5000 caracteres sin el *lookahead*): todas tardan menos de 0,2 ms. | Ninguna. Se documenta la medición. |
| 2 | `typescript.react.security.react-insecure-request` | `lab/spike-webrequest/background.js:42` | Error | **Verdadero positivo, aceptado por contexto.** La extensión del laboratorio manual (verificación de Antigravity, PR #3) envía por HTTP a `127.0.0.1:8765` cada petición capturada, con su cuerpo. No forma parte de la extensión que se distribuye, solo observa `localhost` y `127.0.0.1` (línea 9), y el laboratorio usa credenciales ficticias. | Ninguna en el código. Advertencia: esa extensión de laboratorio nunca debe cargarse en un perfil de Chrome personal. |

### ESLint

`npx eslint .` sobre los 19 archivos del proyecto: **0 errores y 0 avisos**. Las reglas de seguridad del proyecto
(`no-unsanitized`, `no-eval`, `no-new-func`, `@typescript-eslint/no-implied-eval`, `no-console` y la prohibición de
`innerHTML`, `outerHTML`, `insertAdjacentHTML` y `document.write`) no encontraron violaciones.

## Revisión de secretos

| Revisión | Alcance | Resultado |
| --- | --- | --- |
| `gitleaks git . --log-opts="--all"` | 18 commits de todas las ramas (14 con cambios; el resto son fusiones) | 0 secretos |
| `gitleaks dir` | Archivos actuales de `feature/motor-analisis`, sin `node_modules` | 0 secretos |
| Archivos sensibles rastreados por Git (`.env`, `.pem`, `.key`, `.crx`, `id_rsa`) | `git ls-files` | Ninguno |
| `.gitignore` | Excluye `.env`, `.env.*`, `*.pem` (clave de firma de la extensión), `*.crx` y `*.zip` | Correcto |

**Prueba de la herramienta:** para confirmar que un resultado de 0 secretos es confiable, se plantó en una carpeta
temporal un archivo con un token de GitHub y una clave de AWS falsos. Gitleaks detectó los 2.

La contraseña del laboratorio (`Prueba#2026`) aparece en el código a propósito: es una credencial ficticia para las
pruebas, como exige `AGENTS.md`, y no da acceso a ningún sistema.

## Recomendaciones

1. Agregar Semgrep y Gitleaks a la integración continua para que se ejecuten en cada Pull Request (NIST SSDF PW.7.2 y
   PW.8.2), junto con el `npm audit` propuesto en `docs/verificaciones/controles-en-codigo.md`.
2. Activar el escaneo de secretos de GitHub (*secret scanning* y *push protection*) en el repositorio, si el plan de la
   organización lo permite.
