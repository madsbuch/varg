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
      // Strict typing, no exceptions (CLAUDE.md, "Strict across the bridge"):
      // no type assertions (`as const` stays: it narrows, never widens or lies),
      // no `!`, no coercion. Untyped data is read with Reader (lib/decode.ts);
      // numbers typed by a person with parseDecimal / parseWhole (lib/units.ts).
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-implicit-coercion": ["error", { boolean: true, number: true, string: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^(Number|String|Boolean)$/]",
          message: "No coercion. Parse text with parseDecimal/parseWhole, format with toString() or a template, test explicitly.",
        },
        {
          selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message: "Use parseJson (lib/decode.ts) and read the value with Reader: JSON.parse returns `any`.",
        },
      ],
    },
  },
  {
    // The one door from text to a value.
    files: ["src/lib/decode.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    ignores: ["dist/", "src-tauri/", "node_modules/", "*.config.js", "*.config.ts", "scripts/"],
  },
);
