# opencode-openrouter-proxy

Configuration-only support for using [OpenCode](https://opencode.ai) with the
`openrouter-proxy` Cloudflare Worker.

This package is **documentation and configuration only** — there is no
TypeScript, no build step, and no runtime dependency. It reuses OpenCode's
built-in `openrouter` provider so the preloaded OpenRouter model catalog stays
available; no duplicate provider or model catalog is defined.

## Purpose and architecture

OpenCode normally talks to `openrouter.ai` directly with a real OpenRouter key.
This configuration points OpenCode's existing `openrouter` provider at the
private proxy instead, using a generic bearer proxy token as the credential:

```text
OpenCode (built-in `openrouter` provider)
 │ Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
 ▼
https://proxy.example.com/api/v1/*          (Hono on Cloudflare Workers)
 │ validate proxy token
 │ discard client Authorization
 │ inject Authorization: Bearer <OPENROUTER_API_KEY>   (server-side secret)
 ▼
https://openrouter.ai/api/v1/*
```

The real OpenRouter API key exists only on the Worker. It is **never** stored
in OpenCode and never appears in this configuration.

## Required environment variables

```bash
OPENROUTER_PROXY_URL=https://proxy.example.com/api/v1
OPENROUTER_PROXY_TOKEN=<proxy-token>
```

- `OPENROUTER_PROXY_URL` — the proxy base URL, including `/api/v1`.
- `OPENROUTER_PROXY_TOKEN` — the proxy token. It is supplied as OpenCode's
  `apiKey`, so OpenCode sends `Authorization: Bearer <OPENROUTER_PROXY_TOKEN>`.
  The Hono proxy validates it, replaces the header with the server-side
  `OPENROUTER_API_KEY`, and forwards to OpenRouter.

If an environment variable is unset, OpenCode substitutes an empty string, so
both must be set for requests to work.

## Where to put the config

`opencode.json` files merge, and later sources override earlier ones for
conflicting keys. Copy `opencode.example.json` to one of:

| Scope       | Location                                                          |
| ----------- | ----------------------------------------------------------------- |
| User-wide   | `~/.config/opencode/opencode.json`                                |
| Per project | `opencode.json` in the project root (highest standard precedence) |
| Custom path | any file pointed to by `OPENCODE_CONFIG`                          |

If you already have an `opencode.json`, merge just the `provider.openrouter`
block into it rather than overwriting it.

## Models

Because this overrides the built-in `openrouter` provider without defining a
custom provider, the preloaded OpenRouter models remain available under
`/models` (e.g. `openrouter/deepseek/deepseek-v4-flash`).

Do **not** run `/connect` for OpenRouter. `/connect` stores a real OpenRouter
key in OpenCode's auth store, which is both unnecessary and undesirable here —
the proxy already holds the real key server-side.

## Verify the configuration

1. Set the two environment variables.
2. Start OpenCode and run `/models` — OpenRouter models should be listed.
3. Make a model request and confirm the proxy receives it with
   `Authorization: Bearer <proxy-token>` (e.g. watch the Worker's logs, or
   point a local proxy at the Worker and inspect the request).
4. Confirm model traffic goes to `OPENROUTER_PROXY_URL` and never to
   `openrouter.ai` directly (check the Worker log/access, or a network log).

## Troubleshooting

**Models aren't visible, or requests still hit openrouter.ai directly:**
confirm `opencode.json` is in a location OpenCode reads and that the
`provider.openrouter.options.baseURL` value is `{env:OPENROUTER_PROXY_URL}`.

**A stored OpenRouter credential overrides the proxy token:** credentials added
via `/connect` are stored in OpenCode's auth store and can take precedence over
the configured `apiKey`. If you previously connected OpenRouter, remove its
entry from the auth store (e.g. `~/.local/share/opencode/auth.json` on Linux,
`~/Library/Application Support/opencode/auth.json` on macOS; see OpenCode's
docs for your platform) and restart OpenCode so the proxy token takes effect.

**401 from the proxy:** the `OPENROUTER_PROXY_TOKEN` env var is unset, empty,
or wrong. The error body never echoes the token, so double-check the value
itself.

**502 from the proxy:** the Worker's server-side `OPENROUTER_API_KEY` is
missing or invalid.
