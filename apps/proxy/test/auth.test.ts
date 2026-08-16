import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import app from "../src";
import { network } from "./network";

const testEnv = {
  OPENROUTER_PROXY_TOKEN: "test-proxy-token",
  OPENROUTER_API_KEY: "test-openrouter-key",
} as Env;

async function call(path: string, init?: RequestInit, env: Env = testEnv): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`https://proxy.example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function rejectOutbound(): void {
  network.use(
    http.all("https://openrouter.ai/*", () => {
      throw new Error("unexpected outbound fetch");
    }),
  );
}

describe("proxy authentication", () => {
  it("rejects a missing Authorization header without contacting upstream", async () => {
    rejectOutbound();
    const response = await call("/api/v1/models");
    expect(response.status).toBe(401);
  });

  it("rejects a wrong token without contacting upstream", async () => {
    rejectOutbound();
    const response = await call("/api/v1/models", { headers: { Authorization: "Bearer wrong" } });
    expect(response.status).toBe(401);
  });

  it("rejects a non-Bearer scheme without contacting upstream", async () => {
    rejectOutbound();
    const response = await call("/api/v1/models", { headers: { Authorization: "Basic abc123" } });
    expect(response.status).toBe(401);
  });

  it("rejects an empty token without contacting upstream", async () => {
    rejectOutbound();
    const response = await call("/api/v1/models", { headers: { Authorization: "Bearer " } });
    expect(response.status).toBe(401);
  });

  it("allows a valid token and forwards to upstream", async () => {
    network.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", () =>
        HttpResponse.json({ ok: true }),
      ),
    );
    const response = await call("/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token", "Content-Type": "application/json" },
      body: '{"model":"a"}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("never echoes the supplied token in the error body", async () => {
    rejectOutbound();
    const response = await call("/api/v1/models", { headers: { Authorization: "Bearer wrong" } });
    const body = await response.text();
    expect(body).not.toContain("wrong");
    expect(body).not.toContain("test-proxy-token");
  });

  it("fails closed when the proxy token secret is missing", async () => {
    rejectOutbound();
    const env = { OPENROUTER_API_KEY: "k" } as Env;
    const response = await call("/api/v1/models", undefined, env);
    expect(response.status).toBe(502);
  });

  it("fails closed when the proxy token secret is empty", async () => {
    rejectOutbound();
    const env = { OPENROUTER_PROXY_TOKEN: "", OPENROUTER_API_KEY: "k" } as Env;
    const response = await call("/api/v1/models", undefined, env);
    expect(response.status).toBe(502);
  });
});
