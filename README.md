# TPM — Technical Product Manager

A senior PM in your terminal. TPM audits software products via a deterministic six-stage pipeline — reconstructs what you intended, walks the product as real users, computes the delta between intent and reality, ranks problems by leverage, and specifies fixes with low-fi prototypes.

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

## The method

See [docs/the-method.md](./docs/the-method.md). Six stages, fixed enums, replayable per-stage.

## Architecture

See [docs/architecture.md](./docs/architecture.md). CLI on your machine, thin Cloudflare Worker backend, Workers AI exclusively — no third-party LLMs.

## Pricing

- **Free** — 1 lifetime audit, unlimited quick audits on repos you've already audited.
- **Pro** — $20/month, 20 audits, PDF, audit history sync.
- **Team** — $49/seat/month, 50 audits/seat, shared patterns.

See [usetpm.dev/pricing](https://usetpm.dev/pricing).

## Repo layout

```
packages/
  shared/     Zod schemas + TS types — single source of truth
  cli/        the `tpm` command-line tool
  backend/    Cloudflare Worker (api.usetpm.dev)
  marketing/  usetpm.dev (Astro on Cloudflare Pages)
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
- [Models](./docs/models.md)
- [Authoring patterns](./docs/patterns-authoring.md)
- [Jinba dogfood protocol](./docs/jinba-dogfood-protocol.md)
- [Launch checklist](./docs/launch-checklist.md)

## License

Commercial — see [LICENSE](./LICENSE) (TBD before M20 publish).
