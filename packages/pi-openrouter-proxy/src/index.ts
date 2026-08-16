import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROXY_URL_ENV = "OPENROUTER_PROXY_URL";
const PROXY_TOKEN_ENV = "OPENROUTER_PROXY_TOKEN";

/**
 * Override Pi's built-in `openrouter` provider to route through a private proxy.
 *
 * The built-in OpenRouter model catalog, streaming, reasoning, and tool-call
 * behavior are all preserved; only the network/authentication boundary changes.
 */
export default function register(pi: ExtensionAPI): void {
  const rawUrl = process.env[PROXY_URL_ENV]?.trim();
  if (!rawUrl) {
    // Not configured: leave Pi's built-in openrouter behavior untouched.
    return;
  }

  if (!process.env[PROXY_TOKEN_ENV]) {
    throw new Error(`${PROXY_TOKEN_ENV} is required when ${PROXY_URL_ENV} is set`);
  }

  const baseUrl = normalizeProxyUrl(rawUrl);

  // `apiKey` here is the proxy token. It becomes `Authorization: Bearer <token>`
  // and marks the built-in provider as configured, so the native OpenRouter
  // models are visible without the OpenRouter PKCE ("Sign in with OpenRouter")
  // browser flow. The real OpenRouter API key is never needed on this machine.
  pi.registerProvider("openrouter", {
    baseUrl,
    apiKey: `$${PROXY_TOKEN_ENV}`,
  });
}

/**
 * Validate and normalize the proxy base URL.
 *
 * Requires https (except `http://localhost`/loopback for local development),
 * rejects embedded credentials, and strips trailing slashes so the base URL
 * is stable for Pi's request construction.
 */
export function normalizeProxyUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${PROXY_URL_ENV} must be a valid URL`);
  }

  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1");

  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error(`${PROXY_URL_ENV} must use https (or http://localhost for local development)`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${PROXY_URL_ENV} must not contain credentials`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}
