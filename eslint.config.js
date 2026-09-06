import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "coverage/**", "playwright-report/**", "test-results/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "*.config.ts",
            "tests/e2e/*.ts",
            "apps/server/src/*.test.ts",
            "apps/server/src/*/*.test.ts",
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 36,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
