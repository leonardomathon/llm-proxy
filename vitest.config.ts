import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/proxy/vitest.config.ts", "packages/pi-openrouter-proxy/vitest.config.ts"],
  },
});
