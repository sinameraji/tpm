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
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": 128_000,
  "@cf/qwen/qwen3-30b-a3b-fp8": 32_000,
  // Workers AI enforces a 24K total limit on Qwen2.5-Coder-32B (input
  // + max_output). Caught in production when a B-model call hit 30K
  // and Cloudflare rejected with "exceeded model context window 24000".
  "@cf/qwen/qwen2.5-coder-32b-instruct": 24_000,
  "@cf/meta/llama-4-scout-17b-16e-instruct": 128_000,
  "@cf/openai/gpt-oss-120b": 128_000,
};

export function maxContextFor(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 32_000;
}
