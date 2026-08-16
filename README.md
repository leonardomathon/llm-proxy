# openrouter-proxy

A private, single-purpose reverse proxy that lets [Pi](https://pi.dev)'s built-in
OpenRouter provider talk to `openrouter.ai` through **your own hostname**
(`https://proxy.example.com`) instead of connecting to `.ai` directly.

Use case: networks that block `.ai` domains (for example restrictive
generative-AI policies) while allowing your own domain. The real OpenRouter API
key lives only on the Cloudflare Worker; Pi only ever holds a generic proxy
token.

## What it does

```text
Pi (built-in `openrouter` provider)
 │ Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
 ▼
https://proxy.example.com/api/v1/*   (Hono on Cloudflare Workers)
 │ validate proxy token
 │ discard client Authorization
 │ inject Authorization: Bearer <OPENROUTER_API_KEY> (server secret)
 ▼
https://openrouter.ai/api/v1/*
```

- Hono reverse proxy running on Cloudflare Workers.
- `pi-openrouter-proxy`: a Pi extension that overrides Pi's built-in
  `openrouter` provider so its native model catalog, streaming, reasoning, and
  tool calls are preserved — only the network/auth boundary changes.

## What it does NOT do

- It is **not** a generic HTTP proxy. The upstream is hard-coded to
  `https://openrouter.ai`; the client can never choose a target host.
- It does **not** hide traffic from the proxy operator, and it does **not**
  defeat endpoint monitoring or TLS interception on managed devices.
- v1 has **no application-layer encryption**. Both hops are normal HTTPS/TLS,
  but the Worker operator can see decrypted payloads. Payload encryption is a
  documented v2 idea, not implemented here.

## Repository layout

```text
apps/proxy/                     Hono Worker (the proxy)
packages/pi-openrouter-proxy/   Pi extension (provider override)
packages/opencode-openrouter-proxy/  OpenCode config (docs only)
scripts/                        setup / deploy / secret-management
.github/workflows/ci.yml        CI
```

## Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io/) (version pinned in `package.json` → `packageManager`)
- A Cloudflare account (for deployment)

## Setup

```bash
pnpm install --frozen-lockfile
```

## Local proxy development

1. Copy the example secrets and fill in real values:

   ```bash
   cp .dev.vars.example apps/proxy/.dev.vars
   # edit apps/proxy/.dev.vars
   ```

2. Run the Worker locally:

   ```bash
   pnpm dev
   ```

3. Smoke test:

   ```bash
   curl http://localhost:8787/healthz                 # -> {"status":"ok"}
   curl -i http://localhost:8787/api/v1/models        # -> 401 without token
   curl -i http://localhost:8787/api/v1/models \
     -H "Authorization: Bearer <your proxy token>"    # -> proxied to OpenRouter
   curl -i http://localhost:8787/models \
     -H "Authorization: Bearer <your proxy token>"    # -> server-rendered model browser
   ```

   Use `curl -N` for streaming endpoints.

## Secrets

Two secrets exist; only one is ever on the Pi machine.

| Secret                   | Where       | Purpose                          |
| ------------------------ | ----------- | -------------------------------- |
| `OPENROUTER_PROXY_TOKEN` | Pi + Worker | generic client → proxy auth      |
| `OPENROUTER_API_KEY`     | Worker only | real OpenRouter key, server-side |

The proxy token is a random secret you generate. The real OpenRouter key is
stored only as a Cloudflare Worker secret and is injected server-side; Pi never
sees it and the client `Authorization` header is always discarded before
forwarding.

## Model browser

`GET /models` renders a compact, server-rendered HTML table of OpenRouter
models (search / sort / provider filter via vanilla JS), including Artificial
Analysis intelligence/coding/agentic indices. It requires the same
`Authorization: Bearer <proxy token>` as `/api/v1/*`, fetches model metadata
server-side with `OPENROUTER_API_KEY`, and caches the data for 15 minutes. The
key never reaches the browser.

## Deploying to Cloudflare

1. Configure the Worker secrets (prompts securely, never in shell history):

   ```bash
   ./scripts/configure-secrets.sh
   ```

2. Attach a custom domain. In `apps/proxy/wrangler.jsonc`, set:

   ```jsonc
   "routes": [{ "pattern": "proxy.example.com", "custom_domain": true }]
   ```

   (Custom Domains require an active Cloudflare zone; see Cloudflare's docs.)

3. Deploy:

   ```bash
   ./scripts/deploy.sh deploy
   ```

   `./scripts/deploy.sh` (no argument) runs all quality gates plus a dry-run
   build without deploying.

## Installing and configuring the Pi extension

```bash
pi install ./packages/pi-openrouter-proxy
```

Set the Pi-side environment:

```bash
export OPENROUTER_PROXY_URL=https://proxy.example.com/api/v1
export OPENROUTER_PROXY_TOKEN=<your proxy token>
```

Then start Pi and use `/model` — the built-in OpenRouter models are available.
No browser login and no direct `openrouter.ai` connection is required, and the
real `OPENROUTER_API_KEY` is never needed on the Pi machine.

The URL must include the `/api/v1` base path (it is the OpenRouter base URL, so
Pi appends `/chat/completions` etc. to it). `http://localhost:...` is allowed
only for local development.

> **Note on `/login openrouter`:** Pi's built-in OpenRouter provider offers a
> browser **"Sign in with OpenRouter"** (PKCE) flow that contacts
> `openrouter.ai` directly — that flow can fail on a blocked network and is
> **not** required. This extension marks the built-in provider as configured
> using the proxy token, so normal use never needs the PKCE flow.

## Quality gates

```bash
pnpm format:check   # oxfmt
pnpm lint           # oxlint (type-aware)
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest (Node + Workers runtime projects)
pnpm check          # all of the above
```

## CI

GitHub Actions runs format → lint → typecheck → tests → Worker dry-run build →
package smoke check on every PR and push to `main`.

## Limitations

- Only `/api/v1/*` is proxied (plus a local `/healthz`).
- Only `GET`, `POST`, `HEAD` are allowed; other methods return 405.
- No application-layer encryption (v2 candidate).
- No per-user rate limiting or multi-provider support (v2 candidates).
- The proxy operator can observe decrypted traffic; treat the proxy as private.
