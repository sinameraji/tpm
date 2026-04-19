import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { z } from "zod";
import type { Problem, Problems } from "@tpm/shared/schemas/problems";
import type { Delta } from "@tpm/shared/schemas/delta";
import { Solution, SolutionsSchema, type Solutions } from "@tpm/shared/schemas/solutions";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import {
  runStage,
  jsonParse,
  textParse,
  zodValidate,
  type StageSpec,
} from "../_lib/stage-runner.js";
import { isValidHtmlDocument, type ValidationResult } from "../_lib/validators.js";

export const STAGE_E_SPEC_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const STAGE_E_PROTOTYPE_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const SOLUTION_SYSTEM = `You are TPM's solution designer. For ONE problem from the prioritized audit, produce a concrete, implementable solution spec.

Requirements:
- The change is SPECIFIC, not "improve onboarding". E.g., "Replace demo-request form with self-serve signup that lands on a pre-populated template canvas."
- why_right_fix ties directly back to the delta finding + leverage argument.
- unblocks lists other problem ids that become addressable or vanish, each with a one-line rationale.
- implementation_outline is a concrete checklist of steps — new routes, modified components, data model changes if any.
- effort_estimate is {size: trivial|small|medium|large, rationale, weeks_estimate?} — rationale must be scoped to the specific product, not generic.
- risks_and_tradeoffs: each entry is {risk, mitigation}. Real risks: loss of qualification signal for sales, security posture, template curation, etc.
- success_metric: {primary (one metric + threshold), target (quantified), measurement_window, secondary?}

Respond with ONE JSON object matching the Solution schema. Do NOT include prototype; that comes separately.`;

const PROTOTYPE_SYSTEM = `You are TPM's prototype designer. Produce a SINGLE self-contained HTML file that visualizes the proposed change from the solution spec.

Requirements:
- Standalone HTML: inline CSS, no external fonts/scripts except via <link> to a single CDN if absolutely required.
- Annotated: include visible before/after annotations or inline comments near the changed element. Use a small sidebar or call-out box showing "Current state: X → Proposed: Y" + the rationale.
- Realistic copy — use the product's actual branding hints if provided in the spec's scope. No Lorem Ipsum.
- Match the product's existing visual language loosely (colors, typography, spacing hints from the spec). Default to a clean neutral system (system-ui, 1280px max width, plenty of whitespace) when no hints exist.
- Returns ONLY the HTML. No prose, no code fences, no preamble.`;

export interface StageEDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
  topN?: number;
  productBrandingHint?: string;
}

export interface StageEResult {
  solutions: Solutions;
  yamlPath: string;
  neurons: number;
}

interface SpecGenInput {
  problem: Problem;
  delta: Delta;
  brandingHint?: string;
}

// A solution is only useful if it has a concrete plan and a target.
export function stageESpecSemanticCheck(out: z.infer<typeof SolutionNoProto>): ValidationResult {
  const violations: string[] = [];
  if (out.implementation_outline.length < 3) {
    violations.push(
      `implementation_outline has ${out.implementation_outline.length} steps — need at least 3 concrete steps`,
    );
  }
  if (out.risks_and_tradeoffs.length === 0) {
    violations.push("risks_and_tradeoffs is empty — every change has risks, name at least one");
  }
  if (!out.success_metric.target.trim()) {
    violations.push("success_metric.target is empty — quantify the target");
  }
  return { ok: violations.length === 0, violations };
}

const SolutionNoProto = Solution.omit({ prototype: true });

