# Changelog

## v1.0.0 — 2026-04-18 (unreleased)

First public release. The six-stage deterministic product-audit pipeline, shipped commercial.

### Ships

- **The method** — six-stage pipeline with fixed schemas and classification taxonomies (see `docs/the-method.md`)
- **CLI** (`@tpm/cli`) — `tpm init`, `tpm audit`, `tpm report`, `tpm config`, `tpm upgrade`, `tpm activate`, `tpm account`, `tpm cost`
- **Backend** (`api.usetpm.dev`) — auth, quota, Stripe, licensing, Workers AI proxy
- **Marketing** (`usetpm.dev`) — landing, pricing, docs, upgrade, privacy, terms
- **Pricing** — Free (1 lifetime audit), Pro ($20/mo, 20 audits), Team ($49/seat/mo, 50 audits/seat)
- **Pattern library** — 52 curated product-friction patterns with works_when/fails_when/exemplars/detection_signals
- **Models** — `@cf/openai/gpt-oss-120b` for reasoning stages, `@cf/qwen/qwen3-30b-a3b-fp8` for navigator + prototype HTML
