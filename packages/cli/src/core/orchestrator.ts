import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Logger } from "./logger.js";
import type { ModelGateway } from "../gateway/index.js";
import { projectPaths } from "./paths.js";
import { openDatabase } from "../db/init.js";
import yaml from "js-yaml";
import { buildStaticMap, writeMapYaml } from "../stages/a-intent/static-map.js";
import { scrapeMarketingSurfaces } from "../stages/a-intent/scraper.js";
import { runStageA } from "../stages/a-intent/stage-a.js";
import type { Scraped as ScrapedNs } from "@tpm/shared";
import { runStageB } from "../stages/b-navigate/stage-b.js";
import { runStageC } from "../stages/c-delta/stage-c.js";
import { runStageD } from "../stages/d-leverage/stage-d.js";
import { runStageE } from "../stages/e-solutions/stage-e.js";
import { runStageF } from "../stages/f-assembly/stage-f.js";
import { loadBuiltInPatterns, summarizePatternLibrary } from "../patterns/loader.js";
import { withProgress, withStageProgress, wrapGatewayForProgress } from "./progress.js";
import { TPM_VERSION } from "@tpm/shared";

export interface OrchestratorDeps {
  logger: Logger;
  gateway: ModelGateway;
  sessionId: string;
}

export interface OrchestratorOptions {
  projectRoot?: string;
  marketingUrl?: string;
  stepBudget?: number;
  topNSolutions?: number;
  renderPdf?: boolean;
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

  async runAudit(opts: OrchestratorOptions = {}): Promise<AuditRunResult> {
    const started = Date.now();
    const auditId = uuidv4();
    const projectRoot = opts.projectRoot ?? process.cwd();

    const paths = projectPaths(projectRoot);
    const artifactsDir = path.join(paths.artifactsDir, auditId);
    fs.mkdirSync(artifactsDir, { recursive: true });

    const log = this.deps.logger;
    log.info(
      { audit_id: auditId, project: projectRoot, session_id: this.deps.sessionId },
      "audit started",
    );

    fs.mkdirSync(paths.root, { recursive: true });
    const db = openDatabase(paths.dbFile);
    db.prepare(
      `INSERT INTO audits (id, session_id, project_path, target, started_at, status, tpm_version)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    ).run(
      auditId,
      this.deps.sessionId,
      projectRoot,
      projectRoot,
      new Date().toISOString(),
      TPM_VERSION,
    );
    db.close();

    const stages: AuditRunResult["stages"] = {};
    let totalNeurons = 0;

    try {
      const map = await withStageProgress(
        { sequence: [1, 7], humanName: "Reading your codebase" },
        async () => {
          const m = buildStaticMap(projectRoot);
          writeMapYaml(m, path.join(artifactsDir, "map.yaml"));
          return m;
        },
      );

      let scraped: ScrapedNs.ScrapedSurfaces | undefined;
      if (opts.marketingUrl) {
        try {
          scraped = await withProgress(
            `Fetching marketing surfaces (${opts.marketingUrl})`,
            async () => {
              const s = await scrapeMarketingSurfaces(opts.marketingUrl!, { maxPages: 8 });
              fs.writeFileSync(
                path.join(artifactsDir, "scraped-surfaces.yaml"),
                yaml.dump(s, { noRefs: true, lineWidth: 120 }),
              );
              return s;
            },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(
            { url: opts.marketingUrl, err: msg },
            "marketing scrape failed — proceeding code-only",
          );
        }
      }

      const stageAInput: { map: typeof map; scraped?: ScrapedNs.ScrapedSurfaces } = { map };
      if (scraped !== undefined) stageAInput.scraped = scraped;
      const a = await withStageProgress(
        {
          sequence: [2, 7],
          humanName: "Understanding what your product claims to do",
        },
        (ctx) =>
          runStageA(stageAInput, {
            gateway: wrapGatewayForProgress(this.deps.gateway, ctx),
            logger: log,
            auditId,
            sessionId: this.deps.sessionId,
            artifactsDir,
          }),
      );
      stages.A = { status: "ok", neurons: a.neurons };
      totalNeurons += a.neurons;

      // Stage B groups classify → model → walk. One progress line
      // aggregates tokens/cost across all three sub-calls. Internal
      // sub-stage progress (e.g., "persona 2 of 3" during B-walk)
      // is a follow-up; for now the human name covers the whole
      // structure-mapping phase.
      const b = await withStageProgress(
        {
          sequence: [3, 7],
          humanName: "Mapping your app's structure",
        },
        (ctx) =>
          runStageB(a.leanCanvas, {
            gateway: wrapGatewayForProgress(this.deps.gateway, ctx),
            logger: log,
            auditId,
            sessionId: this.deps.sessionId,
            artifactsDir,
            projectRoot,
            ...(opts.stepBudget !== undefined ? { stepBudget: opts.stepBudget } : {}),
          }),
      );
      stages.B = { status: "ok", neurons: b.neurons };
      totalNeurons += b.neurons;

      const patterns = loadBuiltInPatterns();
      const patternLibrarySummary = summarizePatternLibrary(patterns);
      const c = await withStageProgress(
        {
          sequence: [4, 7],
          humanName: "Comparing what you claim vs what users experience",
        },
        (ctx) =>
          runStageC(
            { leanCanvas: a.leanCanvas, paths: b.paths },
            {
              gateway: wrapGatewayForProgress(this.deps.gateway, ctx),
              logger: log,
              auditId,
              sessionId: this.deps.sessionId,
              artifactsDir,
              patternLibrarySummary,
            },
          ),
      );
      stages.C = { status: "ok", neurons: c.neurons };
      totalNeurons += c.neurons;

      const d = await withStageProgress(
        {
          sequence: [5, 7],
          humanName: "Ranking problems by leverage",
        },
        (ctx) =>
          runStageD(c.delta, {
            gateway: wrapGatewayForProgress(this.deps.gateway, ctx),
            logger: log,
            auditId,
            sessionId: this.deps.sessionId,
            artifactsDir,
          }),
      );
      stages.D = { status: "ok", neurons: d.neurons };
      totalNeurons += d.neurons;

      const e = await withStageProgress(
        {
          sequence: [6, 7],
          humanName: "Writing solution specs + prototypes",
        },
        (ctx) =>
          runStageE(
            { problems: d.problems, delta: c.delta },
            {
              gateway: wrapGatewayForProgress(this.deps.gateway, ctx),
              logger: log,
              auditId,
              sessionId: this.deps.sessionId,
              artifactsDir,
              ...(opts.topNSolutions !== undefined ? { topN: opts.topNSolutions } : {}),
              progressCtx: ctx,
            },
          ),
      );
      stages.E = { status: "ok", neurons: e.neurons };
      totalNeurons += e.neurons;

      const f = await withStageProgress(
        {
          sequence: [7, 7],
          humanName: "Writing your audit report",
          slowNote: "this is the longest stage, ~90s typical",
        },
        (ctx) =>
          runStageF(
            {
              leanCanvas: a.leanCanvas,
              paths: b.paths,
              delta: c.delta,
              problems: d.problems,
              solutions: e.solutions,
            },
            {
              gateway: wrapGatewayForProgress(this.deps.gateway, ctx),
              logger: log,
              auditId,
              sessionId: this.deps.sessionId,
              artifactsDir,
              ...(opts.renderPdf !== undefined ? { renderPdf: opts.renderPdf } : {}),
            },
          ),
      );
      stages.F = { status: "ok", neurons: f.neurons };
      totalNeurons += f.neurons;

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