async function generateOneSpec(
  input: SpecGenInput,
  deps: StageEDeps,
): Promise<{ solution: Solution; neurons: number }> {
  const user = [
    "=== PROBLEM (from problems.yaml) ===",
    JSON.stringify(input.problem, null, 2),
    "",
    "=== DELTA EXCERPT (context) ===",
    JSON.stringify(
      {
        overall_health: input.delta.overall_health,
        per_persona_delta: input.delta.per_persona_delta,
      },
      null,
      2,
    ),
    "",
    input.brandingHint ? `PRODUCT BRANDING HINT: ${input.brandingHint}` : "",
    "",
    "Produce ONE JSON object matching this shape:",
    "type Output = {",
    "  id: string,          // e.g. S001",
    "  problem_ref: string, // matches problem.id",
    "  title: string,",
    "  change: { what: string, scope: string[] },",
    "  why_right_fix: string,",
    "  unblocks: Array<{ problem_id: string, rationale: string }>,",
    "  implementation_outline: string[],",
    "  effort_estimate: { size: 'trivial'|'small'|'medium'|'large', rationale: string, weeks_estimate?: string },",
    "  risks_and_tradeoffs: Array<{ risk: string, mitigation: string }>,",
    "  success_metric: { primary: string, target: string, measurement_window: string, secondary?: string[] }",
    "}",
    "Return only the JSON. No prototype field.",
  ].join("\n");

  const spec: StageSpec<z.infer<typeof SolutionNoProto>> = {
    name: "E",
    label: `Stage E · spec ${input.problem.id}`,
    model: STAGE_E_SPEC_MODEL,
    maxTokens: 8_000,
    temperature: 0.2,
    responseFormat: "json",
    systemPrompt: SOLUTION_SYSTEM,
    userPrompt: user,
    parse: (raw) => jsonParse(raw),
    validate: zodValidate(SolutionNoProto),
    semanticCheck: stageESpecSemanticCheck,
  };

  const result = await runStage(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  return { solution: result.output as Solution, neurons: result.totalNeurons };
}

async function generatePrototypeHtml(
  solution: Solution,
  deps: StageEDeps,
): Promise<{ html: string; neurons: number }> {
  const user = [
    "=== SOLUTION SPEC ===",
    JSON.stringify(solution, null, 2),
    "",
    deps.productBrandingHint ? `BRANDING HINT: ${deps.productBrandingHint}` : "",
    "",
    "Produce the standalone HTML now. Only the HTML — no code fences, no prose.",
  ].join("\n");

  const spec: StageSpec<string> = {
    name: "E",
    label: `Stage E · prototype ${solution.id}`,
    model: STAGE_E_PROTOTYPE_MODEL,
    maxTokens: 4_000,
    temperature: 0.3,
    responseFormat: "text",
    systemPrompt: PROTOTYPE_SYSTEM,
    userPrompt: user,
    parse: (raw) => textParse(raw),
    validate: (parsed) => parsed as string,
    semanticCheck: (html) => isValidHtmlDocument(html, { minChars: 500 }),
  };

  const result = await runStage<string>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  return { html: result.output, neurons: result.totalNeurons };
}

export async function runStageE(
  input: { problems: Problems; delta: Delta },
  deps: StageEDeps,
): Promise<StageEResult> {
  const topN = deps.topN ?? 5;
  const top = input.problems.problems.slice(0, topN);

  const results = await Promise.all(
    top.map(async (problem) => {
      const specGenInput: SpecGenInput = { problem, delta: input.delta };
      if (deps.productBrandingHint) specGenInput.brandingHint = deps.productBrandingHint;
      const spec = await generateOneSpec(specGenInput, deps);
      const proto = await generatePrototypeHtml(spec.solution, deps);
      return { spec, proto, problem };
    }),
  );

  fs.mkdirSync(deps.artifactsDir, { recursive: true });
  const prototypesDir = path.join(deps.artifactsDir, "prototypes");
  fs.mkdirSync(prototypesDir, { recursive: true });

  let totalNeurons = 0;
  const solutions: Solution[] = [];
  for (const r of results) {
    const fileName = `${r.spec.solution.id}_${slugify(r.spec.solution.title)}.html`;
    const protoPath = path.join(prototypesDir, fileName);
    fs.writeFileSync(protoPath, r.proto.html);
    solutions.push({
      ...r.spec.solution,
      prototype: {
        path: path.relative(deps.artifactsDir, protoPath),
        description: r.spec.solution.change.what.slice(0, 200),
      },
    });
    totalNeurons += r.spec.neurons + r.proto.neurons;
  }

  const out: Solutions = SolutionsSchema.parse({
    schema_version: 1,
    audit_id: deps.auditId,
    generated_at: new Date().toISOString(),
    model_spec: STAGE_E_SPEC_MODEL,
    model_prototype: STAGE_E_PROTOTYPE_MODEL,
    solutions,
  });

  const yamlPath = path.join(deps.artifactsDir, "solutions.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(out, { noRefs: true, lineWidth: 120 }));
  fs.writeFileSync(path.join(deps.artifactsDir, "solutions.json"), JSON.stringify(out, null, 2));
  return { solutions: out, yamlPath, neurons: totalNeurons };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}
