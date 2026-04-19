# Changelog

## v1.0.0 — 2026-04-19 (unreleased)

First public release. Open source under MIT.

### Usage

```bash
cd your-product-repo          # codebase = cwd
tpm init
tpm audit https://your-product.com   # URL = the deployed site to walk
```

TPM runs from inside your repo. The codebase feeds Stage A's Lean Canvas reconstruction; the URL argument is the deployed product TPM walks with Playwright for Stage B. Use `--project /path/to/repo` to override the codebase location; omit the URL for a code-only audit.

### Model

- **Hosted trial.** Every device gets one free audit on the maintainer's Cloudflare Workers AI credits via the optional hosted backend at tpm-api.sina-b35.workers.dev. Zero setup.
- **Self-host.** `tpm config set gateway byo` points at your own Cloudflare account for unlimited audits. Cloudflare bills you directly.

### Ships

- **The method** — six-stage deterministic pipeline with fixed schemas and classification taxonomies (see `docs/the-method.md`)
- **CLI** (`tpm`) — `tpm init`, `tpm audit`, `tpm report`, `tpm config`, `tpm self-host`, `tpm cost` (`upgrade` / `activate` / `account` aliased to `self-host`)
- **Backend** (optional, `tpm-api.sina-b35.workers.dev`) — device auth, hosted-trial quota, Workers AI proxy, audit history + R2 artifact sync
- **Marketing** (`tpm-d3h.pages.dev`) — landing, docs, self-host, privacy, terms
- **Pattern library** — 52 curated product-friction patterns with works_when/fails_when/exemplars/detection_signals
- **Models** — `@cf/openai/gpt-oss-120b` for reasoning stages, `@cf/qwen/qwen3-30b-a3b-fp8` for navigator + prototype HTML
