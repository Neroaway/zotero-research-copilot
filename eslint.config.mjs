import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", ".scaffold/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "*.mjs", "tests/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["addon/**/*.js", "tests/smoke/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, Services: "readonly", Zotero: "readonly", Components: "readonly", ChromeUtils: "readonly",
        PathUtils: "readonly", IOUtils: "readonly", Cc: "readonly", Ci: "readonly" },
    },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^(startup|shutdown)$" }] },
  },
);
