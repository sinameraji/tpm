# Workers AI — model failure catalog

Every time we discover a model that misbehaves in a way we didn't expect, we add an entry here. Prevents re-discovering the same trap months later.

Keep entries terse: symptom, root cause, remediation, commit link.

---

## `@cf/openai/gpt-oss-120b` — reasoning tokens consumed, empty visible text

- **Symptom:** Stage A returned empty text after 3 attempts. `output_tokens: 2987`, `text: ""`.
- **Root cause:** gpt-oss-120b is a reasoning model. Its output budget (`max_tokens`) includes hidden chain-of-thought. Workers AI's `env.AI.run()` doesn't split `max_completion_tokens` from the total, so the model burns the whole budget on thinking and returns zero visible text.
- **Secondary cause:** not on Workers AI's JSON-mode-blessed list, so `response_format: { type: "json_object" }` is best-effort.
- **Remediation:** removed from default use. Kept in `ALLOWED_MODELS` for experimentation only. Every structured-output stage uses a non-reasoning model now (Llama 3.3 70B Instruct FP8 Fast).
- **Commit:** `0101d40` (Phase 1 model swap), `docs/models.md`.

---

## `@cf/qwen/qwen3-30b-a3b-fp8` — OpenAI-compatible response shape, our backend normalized to empty string

- **Symptom:** Stage B walker and Stage E prototype returned empty text after 3 attempts. `output_tokens: 1009 / 824 / 1049`, `text: ""`. No errors; usage was populated; CLI saw empty.
- **Root cause (confirmed via the 1.1.2-diag backend log, commit `e2360f15`):** Qwen3-A3B on Workers AI returns an OpenAI-compatible shape: `{ id, object, created, model, choices: [{ message: { content: "..." } }], usage, ... }`. There is no top-level `response` field. Our backend's `normalizeResponseText` only looked at `result.response`, returning `""`.
- **Observed shape keys (from live diag):** `["id","object","created","model","choices","service_tier","system_fingerprint","usage","prompt_logprobs","prompt_token_ids","kv_transfer_params"]`. `response_type: "undefined"`, `choices[0].message.content` is a string with the real reply.
- **Unrelated but worth noting:** Qwen3-A3B is also a hybrid-reasoning model (`<think>...</think>` capable). We initially hypothesized the empty was a thinking-token trap — it wasn't, it was the shape bug. If we ever opt back into Qwen3-A3B, we should parse `reasoning_content` separately.
- **Remediation (1.1.3):**
  1. `normalizeResponseText` now tries `result.response` (native) → `result.choices[0].message.content` (OpenAI-compatible) → `""`.
  2. Stage B walker moved to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
  3. Stage E prototype moved to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
  4. Circuit breaker added: after 2 consecutive empties from the primary, switch to `@cf/meta/llama-3.1-8b-instruct`.
- **Commit:** (pending 1.1.3).

---

## Workers AI neuron accounting — JSON-mode multiplier + free-tier enforcement

- **Symptom:** hosted-tier audit errored with `4006: you have used up your daily free allocation of 10,000 neurons`. The Workers AI dashboard showed only 6.58k/10k consumed in the "Text Generation" card, but a separate "Other" card showed **6.99k neurons on `@cf/meta/llama-3.3-70b-instruct-sd`** — a model ID TPM never explicitly calls.
- **Root cause:** when you request `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with `response_format: { type: "json_object" }`, Workers AI routes the call through the speculative-decoding backend (`-sd` variant), which bills separately. Effective neuron cost per JSON-mode call is roughly 2.5× the sticker price. The cumulative-usage dashboard and the enforcer disagree about which models to aggregate, so the "you haven't hit the limit" display is misleading.
- **Implication for pricing estimates in `docs/models.md`:** a full 6-stage audit that our pre-Phase-2-governance numbers priced at ~$0.50 is closer to **$1.00–$1.25** in real neurons. Budget accordingly.
- **Implication for the hosted trial:** the free 10K neurons/day on an un-upgraded account covers roughly **1 audit per day**. Users on the hosted tier will hit 4006 if they try a second audit before 00:00 UTC.
- **Remediation options:**
  1. Enable Workers Paid on the account. Removes the 10K/day enforcement. Bills per-neuron (~$0.011/1K). For accounts on the Cloudflare for Startups Program, invoices draw from the $250K credit pool — no out-of-pocket cost.
  2. Use BYO gateway (`tpm config set gateway byo`) with an account that has Workers Paid enabled.
  3. Temporarily reduce JSON-mode calls (downgrades output quality — not recommended).
- **Why this wasn't caught earlier:** the neuron cost per call during development was small enough to fit under the 10K/day cap on the first run. The second run of the day pushed us over.

---

## Lessons

- **Always diagnose before fixing.** For both failures, we initially hypothesized the wrong cause (thinking-tokens for Qwen3-A3B; we were about to re-hypothesize on the shape without verifying). A one-line structured log in the backend confirmed shape in 20 minutes; would have saved days the first time.
- **Reasoning models are dangerous for structured output.** If we use one, we MUST handle `reasoning_content` separately in the gateway and the CLI — we can't just pass `response_format: json_object` and hope.
- **Backend should log response shape classifier per call.** The `kind: "ai_shape"` log in `/infer` is permanent — if a future model returns a third shape, we'll notice it in the logs before users file a bug.
