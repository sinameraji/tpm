# Model Selection

TPM runs exclusively on **Cloudflare Workers AI**. No third-party LLMs.

## Selected models

| Job                                             | Model                                     | Rationale                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heavy reasoning (Stages A, C, D, E spec gen, F) | `@cf/openai/gpt-oss-120b`                 | Best reasoning-per-neuron; MoE; strong structured output in JSON mode. Used for the single-shot stages where one call does the whole job.                                  |
| Navigator decisions + prototype HTML            | `@cf/qwen/qwen3-30b-a3b-fp8`              | 3B active params, FP8, fast per-call, strong instruction-following. Used for the high-call-count loop (navigator) and for HTML generation where creative prose is welcome. |
| Vision (optional, v2)                           | `@cf/meta/llama-4-scout-17b-16e-instruct` | Native multimodal. Reserved for cases where DOM summary is insufficient and a screenshot is needed. Not wired in v1.                                                       |

## Why no Anthropic, OpenAI direct, or AI Gateway

1. **Unified billing story.** One Neuron unit across the entire audit simplifies pricing, quota, and cost reporting.
2. **Single vendor trust surface.** Workers AI lives in the same Cloudflare account as D1, KV, R2, and the Worker itself. Less cross-vendor credential sprawl.
3. **Latency.** Workers AI calls from a Worker stay inside Cloudflare — no hop to external providers.
4. **Customer privacy story.** "Your prompts never leave Cloudflare" is simpler to verify than "your prompts go to provider X via gateway Y."

## Config override

Per-stage model selection lives in `~/.tpm/config.yaml`:

```yaml
models:
  heavy: "@cf/openai/gpt-oss-120b"
  navigator: "@cf/qwen/qwen3-30b-a3b-fp8"
  prototype: "@cf/qwen/qwen3-30b-a3b-fp8"
```

Strings must be in the Workers AI catalog allowlist (`packages/backend/src/routes/infer.ts` `ALLOWED_MODELS`). Adding a model requires both updating the allowlist and verifying it works on the target tier.

## Cost calibration

Neurons are approximated server-side as `0.01 × (prompt_tokens + completion_tokens)` until M18 dogfood calibrates against Cloudflare invoices. Expected per-audit spend at $0.50 target:

| Stage | Target | Notes                           |
| ----- | ------ | ------------------------------- |
| A     | $0.10  | Single call, ~40k in / 8k out   |
| B     | $0.15  | 20-40 calls, small each         |
| C     | $0.10  | Single call, ~50k in / 12k out  |
| D     | $0.05  | Single call, ~15k in / 6k out   |
| E     | $0.08  | 10 calls (5 spec + 5 prototype) |
| F     | $0.02  | Single call, text out           |
