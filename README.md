# TPM — Technical Product Manager

**Open source (MIT).** A senior PM in your terminal. TPM audits software products by reading the **codebase** (primary source of truth) and, optionally, your public **marketing site** (auxiliary context). It never runs your product — no browser automation, no fake signups, no logins to your live app.

```bash
npm install -g @sinameraji/tpm

tpm init       # paste your Anthropic API key
cd your-product-repo
tpm audit
```

TPM uses **Claude (Sonnet 4.6 by default, Opus 4.7 on the deep tier)** for inference. You bring your own Anthropic API key — your key, your rate limits, your bill. Nothing is transmitted anywhere except `api.anthropic.com`.

A typical audit takes about **8–12 minutes** and costs roughly **$1–3 in Anthropic API credits** at your account's rates. Deep-tier audits cost 3–5× more. Latest published rates: [anthropic.com/pricing](https://www.anthropic.com/pricing).

**Prefer not to install globally?** `npx @sinameraji/tpm@latest audit` works without any global install.

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

## Why BYO

**Your key, your control.** No hosted proxy. No shared quota. No markup on inference. Your key is stored locally (`~/.tpm/config.yaml`, chmod 600) and only ever sent to `api.anthropic.com`. Delete it any time with `tpm config unset anthropic-key`.

**Rate limits are yours.** Deep-tier parallel stages will use up to 4 concurrent Anthropic requests. Pro accounts handle this comfortably; if you hit 429s, drop to `fast` tier or raise your limit with Anthropic.

## Model tiers

Pick on `tpm init`:

| Stage                 | fast (default)    | deep              |
| --------------------- | ----------------- | ----------------- |
| A — intent            | claude-sonnet-4-6 | claude-sonnet-4-6 |
| B — classify + walk   | claude-sonnet-4-6 | claude-sonnet-4-6 |
| B — model (structure) | claude-sonnet-4-6 | claude-opus-4-7   |
| C — delta             | claude-sonnet-4-6 | claude-opus-4-7   |
| D — leverage          | claude-sonnet-4-6 | claude-sonnet-4-6 |
| E — spec              | claude-sonnet-4-6 | claude-opus-4-7   |
| E — prototype HTML    | claude-sonnet-4-6 | claude-sonnet-4-6 |
| F — assembly          | claude-sonnet-4-6 | claude-opus-4-7   |

Switch after `init`:

```bash
tpm config set model-tier deep            # all deep stages upgrade to Opus
tpm config set stage_models.c claude-opus-4-7   # or override one stage
```

Prompt caching is on for every long, audit-agnostic system prompt (Stages A, C, D, F, plus B-classify/B-model/B-walk on the same system prefix across retries). Back-to-back audits on the same repo typically show `cache_read_input_tokens > 0` on the second run — knock a chunk off the input cost. See `tpm audit --verbose` to inspect.

## The method

Six-stage deterministic pipeline, fully specified by schema. See [`docs/the-method.md`](./docs/the-method.md).

## Architecture

CLI on your machine (Node 20+). No backend. No Playwright. No live-product automation. See [`docs/architecture.md`](./docs/architecture.md).

## Repo layout

```
packages/
  shared/     Zod schemas + TS types — single source of truth
  cli/        the `tpm` command-line tool
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

## Upgrading from 1.1.x

1.1.x ran on Cloudflare Workers AI with a hosted proxy and a device-flow JWT. 1.2.0 is BYO Anthropic, no backend. First `tpm audit` after upgrading prompts you to run `tpm init` for the key — details in [`docs/migration-from-1.1.md`](./docs/migration-from-1.1.md).

## Docs

- [The method](./docs/the-method.md)
- [Architecture](./docs/architecture.md)
- [BYO Anthropic — what gets sent, what's stored](./docs/byo.md)
- [Migration from 1.1.x](./docs/migration-from-1.1.md)
- [Models and tiers](./docs/models.md)
- [Cost + time — what to expect](./docs/cost-and-time.md)
- [Authoring patterns](./docs/patterns-authoring.md)

## Author

Built by [Sina Meraji](https://github.com/sinameraji).

- X: [@sinasanm](https://x.com/sinasanm)
- GitHub: [@sinameraji](https://github.com/sinameraji)
- LinkedIn: [sinameraji](https://linkedin.com/in/sinameraji)

PRs welcome — new extractors, new patterns, better prompts. See [`docs/patterns-authoring.md`](./docs/patterns-authoring.md).

## License

[MIT](./LICENSE).
