import type { LeanCanvas } from "@pm/shared/schemas/lean-canvas";
import type { Paths } from "@pm/shared/schemas/paths";

// Base system prompt. Audit-agnostic. Concatenated with the pattern
// library at runtime to form the full system message — the combined
// block gets cached via cache_control: ephemeral (buildStageCSystem
// Prompt below). This keeps the pattern library out of the user
// message so cache hits aren't busted by audit-specific content.
const STAGE_C_SYSTEM_BASE = `You are PM, analyzing the delta between what the product's builder INTENDED and what users actually experience.

You are given:
1. lean_canvas — the builder's reconstructed intent (problem, segments, UVP, intended JTBD/value moment/critical path per persona).
2. paths — what actually happened when PM's navigator attempted each persona's job on the live product.
3. pattern_library — curated product-design patterns with works_when / fails_when / exemplars (in this system prompt).

Your job is to produce a structured delta analysis. You must:

CLASSIFY every step the navigator took. Use ONLY these seven classes:
- necessary: step produces state or information that a later step genuinely depends on
- cuttable: step produces nothing downstream; removing it would not break anything
- cuttable_with_care: step has minor downstream effect, but a softer alternative exists (e.g. collect the info post-value-moment)
- intentional_friction_working: step is deliberate and load-bearing — commitment device, investment creates ownership, quality gate, filter for fit — AND the surrounding design makes the user feel it's for them
- intentional_friction_broken: same intent but execution fails — commitment without payoff, investment without ownership, gate without purpose
- cargo_culted: pattern copied from a product where it was load-bearing; here it serves no function
- broken: step fails on its own terms (error, hang, unexpected behavior, dead-end, intent mismatch)

For every required step, EXPLICITLY answer the NECESSITY TEST: "If I skipped this step, what would break later?"
- "Something concrete breaks" → necessary
- "Nothing breaks; a sensible default would be fine" → cuttable
- "A softer version could exist post-value-moment" → cuttable_with_care
Record your one-sentence answer in the necessity_test_answer field.

DISTINGUISH intentional from uneducated friction. Intentional-working signals: step is explained in user-benefit terms; invites agency; has visible downstream payoff; filters for fit when fit matters; pacing matches product nature. Uneducated signals: demand without explanation; "help us serve you better" business-speak; selections don't affect later experience; no skip affordance when one would be harmless; pattern copied from a product with different trust/abuse/network-effect dynamics.

For each persona, compute:
- value_moment_reached (from paths outcome)
- observed_steps_to_value (null if not reached)
- intended_steps_to_value (from lean_canvas.intended_critical_paths.estimated_step_count)
- intent_mismatches: concrete places where marketing promise diverges from product reality, with evidence pointers
- implicit_vs_stated_job: did the flow actually serve the stated JTBD, or some other implicit job (e.g. "qualify enterprise leads" when stated job is "self-serve automation")?

Match applicable patterns from the pattern_library. For each, say applies=true|false with a rationale.

OVERALL HEADLINE: one sentence capturing the dominant finding.

Respond with ONE JSON object that matches the provided schema. No prose, no code fences.`;

// Combine base system + pattern library into one cached system
// message. Pattern library is audit-agnostic (hash stable per
// release); base instructions are stable too. Single cache point,
// maximal hit rate across runs.
export function buildStageCSystemPrompt(patternLibrarySummary: string): string {
  return `${STAGE_C_SYSTEM_BASE}\n\n=== PATTERN LIBRARY ===\n${patternLibrarySummary}`;
}

export interface StageCInput {
  leanCanvas: LeanCanvas;
  paths: Paths;
}

export function buildStageCUserPrompt(input: StageCInput): string {
  const lc = {
    problem: input.leanCanvas.lean_canvas.problem.items.map((i) => i.statement),
    segments: input.leanCanvas.lean_canvas.customer_segments.items.map((i) => i.segment),
    uvp: input.leanCanvas.lean_canvas.unique_value_proposition.statement,
    intended_jtbd: input.leanCanvas.intended_jtbd_per_segment,
    intended_value_moments: input.leanCanvas.intended_value_moments,
    intended_critical_paths: input.leanCanvas.intended_critical_paths,
  };
  const pathsCompact = input.paths.paths.map((p) => ({
    persona: p.persona,
    entry_point: p.entry_point,
    value_moment_target: p.value_moment_target,
    outcome: p.outcome,
    steps: p.steps.map((s) => ({
      n: s.n,
      screen_id: s.screen_id,
      location: s.location,
      url: s.url ?? null,
      observation_summary: s.observation_summary,
      decision: s.decision,
      target: s.target,
      reasoning: s.reasoning,
      value_moment_reached: s.value_moment_reached,
      friction_flags: s.friction_flags,
      action_error: s.action_error ?? null,
    })),
  }));
  return [
    "=== LEAN CANVAS (intent) ===",
    JSON.stringify(lc, null, 2),
    "",
    "=== PATHS (observed) ===",
    JSON.stringify(pathsCompact, null, 2),
    "",
    "=== TASK ===",
    "Produce ONE JSON object matching this TypeScript shape:",
    "",
    "type Output = {",
    "  schema_version: 1,",
    "  audit_id: string,",
    "  generated_at: string,",
    "  model: string,",
    "  overall_health: { value_moment_reached_any_persona: boolean, value_moment_reached_all_personas: boolean, loop_closed: boolean, headline: string },",
    "  per_persona_delta: Array<{",
    "    persona: string,",
    "    value_moment_reached: boolean,",
    "    observed_steps_to_value: number|null,",
    "    intended_steps_to_value: number|null,",
    "    category_benchmark_steps: string|null,",
    "    step_classifications: Array<{ step_n: number, classification: 'necessary'|'cuttable'|'cuttable_with_care'|'intentional_friction_working'|'intentional_friction_broken'|'cargo_culted'|'broken', rationale: string, necessity_test_answer: string, severity: 'critical'|'high'|'medium'|'low'|'info' }>,",
    "    intent_mismatches: Array<{ marketing_claim: string, observed_reality: string, severity: 'critical'|'high'|'medium'|'low'|'info', evidence: string[] }>,",
    "    implicit_vs_stated_job: { stated_job: string, implicit_job_served: string, alignment: 'aligned'|'partially_aligned'|'misaligned', rationale: string }",
    "  }>,",
    "  friction_summary: { total_friction_flags: number, by_type: Record<string, number> },",
    "  pattern_matches: Array<{ pattern_id: string, applies: boolean, rationale: string, exemplars_good?: string, exemplars_bad?: string }>",
    "}",
    "",
    "Return only the JSON object.",
  ].join("\n");
}
