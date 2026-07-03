// ESLint (flat config) para las Cloud Functions.
// Objetivo: atrapar BUGS reales (referencias no definidas, claves duplicadas,
// código muerto) — el tipo de error que causó "Modal is not defined" — sin
// volver el CI rojo por estilo preexistente. Estilo/limpieza = warning; bugs =
// error. `npm run lint` falla solo ante errores (--max-warnings sin límite).

const js = require("@eslint/js");

module.exports = [
  { ignores: ["node_modules/**", "eslint.config.js"] },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        exports: "writable",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Ruido de estilo/limpieza → warning (no rompe CI)
      "no-unused-vars": "warn",
      "no-empty": "warn",
      "no-constant-condition": "warn",
      // Bugs reales → error
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-func-assign": "error",
      "no-cond-assign": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
];
