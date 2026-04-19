import { z } from "zod";

// B-classify output: what the LLM agent decided about the project.
//
// DESIGN PRINCIPLE — "structure over taxonomy."
// This schema encodes the downstream contract (what deterministic TS
// code needs to consume next) and nothing more. We do not list slots
// for "primary_language", "ui_stack", "runtime", "deployment_target",
// "auth_surface", etc. — that would presume a theory of what projects
// look like, and TPM audits any kind of project (Jupyter research
// repos, Unity games, Kotlin multiplatform libraries, Rust CLIs,
// Electron desktops). All descriptive detail lives inside
// `description` where the model writes it in its own words. The only
// structured fields are (a) the natural-language description and (b)
// the file paths the next step must read, because deterministic code
// opens those files next.

export const EntryPointCandidate = z.object({
  // Must exist in the RepoSnapshot OR have been sent to the model
  // via a "request_files" round; semantic-checked in runStage.
  file_path: z.string(),
  rationale: z.string(),
});
export type EntryPointCandidate = z.infer<typeof EntryPointCandidate>;

export const ScreenCandidate = z.object({
  file_path: z.string(),
  rationale: z.string(),
});
export type ScreenCandidate = z.infer<typeof ScreenCandidate>;

export const ProjectProfileSchema = z.object({
  schema_version: z.literal(1),
  // Natural-language project description — language, stack, runtime,
  // purpose, deployment target, whatever facets the model judges
  // relevant. No pre-factored slots.
  description: z.string().min(40),
  candidate_entry_points: z.array(EntryPointCandidate).min(1),
  candidate_screen_files: z.array(ScreenCandidate),
  // TPM's own trust-in-the-result taxonomy, not a claim about projects.
  confidence: z.enum(["high", "medium", "low"]),
  unknowns: z.array(z.string()),
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

// B-classify response: either the model wants more files, or it's done.
// Discriminated union means runStage can validate either branch without
// forcing the model to always emit every field.
export const ClassifierResponse = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("request_files"),
    reason: z.string(),
    // Paths the model wants us to read and echo back in round 2.
    // Capped at 6 so one round stays under the context budget.
    request_files: z.array(z.string()).min(1).max(6),
  }),
  z.object({
    mode: z.literal("final"),
    profile: ProjectProfileSchema,
  }),
]);
export type ClassifierResponse = z.infer<typeof ClassifierResponse>;
