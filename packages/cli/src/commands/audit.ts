import type { Command } from "commander";
import { Orchestrator } from "../core/orchestrator.js";
import { WorkersAIGateway } from "../gateway/workers-ai.js";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  program
    .command("audit")
    .description("Run a full six-stage audit against a target (URL or local project).")
    .argument("[target]", "URL or local path to audit", ".")
    .option("--resume-from <stage>", "Resume from stage A|B|C|D|E|F against prior artifacts.")
    .action(async function action(this: Command, target: string) {
      const runtime = bootstrap(this);
      const gateway = new WorkersAIGateway({ endpoint: "https://api.usetpm.dev/infer" });
      const orchestrator = new Orchestrator({
        logger: runtime.logger,
        gateway,
        sessionId: runtime.sessionId,
      });

      try {
        await orchestrator.runAudit(target);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        runtime.logger.warn({ stage: "dispatch", reason: msg }, "audit skeleton");
        emitText(runtime, `audit: ${msg}`);
        emitText(runtime, "This is expected in M2 — pipeline wires in at M4+.");
        emit(runtime, {
          ok: false,
          stage: "dispatch",
          skeleton: true,
          message: msg,
          session_id: runtime.sessionId,
        });
        process.exitCode = 2;
      }
    });
}
