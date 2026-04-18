import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const EffortEstimate = z.object({
  size: z.enum(["trivial", "small", "medium", "large"]),
  rationale: z.string(),
  weeks_estimate: z.string().optional(),
});

export const SuccessMetric = z.object({
  primary: z.string(),
  target: z.string(),
  measurement_window: z.string(),
  secondary: z.array(z.string()).optional(),
});

export const RiskAndTradeoff = z.object({
  risk: z.string(),
  mitigation: z.string(),
});

export const SolutionChange = z.object({
  what: z.string(),
  scope: z.array(z.string()),
});

export const Unblocks = z.object({
  problem_id: z.string(),
  rationale: z.string(),
});

export const PrototypeRef = z.object({
  path: z.string(),
  description: z.string(),
});

export const Solution = z.object({
  id: z.string(),
  problem_ref: z.string(),
  title: z.string(),
  change: SolutionChange,
  why_right_fix: z.string(),
  unblocks: z.array(Unblocks),
  implementation_outline: z.array(z.string()),
  effort_estimate: EffortEstimate,
  risks_and_tradeoffs: z.array(RiskAndTradeoff),
  success_metric: SuccessMetric,
  prototype: PrototypeRef.optional(),
});
export type Solution = z.infer<typeof Solution>;

export const SolutionsSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  audit_id: z.string(),
  generated_at: z.string(),
  model_spec: z.string(),
  model_prototype: z.string(),
  solutions: z.array(Solution),
});
export type Solutions = z.infer<typeof SolutionsSchema>;
