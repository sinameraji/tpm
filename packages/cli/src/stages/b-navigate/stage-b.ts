// Stage B orchestrator: snapshot → classify → model → walk.
//
// Previously a single LLM call conflating "understand the app" and
// "imagine the journey." Now decomposed: B-classify (LLM agent with
// file requests) produces a project_profile, B-model (ensemble +
// synthesizer) produces an app_model that's verifiable against the
// codebase, and B-walk consumes the app_model to imagine per-persona
// journeys in terms of screen_ids rather than invented URLs.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { AppModel } from "@tpm/shared/schemas/app-model";
import {
  FrictionFlag,
  OutcomeStatus,
  PathsSchema,
  type Paths,
  type PersonaPath,
  type Step,
} from "@tpm/shared/schemas/paths";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import {
  buildInferredPathUserPrompt,
  extractPersonaBriefing,
  INFERRED_PATH_SYSTEM_PROMPT,
} from "./prompt.js";
import {
  runStage,
  jsonParse,
  zodValidate,
  StageError,
  type StageSpec,
} from "../_lib/stage-runner.js";
import type { ValidationResult } from "../_lib/validators.js";
import { snapshotRepo } from "./snapshot.js";
import { classifyProject, ClassifyError } from "./classify-project.js";
import { runBModel } from "./model-app.js";
import type { RequestedFile } from "./classify-project-prompt.js";

export const STAGE_B_WALK_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const STAGE_B_WALK_MAX_TOKENS = 4_000;
// Qwen2.5-Coder-32B enforces a 24K total context on Workers AI.
// 1.1.1 grazed the ceiling (24,285 > 24,000 by 285 tokens), so trim
// further: 5 files × 80 lines × ~55 chars ≈ 22K chars → ~8K CF tokens
// of seed files. Plus ~2K system + ~2K profile JSON + 5K output = ~17K.
// Leaves 7K safety margin — enough to absorb tokenizer variance across
// projects without another production overage.
const MAX_SEED_FILE_LINES = 80;
const MAX_SEED_FILES = 5;

export interface StageBDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
  projectRoot: string;
  stepBudget?: number;
}

export interface StageBResult {
  paths: Paths;
  appModel: AppModel;
  yamlPath: string;
  appModelPath: string;
  neurons: number;
}

const PersonaResponseSchema = z.object({
  steps: z.array(
    z.object({
      n: z.number().int().positive(),
      screen_id: z.string().nullable(),
      location: z.string().nullable(),
      url: z.string().nullable().optional(),
      observation_summary: z.string(),
      decision: z.enum([
        "click",
        "fill_form",
        "navigate",
        "scroll",
        "wait",
        "go_back",
        "stuck",
        "value_reached",
      ]),
      target: z.string().nullable(),
      reasoning: z.string(),
      value_moment_reached: z.boolean(),
      friction_flags: z.array(FrictionFlag).default([]),
    }),
  ),
  outcome: z.object({
    status: OutcomeStatus,
    loop_closed: z.boolean(),
    value_moment_reached: z.boolean(),
    stuck_reason: z.string().nullable(),
  }),
});
type PersonaResponse = z.infer<typeof PersonaResponseSchema>;

// A persona with zero steps is useless EXCEPT for the honest
// "skipped" case (headless API, library). In that case the model must
// still return outcome.status="skipped" with a stuck_reason; steps can
// be empty and that's valid.
function personaSemanticCheck(appModel: AppModel) {
  const knownScreenIds = new Set(appModel.screens.map((s) => s.id));
  return (out: PersonaResponse): ValidationResult => {
    const violations: string[] = [];
    if (out.steps.length === 0 && out.outcome.status !== "skipped") {
      violations.push(
        "steps is empty but outcome is not 'skipped' — either produce steps or explain why the project has no user-facing journey",
      );
    }
    // Every non-null screen_id must exist in the app model.
    for (const s of out.steps) {
      if (s.screen_id !== null && !knownScreenIds.has(s.screen_id)) {
        violations.push(
          `step ${s.n} references unknown screen_id "${s.screen_id}" — not in app_model.screens`,
        );
      }
    }
    return { ok: violations.length === 0, violations };
  };
}

