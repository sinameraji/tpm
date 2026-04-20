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
// Pricing (as of 2026-04-21, from CF's Workers AI model catalog):
//   Opus 4.7 — $5/$25/$0.50/$6.25 per MTok (input/output/cache-read/
//   cache-creation). Roughly 1/3 of Anthropic's direct list for Opus.
//   Sonnet 4.6 — assumed parity with Anthropic until CF confirms;
//   update CLOUDFLARE_MODEL_PRICING in core/pricing.ts when it's
//   known.
//
// Prompt caching IS supported on this path — CF's model page lists
// cached-input and cache-creation token pricing explicitly. We send
// cache_control: ephemeral for opt-in stages, same shape as the
// Anthropic direct gateway.
//
// Streaming is supported by the API but not implemented in this
// gateway yet (CF's SSE shape for anthropic/* needs a separate
// parser). The progress UI ticks once on completion rather than
// every delta on this path; end-of-stage cost/checkmark still land.

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
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };
    model?: string;
  };
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

// Anthropic's system-message-with-cache shape: an array of text
// content blocks, the cached one marked with cache_control.
interface SystemTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

// Cache floor (same as AnthropicGateway). Below this we send the
// system message as a plain string — CF would accept cache_control
// below the floor and silently not cache, making our Usage numbers
// misleading.
const CACHE_MIN_TOKENS = 1024;
const CHARS_PER_TOKEN = 2.8;
function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / CHARS_PER_TOKEN);
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
    const systemForApi = buildSystemParam(system, opts);

    const body: Record<string, unknown> = {
      messages: conversationForApi,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.1,
    };
    if (systemForApi !== undefined) body.system = systemForApi;
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
      cacheReadInputTokens: parsed.result.usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: parsed.result.usage?.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - started,
      // Marks the downstream cost table: CF's rates for Opus are
      // ~1/3 of Anthropic-direct. Without this stamp, cost-calc
      // would over-report.
      source: "cloudflare",
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

function buildSystemParam(
  system: string | null,
  opts: CompleteOptionsExt,
): string | SystemTextBlock[] | undefined {
  if (!system) return undefined;
  if (!opts.cacheSystem) return system;
  if (estimateTokens(system) < CACHE_MIN_TOKENS) {
    // Below CF's (= Anthropic's) cache floor, cache_control would
    // be a silent no-op. Return plain string so the Usage that comes
    // back accurately reports zero cached tokens.
    return system;
  }
  return [
    {
      type: "text",
      text: system,
      cache_control: { type: "ephemeral" },
    },
  ];
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
