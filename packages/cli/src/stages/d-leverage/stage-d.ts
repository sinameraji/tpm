import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { Delta } from "@tpm/shared/schemas/delta";
import { ProblemsSchema, type Problems } from "@tpm/shared/schemas/problems";
import type { ModelGateway } from "../../gateway/index.js";
import type { CompleteOptionsExt } from "../../gateway/workers-ai.js";
import type { Logger } from "../../core/logger.js";

export const STAGE_D_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const STAGE_D_SYSTEM_PROMPT = `You are TPM, prioritizing problems discovered in a product audit by LEVERAGE — expected impact over effort.

You are given delta.yaml: per-persona step classifications, intent mismatches, implicit-vs-stated job alignment, and overall health.

Your job: produce a ranked list of problems with an EXPLICIT LEVERAGE ARGUMENT for each.

Do NOT use a formula. Formulas rank wrong when inputs are fuzzy. Instead, for each problem produce a structured leverage argument of the form:
  "This is rank N because: [severity reason] × [reach reason] × [funnel position reason] × [blast radius] relative to [effort]. Fixing it unblocks [list]. The next priority is lower because: [delta]."

GUARDRAILS (you must follow):
1. Value-moment-unreachable problems DOMINATE everything else. If any persona can't reach the value moment, those problems rank 1..N before any smaller issue.
2. Entry/activation-funnel problems outrank retention-loop problems when both exist, because the retention problem can't be observed until entry is fixed.
3. At equal severity: broken > cuttable > cuttable_with_care > intentional_friction_broken > cargo_culted.
4. Intent mismatches against the primary promise outrank other findings.
5. Effort is a TIE-BREAKER, not a primary axis. A critical/large problem still outranks a medium/trivial problem.

Score each problem on these axes, each categorical:
- severity: critical | high | medium | low | info
- reach: single_persona | some_personas | all_personas
- funnel_position: entry | activation | first_value | retention_loop
- blast_radius: isolated | unblocks_one | unblocks_many
- effort_estimate: trivial | small | medium | large
- confidence: high | medium | low

For each problem cite source_findings as delta references (e.g. "per_persona_delta[compliance_officer].intent_mismatches[0]" or "per_persona_delta[foo].step_classifications[step_n=18]").

Unblocks: list the ids of other problems in your output that this one unblocks. Be honest — most problems don't unblock others; leave empty when they don't.

Respond with ONE JSON object matching the schema. No prose, no code fences.`;

function buildUserPrompt(delta: Delta): string {
  return [
    "=== DELTA ANALYSIS ===",
    JSON.stringify(delta, null, 2),
    "",
    "=== TASK ===",
    "Produce ONE JSON object matching this TypeScript shape:",
    "",
    "type Output = {",
    "  schema_version: 1,",
    "  audit_id: string,",
    "  generated_at: string,",
    "  model: string,",
    "  problems: Array<{",
    "    id: string,          // stable: P001, P002, ...",
    "    rank: number,        // 1..N, contiguous",
    "    title: string,",
    "    source_findings: Array<{ delta_ref: string }>,",
    "    severity: 'critical'|'high'|'medium'|'low'|'info',",
    "    reach: 'single_persona'|'some_personas'|'all_personas',",
    "    funnel_position: 'entry'|'activation'|'first_value'|'retention_loop',",
    "    blast_radius: 'isolated'|'unblocks_one'|'unblocks_many',",
    "    effort_estimate: 'trivial'|'small'|'medium'|'large',",
    "    confidence: 'high'|'medium'|'low',",
    "    leverage_argument: string,",
    "    unblocks: string[],",
    "    related_patterns: string[]",
    "  }>",
    "}",
    "",
    "Return only the JSON object. Rank ALL problems contiguously 1..N.",
  ].join("\n");
}

function stripCodeFences(raw: string): string {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(raw.trim());
  return m?.[1]?.trim() ?? raw.trim();
}

export interface StageDDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
}

export interface StageDResult {
  problems: Problems;
  yamlPath: string;
  neurons: number;
}

export async function runStageD(delta: Delta, deps: StageDDeps): Promise<StageDResult> {
  deps.logger.info({ stage: "D", audit_id: deps.auditId }, "stage D started");
  const opts: CompleteOptionsExt = {
    temperature: 0.15,
    responseFormat: "json",
    auditId: deps.auditId,
    sessionId: deps.sessionId,
    stage: "D",
    maxTokens: 8_000,
  };
  let completion = await deps.gateway.complete(
    STAGE_D_MODEL,
    [
      { role: "system", content: STAGE_D_SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(delta) },
    ],
    opts,
  );
  if (!completion.text.trim()) {
    deps.logger.warn(
      { usage: completion.usage },
      "stage D returned empty; retrying with larger budget",
    );
    completion = await deps.gateway.complete(
      STAGE_D_MODEL,
      [
        { role: "system", content: STAGE_D_SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(delta) },
      ],
      { ...opts, maxTokens: 16_000 },
    );
    if (!completion.text.trim())
      throw new Error("Stage D returned empty output even at 64K tokens.");
  }
  let problems: Problems;
  try {
    problems = ProblemsSchema.parse(JSON.parse(stripCodeFences(completion.text)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn({ err: msg }, "stage D first response failed; retrying");
    const retry = await deps.gateway.complete(
      STAGE_D_MODEL,
      [
        { role: "system", content: STAGE_D_SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(delta) },
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
    problems = ProblemsSchema.parse(JSON.parse(stripCodeFences(retry.text)));
  }

  // Sanity: ranks should be unique and contiguous. Reorder if not.
  const sorted = [...problems.problems].sort((a, b) => a.rank - b.rank);
  sorted.forEach((p, i) => {
    p.rank = i + 1;
  });
  problems.problems = sorted;

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const yamlPath = path.join(deps.artifactsDir, "problems.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(problems, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(
    path.join(deps.artifactsDir, "problems.json"),
    JSON.stringify(problems, null, 2),
  );
  deps.logger.info({ stage: "D", count: problems.problems.length }, "stage D complete");
  return { problems, yamlPath, neurons: completion.usage.neurons ?? 0 };
}
