import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import yaml from "js-yaml";
import type { Logger } from "./logger.js";
import type { ModelGateway } from "../gateway/index.js";
import { QuotaClient, formatUpgradeMessage } from "../billing/quota.js";
import { AuditSync } from "../sync/audits.js";
import { projectPaths } from "./paths.js";
import { openDatabase } from "../db/init.js";
import { buildStaticMap, writeMapYaml } from "../stages/a-intent/static-map.js";
import { scrapeMarketingSurfaces } from "../stages/a-intent/scraper.js";
import { runStageA } from "../stages/a-intent/stage-a.js";
import { createPlaywrightFactory } from "../stages/b-navigate/browser.js";
import { runStageB } from "../stages/b-navigate/stage-b.js";
import { runStageC } from "../stages/c-delta/stage-c.js";
import { runStageD } from "../stages/d-leverage/stage-d.js";
import { runStageE } from "../stages/e-solutions/stage-e.js";
import { runStageF } from "../stages/f-assembly/stage-f.js";
import { loadBuiltInPatterns, summarizePatternLibrary } from "../patterns/loader.js";
import { TPM_VERSION } from "@tpm/shared";

export interface OrchestratorDeps {
  logger: Logger;
  gateway: ModelGateway;
  sessionId: string;
  apiEndpoint?: string;
}

export interface OrchestratorOptions {
  target: string; // URL or local path
  projectRoot?: string;
  stepBudget?: number;
  topNSolutions?: number;
  renderPdf?: boolean;
  skipSync?: boolean;
}

