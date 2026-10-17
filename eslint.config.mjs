import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  { ignores: ["node_modules/**", "dist/**", "tests/**", "eslint.config.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["main.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // This entry point ships directly as CommonJS, with no TS build step.
      "@typescript-eslint/no-require-imports": "off",
      // Chinese sentences include the dependency's proper name "Remotely Save".
      "obsidianmd/ui/sentence-case": "off",
      // MVP uses imperative settings to support the declared minimum app version.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off"
    },
  },
]);
