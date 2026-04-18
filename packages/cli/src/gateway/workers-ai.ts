import type { CompletionOptions, CompletionResult, Message, ModelGateway } from "./index.js";

export interface WorkersAIGatewayConfig {
  endpoint: string;
  deviceJwt?: string;
}

export class WorkersAIGateway implements ModelGateway {
  readonly name = "workers-ai";

  constructor(private readonly config: WorkersAIGatewayConfig) {}

  async complete(
    _model: string,
    _messages: Message[],
    _opts?: CompletionOptions,
  ): Promise<CompletionResult> {
    throw new Error(
      `WorkersAIGateway not wired yet — M4 connects to ${this.config.endpoint}. ` +
        "Until then every stage is skeleton-only.",
    );
  }
}
