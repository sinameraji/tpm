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

## Lessons

- **Always diagnose before fixing.** For both failures, we initially hypothesized the wrong cause (thinking-tokens for Qwen3-A3B; we were about to re-hypothesize on the shape without verifying). A one-line structured log in the backend confirmed shape in 20 minutes; would have saved days the first time.
- **Reasoning models are dangerous for structured output.** If we use one, we MUST handle `reasoning_content` separately in the gateway and the CLI — we can't just pass `response_format: json_object` and hope.
- **Backend should log response shape classifier per call.** The `kind: "ai_shape"` log in `/infer` is permanent — if a future model returns a third shape, we'll notice it in the logs before users file a bug.
