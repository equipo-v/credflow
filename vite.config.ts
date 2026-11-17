import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    crx({
      manifest,
      contentScripts: {
        // El Puente se genera como un único archivo autocontenido (IIFE): sin cargador, sin import() dinámico
        // y sin exponer archivos de la extensión a los sitios web mediante web_accessible_resources.
        standaloneFiles: ["src/content/main-world.ts", "src/content/bridge.ts"],
      },
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
