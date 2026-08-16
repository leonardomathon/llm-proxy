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
});
