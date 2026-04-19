import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const FrictionFlagType = z.enum([
  "premature_data_collection",
  "required_without_rationale",
  "blank_page_anxiety",
  "forced_tour",
  "configuration_theater",
  "verification_before_value",
  "intent_mismatch",
  "dead_end",
  "fork_without_signal",
  "cycle_detected",
  "orphan_state",
  "missing_affordance",
]);
export type FrictionFlagType = z.infer<typeof FrictionFlagType>;

export const FrictionFlag = z.object({
  type: FrictionFlagType,
  detail: z.string(),
});
export type FrictionFlag = z.infer<typeof FrictionFlag>;

export const Decision = z.enum([
  "click",
  "fill_form",
  "navigate",
  "scroll",
  "wait",
  "go_back",
  "stuck",
  "value_reached",
]);
export type Decision = z.infer<typeof Decision>;

export const Step = z.object({
  n: z.number().int().positive(),
  // screen_id references app-model.screens[].id. Non-null when the
  // step occurs on a screen B-model identified; null for transitions
  // that don't correspond to a known screen (e.g., external redirect).
  screen_id: z.string().nullable(),
  // Human-readable breadcrumb — file_path, route, or window label,
  // whichever the app model exposes. Not a machine-resolvable URL.
  location: z.string().nullable(),
  // Retained for web apps that DO have HTTP routes; nullable/optional
  // because desktop/mobile/CLI apps have none.
  url: z.string().nullable().optional(),
  observation_summary: z.string(),
  decision: Decision,
  target: z.string().nullable(),
  reasoning: z.string(),
  value_moment_reached: z.boolean(),
  friction_flags: z.array(FrictionFlag),
  action_error: z.string().optional(),
  screenshot_path: z.string().optional(),
});
export type Step = z.infer<typeof Step>;

export const OutcomeStatus = z.enum([
  "value_reached",
  "stuck",
  "step_budget_exhausted",
  "cycle_detected",
  "error",
  "skipped",
]);
export type OutcomeStatus = z.infer<typeof OutcomeStatus>;

export const Outcome = z.object({
  status: OutcomeStatus,
  loop_closed: z.boolean(),
  value_moment_reached: z.boolean(),
  time_to_value_ms: z.number().int().nullable(),
  stuck_at_step: z.number().int().nullable(),
  stuck_reason: z.string().nullable(),
});
export type Outcome = z.infer<typeof Outcome>;

export const PersonaPath = z.object({
  persona: z.string(),
  goal: z.string(),
  value_moment_target: z.string(),
  started_at: z.string(),
  ended_at: z.string(),
  step_budget: z.number().int().positive(),
  steps_taken: z.number().int().nonnegative(),
  entry_point: z.string(),
  steps: z.array(Step),
  outcome: Outcome,
});
export type PersonaPath = z.infer<typeof PersonaPath>;

export const PathsSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  audit_id: z.string(),
  generated_at: z.string(),
  model: z.string(),
  paths: z.array(PersonaPath),
});
export type Paths = z.infer<typeof PathsSchema>;
