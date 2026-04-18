import type { Command } from "commander";
import { Orchestrator } from "../core/orchestrator.js";
import { WorkersAIGateway } from "../gateway/workers-ai.js";
import { bootstrap, emit, emitText } from "./_runtime.js";
import * as path from "node:path";

const DEFAULT_ENDPOINT = process.env["TPM_API"] ?? "https://api.usetpm.dev";

export function register(program: Command): void {
  program
    .command("audit")
    .description("Run a full six-stage audit against a target (URL or local project).")
    .argument("[target]", "URL or local path to audit", ".")
    .option("--step-budget <n>", "Navigator step budget per persona", (v: string) => Number(v))
    .option(
      "--top <n>",
      "Number of top problems to produce solutions for (default 5)",
      (v: string) => Number(v),
    )
    .option("--no-pdf", "Skip PDF rendering in Stage F")
    .option("--no-sync", "Don't sync audit to backend (useful for offline runs)")
    .option("--endpoint <url>", "Backend base URL", DEFAULT_ENDPOINT)
    .action(async function action(this: Command, target: string) {
      const runtime = bootstrap(this);
      const opts = this.opts<{
        stepBudget?: number;
        top?: number;
        pdf?: boolean;
        sync?: boolean;
        endpoint: string;
      }>();

      const gateway = new WorkersAIGateway({ endpoint: opts.endpoint });
      const orchestrator = new Orchestrator({
        logger: runtime.logger,
        gateway,
        sessionId: runtime.sessionId,
        apiEndpoint: opts.endpoint,
      });

      try {
        const res = await orchestrator.runAudit({
          target,
          ...(opts.stepBudget !== undefined ? { stepBudget: opts.stepBudget } : {}),
          ...(opts.top !== undefined ? { topNSolutions: opts.top } : {}),
          renderPdf: opts.pdf !== false,
          skipSync: opts.sync === false,
        });
        emitText(runtime, `\nAudit complete: ${res.auditId}`);
        emitText(runtime, `Artifacts: ${path.relative(process.cwd(), res.artifactsDir)}`);
        emitText(runtime, `Total neurons: ${res.totalNeurons.toFixed(3)}`);
        emitText(runtime, `Duration: ${(res.durationMs / 1000).toFixed(1)}s`);
        const statuses = Object.entries(res.stages)
          .map(
            ([s, v]) =>
              `  ${s}: ${v.status}${v.neurons ? ` (${v.neurons.toFixed(3)} neurons)` : ""}`,
          )
          .join("\n");
        emitText(runtime, `Stages:\n${statuses}`);
        emit(runtime, {
          ok: true,
          audit_id: res.auditId,
          artifacts_dir: res.artifactsDir,
          total_neurons: res.totalNeurons,
          duration_ms: res.durationMs,
          stages: res.stages,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        runtime.logger.error({ err: msg }, "audit failed");
        emitText(runtime, `audit failed: ${msg}`);
        emit(runtime, { ok: false, error: msg, session_id: runtime.sessionId });
        process.exitCode = 1;
      }
    });
}
