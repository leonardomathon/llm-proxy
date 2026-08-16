# PLAN.md — OpenRouter Proxy + Pi Extension

> **Audience:** A capable orchestrator agent (for example GPT-5.6 Sol) coordinating weaker implementation agents.
>
> **Repository:** `openrouter-proxy`
>
> **Primary deliverables:** a Hono reverse proxy for OpenRouter, a Pi extension named `pi-openrouter-proxy`, Cloudflare Workers deployment configuration, CI, automated tests, and operating documentation.
>
> **Status:** implementation plan for v1. Application-layer encryption is explicitly out of scope for v1.

---

## 0. How to use this plan

This file is both:

1. the implementation specification for v1; and
2. the orchestration contract for agents working on the repository.

The orchestrator owns architecture, sequencing, integration, and final acceptance. Sub-agents should receive narrow tasks with explicit file scope and acceptance criteria. A sub-agent must **not** make architecture changes merely because another approach looks easier.

When the repository exists, the orchestrator should update the checkboxes in this file as work is accepted. A task is complete only after:

- its implementation is present;
- its task-specific tests pass;
- relevant lint/type checks pass;
- the orchestrator has reviewed the diff for scope and architectural compliance.

Do not mark a phase complete because an agent says it is complete.

---

# 1. Project objective

Create a small, production-quality proxy that allows Pi's built-in OpenRouter provider to communicate through a user-controlled hostname such as:

```text
https://proxy.example.com
```

instead of connecting from the client directly to:

```text
https://openrouter.ai
```

The client-to-proxy connection and proxy-to-OpenRouter connection both use normal HTTPS/TLS.

The proxy is **not** intended to hide traffic from the proxy operator and does not add application-layer payload encryption in v1.

The Pi integration must preserve Pi's existing `openrouter` provider rather than reimplementing OpenRouter behavior.

Target request flow:

```text
Pi
 │
 │ Generic authenticated HTTPS API request
 │ Authorization: Bearer <PROXY_TOKEN>
 ▼
https://proxy.example.com/api/v1/*
 │
 │ Hono on Cloudflare Workers
 │ - authenticate PROXY_TOKEN
 │ - discard client Authorization
 │ - inject server-side OPENROUTER_API_KEY
 │ - sanitize infrastructure/hop-by-hop headers
 │ - stream body to fixed upstream
 ▼
https://openrouter.ai/api/v1/*
 │
 │ Authorization: Bearer <OPENROUTER_API_KEY>
 ▼
OpenRouter
```

The client must not need to hold a real OpenRouter API key during normal proxy use. The real OpenRouter credential belongs to the Worker environment only.

This is also an explicit privacy/usability goal: on a network that blocks `.ai` domains, Pi should be able to use OpenRouter models without directly contacting `openrouter.ai` for normal model traffic or for initial proxy authentication.

---

# 2. Locked architectural decisions

These are v1 decisions. Sub-agents may not change them without explicit orchestrator approval.

## 2.1 Language and repository

- TypeScript.
- ESM-first.
- pnpm workspace monorepo.
- One repository named `openrouter-proxy`.
- No frontend.
- No database.
- No Docker requirement for v1.
- No Terraform requirement for v1.

## 2.2 Proxy runtime

- Hono is the HTTP application layer.
- Cloudflare Workers is the production runtime.
- Wrangler is the primary local/deployment tool.
- The Worker is the origin for the proxy hostname; production should use a Cloudflare **Custom Domain**.

## 2.3 Pi integration

The Pi extension/package is named:

```text
pi-openrouter-proxy
```

It must **override Pi's existing `openrouter` provider** using `pi.registerProvider("openrouter", ...)`.

It must not:

- define its own OpenRouter model catalog;
- copy OpenRouter model metadata;
- implement a new OpenAI/OpenRouter streaming API;
- duplicate reasoning behavior;
- duplicate cost metadata;
- introduce a new provider name unless a future requirement explicitly requires it.

The extension exists to preserve Pi's native OpenRouter behavior while changing only the network/authentication boundary.

Target behavior:

```text
Pi native provider: openrouter
        │
        ├── native model catalog
        ├── native reasoning behavior
        ├── native tool-call behavior
        ├── native streaming implementation
        │
        └── overridden transport/auth
                 │
                 ▼
        proxy.example.com/api/v1
```

The extension should attempt to configure Pi so that:

```text
OPENROUTER_PROXY_URL
OPENROUTER_PROXY_TOKEN
```

are sufficient for normal operation.

The preferred implementation order is:

1. try an environment-backed provider `apiKey` / authorization configuration if the current Pi extension API supports it while preserving the built-in OpenRouter model catalog;
2. otherwise use a `headers` override with:

   ```http
   Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
   ```

3. only if Pi internally requires its normal provider credential slot to mark OpenRouter as configured, use the proxy token in that slot as a compatibility mechanism.

The real OpenRouter key must not be required on the Pi machine.

### `/login openrouter` behavior

Pi's built-in OpenRouter provider exposes:

```text
/login openrouter
```

with a browser-based **Sign in with OpenRouter** PKCE flow. That flow contacts OpenRouter directly and can fail on networks where `.ai` domains are blocked.

The proxy package must therefore **not depend on the browser PKCE login flow** for normal use.

Desired user experience:

```text
install pi-openrouter-proxy
set OPENROUTER_PROXY_URL
set OPENROUTER_PROXY_TOKEN
start Pi
/model
→ built-in OpenRouter models are available
```

No browser login and no direct `openrouter.ai` connection should be necessary for that path.

If current Pi behavior still requires a credential to mark the built-in `openrouter` provider as configured, the documented fallback is:

```text
/login openrouter
→ Use an API key
→ enter OPENROUTER_PROXY_TOKEN
```

The user must **not** choose **Sign in with OpenRouter** on a blocked network, because that PKCE flow directly reaches OpenRouter.

This fallback stores the proxy token in Pi's OpenRouter credential slot; it does not expose the real OpenRouter API key.

The orchestrator must verify current Pi behavior with automated/contract testing rather than assuming that a `baseUrl` override alone is sufficient to make all OpenRouter models visible.

## 2.4 Credentials

Two separate credentials exist, but only one is present on the client.

### `OPENROUTER_PROXY_TOKEN`

A random secret authenticating Pi to the private proxy.

Pi should send it using the ordinary HTTP authorization mechanism:

```http
Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
```

The Worker validates this value and then discards/replaces the client `Authorization` header before forwarding upstream.

The client-facing request should not contain an OpenRouter-specific authentication header such as:

```text
X-OpenRouter-Proxy-Token
```

The goal is for the request to look like an ordinary authenticated HTTPS API request.

### `OPENROUTER_API_KEY`

The real OpenRouter API key is stored only in the Worker environment, for example as a Cloudflare Worker secret:

```text
OPENROUTER_API_KEY
```

The Worker injects it for the upstream request:

```http
Authorization: Bearer <OPENROUTER_API_KEY>
```

Pi should not require the real OpenRouter API key in normal proxy operation.

Do not use the real OpenRouter API key as the proxy password.

### Credential boundary

```text
Pi machine
  OPENROUTER_PROXY_TOKEN
          │
          ▼
proxy.example.com
  validates proxy token
  removes client Authorization
  injects OPENROUTER_API_KEY
          │
          ▼
openrouter.ai
```

This separation is a locked v1 requirement.

## 2.5 Upstream restriction

The OpenRouter upstream origin is hard-coded in server code/configuration:

```text
https://openrouter.ai
```

The client must never be able to provide or influence the upstream host.

Allowed mapping:

```text
/api/v1/<path>?<query>
      ↓
https://openrouter.ai/api/v1/<path>?<query>
```

Forbidden designs include:

```text
/proxy?url=https://some-host.example
```

or:

```json
{
  "upstream": "https://some-host.example"
}
```

The application must never become a generic HTTP proxy.

## 2.6 Streaming

Production request and response bodies must be passed through as streams where the Fetch/Workers runtime permits.

Do not parse and reserialize request JSON in the proxy path.

Do not collect SSE output into a string or byte array before returning it.

Normal non-streaming responses, errors, JSON, and SSE streams should all traverse the same forwarding mechanism.

## 2.7 Path scope

v1 proxies only:

```text
/api/v1/*
```

A health endpoint is local:

```text
GET /healthz
```

The health endpoint must not contact OpenRouter.

Other local paths return 404.

## 2.8 HTTP methods

For v1, allow only the methods required by Pi/OpenRouter usage:

- `GET`
- `POST`
- `HEAD`

Return `405 Method Not Allowed` for other methods under `/api/v1/*`.

If a future OpenRouter feature genuinely requires another method, expand this deliberately with a test.

## 2.9 Logging and privacy

The proxy must not log:

- `Authorization`;
- `OPENROUTER_API_KEY`;
- full prompt/request bodies;
- full model responses.

