export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

// Stage identifiers, duplicated here (not imported from stage-runner)
// to avoid a gateway → stages dependency cycle. Keep in sync with
// stages/_lib/stage-runner.ts `StageName`.
export type GatewayStageName = "A" | "B" | "C" | "D" | "E" | "F" | "meta";

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  stream?: boolean;
  // Fires during streaming with the cumulative output-token count so
  // far. Gateway implementations that don't stream should leave this
  // un-called. The UI uses this to drive the live token/cost ticker.
  onToken?: (cumulativeOutputTokens: number) => void;
}

// Shared extension used by all gateways. Callers (stage-runner,
// classify-project) build this; gateways may ignore fields they don't
// need. Lives here, not in a specific gateway file, so no stage code
// takes a dependency on the workers-ai module.
export interface CompleteOptionsExt extends CompletionOptions {
  auditId?: string;
  stage?: GatewayStageName;
  sessionId?: string;
  // Opt in to ephemeral prompt caching on the system prompt.
  // Gateways that don't support caching silently ignore this. The
  // Anthropic gateway additionally refuses to attach cache_control
  // below its 1024-token floor so the caller never gets a silent
  // no-op.
  cacheSystem?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  // Repurposed 1.2.0+: micro-USD cost for this call. Retained column
  // name for SQLite back-compat; see db/schema.ts COST_COLUMN_SEMANTIC.
  neurons?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  latencyMs: number;
}

export interface CompletionResult {
  text: string;
  usage: Usage;
  model: string;
}

export interface ModelGateway {
  readonly name: string;
  complete(
    model: string,
    messages: Message[],
    opts?: CompleteOptionsExt,
  ): Promise<CompletionResult>;
}

export { WorkersAIGateway } from "./workers-ai.js";
