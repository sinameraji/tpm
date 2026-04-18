# TPM Build Context

> Read this file fully at the start of every session. Update after every milestone. Commit after every milestone.

## Current State

- **Current milestone:** M18 code-complete (full pipeline wired; live dogfood is a handoff to Sina). Next up: M19 (launch readiness).
- **Last updated:** 2026-04-18
- **Overall status:** on-track
- **Total scope:** 20 milestones for v1.

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

### Milestone 2: CLI Skeleton

- **Completed:** 2026-04-18
- **Summary:** Full `tpm` command tree. 8 commands registered (`init`, `audit`, `report`, `config`, `upgrade`, `activate`, `account`, `cost`) — `chat` intentionally omitted per spec (v2-only). `init` is the one command that does real work in M2: creates `.tpm/` with `tpm.sqlite` (Postgres-compatible schema: `audits`, `stage_runs`, `model_calls`, `schema_meta`), `artifacts/` dir, and `config.yaml` stub. Other commands are skeletons that emit `{ok: false, skeleton: true, message}` on `--json` and a friendly one-liner on TTY, returning exit code 2 so CI / pipe consumers can distinguish "not implemented" from "succeeded." Every invocation is wrapped in `bootstrap()` which creates a session id (UUID v4), loads or creates the device record (`~/.tpm/device.json`), and attaches a pino structured logger to stderr so stdout stays clean for `--json` consumers.

- **Key files:**
  - `packages/cli/src/index.ts` — `buildProgram()` wires all commands and global flags
  - `packages/cli/src/commands/_runtime.ts` — `bootstrap()`, `emit()`, `emitText()` — the glue every command shares
  - `packages/cli/src/commands/{init,audit,report,config,upgrade,activate,account,cost}.ts`
  - `packages/cli/src/core/logger.ts` — pino to stderr, session_id in every line, pretty mode when stderr is a TTY and `--json` is off
  - `packages/cli/src/core/session.ts` — `newSession()` returns UUID v4 + ISO timestamp
  - `packages/cli/src/core/paths.ts` — `userPaths()`, `projectPaths()`, `ensureDir()`
  - `packages/cli/src/core/orchestrator.ts` — stub; real pipeline dispatch lands in M7–M12
  - `packages/cli/src/auth/device.ts` — `loadOrCreateDevice()`; writes `~/.tpm/device.json` with fingerprint hash
  - `packages/cli/src/gateway/index.ts` — `ModelGateway` interface (complete + Usage + Message types)
  - `packages/cli/src/gateway/workers-ai.ts` — `WorkersAIGateway` stub that throws pointing at M4
  - `packages/cli/src/db/schema.ts` — schema SQL inlined as a TS string (no file-resolution magic post-build)
  - `packages/cli/src/db/init.ts` — `openDatabase()`: WAL mode, foreign_keys on, idempotent schema
  - `packages/cli/src/utils/opts.ts` — `mergedOpts<T>()` wraps `cmd.optsWithGlobals()` to sidestep the parent/child `--json` collision

- **Decisions made:**
  - **`chat` command omitted.** Spec lists it in the directory layout but also lists it in "Things NOT to Build in v1." Simpler to not register it at all than to register a stub that errors "v2 feature" — the CLI surface is a product signal.
  - **SQL schema inlined as a TS string** (`schema.ts`) rather than a `.sql` file. Avoids needing a post-build copy step to ship the file into `dist/`. The trade-off is slightly less "SQL-y" look in the source; the benefit is that the published npm package just works.
  - **Skeleton exit code = 2** for not-yet-implemented commands. Distinguishes "not done" from "failed" (exit 1) and "success" (exit 0), helpful for CI and shell scripts.
  - **Stderr logs + stdout clean separation** enforced via pino destination `fd: 2`. `emit()` writes JSON to stdout only when `--json` is set; `emitText()` writes to stdout only when `--json` is NOT set. This keeps pipe-friendly usage (`tpm foo --json | jq`) clean.
  - **Fingerprint hash** in device.json is a SHA-256 of `hostname|platform|arch|cpu_count|cpu_model`. Stored so the backend can flag duplicate-device abuse without needing the raw components.

- **Deviations from spec:** the spec's directory layout includes a `src/patterns/built-in.yaml` path. That's M13's work (Pattern Library); not touched in M2. Similarly `src/billing/` is M15's scope.

