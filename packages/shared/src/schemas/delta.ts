import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const StepClassification = z.enum([
  "necessary",
  "cuttable",
  "cuttable_with_care",
  "intentional_friction_working",
  "intentional_friction_broken",
  "cargo_culted",
  "broken",
]);
export type StepClassification = z.infer<typeof StepClassification>;

export const Severity = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof Severity>;

export const StepClassificationEntry = z.object({
  step_n: z.number().int().positive(),
  classification: StepClassification,
  rationale: z.string(),
  necessity_test_answer: z.string(),
  severity: Severity,
});
export type StepClassificationEntry = z.infer<typeof StepClassificationEntry>;

export const IntentMismatch = z.object({
  marketing_claim: z.string(),
  observed_reality: z.string(),
  severity: Severity,
  evidence: z.array(z.string()),
});
export type IntentMismatch = z.infer<typeof IntentMismatch>;

export const PatternMatch = z.object({
  pattern_id: z.string(),
  applies: z.boolean(),
  rationale: z.string(),
  exemplars_good: z.string().optional(),
  exemplars_bad: z.string().optional(),
});
export type PatternMatch = z.infer<typeof PatternMatch>;

export const ImplicitVsStated = z.object({
  stated_job: z.string(),
  implicit_job_served: z.string(),
  alignment: z.enum(["aligned", "partially_aligned", "misaligned"]),
  rationale: z.string(),
});

export const PerPersonaDelta = z.object({
  persona: z.string(),
  value_moment_reached: z.boolean(),
  observed_steps_to_value: z.number().int().nullable(),
  intended_steps_to_value: z.number().int().nullable(),
  category_benchmark_steps: z.string().nullable(),
  step_classifications: z.array(StepClassificationEntry),
  intent_mismatches: z.array(IntentMismatch),
  implicit_vs_stated_job: ImplicitVsStated,
});
export type PerPersonaDelta = z.infer<typeof PerPersonaDelta>;

export const OverallHealth = z.object({
  value_moment_reached_any_persona: z.boolean(),
  value_moment_reached_all_personas: z.boolean(),
  loop_closed: z.boolean(),
  headline: z.string(),
});

export const FrictionSummary = z.object({
  total_friction_flags: z.number().int().nonnegative(),
  by_type: z.record(z.string(), z.number().int().nonnegative()),
});

export const DeltaSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  audit_id: z.string(),
  generated_at: z.string(),
  model: z.string(),
  overall_health: OverallHealth,
  per_persona_delta: z.array(PerPersonaDelta),
  friction_summary: FrictionSummary,
  pattern_matches: z.array(PatternMatch),
});
export type Delta = z.infer<typeof DeltaSchema>;
