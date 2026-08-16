import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "vitest"],
  categories: {
    correctness: "error",
    suspicious: "error",
  },
  options: {
    typeAware: true,
  },
  rules: {
    "typescript/no-floating-promises": "error",
  },
  overrides: [
    {
      // Test mocks idiomatically cast partial/stub objects to the interfaces they
      // stand in for. Type-aware assertion rules are too strict for that pattern.
      files: ["**/*.test.ts"],
      rules: {
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/no-unnecessary-type-assertion": "off",
      },
    },
  ],
});
