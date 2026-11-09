import js from "@eslint/js";
import tseslint from "typescript-eslint";
import noUnsanitized from "eslint-plugin-no-unsanitized";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "no-unsanitized": noUnsanitized,
    },
    rules: {
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // Reglas de seguridad 1, 3 y 4 de AGENTS.md.
      "no-eval": "error",
      "no-new-func": "error",
      "no-console": "error",
      "no-restricted-properties": [
        "error",
        { object: "document", property: "write", message: "Prohibido por AGENTS.md (regla 3)." },
        { object: "document", property: "writeln", message: "Prohibido por AGENTS.md (regla 3)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]",
          message: "Prohibido por AGENTS.md (regla 3): use textContent o createElementNS.",
        },
      ],
    },
  },
  {
    // setTimeout/setInterval con texto solo se detecta con información de tipos.
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-implied-eval": "off",
      "@typescript-eslint/no-implied-eval": "error",
    },
  },
  {
    // Pruebas E2E: scripts de Node que reportan en consola y evalúan código dentro de la extensión.
    files: ["tests/e2e/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        // Código que se evalúa dentro del navegador con page.evaluate y worker.evaluate.
        chrome: "readonly",
        document: "readonly",
        Event: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },
  {
    ignores: ["dist/**", "node_modules/**", "lab/**", "test-results/**"],
  }
);
