# Model Selection

TPM runs exclusively on **Cloudflare Workers AI**. No third-party LLMs.

## Selected models

| Job                                                         | Model                                      | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structured-output stages (A, C, D, E-spec, F)               | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 92% IFEval (vs 72% Multi-IF for Qwen3-30B). Cloudflare's default on the `/json` endpoint — their production-proven JSON-mode model. Non-reasoning (no hidden thinking tokens), FP8 "fast" variant. Critical for stages that need strict schema adherence: Lean Canvas shape (Stage A), fixed 7-value step classification (C), contiguous 1..N problem ranks (D), solution spec shape (E), and the 7 required `spec.md` sections (F). |
| Narrative / creative stages (B navigator, E prototype HTML) | `@cf/qwen/qwen3-30b-a3b-fp8`               | 3B active MoE params, FP8, fast per-call, strong instruction-following for open-ended tasks. Stage B imagines a user journey from the static code map; Stage E generates annotated HTML prototypes. Both benefit from Qwen's stronger MMLU-Pro (78.4 vs 68.9) and creative generation.                                                                                                                                               |
| Vision (optional, reserved)                                 | `@cf/meta/llama-4-scout-17b-16e-instruct`  | Native multimodal. Kept in the allowlist for future screenshot-aware features; not wired in v1.                                                                                                                                                                                                                                                                                                                                      |

## History / why we moved off `gpt-oss-120b`

Initial plan used `@cf/openai/gpt-oss-120b` for the heavy stages on the theory it was "best reasoning per neuron." In practice that bit us:

1. **gpt-oss-120b is a reasoning model.** Its output tokens include hidden chain-of-thought. Cloudflare's `env.AI.run()` doesn't split `max_completion_tokens` from the total `max_tokens` budget, so the model could (and did) burn the entire output budget on internal thinking and return **empty visible text** — a hard-to-diagnose failure seen in production on a real repo.
2. **It's not on Workers AI's JSON-mode supported list.** The 9 models Cloudflare explicitly blesses for `response_format: { type: "json_object" }` include Llama 3.1 / 3.3, DeepSeek R1, Hermes variants. gpt-oss-120b isn't among them, so JSON-mode adherence was best-effort at best.
3. **We never set a `reasoning.effort` cap.** The model was free to think without bound.

Three failure modes stacked. Llama 3.3-70B FP8 Fast has none of them: non-reasoning, JSON-mode-blessed, 128K context, 20-point IFEval lead over Qwen. The cost per output token is ~6× higher, but at 5 structured calls per audit that's cents, and the failure-rate reduction more than pays for it (no retries, no wasted neurons on empty responses).

## Why no Anthropic, OpenAI direct, or AI Gateway

1. **Unified billing story.** One Neuron unit across the entire audit simplifies pricing, quota, and cost reporting.
2. **Single vendor trust surface.** Workers AI lives in the same Cloudflare account as D1, KV, R2, and the Worker itself. Less cross-vendor credential sprawl.
3. **Latency.** Workers AI calls from a Worker stay inside Cloudflare — no hop to external providers.
4. **Customer privacy story.** "Your prompts never leave Cloudflare" is simpler to verify than "your prompts go to provider X via gateway Y."

## Config override

Per-stage model selection will live in `~/.tpm/config.yaml` once per-stage overrides ship (Phase 2 governance work). For now the models are hardcoded in each stage's `stage-*.ts` and the backend's `ALLOWED_MODELS` allowlist (`packages/backend/src/routes/infer.ts`). Adding a model requires both updating the allowlist and verifying it works on the hosted trial tier.

## Cost calibration

Neurons are approximated server-side as `0.01 × (prompt_tokens + completion_tokens)` until real Cloudflare invoices calibrate this. Target per-audit spend: **~$0.50**.

| Stage | Target | Notes                                                                    |
| ----- | ------ | ------------------------------------------------------------------------ |
| A     | $0.10  | Single llama-3.3-70b call; compacted static map in, Lean Canvas JSON out |
| B     | $0.15  | 1 qwen3-30b call per persona (usually 1–2 personas)                      |
| C     | $0.10  | Single llama-3.3-70b call                                                |
| D     | $0.05  | Single llama-3.3-70b call                                                |
| E     | $0.08  | 5 llama spec calls + 5 qwen prototype calls, parallelized                |
| F     | $0.02  | Single llama-3.3-70b call, markdown out                                  |
