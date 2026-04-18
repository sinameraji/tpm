import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const Tier = z.enum(["free", "pro", "team"]);
export type Tier = z.infer<typeof Tier>;

export const LicenseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type License = z.infer<typeof LicenseSchema>;
