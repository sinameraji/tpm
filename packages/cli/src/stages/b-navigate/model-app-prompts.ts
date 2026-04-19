import type { ProjectProfile } from "@tpm/shared/schemas/project-profile";
import type { ModelerOutput } from "@tpm/shared/schemas/app-model";
import type { RequestedFile } from "./classify-project-prompt.js";
import type { DisputeExcerpt } from "./model-app-diff.js";

// ─────────────────────────────────────────────────────────────
// MODELER PROMPT — what a single "eyes on the codebase" call sees.
// ─────────────────────────────────────────────────────────────

export const MODELER_SYSTEM_PROMPT = `You are a senior engineer reading a codebase cold. You do not execute the code. You do not guess. Your job is to produce a verifiable structural model of how a user moves through this app — a navigation graph rooted at concrete entry points, with any walls (auth, paywall, onboarding, waitlist, feature flag, rate limit, region block, or whatever the code actually contains) that gate access to screens.

You will receive:
- A project_profile describing what kind of project this is (B-classify's output).
- seed_files — the actual file contents the classifier identified as load-bearing.
- lean_canvas_intent (context only — DO NOT let it bias what you see in the code).

HARD RULES:
1. Every file_path in your output must come from seed_files. If you need a file that isn't in seed_files, record the gap in known_unknowns with the reason. DO NOT INVENT PATHS.
2. Every Transition must either cite a handler_file from seed_files OR have is_external=true.
3. Every Screen must be anchored to a specific file in seed_files.
4. Walls are real only when you can quote the code that enforces them — put the quoted span (2-5 lines is enough) in evidence.
5. If a seed_file was truncated, DO NOT speculate about content past the truncation line. Put any uncertainty in known_unknowns.
6. Label kinds and types in natural language. Examples of common entry_point kind_label: "main process", "renderer root", "web page handler", "cli command", "mobile screen root". Examples of common wall type_label: "auth wall", "paywall", "onboarding", "feature flag", "rate limit". But if this project has something you don't have a common label for (an invite-only gate, a region block, a setup wizard), label it honestly in your own words.
7. screens/walls/navigation_graph MAY be empty arrays if the project is a headless API, a library, or a script with no user-facing journey. Honest empty is better than forced invention.
8. entry_points must have at least one element. Every runnable artifact has some entry.

RESPOND WITH ONE JSON OBJECT matching this TypeScript shape — no prose, no code fences:

type ModelerOutput = {
  schema_version: 1;
  audit_id: string;     // passed in, echo back
  generated_at: string; // ISO 8601 UTC now
  models: [string];     // your own model id, single element
  profile: ProjectProfile; // pass through unchanged
  entry_points: Array<{ id: string; kind_label: string; file_path: string; opens_screen_id: string | null; notes: string }>;
  walls: Array<{ id: string; type_label: string; blocks_screens: string[]; bypass_condition: string | null; redirect_on_success: string | null; file_path: string; evidence: string }>;
  screens: Array<{ id: string; title: string; file_path: string; is_entry: boolean; gated_by_walls: string[]; visible_elements: Array<{ kind_label: string; label: string | null; action: { kind_label: string; target_screen_id: string | null; handler_file: string | null; handler_symbol: string | null } | null }>; known_unknowns: string[] }>;
  navigation_graph: Array<{ id: string; from_screen: string; trigger: string; to_screen: string | null; handler_file: string | null; is_external: boolean }>;
  known_unknowns: string[];
  seed_files_used: string[]; // every path that appears anywhere in your output
};

Stable id format: E001/E002 for entry_points, W001 for walls, S001 for screens, T001 for transitions.`;

