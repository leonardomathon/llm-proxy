import { describe, expect, it } from "vitest";

import { ConfigError, openRouterApiKey, proxyToken } from "../src/config";

describe("proxyToken", () => {
  it("returns the configured token", () => {
    const env = { OPENROUTER_PROXY_TOKEN: "tok", OPENROUTER_API_KEY: "k" } as Env;
    expect(proxyToken(env)).toBe("tok");
  });

  it("fails closed when the token is missing", () => {
    const env = { OPENROUTER_API_KEY: "k" } as Env;
    expect(() => proxyToken(env)).toThrow(ConfigError);
  });

  it("fails closed when the token is empty", () => {
    const env = { OPENROUTER_PROXY_TOKEN: "", OPENROUTER_API_KEY: "k" } as Env;
    expect(() => proxyToken(env)).toThrow(ConfigError);
  });
});

describe("openRouterApiKey", () => {
  it("returns the configured key", () => {
    const env = { OPENROUTER_PROXY_TOKEN: "tok", OPENROUTER_API_KEY: "k" } as Env;
    expect(openRouterApiKey(env)).toBe("k");
  });

  it("fails closed when the key is missing", () => {
    const env = { OPENROUTER_PROXY_TOKEN: "tok" } as Env;
    expect(() => openRouterApiKey(env)).toThrow(ConfigError);
  });

  it("fails closed when the key is empty", () => {
    const env = { OPENROUTER_PROXY_TOKEN: "tok", OPENROUTER_API_KEY: "" } as Env;
    expect(() => openRouterApiKey(env)).toThrow(ConfigError);
  });
});
