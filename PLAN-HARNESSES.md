# PLAN-HARNESSES.md — Multi-Harness OpenRouter Proxy Support

> **Status:** Proposed implementation plan  
> **Scope:** OMP and DeepSeek Harness first; reusable seams for later harnesses  
> **Existing data plane:** `apps/proxy` Cloudflare Worker  
> **Existing Pi client:** `packages/pi-openrouter-proxy`

## 1. Outcome

Make the deployed OpenRouter proxy usable from Pi, OMP, and DeepSeek Harness
without putting the real OpenRouter API key on any client machine and without
requiring a direct connection to `openrouter.ai`.

Every supported harness must send ordinary authenticated HTTPS requests to:

```text
https://proxy.example.com/api/v1/*
Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
```

The Worker continues to validate the proxy token, replace it with the
server-side `OPENROUTER_API_KEY`, and forward the unchanged request and response
streams to OpenRouter.

The preferred integration strategy is a built-in OpenRouter provider override,
not a newly invented provider. Preserving the provider identity keeps the
harness's model catalog, capabilities, reasoning dialect, tool-call behavior,
and streaming implementation.

## 2. Goals

- Support Pi, OMP, and DeepSeek Harness through the same deployed Worker.
- Keep `OPENROUTER_API_KEY` exclusively in the Worker environment.
- Keep `OPENROUTER_PROXY_TOKEN` out of committed configuration files.
- Preserve each harness's built-in OpenRouter catalog wherever its API permits.
- Support text, image input, reasoning, tool calls, usage, errors, and SSE.
- Provide a deterministic diagnostic that separates TLS, authentication,
  routing, upstream, and streaming failures.
- Document corporate CA handling for every Node-based harness.
- Pin and contract-test the harness versions used during implementation.
- Make adding a later harness primarily a configuration-adapter task.

## 3. Non-goals

- Do not turn the Worker into a generic forward proxy.
- Do not proxy arbitrary upstream hosts supplied by clients.
- Do not store the real OpenRouter credential on a harness machine.
- Do not bypass corporate network policy or endpoint monitoring.
- Do not disable TLS certificate validation.
- Do not copy a full OpenRouter catalog into this repository unless a harness
  has no safe discovery or built-in-catalog mechanism.
- Do not make the Worker translate between unrelated provider protocols in v1.

## 4. Facts and design constraints

### 4.1 Browser success is not an inference-path test

`GET /models` is a short browser request whose OpenRouter calls happen inside
the Worker. An inference request is an authenticated Node process request using
`POST /api/v1/chat/completions` and usually a long-lived SSE response. The
implementation must test those paths separately.

### 4.2 Corporate TLS inspection

The confirmed laptop failure was:

```text
UNABLE_TO_GET_ISSUER_CERT_LOCALLY
```

The browser trusted the corporate issuer through the Windows trust store, while
Node did not. Supported remedies are:

1. `NODE_OPTIONS=--use-system-ca` when the installed Node version exposes that
   option; or
2. `NODE_EXTRA_CA_CERTS=/path/to/corporate-root.pem` with a certificate supplied
   by the organization's IT/security team.

The diagnostic and all harness launch instructions must inherit the same CA
environment. `NODE_TLS_REJECT_UNAUTHORIZED=0` is forbidden in examples, tests,
scripts, and documentation.

### 4.3 Configuration ownership

Routing configuration and credentials must come from trusted user/deployment
configuration, not from a project checkout that an agent can edit. Project
`.env` files can have higher precedence in some harnesses and can redirect a
credential to a malicious base URL. The documentation must prefer:

- process environment set by a trusted launcher;
- user-level harness configuration;
- harness credential stores that retain only the proxy token; and
- credential references such as `OPENROUTER_PROXY_TOKEN`, never literal tokens
  in YAML committed to a repository.

## 5. Target architecture

```text
Pi extension ──────────────┐
                          │
OMP provider override ────┼── HTTPS + Bearer proxy token
                          │          + OpenRouter wire format
DeepSeek llm-pi-ai route ─┘
                                     │
                                     ▼
                         Cloudflare Worker /api/v1/*
                                     │
                         replace client Authorization
                                     │
                                     ▼
                            https://openrouter.ai/api/v1/*
```