Logs may contain operational metadata such as:

- generated request ID;
- method;
- normalized path;
- response status;
- duration;
- coarse error type.

Verbose body logging is explicitly prohibited.

## 2.10 Client-visible OpenRouter metadata

v1 should minimize OpenRouter-specific authentication metadata on the client-to-proxy connection.

The client-facing authentication mechanism is deliberately generic:

```http
Authorization: Bearer <PROXY_TOKEN>
```

Do not introduce headers such as:

```text
X-OpenRouter-Proxy-Token
X-OpenRouter-Key
X-OpenRouter-Auth
```

for normal proxy authentication.

Under ordinary HTTPS, network observers cannot read HTTP headers or bodies; they can still observe the destination hostname/IP and traffic metadata. TLS-inspecting managed environments are a separate threat model and are not solved by v1.

No claim should be made that the project defeats endpoint monitoring or TLS interception on managed devices.

## 2.11 Application-layer encryption

Out of scope for v1.

Do not add:

- libsodium;
- payload encryption;
- custom encrypted envelopes;
- encrypted stream framing;
- key exchange.

The repository may document this as a possible v2.

---

# 3. Repository layout

Target layout:

```text
openrouter-proxy/
├── apps/
│   └── proxy/
│       ├── src/
│       │   ├── index.ts
│       │   ├── app.ts
│       │   ├── config.ts
│       │   ├── middleware/
│       │   │   └── proxy-auth.ts
│       │   └── proxy/
│       │       ├── forward.ts
│       │       ├── headers.ts
│       │       └── url.ts
│       ├── test/
│       │   ├── health.test.ts
│       │   ├── auth.test.ts
│       │   ├── headers.test.ts
│       │   ├── forwarding.test.ts
│       │   ├── security.test.ts
│       │   └── streaming.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── worker-configuration.d.ts
│       └── wrangler.jsonc
│
├── packages/
│   └── pi-openrouter-proxy/
│       ├── src/
│       │   └── index.ts
│       ├── test/
│       │   └── extension.test.ts
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/
│   ├── setup.sh
│   ├── deploy.sh
│   └── configure-secrets.sh
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── .dev.vars.example
├── .gitignore
├── .oxfmtrc.json
├── oxlint.config.ts
├── tsconfig.base.json
├── vitest.config.ts
├── pnpm-workspace.yaml
├── package.json
├── pnpm-lock.yaml
├── README.md
├── SECURITY.md
├── LICENSE
└── PLAN.md
```

The exact split between `app.ts` and `index.ts` may be adjusted for testability, but responsibilities must remain clear:

- `index.ts`: Worker entry point/export.
- `app.ts`: Hono application composition/routes.
- `config.ts`: typed binding/config access.
- `proxy-auth.ts`: proxy-token authentication.
- `url.ts`: safe fixed-origin URL construction.
- `headers.ts`: header sanitization.
- `forward.ts`: upstream request creation and response passthrough.

Do not create a `shared` workspace package in v1 unless actual shared runtime logic appears.

---

# 4. Toolchain

Use:

| Concern | Tool |
|---|---|
| Package manager | pnpm |
| Workspace | pnpm workspaces |
| Language | TypeScript |
| HTTP framework | Hono |
| Runtime | Cloudflare Workers |
| Deployment | Wrangler |
| Linting | Oxlint |
| Type-aware lint | `oxlint-tsgolint` |
| Formatting | Oxfmt |
| Type checking | TypeScript (`tsc --noEmit`) |
| Tests | Vitest |
| Worker-runtime tests | `@cloudflare/vitest-pool-workers` |
| CI | GitHub Actions |

## 4.1 Dependency version policy

At repository bootstrap time:

1. inspect the current stable releases of all direct dependencies;
2. choose mutually compatible versions;
3. pin the package manager using the root `packageManager` field;
4. commit `pnpm-lock.yaml`;
5. use the lockfile as the reproducibility source of truth.

Do **not** blindly copy version numbers from an old example or this planning document.

Use pnpm catalogs for common tooling versions when it improves clarity.

## 4.2 Oxc policy

Use both:

```text
oxlint
oxfmt
```

Enable Oxlint type-aware linting through `oxlint-tsgolint`.

Still retain an explicit `tsc --noEmit` typecheck in v1 CI. Type-aware linting and TypeScript compilation are separate quality gates in this project.

Treat Oxfmt as the formatter. Do not introduce Prettier or Biome alongside it unless the orchestrator records a concrete incompatibility.

---

# 5. Orchestrator operating protocol

This section is mandatory guidance for the smart orchestrator.

## 5.1 Responsibilities reserved for the orchestrator

Do not delegate these decisions blindly:

- changes to architecture in section 2;
- package boundaries;
- credential model;
- upstream security model;
- release readiness;
- final merge/integration;
- accepting a weaker agent's claim that a streaming/security requirement is satisfied;
- dependency upgrades that change public APIs;
- test deletion or weakening.

The orchestrator should inspect diffs and execute the relevant verification commands itself after merging agent work.

## 5.2 How to delegate to weaker agents

Every delegated task should include:

```text
TASK ID:
OBJECTIVE:
FILES ALLOWED TO CHANGE:
FILES TO READ FIRST:
DO NOT:
IMPLEMENTATION REQUIREMENTS:
TESTS TO ADD/UPDATE:
COMMANDS TO RUN:
ACCEPTANCE CRITERIA:
HANDOFF FORMAT:
```

Do not ask a weaker agent:

> "Build the OpenRouter proxy."

Ask it:

> "Implement task PROXY-03 only. Read PLAN.md sections 2.5, 2.6, 8.2 and the existing `url.ts` tests. You may modify `apps/proxy/src/proxy/url.ts` and `apps/proxy/test/security.test.ts`. Do not modify routing, package configuration, or authentication."

Small tasks reduce architectural drift.

## 5.3 Agent handoff format

Require every sub-agent to return:

```text
Task:
Files changed:
Behavior implemented:
Tests added/changed:
Commands run:
Results:
Known limitations:
Questions/risks:
```

"No known limitations" is acceptable. Omitting the field is not.

## 5.4 Before assigning a task

The orchestrator should:

1. inspect current repository state;
2. confirm prerequisite task IDs are complete;
3. tell the agent exactly which existing files are authoritative;
4. provide only the necessary task scope;
5. mention relevant locked architectural decisions.

## 5.5 After receiving a task

The orchestrator should:

1. inspect `git diff`;
2. reject unrelated refactors;
3. inspect all new dependencies;
4. look specifically for secret/body logging;
5. run the task's tests;
6. run typecheck/lint on affected packages;
7. merge only after acceptance criteria pass;
8. update `PLAN.md` checkbox/status.

## 5.6 Parallelization rules

Safe early parallel work:

```text
REPO/toolchain
      │
      ├─────────────► PI extension
      │
      └─────────────► Proxy modules
```

After basic workspace bootstrap, Pi-extension implementation and isolated proxy helper modules can proceed in parallel.

Do **not** parallelize agents editing the same `package.json`, root config, or Hono route composition unless the orchestrator intends to manually integrate the changes.

The final integration, CI, and end-to-end verification should be serialized.

---

# 6. Phase overview and dependency graph

```text
P0 Research/Bootstrap confirmation
        │
        ▼
P1 Workspace + toolchain
        │
        ├───────────────┐
        ▼               ▼
P2 Proxy core       P3 Pi extension
        │               │
        └──────┬────────┘
               ▼
        P4 Automated tests
               │
               ▼
        P5 Deployment/infra
               │
               ▼
        P6 CI + documentation
               │
               ▼
        P7 Staging/manual E2E
               │
               ▼
        P8 Production release
```

---

# 7. Detailed implementation backlog

# Phase 0 — Confirm external contracts

### [x] ORCH-00 — Verify current upstream APIs

**Owner:** orchestrator.

Before implementation, verify current official documentation for:

- Pi custom provider override behavior;
- Pi package manifest format;
- current Hono Cloudflare Worker setup;
- current Cloudflare Vitest integration API;
- current Oxlint/Oxfmt config syntax;
- current Wrangler custom-domain/secrets syntax.

Record any material deviation from this plan in an "Architecture deviations" section at the bottom of this file before coding around it.

**Acceptance criteria**

- No material API assumptions are based solely on memory.
- Any changed external API has a documented adaptation.
- Architectural intent remains unchanged unless explicitly revised.

---

# Phase 1 — Monorepo and quality toolchain

### [x] REPO-01 — Initialize pnpm workspace

Create:

- root `package.json`;
- `pnpm-workspace.yaml`;
- `tsconfig.base.json`;
- directories under `apps/` and `packages/`;
- `.gitignore`.

Root package must be private.

Set:

- ESM;
- exact package-manager declaration;
- useful workspace scripts.

Recommended root scripts:

```text
format
format:check
lint
lint:fix
typecheck
test
test:unit
test:integration
check
dev
deploy
```

