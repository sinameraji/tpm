import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { Map as MapNs } from "@tpm/shared";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
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

export const STAGE_B_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const STAGE_B_MAX_TOKENS = 4_000;

export interface StageBDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
  stepBudget?: number;
}

export interface StageBResult {
  paths: Paths;
  yamlPath: string;
  neurons: number;
}

const PersonaResponseSchema = z.object({
  steps: z.array(
    z.object({
      n: z.number().int().positive(),
      url: z.string(),
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

// A persona path with zero steps is structurally valid but useless.
// Force a retry so the model produces an actual walk-through.
function personaSemanticCheck(out: PersonaResponse): ValidationResult {
  const violations: string[] = [];
  if (out.steps.length === 0) {
    violations.push("steps is empty — produce at least one step showing entry");
  }
  return { ok: violations.length === 0, violations };
}

export async function runStageB(
  canvas: LeanCanvas,
  map: MapNs.Map,
  deps: StageBDeps,
): Promise<StageBResult> {
  const stepBudget = deps.stepBudget ?? 25;
  const personaPaths: PersonaPath[] = [];
  let totalNeurons = 0;

  for (const jtbd of canvas.intended_jtbd_per_segment) {
    const briefing = extractPersonaBriefing(canvas, jtbd.segment_id);
    if (!briefing) {
      deps.logger.warn({ persona: jtbd.segment_id }, "missing value moment — skipping");
      continue;
    }

    const startedAt = new Date();
    const spec: StageSpec<PersonaResponse> = {
      name: "B",
      label: `Stage B · persona ${jtbd.segment_id}`,
      model: STAGE_B_MODEL,
      maxTokens: STAGE_B_MAX_TOKENS,
      temperature: 0.3,
      responseFormat: "json",
      systemPrompt: INFERRED_PATH_SYSTEM_PROMPT,
      userPrompt: buildInferredPathUserPrompt(briefing, map),
      parse: (raw) => jsonParse(raw),
      validate: zodValidate(PersonaResponseSchema),
      semanticCheck: personaSemanticCheck,
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
        url: s.url,
        observation_summary: s.observation_summary,
        decision: s.decision,
        target: s.target,
        reasoning: s.reasoning,
        value_moment_reached: s.value_moment_reached,
        friction_flags: s.friction_flags,
      }));

      personaPaths.push({
        persona: jtbd.segment_id,
        goal: briefing.job,
        value_moment_target: briefing.valueMoment,
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        step_budget: stepBudget,
        steps_taken: steps.length,
        entry_point: "(code-only)",
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
      deps.logger.warn({ persona: jtbd.segment_id, err: msg }, "persona B failed after retries");
      personaPaths.push({
        persona: jtbd.segment_id,
        goal: briefing.job,
        value_moment_target: briefing.valueMoment,
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        step_budget: stepBudget,
        steps_taken: 0,
        entry_point: "(code-only)",
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
    model: STAGE_B_MODEL,
    paths: personaPaths,
  });

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const yamlPath = path.join(deps.artifactsDir, "paths.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(paths, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(path.join(deps.artifactsDir, "paths.json"), JSON.stringify(paths, null, 2));

  return { paths, yamlPath, neurons: totalNeurons };
}
