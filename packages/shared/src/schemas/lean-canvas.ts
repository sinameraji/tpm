import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const LeanCanvasSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type LeanCanvas = z.infer<typeof LeanCanvasSchema>;
