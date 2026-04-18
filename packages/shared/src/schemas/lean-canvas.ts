import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const Confidence = z.number().min(0).max(1);

export const EvidencePointer = z.string();

const itemWithEvidence = <T extends z.ZodRawShape>(extra: T) =>
  z.object({
    ...extra,
    evidence: z.array(EvidencePointer),
    confidence: Confidence,
  });

export const ProblemItem = itemWithEvidence({ statement: z.string() });
export const SegmentItem = itemWithEvidence({ segment: z.string() });
export const UVP = z.object({
  statement: z.string(),
  evidence: z.array(EvidencePointer),
  confidence: Confidence,
});
export const SolutionItem = z.object({
  feature: z.string(),
  evidence: z.array(EvidencePointer),
});
export const ChannelItem = itemWithEvidence({ channel: z.string() });
export const RevenueItem = itemWithEvidence({ stream: z.string() });
export const MetricItem = z.object({
  metric: z.string(),
  evidence: z.array(EvidencePointer),
});
export const UnfairAdvantageItem = itemWithEvidence({ claim: z.string() });

export const CostStructure = z.object({
  extractable: z.literal(false),
  note: z.string().optional(),
});

export const LeanCanvasBody = z.object({
  problem: z.object({ items: z.array(ProblemItem) }),
  customer_segments: z.object({ items: z.array(SegmentItem) }),
  unique_value_proposition: UVP,
  solution: z.object({ items: z.array(SolutionItem) }),
  channels: z.object({ items: z.array(ChannelItem) }),
  revenue_streams: z.object({ items: z.array(RevenueItem) }),
  cost_structure: CostStructure,
  key_metrics: z.object({ items: z.array(MetricItem) }),
  unfair_advantage: z.object({ items: z.array(UnfairAdvantageItem) }),
});
export type LeanCanvasBody = z.infer<typeof LeanCanvasBody>;

export const IntendedJtbd = z.object({
  segment_id: z.string(),
  job: z.string(),
  actor: z.string(),
  trigger: z.string(),
  success_criterion: z.string(),
  confidence: Confidence,
});
export type IntendedJtbd = z.infer<typeof IntendedJtbd>;

export const IntendedValueMoment = z.object({
  segment_id: z.string(),
  value_moment: z.string(),
  rationale: z.string(),
  confidence: Confidence,
});
export type IntendedValueMoment = z.infer<typeof IntendedValueMoment>;

export const IntendedCriticalPath = z.object({
  segment_id: z.string(),
  ideal_steps: z.array(z.string()),
  estimated_step_count: z.number().int().nonnegative(),
  source: z.string(),
  confidence: Confidence,
});
export type IntendedCriticalPath = z.infer<typeof IntendedCriticalPath>;

export const LeanCanvasSource = z.object({
  type: z.enum([
    "landing_page",
    "pricing_page",
    "features_page",
    "docs",
    "codebase_static_map",
    "other",
  ]),
  url: z.string().optional(),
  hash: z.string().optional(),
  scraped_at: z.string().optional(),
});

export const LeanCanvasSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  extracted_at: z.string(),
  model: z.string(),
  sources: z.array(LeanCanvasSource),
  lean_canvas: LeanCanvasBody,
  intended_jtbd_per_segment: z.array(IntendedJtbd),
  intended_value_moments: z.array(IntendedValueMoment),
  intended_critical_paths: z.array(IntendedCriticalPath),
});
export type LeanCanvas = z.infer<typeof LeanCanvasSchema>;