export interface AuditRunResult {
  auditId: string;
  artifactsDir: string;
  stages: Record<string, { status: "ok" | "failed"; neurons: number; error?: string }>;
  totalNeurons: number;
  durationMs: number;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async runAudit(opts: OrchestratorOptions): Promise<AuditRunResult> {
    const started = Date.now();
    const auditId = uuidv4();
    const projectRoot = opts.projectRoot ?? process.cwd();
    const isUrl = /^https?:\/\//.test(opts.target);

    const paths = projectPaths(projectRoot);
    const artifactsDir = path.join(paths.artifactsDir, auditId);
    fs.mkdirSync(artifactsDir, { recursive: true });

    const log = this.deps.logger;
    log.info(
      { audit_id: auditId, target: opts.target, session_id: this.deps.sessionId },
      "audit started",
    );

    // Register audit in local SQLite
    fs.mkdirSync(paths.root, { recursive: true });
    const db = openDatabase(paths.dbFile);
    db.prepare(
      `INSERT INTO audits (id, session_id, project_path, target, started_at, status, tpm_version)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    ).run(
      auditId,
      this.deps.sessionId,
      projectRoot,
      opts.target,
      new Date().toISOString(),
      TPM_VERSION,
    );
    db.close();

    // Quota pre-flight (best-effort; skip if not configured).
    if (this.deps.apiEndpoint && !opts.skipSync) {
      try {
        const quota = new QuotaClient({ endpoint: this.deps.apiEndpoint });
        const status = await quota.check();
        if (!status.allowances.full_audit) {
          log.warn({ tier: status.tier, usage: status.usage }, "quota exhausted");
          process.stderr.write(formatUpgradeMessage(status) + "\n");
          throw new Error("quota exhausted — run `tpm upgrade`");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/quota exhausted/.test(msg)) throw err;
        log.warn({ err: msg }, "quota pre-flight failed (continuing)");
      }
    }

    // Backend audit create (Pro/Team; free returns 403 silently)
    const sync =
      this.deps.apiEndpoint && !opts.skipSync
        ? new AuditSync({ endpoint: this.deps.apiEndpoint })
        : null;
    if (sync) {
      try {
        await sync.createAudit({
          auditId,
          target: opts.target,
          tpmVersion: TPM_VERSION,
          sessionId: this.deps.sessionId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg }, "backend audit create failed (continuing locally)");
      }
    }

    const stages: AuditRunResult["stages"] = {};
    let totalNeurons = 0;
    const costPerStage: Record<string, number> = {};

    try {
      // --- Stage A inputs: static map + scraped surfaces ---
      log.info({ stage: "A-prep" }, "building static map");
      const mapTarget = isUrl ? projectRoot : opts.target;
      const map = buildStaticMap(mapTarget);
      writeMapYaml(map, path.join(artifactsDir, "map.yaml"));

      log.info({ stage: "A-prep" }, "scraping marketing surfaces");
      const scraped = isUrl
        ? await scrapeMarketingSurfaces(opts.target)
        : {
            schema_version: 1 as const,
            start_url: "(none)",
            scraped_at: new Date().toISOString(),
            surfaces: [],
          };
      fs.writeFileSync(
        path.join(artifactsDir, "scraped-surfaces.yaml"),
        yaml.dump(scraped, { noRefs: true, lineWidth: 120 }),
      );

      // --- Stage A ---
      const a = await runStageA(
        { map, scraped },
        {
          gateway: this.deps.gateway,
          logger: log,
          auditId,
          sessionId: this.deps.sessionId,
          artifactsDir,
        },
      );
      stages.A = { status: "ok", neurons: a.neurons };
      costPerStage.A = a.neurons;
      totalNeurons += a.neurons;

      // --- Stage B: navigator (only when target is a URL) ---
      if (isUrl) {
        const browserFactory = await createPlaywrightFactory({ headless: true });
        try {
          const b = await runStageB(a.leanCanvas, {
            gateway: this.deps.gateway,
            logger: log,
            auditId,
            sessionId: this.deps.sessionId,
            artifactsDir,
            browserFactory,
            entryPoint: opts.target,
            ...(opts.stepBudget !== undefined ? { stepBudget: opts.stepBudget } : {}),
          });
          // Neurons attributed via /infer logging server-side; we don't re-count here.
          stages.B = { status: "ok", neurons: 0 };
          costPerStage.B = 0;

          // --- Stage C ---
          const patterns = loadBuiltInPatterns();
          const patternLibrarySummary = summarizePatternLibrary(patterns);
          const c = await runStageC(
            { leanCanvas: a.leanCanvas, paths: b.paths },
            {
              gateway: this.deps.gateway,
              logger: log,
              auditId,
              sessionId: this.deps.sessionId,
              artifactsDir,
              patternLibrarySummary,
            },
          );
          stages.C = { status: "ok", neurons: c.neurons };
          costPerStage.C = c.neurons;
          totalNeurons += c.neurons;

          // --- Stage D ---
          const d = await runStageD(c.delta, {
            gateway: this.deps.gateway,
            logger: log,
            auditId,
            sessionId: this.deps.sessionId,
            artifactsDir,
          });
          stages.D = { status: "ok", neurons: d.neurons };
          costPerStage.D = d.neurons;
          totalNeurons += d.neurons;

          // --- Stage E ---
          const e = await runStageE(
            { problems: d.problems, delta: c.delta },
            {
              gateway: this.deps.gateway,
              logger: log,
              auditId,
              sessionId: this.deps.sessionId,
              artifactsDir,
              ...(opts.topNSolutions !== undefined ? { topN: opts.topNSolutions } : {}),
            },
          );
          stages.E = { status: "ok", neurons: e.neurons };
          costPerStage.E = e.neurons;
          totalNeurons += e.neurons;

          // --- Stage F ---
          const f = await runStageF(
            {
              leanCanvas: a.leanCanvas,
              paths: b.paths,
              delta: c.delta,
              problems: d.problems,
              solutions: e.solutions,
            },
            {
              gateway: this.deps.gateway,
              logger: log,
              auditId,
              sessionId: this.deps.sessionId,
              artifactsDir,
              ...(opts.renderPdf !== undefined ? { renderPdf: opts.renderPdf } : {}),
            },
          );
          stages.F = { status: "ok", neurons: f.neurons };
          costPerStage.F = f.neurons;
          totalNeurons += f.neurons;
        } finally {
          // Browser close is handled inside stage-b; nothing to do here.
        }
      } else {
        log.info(
          { target: opts.target },
          "local-path target: skipping Stages B-F (navigator requires a URL)",
        );
        stages.B = { status: "failed", neurons: 0, error: "target is a local path" };
      }

      if (sync) {
        try {
          await sync.uploadArtifacts(auditId, artifactsDir);
          await sync.finishAudit({
            auditId,
            status: "succeeded",
            totalNeurons,
            costPerStage,
          });
        } catch (err) {
          log.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "sync on finish failed",
          );
        }
      }

      // Finish local row
      const db2 = openDatabase(paths.dbFile);
      db2
        .prepare(`UPDATE audits SET ended_at = ?, status = ?, total_neurons = ? WHERE id = ?`)
        .run(new Date().toISOString(), "succeeded", totalNeurons, auditId);
      db2.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "audit failed");
      const db2 = openDatabase(paths.dbFile);
      db2
        .prepare(`UPDATE audits SET ended_at = ?, status = ?, notes = ? WHERE id = ?`)
        .run(new Date().toISOString(), "failed", msg.slice(0, 500), auditId);
      db2.close();
      if (sync) {
        await sync.finishAudit({ auditId, status: "failed", totalNeurons }).catch(() => {});
      }
      throw err;
    }

    const durationMs = Date.now() - started;
    log.info(
      { audit_id: auditId, totalNeurons, durationMs, stages: Object.keys(stages) },
      "audit complete",
    );
    return { auditId, artifactsDir, stages, totalNeurons, durationMs };
  }
}
