// HybridGateway: dispatches by model ID prefix during the v1.2.0
// migration. Anthropic model IDs start with "claude-"; Cloudflare
// Workers AI model IDs start with "@cf/". This lets ported stages
// (claude-) coexist with stages that still call Workers AI (@cf/)
// in the same audit until every stage is ported.
//
// Once C14 deletes the workers-ai gateway, this module goes too —
// audit.ts will construct AnthropicGateway directly.

import type { CompleteOptionsExt, CompletionResult, Message, ModelGateway } from "./index.js";

export interface HybridGatewayConfig {
  anthropic?: ModelGateway | null;
  workersAI?: ModelGateway | null;
  // Explicit for the transition so a caller that set up both
  // gateways can still force one. In practice left undefined.
  defaultTo?: "anthropic" | "workers-ai";
}

export class HybridGateway implements ModelGateway {
  readonly name = "hybrid";

  constructor(private readonly config: HybridGatewayConfig) {}

  async complete(
    model: string,
    messages: Message[],
    opts: CompleteOptionsExt = {},
  ): Promise<CompletionResult> {
    const route = pickRoute(model, this.config.defaultTo);
    if (route === "anthropic") {
      if (!this.config.anthropic) {
        throw new Error(
          `HybridGateway: model "${model}" routes to Anthropic but no Anthropic gateway is configured. Set ANTHROPIC_API_KEY or run \`tpm config set anthropic-key <key>\`.`,
        );
      }
      return this.config.anthropic.complete(model, messages, opts);
    }
    if (!this.config.workersAI) {
      throw new Error(
        `HybridGateway: model "${model}" routes to Workers AI but no Workers AI gateway is configured.`,
      );
    }
    return this.config.workersAI.complete(model, messages, opts);
  }
}

export function pickRoute(
  model: string,
  defaultTo: "anthropic" | "workers-ai" = "workers-ai",
): "anthropic" | "workers-ai" {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("@cf/")) return "workers-ai";
  return defaultTo;
}
