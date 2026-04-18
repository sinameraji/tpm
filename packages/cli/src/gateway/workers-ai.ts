import * as os from "node:os";
import type { CompletionOptions, CompletionResult, Message, ModelGateway } from "./index.js";
import { loadOrCreateDevice } from "../auth/device.js";
import { isExpiringSoon, loadTokens, saveTokens, type TokenBundle } from "../auth/tokens.js";
import { TPM_VERSION } from "@tpm/shared";

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

interface RegisterResponse {
  ok: boolean;
  device_id: string;
  tier: "free" | "pro" | "team";
  access_token: string;
  refresh_token: string;
  expires_in: number;
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
    let bundle = loadTokens(this.homeDir);
    if (bundle && !isExpiringSoon(bundle, 120)) return bundle;
    bundle = await this.registerDevice();
    return bundle;
  }

  private async registerDevice(): Promise<TokenBundle> {
    const device = loadOrCreateDevice(this.homeDir);
    const url = new URL("/device/register", this.config.endpoint);
    const res = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_id: device.device_id,
        fingerprint_hash: device.fingerprint_hash,
        tpm_version: TPM_VERSION,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`device_register failed ${res.status}: ${text}`);
    }
    const body = (await res.json()) as RegisterResponse;
    const issuedAt = new Date();
    const bundle: TokenBundle = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      tier: body.tier,
      device_id: body.device_id,
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + body.expires_in * 1000).toISOString(),
    };
    saveTokens(bundle, this.homeDir);
    return bundle;
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
      // Token likely expired — one retry after re-register.
      const fresh = await this.registerDevice();
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
