import type { Map as MapNs } from "@tpm/shared";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";

export const INFERRED_PATH_SYSTEM_PROMPT = `You are TPM, imagining what a user experiences when they use this product.

You are given:
1. The product's reconstructed intent (Lean Canvas + intended JTBD / value moment / ideal path per persona).
2. A static map of the codebase: routes, components, forms with their fields, navigation structure, tracking events, auth providers.

Your job is to mentally walk through the product AS THE PERSONA — without running it. You read the code the way a senior PM reads code: infer what each route renders, what copy the user sees, what forms they hit, what auth gates block them, and what friction shows up along the way.

This is NOT a browser walk. You never run the product. You reason about the product from its source alone.

For the assigned persona, produce 8-20 imagined steps that reach the intended value moment — or fail to reach it, which is often the more honest outcome. For each step:

- n: step number (1-indexed, sequential)
- url: the route/path the persona is on (infer from the static map — e.g. "/", "/signup", "/dashboard"; if the codebase doesn't expose that route, write "(not in code)" as a friction signal)
- observation_summary: one sentence on what the persona would see at this point, inferred from the route's component, forms, copy
- decision: one of click | fill_form | navigate | scroll | wait | go_back | stuck | value_reached
- target: the selector or route or button label you believe they'd interact with, or null for stuck/value_reached
- reasoning: 1-2 sentences on WHY this is the next move for this persona, and what the code led you to conclude
- value_moment_reached: boolean — true ONLY when the persona is LOOKING AT evidence of the value moment (e.g., their first workflow running, their first message delivered). Be conservative.
- friction_flags: array of { type, detail } entries. TYPE must be one of:
    premature_data_collection | required_without_rationale | blank_page_anxiety | forced_tour |
    configuration_theater | verification_before_value | intent_mismatch | dead_end |
    fork_without_signal | cycle_detected | orphan_state | missing_affordance

RULES:
- Cite what in the CODE told you about this step. "Signup form has required company/role/use_case fields" → premature_data_collection. "Dashboard component renders an empty list with no create button" → blank_page_anxiety. "Marketing hero says 'free trial' but /signup redirects to /contact-sales" → intent_mismatch.
- If there IS no code path to the value moment, terminate with decision=stuck and an honest reasoning.
- If signup requires email verification / phone / payment that would block a cold user from proceeding, flag verification_before_value.
- Do not invent routes that aren't in the static map; if the map doesn't show a /signup, the persona can't sign up.
- Respond with ONE JSON object. No prose, no code fences.`;

export interface PersonaBriefing {
  persona: string; // segment_id
  actor: string;
  job: string;
  trigger: string;
  successCriterion: string;
  valueMoment: string;
  uvp: string;
  idealSteps: string[];
}

export function extractPersonaBriefing(
  canvas: LeanCanvas,
  segmentId: string,
): PersonaBriefing | null {
  const jtbd = canvas.intended_jtbd_per_segment.find((j) => j.segment_id === segmentId);
  const vm = canvas.intended_value_moments.find((v) => v.segment_id === segmentId);
  const ideal = canvas.intended_critical_paths.find((p) => p.segment_id === segmentId);
  if (!jtbd || !vm) return null;
  return {
    persona: segmentId,
    actor: jtbd.actor,
    job: jtbd.job,
    trigger: jtbd.trigger,
    successCriterion: jtbd.success_criterion,
    valueMoment: vm.value_moment,
    uvp: canvas.lean_canvas.unique_value_proposition.statement,
    idealSteps: ideal?.ideal_steps ?? [],
  };
}

function compactMap(map: MapNs.Map): unknown {
  return {
    framework: map.framework,
    package: {
      name: map.package.name,
      description: map.package.description,
      dependencies: map.package.dependencies.slice(0, 30),
    },
    routes: map.routes.slice(0, 100),
    components_top: map.components.slice(0, 40).map((c) => c.name),
    forms: map.forms,
    visible_strings: map.visible_strings.slice(0, 150),
    navigation: map.navigation.slice(0, 40),
    auth_providers: map.auth_providers,
  };
}

export function buildInferredPathUserPrompt(briefing: PersonaBriefing, map: MapNs.Map): string {
  return [
    "=== PERSONA ===",
    `actor: ${briefing.actor}`,
    `job: ${briefing.job}`,
    `trigger: ${briefing.trigger}`,
    `success criterion: ${briefing.successCriterion}`,
    `value moment: ${briefing.valueMoment}`,
    `product UVP (for reference): ${briefing.uvp}`,
    briefing.idealSteps.length > 0
      ? `\nIntended ideal path (from Stage A):\n  ${briefing.idealSteps.map((s, i) => `${i + 1}. ${s}`).join("\n  ")}`
      : "",
    "",
    "=== STATIC CODE MAP ===",
    JSON.stringify(compactMap(map), null, 2),
    "",
    "=== TASK ===",
    "Imagine this persona using this product. Produce ONE JSON object matching:",
    "",
    "type Output = {",
    "  steps: Array<{",
    "    n: number,",
    "    url: string,",
    "    observation_summary: string,",
    "    decision: 'click'|'fill_form'|'navigate'|'scroll'|'wait'|'go_back'|'stuck'|'value_reached',",
    "    target: string | null,",
    "    reasoning: string,",
    "    value_moment_reached: boolean,",
    "    friction_flags: Array<{ type: string, detail: string }>",
    "  }>,",
    "  outcome: {",
    "    status: 'value_reached' | 'stuck' | 'step_budget_exhausted' | 'cycle_detected' | 'error' | 'skipped',",
    "    loop_closed: boolean,",
    "    value_moment_reached: boolean,",
    "    stuck_reason: string | null",
    "  }",
    "}",
    "",
    "Return only the JSON object. 8-20 steps, 25 max.",
  ].join("\n");
}
