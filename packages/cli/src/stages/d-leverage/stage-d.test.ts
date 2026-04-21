import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { Delta } from "@pm/shared/schemas/delta";
import { runStageD } from "./stage-d.js";

const nullLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => nullLogger,
} as unknown as Logger;

function makeDelta(): Delta {
  return {
    schema_version: 1,
    audit_id: "a1",
    generated_at: new Date().toISOString(),
    model: "@cf/openai/gpt-oss-120b",
    overall_health: {
      value_moment_reached_any_persona: false,
      value_moment_reached_all_personas: false,
      loop_closed: false,
      headline: "No persona reached value moment",
    },
    per_persona_delta: [],
    friction_summary: { total_friction_flags: 0, by_type: {} },
    pattern_matches: [],
  };
}

function stubGateway(): ModelGateway {
  const out = {
    schema_version: 1,
    audit_id: "a1",
    generated_at: new Date().toISOString(),
    model: "@cf/openai/gpt-oss-120b",
    problems: [
      {
        id: "P002",
        rank: 2,
        title: "Blank canvas",
        source_findings: [{ delta_ref: "x" }],
        severity: "high",
        reach: "all_personas",
        funnel_position: "activation",
        blast_radius: "unblocks_one",
        effort_estimate: "small",
        confidence: "high",
        leverage_argument: "Ranked 2 because …",
        unblocks: [],
        related_patterns: [],
      },
      {
        id: "P001",
        rank: 1,
        title: "Self-serve path does not exist",
        source_findings: [{ delta_ref: "y" }],
        severity: "critical",
        reach: "all_personas",
        funnel_position: "entry",
        blast_radius: "unblocks_many",
        effort_estimate: "medium",
        confidence: "high",
        leverage_argument: "Ranked 1 because entry-funnel and value-moment-unreachable dominate …",
        unblocks: ["P002"],
        related_patterns: ["demo_gate_on_self_serve"],
      },
    ],
  };
  return {
    name: "stub",
    async complete() {
      return {
        text: JSON.stringify(out),
        model: "@cf/openai/gpt-oss-120b",
        usage: { inputTokens: 2000, outputTokens: 800, neurons: 0.07, latencyMs: 1200 },
      };
    },
  };
}

describe("runStageD", () => {
  it("ranks problems contiguously 1..N and writes yaml", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageD-"));
    const result = await runStageD(makeDelta(), {
      gateway: stubGateway(),
      logger: nullLogger,
      auditId: "aD1",
      sessionId: "sD1",
      artifactsDir: root,
    });
    expect(result.problems.problems.map((p) => p.rank)).toEqual([1, 2]);
    expect(result.problems.problems[0]?.id).toBe("P001");
    expect(fs.existsSync(path.join(root, "problems.yaml"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
