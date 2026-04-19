// Cheap input-token estimator. We don't want a network round-trip
// (tiktoken / the model's own tokenizer) just to decide "can this
// prompt fit the context window?"
//
// Heuristic: English prose is ~4 chars/token; JSON with lots of
// punctuation closer to 3.5; code ~3. We use 3.5 as a safe middle,
// rounding UP (over-estimate means we err toward "too big, trim"
// rather than "too small, send and fail").
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
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
  "@cf/meta/llama-4-scout-17b-16e-instruct": 128_000,
  "@cf/openai/gpt-oss-120b": 128_000,
};

export function maxContextFor(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 32_000;
}
