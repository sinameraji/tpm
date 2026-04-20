# Cost + time

## What to expect

TPM v1.2.0 runs against Anthropic (Sonnet 4.6 default, Opus 4.7 deep tier). You pay Anthropic directly at their [published rates](https://www.anthropic.com/pricing). No markup.

A typical fast-tier audit costs **~$1–3** and takes **~8–12 minutes**. Large repos (thousands of files in the map) and deep-tier audits cost more and take longer. These numbers are rough — the pre-flight block in `tpm audit` shows the estimate relevant to your tier.

Cost is driven mostly by input tokens on Stages B-model, C, and F (the stages that ingest the most context). Prompt caching cuts the input cost on the second audit onward against the same repo (see `cache_read_input_tokens` in logs).

## Example audits

Numbers in this table come from the 5-repo test matrix run at release time. They're a baseline — your audits will vary with codebase size, marketing-URL depth, and how Anthropic's pricing moves.

> **Placeholder.** This table will be filled in by the test matrix (see ship-sequence C13 in the internal plan). Once real numbers land, it replaces this section verbatim.

| Repo (fast tier)               | Wall clock | In tokens | Out tokens | Cache-read | Cost | Retries | spec.md coherent? |
| ------------------------------ | ---------: | --------: | ---------: | ---------: | ---: | ------: | :---------------: |
| Next.js SaaS (GitHub trending) |          — |         — |          — |          — |    — |       — |         —         |
| `decision-journal-electron`    |          — |         — |          — |          — |    — |       — |         —         |
| Python ML (HuggingFace repo)   |          — |         — |          — |          — |    — |       — |         —         |
| Rust CLI (ripgrep-class)       |          — |         — |          — |          — |    — |       — |         —         |
| Rails/Django monolith          |          — |         — |          — |          — |    — |       — |         —         |

| Repo (deep tier)                  | Wall clock | In tokens | Out tokens | Cache-read | Cost | Retries | spec.md coherent? |
| --------------------------------- | ---------: | --------: | ---------: | ---------: | ---: | ------: | :---------------: |
| Next.js SaaS (same repo as above) |          — |         — |          — |          — |    — |       — |         —         |

## How TPM shows cost

- **Pre-flight.** Before Stage A runs: _"This will take about 8–12 minutes and cost roughly $1–3"_ (fast), or _"about 18–25 minutes and roughly $6–10"_ (deep).
- **Live.** Each stage's progress line ticks up: `38s · 2,847 in · 1,204 out · ~$0.06`. On Stage E (parallel), the summary swaps in: `2/5 done (S001, S003) · 3 streaming · $0.18`.
- **Completion block.** Final total in the form `$1.62`.
- **Historical.** `tpm cost` aggregates across audits. `tpm report --all` lists audits with their per-audit totals.

## Cutting cost

- **Run `fast` tier first.** It's the default. Only move to `deep` when you want the B-model / C / E-spec / F stages on Opus — most audits don't need it.
- **Scope the repo.** Pointing TPM at a multi-package monorepo costs more than pointing it at a single app package. TPM reads what you give it.
- **Skip marketing.** `--no-marketing` drops one step and ~10% of Stage A's input.
- **Let the cache warm.** The first audit on a fresh machine doesn't see cache reads (Anthropic's cache is empty). Subsequent audits within the 5-minute cache TTL see hits on every stage that opted in.
- **Drop specific stages to Sonnet when overriding.** `tpm config set stage_models.c claude-sonnet-4-6` rolls Stage C back to Sonnet on the deep tier.
