import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import type { z } from "zod";
import type { Problem, Problems } from "@pm/shared/schemas/problems";
import type { Delta } from "@pm/shared/schemas/delta";
import { Solution, SolutionsSchema, type Solutions } from "@pm/shared/schemas/solutions";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { StageProgressCtx } from "../../core/progress.js";
import {
  runStage,
  jsonParse,
  textParse,
  zodValidate,
  type StageSpec,
} from "../_lib/stage-runner.js";
import { isValidHtmlDocument, type ValidationResult } from "../_lib/validators.js";

export const STAGE_E_SPEC_MODEL = "claude-sonnet-4-6";
export const STAGE_E_PROTOTYPE_MODEL = "claude-sonnet-4-6";

const SOLUTION_SYSTEM = `You are PM's solution designer. For ONE problem from the prioritized audit, produce a concrete, implementable solution spec.

Requirements:
- The change is SPECIFIC, not "improve onboarding". E.g., "Replace demo-request form with self-serve signup that lands on a pre-populated template canvas."
- why_right_fix ties directly back to the delta finding + leverage argument.
- unblocks lists other problem ids that become addressable or vanish, each with a one-line rationale.
- implementation_outline is a concrete checklist of steps — new routes, modified components, data model changes if any.
- effort_estimate is {size: trivial|small|medium|large, rationale, weeks_estimate?} — rationale must be scoped to the specific product, not generic.
- risks_and_tradeoffs: each entry is {risk, mitigation}. Real risks: loss of qualification signal for sales, security posture, template curation, etc.
- success_metric: {primary (one metric + threshold), target (quantified), measurement_window, secondary?}

Respond with ONE JSON object matching the Solution schema. Do NOT include prototype; that comes separately.`;

const PROTOTYPE_SYSTEM = `You are PM's prototype designer. Produce a SINGLE complete, self-contained HTML wireframe that shows the STRUCTURE of the proposed change — like a pencil-on-napkin sketch, not a polished design.

THIS IS A WIREFRAME, NOT A DESIGN.
You are not designing the product. You are showing where things go. A wireframe conveys intent with the lowest-fidelity visual treatment that still makes the structure clear. The goal is "I can see what the flow is and where the UI elements live" — not "this looks shippable."

OUTPUT SHAPE — non-negotiable:
Your response MUST be a full HTML5 document starting with <!doctype html> and containing <html>, <head>, and <body> elements. PM's semantic check rejects HTML fragments and retries, so include the full document structure on the first attempt.

Template:
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Wireframe — <short label></title>
  <style>/* inline CSS only */</style>
</head>
<body>
  <!-- structural wireframe + annotations -->
</body>
</html>

VISUAL RULES — strict:
- Grayscale ONLY. Allowed colors: pure #fff, pure #000, and gray shades (#f4f4f4, #e5e5e5, #cccccc, #999, #666, #333). NO blues, purples, reds, greens, teals, dark-mode navy, gradients, or accent colors. NO dark mode.
- Typography: system-ui or sans-serif, one font, two sizes max (body + heading). No custom fonts, no Google Fonts, no CDN links.
- No shadows. No rounded corners beyond 2px. No gradients. No background images. No SVG illustrations. No emoji.
- Borders are 1px solid gray (#ccc or #999). Use borders to show structure — panels, buttons, cards, input fields.
- Placeholder content: use realistic labels from the solution spec (no Lorem Ipsum), but keep it terse. A button says what it does ("Save", "Continue"). A table cell shows a realistic value. An input shows a placeholder hint.
- For images/charts/complex content, use a labeled box: a bordered <div> with text inside like "[chart: 30-day active users]" or "[user avatar]". Do not try to render the actual image.

STRUCTURAL FIDELITY:
- Mimic the existing product's layout where known (sidebar position, main content area, header, etc. — inferable from the solution spec's change.scope).
- Show enough structure that a reader can tell which screen this is and where the proposed change sits.

ANNOTATIONS:
- Add a simple annotation block at the top OR to the right of the wireframe with the heading "Change" (bold) and one short line: "Before: X → After: Y" followed by a one-sentence rationale.
- If calling out specific elements mid-wireframe, use a small numbered badge next to the element (1, 2, 3...) and list the numbered notes below or beside the sketch.
- Annotations use the same grayscale palette. No colored "highlight" boxes.

LENGTH:
- Aim for 100–300 lines of HTML. A wireframe is compact. If you're producing 500+ lines, you've probably wandered into design territory.

Return ONLY the HTML document. No prose, no code fences, no preamble. Starts with <!doctype html>, ends with </html>.`;