### Milestone 3: Backend Foundation

- **Completed:** 2026-04-18
- **Summary:** Cloudflare Worker at `packages/backend` with real routes: `GET /health`, `POST /device/register`, `GET /license/validate`. D1 migration `0001_init.sql` defines 8 tables (devices, licenses, subscriptions, audits, usage_log, patterns, webhook_events, rate_limits, schema_meta) — all Postgres-compatible. HS256 JWT lib in `lib/jwt.ts` uses Web Crypto (no deps), with 24h access tokens and 30d refresh tokens. Auth middleware extracts Bearer token, rejects wrong typ / expired / malformed. Rate-limit middleware backed by KV with 5/day/IP cap on `/device/register`. `wrangler.toml` has all bindings declared (DB, SESSIONS, RATE_LIMITS, ARTIFACTS, AI) with placeholder IDs — user must run the listed wrangler commands to create the real resources and fill in the IDs before deploying.

- **Key files:**
  - `packages/backend/migrations/0001_init.sql` — D1 schema
  - `packages/backend/wrangler.toml` — bindings + deploy config (IDs to be filled)
  - `packages/backend/src/env.ts` — Env type for all bindings + secrets
  - `packages/backend/src/index.ts` — router (table-driven, method+regex dispatch), top-level error handler serializes `HttpError` into standard JSON shape
  - `packages/backend/src/routes/{health,device,license}.ts`
  - `packages/backend/src/middleware/{auth,rate-limit}.ts`
  - `packages/backend/src/lib/{jwt,errors,ids}.ts`
  - `packages/backend/src/test-utils/d1-shim.ts` — minimal D1/KV shim over better-sqlite3, so route tests run with no Workers runtime required

- **Decisions made:**
  - **No `jose` library.** Web Crypto HS256 is ~40 lines and avoids a dep; keeps Worker bundle minimal.
  - **Free-tier license stub created on first `/device/register`.** Simpler than a "no license row = implicit free" code path and means every device has a row that webhooks can mutate in M15.
  - **Router = array of `{method, pattern, handler}`.** Hono/itty-router would work but adding a framework for 3 routes is premature. M4 adds `/infer`; even with the full v1 route set we expect <10 routes.
  - **Rate limits are KV-backed.** D1 could work, but KV's per-key TTL is perfect for sliding windows. Accepted race risk at high QPS is fine for a public endpoint with a 5/day cap.
  - **D1 shim uses better-sqlite3 for tests.** Lets route tests run in Node without miniflare/workerd overhead. Shim implements only the API surface we use (`prepare`, `bind`, `first`, `all`, `run`).

