/**
 * Request header sanitization.
 *
 * Strips client credentials and hop-by-hop/infrastructure headers, then injects
 * the server-side OpenRouter credential. Preserves legitimate content and
 * attribution headers.
 */

/** Header names (lower-cased) that must never be forwarded from the client. */
const DROPPED_HEADERS = new Set([
  // Client credential — replaced server-side with the real OpenRouter key.
  "authorization",
  // Set by `fetch` from the upstream URL; a client must not control it.
  "host",
  // Hop-by-hop / infrastructure headers the Workers fetch runtime recomputes
  // or forbids. Dropping them avoids mismatched/forbidden values.
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "upgrade",
  "transfer-encoding",
  "content-length",
  "expect",
]);

/**
 * Build the upstream request headers: copy all client headers except the
 * dropped set, then inject the real OpenRouter `Authorization` header.
 */
export function buildUpstreamHeaders(clientHeaders: Headers, apiKey: string): Headers {
  const headers = new Headers();
  clientHeaders.forEach((value, name) => {
    if (!DROPPED_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  });
  headers.set("Authorization", `Bearer ${apiKey}`);
  return headers;
}