export interface StageEDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  artifactsDir: string;
  topN?: number;
  productBrandingHint?: string;
  // When the orchestrator wraps Stage E in withStageProgress, this
  // is the ctx from that wrapper. Stage E reports parallel progress
  // (N/M done, which ids are streaming) through noteParallel so the
  // UI shows a compact summary line instead of per-slot token counts.
  progressCtx?: StageProgressCtx;
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
    temperature: 0.1,
    responseFormat: "json",
    systemPrompt: SOLUTION_SYSTEM,
    userPrompt: user,
    parse: (raw) => jsonParse(raw),
    validate: zodValidate(SolutionNoProto),
    semanticCheck: stageESpecSemanticCheck,
    cacheSystem: true,
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
    // 8K not 4K: a full annotated HTML doc with inline CSS + before/
    // after call-outs routinely wants 5–7K tokens. 4K caused truncation
    // and sometimes dropped the closing </body></html>, which the
    // semantic check correctly caught but at the cost of full retries.
    maxTokens: 8_000,
    temperature: 0.3,
    responseFormat: "text",
    systemPrompt: PROTOTYPE_SYSTEM,
    userPrompt: user,
    parse: (raw) => textParse(raw),
    validate: (parsed) => parsed as string,
    semanticCheck: (html) => isValidHtmlDocument(html, { minChars: 500 }),
    cacheSystem: true,
  };

  const result = await runStage<string>(spec, {
    gateway: deps.gateway,
    logger: deps.logger,
    auditId: deps.auditId,
    sessionId: deps.sessionId,
  });
  return { html: result.output, neurons: result.totalNeurons };
}

// Bounded concurrency for the fan-out across solutions. v1.1.x kept
// this at 2 because Workers AI rate-limited aggressively and a 5×
// amplification of any transient failure was too costly. Anthropic
// handles this comfortably, so bump to 4 — matches the default top-N
// = 5 with 4 slots in flight at a time + one queued.
const STAGE_E_CONCURRENCY = 4;

async function mapWithConcurrency<In, Out>(
  items: In[],
  concurrency: number,
  worker: (item: In, index: number) => Promise<Out>,
): Promise<Out[]> {
  const results: Out[] = new Array(items.length);
  let next = 0;
  // Shared abort flag. When ANY pump's worker throws, we flip this,
  // so idle pumps stop picking up new items. Without it, a failure
  // on one track still lets the other N-1 tracks keep dispatching
  // and retrying — wasting rate-limit budget on results that will
  // never be consumed (the outer Promise.all already rejected).
  // The in-flight item each surviving pump is currently running
  // still runs to completion; cancelling the network call itself
  // would need AbortSignal threading through the gateway, which is
  // a larger refactor.
  let aborted = false;
  async function pump(): Promise<void> {
    while (!aborted) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i]!, i);
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  }
  const pumps = Array.from({ length: Math.min(concurrency, items.length) }, () => pump());
  await Promise.all(pumps);
  return results;
}

export async function runStageE(
  input: { problems: Problems; delta: Delta },
  deps: StageEDeps,
): Promise<StageEResult> {
  const topN = deps.topN ?? 5;
  const top = input.problems.problems.slice(0, topN);

  // Parallel-fanout progress: each solution holds a slot until both
  // its spec and its prototype complete, then moves to doneIds. The
  // renderer draws a single-line summary ("2/5 done (S001, S003) ·
  // 3 streaming · $0.18") instead of per-slot streaming — keeps the
  // TTY happy across varied terminal widths.
  let inFlight = 0;
  const doneIds: string[] = [];
  const emitParallel = (): void => {
    deps.progressCtx?.noteParallel({
      total: top.length,
      inFlight,
      doneIds: [...doneIds],
    });
  };
  emitParallel();

  const results = await mapWithConcurrency(top, STAGE_E_CONCURRENCY, async (problem) => {
    inFlight++;
    emitParallel();
    try {
      const specGenInput: SpecGenInput = { problem, delta: input.delta };
      if (deps.productBrandingHint) specGenInput.brandingHint = deps.productBrandingHint;
      const spec = await generateOneSpec(specGenInput, deps);
      const proto = await generatePrototypeHtml(spec.solution, deps);
      doneIds.push(spec.solution.id);
      return { spec, proto, problem };
    } finally {
      inFlight--;
      emitParallel();
    }
  });

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
