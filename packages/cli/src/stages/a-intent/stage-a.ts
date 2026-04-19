import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import type { Map as MapNs, Scraped as ScrapedNs } from "@tpm/shared";
import { LeanCanvasSchema, type LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { CompleteOptionsExt } from "../../gateway/workers-ai.js";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import { STAGE_A_SYSTEM_PROMPT, buildStageAUserPrompt } from "./prompt.js";

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

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return m?.[1]?.trim() ?? trimmed;
}

type Completion = {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; neurons?: number; latencyMs: number };
};

async function call(
  deps: StageADeps,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens: number,
): Promise<Completion> {
  const opts: CompleteOptionsExt = {
    temperature: 0.1,
    responseFormat: "json",
    auditId: deps.auditId,
    sessionId: deps.sessionId,
    stage: "A",
    maxTokens,
  };
  return deps.gateway.complete(STAGE_A_MODEL, messages, opts) as Promise<Completion>;
}

export async function runStageA(
  input: { map: MapNs.Map; scraped?: ScrapedNs.ScrapedSurfaces | undefined },
  deps: StageADeps,
): Promise<StageAResult> {
  deps.logger.info({ stage: "A", audit_id: deps.auditId }, "stage A started");

  const promptInput: { map: MapNs.Map; scraped?: ScrapedNs.ScrapedSurfaces | undefined } = {
    map: input.map,
  };
  if (input.scraped !== undefined) promptInput.scraped = input.scraped;
  const userPrompt = buildStageAUserPrompt(promptInput);
  const messages = [
    { role: "system" as const, content: STAGE_A_SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ];

  // First attempt.
  let completion: Completion;
  try {
    completion = await call(deps, messages, STAGE_A_MAX_TOKENS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.error({ stage: "A", err: msg }, "stage A gateway call failed");
    throw err;
  }

  // Reasoning models can burn the whole budget on reasoning and return
  // empty text. Retry once with a bigger budget before giving up.
  if (!completion.text.trim()) {
    deps.logger.warn(
      {
        stage: "A",
        usage: completion.usage,
        first_budget: STAGE_A_MAX_TOKENS,
        retrying_with: STAGE_A_MAX_TOKENS * 2,
      },
      "stage A returned empty — likely spent all tokens on internal reasoning; retrying with larger budget",
    );
    completion = await call(deps, messages, STAGE_A_MAX_TOKENS * 2);
    if (!completion.text.trim()) {
      deps.logger.error(
        { stage: "A", usage: completion.usage },
        "stage A still returned empty after retry",
      );
      throw new Error(
        "Stage A model returned empty output even at 64K tokens. The codebase may be too large for the reasoning model to summarize in one pass, or the model is overloaded. Try re-running, or trim the project (most audits fit fine).",
      );
    }
  }

  const raw = stripCodeFences(completion.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.error(
      {
        stage: "A",
        parse_error: msg,
        usage: completion.usage,
        raw_preview: raw.slice(0, 400),
      },
      "stage A JSON parse failed",
    );
    throw new Error(`Stage A returned non-JSON: ${msg}`);
  }

  let leanCanvas: LeanCanvas;
  try {
    leanCanvas = LeanCanvasSchema.parse(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn(
      { stage: "A", zod_error: msg },
      "stage A schema validation failed — requesting retry",
    );
    const retryCompletion = await call(
      deps,
      [
        ...messages,
        { role: "assistant", content: completion.text },
        {
          role: "user",
          content:
            "Your previous response did not match the schema. Zod validation error:\n" +
            msg +
            "\n\nReturn a corrected JSON object that matches the schema. No other output.",
        },
      ],
      STAGE_A_MAX_TOKENS,
    );
    const retryRaw = stripCodeFences(retryCompletion.text);
    if (!retryRaw) {
      throw new Error("Stage A schema-retry returned empty output.");
    }
    leanCanvas = LeanCanvasSchema.parse(JSON.parse(retryRaw));
    completion = retryCompletion;
  }

  ensureDir(deps.artifactsDir);
  const yamlPath = path.join(deps.artifactsDir, "lean-canvas.yaml");
  const jsonPath = path.join(deps.artifactsDir, "lean-canvas.json");
  fs.writeFileSync(yamlPath, yaml.dump(leanCanvas, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(jsonPath, JSON.stringify(leanCanvas, null, 2));

  deps.logger.info(
    {
      stage: "A",
      audit_id: deps.auditId,
      neurons: completion.usage.neurons ?? 0,
      input_tokens: completion.usage.inputTokens,
      output_tokens: completion.usage.outputTokens,
      yaml_path: yamlPath,
    },
    "stage A complete",
  );

  return {
    leanCanvas,
    yamlPath,
    neurons: completion.usage.neurons ?? 0,
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
