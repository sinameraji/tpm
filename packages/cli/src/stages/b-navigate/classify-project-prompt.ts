import type { RepoSnapshot } from "./snapshot.js";

// B-classify prompts — one system prompt + two user-prompt builders
// (round 1 = snapshot only; round 2 = snapshot + requested files).
//
// The prompt's job is to let the LLM reason like a senior engineer who
// just opened an unfamiliar repo: look at what's there, decide what to
// read next, form a description. We do NOT enumerate project types or
// frameworks — the model should describe what it finds in its own
// words.

export const CLASSIFY_PROJECT_SYSTEM_PROMPT = `You are a senior engineer who was just given a codebase you've never seen. Your job is to figure out what this project is.

You work the way a good engineer does when dropped into an unfamiliar repo:
1. Look at the shape of the repo (what files and dirs exist at the top, what manifests are present).
2. Decide if you can describe the project confidently from that alone.
3. If not, ask to read a small number of specific files that would resolve your uncertainty.
4. Produce a final description that any engineer could read and understand what this project IS — not just technically but what it does for its users.

You do NOT execute the code. You do NOT guess. If you don't know, say so in \`unknowns\`.

RESPONSE FORMAT — return exactly ONE JSON object with one of these two shapes:

Shape A — you need to read files:
{
  "mode": "request_files",
  "reason": "<one sentence explaining what you're trying to determine>",
  "request_files": ["path/one", "path/two", ...]   // 1 to 6 paths, each from the snapshot
}

Shape B — you're done:
{
  "mode": "final",
  "profile": {
    "schema_version": 1,
    "description": "<3-6 sentences describing what this project is: language(s), stack, what it does, how users interact with it, deployment target — whichever of these facets actually apply to THIS project. Jupyter repos don't have 'deployment targets'; game engines don't have 'primary language' cleanly; say what's true, omit what isn't.>",
    "candidate_entry_points": [
      { "file_path": "<path from snapshot or a file you requested>", "rationale": "<why this is an entry>" },
      ...                                                           // at least one required
    ],
    "candidate_screen_files": [                                      // may be empty for non-UI projects
      { "file_path": "<path>", "rationale": "<why this file maps to a user-facing screen/view/page>" },
      ...
    ],
    "confidence": "high" | "medium" | "low",
    "unknowns": ["<things you couldn't determine>", ...]             // if confidence is "low", this MUST be non-empty
  }
}

RULES:
- Every path in \`request_files\`, \`candidate_entry_points[].file_path\`, and \`candidate_screen_files[].file_path\` must appear in the snapshot or in files you've already been given.
- Do not invent paths.
- Do not guess a project type you can't support with evidence from the snapshot or the files you requested.
- "description" must be at least 40 characters of real description. No placeholder text.
- No prose outside the JSON. No code fences. No commentary.`;

function formatSnapshot(snap: RepoSnapshot): string {
  const lines: string[] = [];
  lines.push(`ROOT: ${snap.root_path}`);
  lines.push(
    `TOTALS: ${snap.total_file_count} files, ${snap.total_dir_count} dirs${snap.truncated ? " (snapshot TRUNCATED at entry cap)" : ""}`,
  );
  lines.push("");
  lines.push("MANIFESTS PRESENT:");
  lines.push(
    snap.manifest_presence.length
      ? snap.manifest_presence.map((m) => `  - ${m}`).join("\n")
      : "  (none of the well-known manifests found)",
  );
  lines.push("");
  lines.push("TOP-LEVEL ENTRIES:");
  for (const e of snap.top_level_entries) {
    const size = e.size_bytes !== undefined ? ` (${e.size_bytes}B)` : "";
    lines.push(`  ${e.kind === "dir" ? "d" : "f"} ${e.path}${size}`);
  }
  lines.push("");
  lines.push("FULL SHALLOW TREE (depth ≤ 3):");
  for (const e of snap.shallow_tree) {
    const indent = "  ".repeat(e.depth);
    lines.push(`${indent}${e.kind === "dir" ? "d" : "f"} ${e.path}`);
  }
  return lines.join("\n");
}

export function buildClassifyUserPromptRound1(snap: RepoSnapshot): string {
  return [
    "=== REPO SNAPSHOT ===",
    formatSnapshot(snap),
    "",
    "=== TASK ===",
    'Decide what this project is. If the snapshot plus manifest names is enough, respond with mode="final". Otherwise respond with mode="request_files" listing up to 6 specific files to read next.',
  ].join("\n");
}

export interface RequestedFile {
  path: string;
  content: string;
  truncated_at_line?: number;
}

export function buildClassifyUserPromptRound2(
  snap: RepoSnapshot,
  requestedFiles: RequestedFile[],
): string {
  const fileBlocks = requestedFiles.map((f) => {
    const header = f.truncated_at_line
      ? `--- ${f.path} (first ${f.truncated_at_line} lines) ---`
      : `--- ${f.path} ---`;
    return [header, f.content].join("\n");
  });
  return [
    "=== REPO SNAPSHOT ===",
    formatSnapshot(snap),
    "",
    "=== FILES YOU REQUESTED ===",
    fileBlocks.join("\n\n"),
    "",
    "=== TASK ===",
    'You already asked for files. Now produce the final answer — mode="final" with a complete profile. No more file requests.',
  ].join("\n");
}
