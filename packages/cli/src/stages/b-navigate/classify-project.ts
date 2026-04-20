// B-classify orchestrator: agent loop with bounded file requests.
//
// Round 1: show the snapshot, let the model decide. If it returns
// mode="final", we're done.
// Round 2 (only if round 1 returned mode="request_files"): read up to
// 6 files, echo them back, require mode="final".
//
// The loop is hard-capped at 2 model calls. If round 2 still returns
// "request_files", we treat it as a failure — the project is genuinely
// hard to classify and the model must produce its best guess with
// low confidence + explicit unknowns, not keep asking forever.

import * as fs from "node:fs";
import * as path from "node:path";
import { ClassifierResponse, type ProjectProfile } from "@tpm/shared/schemas/project-profile";
import type { ModelGateway, Message } from "../../gateway/index.js";
import type { CompleteOptionsExt } from "../../gateway/workers-ai.js";
import type { Logger } from "../../core/logger.js";
import {
  CLASSIFY_PROJECT_SYSTEM_PROMPT,
  buildClassifyUserPromptRound1,
  buildClassifyUserPromptRound2,
  type RequestedFile,
} from "./classify-project-prompt.js";
import type { RepoSnapshot } from "./snapshot.js";

// Qwen2.5-Coder is the code specialist; JSON mode is natively supported.
// Qwen2.5-Coder-32B has a 24K total context on Workers AI. Round-2
// requested files (up to 6) are capped at 150 lines each, keeping
// input + 4K output budget under the limit.
export const CLASSIFY_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
const MAX_TOKENS = 4_000;
const TEMPERATURE = 0.1;
const MAX_FILE_LINES = 150;

export interface ClassifyDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  projectRoot: string;
}

export interface ClassifyResult {
  profile: ProjectProfile;
  neurons: number;
  rounds: number;
  requested_files: string[];
}

function stripCodeFences(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  return m?.[1]?.trim() ?? trimmed;
}

