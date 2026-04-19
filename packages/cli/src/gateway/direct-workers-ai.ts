// BYO (Bring Your Own) Cloudflare Workers AI gateway — talks directly to
// the user's Cloudflare account using the AI REST API. No TPM proxy, no
// hosted trial: the user pays Cloudflare for their own usage.

import type { CompletionOptions, CompletionResult, Message, ModelGateway } from "./index.js";

export interface DirectWorkersAIGatewayConfig {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}

interface CfAiResponseBody {
  result?: {
    response?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  success?: boolean;
  errors?: Array<{ code: number; message: string }>;
}

export class DirectWorkersAIGateway implements ModelGateway {
  readonly name = "direct-workers-ai";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: DirectWorkersAIGatewayConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(
    model: string,
    messages: Message[],
    opts: CompletionOptions = {},
  ): Promise<CompletionResult> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/ai/run/${model}`;
    const started = Date.now();
    const body: Record<string, unknown> = { messages };
    if (opts.temperature !== undefined) body["temperature"] = opts.temperature;
    if (opts.maxTokens !== undefined) body["max_tokens"] = opts.maxTokens;
    if (opts.responseFormat === "json") body["response_format"] = { type: "json_object" };

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloudflare AI ${res.status}: ${text}`);
    }
    const parsed = (await res.json()) as CfAiResponseBody;
    if (parsed.success === false) {
      throw new Error(
        `Cloudflare AI error: ${parsed.errors?.map((e) => `${e.code} ${e.message}`).join("; ")}`,
      );
    }
    const result = parsed.result ?? {};
    return {
      text: result.response ?? "",
      model,
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - started,
      },
    };
  }
}
