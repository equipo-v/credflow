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
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "lab/**"],
  }
);
