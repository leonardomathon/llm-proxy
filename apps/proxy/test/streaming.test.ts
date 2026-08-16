import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import app from "../src";
import { network } from "./network";

const testEnv = {
  OPENROUTER_PROXY_TOKEN: "test-proxy-token",
  OPENROUTER_API_KEY: "test-openrouter-key",
} as Env;

async function postChat(): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request("https://proxy.example.com/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-proxy-token", "Content-Type": "application/json" },
      body: '{"model":"a","stream":true}',
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("SSE streaming", () => {
  it("delivers the first chunk before the upstream stream closes (no buffering)", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    network.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", () => {
        return new Response(upstream, { headers: { "content-type": "text/event-stream" } });
      }),
    );

    const response = await postChat();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();

    // Emit chunk A while the upstream stream is still open, then read it back
    // before the stream is closed. This proves incremental delivery rather than
    // end-of-stream buffering.
    controller.enqueue(encoder.encode("data: chunk-a\n\n"));
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe("data: chunk-a\n\n");

    // Emit a second chunk and close; the reader must still observe both.
    controller.enqueue(encoder.encode("data: chunk-b\n\n"));
    const second = await reader.read();
    expect(second.done).toBe(false);
    expect(new TextDecoder().decode(second.value)).toBe("data: chunk-b\n\n");

    controller.close();
    const third = await reader.read();
    expect(third.done).toBe(true);
  });

  it("propagates upstream stream errors to the client", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    network.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", () => {
        return new Response(upstream, { headers: { "content-type": "text/event-stream" } });
      }),
    );

    const response = await postChat();
    const reader = response.body!.getReader();
    controller.error(new Error("upstream failed"));
    await expect(reader.read()).rejects.toThrow("upstream failed");
  });
});
