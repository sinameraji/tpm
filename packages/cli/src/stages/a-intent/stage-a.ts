import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import type { Map as MapNs, Scraped as ScrapedNs } from "@tpm/shared";
import { LeanCanvasSchema, type LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Logger } from "../../core/logger.js";
import type { ModelGateway } from "../../gateway/index.js";
import { STAGE_A_SYSTEM_PROMPT, buildStageAUserPrompt } from "./prompt.js";
import { runStage, jsonParse, zodValidate, type StageSpec } from "../_lib/stage-runner.js";
import type { ValidationResult } from "../_lib/validators.js";

// Llama 3.3 70B FP8 Fast: Cloudflare's default on the /json endpoint.
// 92% IFEval vs 72% for Qwen3-30B Multi-IF. Non-reasoning model, so
// max_tokens = visible output — no hidden thinking-token burn.
export const STAGE_A_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const STAGE_A_MAX_TOKENS = 16_000;

export interface StageADeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
}

export interface StageAResult {
  leanCanvas: LeanCanvas;
  yamlPath: string;
  neurons: number;
}

// Stage A semantic rules: a Lean Canvas with zero personas is valid
// Zod but useless — Stage B would run on zero personas and produce
// nothing. Guard the pipeline here.
export function stageASemanticCheck(out: LeanCanvas): ValidationResult {
  const violations: string[] = [];
  if (out.intended_jtbd_per_segment.length === 0) {
    violations.push("intended_jtbd_per_segment is empty — every audit needs at least one persona");
  }
  if (out.lean_canvas.customer_segments.items.length === 0) {
    violations.push("customer_segments.items is empty — identify at least one segment");
  }
  if (out.intended_value_moments.length === 0) {
    violations.push("intended_value_moments is empty — each persona needs a value moment");
  }
  if (!out.lean_canvas.unique_value_proposition.statement.trim()) {
    violations.push("unique_value_proposition.statement is empty");
  }
  // JTBD ↔ value-moment ↔ critical-path integrity: same segment_id across all three.
  const jtbdSegs = new Set(out.intended_jtbd_per_segment.map((j) => j.segment_id));
  for (const vm of out.intended_value_moments) {
    if (!jtbdSegs.has(vm.segment_id)) {
      violations.push(
        `value_moment references segment_id "${vm.segment_id}" with no matching JTBD`,
      );
    }
  }
  for (const cp of out.intended_critical_paths) {
    if (!jtbdSegs.has(cp.segment_id)) {
      violations.push(
        `critical_path references segment_id "${cp.segment_id}" with no matching JTBD`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}

export async function runStageA(
  input: { map: MapNs.Map; scraped?: ScrapedNs.ScrapedSurfaces | undefined },
  deps: StageADeps,
): Promise<StageAResult> {
  const promptInput: { map: MapNs.Map; scraped?: ScrapedNs.ScrapedSurfaces | undefined } = {
    map: input.map,
  };
  if (input.scraped !== undefined) promptInput.scraped = input.scraped;
  const userPrompt = buildStageAUserPrompt(promptInput);

  const spec: StageSpec<LeanCanvas> = {
    name: "A",
    label: "Stage A · extracting intent",
    model: STAGE_A_MODEL,
    maxTokens: STAGE_A_MAX_TOKENS,
    temperature: 0.1,
    responseFormat: "json",
    systemPrompt: STAGE_A_SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => jsonParse(raw),
    validate: zodValidate(LeanCanvasSchema),
    semanticCheck: stageASemanticCheck,
  };

  const result = await runStage<LeanCanvas>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  const leanCanvas = result.output;

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const yamlPath = path.join(deps.artifactsDir, "lean-canvas.yaml");
  const jsonPath = path.join(deps.artifactsDir, "lean-canvas.json");
  fs.writeFileSync(yamlPath, yaml.dump(leanCanvas, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(jsonPath, JSON.stringify(leanCanvas, null, 2));

  return {
    leanCanvas,
    yamlPath,
    neurons: result.totalNeurons,
  };
}

export interface EditorResult {
  opened: boolean;
  editor: string | null;
  exitCode: number;
  updated: boolean;
  leanCanvas?: LeanCanvas;
}

export function openInEditor(yamlPath: string, nonInteractive = false): EditorResult {
  if (nonInteractive || !process.stdin.isTTY) {
    return { opened: false, editor: null, exitCode: 0, updated: false };
  }
  const editor = process.env["VISUAL"] ?? process.env["EDITOR"] ?? "vi";
  const before = fs.readFileSync(yamlPath, "utf8");
  const res = spawnSync(editor, [yamlPath], { stdio: "inherit" });
  const after = fs.readFileSync(yamlPath, "utf8");
  const updated = before !== after;
  const result: EditorResult = {
    opened: true,
    editor,
    exitCode: res.status ?? -1,
    updated,
  };
  if (updated) {
    const parsed = yaml.load(after) as unknown;
    result.leanCanvas = LeanCanvasSchema.parse(parsed);
  }
  return result;
}