function readSafe(projectRoot: string, relPath: string): RequestedFile | null {
  // Reject anything that tries to escape the project root.
  const normalized = path.normalize(relPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  const abs = path.join(projectRoot, normalized);
  if (!abs.startsWith(path.resolve(projectRoot))) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const raw = fs.readFileSync(abs, "utf8");
  const lines = raw.split(/\r?\n/);
  if (lines.length > MAX_FILE_LINES) {
    return {
      path: normalized,
      content: lines.slice(0, MAX_FILE_LINES).join("\n"),
      truncated_at_line: MAX_FILE_LINES,
    };
  }
  return { path: normalized, content: raw };
}

function validatePaths(
  profile: ProjectProfile,
  snap: RepoSnapshot,
  requestedPaths: Set<string>,
): string[] {
  const knownPaths = new Set([
    ...snap.shallow_tree.filter((e) => e.kind === "file").map((e) => e.path),
    ...requestedPaths,
  ]);
  const violations: string[] = [];
  for (const c of profile.candidate_entry_points) {
    if (!knownPaths.has(c.file_path)) {
      violations.push(`candidate_entry_points contains unknown file_path "${c.file_path}"`);
    }
  }
  for (const c of profile.candidate_screen_files) {
    if (!knownPaths.has(c.file_path)) {
      violations.push(`candidate_screen_files contains unknown file_path "${c.file_path}"`);
    }
  }
  if (profile.confidence === "low" && profile.unknowns.length === 0) {
    violations.push("confidence=low requires at least one entry in unknowns");
  }
  return violations;
}

async function callModel(
  messages: Message[],
  deps: ClassifyDeps,
): Promise<{ text: string; neurons: number }> {
  const opts: CompleteOptionsExt = {
    temperature: TEMPERATURE,
    responseFormat: "json",
    auditId: deps.auditId,
    sessionId: deps.sessionId,
    stage: "B",
    maxTokens: MAX_TOKENS,
  };
  const completion = await deps.gateway.complete(CLASSIFY_MODEL, messages, opts);
  return {
    text: completion.text ?? "",
    neurons: completion.usage.neurons ?? 0,
  };
}

export class ClassifyError extends Error {
  constructor(
    message: string,
    readonly sessionId: string,
    readonly rounds: number,
  ) {
    super(message);
    this.name = "ClassifyError";
  }
}

export async function classifyProject(
  snap: RepoSnapshot,
  deps: ClassifyDeps,
): Promise<ClassifyResult> {
  let totalNeurons = 0;
  const systemMsg: Message = { role: "system", content: CLASSIFY_PROJECT_SYSTEM_PROMPT };

  // --- Round 1 ---
  const round1User: Message = {
    role: "user",
    content: buildClassifyUserPromptRound1(snap),
  };
  const r1 = await callModel([systemMsg, round1User], deps);
  totalNeurons += r1.neurons;

  if (!r1.text.trim()) {
    throw new ClassifyError("B-classify: round 1 returned empty output", deps.sessionId, 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(r1.text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ClassifyError(`B-classify: round 1 JSON parse failed: ${msg}`, deps.sessionId, 1);
  }
  let response;
  try {
    response = ClassifierResponse.parse(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ClassifyError(
      `B-classify: round 1 schema validation failed: ${msg.slice(0, 500)}`,
      deps.sessionId,
      1,
    );
  }

  if (response.mode === "final") {
    const violations = validatePaths(response.profile, snap, new Set());
    if (violations.length > 0) {
      throw new ClassifyError(
        `B-classify: semantic checks failed on round 1: ${violations.join("; ")}`,
        deps.sessionId,
        1,
      );
    }
    deps.logger.info(
      { stage: "B", rounds: 1, neurons: totalNeurons, confidence: response.profile.confidence },
      "B-classify complete (no file requests)",
    );
    return {
      profile: response.profile,
      neurons: totalNeurons,
      rounds: 1,
      requested_files: [],
    };
  }

  // --- Round 2 ---
  deps.logger.info(
    { stage: "B", requested: response.request_files, reason: response.reason },
    "B-classify round 1 requested files",
  );
  const files: RequestedFile[] = [];
  for (const p of response.request_files) {
    const f = readSafe(deps.projectRoot, p);
    if (f) files.push(f);
  }
  if (files.length === 0) {
    throw new ClassifyError(
      `B-classify: round 1 requested ${response.request_files.length} files but none could be read`,
      deps.sessionId,
      1,
    );
  }
  const round2User: Message = {
    role: "user",
    content: buildClassifyUserPromptRound2(snap, files),
  };
  const r2 = await callModel(
    [systemMsg, round1User, { role: "assistant", content: r1.text }, round2User],
    deps,
  );
  totalNeurons += r2.neurons;

  if (!r2.text.trim()) {
    throw new ClassifyError("B-classify: round 2 returned empty output", deps.sessionId, 2);
  }
  let parsed2: unknown;
  try {
    parsed2 = JSON.parse(stripCodeFences(r2.text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ClassifyError(`B-classify: round 2 JSON parse failed: ${msg}`, deps.sessionId, 2);
  }
  let response2;
  try {
    response2 = ClassifierResponse.parse(parsed2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ClassifyError(
      `B-classify: round 2 schema validation failed: ${msg.slice(0, 500)}`,
      deps.sessionId,
      2,
    );
  }
  if (response2.mode !== "final") {
    throw new ClassifyError(
      "B-classify: round 2 must produce mode='final'; model asked for more files",
      deps.sessionId,
      2,
    );
  }
  const requestedSet = new Set(files.map((f) => f.path));
  const violations = validatePaths(response2.profile, snap, requestedSet);
  if (violations.length > 0) {
    throw new ClassifyError(
      `B-classify: semantic checks failed on round 2: ${violations.join("; ")}`,
      deps.sessionId,
      2,
    );
  }
  deps.logger.info(
    {
      stage: "B",
      rounds: 2,
      neurons: totalNeurons,
      confidence: response2.profile.confidence,
      files_read: files.map((f) => f.path),
    },
    "B-classify complete (with file-request round)",
  );
  return {
    profile: response2.profile,
    neurons: totalNeurons,
    rounds: 2,
    requested_files: files.map((f) => f.path),
  };
}
