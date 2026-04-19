# Changelog

## v1.0.0 — 2026-04-19 (unreleased)

First public release. Open source under MIT.

### Usage

```bash
cd your-product-repo
tpm init
tpm audit
```

**Codebase is the source of truth.** TPM reads your source and reconstructs intent + an imagined user journey from it. No browser automation, no fake signups, no running your product locally (unrealistic for real apps with env vars, multi-service infra, seed data).

**Marketing URL is optional auxiliary context.** Step 2 of `tpm audit` asks for your product's public marketing URL (landing/pricing/features). Skip with Enter for a code-only audit, or pre-set with `--marketing-url https://yourproduct.com`. When marketing and code disagree, code wins — and the divergence becomes an audit finding.

Works on enterprise/auth-gated products because TPM never needs to log in or run anything.

### Model

- **Hosted trial.** Every device gets one free audit on the maintainer's Cloudflare Workers AI credits via the optional hosted backend at tpm-api.sina-b35.workers.dev. Zero setup.
- **Self-host.** `tpm config set gateway byo` points at your own Cloudflare account for unlimited audits. Cloudflare bills you directly.

### Ships

- **The method** — six-stage deterministic pipeline with fixed schemas and classification taxonomies (see `docs/the-method.md`)
- **CLI** (`tpm`) — `tpm init`, `tpm audit`, `tpm report`, `tpm config`, `tpm self-host`, `tpm cost`
- **Backend** (optional, `tpm-api.sina-b35.workers.dev`) — device auth, hosted-trial quota, Workers AI proxy, audit history + R2 artifact sync
- **Marketing** (`tpm-d3h.pages.dev`) — landing, docs, self-host, privacy, terms
- **Pattern library** — 52 curated product-friction patterns with works_when/fails_when/exemplars/detection_signals
- **Models** — `@cf/openai/gpt-oss-120b` for reasoning stages, `@cf/qwen/qwen3-30b-a3b-fp8` for imagined paths + prototype HTML

### Deliberately not included

- **Playwright / browser automation against the user's product.** TPM never runs the live product or attempts logins/signups. This means it works on enterprise SaaS, authenticated-only dashboards, and anything behind a paywall.
- **PDF rendering.** `spec.md` and `spec.html` are produced; users who want PDF can pipe through any markdown-to-PDF tool.
