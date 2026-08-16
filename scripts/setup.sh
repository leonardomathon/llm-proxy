#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking prerequisites"
command -v node >/dev/null 2>&1 || { echo "error: node is required (>=20)"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "error: pnpm is required"; exit 1; }

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Verifying toolchain"
pnpm typecheck

cat <<'EOF'
Done. Next steps:
  1. cp .dev.vars.example apps/proxy/.dev.vars  and fill in both secrets
  2. pnpm dev            # start the local Worker (wrangler dev)
  3. pnpm check          # format + lint + typecheck + test
  4. See README.md for Cloudflare deployment and Pi configuration.
EOF
