# Security

This proxy is a **private** reverse proxy for OpenRouter. Treat the deployed
endpoint as private infrastructure: anyone who knows the proxy URL and token can
spend your OpenRouter credits.

## Credential model

- `OPENROUTER_PROXY_TOKEN` authenticates the client (Pi) to the proxy using an
  ordinary `Authorization: Bearer <token>` header. Generate a long random
  token. It is stripped and never forwarded upstream.
- `OPENROUTER_API_KEY` is the real OpenRouter key. It exists **only** in the
  Cloudflare Worker's secret store. The Worker injects it server-side. It is
  never logged, never returned in errors, and never required on the client
  machine.
- The client `Authorization` header is always discarded and replaced with the
  server-side OpenRouter credential before forwarding. The client cannot
  override the upstream credential.

## Operational guidance

- Rotate `OPENROUTER_PROXY_TOKEN` immediately if it leaks. It is the only thing
  protecting the endpoint.
- Do not expose Worker secrets; keep `.dev.vars` (local only) out of version
  control.
- The upstream origin is hard-coded to `https://openrouter.ai`. There is no
  client-controllable target, and no generic proxy capability.
- The proxy does not log request/response bodies, `Authorization` headers,
  proxy tokens, or OpenRouter keys. Logs are limited to a request id, method,
  normalized path, status, and duration.

## Reporting vulnerabilities

Please report security issues privately to the repository owner before public
disclosure. Rotate the proxy token and the OpenRouter API key if you suspect a
credential was exposed.

## Acceptable use

Use this service only where you are authorized to do so, and only in compliance
with the applicable network and organizational policies. This project does not
provide, and must not be used as, a tool to bypass access controls beyond its
intended hostname-routing purpose.