The Worker stays harness-neutral. Each client adapter is responsible only for:

- selecting the harness's OpenRouter provider;
- replacing its base URL with `OPENROUTER_PROXY_URL`;
- resolving `OPENROUTER_PROXY_TOKEN` as Bearer authentication; and
- preserving the harness's native catalog and request implementation.

## 6. Harness designs

### 6.1 Pi — retain the existing extension

Keep `packages/pi-openrouter-proxy` as the reference implementation:

```ts
pi.registerProvider("openrouter", {
  baseUrl: "$OPENROUTER_PROXY_URL",
  apiKey: "$OPENROUTER_PROXY_TOKEN",
});
```

The actual extension resolves and validates the URL before registration. It
must continue omitting `models`, `api`, and custom streaming functions so Pi's
built-in OpenRouter behavior remains authoritative.

### 6.2 OMP — user-level built-in provider override

OMP supports provider overrides in `~/.omp/agent/models.yml`. Implement a
documentation/config package rather than an OMP runtime extension unless
contract testing proves an extension is necessary.

Target configuration:

```yaml
providers:
  openrouter:
    baseUrl: https://proxy.example.com/api/v1
    apiKey: OPENROUTER_PROXY_TOKEN
    authHeader: true
```

Rules:

- Use provider ID `openrouter`, not `openrouter-proxy`, to retain OMP's bundled
  OpenRouter catalog and compatibility detection.
- Omit `models` so the installed catalog remains in effect.
- Treat `apiKey` as an environment-variable reference, not a literal secret.
- Verify whether `authHeader: true` is required or already inherited by the
  built-in provider in the pinned OMP version; include it only if the outgoing
  contract test proves it is needed.
- Store the fragment at user scope. Do not recommend a project-local `.env`
  containing the token.

Proposed files:

```text
packages/omp-openrouter-proxy/
  README.md
  models.example.yml
  package.json                 # only if an installer/validator is shipped
  src/validate-config.ts       # optional, no credential output
  test/config.test.ts
```

The first version may remain docs-only if the configuration contract is stable
and installation automation adds no safety or usability value.

### 6.3 DeepSeek Harness — `llm-pi-ai` OpenRouter catalog route

DeepSeek Harness is in developer preview and its APIs may break. Pin the tested
`@deepseek-ai/dsh` version and record it in the support matrix.

The primary integration uses its `llm-pi-ai` adapter and the installed
`openrouter` catalog route:

```yaml
llm-pi-ai:
  providers:
    openrouter:
      apiKeyEnv: OPENROUTER_PROXY_TOKEN
      baseURL: https://proxy.example.com/api/v1
```

Rules:

- Use route name `openrouter` so `llm-pi-ai` clones the installed OpenRouter
  descriptors and overrides only the base URL and credential source.
- Omit `api` and `models` when the installed catalog provides them.
- Keep the token in the inherited environment or the harness credential store;
  `apiKeyEnv` contains only its reference name.
- Validate that model discovery, reasoning levels, image input, tool calls, and
  subagents all use the overridden route.
- Account for current developer-preview limitations around provider errors,
  retries, reasoning-required models, and cross-provider session replay.

Fallback for a version without an installed OpenRouter route:

```yaml
llm-pi-ai:
  providers:
    openrouter-proxy:
      displayName: OpenRouter via private proxy
      apiKeyEnv: OPENROUTER_PROXY_TOKEN
      api: openai-completions
      baseURL: https://proxy.example.com/api/v1
      compat:
        thinkingFormat: openrouter
      models:
        - id: vendor/model-id
          contextWindow: 131072
```

This fallback requires explicit model metadata and is therefore secondary.

