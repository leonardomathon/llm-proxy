#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/deploy.sh [dry-run | deploy [--env NAME] [extra wrangler flags...]]

TARGET="${1:-dry-run}"
shift || true

echo "==> Quality gates"
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test

echo "==> Worker dry-run build"
pnpm --filter @openrouter-proxy/proxy build

case "$TARGET" in
  dry-run)
    echo "==> Dry-run complete. To deploy run: ./scripts/deploy.sh deploy"
    ;;
  deploy)
    echo "==> Deploying Worker"
    pnpm --filter @openrouter-proxy/proxy exec wrangler deploy "$@"
    ;;
  *)
    echo "Usage: ./scripts/deploy.sh [dry-run | deploy [--env NAME] [extra wrangler flags...]]" >&2
    exit 1
    ;;
esac
