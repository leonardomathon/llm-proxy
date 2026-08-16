#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/configure-secrets.sh [--env NAME]
#
# Configures the two Worker secrets via `wrangler secret put`, which prompts
# interactively so the values never appear in shell history or process args.

ENV_ARGS=()
if [ "${1:-}" = "--env" ]; then
  [ -n "${2:-}" ] || { echo "error: --env requires a name" >&2; exit 1; }
  ENV_ARGS=(--env "$2")
  echo "==> Configuring secrets for environment: $2"
else
  echo "==> Configuring secrets for the default (production) Worker"
fi

echo "==> Setting OPENROUTER_PROXY_TOKEN (client->proxy auth token; use a long random value)"
pnpm --filter @openrouter-proxy/proxy exec wrangler secret put OPENROUTER_PROXY_TOKEN "${ENV_ARGS[@]}"

echo "==> Setting OPENROUTER_API_KEY (real OpenRouter key; server-side only)"
pnpm --filter @openrouter-proxy/proxy exec wrangler secret put OPENROUTER_API_KEY "${ENV_ARGS[@]}"

echo "==> Secrets configured."
