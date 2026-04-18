import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const ConfigSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type Config = z.infer<typeof ConfigSchema>;
