import { readFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import register, { normalizeProxyUrl } from "../src/index";

const URL_ENV = "OPENROUTER_PROXY_URL";
const TOKEN_ENV = "OPENROUTER_PROXY_TOKEN";
const OR_KEY_ENV = "OPENROUTER_API_KEY";
const ENV_KEYS = [URL_ENV, TOKEN_ENV, OR_KEY_ENV] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function makePi() {
  return {
    calls: [] as { name: string; config: Record<string, unknown> }[],
    registerProvider(name: string, config: Record<string, unknown>) {
      this.calls.push({ name, config });
    },
  };
}

describe("pi-openrouter-proxy", () => {
  it("TEST-P01: registers exactly the openrouter provider with proxy config", () => {
    process.env[URL_ENV] = "https://proxy.example.com/api/v1";
    process.env[TOKEN_ENV] = "tok";

    const stub = makePi();
    register(stub as unknown as ExtensionAPI);

    expect(stub.calls).toHaveLength(1);
    const { name, config } = stub.calls[0]!;
    expect(name).toBe("openrouter");
    expect(config.baseUrl).toBe("https://proxy.example.com/api/v1");
    expect(config.apiKey).toBe("$OPENROUTER_PROXY_TOKEN");
    expect(config.models).toBeUndefined();
    expect(config.api).toBeUndefined();
    expect(config.streamSimple).toBeUndefined();
    expect(config.oauth).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain("sk-or-");
  });

  it("TEST-P02: normalizeProxyUrl validates and normalizes", () => {
    expect(normalizeProxyUrl("https://proxy.example.com/api/v1")).toBe(
      "https://proxy.example.com/api/v1",
    );
    expect(normalizeProxyUrl("https://proxy.example.com/api/v1/")).toBe(
      "https://proxy.example.com/api/v1",
    );
    expect(normalizeProxyUrl("http://localhost:8787/api/v1")).toMatch(/^http:\/\/localhost/);
    expect(normalizeProxyUrl("http://127.0.0.1:8787/api/v1")).toBe("http://127.0.0.1:8787/api/v1");
    expect(() => normalizeProxyUrl("not a url")).toThrow(/valid URL/);
    expect(() => normalizeProxyUrl("ftp://proxy.example.com/api/v1")).toThrow(/https/);
    expect(() => normalizeProxyUrl("http://proxy.example.com/api/v1")).toThrow(/https/);
    expect(() => normalizeProxyUrl("https://user:pass@proxy.example.com/api/v1")).toThrow(
      /credentials/,
    );
  });

  it("TEST-P02: missing URL is a no-op; URL without token throws without leaking the token", () => {
    delete process.env[URL_ENV];
    delete process.env[TOKEN_ENV];
    const stub = makePi();
    register(stub as unknown as ExtensionAPI);
    expect(stub.calls).toHaveLength(0);

    process.env[URL_ENV] = "https://proxy.example.com/api/v1";
    delete process.env[TOKEN_ENV];
    expect(() => register(makePi() as unknown as ExtensionAPI)).toThrow(
      "OPENROUTER_PROXY_TOKEN is required when OPENROUTER_PROXY_URL is set",
    );
  });

  it("TEST-P03: built-in openrouter is marked configured via proxy token without PKCE or a real OpenRouter key", () => {
    process.env[URL_ENV] = "https://proxy.example.com/api/v1";
    process.env[TOKEN_ENV] = "proxy-token-value";
    delete process.env[OR_KEY_ENV];

    const stub = makePi();
    register(stub as unknown as ExtensionAPI);

    expect(stub.calls).toHaveLength(1);
    const { config } = stub.calls[0]!;
    expect(config.apiKey).toBe("$OPENROUTER_PROXY_TOKEN");
    expect(config.baseUrl).toBe("https://proxy.example.com/api/v1");
    expect(JSON.stringify(config)).not.toContain(OR_KEY_ENV);
    expect(JSON.stringify(config)).not.toContain("sk-or-");
  });

  it("TEST-P04: register is synchronous and never targets openrouter.ai", () => {
    process.env[URL_ENV] = "https://proxy.example.com/api/v1";
    process.env[TOKEN_ENV] = "tok";

    const stub = makePi();
    const result = register(stub as unknown as ExtensionAPI);

    expect(result).toBeUndefined();
    expect(stub.calls).toHaveLength(1);
    expect(String(stub.calls[0]!.config.baseUrl)).not.toContain("openrouter.ai");
  });

  it("TEST-P05: package manifest advertises the pi extension", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
      name: string;
      keywords?: string[];
      pi?: { extensions?: string[] };
      peerDependencies?: Record<string, string>;
    };

    expect(pkg.name).toBe("pi-openrouter-proxy");
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.pi?.extensions).toContain("./src/index.ts");
    expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBeDefined();
  });
});
