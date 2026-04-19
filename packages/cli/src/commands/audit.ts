import type { Command } from "commander";
import { Orchestrator } from "../core/orchestrator.js";
import { WorkersAIGateway } from "../gateway/workers-ai.js";
import { DirectWorkersAIGateway } from "../gateway/direct-workers-ai.js";
import type { ModelGateway } from "../gateway/index.js";
import { loadConfig } from "../core/config.js";
import { loadProjectConfig } from "../core/project-config.js";
import { bootstrap, emit, emitText } from "./_runtime.js";
import * as path from "node:path";

export function register(program: Command): void {
  program
    .command("audit")
    .description(
      "Audit the current project. TPM reads your codebase and reconstructs intent + imagined user journey from source alone — no browser, no network to your product.",
    )
    .option(
      "--step-budget <n>",
      "Per-persona step budget for imagined paths (default 25)",
      (v: string) => Number(v),
    )
    .option(
      "--top <n>",
      "Number of top problems to produce solutions for (default 5)",
      (v: string) => Number(v),
    )
    .option("--no-pdf", "Skip PDF rendering in Stage F")
    .option("--no-sync", "Don't sync audit artifacts to backend")
    .option("--endpoint <url>", "Override the hosted backend URL (defaults to config.api_endpoint)")
    .option("--gateway <mode>", "Force gateway mode: hosted | byo (defaults to config.gateway)")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const opts = this.opts<{
        stepBudget?: number;
        top?: number;
        pdf?: boolean;
        sync?: boolean;
        endpoint?: string;
        gateway?: "hosted" | "byo";
      }>();

      const projectRoot = process.cwd();
      const projectCfg = loadProjectConfig(projectRoot);
      if (!projectCfg) {
        emitText(runtime, "No .tpm/ in this directory. Run:  tpm init");
        emit(runtime, { ok: false, error: "not initialized" });
        process.exitCode = 1;
        return;
      }

      const cfg = loadConfig();
      const endpoint = opts.endpoint ?? cfg.api_endpoint;
      const gatewayMode = opts.gateway ?? cfg.gateway;

      let gateway: ModelGateway;
      let apiEndpointForOrchestrator: string | undefined;
      if (gatewayMode === "byo") {
        if (!cfg.byo.account_id || !cfg.byo.api_token) {
          emitText(
            runtime,
            "BYO gateway requires both byo.account_id and byo.api_token. Run `tpm self-host` for setup.",
          );
          emit(runtime, { ok: false, error: "byo credentials missing" });
          process.exitCode = 1;
          return;
        }
        gateway = new DirectWorkersAIGateway({
          accountId: cfg.byo.account_id,
          apiToken: cfg.byo.api_token,
        });
        apiEndpointForOrchestrator = undefined;
      } else {
        gateway = new WorkersAIGateway({ endpoint });
        apiEndpointForOrchestrator = endpoint;
      }

      const orchestrator = new Orchestrator({
        logger: runtime.logger,
        gateway,
        sessionId: runtime.sessionId,
        ...(apiEndpointForOrchestrator ? { apiEndpoint: apiEndpointForOrchestrator } : {}),
      });

      emitText(runtime, `Codebase: ${projectRoot}`);
      emitText(runtime, `Gateway: ${gatewayMode}\n`);

      try {
        const res = await orchestrator.runAudit({
          projectRoot,
          ...(opts.stepBudget !== undefined ? { stepBudget: opts.stepBudget } : {}),
          ...(opts.top !== undefined ? { topNSolutions: opts.top } : {}),
          renderPdf: opts.pdf !== false,
          skipSync: opts.sync === false || gatewayMode === "byo",
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
          codebase: projectRoot,
          gateway: gatewayMode,
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