export function buildModelerUserPrompt(input: {
  auditId: string;
  profile: ProjectProfile;
  seedFiles: RequestedFile[];
  leanCanvasIntent: string;
}): string {
  const seedFileBlocks = input.seedFiles.map((f) => {
    const header = f.truncated_at_line
      ? `--- ${f.path} (first ${f.truncated_at_line} lines) ---`
      : `--- ${f.path} ---`;
    return [header, f.content].join("\n");
  });
  return [
    `audit_id: ${input.auditId}`,
    "",
    "=== PROJECT PROFILE (from B-classify) ===",
    JSON.stringify(input.profile, null, 2),
    "",
    "=== LEAN CANVAS INTENT (context only — DO NOT let it bias what you see) ===",
    input.leanCanvasIntent,
    "",
    "=== SEED FILES ===",
    seedFileBlocks.join("\n\n"),
    "",
    "=== TASK ===",
    "Produce the ModelerOutput JSON now, following every rule in your system prompt.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────
// SYNTHESIZER PROMPT — the "principal engineer" reconciling two juniors.
// ─────────────────────────────────────────────────────────────

export const SYNTHESIZER_SYSTEM_PROMPT = `You are a principal engineer reviewing two independent junior engineers' structural analyses of the same codebase. Your job is to produce the CONSENSUS answer.

You will receive:
- Two ModelerOutputs, A and B.
- The project_profile (from B-classify, both modelers got the same one).
- agreed_claims: the items where A and B already match — you pass these through unchanged.
- disputed_claims: items where A and B disagree, each with the specific file excerpts that could resolve the dispute.

For each disputed_claim:
- Read the quoted code in file_excerpts carefully.
- Pick the correct answer. If neither modeler is right, produce the correct one yourself based on the code.
- If the code genuinely doesn't answer the dispute, record the claim in known_unknowns rather than forcing a choice.
- Do NOT favor modeler A or B because one model is better — judge on the code alone.

For EVERY non-trivial resolution (every disputed claim you decided), add a synthesis_notes entry: {claim, resolution, evidence}. "evidence" is a short code span or file-path reference. This makes every choice auditable.

HARD RULES:
1. Every file_path in your output must appear in seed_files_used (combined from A and B).
2. Every Transition.to_screen (if non-null and is_external=false) must exist in your final screens[].id list.
3. Every Screen.gated_by_walls[] id must exist in your final walls[].id list.
4. Every Wall.redirect_on_success (if non-null) must exist in your final screens[].id list.
5. entry_points must have at least one element.
6. Ids are YOUR ids — you may re-number (E001, W001, S001, T001) to maintain consistency after merging.

RESPOND WITH ONE JSON OBJECT matching the AppModel TypeScript shape (same as ModelerOutput but with models: string[] listing all contributors including yourself, and with synthesis_notes: Array<{claim, resolution, evidence}>). No prose, no code fences.`;

export function buildSynthesizerUserPrompt(input: {
  auditId: string;
  profile: ProjectProfile;
  modelerA: ModelerOutput;
  modelerB: ModelerOutput;
  agreedSummary: {
    entry_points: ModelerOutput["entry_points"];
    walls: ModelerOutput["walls"];
    screens: ModelerOutput["screens"];
    navigation_graph: ModelerOutput["navigation_graph"];
  };
  disputedClaims: DisputeExcerpt[];
}): string {
  return [
    `audit_id: ${input.auditId}`,
    "",
    "=== PROJECT PROFILE ===",
    JSON.stringify(input.profile, null, 2),
    "",
    "=== MODELER A ===",
    JSON.stringify(input.modelerA, null, 2),
    "",
    "=== MODELER B ===",
    JSON.stringify(input.modelerB, null, 2),
    "",
    "=== AGREED CLAIMS (pass through unchanged unless merging ids forces a rename) ===",
    JSON.stringify(input.agreedSummary, null, 2),
    "",
    "=== DISPUTED CLAIMS (resolve each one, cite evidence) ===",
    JSON.stringify(input.disputedClaims, null, 2),
    "",
    "=== TASK ===",
    "Produce the consensus AppModel JSON now. Include synthesis_notes for every disputed claim you resolved.",
  ].join("\n");
}