// Pick seed files for B-model based on the project_profile's
// candidate lists. Deterministic: once B-classify has decided which
// files matter, this is just file-fetch + truncation bookkeeping.
function pickSeedFiles(
  profile: {
    candidate_entry_points: { file_path: string }[];
    candidate_screen_files: { file_path: string }[];
  },
  projectRoot: string,
): RequestedFile[] {
  const wanted: string[] = [];
  for (const e of profile.candidate_entry_points)
    if (!wanted.includes(e.file_path)) wanted.push(e.file_path);
  for (const s of profile.candidate_screen_files)
    if (!wanted.includes(s.file_path)) wanted.push(s.file_path);
  const picked: RequestedFile[] = [];
  for (const rel of wanted.slice(0, MAX_SEED_FILES)) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const raw = fs.readFileSync(abs, "utf8");
    const lines = raw.split(/\r?\n/);
    if (lines.length > MAX_SEED_FILE_LINES) {
      picked.push({
        path: rel,
        content: lines.slice(0, MAX_SEED_FILE_LINES).join("\n"),
        truncated_at_line: MAX_SEED_FILE_LINES,
      });
    } else {
      picked.push({ path: rel, content: raw });
    }
  }
  return picked;
}

function leanCanvasIntentSummary(canvas: LeanCanvas): string {
  return [
    `product name: ${canvas.sources.find((s) => s.type === "landing_page")?.url ?? "(unknown)"}`,
    `uvp: ${canvas.lean_canvas.unique_value_proposition.statement}`,
    `problems: ${canvas.lean_canvas.problem.items.map((p) => p.statement).join(" | ")}`,
    `segments: ${canvas.lean_canvas.customer_segments.items.map((s) => s.segment).join(" | ")}`,
  ].join("\n");
}

async function runBWalk(
  appModel: AppModel,
  canvas: LeanCanvas,
  deps: StageBDeps,
): Promise<{ paths: Paths; neurons: number }> {
  const stepBudget = deps.stepBudget ?? 25;
  const personaPaths: PersonaPath[] = [];
  let totalNeurons = 0;
  const semanticCheck = personaSemanticCheck(appModel);

  for (const jtbd of canvas.intended_jtbd_per_segment) {
    const briefing = extractPersonaBriefing(canvas, jtbd.segment_id);
    if (!briefing) {
      deps.logger.warn({ persona: jtbd.segment_id }, "missing value moment — skipping");
      continue;
    }

    const startedAt = new Date();
    const spec: StageSpec<PersonaResponse> = {
      name: "B",
      label: `Stage B · walking persona ${jtbd.segment_id}`,
      model: STAGE_B_WALK_MODEL,
      maxTokens: STAGE_B_WALK_MAX_TOKENS,
      temperature: 0.3,
      responseFormat: "json",
      systemPrompt: INFERRED_PATH_SYSTEM_PROMPT,
      userPrompt: buildInferredPathUserPrompt(briefing, appModel),
      parse: jsonParse,
      validate: zodValidate(PersonaResponseSchema),
      semanticCheck,
    };

    try {
      const result = await runStage<PersonaResponse>(spec, {
        gateway: deps.gateway,
        logger: deps.logger,
        auditId: deps.auditId,
        sessionId: deps.sessionId,
      });
      const parsed = result.output;
      totalNeurons += result.totalNeurons;

      const steps: Step[] = parsed.steps.slice(0, stepBudget).map((s) => ({
        n: s.n,
        screen_id: s.screen_id,
        location: s.location,
        url: s.url ?? null,
        observation_summary: s.observation_summary,
        decision: s.decision,
        target: s.target,
        reasoning: s.reasoning,
        value_moment_reached: s.value_moment_reached,
        friction_flags: s.friction_flags,
      }));

      const entryPoint =
        appModel.entry_points[0]?.file_path ??
        appModel.profile.candidate_entry_points[0]?.file_path ??
        "(no entry point)";

      personaPaths.push({
        persona: jtbd.segment_id,
        goal: briefing.job,
        value_moment_target: briefing.valueMoment,
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        step_budget: stepBudget,
        steps_taken: steps.length,
        entry_point: entryPoint,
        steps,
        outcome: {
          status: parsed.outcome.status,
          loop_closed: parsed.outcome.loop_closed,
          value_moment_reached: parsed.outcome.value_moment_reached,
          time_to_value_ms: null,
          stuck_at_step: parsed.outcome.status === "stuck" ? steps.length : null,
          stuck_reason: parsed.outcome.stuck_reason,
        },
      });
    } catch (err) {
      const msg =
        err instanceof StageError
          ? `${err.message} (attempts: ${err.attempts.length})`
          : err instanceof Error
            ? err.message
            : String(err);
      deps.logger.warn({ persona: jtbd.segment_id, err: msg }, "persona walk failed after retries");
      personaPaths.push({
        persona: jtbd.segment_id,
        goal: briefing.job,
        value_moment_target: briefing.valueMoment,
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        step_budget: stepBudget,
        steps_taken: 0,
        entry_point: appModel.entry_points[0]?.file_path ?? "(no entry)",
        steps: [],
        outcome: {
          status: "error",
          loop_closed: false,
          value_moment_reached: false,
          time_to_value_ms: null,
          stuck_at_step: null,
          stuck_reason: msg,
        },
      });
    }
  }

  const paths: Paths = PathsSchema.parse({
    schema_version: 1,
    audit_id: deps.auditId,
    generated_at: new Date().toISOString(),
    model: STAGE_B_WALK_MODEL,
    paths: personaPaths,
  });
  return { paths, neurons: totalNeurons };
}

