# BYO Anthropic — what gets sent, what's stored

PM v1.2.0 is **bring-your-own-key**: inference runs against `api.anthropic.com` using your Anthropic account. There is no PM-operated backend, no hosted proxy, no per-PM-user quota. Your key, your rate limits, your bill.

## Key storage

On first `pm init` (or the first `pm audit` on a fresh machine, when stdin is a TTY), PM prompts you to paste a key. It lands in:

```
~/.pm/config.yaml    (chmod 600, owner-only read/write)
```

as `anthropic_api_key: sk-ant-...`. Nothing else reads this file.

`pm config show` masks the key (`sk-ant-…XYZ9`) so it's safe to screenshot.

You can override at runtime with the `ANTHROPIC_API_KEY` environment variable — env wins over the config file. Handy for CI jobs that want to source the key from a secrets manager without writing it to disk.

Remove any time:

```bash
pm config unset anthropic-key
rm ~/.pm/config.yaml   # if you want to wipe everything including tier + overrides
```

## What hits the wire

For every audit, PM makes several calls to:

- `https://api.anthropic.com/v1/messages` — one per stage attempt (streaming)

Each request includes:

- Your API key (Bearer auth).
- The stage system prompt + the stage user prompt. System prompts are audit-agnostic and marked `cache_control: ephemeral` so repeated audits on the same machine reuse Anthropic's server-side cache.
- Your code/content — see "What goes into the prompts" below.

Responses stream back as text deltas; PM accumulates them, parses JSON where required, and writes artifacts to `.pm/artifacts/`.

No telemetry. No analytics. No third-party calls other than Anthropic (and the optional marketing-page scraper, which hits only the URL you explicitly pass).

## What goes into the prompts

Stage-by-stage, here's what PM sends to Anthropic as user content:

- **A — intent.** Your `map.yaml` (routes, components, forms, copy) + optionally scraped marketing pages.
- **B-classify.** The repo snapshot (tree + top-level manifest). On round 2, up to 6 requested files × 100 lines each.
- **B-model.** The project profile + up to 5 seed files × 80 lines each + a compact JSON summary of your lean canvas intent.
- **B-walk.** The app model + your lean canvas.
- **C — delta.** Your lean canvas + the walked paths. The pattern library is in the system prompt so it caches across all audits.
- **D — leverage.** The delta JSON.
- **E — spec.** A single problem + a compact slice of the delta.
- **E — prototype.** The solution spec JSON.
- **F — assembly.** The full in-memory audit bundle (lean canvas, paths, delta, problems, solutions).

No file is sent whole unless it's under 100 lines. Nothing is sent that wasn't already in the repo you pointed PM at.

## What does NOT hit the wire

- `ANTHROPIC_API_KEY` is never written to logs or telemetry.
- PM doesn't phone home. There is no usage counter, no device registration, no PR-polling, no update check.
- `~/.pm/config.yaml` and `.pm/pm.sqlite` stay on disk. If you don't want audit history, delete them.

## Cost

See [`cost-and-time.md`](./cost-and-time.md) for example audits with real numbers.

The running cost of an audit is shown live in the progress UI (`$0.18` ticks up as output tokens stream). Final cost lands in the completion block and in `audits.total_neurons` (integer micro-USD despite the column name — see `db/schema.ts` `COST_COLUMN_SEMANTIC`). `pm cost` aggregates across audits.
