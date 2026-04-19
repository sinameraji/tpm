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
│  └─────────┬──────────────┘  │
└────────────┼─────────────────┘
             │ HTTPS (AI inference only)
             ▼
┌──────────────────────────────────┐
│ tpm-api.sina-b35.workers.dev     │
│ (Cloudflare Worker, optional)    │
│  - router + HttpError            │
│  - HS256 JWT auth                │
│  - D1 + KV + R2                  │
│  - /infer proxy → Workers AI     │
│  - hosted-trial quota (1/device) │
└─────────┬────────────────────────┘
          │ env.AI.run()
          ▼
┌──────────────────────────────┐
│ Cloudflare Workers AI        │
│  gpt-oss-120b, qwen3-30b     │
└──────────────────────────────┘
```

TPM is a **static analysis tool**. The primary source of truth is the codebase; TPM never runs the user's product, never signs in, never automates a browser against it. Optionally — and only if the user provides a URL — TPM fetches the product's public marketing surfaces (landing / pricing / features / docs) as auxiliary positioning context. Everything else stays offline.

## Key interfaces

- `ModelGateway.complete(model, messages, opts)` — every model call goes through one interface. Two implementations: `WorkersAIGateway` (hosted trial via the Cloudflare Worker proxy) and `DirectWorkersAIGateway` (BYO — talks directly to the user's Cloudflare Workers AI REST API).
- Zod schemas in `@tpm/shared/schemas/*` are the single source of truth for every YAML artifact. `schema_version: 1` on every artifact.

## Pipeline (per audit)

1. **Static map**: tree-walk the repo + regex extractors → `map.yaml` with routes, components, forms, nav, auth providers, tracking events.
2. **Optional marketing scrape**: if the user supplied a marketing URL, fetch landing + pricing + features + docs + about + blog + faq with cheerio + `robots.txt` compliance → `scraped-surfaces.yaml`. Skipped silently if no URL.
3. **Stage A (Intent)**: single `gpt-oss-120b` call on (static map + optional scraped) → `lean-canvas.yaml`. Code-sourced evidence is primary; marketing-sourced evidence is auxiliary and cited explicitly.
4. **Stage B (Imagined Path)**: per-persona `qwen3-30b-a3b-fp8` call with the Lean Canvas + static map → `paths.yaml`. Model "reads the code as a PM" and imagines the user's journey: 8–20 steps with observations, decisions, reasoning, and friction_flags drawn from a fixed 12-value enum. No browser, no Playwright, no network to the live product.
5. **Stage C (Delta)**: `gpt-oss-120b` → `delta.yaml`. 7-class step classification, necessity tests, intent mismatches, implicit-vs-stated job alignment.
6. **Stage D (Leverage)**: `gpt-oss-120b` → `problems.yaml` with structured leverage arguments, contiguous 1..N ranking.
7. **Stage E (Solutions)**: top-5 problems in parallel, each gets a `gpt-oss-120b` spec call + a `qwen3-30b` prototype HTML call.
8. **Stage F (Assembly)**: `gpt-oss-120b` → `spec.md` + `spec.html`.

## Storage

- **Local**: `~/.tpm/` user dir (device.json, tokens.json, config.yaml). `.tpm/` per project (tpm.sqlite with Postgres-compatible schema; `artifacts/{audit_id}/` holds per-audit YAMLs + prototypes + spec.md/html).
- **Cloud** (hosted trial only): D1 for metadata; R2 for artifacts (keyed by `audits/{device_id}/{audit_id}/`); KV for rate limits.

## Invariants

- Every log line has `session_id`.
- Every D1/SQLite row with a `session_id` column has it populated.
- Every YAML artifact carries `schema_version`.
- No source code ever leaves the user's machine; only inference prompts go over the network.
- In BYO mode, nothing touches TPM infrastructure — prompts go from the CLI straight to the user's Cloudflare account.
