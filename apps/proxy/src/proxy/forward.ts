import type { Context } from "hono";

import { openRouterApiKey } from "../config";
import { buildUpstreamHeaders } from "./headers";
import { buildUpstreamUrl } from "./url";

/**
 * Forward an incoming request to the fixed OpenRouter upstream, streaming the
 * request and response bodies without buffering.
 *
 * The upstream host is fixed; the request body stream and query/path are passed
 * through unchanged. No JSON parsing is performed.
 */
export async function forward(c: Context<{ Bindings: Env }>, request: Request): Promise<Response> {
  const upstreamUrl = buildUpstreamUrl(request.url);
  const apiKey = openRouterApiKey(c.env);
  const headers = buildUpstreamHeaders(request.headers, apiKey);

  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body,
    // Do not follow redirects: preserves upstream status and avoids replaying
    // the Authorization header to a different host.
    redirect: "manual",
  });

  return await fetch(upstreamRequest);
}
