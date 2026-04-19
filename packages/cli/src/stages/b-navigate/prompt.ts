import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { AppModel } from "@tpm/shared/schemas/app-model";

// B-walk prompt: imagine a persona's journey using the verified
// AppModel, NOT the raw code map. The prompt is app-type-agnostic
// because AppModel already abstracts away "is this a web app, a
// desktop app, a mobile app?" — the persona walks between screen_ids
// and the screens themselves carry file_paths + labels.

export const INFERRED_PATH_SYSTEM_PROMPT = `You are TPM, imagining what a user experiences when they use this product.

You are given:
1. The product's reconstructed intent (Lean Canvas + intended JTBD / value moment / ideal path for one persona).
2. An app_model: a verified structural model of the product's entry points, walls (auth, paywall, onboarding, etc.), screens, and navigation graph — produced by reading the codebase.

Your job is to mentally walk through the product AS THE PERSONA, using ONLY the app_model. You do not run the product. You do not invent screens. Every step references a concrete screen_id from app_model.screens.

For the assigned persona, produce 8-20 imagined steps that reach the intended value moment — or fail to reach it, which is often the more honest outcome. For each step:

- n: step number (1-indexed, sequential)
- screen_id: the screen_id (from app_model.screens[].id) the persona is on at this step. May be null ONLY for the very first step before any entry_point opens a screen, or for a transition to an external destination.
- location: human-readable breadcrumb — copy from app_model.screens[].file_path OR construct from the screen's title. For an external transition, describe where the user went ("external: <url or label>"). For CLI/library projects that have no screens, location is the command or function name.
- url: a real HTTP route if AND ONLY IF the app serves HTTP and you can infer the route from the screen's file_path (Next.js-style pages/, Remix routes, Express paths). Otherwise null. Do NOT invent URLs for desktop or mobile apps.
- observation_summary: one sentence on what the persona would see at this point, inferred from the screen's visible_elements
- decision: one of click | fill_form | navigate | scroll | wait | go_back | stuck | value_reached
- target: the visible_element label or transition trigger you believe they'd interact with, or null for stuck/value_reached
- reasoning: 1-2 sentences on WHY this is the next move for this persona, citing specific visible_elements or transitions from the app_model
- value_moment_reached: boolean — true ONLY when the persona is LOOKING AT evidence of the value moment. Be conservative.
- friction_flags: array of { type, detail } entries. TYPE must be one of:
    premature_data_collection | required_without_rationale | blank_page_anxiety | forced_tour |
    configuration_theater | verification_before_value | intent_mismatch | dead_end |
    fork_without_signal | cycle_detected | orphan_state | missing_affordance

HARD RULES:
- You MAY ONLY use screen_ids that exist in app_model.screens[].id. Inventing a screen_id is a hard failure.
- You MAY ONLY use transitions that exist in app_model.navigation_graph — or explicitly note when the persona is blocked because no transition leads to the required screen (this is a dead_end friction).
- Walls are real: if a screen's gated_by_walls is non-empty, the persona encounters that wall before reaching the screen. Model the wall step explicitly.
- If app_model.screens is empty (headless API, library, CLI with no interactive UI), respond with outcome.status="skipped" and a stuck_reason explaining the project has no user-facing journey to walk.
- If the persona literally cannot reach the value moment because the app_model has no path to it, terminate with decision=stuck and an honest reasoning.
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

// Compact projection of the app model for the walker — full fidelity
// on screens/walls/transitions, but omit fields the walker doesn't
// need (synthesis_notes, seed_files_used). Keeps the prompt tight.
function compactAppModel(appModel: AppModel): unknown {
  return {
    profile_summary: appModel.profile.description,
    entry_points: appModel.entry_points,
    walls: appModel.walls,
    screens: appModel.screens.map((s) => ({
      id: s.id,
      title: s.title,
      file_path: s.file_path,
      is_entry: s.is_entry,
      gated_by_walls: s.gated_by_walls,
      visible_elements: s.visible_elements,
    })),
    navigation_graph: appModel.navigation_graph,
    known_unknowns: appModel.known_unknowns,
  };
}

export function buildInferredPathUserPrompt(briefing: PersonaBriefing, appModel: AppModel): string {
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
    "=== APP MODEL (verified from codebase) ===",
    JSON.stringify(compactAppModel(appModel), null, 2),
    "",
    "=== TASK ===",
    "Imagine this persona using this product. Produce ONE JSON object matching:",
    "",
    "type Output = {",
    "  steps: Array<{",
    "    n: number,",
    "    screen_id: string | null,",
    "    location: string | null,",
    "    url: string | null,",
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
    "Return only the JSON object. 8-20 steps, 25 max. If screens is empty, respond with status='skipped'.",
  ].join("\n");
}
