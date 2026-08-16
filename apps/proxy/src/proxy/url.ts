/**
 * Fixed-origin URL builder.
 *
 * Maps an incoming proxy path+query to the hard-coded OpenRouter upstream.
 * The caller can never influence scheme, host, or port.
 */

const UPSTREAM_ORIGIN = "https://openrouter.ai";

/**
 * Build the upstream URL from an incoming request URL.
 *
 * Only the incoming `pathname` and `search` are carried over; the origin is
 * always exactly `https://openrouter.ai`. Fragments are never forwarded.
 */
export function buildUpstreamUrl(requestUrl: string): string {
  const incoming = new URL(requestUrl);
  const upstream = new URL(UPSTREAM_ORIGIN);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  return upstream.toString();
}
