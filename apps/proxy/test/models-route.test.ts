import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../src";
import { getModels } from "../src/models/fetch-models";
import type { ModelCache } from "../src/models/fetch-models";
import { network } from "./network";

const testEnv = {
  OPENROUTER_PROXY_TOKEN: "test-proxy-token",
  OPENROUTER_API_KEY: "test-openrouter-key",
} as Env;

const modelsBody = {
  data: [
    {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      context_length: 200000,
      architecture: { modality: "text->text" },
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools"],
    },
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      pricing: { prompt: "0.0000025", completion: "0.00001" },
    },
  ],
};

const benchmarksBody = {
  data: [
    {
      source: "artificial-analysis",
      model_permaslug: "openai/gpt-4o",
      intelligence_index: 71.2,
      coding_index: 65.8,
      agentic_index: 58.3,
    },
  ],
};

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

function mockOpenRouter(models = modelsBody, benchmarks = benchmarksBody): void {
  network.use(
    http.get("https://openrouter.ai/api/v1/models", () => HttpResponse.json(models)),
    http.get("https://openrouter.ai/api/v1/benchmarks", () => HttpResponse.json(benchmarks)),
  );
}

// The Worker Cache API is not isolated per test, so clear both cached entries
// before each test to avoid one test's cached response leaking into the next.
beforeEach(async () => {
  const cache = await caches.open("models");
  await cache.delete("https://openrouter.ai/api/v1/models");
  await cache.delete("https://openrouter.ai/api/v1/benchmarks?source=artificial-analysis");
});

function rejectOutbound(): void {
  network.use(
    http.all("https://openrouter.ai/*", () => {
      throw new Error("unexpected outbound fetch");
    }),
  );
}

class MemoryCache implements ModelCache {
  private store = new Map<string, Response>();

  async match(url: string): Promise<Response | undefined> {
    return this.store.get(url);
  }

  async put(url: string, response: Response): Promise<void> {
    this.store.set(url, response.clone());
  }
}

describe("GET /models", () => {
  it("rejects a missing Authorization header without contacting OpenRouter", async () => {
    rejectOutbound();
    const response = await call("/models");
    expect(response.status).toBe(401);
  });

  it("rejects a wrong token without contacting OpenRouter", async () => {
    rejectOutbound();
    const response = await call("/models", { headers: { Authorization: "Bearer wrong" } });
    expect(response.status).toBe(401);
  });

  it("renders an HTML table with readable prices and scores", async () => {
    mockOpenRouter();
    const response = await call("/models", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("anthropic/claude-3.5-sonnet");
    expect(body).toContain(">anthropic</td>");
    expect(body).toContain("$3.00");
    expect(body).toContain("$15.00");
    expect(body).toContain("200,000");
    expect(body).toContain("71.2");
    expect(body).toContain("65.8");
    expect(body).toContain("58.3");
    expect(body).toContain('id="search"');
    expect(body).toContain('id="provider"');
    expect(body).toContain('data-sort="input"');
    expect(body).toContain('data-sort="intelligence"');
  });

  it("uses the OpenRouter key only server-side and never leaks it", async () => {
    const auths: string[] = [];
    network.use(
      http.get("https://openrouter.ai/api/v1/models", ({ request }) => {
        auths.push(request.headers.get("Authorization") ?? "");
        return HttpResponse.json(modelsBody);
      }),
      http.get("https://openrouter.ai/api/v1/benchmarks", ({ request }) => {
        auths.push(request.headers.get("Authorization") ?? "");
        return HttpResponse.json(benchmarksBody);
      }),
    );
    const response = await call("/models", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    const body = await response.text();
    expect(auths).toHaveLength(2);
    expect(auths.every((a) => a === "Bearer test-openrouter-key")).toBe(true);
    expect(body).not.toContain("test-openrouter-key");
    expect(body).not.toContain("test-proxy-token");
  });

  it("renders a 502 error page when OpenRouter fails", async () => {
    network.use(
      http.get(
        "https://openrouter.ai/api/v1/models",
        () => new HttpResponse("boom", { status: 500 }),
      ),
      http.get("https://openrouter.ai/api/v1/benchmarks", () => HttpResponse.json(benchmarksBody)),
    );
    const response = await call("/models", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("Models unavailable");
    expect(body).not.toContain("test-openrouter-key");
  });

  it("does not fetch OpenRouter on a cache hit", async () => {
    let fetches = 0;
    network.use(
      http.get("https://openrouter.ai/api/v1/models", () => {
        fetches++;
        return HttpResponse.json(modelsBody);
      }),
      http.get("https://openrouter.ai/api/v1/benchmarks", () => HttpResponse.json(benchmarksBody)),
    );
    const first = await call("/models", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(first.status).toBe(200);
    const second = await call("/models", {
      headers: { Authorization: "Bearer test-proxy-token" },
    });
    expect(second.status).toBe(200);
    expect(fetches).toBe(1);
  });

  it("caches model data so getModels does not re-fetch", async () => {
    let fetches = 0;
    network.use(
      http.get("https://openrouter.ai/api/v1/models", () => {
        fetches++;
        return HttpResponse.json(modelsBody);
      }),
      http.get("https://openrouter.ai/api/v1/benchmarks", () => HttpResponse.json(benchmarksBody)),
    );
    const cache = new MemoryCache();
    const first = await getModels(testEnv, cache);
    const second = await getModels(testEnv, cache);
    expect(second).toEqual(first);
    expect(fetches).toBe(1);
  });
});
