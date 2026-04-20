// B-model orchestrator: fan out to two modelers, compute structural
// diff, run synthesizer on disputes, emit the consensus AppModel.
//
// Design rationale is in the plan: reality-understanding is the
// load-bearing step of TPM. Getting it wrong wastes every downstream
// stage. Two distinct models produce independent views; a synthesizer
// reconciles disagreements by reading the disputed file excerpts and
// citing evidence. Every non-trivial resolution is recorded in
// synthesis_notes for auditability.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import {
  AppModelSchema,
  ModelerOutputSchema,
  type AppModel,
  type ModelerOutput,
} from "@tpm/shared/schemas/app-model";
import type { ProjectProfile } from "@tpm/shared/schemas/project-profile";
import type { Logger } from "../../core/logger.js";
import type { ModelGateway } from "../../gateway/index.js";
import { runStage, jsonParse, zodValidate, type StageSpec } from "../_lib/stage-runner.js";
import type { ValidationResult } from "../_lib/validators.js";
import type { RequestedFile } from "./classify-project-prompt.js";
import { diffAppModels, extractDisputeExcerpts } from "./model-app-diff.js";
import {
  MODELER_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
  buildModelerUserPrompt,
  buildSynthesizerUserPrompt,
} from "./model-app-prompts.js";

export const MODELER_A_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
export const MODELER_B_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const SYNTHESIZER_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Qwen2.5-Coder-32B has a hard 24K total context on Workers AI and
// CF's tokenizer counts dense code more heavily than our estimator.
// 5K output leaves ~19K for input with safety margin. Llama has
// plenty of room either way — we keep modelers symmetric for the
// synthesizer.
const MODELER_MAX_TOKENS = 5_000;
const SYNTHESIZER_MAX_TOKENS = 5_000;

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
  candidateA: ModelerOutput;
  candidateB: ModelerOutput;
  appModelPath: string;
  candidatesPath: string;
  neurons: number;
}

// Semantic checks for a modeler's individual output.
function modelerSemanticCheck(seedPaths: Set<string>) {
  return (out: ModelerOutput): ValidationResult => {
    const violations: string[] = [];
    const screenIds = new Set(out.screens.map((s) => s.id));
    const wallIds = new Set(out.walls.map((w) => w.id));
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
    return { ok: violations.length === 0, violations };
  };
}

// Same checks as modeler but at the synthesizer level.
function synthesizerSemanticCheck(seedPaths: Set<string>, profile: ProjectProfile) {
  return (out: AppModel): ValidationResult => {
    const modelerCheck = modelerSemanticCheck(seedPaths)(out as unknown as ModelerOutput);
    if (!modelerCheck.ok) return modelerCheck;
    // Synthesizer-only rule: the consensus entry_points must cover at
    // least one candidate entry_point from the profile.
    const profileEntries = new Set(profile.candidate_entry_points.map((c) => c.file_path));
    const consensusEntries = new Set(out.entry_points.map((e) => e.file_path));
    const covered = [...profileEntries].some((p) => consensusEntries.has(p));
    if (profileEntries.size > 0 && !covered) {
      return {
        ok: false,
        violations: [
          `synthesizer entry_points ignored every profile.candidate_entry_points (${[...profileEntries].join(", ")})`,
        ],
      };
    }
    return { ok: true, violations: [] };
  };
}

async function runOneModeler(
  model: string,
  input: ModelAppInput,
  deps: ModelAppDeps,
): Promise<{ output: ModelerOutput; neurons: number }> {
  const seedPaths = new Set(input.seedFiles.map((f) => f.path));
  const userPrompt = buildModelerUserPrompt({
    auditId: deps.auditId,
    profile: input.profile,
    seedFiles: input.seedFiles,
    leanCanvasIntent: input.leanCanvasIntent,
  });
  const spec: StageSpec<ModelerOutput> = {
    name: "B",
    label: `Stage B · modeling app (${model})`,
    model,
    maxTokens: MODELER_MAX_TOKENS,
    temperature: 0.1,
    responseFormat: "json",
    systemPrompt: MODELER_SYSTEM_PROMPT,
    userPrompt,
    parse: jsonParse,
    validate: zodValidate(ModelerOutputSchema),
    semanticCheck: modelerSemanticCheck(seedPaths),
  };
  const result = await runStage<ModelerOutput>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  return { output: result.output, neurons: result.totalNeurons };
}

