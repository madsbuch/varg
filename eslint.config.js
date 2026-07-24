// Strictest practical lint setup: typescript-eslint's strict + stylistic
// type-checked presets, plus React hooks rules.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Promises intentionally fired-and-forgotten are marked with `void`.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      // `` `${n}` `` for numbers in UI strings is idiomatic React.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    ignores: ["dist/", "src-tauri/", "node_modules/", "*.config.js", "*.config.ts", "scripts/"],
  },
);
