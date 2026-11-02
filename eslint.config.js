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
    ignores: ["dist/**", "node_modules/**", "lab/**"],
  }
);
