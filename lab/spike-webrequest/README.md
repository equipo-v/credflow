# Spike: Verificación de webRequest (requestBody) y MAIN World

Este laboratorio implementa la prueba técnica previa exigida en la **Sección 2 de `docs/specs/motor-analisis.md`**.

## Objetivos verificados
1. Confirmar que `chrome.webRequest.onBeforeRequest` registrado con `extraInfoSpec: ["requestBody"]` y **sin** `"blocking"` captura `details.requestBody` en una extensión Manifest V3.
2. Confirmar el formato de entrega (`formData` vs. `raw`) según el tipo de petición.
3. Verificar la compatibilidad de `"world": "MAIN"` declarado directamente en `content_scripts` dentro de `manifest.json`.

## Resultados de la Verificación Técnica

* **Versión de Chrome analizada:** `Google Chrome 156.0.8078.48 (64-bit)`
* **Soporte de `"world": "MAIN"` en manifest.json:** Soportado nativamente desde **Chrome 111+** (declarativo en `manifest.json`), y vía `chrome.scripting` desde Chrome 95+.

### Tabla de Resultados

| Caso | ¿Llegó `requestBody`? | Formato | Observaciones |
| --- | --- | --- | --- |
| **(a) Formulario HTML** (`application/x-www-form-urlencoded`) | **SÍ** | `formData` | Llega como un objeto con pares clave-valor (p. ej. `{ username: ["usuario_ficticio_42"], password: ["ClaveFicticia!2026#"] }`). Fácilmente parseable directamente sin decodificación de streams. |
| **(b) Fetch con JSON** (`application/json`) | **SÍ** | `raw` | Llega dentro de `requestBody.raw` como un arreglo de objetos `UploadData` con `bytes` (`ArrayBuffer`). Requiere decodificación UTF-8 con `new TextDecoder("utf-8").decode(element.bytes)`. |
| **(c) navigator.sendBeacon** (texto plano) | **SÍ** | `raw` | Llega igualmente como bytes dentro de `requestBody.raw`, decodificable con `TextDecoder("utf-8")`. |

## Conclusión Técnica para la Capa 1
El diseño de la Capa 1 especificado en `docs/specs/motor-analisis.md` **es viable y queda validado**:
`chrome.webRequest.onBeforeRequest` sin `"blocking"` proporciona acceso pasivo al cuerpo de las peticiones salientes tanto en formularios (`formData`) como en APIs modernas (`raw`), permitiendo la búsqueda de huellas de credenciales en memoria sin requerir APIs bloqueantes.

## Cómo ejecutar localmente
1. Iniciar el servidor local:
   ```bash
   node lab/spike-webrequest/server.js
   ```
2. Cargar la extensión en Chrome:
   - Navegar a `chrome://extensions`.
   - Activar el toggle de **Modo de desarrollador**.
   - Hacer clic en **Cargar descomprimida** y seleccionar la carpeta `lab/spike-webrequest`.
3. Abrir `http://127.0.0.1:8765/index.html` y accionar las pruebas interactivas.
