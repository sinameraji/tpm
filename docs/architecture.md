# TPM Architecture

## Components

```
┌──────────────────────────────┐
│  User's terminal             │
│  ┌────────────────────────┐  │
│  │ tpm CLI (Node 20+)     │  │
│  │  - commander commands  │  │
│  │  - session + logger    │  │
│  │  - device + tokens     │  │
│  │  - stages A–F          │  │
│  │  - better-sqlite3      │  │
│  │  - Playwright          │  │
│  └─────────┬──────────────┘  │
└────────────┼─────────────────┘
             │ HTTPS
             ▼
┌──────────────────────────────┐
│ tpm-api.sina-b35.workers.dev               │
│ (Cloudflare Worker)          │
│  - router + HttpError        │
│  - HS256 JWT auth            │
│  - D1 + KV + R2              │
│  - /infer proxy → Workers AI │
│  - Stripe checkout/webhook   │
└─────────┬────────────────────┘
          │ env.AI.run()
          ▼
┌──────────────────────────────┐
│ Cloudflare Workers AI        │
│  gpt-oss-120b, qwen3-30b,    │
│  llama-4-scout               │
└──────────────────────────────┘
```

## Key interfaces

- `ModelGateway.complete(model, messages, opts)` — every model call goes through one interface. The only implementation is `WorkersAIGateway`. Transport decoupled from stage logic so swapping the proxy is painless.
- `BrowserPage` / `BrowserFactory` — Stage B uses these to interact with the browser. The real impl wraps playwright-core; tests use scripted fakes.
- `Zod schemas` (`@tpm/shared/schemas/*`) — single source of truth for every YAML artifact. `schema_version: 1` on every artifact.

## Pipeline (per audit)

1. **Pre-flight**: register audit row locally + remotely (Pro/Team); quota check.
2. **Stage A prep**: static map (tree-walk + regex extractors) + marketing scrape (cheerio + robots.txt).
3. **Stage A**: single `gpt-oss-120b` call → `lean-canvas.yaml`. Optional `$EDITOR` review.
4. **Stage B**: Playwright navigator per persona with `qwen3-30b-a3b-fp8` deciding each step. 25-step budget, cycle detection.
5. **Stage C**: `gpt-oss-120b` single call → `delta.yaml` with 7-class step classification, necessity-test answers, intent mismatches.
6. **Stage D**: `gpt-oss-120b` single call → `problems.yaml` with structured leverage arguments, contiguous 1..N ranking.
7. **Stage E**: Top-5 problems in parallel. Each gets a `gpt-oss-120b` spec call + a `qwen3-30b-a3b-fp8` prototype HTML call.
8. **Stage F**: `gpt-oss-120b` single call writes `spec.md`. Optional `puppeteer`/playwright PDF render.
9. **Post**: artifact upload to R2 (Pro/Team); audit row finished.

## Storage

- **Local**: `~/.tpm/` user dir (device.json, tokens.json, license.json, config.yaml). `.tpm/` per project (tpm.sqlite with Postgres-compatible schema; `artifacts/{audit_id}/` holds per-audit YAMLs + prototypes + spec.md/pdf).
- **Cloud**: D1 for metadata; R2 for artifacts (keyed by `audits/{device_id}/{audit_id}/`); KV for rate limits.

## Error model

Every backend error is an `HttpError(status, code, message, details)`. The worker's top-level catch serializes to `{error: {code, message, ...}}`. CLI mirrors with exit code 2 for "not done," exit 1 for failures.

## Invariants

- Every log line has `session_id`.
- Every D1/SQLite row with a `session_id` column has it populated.
- Every YAML artifact carries `schema_version`.
- Stages A–F are independently replayable against upstream artifacts.
- No source code ever leaves the user's machine.
