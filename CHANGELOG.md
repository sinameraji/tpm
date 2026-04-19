# Changelog

## v1.0.0 — 2026-04-19 (unreleased)

First public release. Open source under MIT.

### Usage

```bash
cd your-product-repo
tpm init
tpm audit
```

No URL. No browser. No network traffic to your live product. TPM reads your source code and reconstructs intent + imagined user journey from the code alone. Works on any codebase you have source access to, including enterprise/auth-gated products.

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

- **Playwright / browser automation.** TPM is a static analysis tool; it never runs your product. This means it works on enterprise SaaS, authenticated-only dashboards, and anything behind a paywall.
- **Marketing site scraping.** Same reason — all evidence comes from source code.
- **PDF rendering.** `spec.md` and `spec.html` are produced; users who want PDF can pipe through any markdown-to-PDF tool.