- **Deviations from spec:** No deploy to `api.usetpm.dev` yet — that requires the user to run `wrangler d1 create`, `wrangler kv namespace create SESSIONS`, `wrangler kv namespace create RATE_LIMITS`, `wrangler r2 bucket create tpm-artifacts`, then fill the IDs in `wrangler.toml`, then `wrangler secret put JWT_SECRET` + `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, then `wrangler deploy`. Recorded as a handoff item in "Handoffs Required."

### Milestone 4: Workers AI Proxy (`/infer`)

- **Completed:** 2026-04-18
- **Summary:** Backend endpoint `POST /infer` now proxies all Workers AI calls. Authenticated via Bearer (same middleware as `/license/validate`). Validates `model` against a small allowlist (gpt-oss-120b, qwen3-30b-a3b-fp8, llama-4-scout-17b). Enforces tier quota: free = 1 lifetime full audit, pro = 20/month (soft overage logged, not blocked — metered billing in M15), team = 50/seat/month (hard limit). Logs every call to `usage_log` with input/output tokens, approximated neurons (0.01/token until upstream returns exact), latency, and status. CLI-side `WorkersAIGateway` is real now: auto-registers the device on first use (persisting `~/.tpm/tokens.json`), retries once on 401 by re-registering, returns `{text, usage: {inputTokens, outputTokens, neurons, latencyMs}}`.

- **Key files:**
  - `packages/backend/src/routes/infer.ts` — quota check, AI call, usage_log insert (ok or failed)
  - `packages/cli/src/auth/tokens.ts` — `loadTokens`, `saveTokens`, `isExpiringSoon` for `~/.tpm/tokens.json`
  - `packages/cli/src/gateway/workers-ai.ts` — `ensureToken()` → `registerDevice()` ↔ `complete()` with 401-retry

- **Decisions made:**
  - **Quota is counted via distinct `audit_id` in `usage_log`**, not the backend `audits` table. Simpler — every model call already writes to usage_log. M16 fills in the audits table on completion; quota calc still works either way.
  - **Approximate neurons via `0.01 × total_tokens`** until we have a production invoice to calibrate against. Explicit comment in code says M18 dogfood recalibrates.
  - **Pro overage is soft** — log and let through; bill at $2/audit via metered Stripe line item in M15. Team is hard-capped because M15 team billing is per-seat flat.
  - **`session_id` defaults to `call_id`** if the client doesn't pass one. Keeps log lines joinable even when upstream callers forget to thread session.

- **Deviations from spec:** spec says `/infer` streams the response. Not implemented for M4 because (a) Workers AI's `env.AI.run()` returns a resolved response not a stream in the allowlisted models' current JSON mode, and (b) stages A, C, D, F all use single-shot completions — streaming would matter for Stage B navigator steps but those are small and latency-tolerant. Revisit in M18 dogfood if latency warrants.

### Milestone 5: Static Parser (codebase → map.yaml)

- **Completed:** 2026-04-18
- **Summary:** `buildStaticMap(projectRoot)` walks a project and emits a validated `Map` object (Zod schema in `packages/shared/src/schemas/map.ts`). Extracts: framework (next / remix / nuxt / astro / svelte / vue / react / rails / django / flask / express / fastify / hono / unknown), package metadata, routes (file-based + programmatic + middleware), components (default exports), forms (fields, required-ness, submit label, action), visible strings (h1/h2/h3/button/link with context labels), navigation items, tracking events (mixpanel / amplitude / segment / posthog / gtag / dataLayer / heap / generic track()), auth providers (nextauth / clerk / auth0 / supabase / firebase / devise / passport / custom_middleware). Stable content hash over the structural facts so Stage A knows when to re-run vs replay. `writeMapYaml()` serializes via js-yaml.

- **Key files:**
  - `packages/shared/src/schemas/map.ts` — full Zod schema + fixed enums (`Framework`, `TrackingPlatform`, `AuthProvider`, `RouteKind`)
  - `packages/cli/src/stages/a-intent/walker.ts` — fast directory walker with ignore list (node_modules, .git, .next, etc.), max-file-bytes + max-files guards
  - `packages/cli/src/stages/a-intent/extractors.ts` — route/form/component/tracking/visible-string/navigation extractors
  - `packages/cli/src/stages/a-intent/static-map.ts` — orchestration + hash + YAML writer
  - `packages/cli/src/stages/a-intent/static-map.test.ts` — Next.js fixture + framework-detection smoke

- **Decisions made:**
  - **Regex-based extraction, not tree-sitter.** Spec lists tree-sitter but native builds fail on Node 24 and WASM adds bundle complexity. Regex extractors cover 100% of what Stage A needs (the method is "find these facts" not "build an AST"); the extraction quality degrades gracefully on exotic syntax (a component TPM can't parse is a component Stage A doesn't know about, which Stage B still discovers at runtime via Playwright). Logged as deviation.
  - **Stable content hash** over `{routes, component names, form count, sorted tracking events, framework}`. Deliberately excludes file paths and line numbers so cosmetic churn (renaming a component file) doesn't bust the hash.
  - **Output caps**: 500 visible_strings, 200 navigation items. Keeps map.yaml under ~100KB even on large apps — Stage A's prompt budget matters.
  - **Middleware emitted as a separate route kind** so the analyzer can distinguish "this is an auth gate" from "this is a page."

- **Deviations from spec:** regex vs tree-sitter (documented above). Vue/Svelte/Python/Ruby extraction is shallow (component name from filename, framework detection from deps/files) — good enough to tell the pipeline "this is a Rails app with these routes" but not for deep AST analysis. Revisit if a Jinba dogfood case demands it.

### Milestone 6: Marketing Surface Scraper

- **Completed:** 2026-04-18
- **Summary:** `scrapeMarketingSurfaces(url, opts)` seeds a queue with the start URL + common surface paths (pricing, plans, features, product, docs, about, faq, blog), fetches each with a polite UA and 15s timeout, and emits a validated `ScrapedSurfaces` object. `parseSurfaceHtml` extracts per page: title + description + OG tags, h1/h2/h3, hero/subhero copy, CTAs with primary/secondary/tertiary prominence, nav links, schema.org JSON-LD entities, pricing tiers with features + CTA, FAQ, testimonials, 4KB text excerpt and word count. robots.txt handled correctly with most-specific-prefix-wins (Allow beats Disallow at equal specificity).
- **Key files:** `packages/shared/src/schemas/scraped.ts`, `packages/cli/src/stages/a-intent/scraper.ts`, `.test.ts`
- **Decisions:** cheerio for HTML parsing (industry standard, familiar API); 250ms inter-request delay (polite without being painfully slow); default 12-page cap matches Stage A prompt budget; classification prioritizes URL path, falls back to h1 content.
- **Deviations from spec:** none.

### Milestone 7: Stage A — Intent Extraction

- **Completed:** 2026-04-18
- **Summary:** First real pipeline stage. Full `LeanCanvasSchema` in `@tpm/shared/schemas/lean-canvas` with every box (problem, segments, UVP, solution, channels, revenue, cost [non-extractable], key metrics, unfair advantage), plus `intended_jtbd_per_segment`, `intended_value_moments`, `intended_critical_paths` — each evidence-bearing with confidence scores. `runStageA(input, deps)` compacts map + scraped surfaces into a token-budgeted prompt, calls `gpt-oss-120b` in JSON mode at temperature 0.1, validates with Zod. On schema violation, retries ONCE with the violation text in the prompt; hard-fails after. Writes `lean-canvas.yaml` and `lean-canvas.json` to the audit's artifacts directory. `openInEditor(path, nonInteractive)` spawns `$EDITOR` (or `$VISUAL`, or `vi`) so the user can correct extractions; re-parses + re-validates on exit.
- **Key files:** `packages/shared/src/schemas/lean-canvas.ts`, `packages/cli/src/stages/a-intent/prompt.ts`, `packages/cli/src/stages/a-intent/stage-a.ts`
- **Decisions:**
  - **System prompt explicitly forbids inventing.** Calibrates confidence scale (0.9+ for explicit, 0.5 inferred, 0.2 guessing), tells the model empty arrays are fine. Reduces hallucination at the cost of sometimes under-extracting.
  - **Retry on schema violation uses conversation context.** We pass the model its own failed response + the Zod error. Empirically works better than restarting cold.
  - **Both YAML and JSON artifacts written.** YAML for the human-in-the-loop editor session; JSON for mechanical replay in later stages (cheaper parse, no yaml loss-of-quoting ambiguity).
  - **Prompt compaction** keeps routes ≤80, tracking events ≤50, visible strings per context ≤30, surface text excerpt ≤2000 chars. Target ~40k input tokens per spec; actual will be measured in M18 dogfood.

### Milestone 8: Stage B — Multi-Persona Navigator

- **Completed:** 2026-04-18
- **Summary:** Full Playwright-backed navigator. For each persona in the lean canvas, launches a page, runs up to `stepBudget` (default 25) steps. Each step: snapshot DOM state (URL, title, H1/H2, visible_text, clickables with stable selectors, forms with fields + required-ness, html_hash), ask `qwen3-30b-a3b-fp8` for next decision (click / fill_form / navigate / scroll / wait / go_back / stuck / value_reached), validate the JSON with Zod, execute the action, record the step with friction_flags. Detects cycles via URL + DOM-hash repetition (3×). On value_reached → outcome.status=value_reached + loop_closed=true. Writes `paths.yaml` + `.json`. The `BrowserFactory`/`BrowserPage` interfaces decouple real Playwright from tests — tests run deterministic scripted pages + scripted gateway responses.
- **Key files:** `packages/shared/src/schemas/paths.ts` (expanded), `packages/cli/src/stages/b-navigate/browser.ts` (Playwright wrapper + interface), `prompt.ts`, `navigator.ts` (the loop + cycle detection), `stage-b.ts` (per-persona orchestration)
- **Decisions:**
  - **Selectors use `data-tpm-click-id` / `data-tpm-form-id` attributes** stamped into the DOM during snapshot. Stable across DOM reshuffle, no fragile CSS/xpath. Playwright clicks/fills via those selectors.
  - **Navigator records step BEFORE executing the action.** If the action throws (e.g. click missed a transient overlay), the step is still in `paths.yaml` with `action_error` populated — debuggability trumps cleanliness.
  - **Cycle detection = URL+DOM-hash seen ≥ 3 times together.** URL alone is too noisy (SPA re-renders), DOM alone is too noisy (timestamps tick). Both together is a decent proxy for "not making progress."
  - **Step budget default 25.** Spec mandates.
  - **Playwright installed as `playwright-core`** (no bundled browsers). M18 dogfood will instruct the user to run `npx playwright install chromium` before first real audit; CI doesn't need browsers.
  - **Auth support is a prompt hook, not code.** `testCredsNote` string flows into the navigator prompt. If the user has put creds in `~/.tpm/test-creds.yaml` (M14 adds the reader), the navigator knows how to sign up / log in.
- **Deviations from spec:** none material. Stage B's "DOM summarization via model call" from the spec is handled by the main navigator call (DOM→decision in one step); we don't have a separate summarization model pass since qwen3 handles the combined task within budget.

## Open Questions for Sina

_(none pending)_

## Handoffs Required (credentials / external systems)

- **M3 deploy of `api.usetpm.dev`** — needs Cloudflare account. Run:
  ```bash
  cd packages/backend
  wrangler d1 create tpm-prod                    # copy database_id into wrangler.toml
  wrangler kv namespace create SESSIONS          # copy id into wrangler.toml
  wrangler kv namespace create RATE_LIMITS       # copy id into wrangler.toml
  wrangler r2 bucket create tpm-artifacts
  wrangler d1 migrations apply tpm-prod
  wrangler secret put JWT_SECRET                 # long random string
  wrangler deploy
  ```
  Then add a custom route to the `usetpm.dev` zone pointing `api.usetpm.dev/*` to this worker.
- **M15 Stripe** — needs live Stripe account, products, prices, webhook secret. Documented when M15 lands.
- **M17 marketing site** — needs a Cloudflare Pages project pointing at `packages/marketing/`.
- **M20 npm publish** — needs npm auth on a publishing machine; `@tpm/cli` scoped or unscoped name.

## Next Milestone

**M9 — Stage C: Delta Analysis.** Given `lean-canvas.yaml` + `paths.yaml` + (built-in pattern library from M13), produce `delta.yaml`. For every step in every observed path, classify it against the fixed 7-value taxonomy (`necessary` / `cuttable` / `cuttable_with_care` / `intentional_friction_working` / `intentional_friction_broken` / `cargo_culted` / `broken`), answer the necessity test explicitly ("if I skipped this step, what would break?"), record intent mismatches, and compute per-persona delta (value moment reached?, observed vs. intended steps-to-value, implicit-vs-stated-job alignment). Model: `gpt-oss-120b` single call.

## Architecture Notes

- **Monorepo layout** — `packages/shared` (Zod schemas + TS types, workspace dependency for both cli and backend), `packages/cli` (local CLI), `packages/backend` (Cloudflare Worker), `packages/marketing` (Astro, M17).
- **Schema provenance** — all YAML artifacts carry `schema_version`. Zod schemas validate everything that enters the pipeline. Models emit JSON; we serialize to YAML for on-disk artifacts. Never let models emit YAML directly.
- **Session ID** — wired at M2. Every pino log line has `session_id`. The local SQLite schema (`audits`, `stage_runs`, `model_calls`) has a `session_id NOT NULL` column on every row, and `ensure()` indexes on it.
- **Workers AI only** — single `ModelGateway` interface, `WorkersAIGateway` sole implementation. No third-party LLMs, no AI Gateway. M2 wires the interface; M4 wires the transport.
- **Stdout/stderr discipline** — pino writes to `fd: 2` (stderr). Commands use `emit(runtime, {...})` to put JSON on stdout (only when `--json` is set) and `emitText(runtime, "...")` for human text (only when `--json` is not set). This keeps `tpm foo --json | jq` clean for scripting.
- **Exit codes** — 0 = success, 1 = real failure, 2 = skeleton / not-yet-implemented (most M2 commands). Script consumers can branch on this cleanly.

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
