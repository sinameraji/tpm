# TPM — Technical Product Manager

**Open source (MIT).** A senior PM in your terminal. TPM audits software products via a deterministic six-stage pipeline — reconstructs what you intended, walks the product as real users, computes the delta between intent and reality, ranks problems by leverage, and specifies fixes with low-fi prototypes.

```bash
npm install -g tpm
cd your-project
tpm init
tpm audit https://your-product.com
```

Artifacts land in `.tpm/artifacts/{audit_id}/`:

- `lean-canvas.yaml` — what the builder intended
- `paths.yaml` — what actually happens per persona
- `delta.yaml` — structured delta, step-by-step classification
- `problems.yaml` — ranked with explicit leverage argument
- `solutions.yaml` + `prototypes/*.html` — top-5 fixes with working HTML mockups
- `spec.md` + `spec.pdf` — the PM deliverable

## Hosted trial vs self-host

- **Hosted trial** (default). Every device gets **one free audit** on the maintainer's Cloudflare Workers AI credits. Zero setup — just `tpm audit <url>`.
- **Self-host** for unlimited audits. Point TPM at your own Cloudflare account (~5 min setup). You pay Cloudflare directly — cheap, typically $0.10–$0.50 per audit. See [docs/self-host](./docs/self-host.md) or run `tpm self-host`.

```bash
tpm config set gateway byo
tpm config set byo.account_id <your-account-id>
tpm config set byo.api_token <your-api-token>
```

## The method

See [docs/the-method.md](./docs/the-method.md). Six stages, fixed enums, replayable per-stage.

## Architecture

See [docs/architecture.md](./docs/architecture.md). CLI on your machine, thin Cloudflare Worker backend (optional), Workers AI exclusively.

## Repo layout

```
packages/
  shared/     Zod schemas + TS types — single source of truth
  cli/        the `tpm` command-line tool
  backend/    optional Cloudflare Worker (hosted trial at tpm-api.sina-b35.workers.dev)
  marketing/  tpm-d3h.pages.dev (Astro on Cloudflare Pages)
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Node 20+ and pnpm 9+ required.

## Docs

- [The method](./docs/the-method.md)
- [Architecture](./docs/architecture.md)
- [Self-host](./docs/self-host.md)
- [Models](./docs/models.md)
- [Authoring patterns](./docs/patterns-authoring.md)

## Author

Built by [Sina Meraji](https://github.com/sinameraji).

- X: [@sinasanm](https://x.com/sinasanm)
- GitHub: [@sinameraji](https://github.com/sinameraji)
- LinkedIn: [sinameraji](https://linkedin.com/in/sinameraji)

PRs welcome. New patterns, new extractors, new prompt improvements — all appreciated. See [docs/patterns-authoring.md](./docs/patterns-authoring.md) for how the built-in pattern library works.

## License

[MIT](./LICENSE). Do what you like, attribution appreciated.
