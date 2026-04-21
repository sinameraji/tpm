import type { Command } from "commander";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Orchestrator } from "../core/orchestrator.js";
import { AnthropicGateway } from "../gateway/anthropic.js";
import { detectLegacyConfig, loadConfig, resolveAnthropicKey } from "../core/config.js";
import { loadProjectConfig, saveProjectConfig } from "../core/project-config.js";
import { runKeyWizard } from "../core/init-wizard.js";
import { printCompletion, printPreFlight } from "../core/pre-flight.js";
import { isValidHttpUrl, promptLine } from "../core/prompt.js";
import { bootstrap, emit, emitText } from "./_runtime.js";

const LEGACY_TOKENS_PATH = path.join(os.homedir(), ".tpm", "tokens.json");

function cleanupLegacyTokensFile(): void {
  // v1.1.x stored a device-flow JWT bundle here for the Workers-AI
  // backend. v1.2.0 is BYO Anthropic — nothing reads it. Silently
  // remove on first successful 1.2.0 audit so stale credentials
  // don't linger on users' machines.
  try {
    if (fs.existsSync(LEGACY_TOKENS_PATH)) {
      fs.unlinkSync(LEGACY_TOKENS_PATH);
    }
  } catch {
    /* ignore; not worth surfacing */
  }
}

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
    .option(
      "--no-stream",
      "Disable streaming progress UI. Use in CI / non-TTY pipelines where cursor manipulation would garble output.",
    )
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const opts = this.opts<{
        marketingUrl?: string;
        marketing?: boolean; // --no-marketing → false
        stepBudget?: number;
        top?: number;
        pdf?: boolean;
        stream?: boolean; // --no-stream → false
      }>();

      // Plumb through an env var so the progress module (already
      // imported transitively) can honor the flag without threading
      // yet another option through every stage.
      if (opts.stream === false) process.env["TPM_NO_STREAM"] = "1";

      const projectRoot = process.cwd();
      const projectCfg = loadProjectConfig(projectRoot);
      if (!projectCfg) {
        emitText(runtime, "No .tpm/ in this directory. Run:  tpm init");
        emit(runtime, { ok: false, error: "not initialized" });
        process.exitCode = 1;
        return;
      }

      let cfg = loadConfig();

      // v1.1.x upgrade detection. Config on disk with `gateway`,
      // `api_endpoint`, or `byo.*` top-level keys means the user is
      // coming from v1.1.x. TTY: prompt to run init inline. Non-TTY
      // (CI/pipe): print the note, exit 0 with a pointer.
      if (detectLegacyConfig(cfg) && !resolveAnthropicKey(cfg)) {
        const hasTTY = process.stdin.isTTY && process.stdout.isTTY;
        emitText(
          runtime,
          "Cloudflare Workers AI support was removed in 1.2.0. TPM now uses your own Anthropic API key.",
        );
        if (hasTTY) {
          const ans = (await promptLine("Run tpm init now? [Y/n]: ")) ?? "y";
          if (ans.toLowerCase() === "n" || ans.toLowerCase() === "no") {
            emitText(runtime, "Run `tpm init` when you're ready. No changes made.");
            emit(runtime, { ok: false, error: "legacy config, user declined wizard" });
            return;
          }
          const wizardResult = await runKeyWizard({ allowReplace: true });
          if (!wizardResult || !resolveAnthropicKey(wizardResult.cfg)) {
            emitText(runtime, "Wizard didn't complete. Run `tpm init` to try again.");
            emit(runtime, { ok: false, error: "wizard did not set a key" });
            return;
          }
          cfg = wizardResult.cfg;
        } else {
          emitText(runtime, "Run `tpm init` to set your Anthropic key, then re-run `tpm audit`.");
          emit(runtime, { ok: false, error: "legacy config, non-interactive environment" });
          return;
        }
      }

      // No legacy config but also no key configured → first-run.
      if (!resolveAnthropicKey(cfg)) {
        const hasTTY = process.stdin.isTTY && process.stdout.isTTY;
        if (hasTTY) {
          const wizardResult = await runKeyWizard({ allowReplace: false });
          if (!wizardResult || !resolveAnthropicKey(wizardResult.cfg)) {
            emitText(runtime, "No Anthropic API key configured. Run `tpm init` to set one.");
            emit(runtime, { ok: false, error: "no anthropic key" });
            process.exitCode = 1;
            return;
          }
          cfg = wizardResult.cfg;
        } else {
          emitText(
            runtime,
            "No Anthropic API key configured. Run `tpm init` or set ANTHROPIC_API_KEY in the environment.",
          );
          emit(runtime, { ok: false, error: "no anthropic key" });
          process.exitCode = 1;
          return;
        }
      }

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

      // Pre-audit guards above have guaranteed an Anthropic key
      // exists (env, config, or wizard-set).
      const anthropicKey = resolveAnthropicKey(cfg)!;
      const gateway = new AnthropicGateway({ apiKey: anthropicKey });

      const orchestrator = new Orchestrator({
        logger: runtime.logger,
        gateway,
        sessionId: runtime.sessionId,
      });

      const artifactsOutputPath = path.join(".tpm", "artifacts", "<audit-id>", "spec.md");
      if (!runtime.isJson) {
        printPreFlight({
          repoName: path.basename(projectRoot),
          projectPath: projectRoot,
          marketingUrl: marketingUrl,
          tier: cfg.model_tier,
          outputPath: artifactsOutputPath,
        });
      }

      try {
        const res = await orchestrator.runAudit({
          projectRoot,
          ...(marketingUrl ? { marketingUrl } : {}),
          ...(opts.stepBudget !== undefined ? { stepBudget: opts.stepBudget } : {}),
          ...(opts.top !== undefined ? { topNSolutions: opts.top } : {}),
          renderPdf: opts.pdf !== false,
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

        cleanupLegacyTokensFile();

        // Counts for the completion block. Read the on-disk artifacts
        // (problems/solutions/prototypes) rather than wiring new
        // return values through every stage — the orchestrator
        // already persists them.
        const readCount = (rel: string, key: "problems" | "solutions"): number => {
          try {
            const raw = fs.readFileSync(path.join(artifactsAbs, rel), "utf8");
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const arr = parsed[key];
            return Array.isArray(arr) ? arr.length : 0;
          } catch {
            return 0;
          }
        };
        const problemCount = readCount("problems.json", "problems");
        const solutionCount = readCount("solutions.json", "solutions");
        const prototypeDir = path.join(artifactsAbs, "prototypes");
        const prototypeCount = fs.existsSync(prototypeDir)
          ? fs.readdirSync(prototypeDir).filter((f) => f.endsWith(".html")).length
          : 0;
        const specMdBytes = fs.existsSync(specMd) ? fs.statSync(specMd).size : null;

        if (!runtime.isJson) {
          printCompletion({
            elapsedMs: res.durationMs,
            totalMicroUsd: Math.round(res.totalNeurons),
            specMdPath: specMd,
            specHtmlPath: specHtml,
            specMdBytes,
            problemCount,
            solutionCount,
            prototypeCount,
            openCommand: openCmd,
          });
          emitText(runtime, `  Audit id: ${res.auditId}`);
          emitText(runtime, `  Re-open: tpm report ${res.auditId.slice(0, 8)}`);
        }

        emit(runtime, {
          ok: true,
          audit_id: res.auditId,
          artifacts_dir: res.artifactsDir,
          codebase: projectRoot,
          marketing_url: marketingUrl ?? null,
          gateway: "anthropic",
          total_micro_usd: Math.round(res.totalNeurons),
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
