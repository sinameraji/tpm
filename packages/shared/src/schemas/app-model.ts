import { z } from "zod";
import { ProjectProfileSchema } from "./project-profile.js";

// B-model output: the structured model of how a user moves through
// the app.
//
// DESIGN PRINCIPLE — structure + referential integrity, never taxonomy.
// Screens / walls / transitions are TPM's auditing lens (downstream
// stages C/D/E consume these to compute delta, rank problems, design
// solutions). That's our contract, not a claim about the world. But
// WITHIN those objects: `kind_label`, `type_label` etc. are free-form
// strings — the set of wall types and UI primitives is unbounded
// (waitlists, invite gates, rate limits, region blocks, modal tours,
// slide-overs, custom renderers), and closed enums would just force
// the model to lie.

export const VisibleElement = z.object({
  kind_label: z.string(),
  label: z.string().nullable(),
  action: z
    .object({
      kind_label: z.string(),
      target_screen_id: z.string().nullable(),
      handler_file: z.string().nullable(),
      handler_symbol: z.string().nullable(),
    })
    .nullable(),
});
export type VisibleElement = z.infer<typeof VisibleElement>;

export const Screen = z.object({
  id: z.string(),
  title: z.string(),
  file_path: z.string(),
  is_entry: z.boolean(),
  gated_by_walls: z.array(z.string()),
  visible_elements: z.array(VisibleElement),
  known_unknowns: z.array(z.string()),
});
export type Screen = z.infer<typeof Screen>;

export const Wall = z.object({
  id: z.string(),
  type_label: z.string(),
  blocks_screens: z.array(z.string()),
  bypass_condition: z.string().nullable(),
  redirect_on_success: z.string().nullable(),
  file_path: z.string(),
  evidence: z.string(),
});
export type Wall = z.infer<typeof Wall>;

export const EntryPoint = z.object({
  id: z.string(),
  kind_label: z.string(),
  file_path: z.string(),
  opens_screen_id: z.string().nullable(),
  notes: z.string(),
});
export type EntryPoint = z.infer<typeof EntryPoint>;

export const Transition = z.object({
  id: z.string(),
  from_screen: z.string(),
  trigger: z.string(),
  to_screen: z.string().nullable(),
  handler_file: z.string().nullable(),
  is_external: z.boolean(),
});
export type Transition = z.infer<typeof Transition>;

export const SynthesisNote = z.object({
  claim: z.string(),
  resolution: z.string(),
  evidence: z.string(),
});
export type SynthesisNote = z.infer<typeof SynthesisNote>;

export const AppModelSchema = z.object({
  schema_version: z.literal(1),
  audit_id: z.string(),
  generated_at: z.string(),
  // Multiple models may contribute via the ensemble+synthesizer path.
  models: z.array(z.string()),
  profile: ProjectProfileSchema,
  entry_points: z.array(EntryPoint).min(1),
  // Walls/screens/nav may be empty — headless APIs, libraries, and
  // pure scripts have no user-facing journey. Honest empty is better
  // than forced invention.
  walls: z.array(Wall),
  screens: z.array(Screen),
  navigation_graph: z.array(Transition),
  known_unknowns: z.array(z.string()),
  seed_files_used: z.array(z.string()),
  synthesis_notes: z.array(SynthesisNote).optional(),
});
export type AppModel = z.infer<typeof AppModelSchema>;

// What a single modeler returns (no synthesis_notes yet — the
// synthesizer attaches those later). The shape is otherwise identical
// to AppModelSchema so the synthesizer can consume both branches with
// one type.
export const ModelerOutputSchema = AppModelSchema.extend({
  models: z.array(z.string()).length(1),
}).omit({ synthesis_notes: true });
export type ModelerOutput = z.infer<typeof ModelerOutputSchema>;
