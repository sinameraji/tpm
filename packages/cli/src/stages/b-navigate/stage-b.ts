import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import { PathsSchema, type Paths, type PersonaPath } from "@tpm/shared/schemas/paths";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { BrowserFactory } from "./browser.js";
import { extractPersonaBriefing } from "./prompt.js";
import { NAVIGATOR_MODEL, runNavigatorForPersona } from "./navigator.js";

export interface StageBDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
  browserFactory: BrowserFactory;
  entryPoint: string;
  stepBudget?: number;
  testCredsNote?: string | null;
}

export interface StageBResult {
  paths: Paths;
  yamlPath: string;
}

export async function runStageB(canvas: LeanCanvas, deps: StageBDeps): Promise<StageBResult> {
  deps.logger.info({ stage: "B", audit_id: deps.auditId }, "stage B started");

  const personaPaths: PersonaPath[] = [];
  for (const jtbd of canvas.intended_jtbd_per_segment) {
    const briefing = extractPersonaBriefing(canvas, jtbd.segment_id);
    if (!briefing) {
      deps.logger.warn({ persona: jtbd.segment_id }, "missing value moment for persona — skipping");
      continue;
    }
    let page;
    try {
      page = await deps.browserFactory.launchPage(deps.entryPoint);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error({ persona: jtbd.segment_id, err: msg }, "could not launch page");
      personaPaths.push({
        persona: jtbd.segment_id,
        goal: briefing.job,
        value_moment_target: briefing.valueMoment,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        step_budget: deps.stepBudget ?? 25,
        steps_taken: 0,
        entry_point: deps.entryPoint,
        steps: [],
        outcome: {
          status: "error",
          loop_closed: false,
          value_moment_reached: false,
          time_to_value_ms: null,
          stuck_at_step: null,
          stuck_reason: `could not launch browser page: ${msg}`,
        },
      });
      continue;
    }

    try {
      const navOpts: Parameters<typeof runNavigatorForPersona>[1] = {
        gateway: deps.gateway,
        logger: deps.logger,
        auditId: deps.auditId,
        sessionId: deps.sessionId,
        entryPoint: deps.entryPoint,
        page,
      };
      if (deps.stepBudget !== undefined) navOpts.stepBudget = deps.stepBudget;
      if (deps.testCredsNote !== undefined) navOpts.testCredsNote = deps.testCredsNote;
      const result = await runNavigatorForPersona(
        { persona: jtbd.segment_id, ...briefing },
        navOpts,
      );
      personaPaths.push(result);
    } finally {
      await page.close().catch(() => {});
    }
  }

  const paths: Paths = {
    schema_version: 1,
    audit_id: deps.auditId,
    generated_at: new Date().toISOString(),
    model: NAVIGATOR_MODEL,
    paths: personaPaths,
  };
  const validated = PathsSchema.parse(paths);

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const yamlPath = path.join(deps.artifactsDir, "paths.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(validated, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(path.join(deps.artifactsDir, "paths.json"), JSON.stringify(validated, null, 2));

  deps.logger.info(
    { stage: "B", personas: personaPaths.length, yaml_path: yamlPath },
    "stage B complete",
  );
  return { paths: validated, yamlPath };
}
