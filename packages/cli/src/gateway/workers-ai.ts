import * as os from "node:os";
import type { CompletionOptions, CompletionResult, Message, ModelGateway } from "./index.js";
import { ensureFreshToken, type TokenBundle } from "../auth/tokens.js";

export interface WorkersAIGatewayConfig {
  endpoint: string;
  fetchImpl?: typeof fetch;
  homeDir?: string;
}

interface InferResponse {
  ok: boolean;
  call_id: string;
  model: string;
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    neurons: number;
    latency_ms: number;
  };
}

export interface CompleteOptionsExt extends CompletionOptions {
  auditId?: string;
  stage?: "A" | "B" | "C" | "D" | "E" | "F" | "meta";
  sessionId?: string;
}

export class WorkersAIGateway implements ModelGateway {
  readonly name = "workers-ai";
  private readonly fetchImpl: typeof fetch;
  private readonly homeDir: string;

  constructor(private readonly config: WorkersAIGatewayConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.homeDir = config.homeDir ?? os.homedir();
  }

  private async ensureToken(): Promise<TokenBundle> {
    return ensureFreshToken(this.config.endpoint, this.homeDir, this.fetchImpl);
  }

  async complete(
    model: string,
    messages: Message[],
    opts: CompleteOptionsExt = {},
  ): Promise<CompletionResult> {
    const token = await this.ensureToken();
    const url = new URL("/infer", this.config.endpoint);
    const started = Date.now();
    const res = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token.access_token}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        response_format: opts.responseFormat,
        audit_id: opts.auditId,
        stage: opts.stage,
        session_id: opts.sessionId,
      }),
    });
    if (res.status === 401) {
      // Token expired between our pre-flight and this call — one retry
      // after forcing a re-register (writes a new bundle to disk).
      const fresh = await ensureFreshToken(
        this.config.endpoint,
        this.homeDir,
        this.fetchImpl,
        true,
      );
      return this.completeWithToken(model, messages, opts, fresh);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`infer failed ${res.status}: ${text}`);
    }
    const body = (await res.json()) as InferResponse;
    return {
      text: body.text,
      model: body.model,
      usage: {
        inputTokens: body.usage.input_tokens,
        outputTokens: body.usage.output_tokens,
        neurons: body.usage.neurons,
        latencyMs: body.usage.latency_ms ?? Date.now() - started,
      },
    };
  }

  private async completeWithToken(
    model: string,
    messages: Message[],
    opts: CompleteOptionsExt,
    token: TokenBundle,
  ): Promise<CompletionResult> {
    const url = new URL("/infer", this.config.endpoint);
    const started = Date.now();
    const res = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token.access_token}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        response_format: opts.responseFormat,
        audit_id: opts.auditId,
        stage: opts.stage,
        session_id: opts.sessionId,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`infer failed ${res.status}: ${text}`);
    }
    const body = (await res.json()) as InferResponse;
    return {
      text: body.text,
      model: body.model,
      usage: {
        inputTokens: body.usage.input_tokens,
        outputTokens: body.usage.output_tokens,
        neurons: body.usage.neurons,
        latencyMs: body.usage.latency_ms ?? Date.now() - started,
      },
    };
  }
}
