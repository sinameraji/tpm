# TPM — Technical Product Manager

Terminal-based AI auditor for software products. Reconstructs what the builders intended, walks the product as real users, computes the delta between intent and reality, ranks problems by leverage, and specifies solutions with low-fi prototypes.

**Status:** v1 in active build. Not yet shipped. See [`CONTEXT.md`](./CONTEXT.md) for build state.

## Monorepo layout

```
packages/
  shared/     # Zod schemas and TS types — single source of truth
  cli/        # `tpm` command-line tool (Node 20+, local)
  backend/    # Cloudflare Worker — auth, quota, Stripe, Workers AI proxy
  marketing/  # usetpm.dev (Astro on Cloudflare Pages) — filled in M17
```

## Dev setup

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Requires Node 20+ and pnpm 9+.

## The method

Six-stage deterministic pipeline, each stage a validated YAML artifact:

```
A: Intent Extraction        → lean-canvas.yaml
B: Observed Critical Path   → paths.yaml (one per persona)
C: Delta Analysis           → delta.yaml
D: Leverage Prioritization  → problems.yaml
E: Solution Specification   → solutions.yaml + prototypes/*.html
F: Artifact Assembly        → spec.md + spec.pdf
```

Each stage is independently replayable against the previous stage's artifact.
