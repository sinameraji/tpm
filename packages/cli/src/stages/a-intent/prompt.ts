import type { Map as MapNs } from "@tpm/shared";

export const STAGE_A_SYSTEM_PROMPT = `You are TPM, a Technical Product Manager that reconstructs product intent purely from a codebase.

Your job in Stage A is to fill in a Lean Canvas from the evidence in the code — README content, package.json, routes, components, user-facing strings (h1/h2/buttons/links), form fields, tracking events, auth providers. You do NOT have access to any deployed site. Everything comes from source.

From the Lean Canvas, you also derive: Intended JTBD per segment, Intended Value Moment per persona, Intended Critical Path per persona.

Rules you MUST follow:
1. Every claim cites evidence. Evidence is a short string describing the source in the code, e.g. "codebase_static_map: package.json description", "codebase_static_map: hero h1 'Bank-grade automation'", "codebase_static_map: /signup form has required company + role fields", "codebase_static_map: next-auth dependency + /app/api/auth route".
2. Every claim has a confidence score in [0,1]. Be calibrated — use 0.9+ only when evidence is explicit and consistent, 0.5 when inferring, 0.2 when guessing.
3. When the evidence is weak or absent, say so by returning fewer items (empty arrays are fine). Do NOT invent.
4. Cost structure is NOT extractable from code — return {"extractable": false}.
5. Unfair advantage often reads aspirational; only include items with clear evidence and mark low confidence when substantive.
6. For each customer segment, derive exactly one intended JTBD, one intended value moment, and one intended critical path, using the same segment_id string across the three.
7. Intended critical paths should reflect the PRODUCT BUILDER'S implicit intent — what the hero copy promises + what onboarding routes + navigation structure suggest. Not what a user actually experiences; Stage B infers that separately.
8. Respond with a single JSON object that matches the provided schema. No prose, no code fences, no commentary. The pipeline parses the output mechanically.`;

export interface StageAInput {
  map: MapNs.Map;
}

function compactMap(map: MapNs.Map): unknown {
  const byCtx: Record<string, string[]> = {};
  for (const s of map.visible_strings) {
    byCtx[s.context] = byCtx[s.context] ?? [];
    if ((byCtx[s.context] as string[]).length < 30) (byCtx[s.context] as string[]).push(s.text);
  }
  return {
    framework: map.framework,
    package: map.package,
    routes: map.routes.slice(0, 100),
    components_count: map.components.length,
    components_top: map.components.slice(0, 40).map((c) => c.name),
    forms: map.forms,
    visible_strings_by_context: byCtx,
    nav: map.navigation.slice(0, 40).map((n) => {
      const item: { label: string; href?: string } = { label: n.label };
      if (n.href !== undefined) item.href = n.href;
      return item;
    }),
    tracking_events: map.tracking_events.slice(0, 80),
    auth_providers: map.auth_providers,
  };
}

export function buildStageAUserPrompt(input: StageAInput): string {
  return [
    "Here is the static codebase map for this product. This is your ONLY evidence.",
    "",
    "=== STATIC MAP (codebase) ===",
    JSON.stringify(compactMap(input.map), null, 2),
    "",
    "=== TASK ===",
    "Produce ONE JSON object matching this TypeScript shape:",
    "",
    "type Output = {",
    "  schema_version: 1,",
    "  extracted_at: string, // ISO 8601",
    "  model: string,",
    "  sources: Array<{ type: 'codebase_static_map'|'other', hash?: string }>,",
    "  lean_canvas: {",
    "    problem: { items: Array<{ statement: string, evidence: string[], confidence: number }> },",
    "    customer_segments: { items: Array<{ segment: string, evidence: string[], confidence: number }> },",
    "    unique_value_proposition: { statement: string, evidence: string[], confidence: number },",
    "    solution: { items: Array<{ feature: string, evidence: string[] }> },",
    "    channels: { items: Array<{ channel: string, evidence: string[], confidence: number }> },",
    "    revenue_streams: { items: Array<{ stream: string, evidence: string[], confidence: number }> },",
    "    cost_structure: { extractable: false, note?: string },",
    "    key_metrics: { items: Array<{ metric: string, evidence: string[] }> },",
    "    unfair_advantage: { items: Array<{ claim: string, evidence: string[], confidence: number }> }",
    "  },",
    "  intended_jtbd_per_segment: Array<{ segment_id: string, job: string, actor: string, trigger: string, success_criterion: string, confidence: number }>,",
    "  intended_value_moments: Array<{ segment_id: string, value_moment: string, rationale: string, confidence: number }>,",
    "  intended_critical_paths: Array<{ segment_id: string, ideal_steps: string[], estimated_step_count: number, source: string, confidence: number }>",
    "}",
    "",
    "Return only the JSON object.",
  ].join("\n");
}
