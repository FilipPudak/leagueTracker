import js from "@eslint/js";
import globals from "globals";

const smellRules = {
  "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", ignoreRestSiblings: true }],
  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  curly: ["error", "multi-line"],
  "no-else-return": "warn",
  "no-duplicate-imports": "error",
  "no-return-assign": "error",
  "no-self-compare": "error",
  "no-throw-literal": "error",
  "no-shadow": "warn",
  "no-nested-ternary": "warn",
  complexity: ["warn", 20],
  "max-depth": ["warn", 4],
  "no-console": "off"
};

export default [
  {
    ignores: ["**/node_modules/**", ".wrangler/**", "tmp/**", ".opencode/**"]
  },
  js.configs.recommended,
  {
    files: ["backend/src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.worker, ...globals.node, fetch: "readonly", Response: "readonly", Request: "readonly", Headers: "readonly", WebSocket: "readonly" }
    },
    rules: smellRules
  },
  {
    files: ["backend/test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: smellRules
  },
  {
    files: ["docs/app/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.browser }
    },
    rules: {
      ...smellRules,
      "no-undef": "off",
      "no-unused-vars": ["error", { vars: "local", args: "after-used", ignoreRestSiblings: true }]
    }
  }
];
