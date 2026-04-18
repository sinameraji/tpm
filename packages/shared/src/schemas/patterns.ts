import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const PatternCategory = z.enum([
  "entry",
  "activation",
  "first_value",
  "retention",
  "forms_data_collection",
  "intent_mismatch",
  "trust_security",
  "navigation",
  "pricing_paywall",
  "notifications",
  "empty_states",
  "configuration",
  "social_proof",
  "auth",
  "billing",
  "misc",
]);
export type PatternCategory = z.infer<typeof PatternCategory>;

export const PatternBody = z.object({
  summary: z.string(),
  works_when: z.array(z.string()),
  fails_when: z.array(z.string()),
  exemplars_good: z.array(z.string()),
  exemplars_bad: z.array(z.string()),
  detection_signals: z.array(z.string()),
  recommendation: z.string(),
});
export type PatternBody = z.infer<typeof PatternBody>;

export const Pattern = z.object({
  id: z.string(),
  title: z.string(),
  category: PatternCategory,
  body: PatternBody,
});
export type Pattern = z.infer<typeof Pattern>;

export const PatternsSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  library_hash: z.string(),
  patterns: z.array(Pattern),
});
export type Patterns = z.infer<typeof PatternsSchema>;
