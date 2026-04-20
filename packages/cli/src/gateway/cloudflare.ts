// Cloudflare Workers AI gateway — routes Claude calls through
// Cloudflare's Workers AI binding (billed in Neurons from your CF
// account) instead of calling api.anthropic.com directly (billed in
// USD to Anthropic).
//
// This is intentionally NOT the AI Gateway proxy path — AI Gateway
// still requires an Anthropic key and bills Anthropic. Workers AI
// with Anthropic partner models is CF's own inference product: you
// pay Cloudflare, and the Anthropic key is held by Cloudflare, not
// you.
//
// REST endpoint:
//   POST https://api.cloudflare.com/client/v4/accounts/{account_id}
//        /ai/run/anthropic/claude-opus-4-7
//
// Request body mirrors the Anthropic messages API shape (messages,
// system, max_tokens, temperature). Streaming via `stream: true`
// returns SSE — we consume it to drive the progress UI just like
// the Anthropic gateway.
//
// Gotchas vs Anthropic direct:
//   - Prompt caching (cache_control: ephemeral) is NOT attempted on
//     this path. CF's Workers AI catalog entry for anthropic/* hasn't
//     documented cache_control support yet. If we pass it and CF
//     ignores it, we'd silently lose cache savings across audits.
//     Callers should already tolerate "cache disabled" — the
//     AnthropicGateway has the same silent-no-op for small prompts.
//   - Cost is reported in CF Neurons, not per-kind Anthropic tokens.
//     We still populate the four-kind Usage shape so cost-calc.ts
//     prices at Anthropic-direct rates; real CF pricing may differ.
//     Treat the cost display on this path as an estimate.

import type {
  CompleteOptionsExt,
  CompletionResult,
  Message,
  ModelGateway,
  Usage,
} from "./index.js";

export interface CloudflareGatewayConfig {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Shape of a successful CF Workers AI response for chat-style models.
// CF wraps the provider result in { result, success, errors, messages }.
interface CloudflareRunResponse {
  success: boolean;
  result?: {
    response?: string;
    // Anthropic partner models return the provider's response shape
    // inline under `result` when not streaming.
    content?: Array<{ type: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    model?: string;
  };
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

export class CloudflareGateway implements ModelGateway {
  readonly name = "cloudflare";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CloudflareGatewayConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(
    model: string,
    messages: Message[],
    opts: CompleteOptionsExt = {},
  ): Promise<CompletionResult> {
    // Stages pass short IDs ("claude-opus-4-7"). Workers AI expects
    // the partner-namespaced form ("anthropic/claude-opus-4-7").
    const cfModel = model.startsWith("anthropic/") ? model : `anthropic/${model}`;
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      this.config.accountId,
    )}/ai/run/${cfModel}`;

    const { system, conversation } = splitSystem(messages);
    const conversationForApi = applyJsonInstruction(conversation, opts.responseFormat);

    const body: Record<string, unknown> = {
      messages: conversationForApi,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.1,
    };
    if (system !== null) body.system = system;
    // Streaming isn't wired in this iteration — the CF SSE shape for
    // anthropic/* models needs a separate parser. Non-streaming keeps
    // the gateway honest; the progress UI still shows elapsed/final
    // cost just without the live token ticker. Follow-up.

    const started = Date.now();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.config.timeoutMs ?? 600_000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw translateHttpError(res, await safeReadText(res));
    }
    const parsed = (await res.json()) as CloudflareRunResponse;
    if (!parsed.success || !parsed.result) {
      const why = parsed.errors?.map((e) => e.message).join("; ") ?? "unknown error";
      throw new Error(`Cloudflare Workers AI call failed: ${why}`);
    }

    // Anthropic partner response shape: { content: [{ type: "text",
    // text: "..." }], usage: { input_tokens, output_tokens } }.
    // Older CF chat shape: { response: "..." }. Prefer the structured
    // content when present; fall back to .response.
    const text = (
      parsed.result.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("") ||
      parsed.result.response ||
      ""
    ).trim();

    const usage: Usage = {
      inputTokens: parsed.result.usage?.input_tokens ?? parsed.result.usage?.prompt_tokens ?? 0,
      outputTokens:
        parsed.result.usage?.output_tokens ?? parsed.result.usage?.completion_tokens ?? 0,
      // CF may or may not report cache-read/creation tokens for
      // Anthropic partner models. Default to 0; cost-calc handles it.
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      latencyMs: Date.now() - started,
    };

    // Fire onToken with the final output count so the progress UI
    // at least ticks once — no mid-stream deltas on this path.
    if (opts.onToken && usage.outputTokens > 0) {
      opts.onToken(usage.outputTokens);
    }

    return {
      text,
      model: parsed.result.model ?? model,
      usage,
    };
  }
}

// ---- helpers ------------------------------------------------------

function splitSystem(messages: Message[]): {
  system: string | null;
  conversation: Message[];
} {
  if (messages.length > 0 && messages[0]!.role === "system") {
    return {
      system: messages[0]!.content,
      conversation: messages.slice(1),
    };
  }
  return { system: null, conversation: messages };
}

interface AnthropicStyleMessage {
  role: "user" | "assistant";
  content: string;
}

function applyJsonInstruction(
  conversation: Message[],
  responseFormat: "text" | "json" | undefined,
): AnthropicStyleMessage[] {
  const out: AnthropicStyleMessage[] = conversation.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  if (responseFormat !== "json" || out.length === 0) return out;
  const last = out[out.length - 1]!;
  if (last.role !== "user") return out;
  out[out.length - 1] = {
    role: "user",
    content: `${last.content}\n\nRespond with a single JSON object that matches the schema. No prose, no code fences.`,
  };
  return out;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function translateHttpError(res: Response, body: string): Error {
  const preview = body.slice(0, 400);
  if (res.status === 401 || res.status === 403) {
    return new Error(
      `Cloudflare rejected the API token (${res.status}). Check that the token has Workers AI: Read permission on your account, and that the account id is correct. Run: tpm config set cloudflare-account-id <id> && tpm config set cloudflare-api-key <token>`,
    );
  }
  if (res.status === 429) {
    return new Error(
      "Cloudflare Workers AI rate limit hit (429). Wait and retry; if this persists, your CF Neurons daily allowance may be exhausted — check https://dash.cloudflare.com/?to=/:account/ai/workers-ai",
    );
  }
  if (/insufficient|quota|balance|neuron/i.test(preview)) {
    return new Error(
      `Cloudflare Workers AI quota issue (${res.status}): ${preview}. Add Neurons or upgrade your Workers plan at https://dash.cloudflare.com/`,
    );
  }
  if (res.status >= 500) {
    return new Error(
      `Cloudflare Workers AI ${res.status} server error. Retryable. Details: ${preview}`,
    );
  }
  return new Error(`Cloudflare Workers AI error ${res.status}: ${preview}`);
}
