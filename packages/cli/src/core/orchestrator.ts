import type { Logger } from "./logger.js";
import type { ModelGateway } from "../gateway/index.js";

export interface OrchestratorDeps {
  logger: Logger;
  gateway: ModelGateway;
  sessionId: string;
}

// Stage-by-stage audit orchestration. M7-M12 fill in real stage dispatch.
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async runAudit(target: string): Promise<never> {
    this.deps.logger.info({ target }, "audit requested");
    throw new Error(
      "audit pipeline not wired yet — Stage A lands in M7 (intent extraction). This is an M2 scaffold.",
    );
  }
}
