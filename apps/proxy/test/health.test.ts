import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import app from "../src";

const testEnv = {
  OPENROUTER_PROXY_TOKEN: "test-proxy-token",
  OPENROUTER_API_KEY: "test-openrouter-key",
} as Env;

describe("healthz", () => {
  it("returns 200 ok without auth and without outbound fetch", async () => {
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request("https://proxy.example.com/healthz"),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown local paths", async () => {
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request("https://proxy.example.com/foo"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });
});
