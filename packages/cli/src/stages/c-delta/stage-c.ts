import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Paths } from "@tpm/shared/schemas/paths";
import { DeltaSchema, type Delta } from "@tpm/shared/schemas/delta";
import type { ModelGateway } from "../../gateway/index.js";
import type { CompleteOptionsExt } from "../../gateway/workers-ai.js";
import type { Logger } from "../../core/logger.js";
import { STAGE_C_SYSTEM_PROMPT, buildStageCUserPrompt } from "./prompt.js";

export const STAGE_C_MODEL = "@cf/openai/gpt-oss-120b";

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

function stripCodeFences(raw: string): string {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(raw.trim());
  return m?.[1]?.trim() ?? raw.trim();
}

export async function runStageC(
  input: { leanCanvas: LeanCanvas; paths: Paths },
  deps: StageCDeps,
): Promise<StageCResult> {
  deps.logger.info({ stage: "C", audit_id: deps.auditId }, "stage C started");

  const userPrompt = buildStageCUserPrompt({
    leanCanvas: input.leanCanvas,
    paths: input.paths,
    patternLibrarySummary: deps.patternLibrarySummary,
  });
  const opts: CompleteOptionsExt = {
    temperature: 0.15,
    responseFormat: "json",
    auditId: deps.auditId,
    sessionId: deps.sessionId,
    stage: "C",
    maxTokens: 12_000,
  };

  const completion = await deps.gateway.complete(
    STAGE_C_MODEL,
    [
      { role: "system", content: STAGE_C_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    opts,
  );

  let delta: Delta;
  const raw = stripCodeFences(completion.text);
  try {
    delta = DeltaSchema.parse(JSON.parse(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn({ err: msg }, "stage C first response failed schema; retrying");
    const retry = await deps.gateway.complete(
      STAGE_C_MODEL,
      [
        { role: "system", content: STAGE_C_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
        { role: "assistant", content: completion.text },
        {
          role: "user",
          content:
            "Your previous response did not parse. Error: " +
            msg +
            "\nReturn a corrected JSON object matching the schema. No other output.",
        },
      ],
      opts,
    );
    delta = DeltaSchema.parse(JSON.parse(stripCodeFences(retry.text)));
  }

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const yamlPath = path.join(deps.artifactsDir, "delta.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(delta, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(path.join(deps.artifactsDir, "delta.json"), JSON.stringify(delta, null, 2));
  deps.logger.info({ stage: "C", yaml_path: yamlPath }, "stage C complete");

  return { delta, yamlPath, neurons: completion.usage.neurons ?? 0 };
}
