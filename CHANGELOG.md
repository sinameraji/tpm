# Changelog

## v1.2.0 — 2026-04-20

**BREAKING.** TPM migrates from Cloudflare Workers AI (multi-family + hosted proxy + device-flow auth) to Anthropic (Sonnet 4.6 default, Opus 4.7 deep tier, BYO API key). Net effect: simpler, more reliable, better progress UX, fewer moving parts.

### Breaking changes

- **Cloudflare Workers AI support removed.** No more hosted trial, no more self-host-via-Cloudflare escape hatch. TPM now runs only against `api.anthropic.com`.
- **BYO Anthropic key required.** Existing 1.1.x configs detected on first audit; the CLI prompts to run `tpm init` (TTY) or prints the migration note and exits 0 (CI). Never auto-rewrites your config.
- **`tpm self-host` removed.** Replaced in spirit by `tpm init` which walks you through the Anthropic key + tier.
- Config keys `gateway`, `api_endpoint`, `byo.*` are ignored. Stale keys are read tolerantly so your config file doesn't crash — but they have no effect. Run `tpm init` to get onto the new shape.

### Added

- **`tpm init` wizard** — first-run flow that walks you through an Anthropic key (masked paste, Ctrl-C aborts cleanly) and tier selection (fast/deep). Runs from `tpm audit` too when no key is configured and stdin is a TTY.
- **Fast/deep model tiers.** `fast` (default) is Sonnet 4.6 throughout; `deep` uses Opus 4.7 on the heavy stages (B-model, C, E-spec, F). Switch with `tpm config set model-tier deep`. Per-stage overrides via `tpm config set stage_models.<stage> <model>`.
- **Streaming progress UI.** Every stage shows a live token counter + running cost. Retries surface visibly. Slow stages (>60s) show a one-time reassurance hint. `--no-stream` disables cursor manipulation for CI and non-TTY pipelines.
- **Real `tpm cost`.** Reads your local audit history (SQLite) and shows per-audit USD totals. `--audit <id|prefix>` and `--since <iso>` filters.
- **`tpm feedback`** — stub command that prints the issues URL with a note that nothing is sent automatically. Closes the UX loop from the audit completion block.
- **Ephemeral prompt caching.** Every audit-agnostic system prompt is marked `cache_control: ephemeral` — subsequent audits on the same machine see cached reads on the second run onward. Gateway gates content below Anthropic's ~1024-token cache minimum so you don't pay for silent no-ops.

### Changed

- **Stage B ensemble collapsed.** The old Modeler A (Qwen) + Modeler B (Llama) + Synthesizer (Llama) with a diff step is now one `claude-sonnet-4-6` call (or `claude-opus-4-7` on deep tier). Every semantic guardrail is preserved; the ensemble was a compensation for multi-family response-shape noise that doesn't exist on a single well-behaved model.
- **Stage E concurrency raised 2 → 4.** Anthropic handles parallel requests reliably; v1.1.x's 2-at-a-time ceiling was a Workers-AI rate-limit concession.
- **Temperature standardized.** 0.1 for structured-output stages, 0.3 for narrative stages (B-walk, E-proto), 0.2 for Stage F.
- **Pre-flight + completion blocks** on `tpm audit` — time/cost ranges up front (so you don't hit Ctrl+C thinking it's hung), USD totals + spec.md pointer on finish.
- **SQLite cost columns repurposed.** `model_calls.neurons`, `stage_runs.cost_neurons`, and `audits.total_neurons` now store integer micro-USD (USD × 1e6). Column names preserved so existing local SQLite files keep working — `tpm cost` and `tpm report` format as dollars. See `db/schema.ts` `COST_COLUMN_SEMANTIC` for the invariant.

### Removed

- `packages/backend/` (the entire Cloudflare Worker — D1 schema, device registration, hosted-trial quota, `/infer` proxy with `normalizeResponseText`, R2 artifact sync).
- `packages/cli/src/gateway/workers-ai.ts`, `direct-workers-ai.ts`, and the transitional `hybrid.ts` (shipped briefly during the 1.2.0 port).
- `packages/cli/src/auth/` (device-flow JWTs), `billing/quota.ts`, `sync/audits.ts`.
- `packages/cli/src/stages/b-navigate/model-app-diff.ts` (ensemble diff), Modeler A/B/Synthesizer plumbing in `model-app.ts`.
- `callWithFallback` + `CLASSIFY_FALLBACK_MODEL` from B-classify. Cross-family fallbacks from B-walk and Stage E (spec + prototype).
- `SynthesisNote` + `synthesis_notes` field on `AppModel` (grep confirmed no downstream consumer).
- `docs/model-failures.md` (Cloudflare Workers AI failure modes — no longer applicable).
- `tpm self-host` command and `docs/self-host.md`.
- `--endpoint`, `--gateway`, `--no-sync` flags from `tpm audit`.

### Cleanup

- `~/.tpm/tokens.json` (v1.1.x device-flow JWT bundle) is silently deleted on the first successful 1.2.0 audit.

### Migration

See [`docs/migration-from-1.1.md`](./docs/migration-from-1.1.md).

---

## v1.0.0 — 2026-04-19

First public release. Open source under MIT.

- Hosted trial on Cloudflare Workers AI, one free audit per device
- Self-host escape via `tpm config set gateway byo` pointed at your own Cloudflare account
- Six-stage method: intent → model → walk → delta → leverage → solutions → assembly
- Pattern library with 52 curated product-friction patterns
- Models: `@cf/openai/gpt-oss-120b` + `@cf/qwen/qwen3-30b-a3b-fp8`

All of this was superseded in 1.2.0; v1.0.x and v1.1.x are archived.
