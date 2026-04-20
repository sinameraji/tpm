// Anthropic gateway. Implements ModelGateway against
// @anthropic-ai/sdk. Streams internally so the progress UI can tick
// output-token counts as they arrive; returns the same
// CompletionResult shape as every other gateway.
//
// Key properties:
//   - JSON mode: we add a prompt instruction ("Respond with a single
//     JSON object, no prose, no code fences") rather than forcing a
//     tool call. The stage-runner already strips code fences and
//     retries on parse failure — tool-forcing adds complexity for
//     little gain on Sonnet/Opus 4.x.
//   - Prompt caching: callers opt in via `opts.cacheSystem: true`.
//     The gateway gates on a minimum system-prompt size (Anthropic
//     won't cache below ~1024 tokens — caching sub-minimum content
//     is a silent no-op, not an error). We refuse to attach
//     cache_control below the gate so the caller gets predictable
//     behavior.
//   - Usage: input/output plus cache_read/cache_creation, surfaced
//     through the shared Usage shape so cost-calc.ts can price all
//     four kinds.

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParamsStreaming,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import {
  APIError,
  APIConnectionError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { CompleteOptionsExt, CompletionResult, Message, ModelGateway } from "./index.js";

export interface AnthropicGatewayConfig {
  apiKey: string;
  // Optional override for tests. Real SDK uses its own internal fetch.
  fetchImpl?: typeof fetch;
  // Defaults to 600_000 (10 min). A single audit stage rarely runs
  // longer, but Opus on deep tier for Stage F can approach this.
  timeoutMs?: number;
}

// Anthropic's ephemeral prompt-cache minimum for Sonnet/Opus. Caching
// content below this size is a silent no-op. We use a simple
// chars-to-tokens heuristic (2.8 chars/token, matching
// stages/_lib/tokens.ts) — if the estimate is under the floor, we
// skip cache_control entirely rather than sending a dead attribute.
const CACHE_MIN_TOKENS = 1024;
const CHARS_PER_TOKEN = 2.8;

function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / CHARS_PER_TOKEN);
}

// Extended options the Anthropic gateway understands on top of the
// shared CompleteOptionsExt. Callers pass these via the same opts
// object — other gateways will ignore the extra fields.
export interface AnthropicCompleteOptions extends CompleteOptionsExt {
  // If true and the system prompt is large enough, attach
  // cache_control: { type: "ephemeral" } so the system prefix is
  // cached for 5 minutes of subsequent calls. Defaults to false —
  // only the stages that reuse a long, audit-agnostic system prompt
  // should opt in (A, C, D, F per the v1.2.0 plan).
  cacheSystem?: boolean;
}

export class AnthropicGateway implements ModelGateway {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(config: AnthropicGatewayConfig) {
    const clientOpts: ConstructorParameters<typeof Anthropic>[0] = {
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? 600_000,
    };
    if (config.fetchImpl) {
      clientOpts.fetch = config.fetchImpl;
    }
    this.client = new Anthropic(clientOpts);
  }

  async complete(
    model: string,
    messages: Message[],
    opts: AnthropicCompleteOptions = {},
  ): Promise<CompletionResult> {
    const { system, conversation } = splitSystem(messages);
    const systemForApi = buildSystemParam(system, opts);
    // JSON mode: append a strict instruction to the last user message
    // so the stage-runner's stripCodeFences + retry loop do the rest.
    // We don't use tool-forcing — Sonnet/Opus 4.x follow the
    // instruction reliably and tool-forcing makes retry correction
    // harder (the assistant's "tool_use" turn isn't trivially
    // reusable as context for a correction prompt).
    const conversationForApi = applyJsonInstruction(conversation, opts.responseFormat);

    const params: MessageCreateParamsStreaming = {
      model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.1,
      messages: conversationForApi,
      stream: true,
      ...(systemForApi !== undefined ? { system: systemForApi } : {}),
    };

    const started = Date.now();
    let cumulativeOutput = 0;
    try {
      const stream = this.client.messages.stream(params);

      // Stream text deltas up to the caller so the progress UI can
      // tick. We count characters as a rough output-token proxy in
      // real time; the authoritative output_tokens comes in the
      // final message's usage.
      if (opts.onToken) {
        stream.on("text", (delta: string) => {
          // ~1 token per 4 chars is the published heuristic for
          // English; we're already using 2.8 in our own estimator,
          // but for streaming UX "rough and fast" beats "exact".
          cumulativeOutput += Math.max(1, Math.round(delta.length / 4));
          opts.onToken?.(cumulativeOutput);
        });
      }

      const final = await stream.finalMessage();
      const text = final.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");

      const usage = final.usage;
      return {
        text,
        model: final.model ?? model,
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
          latencyMs: Date.now() - started,
        },
      };
    } catch (err) {
      throw translateError(err);
    }
  }
}

// ---- helpers ----------------------------------------------------------

// Stage-runner builds Message[] with a leading system role. Anthropic
// takes `system` as a separate top-level param. Extract it; any
// additional system messages mid-conversation would be unusual (the
// runner doesn't do that) so we take only the first.
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
  opts: AnthropicCompleteOptions,
): string | TextBlockParam[] | undefined {
  if (!system) return undefined;
  if (!opts.cacheSystem) return system;
  if (estimateTokens(system) < CACHE_MIN_TOKENS) {
    // Silent-no-op guard: below the cache floor, Anthropic would
    // accept cache_control and then not actually cache. Return the
    // plain string so the caller can see (via `cache_read_input_tokens`)
    // that nothing was cached rather than assuming it was.
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

function applyJsonInstruction(
  conversation: Message[],
  responseFormat: "text" | "json" | undefined,
): MessageParam[] {
  const out: MessageParam[] = conversation.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  if (responseFormat !== "json" || out.length === 0) return out;

  const last = out[out.length - 1]!;
  if (last.role !== "user") return out;

  const appended =
    typeof last.content === "string"
      ? `${last.content}\n\nRespond with a single JSON object that matches the schema. No prose, no code fences.`
      : last.content;
  out[out.length - 1] = { role: "user", content: appended };
  return out;
}

function translateError(err: unknown): Error {
  if (err instanceof AuthenticationError) {
    return new Error(
      "Anthropic rejected the API key (401). Run `tpm config set anthropic-key <key>` or export ANTHROPIC_API_KEY. Keys are at https://console.anthropic.com/settings/keys",
    );
  }
  if (err instanceof RateLimitError) {
    return new Error(
      "Anthropic rate limit hit (429). Wait a minute and retry, or check your account's rate limits at https://console.anthropic.com/settings/limits",
    );
  }
  if (err instanceof BadRequestError) {
    // Context-too-large errors come back as 400 with a specific
    // message; surface it verbatim so the user sees the actual
    // token/context numbers.
    const msg = (err as { message?: string }).message ?? "bad request";
    if (/context|token|too (large|long)/i.test(msg)) {
      return new Error(`Anthropic: input exceeds context window. ${msg}`);
    }
    return new Error(`Anthropic: invalid request. ${msg}`);
  }
  if (err instanceof APIError) {
    const status = err.status;
    if (status === 529) {
      return new Error(
        "Anthropic is overloaded (529). This is usually transient — retrying in a moment is the right move.",
      );
    }
    if (status && status >= 500 && status < 600) {
      return new Error(`Anthropic server error (${status}). Retryable. Details: ${err.message}`);
    }
    return new Error(`Anthropic API error (${status ?? "?"}): ${err.message}`);
  }
  if (err instanceof APIConnectionError) {
    return new Error(`Anthropic: connection failed. Check your network. Details: ${err.message}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