Avoid shell commands that only work on macOS if a portable pnpm command suffices.

**Acceptance criteria**

- `pnpm install` succeeds.
- `pnpm -r exec tsc --version` or equivalent can resolve TypeScript.
- workspace packages are discovered.
- lockfile is committed.

---

### [x] REPO-02 — Configure TypeScript

Use strict TypeScript.

At minimum evaluate/enforce:

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "useUnknownInCatchVariables": true,
  "noFallthroughCasesInSwitch": true,
  "noEmit": true,
  "moduleResolution": "Bundler"
}
```

Do not enable flags blindly if they conflict with the current Worker/Pi module requirements; document any omission.

Each package should extend the root base config.

**Acceptance criteria**

- `pnpm typecheck` runs for all packages.
- no generated JS is committed as a side effect of typecheck.

---

### [x] REPO-03 — Configure Oxlint

Create root `oxlint.config.ts`.

Requirements:

- TypeScript plugin/rules.
- type-aware lint enabled.
- `oxlint-tsgolint` installed.
- correctness/suspicious classes treated seriously.
- unhandled/floating promises are errors where supported.
- unused disable directives are rejected.
- test files receive appropriate Vitest globals/config if needed.
- CI fails on warnings or warnings are explicitly kept at zero through equivalent configuration.

Do not add hundreds of hand-selected style rules. Oxfmt owns formatting.

**Acceptance criteria**

- `pnpm lint` succeeds on repository.
- intentionally introduced floating-promise fixture/check is caught during setup validation, then removed.
- Oxlint can resolve both workspace TS configs.

---

### [x] REPO-04 — Configure Oxfmt

Create `.oxfmtrc.json` if configuration is needed.

Add:

```text
pnpm format
pnpm format:check
```

Formatting must cover at least:

- TypeScript;
- JSON/JSONC;
- Markdown;
- YAML used by the repository.

**Acceptance criteria**

- format is deterministic.
- `pnpm format:check` exits non-zero on a deliberately misformatted temp/test file during setup validation.

---

### [x] REPO-05 — Configure Vitest projects

Use current Vitest `projects` configuration rather than deprecated workspace configuration.

Separate conceptually:

- Node-based tests for `pi-openrouter-proxy`;
- Worker-runtime tests for `apps/proxy` using Cloudflare's current Vitest integration.

Do not force all tests into one runtime.

**Acceptance criteria**

- one root test command runs both projects;
- each project can also be run independently;
- test names/output identify the project.

---

# Phase 2 — Hono proxy

### [x] PROXY-01 — Bootstrap Hono Worker

Create the Hono Worker package under:

```text
apps/proxy
```

Implement:

```http
GET /healthz
```

Response should be small and stable, e.g.:

```json
{
  "status": "ok"
}
```

Do not include secrets, build environment, hostname details, Cloudflare metadata, or upstream reachability.

Configure Wrangler and generated Worker binding types according to current Cloudflare guidance.

**Acceptance criteria**

- Worker starts with `wrangler dev`.
- `/healthz` returns 200.
- unrelated route returns 404.
- unit/runtime tests cover health behavior.

---

### [x] PROXY-02 — Typed configuration and secret binding

Define Worker bindings for:

```text
OPENROUTER_PROXY_TOKEN
OPENROUTER_API_KEY
```

The code must fail closed if either secret is absent or empty.

Local development uses a gitignored `.dev.vars` or current Wrangler equivalent.

Commit only:

```text
.dev.vars.example
```

Never commit a real secret.

**Acceptance criteria**

- missing secret does not silently disable auth;
- real secret is absent from Git;
- README explains local secret setup.

---

### [x] PROXY-03 — Proxy authentication middleware

Implement authentication for `/api/v1/*`.

Expected client header:

```http
Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
```

Behavior:

- missing Authorization -> 401;
- unsupported/non-Bearer Authorization -> 401;
- wrong token -> 401;
- correct token -> continue;
- health endpoint does not require proxy token;
- auth failure does not contact upstream;
- error body does not echo the supplied token.

A simple opaque random token is enough for v1.

Do not add OAuth/JWT/session state.

**Acceptance criteria**

- complete auth unit tests;
- no token appears in logs/errors;
- upstream mock not called for rejected requests.

---

### [x] PROXY-04 — Safe URL builder

Create a small pure function that maps an incoming proxy URL to the fixed upstream.

Properties:

- upstream origin is always exactly `https://openrouter.ai`;
- incoming `/api/v1/...` path is preserved;
- query string is preserved;
- caller cannot influence scheme/host/port;
- no user-provided header can change upstream host.

Prefer URL APIs over string concatenation.

**Acceptance criteria**

Tests cover:

- simple path;
- nested path;
- encoded path segment;
- repeated query keys;
- encoded query values;
- malicious absolute URL-looking path input;
- attempted host/scheme injection;
- empty query.

All valid mappings still target exactly `openrouter.ai`.

---

### [x] PROXY-05 — Request header sanitization

Implement a testable header transformation.

Must remove or replace at least:

```text
Authorization   # client-side proxy credential
Host
```

Also sanitize hop-by-hop/infrastructure headers when applicable to the Workers Fetch API. Review current Fetch/Cloudflare behavior before finalizing the explicit list.

Preserve legitimate non-auth OpenRouter request headers such as:

```text
Content-Type
Accept
HTTP-Referer
X-Title
```

unless a specific platform restriction requires otherwise.

After sanitizing the client headers, the Worker must inject:

```http
Authorization: Bearer <OPENROUTER_API_KEY>
```

using the server-side Worker secret.

**Acceptance criteria**

- proxy token never reaches upstream;
- real OpenRouter Authorization is created only server-side;
- client cannot override the upstream OpenRouter credential;
- relevant content negotiation/content type reaches upstream;
- tests prove no accidental mutation of allowed headers.

---

### [x] PROXY-06 — Forwarder

Implement the forwarding function.

Requirements:

- fixed OpenRouter upstream;
- original allowed method;
- sanitized headers;
- original request body stream for methods with bodies;
- query/path preserved;
- return upstream `Response` as directly as possible;
- preserve status;
- preserve response body stream;
- preserve relevant response headers;
- no JSON parsing requirement;
- no model-specific logic.

Use normal platform `fetch`.

Do not use a generic proxy target from request input.

**Acceptance criteria**

- JSON requests arrive at upstream correctly;
- non-JSON payload fixture passes through;
- upstream 2xx and 4xx/5xx statuses are preserved;
- response content type is preserved;
- request body is not deliberately buffered by application code.

---

### [x] PROXY-07 — Route composition and method restriction

Wire:

```text
GET  /healthz
GET  /api/v1/*
POST /api/v1/*
HEAD /api/v1/*
```

or equivalent controlled route dispatch.

Unsupported methods on `/api/v1/*` return 405.

Unknown paths return 404.

Authenticate before invoking the forwarder.

**Acceptance criteria**

- routing tests cover permitted and forbidden methods;
- `/api/v2/foo` is not proxied;
- `/foo` is not proxied;
- auth precedes upstream fetch.

---

### [x] PROXY-08 — Safe operational logging

Add only if useful.

Preferred minimal structured fields:

```text
requestId
method
path
status
durationMs
```

Do not log bodies or secret-bearing headers.

If Cloudflare already provides sufficient request logs and application logging adds no value, v1 may remain intentionally sparse.

**Acceptance criteria**

- test/review confirms no credential/body logging;
- errors are actionable without exposing payloads.

---

# Phase 3 — Pi package

### [x] PI-01 — Create `pi-openrouter-proxy` package manifest

Package directory:

```text
packages/pi-openrouter-proxy
```

Package name:

```text
pi-openrouter-proxy
```

Include Pi package discoverability metadata where appropriate:

```json
{
  "keywords": ["pi-package"]
}
```

Declare the extension through the current supported `pi` manifest mechanism.

Pi core packages imported by the extension must follow Pi's current peer-dependency guidance rather than being bundled unnecessarily.

**Acceptance criteria**

- package can be discovered/loaded by Pi from a local path;
- no duplicate Pi runtime is bundled.

---

### [x] PI-02 — Implement provider override

Implementation should remain intentionally small.

Conceptual target behavior:

```ts
pi.registerProvider("openrouter", {
  baseUrl: proxyBaseUrl,
  // Exact mechanism must be verified against the current Pi API:
  // apiKey/authHeader or an Authorization header override.
})
```

The resulting client request must authenticate to the proxy as:

```http
Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
```

The implementation must prefer an environment-backed Pi configuration that uses `OPENROUTER_PROXY_TOKEN` while preserving the built-in OpenRouter model catalog. Do not introduce an OpenRouter-specific proxy header merely to simplify the implementation.

Default proxy URL policy:

Prefer explicit configuration.

Recommended environment variables:

```text
OPENROUTER_PROXY_URL
OPENROUTER_PROXY_TOKEN
```

Decide whether `OPENROUTER_PROXY_URL` is mandatory or has a documented default such as `https://proxy.example.com/api/v1`. For a reusable public package, mandatory or clearly configurable is preferable to baking in a personal hostname.

Normalize trailing slash behavior so the resulting base URL is valid.

The extension must not access, require, or contain the real OpenRouter API key.

The preferred client authorization is:

```http
Authorization: Bearer <OPENROUTER_PROXY_TOKEN>
```

The exact Pi configuration mechanism (`apiKey`, `authHeader`, `headers`, or compatibility use of the existing provider credential slot) must be selected based on verified current Pi behavior while preserving the built-in model catalog.

**Acceptance criteria**

- registers provider name exactly `openrouter`;
- does not provide `models`;
- does not provide a custom model implementation;
- proxy base URL is correct;
- proxy token is the only credential needed locally for normal proxy operation;
- real OpenRouter API key is absent from Pi;
- built-in OpenRouter models remain visible/usable;
- no PKCE browser login is required for the primary setup path.

---

### [x] PI-03 — Extension configuration validation

Fail early with useful errors for invalid proxy configuration.

Validate at least:

- URL exists if mandatory;
- URL is HTTPS in production/default policy;
- URL includes the expected `/api/v1` base path or normalize/document it;
- proxy token configuration exists.

Do not require or validate a real OpenRouter API key in the Pi extension.

Do not print secret values in errors.

Consider allowing `http://localhost` only for local development/tests.

**Acceptance criteria**

- invalid URLs produce deterministic errors;
- absent proxy token produces a useful error or leaves Pi's env substitution to fail in a documented way;
- no secret is echoed.

---

### [x] PI-04 — Local installation workflow

Document and verify current Pi local installation, for example:

```text
pi install ./packages/pi-openrouter-proxy
```

or temporary loading using current Pi CLI capabilities.

Document required Pi-side environment:

```text
OPENROUTER_PROXY_URL
OPENROUTER_PROXY_TOKEN
```

Do **not** require a real `OPENROUTER_API_KEY` on the Pi machine.

Document two setup paths:

### Preferred path

Environment-backed proxy configuration is sufficient to make the built-in OpenRouter provider/models usable.

```text
OPENROUTER_PROXY_URL=https://proxy.example.com/api/v1
OPENROUTER_PROXY_TOKEN=<proxy-token>
```

### Compatibility fallback

If the current Pi release requires a provider credential for model visibility/configured-state:

```text
/login openrouter
→ Use an API key
→ enter OPENROUTER_PROXY_TOKEN
```

Explicitly document that **Sign in with OpenRouter** uses a direct PKCE/browser flow to OpenRouter and therefore may fail when `.ai` domains are blocked.

**Acceptance criteria**

- fresh local Pi can load the extension;
- `openrouter` remains the provider name;
- built-in OpenRouter models are visible after the preferred path, or the exact fallback requirement is documented from verified behavior;
- no real OpenRouter credential is stored locally;
- no direct OpenRouter PKCE login is required for normal proxy use.

---

# Phase 4 — Automated test plan

This phase is not optional. Tests are part of the implementation.

## 8.1 Test taxonomy

Use four automated levels:

```text
A. Pure unit tests
B. Worker-runtime component/integration tests
C. Pi extension contract tests
D. Repository/static/packaging checks
```

Do not make tests call real OpenRouter by default. Real-network tests belong in manual/staging verification.

---

## 8.2 Pure unit tests

### [x] TEST-U01 — URL builder

Target: `proxy/url.ts`.

Cases:

- preserves `/api/v1/chat/completions`;
- preserves `/api/v1/models`;
- preserves nested/encoded paths;
- preserves query parameter order where platform URL semantics permit;
- preserves duplicate query keys;
- target origin always `https://openrouter.ai`;
- absolute-looking malicious path cannot change origin;
- encoded `//evil.example` cannot change origin;
- input with `@evil.example` cannot change authority;
- fragment is not incorrectly forwarded.

---

### [x] TEST-U02 — Header sanitizer

Target: `proxy/headers.ts`.

Cases:

- removes client proxy `Authorization`;
- removes/normalizes Host as needed;
- injects `Authorization: Bearer <OPENROUTER_API_KEY>` from server config;
- rejects/overwrites any client attempt to control the upstream Authorization value;
- keeps `Content-Type`;
- keeps `Accept`;
- keeps OpenRouter attribution headers;
- does not mutate header values;
- case-insensitive header names behave correctly.

---

### [x] TEST-U03 — Auth middleware

Cases:

- valid Bearer proxy token accepted;
- wrong token rejected;
- missing Authorization rejected;
- non-Bearer Authorization rejected;
- empty token rejected;
- empty configured server secret fails closed;
- auth error body contains no credential;
- health endpoint bypasses proxy auth.

---

### [x] TEST-U04 — Config parsing

Cases:

- valid HTTPS proxy config;
- localhost development exception if supported;
- malformed URL;
- wrong protocol;
- missing required values;
- trailing slash normalization;
- `/api/v1` base path normalization.

---

## 8.3 Worker-runtime component/integration tests

Use the current Cloudflare Vitest integration (`@cloudflare/vitest-pool-workers`) so important tests execute inside `workerd`/Workers semantics rather than only Node.

Use the current recommended `cloudflareTest()`/`cloudflare:workers` APIs, not deprecated examples copied from older tutorials.

Mock outbound `fetch` using the current supported mechanism (direct `globalThis.fetch` mocking or the current recommended request-mocking approach).

### [x] TEST-I01 — Health

- 200.
- stable JSON.
- no auth required.
- no outbound `fetch`.

### [x] TEST-I02 — Authentication before upstream

- no token -> 401 and fetch call count 0;
- wrong token -> 401 and fetch call count 0;
- valid token -> outbound call occurs.

### [x] TEST-I03 — Request forwarding

Use an outbound mock to inspect the generated `Request`.

Verify:

- URL path;
- query;
- method;
- server-injected Authorization;
- Content-Type;
- OpenRouter-specific attribution headers if supplied;
- proxy token absent upstream.

### [x] TEST-I04 — Body fidelity

Send representative bodies:

1. ordinary JSON;
2. JSON with Unicode;
3. larger payload;
4. arbitrary text/body fixture.

Upstream mock reads bytes and verifies content matches expected input.

The production code itself must still avoid pre-buffering.

### [x] TEST-I05 — Response fidelity

Upstream fixtures:

- 200 JSON;
- 400 JSON;
- 401 JSON;
- 429 JSON with rate-limit headers;
- 500 text/JSON;
- empty body;
- HEAD response.

Verify status/body/relevant headers remain correct.

Do not transform OpenRouter errors into proxy-specific 200 responses.

### [x] TEST-I06 — SSE streaming

This is a release-critical test.

Mock an upstream `text/event-stream` response that emits multiple chunks over time.

Test that the client can read the first chunk **before** the upstream stream closes.

The test must distinguish true streaming from eventual body equality.

Suggested assertion shape:

```text
1. start request;
2. acquire response.body reader;
3. upstream emits chunk A;
4. assert reader returns chunk A while stream remains open;
5. upstream emits chunk B;
6. close upstream;
7. assert chunk B arrives;
```

Avoid relying solely on wall-clock sleeps. Prefer controllable streams/promises.

Also verify:

- `Content-Type: text/event-stream` preserved;
- no concatenation/re-serialization;
- stream errors propagate reasonably.

### [x] TEST-I07 — Cancellation/abort

Where test runtime support permits:

- client abort should not leave avoidable work running indefinitely;
- upstream aborted fetch/error should return/propagate a failure appropriately.

Do not overengineer cancellation behavior if Cloudflare's runtime owns propagation, but add at least one regression test for the chosen implementation.

### [x] TEST-I08 — Security/routing

Verify:

- `/api/v2/...` cannot proxy;
- `/https://evil.example/...` cannot proxy;
- strange query parameters cannot choose target;
- client-supplied `Host` cannot choose target;
- proxy secret never sent upstream;
- unsupported methods return 405;
- unknown local paths return 404.

---

## 8.4 Pi extension contract tests

### [x] TEST-P01 — Registration contract

Mock/stub the minimum `ExtensionAPI` surface required.

Invoke the extension and capture `registerProvider`.

Assert:

```text
provider name == "openrouter"
models is absent
baseUrl == configured proxy API base
proxy auth header configured
```

Assert it does **not** define:

- custom API implementation;
- custom models;
- OpenRouter API key;
- new provider name.

### [x] TEST-P02 — Configuration behavior

Test:

- valid URL;
- trailing slash;
- missing URL if required;
- local URL exception if supported;
- malformed URL;
- token environment reference behavior.

### [x] TEST-P03 — No-OpenRouter-login model visibility contract

This is a release-critical Pi integration test.

Primary case:

```text
NO real OPENROUTER_API_KEY locally
NO /login openrouter PKCE flow
OPENROUTER_PROXY_URL configured
OPENROUTER_PROXY_TOKEN configured
```

Verify that Pi can still:

- treat the built-in `openrouter` provider as usable;
- expose its existing OpenRouter model catalog;
- select an OpenRouter model;
- construct a request to the configured proxy base URL.

If current Pi requires its normal credential slot before models become visible, document and test the compatibility path where the **proxy token** is stored via:

```text
/login openrouter
→ Use an API key
```

The test must distinguish this from **Sign in with OpenRouter**, which directly invokes OpenRouter's PKCE flow and is not an acceptable dependency for blocked-network operation.

### [x] TEST-P04 — No direct `.ai` request during normal proxy setup/use

Instrument or mock networking where practical.

For the primary supported setup path, verify that:

- extension initialization does not call `openrouter.ai`;
- model selection does not require a direct call to `openrouter.ai`;
- normal model API requests target only `OPENROUTER_PROXY_URL`.

If Pi itself performs unavoidable direct model-catalog refreshes outside the extension's control, record the exact behavior as an architecture deviation and determine whether the proxy must cover it before release.

### [x] TEST-P05 — Package smoke test

Use Pi itself in a controlled local/manual or CI-compatible smoke test if practical.

At minimum verify the package tarball/local install contains the extension resource advertised in `package.json`.

Consider:

```text
pnpm pack
```

plus inspection of the package contents.

The orchestrator should decide whether a real Pi CLI smoke test is stable enough for normal CI or belongs in a scheduled/manual job.

---

## 8.5 Static and repository checks

### [x] TEST-S01 — Formatting

```text
pnpm format:check
```

### [x] TEST-S02 — Lint

```text
pnpm lint
```

Includes type-aware Oxlint.

### [x] TEST-S03 — Typecheck

```text
pnpm typecheck
```

Uses explicit TypeScript checking.

### [x] TEST-S04 — Unit/integration tests

```text
pnpm test
```

### [x] TEST-S05 — Wrangler validation/build

Run a non-deploying Worker build/dry-run command supported by the current Wrangler release.

Purpose:

- catch Worker bundling/runtime incompatibilities;
- catch missing imports;
- catch Wrangler config problems.

### [x] TEST-S06 — Package integrity

Verify package metadata and lockfile.

Recommended checks:

- `pnpm install --frozen-lockfile`;
- package tarball contains expected Pi extension;
- no `.dev.vars`, secrets, coverage output, or unrelated files enter package tarball.

### [x] TEST-S07 — Secret scanning sanity

At minimum use repository grep/check patterns in CI or a lightweight secret scanner if justified.

Required specific checks:

- no literal OpenRouter API key pattern in tracked files;
- no real proxy token in tracked files;
- `.dev.vars` ignored.

Do not create an elaborate security product dependency for a tiny repository unless warranted.

---

## 8.6 Coverage policy

Coverage is a signal, not the acceptance criterion.

Recommended initial thresholds for pure modules/package tests:

```text
Lines:      >= 85%
Functions:  >= 85%
Statements: >= 85%
Branches:   >= 80%
```

Critical modules should be closer to complete behavioral coverage:

```text
proxy-auth.ts
url.ts
headers.ts
pi-openrouter-proxy/src/index.ts
```

Worker-runtime coverage has tooling/runtime caveats. Do not distort architecture just to produce a single global percentage.

If Cloudflare Worker-runtime coverage requires a different instrumentation provider, keep:

- Node/pure coverage in normal coverage reports;
- Worker behavior proven by integration tests;
- release criteria based on required behavior, not only one percentage.

No test may be deleted merely to restore the coverage number.

---

# Phase 5 — Deployment and infrastructure

### [x] INFRA-01 — Wrangler configuration

Create production-ready `wrangler.jsonc`.

Requirements:

- Worker name;
- source entry;
- current compatibility date chosen at implementation time;
- Custom Domain configuration for production;
- no secret values in file;
- only required compatibility flags.

Consider explicit staging and production environments if the user has a suitable second hostname.

Preferred:

```text
staging-proxy.example.com
proxy.example.com
```

Do not invent domains in committed defaults if the repository is intended to be reusable. Use placeholders/documented configuration.

**Acceptance criteria**

- Wrangler config validates;
- dry-run build succeeds;
- secrets absent.

---

### [x] INFRA-02 — Secret setup script

`scripts/configure-secrets.sh`

Responsibilities:

- fail on command errors;
- explain which Cloudflare environment is being configured;
- invoke Wrangler secret management;
- avoid echoing secret values;
- accept secret via secure prompt/current Wrangler behavior where possible.

Do not embed secrets in shell history through command arguments if avoidable.

---

### [x] INFRA-03 — Deployment script

`scripts/deploy.sh`

Expected sequence:

```text
format check
lint
typecheck
tests
Worker dry run/build
wrangler deploy
```

Allow an explicit environment parameter if staging/production are configured.

Do not silently deploy production by default if the script can reasonably require a target.

---

### [x] INFRA-04 — Setup script

`scripts/setup.sh`

Keep this small.

Possible responsibilities:

- check Node/pnpm availability;
- install dependencies;
- print next steps;
- optionally verify Wrangler authentication.

Do not make the script modify unrelated system configuration.

---

# Phase 6 — CI and documentation

### [x] CI-01 — GitHub Actions

On pull request and push to main:

1. checkout;
2. configure Node;
3. configure pnpm;
4. `pnpm install --frozen-lockfile`;
5. format check;
6. lint;
7. typecheck;
8. tests;
9. Worker dry-run/build;
10. package smoke check.

Use separate steps so failures are easy to locate.

Cache pnpm store using supported setup actions.

Do not put Cloudflare deployment secrets in ordinary PR CI.

### Optional deployment workflow

Only add automated production deployment after manual deployment has succeeded and repository ownership/secrets are understood.

If added:

- deploy staging automatically from main if desired;
- production should use an explicit protected environment/manual approval initially.

---

### [x] DOC-01 — README

README must explain:

- what the project does;
- what it does **not** do;
- architecture diagram;
- prerequisites;
- pnpm setup;
- local proxy development;
- secret setup;
- installing `pi-openrouter-proxy`;
- configuring Pi environment;
- running tests/checks;
- deploying to Cloudflare;
- limitations;
- brief v2 encryption note.

Clearly state that v1 still uses HTTPS and does not add application-layer encryption.

---

### [x] DOC-02 — SECURITY.md

Document:

- proxy should be treated as private;
- use a strong random proxy token;
- rotate leaked proxy tokens;
- do not expose Worker secrets;
- OpenRouter key remains a client credential;
- proxy token is stripped upstream;
- no body logging;
- fixed upstream design;
- vulnerability reporting/contact placeholder if repository is public.

Also explain that the service may be used only where the user is authorized to use it and that local network/organization policies remain applicable.

---

### [x] DOC-03 — `.dev.vars.example`

Example only:

```dotenv
OPENROUTER_PROXY_TOKEN=replace-with-a-long-random-token
OPENROUTER_API_KEY=replace-with-your-openrouter-key
```

No fake value that looks like a live API key.

Pi environment example belongs in README, not necessarily Worker `.dev.vars`:

```text
OPENROUTER_PROXY_URL=http://localhost:8787/api/v1
OPENROUTER_PROXY_TOKEN=...
```

The real `OPENROUTER_API_KEY` belongs only to the Worker environment, not the Pi-side environment.

---

# Phase 7 — Manual/staging test plan

Automated tests are not sufficient because the core purpose depends on real:

- Cloudflare networking;
- custom-domain TLS;
- OpenRouter;
- Pi;
- SSE/model streaming.

Use a staging Worker/domain first when practical.

## 11.1 Local manual tests

### [ ] MAN-01 — Local health

Start:

```text
pnpm dev
```

Verify:

```text
GET /healthz -> 200
```

### [ ] MAN-02 — Local auth rejection

Using curl or equivalent:

- no proxy token -> 401;
- incorrect proxy token -> 401.

Verify no unexpected outbound request occurs through logs/test fixture where observable.

### [ ] MAN-03 — Local proxy request

Use a real OpenRouter API key only if acceptable for the developer.

Send a minimal low-cost request through localhost with:

```text
Authorization: Bearer <local proxy token>
```

The Worker must use its configured `OPENROUTER_API_KEY` when calling OpenRouter.

Verify:

- OpenRouter responds;
- response status/body looks normal;
- wrong proxy token fails locally;
- invalid server-side OpenRouter key produces OpenRouter's auth failure through the proxy rather than a proxy-created success.

---

## 11.2 Staging Cloudflare tests

### [ ] MAN-10 — Deploy staging Worker

Configure secret using Wrangler.

Deploy to staging hostname or `workers.dev` temporarily for pre-production verification.

### [ ] MAN-11 — TLS/domain

Verify:

- HTTPS certificate valid;
- intended hostname reaches Worker;
- `/healthz` reachable;
- no unintended host/route catches unrelated domain traffic.

### [ ] MAN-12 — Real non-streaming OpenRouter call

Through staging domain:

- authenticated proxy request using only the proxy token client-side;
- valid Worker-side OpenRouter key;
- small cheap model/request.

Verify success.

### [ ] MAN-13 — Real streaming OpenRouter call

Use `stream: true`.

Observe chunks arrive incrementally.

Do not only inspect final output.

Suggested manual tools:

- `curl -N`;
- a tiny Node script reading `response.body`;
- Pi itself.

Verify no obvious buffering delay caused by the Worker.

### [ ] MAN-14 — Real upstream errors

Verify pass-through behavior using:

- intentionally invalid OpenRouter API key;
- invalid/nonexistent model if safe;
- malformed OpenRouter request.

Expected:

- OpenRouter-style error/status is visible;
- proxy does not convert to 200;
- proxy secret never appears.

---

# Phase 8 — Pi end-to-end tests

### [ ] MAN-20 — Install local Pi package

Install/load:

```text
packages/pi-openrouter-proxy
```

using Pi's current supported local-package mechanism.

### [ ] MAN-21 — Verify model catalog remains OpenRouter without PKCE login

Start from a clean Pi credential state where practical.

Configure only:

```text
OPENROUTER_PROXY_URL
OPENROUTER_PROXY_TOKEN
```

Check Pi model listing/selection.

Expected primary behavior:

- provider remains `openrouter`;
- existing OpenRouter models remain available;
- extension did not create a duplicate provider;
- no browser-based **Sign in with OpenRouter** flow is required;
- no real OpenRouter API key is present locally.

If current Pi requires a provider credential for visibility, validate the fallback:

```text
/login openrouter
→ Use an API key
→ enter OPENROUTER_PROXY_TOKEN
```

Confirm that this path does not invoke OpenRouter PKCE/browser authentication.

### [ ] MAN-22 — Pi non-streaming/basic interaction

Run a simple prompt through an inexpensive model.

Verify:

```text
Pi -> custom proxy hostname -> OpenRouter -> response
```

### [ ] MAN-23 — Pi streamed interaction

Use normal interactive Pi output.

Verify tokens/content appear progressively as expected.

### [ ] MAN-24 — Pi tool call

Choose a model known to support tool calls and execute a trivial safe tool flow.

Reason: this verifies that the proxy has not accidentally changed request/stream handling for OpenRouter's structured/tool responses.

### [ ] MAN-25 — Pi reasoning-capable model

If available within reasonable cost, use one built-in OpenRouter model with Pi reasoning/thinking functionality.

Reason: the architecture intentionally preserves Pi's native OpenRouter implementation; this smoke test verifies that the override has not disabled those provider features.

### [ ] MAN-26 — Failure behavior

Test:

- wrong proxy token -> clear proxy 401;
- missing proxy URL/config -> useful local failure;
- invalid Worker-side OpenRouter key -> upstream auth failure;
- temporarily invalid upstream path/model -> upstream error remains intelligible.

---

# Phase 9 — Network-purpose validation

The original use case is that some networks block `.ai` domains while allowing the user's proxy hostname.

This must be tested only on networks where use is permitted.

### [ ] MAN-30 — Normal network baseline

On an unrestricted connection:

- direct OpenRouter works;
- proxy OpenRouter works.

### [ ] MAN-31 — Restricted-network validation

On the target restricted network, where authorized:

- confirm direct `openrouter.ai` is blocked;
- confirm `proxy.example.com` resolves and connects;
- start Pi without using **Sign in with OpenRouter**;
- confirm built-in OpenRouter models are visible through the supported proxy configuration/fallback;
- Pi works through the proxy;
- model streaming works;
- no application fallback accidentally contacts `openrouter.ai` directly.

Explicitly test that the documented setup does not depend on the OpenRouter PKCE browser flow.

If Pi or another component performs direct model-catalog/authentication calls to `openrouter.ai`, record them. Determine whether they are operationally required and whether the current provider override can eliminate or proxy them before changing architecture.

Do not attempt to defeat controls beyond the intended hostname proxy behavior.

---

# 10. Security test plan

Treat these as release gates.

### [x] SEC-01 — No open proxy

Attempt to manipulate:

- path;
- query;
- Host header;
- absolute-looking URL;
- encoded URL;
- OpenRouter-style arbitrary metadata fields.

All outbound requests must still target:

```text
https://openrouter.ai
```

### [x] SEC-02 — Proxy secret isolation

Prove proxy token is:

- required as client Bearer authentication;
- never forwarded upstream;
- never logged;
- never returned in errors.

### [x] SEC-03 — OpenRouter credential isolation

Prove the real `OPENROUTER_API_KEY`:

- exists only in Worker/server configuration;
- is never required by the Pi extension;
- replaces the client Authorization value before upstream forwarding;
- cannot be overridden by client input;
- is never logged;
- is never echoed in errors.

### [x] SEC-04 — No request/response body logging

Search code and exercise error paths.

### [x] SEC-05 — Repository secrets

Before release:

```text
git grep
git status
git log inspection if necessary
```

Verify no actual credentials were ever committed.

If a secret was committed even briefly, rotate it rather than relying only on deleting the line.

### [x] SEC-06 — Dependency review

Review direct runtime dependencies.

Desired runtime dependency set should remain extremely small; ideally the Worker primarily needs Hono plus platform APIs.

Reject dependencies that:

- add generic proxy behavior unnecessarily;
- collect telemetry unexpectedly;
- duplicate Fetch;
- add crypto despite v1 scope;
- bring large transitive trees for trivial helpers.

---

# 11. Performance and reliability checks

Do not prematurely benchmark microseconds. Focus on properties that matter for an LLM proxy.

### [x] PERF-01 — No intentional response buffering

Code review + streaming integration test.

### [x] PERF-02 — No intentional request buffering

Code review + body fidelity test.

### [x] PERF-03 — Large-enough request smoke test

Send a reasonably large synthetic JSON body without costly model execution, preferably against an outbound mock.

Goal: catch accidental body parsing/copying assumptions.

### [ ] PERF-04 — Concurrent request smoke test

Automated or staging test with several simultaneous mocked/cheap requests.

Verify no global request-scoped mutable state.

### [x] PERF-05 — Upstream timeout/failure behavior

Simulate network failure/throw from outbound `fetch`.

Expected:

- proxy returns a sensible 5xx response or lets Hono's controlled error handler do so;
- no secret/body leak;
- no process-level crash.

Do not implement aggressive custom timeouts unless there is a clear need; long LLM responses can legitimately take time.

---

# 12. CI acceptance matrix

A PR must not merge unless relevant checks pass.

| Change type | Format | Lint | Typecheck | Unit | Worker integration | Pi contract | Wrangler dry-run |
|---|---:|---:|---:|---:|---:|---:|---:|
| Docs only | ✓ | optional | optional | optional | optional | optional | optional |
| Proxy code | ✓ | ✓ | ✓ | ✓ | ✓ | if relevant | ✓ |
| Pi extension | ✓ | ✓ | ✓ | ✓ | optional | ✓ | optional |
| Root tooling | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Wrangler/infra | ✓ | ✓ | ✓ | relevant | ✓ | optional | ✓ |

The orchestrator may run more checks, never fewer, when risk is unclear.

---

# 13. Definition of Done for v1

v1 is done only when all statements below are true.

## Repository

- [ ] pnpm monorepo is clean and reproducible.
- [ ] TypeScript is strict.
- [ ] Oxlint passes.
- [ ] Oxfmt check passes.
- [ ] explicit TypeScript typecheck passes.
- [ ] tests pass.
- [ ] CI passes from a clean clone.
- [ ] no real credentials are tracked.

## Proxy

- [ ] Hono Worker runs locally.
- [ ] Worker deploys to Cloudflare.
- [ ] custom domain works over HTTPS.
- [ ] `/healthz` works.
- [ ] `/api/v1/*` requires proxy auth.
- [ ] fixed OpenRouter origin is enforced.
- [ ] client proxy Authorization is stripped/replaced.
- [ ] Worker injects the real OpenRouter Authorization server-side.
- [ ] client cannot control the upstream OpenRouter credential.
- [ ] query/path/body are forwarded correctly.
- [ ] upstream status/errors are preserved.
- [ ] SSE streaming is demonstrably incremental.
- [ ] unsupported paths/methods do not proxy.
- [ ] no prompts/responses/secrets are logged.

## Pi extension

- [ ] package is named `pi-openrouter-proxy`.
- [ ] Pi can install/load it.
- [ ] it overrides provider `openrouter`.
- [ ] it does not define models.
- [ ] Pi's built-in OpenRouter model catalog remains available.
- [ ] real OpenRouter API key is not required or stored by Pi.
- [ ] proxy URL and proxy token are configurable.
- [ ] built-in OpenRouter models are visible without requiring PKCE/browser login.
- [ ] if a Pi credential-state fallback is required, `/login openrouter` → `Use an API key` with the proxy token is documented and tested.
- [ ] `Sign in with OpenRouter` is not required for normal operation.
- [ ] basic prompt works through proxy.
- [ ] streaming prompt works through proxy.
- [ ] tool-call smoke test works.
- [ ] reasoning-capable model smoke test works if economically practical.

## Documentation

- [ ] README can take a developer from clone to local run.
- [ ] README can take a developer from local run to Cloudflare deployment.
- [ ] README explains Pi installation/configuration.
- [ ] SECURITY.md exists.
- [ ] limitations are explicit.
- [ ] v1 encryption non-goal is explicit.

---

# 14. Suggested agent task decomposition

This section is specifically optimized for orchestrating weaker agents.

After REPO-01 is complete, suggested assignments are:

## Agent A — Tooling

Give only:

```text
REPO-02
REPO-03
REPO-04
```

Do not give it proxy code.

## Agent B — Proxy pure helpers

Give:

```text
PROXY-04
PROXY-05
TEST-U01
TEST-U02
```

Files limited to URL/header helpers and tests.

## Agent C — Proxy authentication

Give:

```text
PROXY-02
PROXY-03
TEST-U03
```

Avoid route/forwarding work.

## Agent D — Pi extension

Give:

```text
PI-01
PI-02
PI-03
TEST-P01
TEST-P02
TEST-P03
TEST-P04
```

It should not edit Worker code.

## Agent E — Forwarding

After helpers exist:

```text
PROXY-06
PROXY-07
TEST-I03
TEST-I04
TEST-I05
TEST-I08
```

## Agent F — Streaming specialist

After forwarder exists:

```text
TEST-I06
TEST-I07
```

Ask this agent to focus on proving true incremental streaming rather than refactoring the proxy.

## Agent G — Infrastructure/docs

After application API is stable:

```text
INFRA-01
INFRA-02
INFRA-03
INFRA-04
DOC-03
```

## Agent H — CI

After test commands stabilize:

```text
CI-01
TEST-S01..S07
```

## Orchestrator

Retain:

```text
ORCH-00
integration of app.ts/index.ts
manual staging deployment
MAN-* tests
SEC final review
Definition of Done
production release
```

README/SECURITY may be delegated, but orchestrator must verify every command and architectural statement.

---

# 15. Example sub-agent prompts

## Example: URL-security agent

```text
TASK ID: PROXY-04 + TEST-U01

OBJECTIVE:
Implement the fixed-origin URL builder for the OpenRouter proxy.

FILES TO READ FIRST:
- PLAN.md sections 2.5, 2.7, 8.2, 10
- apps/proxy/src/proxy/url.ts if it exists
- relevant current tests

FILES ALLOWED TO CHANGE:
- apps/proxy/src/proxy/url.ts
- apps/proxy/test/url.test.ts or security.test.ts

DO NOT:
- change Hono routes
- add dependencies
- edit authentication
- make the upstream configurable from request input
- parse request bodies

IMPLEMENTATION REQUIREMENTS:
Every generated upstream URL must use https://openrouter.ai.
Preserve /api/v1 path and query safely using the URL API.

TESTS:
Add valid and malicious cases listed in TEST-U01.

COMMANDS:
Run the focused Vitest project, lint affected files, and typecheck proxy package.

ACCEPTANCE:
All tests pass and no input can alter origin.

HANDOFF:
Return files changed, tests, commands/results, and known limitations.
```

## Example: Pi-extension agent

```text
TASK ID: PI-02 + TEST-P01

OBJECTIVE:
Implement pi-openrouter-proxy as an override of Pi's built-in openrouter provider.

READ:
- PLAN.md 2.3, 2.4, Phase 3
- current official Pi custom-provider docs
- existing package manifest

ALLOWED FILES:
- packages/pi-openrouter-proxy/src/index.ts
- packages/pi-openrouter-proxy/test/extension.test.ts

DO NOT:
- register a new provider name
- provide models
- implement streaming
- touch Worker code
- store the OpenRouter key

REQUIRED:
registerProvider("openrouter", ...)
override baseUrl
configure Authorization to use OPENROUTER_PROXY_TOKEN
preserve Pi's built-in OpenRouter model catalog
do not require the real OpenRouter API key locally
do not depend on OpenRouter PKCE/browser login

TEST:
Capture registerProvider and assert provider name/config; assert models absent.
Verify the supported configuration path leaves built-in OpenRouter models usable.
If Pi requires its provider credential slot, use/test the proxy-token compatibility path and document it.

HANDOFF:
Standard agent handoff format.
```

## Example: streaming-test agent

```text
TASK ID: TEST-I06

OBJECTIVE:
Prove that the Worker forwards OpenRouter-style SSE incrementally and does not buffer the complete response.

READ:
- PLAN.md 2.6 and TEST-I06
- current Cloudflare Vitest integration docs
- existing forwarder
- existing worker tests

ALLOWED:
- streaming test files
- only minimal production fix if test exposes genuine buffering; flag such a change prominently

DO NOT:
- replace the forwarding architecture
- add WebSockets
- add application encryption
- use a test that only compares final text

REQUIRED TEST:
Control an upstream ReadableStream manually.
Read first downstream chunk while upstream is still open.
Then release second chunk and close.
Assert content type and ordering.

HANDOFF:
Explain exactly why the test proves incremental delivery.
```

---

# 16. Failure handling rules for orchestrator

When a weaker agent fails a task:

1. do not immediately ask it to "fix everything";
2. identify the smallest failing acceptance criterion;
3. provide the failing command/output;
4. constrain the next task to the relevant files;
5. prevent the agent from rewriting known-good modules.

If an agent introduces architectural drift:

- revert or isolate the unrelated changes;
- restate the locked decision;
- reassign a smaller correction task.

If tests disagree with implementation requirements:

- the plan/architecture wins unless official upstream behavior proves the plan factually wrong;
- update the plan explicitly before changing the contract.

Do not weaken security or streaming tests just to make CI green.

---

# 17. Release procedure

## 17.1 Pre-release

- [ ] Clean checkout.
- [ ] `pnpm install --frozen-lockfile`.
- [ ] `pnpm format:check`.
- [ ] `pnpm lint`.
- [ ] `pnpm typecheck`.
- [ ] `pnpm test`.
- [ ] Wrangler dry run/build.
- [ ] inspect package tarball.
- [ ] inspect Git diff/status.
- [ ] secret scan.
- [ ] staging deploy.
- [ ] manual streaming test.
- [ ] Pi end-to-end test.

## 17.2 Production

- [ ] configure production `OPENROUTER_PROXY_TOKEN`;
- [ ] deploy Worker;
- [ ] verify custom domain/TLS;
- [ ] test `/healthz`;
- [ ] test proxy auth rejection;
- [ ] send one cheap OpenRouter request;
- [ ] send one streaming request;
- [ ] configure `pi-openrouter-proxy`;
- [ ] run Pi smoke test.

## 17.3 Rollback

Before initial production use, document a simple rollback:

- redeploy previous Worker version using Cloudflare's supported deployment/version mechanism, or
- deploy known-good Git revision;
- rotate proxy token if a credential-related failure occurred.

The proxy has no persistent state, so rollback should remain operationally simple.

---

# 18. Deliberately deferred v2 work

Do not implement these during v1 unless the user changes scope.

Possible v2:

```text
application-layer encryption
encrypted request envelope
encrypted streaming response frames
key rotation/key IDs
multiple proxy users
per-token rate limits
Cloudflare Access
analytics/metrics dashboard
Terraform
multi-provider proxying
OpenAI/Anthropic direct-provider support
KV/Durable Objects
automatic proxy-token provisioning
```

Application-layer encryption should be its own design exercise because streaming encryption, replay protection, nonces, authenticated metadata, key storage, and protocol versioning introduce materially different complexity.

---

# 19. Architecture invariants checklist

An orchestrator should re-read this before accepting major changes.

```text
[ ] Upstream host cannot be client-controlled.
[ ] Provider remains Pi's built-in "openrouter".
[ ] pi-openrouter-proxy has no model catalog.
[ ] Real OpenRouter API key exists only server-side.
[ ] Proxy token is the only normal Pi-side credential.
[ ] Proxy token never goes upstream.
[ ] Client Authorization is replaced with server-side OpenRouter Authorization.
[ ] Request body is not parsed merely for forwarding.
[ ] Response is not buffered merely for forwarding.
[ ] SSE behavior is tested incrementally.
[ ] No prompt/response/secret logging.
[ ] Normal Pi setup/use does not depend on OpenRouter PKCE/browser login.
[ ] Built-in OpenRouter models remain available through the proxy configuration.
[ ] Only /api/v1/* proxies.
[ ] v1 has no custom encryption.
[ ] Cloudflare secrets are not committed.
[ ] Tests run in appropriate Node and Workers runtimes.
```

If any box would become false, stop and obtain an explicit architecture decision.

---

# 20. Verified external assumptions at plan creation

The following external contracts were checked against current official documentation when this plan was prepared (2026-08-16). The orchestrator should still re-check them if implementation occurs much later.

1. **Pi custom providers:** overriding an existing provider using only `baseUrl` and/or `headers` preserves that provider's existing models. This is the basis of `pi-openrouter-proxy`.
2. **Pi packages:** packages can declare extensions in the `pi` manifest; Pi core packages imported by extensions should be peer dependencies according to Pi package guidance.
3. **Hono + Cloudflare:** Hono supports Cloudflare Workers directly, TypeScript, Wrangler, and Worker testing patterns.
4. **Cloudflare Worker tests:** Cloudflare currently recommends Vitest with `@cloudflare/vitest-pool-workers`; current APIs use the Workers Vitest integration and support unit/integration tests inside Workers semantics.
5. **Cloudflare outbound mocking:** current testing guidance supports mocking global `fetch`/using compatible request mocking instead of relying on older removed fetch-mock APIs.
6. **Cloudflare deployment:** Custom Domains are appropriate when the Worker itself is the origin; secrets belong in Worker secret bindings, not source/Wrangler plaintext variables.
7. **Oxlint:** type-aware linting is supported using `oxlint-tsgolint`.
8. **Vitest:** monorepo/multi-configuration testing should use the current `projects` configuration rather than deprecated workspace configuration.
9. **pnpm:** native workspaces are suitable for the repository and should be backed by a committed lockfile.

Official documentation to consult during implementation:

```text
https://pi.dev/docs/latest/custom-provider
https://pi.dev/docs/latest/packages
https://pi.dev/docs/latest/providers

https://hono.dev/docs/getting-started/cloudflare-workers
https://hono.dev/docs/guides/testing
https://hono.dev/docs/helpers/proxy

https://developers.cloudflare.com/workers/
https://developers.cloudflare.com/workers/testing/vitest-integration/
https://developers.cloudflare.com/workers/configuration/secrets/
https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

https://oxc.rs/docs/guide/usage/linter
https://oxc.rs/docs/guide/usage/linter/type-aware
https://oxc.rs/docs/guide/usage/formatter

https://pnpm.io/workspaces
https://vitest.dev/guide/projects
```

---

# 21. Architecture deviations

## 2026-08-16 — ORCH-00 findings: Pi provider override mechanism (verified against installed pi 0.84.2 + @earendil-works/pi-ai 0.84.2)

**Decision:** Use `pi.registerProvider("openrouter", { baseUrl, apiKey: "$OPENROUTER_PROXY_TOKEN" })` as the single override mechanism. No `headers` override and no `/login` fallback are required for the normal path.

**Reason/evidence:** Reading `pi-coding-agent/dist/core/provider-composer.js` and `model-runtime.js`:
- `applyExtension()` rewrites `baseUrl` on ALL existing built-in `openrouter` models when no `models` array is supplied, preserving the native catalog (models use `api: "openai-completions"`, `provider: "openrouter"`).
- `configuredRequestAuthStatus()` marks a provider "configured" (and therefore exposes its models in `snapshot.available`) only when `extension.apiKey` / `config.apiKey` is set; `headers`/`baseUrl` alone do NOT mark configured. The extension `apiKey` therefore both (a) makes the built-in OpenRouter models visible without any `/login`/PKCE and (b) resolves into the request `Authorization: Bearer <token>` via the OpenAI-completions client (`new OpenAI({ apiKey, ... })`). Plan options 1 and 3 thus collapse into one mechanism.
- `baseUrl` in an extension config is used verbatim (no `$ENV` interpolation in `applyExtension`), so the extension must resolve `OPENROUTER_PROXY_URL` from `process.env` itself. `apiKey` DOES support `$ENV`/`${ENV}` interpolation and pi's missing-env handling.
- Normal startup (`registerProvider` → `refresh({ allowNetwork: false })`, `checkAuth`, `getAvailable`) performs no network call to `openrouter.ai`; the built-in catalog is local (`models.generated.js`) and model refresh only occurs on explicit `pi update --models` with network enabled.
- Pi's OpenRouter attribution headers (telemetry-enabled) are `HTTP-Referer: https://pi.dev`, `X-OpenRouter-Title: pi`, `X-OpenRouter-Categories: cli-agent` (NOT `X-Title`). The proxy preserves these.

**Toolchain versions verified (2026-08-16):** hono 4.13.2, wrangler 4.123.0, vitest 4.1.10, @cloudflare/vitest-pool-workers 0.21.3 (uses `cloudflareTest({ wrangler: { configPath } })`), oxlint 1.78.0, oxfmt 0.63.0, oxlint-tsgolint 7.0.2001 (standalone `tsgolint` native binary), @cloudflare/workers-types 5.20260816.1, typescript latest 7.0.2 (5.9.3 last 5.x). Wrangler custom domains use `routes: [{ pattern, custom_domain: true }]`.

**Affected task IDs:** PI-02, PI-03, PI-04, TEST-P01..P04, PROXY-05, TEST-U02, TEST-I03.

**Approved by:** orchestrator (within plan intent; no locked decision changed).

## 2026-08-16 — Server-side OpenRouter credential and PKCE-independent Pi setup

**Decision:** Replace the original client-held OpenRouter-key + custom proxy-header design with a generic client Bearer token and a Worker-held real OpenRouter API key.

**Reason:** The client connection should expose no OpenRouter-specific authentication header, the real OpenRouter key should remain server-side, and Pi must remain usable on networks where direct `.ai` access—including OpenRouter's browser PKCE login—is blocked.

**Evidence/constraint:** Pi's native OpenRouter provider and model catalog should still be reused. The implementation must verify whether environment-backed provider auth is enough to mark the built-in provider/models as configured. If not, `/login openrouter` → `Use an API key` with the proxy token is the compatibility fallback. `Sign in with OpenRouter` is not an acceptable required path for this project because it directly contacts OpenRouter.

**Affected task IDs:** PROXY-02, PROXY-03, PROXY-05, PROXY-06, PI-02, PI-03, PI-04, TEST-U02, TEST-U03, TEST-I02, TEST-I03, TEST-P01 through TEST-P04, MAN-03, MAN-21 through MAN-26, MAN-31, SEC-02, SEC-03.

**Migration/test impact:** Worker now requires both `OPENROUTER_PROXY_TOKEN` and `OPENROUTER_API_KEY`; client sends only `Authorization: Bearer <OPENROUTER_PROXY_TOKEN>`; upstream Authorization is always injected server-side. Add model-visibility and no-direct-`.ai` contract tests.

**Approved by:** user.

When changing another locked decision, add an entry:

```text
Date:
Decision:
Reason:
Evidence:
Affected task IDs:
Migration/test impact:
Approved by:
```

Do not silently let code become the architecture specification.

---

# 22. First execution order

The orchestrator should begin with this exact sequence:

```text
1. ORCH-00
2. REPO-01
3. REPO-02
4. REPO-03
5. REPO-04
6. REPO-05
7. PROXY-01
```

Then parallelize:

```text
Track A:
PROXY-02 -> PROXY-03 -> TEST-U03

Track B:
PROXY-04 + TEST-U01
PROXY-05 + TEST-U02

Track C:
PI-01 -> PI-02 -> PI-03 -> TEST-P01/P02
```

Rejoin:

```text
PROXY-06
PROXY-07
Worker integration tests
Streaming test
Security tests
Infrastructure
CI
Docs
Staging
Pi E2E
Production
```

The first release should favor a small, well-tested implementation over generalized abstraction.

---

# 23. Final expected v1 mental model

The finished project should remain simple enough to explain as:

```text
Pi already knows how to speak OpenRouter and owns the model catalog.

pi-openrouter-proxy changes where Pi sends those requests and makes Pi
authenticate to the private proxy using a generic Bearer proxy token.

Hono authenticates that proxy token, discards the client Authorization value,
injects the real OpenRouter API key from a Worker secret, fixes the destination
to OpenRouter, and forwards the HTTP request/response streams unchanged.

The normal setup path must not require OpenRouter's browser PKCE login. If the
current Pi release requires a credential before its OpenRouter models become
visible, the proxy token may be entered through `/login openrouter` -> `Use an
API key` as a compatibility mechanism. The actual OpenRouter key still remains
server-side.

Cloudflare Workers provides HTTPS, deployment, the custom hostname, and secret
storage.
```

If the implementation becomes significantly harder to explain than this, the orchestrator should check for unnecessary abstraction or scope creep.
