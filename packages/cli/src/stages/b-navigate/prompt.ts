import type { DomState } from "./browser.js";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";

export const NAVIGATOR_SYSTEM_PROMPT = `You are TPM's navigator, acting as a real user of a software product.

Your assignment for this session:
- ACTOR: {{actor}}
- JOB: {{job}}
- TRIGGER: {{trigger}}
- SUCCESS CRITERION: {{success_criterion}}
- VALUE MOMENT: {{value_moment}}

You reach the value moment by using the product. If the product requires signup / login to do the job, use the provided test credentials. Do not stall on optional steps. Prefer the action that most directly advances toward the value moment.

For every step you produce a JSON decision with:
- observation_summary: 1 sentence on what you see
- decision: one of click | fill_form | navigate | scroll | wait | go_back | stuck | value_reached
- target: the selector (for click/fill_form/submit), url (for navigate), or null (for stuck/value_reached)
- fill_values: object mapping selector → value, ONLY when decision is fill_form
- reasoning: 1-2 sentences; what this action buys toward the value moment
- value_moment_reached: boolean — true ONLY when you are LOOKING AT evidence of the value moment (e.g. first workflow running, first message sent and visible, etc.)
- friction_flags: array of { type, detail } entries, choosing types ONLY from this fixed set:
  premature_data_collection | required_without_rationale | blank_page_anxiety | forced_tour | configuration_theater | verification_before_value | intent_mismatch | dead_end | fork_without_signal | cycle_detected | orphan_state | missing_affordance
- If you believe you cannot make progress: decision = "stuck", target = null, and set a clear reason in reasoning.

Respond with a SINGLE JSON object. No prose, no code fences.`;

export interface NavigatorStepContext {
  actor: string;
  job: string;
  trigger: string;
  successCriterion: string;
  valueMoment: string;
  stepsRemaining: number;
  priorSteps: Array<{ url: string; decision: string; target: string | null }>;
  dom: DomState;
  intendedUvp: string;
  testCredsNote: string | null;
}

export function fillSystemPrompt(vars: {
  actor: string;
  job: string;
  trigger: string;
  successCriterion: string;
  valueMoment: string;
}): string {
  return NAVIGATOR_SYSTEM_PROMPT.replace("{{actor}}", vars.actor)
    .replace("{{job}}", vars.job)
    .replace("{{trigger}}", vars.trigger)
    .replace("{{success_criterion}}", vars.successCriterion)
    .replace("{{value_moment}}", vars.valueMoment);
}

export function buildNavigatorUserPrompt(ctx: NavigatorStepContext): string {
  const cliplist = ctx.dom.clickables
    .slice(0, 25)
    .map(
      (c) =>
        `  - [${c.kind}] "${c.label}" selector=${c.selector}${c.href ? ` href=${c.href}` : ""}`,
    )
    .join("\n");
  const forms =
    ctx.dom.forms.length === 0
      ? "(none)"
      : ctx.dom.forms
          .map(
            (f, i) =>
              `  form ${i} (selector=${f.selector}, action=${f.action ?? "?"}):\n` +
              f.fields
                .map(
                  (field) =>
                    `    - name="${field.name}" type="${field.type}" required=${String(field.required)} selector=${field.selector}`,
                )
                .join("\n"),
          )
          .join("\n");
  const prior =
    ctx.priorSteps.length === 0
      ? "(none — this is step 1)"
      : ctx.priorSteps
          .slice(-8)
          .map(
            (p, i) =>
              `  ${i + 1}. url=${p.url} decision=${p.decision} target=${p.target ?? "null"}`,
          )
          .join("\n");

  return [
    `URL: ${ctx.dom.url}`,
    `TITLE: ${ctx.dom.title}`,
    `H1: ${ctx.dom.h1.join(" | ") || "(none)"}`,
    `H2: ${ctx.dom.h2.slice(0, 5).join(" | ") || "(none)"}`,
    ``,
    `VISIBLE TEXT (truncated):`,
    ctx.dom.visible_text.slice(0, 2000),
    ``,
    `CLICKABLES:`,
    cliplist || "  (none)",
    ``,
    `FORMS:`,
    forms,
    ``,
    `STEPS REMAINING: ${ctx.stepsRemaining}`,
    ``,
    `RECENT STEPS:`,
    prior,
    ``,
    `PRODUCT UVP (reminder): ${ctx.intendedUvp}`,
    ctx.testCredsNote ? `\nTEST CREDENTIALS AVAILABLE: ${ctx.testCredsNote}` : "",
    ``,
    `What is your next step? Respond with a single JSON object.`,
  ].join("\n");
}

export interface NavigatorStepContextFromCanvas {
  canvas: LeanCanvas;
  segmentId: string;
}

export function extractPersonaBriefing(
  canvas: LeanCanvas,
  segmentId: string,
): {
  actor: string;
  job: string;
  trigger: string;
  successCriterion: string;
  valueMoment: string;
  uvp: string;
} | null {
  const jtbd = canvas.intended_jtbd_per_segment.find((j) => j.segment_id === segmentId);
  const vm = canvas.intended_value_moments.find((v) => v.segment_id === segmentId);
  if (!jtbd || !vm) return null;
  return {
    actor: jtbd.actor,
    job: jtbd.job,
    trigger: jtbd.trigger,
    successCriterion: jtbd.success_criterion,
    valueMoment: vm.value_moment,
    uvp: canvas.lean_canvas.unique_value_proposition.statement,
  };
}
