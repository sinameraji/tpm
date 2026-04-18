# TPM Build Context

> Read this file fully at the start of every session. Update after every milestone. Commit after every milestone.

## Current State

- **Current milestone:** M1 complete. Next up: M2 (CLI Skeleton).
- **Last updated:** 2026-04-18
- **Overall status:** on-track

## Completed Milestones

### Milestone 1: Monorepo Foundation

- **Completed:** 2026-04-18
- **Summary:** pnpm monorepo scaffold with `packages/{shared,cli,backend,marketing}`. Root-level ESLint 9 flat config, Prettier 3, husky pre-commit + lint-staged, GitHub Actions CI (format/lint/typecheck/test). Strict TypeScript (exactOptionalPropertyTypes, noUnusedLocals, composite project refs). `@tpm/shared` exposes placeholder Zod schemas for every stage output (lean-canvas, paths, delta, problems, solutions, patterns, config, license) — each with `SCHEMA_VERSION = 1` and a minimal stub. The two fixed classification enums from the spec (`FrictionFlagType`, `StepClassification`) are fully populated now because they're stable IP. Smoke tests verify the schemas parse and the CLI/backend entry points resolve.

- **Key files:**
  - `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json` — workspace root
  - `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore` — lint/format
  - `.husky/pre-commit` — git hook running lint-staged
  - `.github/workflows/ci.yml` — format-check, lint, typecheck, test on PR/main
  - `packages/shared/src/schemas/*.ts` — placeholder Zod schemas
  - `packages/shared/src/schemas/paths.ts` — `FrictionFlagType` 12-value enum (spec-fixed)
  - `packages/shared/src/schemas/delta.ts` — `StepClassification` 7-value enum (spec-fixed)
  - `packages/cli/{bin/tpm.ts,src/index.ts}` — entry scaffold, prints version
  - `packages/backend/{src/index.ts,wrangler.toml}` — Worker scaffold with `/health`
  - `packages/marketing/package.json` — deferred to M17 (no-op scripts)

- **Decisions made:**
  - **Previous M1 (commit a9902d2) abandoned and git history wiped** per Sina's instruction. The old approach used CF AI Gateway with unified_billing/byok auth-mode toggle in a single-package `src/` layout. New spec is Workers AI direct via proxy Worker + monorepo, so a fresh root commit is cleaner than layering a rewrite.
  - ESLint 9 flat config (not legacy `.eslintrc.*`).
  - pnpm 9.12.3 pinned via `packageManager`.
  - TypeScript 5.6 composite project references — enables per-package incremental builds.
  - Zod 3.23.8 as schema source of truth (`packages/shared`).
  - `vitest` 2.1 chosen as test runner (not specified in spec; standard for TS monorepos; pure ESM, fast, native TS).
  - Marketing package scaffolded but Astro install deferred to M17 to keep M1 install footprint small.
  - Fixed classification enums (friction flags, step classifications) populated now rather than stubbed — they are the spec's defensible IP and are stable; filling the surrounding object schemas is still deferred to their respective stage milestones.

- **Deviations from spec:** none material. Spec says "shared Zod schemas in packages/shared" — interpreted as establishing the package and conventions (file-per-stage, `SCHEMA_VERSION`, fixed enums), with per-stage object fields filled in during their stage milestones (M7–M13).

## Open Questions for Sina

- **Test runner choice** — vitest added for M1. OK, or prefer node:test / jest?
- **GitHub repo + CI:** CI workflow exists but this repo isn't pushed to GitHub yet. Should I set up `usetpm/tpm` on GitHub now or defer to a later milestone?
- **Node version in `engines`:** set to `>=20`; should we pin to `20.x` specifically for reproducibility?
- **License:** root `package.json` has `"license": "UNLICENSED"`. Confirm — or should it be proprietary/commercial string?

## Next Milestone

**M2 — CLI Skeleton.** All `tpm` commands stubbed (`init`, `audit`, `report`, `chat`, `config`, `upgrade`, `activate`, `account`, `cost`), device ID generation writing to `~/.tpm/device.json`, SQLite init via better-sqlite3, pino structured logger to stderr (stdout stays clean for `--json` piping), `ModelGateway` interface + `WorkersAIGateway` stub implementation. No real model calls yet — M4 wires those in once the proxy Worker exists.

## Architecture Notes

- **Monorepo layout** — `packages/shared` (Zod schemas + TS types, workspace dependency for both cli and backend), `packages/cli` (local CLI), `packages/backend` (Cloudflare Worker), `packages/marketing` (Astro, M17).
- **Schema provenance** — all YAML artifacts carry `schema_version`. Zod schemas validate everything that enters the pipeline. Models emit JSON; we serialize to YAML for on-disk artifacts. Never let models emit YAML directly.
- **Session ID** — every log line, every D1 row, every artifact will carry a session_id (not yet wired; M2 adds it via pino child logger).
- **Workers AI only** — single `ModelGateway` interface, `WorkersAIGateway` sole implementation. No third-party LLMs, no AI Gateway.

## Method Notes

- **Fixed enums live in `packages/shared/src/schemas/`.** Adding or changing a value is a schema-version bump and a deliberate decision.
  - `FrictionFlagType` (paths.ts): 12 values — stable per spec.
  - `StepClassification` (delta.ts): 7 values — stable per spec.
- **Human-in-the-loop checkpoint** (Stage A): user opens `lean-canvas.yaml` in `$EDITOR` before pipeline continues. M7 implements this.
- **Leverage ranking is NOT a formula** — Stage D produces a structured leverage argument per problem. Formulas rank-order wrongly when inputs are fuzzy. See Stage D guardrails in spec.

## Known Gotchas

- **pnpm `workspace:*` protocol** — `@tpm/shared` is referenced as `"workspace:*"` in cli and backend. pnpm rewrites this on `pnpm pack` / `npm publish`. Leave as-is for local dev.
- **TS project references** — composite builds require `tsc -b` (not plain `tsc`). Root `tsconfig.json` just lists references. Each package builds its own `dist/`.
- **Husky v9** — no more `husky install`; the `prepare` script just runs `husky` (which sets `core.hooksPath` via package.json config).

## Model Performance Notes

_(empty — first stage model call lands in M4+)_

## Cost Tracking

_(empty — first audit run lands in M18 dogfood)_

Target: **$0.50/audit** in Neurons. Per-stage budget: A $0.10, B $0.15, C $0.10, D $0.05, E $0.08, F $0.02.
