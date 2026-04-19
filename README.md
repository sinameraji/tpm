# TPM — Technical Product Manager

**Open source (MIT).** A senior PM in your terminal. TPM audits software products by reading the **codebase** (primary source of truth) and, optionally, your public **marketing site** (auxiliary context). It never runs your product — no browser automation, no fake signups, no logins to your live app.

```bash
npm install -g tpm

cd your-product-repo
tpm init
tpm audit
```

First run prompts you for an optional marketing URL. Skip with Enter, or pre-set with `--marketing-url https://yourproduct.com`. The URL is remembered for subsequent runs.

## The mental model

A skilled PM reading your codebase can narrate the user's first run from memory. TPM does the same thing, algorithmically. It extracts your routes, forms, components, copy, auth gates and tracking events — then reconstructs the intended product from the code, and a plausible user journey from the same code.

- **Codebase = source of truth.** What the code says the product does IS what the product does. It's unrealistic to run production apps locally (multiple server/infra/frontend folders, env vars, seed data, auth flows). TPM skips that entirely.
- **Marketing URL = auxiliary.** Optional. Helps TPM understand the positioning promise (hero copy, pricing, features). When marketing and code disagree, the code wins — and TPM reports the divergence.

This means TPM works on anything you have source access to — enterprise SaaS, authenticated-only dashboards, anything behind a paywall — because it never needs to run or sign into your live product.

## What you get

Artifacts land in `.tpm/artifacts/{audit_id}/`:

- `map.yaml` — static code map (routes, components, forms, nav, auth providers)
- `scraped-surfaces.yaml` — marketing pages (only if a URL was provided)
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

CLI on your machine (Node 20+), optional thin Cloudflare Worker backend for the hosted trial, Workers AI for inference. No Playwright, no live-product automation. See [`docs/architecture.md`](./docs/architecture.md).

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
