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

export const DeltaSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type Delta = z.infer<typeof DeltaSchema>;
