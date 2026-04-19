# TPM — Technical Product Manager

**Open source (MIT).** A senior PM in your terminal. TPM audits software products from their source code alone — no browser, no scraping, no login to your live site. It reads your repo, reconstructs what you intended the product to be, imagines what a user experiences given the code, and specs the highest-leverage fixes.

```bash
npm install -g tpm

cd your-product-repo     # TPM runs on the codebase you're standing in
tpm init                 # creates .tpm/
tpm audit                # reads source, produces audit artifacts
```

That's it. No URL argument, no browser install, no credentials for your product. Everything derives from the code you already have.

## What you get

Artifacts land in `.tpm/artifacts/{audit_id}/`:

- `map.yaml` — static code map (routes, components, forms, nav, auth providers)
- `lean-canvas.yaml` — reconstructed intent (problem, segments, UVP, JTBD, value moments)
- `paths.yaml` — imagined user journey per persona, inferred from code
- `delta.yaml` — classified gaps between intent and the code's reality
- `problems.yaml` — ranked by explicit leverage argument
- `solutions.yaml` + `prototypes/*.html` — top-5 fixes with annotated HTML mockups
- `spec.md` + `spec.html` — the PM deliverable

## Hosted trial vs self-host

- **Hosted trial** (default). Every device gets **one free audit** on the maintainer's Cloudflare Workers AI credits. Zero setup.
- **Self-host** for unlimited audits. Point TPM at your own Cloudflare account (~5 min). See [`docs/self-host.md`](./docs/self-host.md) or run `tpm self-host`.

```bash
tpm config set gateway byo
tpm config set byo.account_id <your-account-id>
tpm config set byo.api_token <your-api-token>
```

## The method

Six-stage deterministic pipeline, fully specified by schema. See [`docs/the-method.md`](./docs/the-method.md).

## Architecture

CLI on your machine (Node 20+), optional thin Cloudflare Worker backend for the hosted trial, Workers AI for inference. No Playwright, no scraping, no external service calls to your product. See [`docs/architecture.md`](./docs/architecture.md).

## Repo layout

```
packages/
  shared/     Zod schemas + TS types — single source of truth
  cli/        the `tpm` command-line tool
  backend/    optional Cloudflare Worker (hosted trial)
  marketing/  tpm-d3h.pages.dev landing (Astro on Cloudflare Pages)
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

PRs welcome — new extractors, new patterns, better prompts. See [`docs/patterns-authoring.md`](./docs/patterns-authoring.md).

## License

[MIT](./LICENSE).
