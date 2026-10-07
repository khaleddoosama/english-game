import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  { ignores: ["dist/**", "dev-dist/**", "node_modules/**", "legacy/**", "imports/**"] },
  js.configs.recommended,
  {
    rules: {
      // A name starting with _ , a caught error, and the rest of a destructuring ({ a, ...rest }) are meant to be ignored.
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      // `catch {}` is how storage and network calls are allowed to fail quietly.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: { "react/jsx-no-undef": "error", "react/jsx-uses-vars": "error", "react-hooks/rules-of-hooks": "error" },
  },
  { files: ["api/**/*.js", "vite.config.js"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.node } },
  { files: ["tests/**/*.{js,jsx}"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { react }, rules: { "react/jsx-uses-vars": "error" } },
];