`DEEPSEEK_BASE_URL` with `DEEPSEEK_API_KEY=OPENROUTER_PROXY_TOKEN` is not the
general integration. It routes only the native DeepSeek adapter, requires
OpenRouter-compatible model IDs to be selected explicitly, and does not expose
the full OpenRouter catalog. It may be documented later as a DeepSeek-only
advanced configuration after contract testing.

Proposed files:

```text
packages/deepseek-harness-openrouter-proxy/
  README.md
  settings.example.yaml
  package.json                 # only if a plugin/installer is justified
  test/config.test.ts
```

## 7. Shared client diagnostic

Add `scripts/diagnose-client.mjs`. It must:

1. require `OPENROUTER_PROXY_URL` without printing it in full;
2. require `OPENROUTER_PROXY_TOKEN` without printing any part of it;
3. call `/healthz` with a short timeout;
4. call authenticated `GET /api/v1/models`;
5. call authenticated `POST /api/v1/chat/completions` with a deliberately
   invalid diagnostic model so no paid inference occurs;
6. report HTTP status and a bounded, redacted error body;
7. report nested Node error name/code/message for TLS failures;
8. explain `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` and the two supported CA options;
9. never suggest disabling certificate verification; and
10. exit nonzero unless the first two requests succeed and the POST receives an
    HTTP response from the service boundary.

