import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const SolutionsSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type Solutions = z.infer<typeof SolutionsSchema>;
