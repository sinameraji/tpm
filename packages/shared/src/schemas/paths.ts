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

export const PathsSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type Paths = z.infer<typeof PathsSchema>;
