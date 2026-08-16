// Worker binding types. Secrets are not declared in wrangler.jsonc (they are
// set via `wrangler secret put`), so they are declared here for type-checking.
interface Env {
  /** Client-facing proxy authentication token (Bearer). */
  OPENROUTER_PROXY_TOKEN: string;
  /** Real OpenRouter API key, server-side only. */
  OPENROUTER_API_KEY: string;
}
