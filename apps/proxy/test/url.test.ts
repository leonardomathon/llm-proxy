import { describe, expect, it } from "vitest";

import { buildUpstreamUrl } from "../src/proxy/url";

function parsed(url: string): URL {
  return new URL(url);
}

describe("buildUpstreamUrl", () => {
  it("preserves the /api/v1 path for chat completions", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/chat/completions");
    expect(parsed(result).pathname).toBe("/api/v1/chat/completions");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
  });

  it("preserves the /api/v1/models path", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/models");
    expect(parsed(result).pathname).toBe("/api/v1/models");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
  });

  it("preserves nested and encoded paths", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/a%20b/c");
    expect(parsed(result).pathname).toBe("/api/v1/a%20b/c");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
  });

  it("preserves query parameter order", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/x?b=2&a=1&c=3");
    expect(parsed(result).search).toBe("?b=2&a=1&c=3");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
  });

  it("preserves duplicate query keys", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/x?a=1&a=2");
    expect(parsed(result).search).toBe("?a=1&a=2");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
  });

  it("never lets an absolute-looking path change the origin", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/https://evil.example/x");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
    expect(parsed(result).hostname).toBe("openrouter.ai");
  });

  it("never lets an encoded // path change the origin", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/%2F%2Fevil.example");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
    expect(parsed(result).hostname).toBe("openrouter.ai");
  });

  it("never lets an @ authority-looking path change the origin", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/@evil.example/x");
    expect(parsed(result).origin).toBe("https://openrouter.ai");
    expect(parsed(result).hostname).toBe("openrouter.ai");
  });

  it("does not forward fragments", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/chat/completions?q=1#frag");
    expect(result.includes("#")).toBe(false);
    expect(parsed(result).hash).toBe("");
  });

  it("omits the query when the incoming request has none", () => {
    const result = buildUpstreamUrl("https://proxy.example.com/api/v1/models");
    expect(parsed(result).search).toBe("");
  });

  it("always targets exactly https://openrouter.ai", () => {
    const inputs = [
      "https://proxy.example.com/api/v1/chat/completions",
      "https://proxy.example.com/api/v1/models",
      "https://proxy.example.com/api/v1/x?foo=bar",
      "https://proxy.example.com/https://evil.example/anything",
    ];
    for (const input of inputs) {
      const result = buildUpstreamUrl(input);
      expect(parsed(result).origin).toBe("https://openrouter.ai");
      expect(parsed(result).host).toBe("openrouter.ai");
    }
  });
});
