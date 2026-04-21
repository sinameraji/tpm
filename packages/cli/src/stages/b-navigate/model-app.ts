// B-model: produce a verifiable structural model of the app.
//
// v1.2.0 collapsed the previous Modeler A + Modeler B + Synthesizer
// ensemble to a single call. The ensemble was a compensation for
// running across incompatible Workers-AI model families; on Claude
// (Sonnet fast / Opus deep) one well-prompted call produces the
// same output with less latency, less cost, and strictly less
// surface area for things to go wrong.
//
// Every semantic check the ensemble used as a guardrail is
// preserved verbatim below — that's the load-bearing quality
// machinery, not the ensemble itself.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { AppModelSchema, type AppModel } from "@pm/shared/schemas/app-model";
import type { ProjectProfile } from "@pm/shared/schemas/project-profile";
import type { Logger } from "../../core/logger.js";
import type { ModelGateway } from "../../gateway/index.js";
import { runStage, jsonParse, zodValidate, type StageSpec } from "../_lib/stage-runner.js";
import type { ValidationResult } from "../_lib/validators.js";
import type { RequestedFile } from "./classify-project-prompt.js";
import { MODEL_APP_SYSTEM_PROMPT, buildModelAppUserPrompt } from "./model-app-prompts.js";

export const MODEL_APP_MODEL = "claude-sonnet-4-6";
const MODEL_APP_MAX_TOKENS = 6_000;

export interface ModelAppDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
}

export interface ModelAppInput {
  profile: ProjectProfile;
  seedFiles: RequestedFile[];
  leanCanvasIntent: string;
}

export interface ModelAppResult {
  appModel: AppModel;
  appModelPath: string;
  neurons: number;
}

// Structural + referential-integrity rules on the AppModel output.
// These are the full set from the ensemble era — keeping them here
// is the whole point of the collapse (guardrails, not ensemble).
function appModelSemanticCheck(seedPaths: Set<string>, profile: ProjectProfile) {
  return (out: AppModel): ValidationResult => {
    const violations: string[] = [];
    const screenIds = new Set(out.screens.map((s) => s.id));
    const wallIds = new Set(out.walls.map((w) => w.id));

    // Referential integrity ---------------------------------------
    for (const t of out.navigation_graph) {
      if (t.to_screen !== null && !t.is_external && !screenIds.has(t.to_screen)) {
        violations.push(`transition ${t.id} references unknown to_screen "${t.to_screen}"`);
      }
    }
    for (const w of out.walls) {
      if (
        w.redirect_on_success !== null &&
        screenIds.size > 0 &&
        !screenIds.has(w.redirect_on_success)
      ) {
        violations.push(
          `wall ${w.id} redirect_on_success "${w.redirect_on_success}" not found in screens`,
        );
      }
    }
    for (const s of out.screens) {
      for (const wid of s.gated_by_walls) {
        if (!wallIds.has(wid)) {
          violations.push(`screen ${s.id} gated_by_walls contains unknown wall_id "${wid}"`);
        }
      }
      for (const ve of s.visible_elements) {
        if (ve.action?.target_screen_id && !screenIds.has(ve.action.target_screen_id)) {
          violations.push(
            `screen ${s.id} has visible_element action targeting unknown screen_id "${ve.action.target_screen_id}"`,
          );
        }
      }
    }

    // Seed-file containment: every cited file must come from the
    // seed set. This is the anti-hallucination guardrail.
    for (const p of [
      ...out.entry_points.map((e) => e.file_path),
      ...out.walls.map((w) => w.file_path),
      ...out.screens.map((s) => s.file_path),
      ...out.navigation_graph.map((t) => t.handler_file).filter((x): x is string => !!x),
    ]) {
      if (!seedPaths.has(p)) {
        violations.push(`file_path "${p}" not in seed_files`);
      }
    }
    if (out.screens.length === 0 && out.navigation_graph.length > 0) {
      violations.push("screens is empty but navigation_graph is non-empty — inconsistent");
    }

    // Profile coverage: the chosen entry_points must cover at least
    // one candidate entry_point from the profile, else the model
    // decided the classifier's work doesn't apply — almost always
    // wrong.
    const profileEntries = new Set(profile.candidate_entry_points.map((c) => c.file_path));
    const chosenEntries = new Set(out.entry_points.map((e) => e.file_path));
    if (profileEntries.size > 0) {
      const covered = [...profileEntries].some((p) => chosenEntries.has(p));
      if (!covered) {
        violations.push(
          `entry_points ignored every profile.candidate_entry_points (${[...profileEntries].join(", ")})`,
        );
      }
    }

    return { ok: violations.length === 0, violations };
  };
}

export async function runBModel(input: ModelAppInput, deps: ModelAppDeps): Promise<ModelAppResult> {
  deps.logger.info(
    {
      stage: "B",
      sub: "model",
      seed_files: input.seedFiles.length,
      confidence: input.profile.confidence,
    },
    "B-model starting (single call)",
  );

  const seedPaths = new Set(input.seedFiles.map((f) => f.path));
  const userPrompt = buildModelAppUserPrompt({
    auditId: deps.auditId,
    profile: input.profile,
    seedFiles: input.seedFiles,
    leanCanvasIntent: input.leanCanvasIntent,
  });
  const spec: StageSpec<AppModel> = {
    name: "B",
    label: "Stage B · modeling app",
    model: MODEL_APP_MODEL,
    maxTokens: MODEL_APP_MAX_TOKENS,
    temperature: 0.1,
    responseFormat: "json",
    systemPrompt: MODEL_APP_SYSTEM_PROMPT,
    userPrompt,
    parse: jsonParse,
    validate: zodValidate(AppModelSchema),
    semanticCheck: appModelSemanticCheck(seedPaths, input.profile),
    cacheSystem: true,
  };
  const result = await runStage<AppModel>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  const appModel = result.output;

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const appModelPath = path.join(deps.artifactsDir, "app-model.yaml");
  fs.writeFileSync(appModelPath, yaml.dump(appModel, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(
    path.join(deps.artifactsDir, "app-model.json"),
    JSON.stringify(appModel, null, 2),
  );

  deps.logger.info(
    {
      stage: "B",
      sub: "model",
      neurons: result.totalNeurons,
      screens: appModel.screens.length,
      walls: appModel.walls.length,
      transitions: appModel.navigation_graph.length,
    },
    "B-model complete",
  );

  return {
    appModel,
    appModelPath,
    neurons: result.totalNeurons,
  };
}