export async function runStageB(canvas: LeanCanvas, deps: StageBDeps): Promise<StageBResult> {
  // 1. Snapshot the repo (deterministic).
  const snap = snapshotRepo(deps.projectRoot);
  deps.logger.info(
    {
      stage: "B",
      sub: "snapshot",
      files: snap.total_file_count,
      dirs: snap.total_dir_count,
      manifests: snap.manifest_presence,
      truncated: snap.truncated,
    },
    "repo snapshot built",
  );

  // 2. Classify project with the LLM agent (bounded file requests).
  let profile;
  let classifyNeurons = 0;
  try {
    const classifyResult = await classifyProject(snap, {
      gateway: deps.gateway,
      logger: deps.logger,
      auditId: deps.auditId,
      sessionId: deps.sessionId,
      projectRoot: deps.projectRoot,
    });
    profile = classifyResult.profile;
    classifyNeurons = classifyResult.neurons;
  } catch (err) {
    if (err instanceof ClassifyError) {
      throw new StageError(
        `Stage B: project classification failed — ${err.message}`,
        "B",
        deps.sessionId,
        [],
      );
    }
    throw err;
  }

  // Persist the profile alongside other artifacts.
  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const profilePath = path.join(deps.artifactsDir, "project-profile.yaml");
  fs.writeFileSync(profilePath, yaml.dump(profile, { noRefs: true, lineWidth: 120 }));

  // 3. B-model: ensemble of modelers + synthesizer.
  const seedFiles = pickSeedFiles(profile, deps.projectRoot);
  if (seedFiles.length === 0) {
    throw new StageError(
      "Stage B: profile identified candidate entry points but none could be read from disk",
      "B",
      deps.sessionId,
      [],
    );
  }
  const modelResult = await runBModel(
    {
      profile,
      seedFiles,
      leanCanvasIntent: leanCanvasIntentSummary(canvas),
    },
    {
      gateway: deps.gateway,
      logger: deps.logger,
      auditId: deps.auditId,
      sessionId: deps.sessionId,
      artifactsDir: deps.artifactsDir,
    },
  );

  // 4. B-walk: per-persona journey using the app model.
  const walk = await runBWalk(modelResult.appModel, canvas, deps);

  const yamlPath = path.join(deps.artifactsDir, "paths.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(walk.paths, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(path.join(deps.artifactsDir, "paths.json"), JSON.stringify(walk.paths, null, 2));

  return {
    paths: walk.paths,
    appModel: modelResult.appModel,
    yamlPath,
    appModelPath: modelResult.appModelPath,
    neurons: classifyNeurons + modelResult.neurons + walk.neurons,
  };
}
