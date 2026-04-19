import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelGateway, CompletionResult } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import { snapshotRepo } from "./snapshot.js";
import { classifyProject, ClassifyError } from "./classify-project.js";

const nullLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => nullLogger,
} as unknown as Logger;

function scriptedGateway(queue: Array<Partial<CompletionResult> | Error>): ModelGateway {
  let i = 0;
  return {
    name: "scripted",
    async complete(model) {
      const step = queue[i++];
      if (step === undefined) throw new Error(`scripted gateway: queue exhausted at call ${i}`);
      if (step instanceof Error) throw step;
      return {
        text: step.text ?? "",
        model: step.model ?? model,
        usage: step.usage ?? {
          inputTokens: 2000,
          outputTokens: 500,
          neurons: 0.05,
          latencyMs: 300,
        },
      };
    },
  };
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-classify-"));
  fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"x","main":"./main.js"}');
  fs.writeFileSync(path.join(tmp, "main.js"), "console.log('hi')");
  fs.mkdirSync(path.join(tmp, "src"));
  fs.writeFileSync(path.join(tmp, "src", "app.ts"), "export const x = 1;");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("classifyProject", () => {
  it("round 1 final — happy path", async () => {
    const snap = snapshotRepo(tmp);
    const gw = scriptedGateway([
      {
        text: JSON.stringify({
          mode: "final",
          profile: {
            schema_version: 1,
            description:
              "A small Node.js script project with a main.js entry and a src/ directory; no UI surface, just a CLI or library.",
            candidate_entry_points: [{ file_path: "main.js", rationale: "package.json main" }],
            candidate_screen_files: [],
            confidence: "high",
            unknowns: [],
          },
        }),
      },
    ]);
    const res = await classifyProject(snap, {
      gateway: gw,
      logger: nullLogger,
      auditId: "a1",
      sessionId: "s1",
      projectRoot: tmp,
    });
    expect(res.rounds).toBe(1);
    expect(res.profile.confidence).toBe("high");
    expect(res.profile.candidate_entry_points[0]?.file_path).toBe("main.js");
  });

  it("round 1 request_files → round 2 final — agentic loop succeeds", async () => {
    const snap = snapshotRepo(tmp);
    const gw = scriptedGateway([
      {
        text: JSON.stringify({
          mode: "request_files",
          reason: "Need to read package.json",
          request_files: ["package.json"],
        }),
      },
      {
        text: JSON.stringify({
          mode: "final",
          profile: {
            schema_version: 1,
            description:
              "Confirmed after reading package.json: Node script with main entry at ./main.js and a source directory.",
            candidate_entry_points: [{ file_path: "main.js", rationale: "package.json main" }],
            candidate_screen_files: [],
            confidence: "high",
            unknowns: [],
          },
        }),
      },
    ]);
    const res = await classifyProject(snap, {
      gateway: gw,
      logger: nullLogger,
      auditId: "a1",
      sessionId: "s1",
      projectRoot: tmp,
    });
    expect(res.rounds).toBe(2);
    expect(res.requested_files).toEqual(["package.json"]);
  });

  it("rejects candidate_entry_points that reference unknown files", async () => {
    const snap = snapshotRepo(tmp);
    const gw = scriptedGateway([
      {
        text: JSON.stringify({
          mode: "final",
          profile: {
            schema_version: 1,
            description:
              "Claims to be something, but the entry point file does not exist in the snapshot at all.",
            candidate_entry_points: [
              { file_path: "does-not-exist.js", rationale: "I made this up" },
            ],
            candidate_screen_files: [],
            confidence: "high",
            unknowns: [],
          },
        }),
      },
    ]);
    await expect(
      classifyProject(snap, {
        gateway: gw,
        logger: nullLogger,
        auditId: "a1",
        sessionId: "s1",
        projectRoot: tmp,
      }),
    ).rejects.toBeInstanceOf(ClassifyError);
  });

  it("rejects round 2 that tries to request more files", async () => {
    const snap = snapshotRepo(tmp);
    const gw = scriptedGateway([
      {
        text: JSON.stringify({
          mode: "request_files",
          reason: "r1",
          request_files: ["package.json"],
        }),
      },
      {
        text: JSON.stringify({
          mode: "request_files",
          reason: "r2",
          request_files: ["main.js"],
        }),
      },
    ]);
    await expect(
      classifyProject(snap, {
        gateway: gw,
        logger: nullLogger,
        auditId: "a1",
        sessionId: "s1",
        projectRoot: tmp,
      }),
    ).rejects.toBeInstanceOf(ClassifyError);
  });

  it("rejects low confidence with no unknowns", async () => {
    const snap = snapshotRepo(tmp);
    const gw = scriptedGateway([
      {
        text: JSON.stringify({
          mode: "final",
          profile: {
            schema_version: 1,
            description:
              "A project of some kind but honestly I have no idea what it is exactly, low confidence.",
            candidate_entry_points: [{ file_path: "main.js", rationale: "only guess" }],
            candidate_screen_files: [],
            confidence: "low",
            unknowns: [],
          },
        }),
      },
    ]);
    await expect(
      classifyProject(snap, {
        gateway: gw,
        logger: nullLogger,
        auditId: "a1",
        sessionId: "s1",
        projectRoot: tmp,
      }),
    ).rejects.toBeInstanceOf(ClassifyError);
  });

  it("rejects invalid JSON", async () => {
    const snap = snapshotRepo(tmp);
    const gw = scriptedGateway([{ text: "not json" }]);
    await expect(
      classifyProject(snap, {
        gateway: gw,
        logger: nullLogger,
        auditId: "a1",
        sessionId: "s1",
        projectRoot: tmp,
      }),
    ).rejects.toBeInstanceOf(ClassifyError);
  });

  it("silently ignores unreadable requested files (directory traversal attempt)", async () => {
    const snap = snapshotRepo(tmp);
    const gw = scriptedGateway([
      {
        text: JSON.stringify({
          mode: "request_files",
          reason: "traversal attempt",
          request_files: ["../../../etc/passwd", "package.json"],
        }),
      },
      {
        text: JSON.stringify({
          mode: "final",
          profile: {
            schema_version: 1,
            description:
              "After reading package.json I can confirm this is a Node project with a main entry file.",
            candidate_entry_points: [{ file_path: "main.js", rationale: "package.json main" }],
            candidate_screen_files: [],
            confidence: "medium",
            unknowns: [],
          },
        }),
      },
    ]);
    const res = await classifyProject(snap, {
      gateway: gw,
      logger: nullLogger,
      auditId: "a1",
      sessionId: "s1",
      projectRoot: tmp,
    });
    expect(res.rounds).toBe(2);
    // Only package.json should have been read; ../../etc/passwd filtered.
    expect(res.requested_files).toEqual(["package.json"]);
  });
});
