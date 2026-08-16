import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import app from "../src";
import { network } from "./network";

const testEnv = {
  OPENROUTER_PROXY_TOKEN: "test-proxy-token",
  OPENROUTER_API_KEY: "test-openrouter-key",
} as Env;

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://proxy.example.com${path}`, init),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("request forwarding", () => {
  it("forwards method, path, query, and injects the server-side Authorization", async () => {
    let seen = { url: "", method: "", auth: "", contentType: "", referer: "", title: "" };
    network.use(
      http.post(
        "https://openrouter.ai/api/v1/chat/completions?stream=true",
        async ({ request }) => {
          seen = {
            url: request.url,
            method: request.method,
            auth: request.headers.get("Authorization") ?? "",
            contentType: request.headers.get("Content-Type") ?? "",
            referer: request.headers.get("HTTP-Referer") ?? "",
            title: request.headers.get("X-OpenRouter-Title") ?? "",
          };
          return HttpResponse.json({ ok: true });
        },
      ),
    );

    const response = await call("/api/v1/chat/completions?stream=true", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-proxy-token",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://pi.dev",
        "X-OpenRouter-Title": "pi",
      },
      body: '{"model":"a","messages":[]}',
    });

    expect(response.status).toBe(200);
    expect(seen.url).toContain("openrouter.ai/api/v1/chat/completions?stream=true");
    expect(seen.method).toBe("POST");
    expect(seen.auth).toBe("Bearer test-openrouter-key");
    expect(seen.auth).not.toContain("test-proxy-token");
    expect(seen.contentType).toBe("application/json");
    expect(seen.referer).toBe("https://pi.dev");
    expect(seen.title).toBe("pi");
  });

  const bodies = [
    { contentType: "application/json", body: '{"model":"a","messages":[]}' },
    {
      contentType: "application/json",
      body: '{"model":"a","messages":[{"content":"héllo wörld 日本語 😀"}]}',
    },
    {
      contentType: "application/json",
      body: JSON.stringify({ model: "a", messages: [{ content: "x".repeat(2000) }] }),
    },
    { contentType: "text/plain", body: "this is not json at all" },
  ];

  for (const { contentType, body } of bodies) {
    it(`passes the request body through byte-for-byte (${contentType}, ${body.length} bytes)`, async () => {
      let seenBody = "";
      network.use(
        http.post("https://openrouter.ai/api/v1/chat/completions", async ({ request }) => {
          const bytes = await request.arrayBuffer();
          seenBody = new TextDecoder().decode(bytes);
          return HttpResponse.json({ ok: true });
        }),
      );

      const response = await call("/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer test-proxy-token", "Content-Type": contentType },
        body,
      });

      expect(response.status).toBe(200);
      expect(seenBody).toBe(body);
    });
  }

  it("preserves a 200 JSON upstream response", async () => {
    network.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", () =>
        HttpResponse.json({ id: "x" }),
      ),
    );
    const response = await call("/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token" },
      body: '{"model":"a"}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "x" });
  });

  it("preserves a 400 JSON upstream response", async () => {
    network.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", () =>
        HttpResponse.json({ error: { message: "bad" } }, { status: 400 }),
      ),
    );
    const response = await call("/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token" },
      body: '{"model":"a"}',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: "bad" } });
  });

  it("preserves a 401 JSON upstream response", async () => {
    network.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", () =>
        HttpResponse.json({ error: "unauthorized" }, { status: 401 }),
      ),
    );
    const response = await call("/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token" },
      body: '{"model":"a"}',
    });
    expect(response.status).toBe(401);
  });

  it("preserves a 429 response with rate-limit headers", async () => {
    network.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", () =>
        HttpResponse.json(
          { error: "rate limited" },
          { status: 429, headers: { "x-ratelimit-limit": "100", "x-ratelimit-remaining": "0" } },
        ),
      ),
    );
    const response = await call("/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token" },
      body: '{"model":"a"}',
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("x-ratelimit-limit")).toBe("100");
  });

  it("preserves a 500 text upstream response", async () => {
    network.use(
      http.post(
        "https://openrouter.ai/api/v1/chat/completions",
        () => new HttpResponse("internal", { status: 500 }),
      ),
    );
    const response = await call("/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token" },
      body: '{"model":"a"}',
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("internal");
  });

  it("preserves an empty 204 upstream response", async () => {
    network.use(
      http.post(
        "https://openrouter.ai/api/v1/chat/completions",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const response = await call("/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token" },
      body: '{"model":"a"}',
    });
    expect(response.status).toBe(204);
  });

  it("handles HEAD requests", async () => {
    network.use(
      http.head(
        "https://openrouter.ai/api/v1/models",
        () =>
          new HttpResponse(null, { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    const response = await call("/api/v1/models", {
      method: "HEAD",
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});
