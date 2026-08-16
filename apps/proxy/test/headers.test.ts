import { describe, expect, it } from "vitest";

import { buildUpstreamHeaders } from "../src/proxy/headers";

const API_KEY = "sk-test-key";

describe("buildUpstreamHeaders", () => {
  it("injects the server-side Authorization, discarding any client value", () => {
    const headers = buildUpstreamHeaders(
      new Headers({ Authorization: "Bearer client-secret" }),
      API_KEY,
    );
    expect(headers.get("Authorization")).toBe("Bearer sk-test-key");
  });

  it("drops the client Host header", () => {
    const headers = buildUpstreamHeaders(new Headers({ Host: "evil.example" }), API_KEY);
    expect(headers.get("Host")).toBeNull();
  });

  it("always injects Authorization: Bearer <apiKey>", () => {
    const headers = buildUpstreamHeaders(new Headers(), API_KEY);
    expect(headers.get("Authorization")).toBe("Bearer sk-test-key");
  });

  it("never lets a client Authorization override the injected one", () => {
    const headers = buildUpstreamHeaders(
      new Headers([
        ["Authorization", "Bearer attacker-token"],
        ["authorization", "Bearer another-attacker-token"],
      ]),
      API_KEY,
    );
    expect(headers.get("Authorization")).toBe("Bearer sk-test-key");
  });

  it("preserves Content-Type exactly", () => {
    const headers = buildUpstreamHeaders(
      new Headers({ "Content-Type": "application/json" }),
      API_KEY,
    );
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("preserves Accept exactly", () => {
    const headers = buildUpstreamHeaders(new Headers({ Accept: "text/event-stream" }), API_KEY);
    expect(headers.get("Accept")).toBe("text/event-stream");
  });

  it("preserves OpenRouter attribution headers exactly", () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        "HTTP-Referer": "https://pi.dev",
        "X-OpenRouter-Title": "pi",
        "X-OpenRouter-Categories": "cli-agent",
      }),
      API_KEY,
    );
    expect(headers.get("HTTP-Referer")).toBe("https://pi.dev");
    expect(headers.get("X-OpenRouter-Title")).toBe("pi");
    expect(headers.get("X-OpenRouter-Categories")).toBe("cli-agent");
  });

  it("does not mutate header values", () => {
    // The Headers constructor trims leading/trailing whitespace (Fetch spec);
    // internal spacing must survive the sanitizer exactly.
    const headers = buildUpstreamHeaders(
      new Headers({ "X-Custom": "value  with  double  spaces" }),
      API_KEY,
    );
    expect(headers.get("X-Custom")).toBe("value  with  double  spaces");
  });

  it("drops dropped headers regardless of case", () => {
    const headers = buildUpstreamHeaders(
      new Headers([
        ["Authorization", "a"],
        ["AUTHORIZATION", "b"],
        ["Host", "h"],
        ["hOsT", "h2"],
      ]),
      API_KEY,
    );
    expect(headers.get("Authorization")).toBe("Bearer sk-test-key");
    expect(headers.get("Host")).toBeNull();
  });

  it("drops hop-by-hop and infrastructure headers", () => {
    const headers = buildUpstreamHeaders(
      new Headers([
        ["Connection", "keep-alive"],
        ["Content-Length", "123"],
        ["Transfer-Encoding", "chunked"],
        ["Upgrade", "websocket"],
        ["TE", "trailers"],
        ["Trailer", "X-Checksum"],
        ["Keep-Alive", "timeout=5"],
        ["Proxy-Authorization", "Basic abc"],
      ]),
      API_KEY,
    );
    expect(headers.get("Connection")).toBeNull();
    expect(headers.get("Content-Length")).toBeNull();
    expect(headers.get("Transfer-Encoding")).toBeNull();
    expect(headers.get("Upgrade")).toBeNull();
    expect(headers.get("TE")).toBeNull();
    expect(headers.get("Trailer")).toBeNull();
    expect(headers.get("Keep-Alive")).toBeNull();
    expect(headers.get("Proxy-Authorization")).toBeNull();
  });

  it("keeps unrelated headers while dropping the credential", () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        Authorization: "Bearer client-secret",
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      API_KEY,
    );
    expect(headers.get("Authorization")).toBe("Bearer sk-test-key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
  });
});
