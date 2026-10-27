// Content Script in MAIN world
// Verifica que Chrome acepta "world": "MAIN" directamente en manifest.json
console.log("[SPIKE-CONTENT-MAIN] Script ejecutado en el contexto MAIN de la pagina");

// Marcar en window para que la pagina de prueba pueda verificar que se ejecuto en su contexto
window.__CREDFLOW_MAIN_WORLD_INJECTED__ = true;
window.__CREDFLOW_MAIN_WORLD_TIMESTAMP__ = new Date().toISOString();
