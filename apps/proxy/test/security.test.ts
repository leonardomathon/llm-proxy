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

describe("security and routing", () => {
  it("does not proxy /api/v2 paths", async () => {
    network.use(
      http.all("https://openrouter.ai/*", () => {
        throw new Error("unexpected outbound fetch");
      }),
    );
    const response = await call("/api/v2/models", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(404);
  });

  it("does not proxy arbitrary local paths", async () => {
    const response = await call("/foo", { headers: { Authorization: "Bearer test-proxy-token" } });
    expect(response.status).toBe(404);
  });

  it("does not proxy absolute-URL-looking paths", async () => {
    const response = await call("/https://evil.example/x", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(404);
  });

  it("keeps the target fixed regardless of query parameters", async () => {
    let seenUrl = "";
    network.use(
      http.get("https://openrouter.ai/api/v1/models", ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );
    const response = await call("/api/v1/models?url=https://evil.example", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(200);
    expect(seenUrl).toContain("openrouter.ai/api/v1/models");
  });

  it("ignores a client Host header and keeps the fixed upstream", async () => {
    let seenUrl = "";
    network.use(
      http.get("https://openrouter.ai/api/v1/models", ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );
    const response = await call("/api/v1/models", {
      headers: { Host: "evil.example", Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(200);
    expect(seenUrl).toContain("openrouter.ai/api/v1/models");
    expect(seenUrl).not.toContain("evil.example");
  });

  it("never sends the proxy secret upstream", async () => {
    let auth = "";
    network.use(
      http.get("https://openrouter.ai/api/v1/models", ({ request }) => {
        auth = request.headers.get("Authorization") ?? "";
        return HttpResponse.json({ data: [] });
      }),
    );
    const response = await call("/api/v1/models", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(200);
    expect(auth).toBe("Bearer test-openrouter-key");
    expect(auth).not.toContain("test-proxy-token");
  });

  it.each(["PUT", "DELETE", "PATCH", "OPTIONS"])(
    "rejects %s on /api/v1/* with 405",
    async (method) => {
      network.use(
        http.all("https://openrouter.ai/*", () => {
          throw new Error("unexpected outbound fetch");
        }),
      );
      const response = await call("/api/v1/models", {
        method,
        headers: { Authorization: "Bearer test-proxy-token" },
      });
      expect(response.status).toBe(405);
    },
  );
});
