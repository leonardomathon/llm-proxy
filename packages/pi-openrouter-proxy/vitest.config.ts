import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "pi-extension",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