Example invocation:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
node scripts/diagnose-client.mjs
```

This command is the shared fast feedback loop for all harness integrations.

## 8. Verification matrix

Each supported harness/version must pass:

| Capability                               | Pi       | OMP      | DeepSeek Harness |
| ---------------------------------------- | -------- | -------- | ---------------- |
| No direct `openrouter.ai` client request | Required | Required | Required         |
| Proxy Bearer token sent                  | Required | Required | Required         |
| Real OpenRouter key absent locally       | Required | Required | Required         |
| Built-in catalog preserved               | Required | Required | Preferred        |
| Text streaming                           | Required | Required | Required         |
| Tool calls and tool results              | Required | Required | Required         |
| Reasoning on/off/levels                  | Required | Required | Required         |
| Image input on capable model             | Required | Required | Required         |
| Upstream 4xx/5xx preserved               | Required | Required | Required         |
| Abort/cancellation closes stream         | Required | Required | Required         |
| Corporate system CA launch               | Required | Required | Required         |
| Explicit extra CA launch                 | Required | Required | Required         |

Tests must distinguish catalog visibility from request success. A passing
`--list-models`, Models UI, or `/models` browser page is never sufficient.

## 9. Test strategy

### 9.1 Unit and contract tests

- Validate configuration fragments without resolving or printing secrets.
- Assert the effective provider ID remains `openrouter` for catalog-preserving
  integrations.
- Assert base URLs normalize to an HTTPS `/api/v1` base, with loopback HTTP
  allowed only for tests/local development.
- Capture harness requests against a local mock server and assert method, path,
  Bearer header, model ID, request body, and streaming negotiation.
- Assert the proxy token is replaced before the mocked OpenRouter upstream.
- Pin exact tested harness versions in fixtures and support documentation.

### 9.2 Streaming integration tests

For every harness, use a mock SSE server that:

1. accepts the chat-completions request;
2. emits chunk A;
3. remains open while the test asserts chunk A is visible;
4. emits tool-call deltas and usage;
5. completes with `[DONE]`; and
6. verifies cancellation aborts the request.

### 9.3 TLS tests

- Run the shared diagnostic against a local HTTPS server using a test CA.
- Assert the default Node process fails with a certificate-chain error.
- Assert a fresh process with `NODE_EXTRA_CA_CERTS=<test-ca.pem>` succeeds.
- Treat `--use-system-ca` as a documented/manual Windows verification because
  CI must not mutate the host trust store.

### 9.4 Optional live staging tests

Live tests are opt-in and require staging secrets. They must use a bounded,
low-cost model and a fixed tiny prompt. CI must never call real OpenRouter by
default.

## 10. Implementation phases

### [ ] HARN-00 — Pin upstream contracts

- Record tested Pi, OMP, DeepSeek Harness, and Node versions.
- Capture authoritative config schemas and minimal request fixtures.
- Confirm OMP's built-in provider override keeps all models when `models` is
  omitted and determine whether `authHeader` must be explicit.
- Confirm DeepSeek Harness's `openrouter` catalog route is mounted in the
  shipped profile and accepts a `baseURL` override without a model list.

**Acceptance:** A Markdown support matrix names versions, config files,
credential precedence, and known limitations; contract fixtures fail if an
upstream schema changes.

### [ ] HARN-01 — Shared diagnostics and CA documentation

- Implement `scripts/diagnose-client.mjs`.
- Add sanitized output tests for TLS, timeout, 401, 404/405, 502, and a received
  upstream error response.
- Document `--use-system-ca` and `NODE_EXTRA_CA_CERTS` for PowerShell, POSIX
  shells, and service/container launchers.

**Acceptance:** The confirmed corporate-CA failure produces a precise diagnosis
without revealing URL credentials, tokens, prompts, or response secrets.

### [ ] HARN-02 — OMP integration

- Add the user-level `models.yml` example and installation instructions.
- Add a validator or installer only if it can preserve unrelated user YAML and
  create a recoverable backup; otherwise remain docs-only.
- Add request contract and SSE tests against the pinned OMP release.
- Verify `omp models` shows the built-in catalog and an actual request reaches
  only the proxy hostname.

**Acceptance:** OMP completes text, reasoning, image, and tool-call scenarios
through the Worker with only the proxy token present locally.

### [ ] HARN-03 — DeepSeek Harness integration

- Add the `llm-pi-ai.providers.openrouter` settings fragment.
- Document credential storage and environment precedence.
- Add request, SSE, reasoning, image, tool-call, subagent, and session replay
  contract tests against the pinned developer-preview release.
- Record upstream limitations rather than masking them in the proxy.

**Acceptance:** DeepSeek Harness completes the verification matrix through the
Worker and retains the installed OpenRouter catalog when supported upstream.

### [ ] HARN-04 — Reusable harness adapter specification

Create `docs/adding-a-harness.md` with a checklist for future clients:

- endpoint/base URL override;
- Bearer credential injection;
- provider identity/catalog preservation;
- OpenRouter compatibility and model IDs;
- SSE and cancellation;
- proxy/CA environment propagation;
- config ownership and secret storage;
- request-capture and no-direct-upstream tests; and
- support/version policy.

**Acceptance:** A new OpenAI-compatible harness can be evaluated without
changing Worker code unless it needs a genuinely unsupported protocol.

### [ ] HARN-05 — CI and release documentation

- Add package tests to the workspace only for packages that contain executable
  code.
- Run config/schema tests and the diagnostic's local HTTP/TLS tests in CI.
- Keep real-network tests manual or explicitly opt-in.
- Update the root README support table and troubleshooting flow.

**Acceptance:** `pnpm check` covers every committed adapter/config artifact and
the README accurately separates supported, experimental, and planned clients.

## 11. Definition of done

- Pi, OMP, and DeepSeek Harness each pass the verification matrix on pinned
  versions.
- No supported client contacts `openrouter.ai` directly during normal model
  discovery or inference.
- No real OpenRouter API key exists on any client machine.
- Proxy tokens never appear in committed YAML, logs, test snapshots, or error
  output.
- Corporate CA failures are diagnosed and resolved without weakening TLS.
- SSE is proven incremental rather than merely eventually equal.
- Upstream breaking changes have an explicit compatibility policy and failing
  contract test.
- README and client-specific docs contain copy/pasteable setup and rollback
  instructions.

## 12. Upstream references

- OMP provider and custom-provider configuration:
  <https://github.com/can1357/oh-my-pi/blob/main/docs/providers.md>
- DeepSeek Harness provider guide:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md>
- DeepSeek Harness `llm-pi-ai` adapter:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md>
- DeepSeek Harness native DeepSeek adapter:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/README.md>
- Node.js system and additional CA configuration:
  <https://nodejs.org/api/cli.html#--use-system-ca>
  and <https://nodejs.org/api/cli.html#node_extra_ca_certsfile>
