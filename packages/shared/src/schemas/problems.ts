import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const Severity = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof Severity>;

export const Reach = z.enum(["single_persona", "some_personas", "all_personas"]);
export type Reach = z.infer<typeof Reach>;

export const FunnelPosition = z.enum(["entry", "activation", "first_value", "retention_loop"]);
export type FunnelPosition = z.infer<typeof FunnelPosition>;

export const BlastRadius = z.enum(["isolated", "unblocks_one", "unblocks_many"]);
export type BlastRadius = z.infer<typeof BlastRadius>;

export const Effort = z.enum(["trivial", "small", "medium", "large"]);
export type Effort = z.infer<typeof Effort>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const SourceFinding = z.object({
  delta_ref: z.string(),
});

export const Problem = z.object({
  id: z.string(),
  rank: z.number().int().positive(),
  title: z.string(),
  source_findings: z.array(SourceFinding),
  severity: Severity,
  reach: Reach,
  funnel_position: FunnelPosition,
  blast_radius: BlastRadius,
  effort_estimate: Effort,
  confidence: Confidence,
  leverage_argument: z.string(),
  unblocks: z.array(z.string()),
  related_patterns: z.array(z.string()),
});
export type Problem = z.infer<typeof Problem>;

export const ProblemsSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  audit_id: z.string(),
  generated_at: z.string(),
  model: z.string(),
  problems: z.array(Problem),
});
export type Problems = z.infer<typeof ProblemsSchema>;
