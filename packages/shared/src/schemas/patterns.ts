import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const PatternsSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type Patterns = z.infer<typeof PatternsSchema>;
