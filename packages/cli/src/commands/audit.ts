import type { Command } from "commander";
import { Orchestrator } from "../core/orchestrator.js";
import { WorkersAIGateway } from "../gateway/workers-ai.js";
import { DirectWorkersAIGateway } from "../gateway/direct-workers-ai.js";
import { AnthropicGateway } from "../gateway/anthropic.js";
import { HybridGateway } from "../gateway/hybrid.js";
import type { ModelGateway } from "../gateway/index.js";
import { loadConfig, resolveAnthropicKey } from "../core/config.js";
import { loadProjectConfig, saveProjectConfig } from "../core/project-config.js";
import { isValidHttpUrl, promptLine } from "../core/prompt.js";
import { bootstrap, emit, emitText } from "./_runtime.js";
import * as path from "node:path";

export function register(program: Command): void {
  program
    .command("audit")
    .description(
      "Audit the current project. TPM reads your codebase (primary source of truth) and optionally your public marketing URL (auxiliary context) to reconstruct intent and imagine the user journey.",
    )
    .option(
      "--marketing-url <url>",
      "Your product's public marketing URL. Auxiliary — helps TPM understand positioning. Remembered for subsequent runs.",
    )
    .option(
      "--no-marketing",
      "Skip the marketing URL entirely (and don't prompt). Code-only audit.",
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
        marketingUrl?: string;
        marketing?: boolean; // --no-marketing → false
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
      // Transitional: audit.ts still runs the v1.1.x workers-ai path.
      // v1.2.0 config dropped gateway/api_endpoint/byo as top-level
      // keys — they're only read from the `legacy` block for
      // backward-compat. The full gateway-selection rewrite lands
      // with the Stage A Anthropic port in C5+.
      const LEGACY_DEFAULT_ENDPOINT = "https://tpm-api.sina-b35.workers.dev";
      const endpoint = opts.endpoint ?? cfg.legacy?.api_endpoint ?? LEGACY_DEFAULT_ENDPOINT;
      const legacyGateway = cfg.legacy?.gateway === "byo" ? "byo" : "hosted";
      const gatewayMode = opts.gateway ?? legacyGateway;

      // Marketing URL resolution: flag → project config → interactive prompt (TTY only) → none.
      let marketingUrl: string | undefined;
      if (opts.marketing === false) {
        marketingUrl = undefined;
      } else if (opts.marketingUrl) {
        if (!isValidHttpUrl(opts.marketingUrl)) {
          emitText(runtime, `invalid --marketing-url: ${opts.marketingUrl}`);
          emit(runtime, { ok: false, error: "invalid marketing url" });
          process.exitCode = 1;
          return;
        }
        marketingUrl = opts.marketingUrl;
      } else if (projectCfg.marketing_url) {
        marketingUrl = projectCfg.marketing_url;
      } else if (!runtime.isJson) {
        emitText(
          runtime,
          "[Step 1/2] Code analysis — TPM reads your repo (primary source of truth).",
        );
        const answer = await promptLine(
          "[Step 2/2] Optionally, paste your product's public marketing URL (landing page).\n  This is auxiliary — it helps TPM understand your positioning.\n  Press Enter to skip:\n  > ",
        );
        if (answer && isValidHttpUrl(answer)) {
          marketingUrl = answer;
        } else if (answer) {
          emitText(runtime, `(not a valid URL, skipping: ${answer})`);
        }
      }

      // Persist the URL so subsequent audits don't re-prompt.
      if (marketingUrl && marketingUrl !== projectCfg.marketing_url) {
        saveProjectConfig({ ...projectCfg, marketing_url: marketingUrl }, projectRoot);
      }

      // Gateway selection during the v1.2.0 migration:
      //   - Workers AI (hosted or BYO) carries stages that still use
      //     "@cf/..." model IDs.
      //   - AnthropicGateway carries stages that have been ported to
      //     "claude-..." model IDs (starting with Stage A in C5).
      //   - HybridGateway dispatches per call by model-ID prefix.
      // Once every stage is on Anthropic (after C11) and the
      // workers-ai gateway is deleted (C14), audit.ts constructs
      // AnthropicGateway directly.
      const anthropicKey = resolveAnthropicKey(cfg);
      const anthropicGateway = anthropicKey ? new AnthropicGateway({ apiKey: anthropicKey }) : null;

      let workersAIGateway: ModelGateway | null;
      let apiEndpointForOrchestrator: string | undefined;
      if (gatewayMode === "byo") {
        const byoAcct = cfg.legacy?.byo?.account_id;
        const byoTok = cfg.legacy?.byo?.api_token;
        if (!byoAcct || !byoTok) {
          emitText(
            runtime,
            "BYO gateway requires both byo.account_id and byo.api_token. Run `tpm self-host` for setup.",
          );
          emit(runtime, { ok: false, error: "byo credentials missing" });
          process.exitCode = 1;
          return;
        }
        workersAIGateway = new DirectWorkersAIGateway({
          accountId: byoAcct,
          apiToken: byoTok,
        });
        apiEndpointForOrchestrator = undefined;
      } else {
        workersAIGateway = new WorkersAIGateway({ endpoint });
        apiEndpointForOrchestrator = endpoint;
      }

      const gateway: ModelGateway = new HybridGateway({
        anthropic: anthropicGateway,
        workersAI: workersAIGateway,
      });

      const orchestrator = new Orchestrator({
        logger: runtime.logger,
        gateway,
        sessionId: runtime.sessionId,
        ...(apiEndpointForOrchestrator ? { apiEndpoint: apiEndpointForOrchestrator } : {}),
      });

      emitText(runtime, `Codebase:       ${projectRoot}`);
      emitText(runtime, `Marketing URL:  ${marketingUrl ?? "(none — code-only)"}`);
      emitText(runtime, `Gateway:        ${gatewayMode}\n`);

      try {
        const res = await orchestrator.runAudit({
          projectRoot,
          ...(marketingUrl ? { marketingUrl } : {}),
          ...(opts.stepBudget !== undefined ? { stepBudget: opts.stepBudget } : {}),
          ...(opts.top !== undefined ? { topNSolutions: opts.top } : {}),
          renderPdf: opts.pdf !== false,
          skipSync: opts.sync === false || gatewayMode === "byo",
        });
        const artifactsAbs = path.resolve(res.artifactsDir);
        const specMd = path.join(artifactsAbs, "spec.md");
        const specHtml = path.join(artifactsAbs, "spec.html");
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        const mins = Math.floor(res.durationMs / 60_000);
        const secs = Math.round((res.durationMs % 60_000) / 1000);
        const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        emitText(
          runtime,
          `\n✓ Audit complete (${durationStr}, ${res.totalNeurons.toFixed(0)} neurons)`,
        );
        emitText(runtime, `\n  Your report:`);
        emitText(runtime, `    ${specMd}`);
        emitText(runtime, `    ${openCmd} ${specHtml}`);
        emitText(runtime, `\n  All artifacts: ${artifactsAbs}/`);
        emitText(runtime, `  Audit id: ${res.auditId}`);
        emitText(
          runtime,
          `\n  Note: .tpm/ is a local cache and is gitignored — safe to leave uncommitted.`,
        );
        emitText(runtime, `  Re-open this audit later: tpm report ${res.auditId.slice(0, 8)}`);

        const statuses = Object.entries(res.stages)
          .map(
            ([s, v]) =>
              `  ${s}: ${v.status}${v.neurons ? ` (${v.neurons.toFixed(3)} neurons)` : ""}`,
          )
          .join("\n");
        emitText(runtime, `\nStages:\n${statuses}`);
        emit(runtime, {
          ok: true,
          audit_id: res.auditId,
          artifacts_dir: res.artifactsDir,
          codebase: projectRoot,
          marketing_url: marketingUrl ?? null,
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
