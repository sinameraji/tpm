# Model Selection

TPM runs exclusively on **Cloudflare Workers AI**. No third-party LLMs.

## Selected models

| Job                                                     | Model                                      | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structured-output stages (A, C, D, E-spec, F)           | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 92% IFEval (vs 72% Multi-IF for Qwen3-30B). Cloudflare's default on the `/json` endpoint — their production-proven JSON-mode model. Non-reasoning (no hidden thinking tokens), FP8 "fast" variant. Critical for stages that need strict schema adherence: Lean Canvas shape (Stage A), fixed 7-value step classification (C), contiguous 1..N problem ranks (D), solution spec shape (E), and the 7 required `spec.md` sections (F). |
| B-classify (project-type agent) + B-model modeler A     | `@cf/qwen/qwen2.5-coder-32b-instruct`      | Code specialist, open-source, 128K context, non-reasoning. Native JSON-mode via `response_format: { type: "json_object" \| "json_schema" }`. Used by the project-type classifier (bounded agentic file-request loop) and as modeler A in the B-model ensemble. Counterweight to Llama's structural prior.                                                                                                                            |
| B-model modeler B + B-model synthesizer                 | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Same model as the structured stages — strong IFEval + JSON-mode discipline. As modeler B it brings structural consistency; as the synthesizer it reconciles disputes between modeler A and modeler B, cites evidence from disputed file excerpts.                                                                                                                                                                                    |
| B-walk (persona journey through the verified app model) | `@cf/qwen/qwen3-30b-a3b-fp8`               | 3B active MoE params, FP8, fast per-call, stronger MMLU-Pro (78.4 vs 68.9). B-walk is a narrative task — imagine the persona's path given a verified navigation graph — which is Qwen3's strength.                                                                                                                                                                                                                                   |
| E prototype HTML                                        | `@cf/qwen/qwen3-30b-a3b-fp8`               | Creative HTML generation. Same rationale as B-walk.                                                                                                                                                                                                                                                                                                                                                                                  |
| Vision (optional, reserved)                             | `@cf/meta/llama-4-scout-17b-16e-instruct`  | Native multimodal. Kept in the allowlist for future screenshot-aware features; not wired in v1.                                                                                                                                                                                                                                                                                                                                      |

## Stage B architecture — why a multi-agent ensemble

Stage B ("understand the app") is the load-bearing step in the audit: if we get reality wrong, Stage C's delta, Stage D's leverage ranking, Stage E's solutions, and Stage F's spec.md are all downstream-wrong. Single-model reads of a codebase have systematic blind spots — different foundation models over-index on different idioms. We explicitly trade a modest token-cost increase for higher confidence via a jury pattern:

1. **B-classify** (LLM agent with bounded file requests) — Qwen2.5-Coder receives an `ls`-style repo snapshot and can request up to 6 specific files to decide what kind of project this is. Output: a `project_profile` with a natural-language description (no predetermined "language_primary / deployment_target / auth_surface" slots — those facets are the model's to include or omit) plus candidate entry points and screen files for B-model to read.
2. **B-model fan-out** — Qwen2.5-Coder and Llama 3.3-70B read the same seed files in parallel, each producing an independent `AppModel` (entry points, walls, screens, navigation graph). Disagreement is a feature: it flags where the code is ambiguous.
3. **B-model fan-in** — Llama 3.3-70B synthesizes. Agreed claims pass through; disputed claims are resolved by citing evidence from the specific file passages that grounded the disagreement. Every resolution goes into `synthesis_notes` for auditability.
4. **B-walk** — Qwen3-30B imagines each persona's journey over the verified navigation graph. Steps reference `screen_id`s from the app model; the walker cannot invent screens or URLs.

Incremental cost: ~0.06–0.10 USD/audit vs ~0.03 USD single-model. Per-audit target is now **~$0.60–0.75** (up from the original $0.50). Worth it — the audit is useless if reality is wrong.

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

Neurons are approximated server-side as `0.01 × (prompt_tokens + completion_tokens)` until real Cloudflare invoices calibrate this. Target per-audit spend: **~$0.60–0.75** after the Stage B redesign (was ~$0.50).

| Stage | Target     | Notes                                                                                                                                                                            |
| ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | $0.10      | Single llama-3.3-70b call; compacted static map in, Lean Canvas JSON out                                                                                                         |
| B     | $0.22–0.35 | B-classify (1–2 Qwen2.5-Coder calls) + B-model ensemble (Qwen2.5-Coder + Llama 3.3-70B in parallel + Llama synthesizer) + B-walk (1 Llama-3.3-70B call per persona, 1–2 typical) |
| C     | $0.10      | Single llama-3.3-70b call                                                                                                                                                        |
| D     | $0.05      | Single llama-3.3-70b call                                                                                                                                                        |
| E     | $0.08      | 5 llama spec calls + 5 llama prototype calls, bounded concurrency=2 (1.1.3)                                                                                                      |
| F     | $0.02      | Single llama-3.3-70b call, markdown out                                                                                                                                          |

### JSON-mode multiplier (observed in production)

Requesting `response_format: { type: "json_object" }` on Llama 3.3-70B triggers Workers AI's speculative-decoding backend (`@cf/meta/llama-3.3-70b-instruct-sd`). Neurons are billed against the `-sd` routing **in addition to** the base model call — effective cost is roughly **2.5× the sticker neuron price per JSON-mode call**. Real per-audit cost is closer to **$1.00–$1.25**, not the $0.60–$0.75 target above. The Workers AI usage dashboard under-reports this because its "Text Generation" aggregate card excludes the `-sd` routing bucket. See `docs/model-failures.md` for the full incident and remediation.

### Hosted-tier free allocation

Cloudflare's free Workers AI tier is **10K neurons/day/account**. A full 6-stage TPM audit is ~8–12K neurons after the JSON-mode multiplier, so the free tier covers **~1 audit/day**. Upgrade to Workers Paid (or use BYO gateway against an account with Workers Paid enabled) for unlimited audits. Cloudflare for Startups Program members: your $250K credit pool covers Workers Paid usage — ask startups@cloudflare.com to enable the paid tier on your account.
