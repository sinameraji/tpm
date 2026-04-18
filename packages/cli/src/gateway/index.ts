export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  stream?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  neurons?: number;
  latencyMs: number;
}

export interface CompletionResult {
  text: string;
  usage: Usage;
  model: string;
}

export interface ModelGateway {
  readonly name: string;
  complete(model: string, messages: Message[], opts?: CompletionOptions): Promise<CompletionResult>;
}

export { WorkersAIGateway } from "./workers-ai.js";
