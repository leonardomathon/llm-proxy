/**
 * Typed access to Worker secret bindings.
 *
 * Secrets are declared in `worker-configuration.d.ts` (ambient `Env`) and set
 * via `wrangler secret put`. They never appear in source or `wrangler.jsonc`.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Returns the configured proxy token, failing closed when absent or empty. */
export function proxyToken(env: Env): string {
  const token = env.OPENROUTER_PROXY_TOKEN;
  if (!token) {
    throw new ConfigError("OPENROUTER_PROXY_TOKEN is not configured");
  }
  return token;
}

/** Returns the server-side OpenRouter API key, failing closed when absent or empty. */
export function openRouterApiKey(env: Env): string {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    throw new ConfigError("OPENROUTER_API_KEY is not configured");
  }
  return key;
}