async function runSynthesizer(
  input: ModelAppInput,
  candidateA: ModelerOutput,
  candidateB: ModelerOutput,
  deps: ModelAppDeps,
): Promise<{ output: AppModel; neurons: number }> {
  const seedPaths = new Set(input.seedFiles.map((f) => f.path));
  const { agreed, disputes } = diffAppModels(candidateA, candidateB);
  const excerpts = extractDisputeExcerpts(disputes, input.seedFiles);
  const userPrompt = buildSynthesizerUserPrompt({
    auditId: deps.auditId,
    profile: input.profile,
    modelerA: candidateA,
    modelerB: candidateB,
    agreedSummary: agreed,
    disputedClaims: excerpts,
  });
  const spec: StageSpec<AppModel> = {
    name: "B",
    label: `Stage B · synthesizing consensus (${disputes.length} disputes)`,
    model: SYNTHESIZER_MODEL,
    maxTokens: SYNTHESIZER_MAX_TOKENS,
    temperature: 0.1,
    responseFormat: "json",
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
    userPrompt,
    parse: jsonParse,
    validate: zodValidate(AppModelSchema),
    semanticCheck: synthesizerSemanticCheck(seedPaths, input.profile),
  };
  const result = await runStage<AppModel>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  return { output: result.output, neurons: result.totalNeurons };
}

export async function runBModel(input: ModelAppInput, deps: ModelAppDeps): Promise<ModelAppResult> {
  deps.logger.info(
    {
      stage: "B",
      sub: "model",
      seed_files: input.seedFiles.length,
      confidence: input.profile.confidence,
    },
    "B-model starting (ensemble)",
  );

  // Fan out — both modelers run concurrently.
  const [a, b] = await Promise.all([
    runOneModeler(MODELER_A_MODEL, input, deps),
    runOneModeler(MODELER_B_MODEL, input, deps),
  ]);

  // Fan in — synthesizer reconciles.
  const synth = await runSynthesizer(input, a.output, b.output, deps);

  // Attach contributing model ids if the synthesizer didn't.
  const contributors = Array.from(
    new Set([...synth.output.models, MODELER_A_MODEL, MODELER_B_MODEL]),
  );
  const appModel: AppModel = { ...synth.output, models: contributors };

  // Persist artifacts.
  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const appModelPath = path.join(deps.artifactsDir, "app-model.yaml");
  const candidatesPath = path.join(deps.artifactsDir, "app-model.candidates.yaml");
  fs.writeFileSync(appModelPath, yaml.dump(appModel, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(
    path.join(deps.artifactsDir, "app-model.json"),
    JSON.stringify(appModel, null, 2),
  );
  fs.writeFileSync(
    candidatesPath,
    yaml.dump({ modeler_a: a.output, modeler_b: b.output }, { noRefs: true, lineWidth: 120 }),
  );

  const neurons = a.neurons + b.neurons + synth.neurons;
  deps.logger.info(
    {
      stage: "B",
      sub: "model",
      neurons,
      screens: appModel.screens.length,
      walls: appModel.walls.length,
      transitions: appModel.navigation_graph.length,
      synthesis_notes: appModel.synthesis_notes?.length ?? 0,
    },
    "B-model complete",
  );

  return {
    appModel,
    candidateA: a.output,
    candidateB: b.output,
    appModelPath,
    candidatesPath,
    neurons,
  };
}
