# Models

PM v1.2.0 runs exclusively on Anthropic's Claude 4 family: Sonnet 4.6 and Opus 4.7. Model IDs referenced in this doc are the canonical ones from [docs.claude.com](https://docs.claude.com).

## Tiers

`pm config set model-tier <fast|deep>` picks a tier. Fast is the default.

### Fast (default)

Every stage on `claude-sonnet-4-6`. Target audit time: 8–12 min. Target cost: ~$1–3 per audit.

### Deep

Opus on the heavy-thinking stages; Sonnet on the rest. Target audit time: 18–25 min. Target cost: ~$6–10 per audit.

| Stage                   | fast              | deep                |
| ----------------------- | ----------------- | ------------------- |
| A — intent              | claude-sonnet-4-6 | claude-sonnet-4-6   |
| B — classify project    | claude-sonnet-4-6 | claude-sonnet-4-6   |
| B — model app           | claude-sonnet-4-6 | **claude-opus-4-7** |
| B — walk personas       | claude-sonnet-4-6 | claude-sonnet-4-6   |
| C — delta               | claude-sonnet-4-6 | **claude-opus-4-7** |
| D — leverage            | claude-sonnet-4-6 | claude-sonnet-4-6   |
| E — spec (per solution) | claude-sonnet-4-6 | **claude-opus-4-7** |
| E — prototype HTML      | claude-sonnet-4-6 | claude-sonnet-4-6   |
| F — assembly (spec.md)  | claude-sonnet-4-6 | **claude-opus-4-7** |

The Opus stages are the ones where a stronger reasoner materially improves output quality — structural modeling (B-model), intent-vs-reality delta (C), solution design (E-spec), and final report assembly (F). Everything else is structured extraction where Sonnet 4.6 is already ceiling.

## Per-stage overrides

`stage_models.<key>` in `~/.pm/config.yaml` overrides the tier default for one stage:

```bash
pm config set stage_models.c claude-opus-4-7      # upgrade just Stage C
pm config set stage_models.b-model claude-sonnet-4-6   # downgrade on deep tier
pm config unset stage_models.c                    # remove override
```

Valid stage keys: `a`, `b-classify`, `b-model`, `b-walk`, `c`, `d`, `e-spec`, `e-proto`, `f`.

## Temperature

Standardized across stages:

- **0.1** on structured-output stages (A, B-classify, B-model, C, D, E-spec). JSON reliability > creativity.
- **0.3** on narrative stages (B-walk imagined journey, E-prototype HTML). Enough to produce varied, realistic prose without the structure falling apart.
- **0.2** on Stage F (markdown assembly). In between — it's prose but constrained to section structure.

You can't override temperature via config in 1.2.0. If you need to, open an issue.

## Max tokens

Per stage, sized for the actual output envelope:

- A: 16K · B-classify: 3K · B-model: 6K · B-walk: 4K
- C: 16K · D: 8K · E-spec: 8K · E-prototype: 4K · F: 16K

These are conservative upper bounds — actual output is usually smaller. Raising them has no effect on cost for unused tokens (Anthropic charges on actual usage).

## Prompt caching

System prompts on Stages A, B-classify, B-model, B-walk, C, D, E-spec, E-prototype, and F all opt in to `cache_control: { type: "ephemeral" }`. The gateway refuses to attach cache_control below Anthropic's ~1024-token cache floor (to avoid silent no-ops), so short system prompts silently behave as uncached.

On a second audit against the same repo within the cache TTL (5 min for ephemeral), the system prompts read from cache at ~10% of normal input cost. The pattern library in Stage C's system prompt is a particularly meaty cache hit — it's the single largest block PM sends.

You can verify caching is working by looking at `cache_read_input_tokens` in the log output (`pm audit --verbose`) or by observing that the cost of the second audit is materially lower than the first.

## Why we moved off Cloudflare Workers AI (from 1.1.x)

v1.1.x ran a mix of Llama 3.3 70B, Qwen 2.5-Coder-32B, Qwen 3-30B-A3B, and a 120B GPT-OSS on Cloudflare Workers AI. Each family had different quirks — response shapes, context window empirical ceilings, JSON-mode reliability, rate limits — and PM's codebase accumulated a dozen compensations for running across them: an ensemble in B-model, cross-family fallbacks, a hand-rolled circuit breaker in B-classify, a Workers-AI proxy with `normalizeResponseText`, and context-window overrides. Most of that code is deleted in 1.2.0.

Moving to one well-behaved model family on Anthropic let us delete most of that. The numbers argued for it too: on fast tier, the Sonnet-only 1.2.0 is cheaper end-to-end than the multi-family 1.1.x (because the ensemble overhead is gone) and latency is lower (fewer models means fewer cold starts, and prompt caching cuts input cost on repeat runs).
