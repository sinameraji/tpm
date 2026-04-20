# TPM Architecture

## Components

```
┌──────────────────────────────┐
│  User's terminal             │
│  ┌────────────────────────┐  │
│  │ tpm CLI (Node 20+)     │  │
│  │  - commander commands  │  │
│  │  - session + logger    │  │
│  │  - stages A–F          │  │
│  │  - better-sqlite3      │  │
│  └─────────┬──────────────┘  │
└────────────┼─────────────────┘
             │ HTTPS (Anthropic API only)
             ▼
┌──────────────────────────────┐
│ api.anthropic.com            │
│   claude-sonnet-4-6          │
│   claude-opus-4-7            │
└──────────────────────────────┘
```

TPM is a **static analysis tool**. The primary source of truth is the codebase; TPM never runs the user's product, never signs in, never automates a browser against it. Optionally — and only if the user provides a URL — TPM fetches the product's public marketing surfaces (landing / pricing / features / docs) as auxiliary positioning context. Everything else stays offline.

There is no TPM-operated backend. v1.1.x had a Cloudflare Worker for hosted-trial device auth + Workers AI proxy; v1.2.0 removed it entirely. Your Anthropic key is stored in `~/.tpm/config.yaml` (chmod 600) and only ever travels to `api.anthropic.com`.

## Key interfaces

- `ModelGateway.complete(model, messages, opts)` — every model call goes through one interface. The only implementation in 1.2.0 is `AnthropicGateway`, which streams via the Anthropic SDK, fires an `onToken(cumulativeOut)` callback for the progress UI, and reports usage in the four Anthropic kinds (input, output, cache-read, cache-creation).
- Zod schemas in `@tpm/shared/schemas/*` are the single source of truth for every YAML artifact. `schema_version: 1` on every artifact.

## Pipeline (per audit)

1. **Static map**: tree-walk the repo + regex extractors → `map.yaml` with routes, components, forms, nav, auth providers, tracking events.
2. **Optional marketing scrape**: if the user supplied a marketing URL, fetch landing + pricing + features + docs + about + blog + faq with cheerio + `robots.txt` compliance → `scraped-surfaces.yaml`. Skipped silently if no URL.
3. **Stage A (Intent)**: single `gpt-oss-120b` call on (static map + optional scraped) → `lean-canvas.yaml`. Code-sourced evidence is primary; marketing-sourced evidence is auxiliary and cited explicitly.
4. **Stage B (Imagined Path)**: per-persona `qwen3-30b-a3b-fp8` call with the Lean Canvas + static map → `paths.yaml`. Model "reads the code as a PM" and imagines the user's journey: 8–20 steps with observations, decisions, reasoning, and friction_flags drawn from a fixed 12-value enum. No browser, no Playwright, no network to the live product.
5. **Stage C (Delta)**: Claude → `delta.yaml`. 7-class step classification, necessity tests, intent mismatches, implicit-vs-stated job alignment. Pattern library lives in the (cached) system prompt so repeat audits don't re-pay for its tokens.
6. **Stage D (Leverage)**: Claude → `problems.yaml` with structured leverage arguments, contiguous 1..N ranking.
7. **Stage E (Solutions)**: top-5 problems run concurrently (concurrency 4), each gets a spec call + a prototype HTML call.
8. **Stage F (Assembly)**: Claude → `spec.md` + `spec.html`.

Per-stage model IDs depend on the configured tier — see [`models.md`](./models.md).

## Storage

- `~/.tpm/config.yaml` — user-level config (anthropic_api_key masked, model_tier, stage_models overrides). chmod 600.
- `.tpm/` per project:
  - `tpm.sqlite` — Postgres-compatible schema. `audits`, `stage_runs`, `model_calls`. Cost columns hold integer micro-USD (`COST_COLUMN_SEMANTIC`).
  - `artifacts/{audit_id}/` — per-audit YAMLs + `prototypes/*.html` + `spec.md` / `spec.html`.

No data is sent anywhere except `api.anthropic.com`.

## Invariants

- Every log line has `session_id`.
- Every SQLite row with a `session_id` column has it populated.
- Every YAML artifact carries `schema_version`.
- No source code ever leaves the user's machine; only inference prompts go over the network.
- The only outbound traffic from `tpm audit` goes to `api.anthropic.com` (Anthropic SDK) and to the marketing URL if one was given.
