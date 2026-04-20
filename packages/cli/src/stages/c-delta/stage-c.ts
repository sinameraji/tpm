import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Paths } from "@tpm/shared/schemas/paths";
import { DeltaSchema, type Delta } from "@tpm/shared/schemas/delta";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import { buildStageCSystemPrompt, buildStageCUserPrompt } from "./prompt.js";
import { runStage, jsonParse, zodValidate, type StageSpec } from "../_lib/stage-runner.js";
import type { ValidationResult } from "../_lib/validators.js";

export const STAGE_C_MODEL = "claude-sonnet-4-6";
const STAGE_C_MAX_TOKENS = 16_000;

export interface StageCDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
  patternLibrarySummary: string;
}

export interface StageCResult {
  delta: Delta;
  yamlPath: string;
  neurons: number;
}

// Stage C must produce one delta entry per persona. A delta missing
// personas means downstream Stage D would rank problems against an
// incomplete picture.
export function stageCSemanticCheck(canvas: LeanCanvas): (out: Delta) => ValidationResult {
  const expectedPersonas = new Set(canvas.intended_jtbd_per_segment.map((j) => j.segment_id));
  return (out: Delta) => {
    const violations: string[] = [];
    const got = new Set(out.per_persona_delta.map((p) => p.persona));
    for (const p of expectedPersonas) {
      if (!got.has(p)) {
        violations.push(`per_persona_delta missing entry for persona "${p}"`);
      }
    }
    for (const p of got) {
      if (!expectedPersonas.has(p)) {
        violations.push(`per_persona_delta has unexpected persona "${p}" not in lean-canvas`);
      }
    }
    return { ok: violations.length === 0, violations };
  };
}

export async function runStageC(
  input: { leanCanvas: LeanCanvas; paths: Paths },
  deps: StageCDeps,
): Promise<StageCResult> {
  const userPrompt = buildStageCUserPrompt({
    leanCanvas: input.leanCanvas,
    paths: input.paths,
  });

  const spec: StageSpec<Delta> = {
    name: "C",
    label: "Stage C · computing delta",
    model: STAGE_C_MODEL,
    maxTokens: STAGE_C_MAX_TOKENS,
    temperature: 0.1,
    responseFormat: "json",
    // System prompt includes the audit-agnostic pattern library so
    // ephemeral caching catches both in one block.
    systemPrompt: buildStageCSystemPrompt(deps.patternLibrarySummary),
    userPrompt,
    parse: (raw) => jsonParse(raw),
    validate: zodValidate(DeltaSchema),
    semanticCheck: stageCSemanticCheck(input.leanCanvas),
    cacheSystem: true,
  };

  const result = await runStage<Delta>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  const delta = result.output;

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const yamlPath = path.join(deps.artifactsDir, "delta.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(delta, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(path.join(deps.artifactsDir, "delta.json"), JSON.stringify(delta, null, 2));

  return { delta, yamlPath, neurons: result.totalNeurons };
}
