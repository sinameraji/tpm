// Cheap input-token estimator. We don't want a network round-trip
// (tiktoken / the model's own tokenizer) just to decide "can this
// prompt fit the context window?"
//
// Heuristic: English prose is ~4 chars/token; JSON with lots of
// punctuation closer to 3.5; dense code ~2.5 per Cloudflare's
// tokenizer. We use 2.8 — confirmed by production incident where
// char/3.5 underestimated a B-model call by ~40% vs CF's actual count.
// Over-estimate is safe (bail early); under-estimate means the
// gateway returns a 5021 context-window error late in the call.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 2.8);
}

export function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  // ~4 tokens overhead per message (role + formatting) is OpenAI's
  // rule of thumb; we use the same.
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content) + 4;
  return total + 2;
}

// Context windows for every model in our ALLOWED_MODELS allowlist.
// Conservative — we leave 1-2K for system overhead.
// Context windows per Cloudflare's own model docs
// (https://developers.cloudflare.com/workers-ai/models/<id>/ — each
// page has the exact number under "Context Window"). These are the
// TOTAL context the model accepts (input tokens + max_tokens). Our
// pre-flight check enforces (estimated_input + max_tokens) <= this.
//
// Do NOT trust model-card-style marketing numbers ("128K!") — the
// Workers AI runtime caps many models well below that. We learned
// this the hard way — 1.1.2 hit a 5021 "exceeded model context
// window 24000" error when we assumed Llama 3.3 70B had a 128K
// window; the actual CF limit is 24K.
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Llama 3.3 70B docs page claims 24K context (NOT the 128K model-card
  // number). We trust CF's page.
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": 24_000,
  // Llama 3.1 8B has a tiny 7,968 CF cap. Only usable for prompts
  // under ~4K input + short max_tokens. NOT a fallback for Stage B
  // walker (4-5K input + 4K output) or Stage E spec (8K output).
  "@cf/meta/llama-3.1-8b-instruct": 7_968,
  "@cf/qwen/qwen3-30b-a3b-fp8": 32_768,
  // Docs say 32,768. CF's runtime returned a 5021 error citing "model
  // context window limit (24000)" in 1.1.1-era testing. Keep the
  // empirically-verified value until CF clarifies which is right.
  "@cf/qwen/qwen2.5-coder-32b-instruct": 24_000,
  "@cf/meta/llama-4-scout-17b-16e-instruct": 128_000,
  // gpt-oss-120b uses the /ai/v1/responses endpoint (Responses API),
  // not env.AI.run(). Our gateway can't call it as-is. Listed for
  // completeness but marked non-functional.
  "@cf/openai/gpt-oss-120b": 128_000,
};

export function maxContextFor(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 32_000;
}
