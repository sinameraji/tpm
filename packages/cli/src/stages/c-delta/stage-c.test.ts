import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Paths } from "@tpm/shared/schemas/paths";
import { runStageC } from "./stage-c.js";

const nullLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => nullLogger,
} as unknown as Logger;

function makeCanvas(): LeanCanvas {
  return {
    schema_version: 1,
    extracted_at: new Date().toISOString(),
    model: "@cf/openai/gpt-oss-120b",
    sources: [],
    lean_canvas: {
      problem: { items: [] },
      customer_segments: { items: [] },
      unique_value_proposition: { statement: "Ship audits fast", evidence: [], confidence: 0.9 },
      solution: { items: [] },
      channels: { items: [] },
      revenue_streams: { items: [] },
      cost_structure: { extractable: false },
      key_metrics: { items: [] },
      unfair_advantage: { items: [] },
    },
    intended_jtbd_per_segment: [
      {
        segment_id: "user",
        job: "run an audit",
        actor: "product owner",
        trigger: "wants insight",
        success_criterion: "report visible",
        confidence: 0.9,
      },
    ],
    intended_value_moments: [
      { segment_id: "user", value_moment: "report visible", rationale: "", confidence: 0.8 },
    ],
    intended_critical_paths: [
      {
        segment_id: "user",
        ideal_steps: ["a", "b"],
        estimated_step_count: 2,
        source: "",
        confidence: 0.7,
      },
    ],
  };
}

function makePaths(): Paths {
  return {
    schema_version: 1,
    audit_id: "a1",
    generated_at: new Date().toISOString(),
    model: "@cf/qwen/qwen3-30b-a3b-fp8",
    paths: [
      {
        persona: "user",
        goal: "run an audit",
        value_moment_target: "report visible",
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        step_budget: 25,
        steps_taken: 2,
        entry_point: "https://example.test/",
        steps: [
          {
            n: 1,
            url: "/",
            observation_summary: "home",
            decision: "click",
            target: "#cta",
            reasoning: "pursue value",
            value_moment_reached: false,
            friction_flags: [],
          },
          {
            n: 2,
            url: "/stuck",
            observation_summary: "blank",
            decision: "stuck",
            target: null,
            reasoning: "no path",
            value_moment_reached: false,
            friction_flags: [{ type: "blank_page_anxiety", detail: "" }],
          },
        ],
        outcome: {
          status: "stuck",
          loop_closed: false,
          value_moment_reached: false,
          time_to_value_ms: null,
          stuck_at_step: 2,
          stuck_reason: "no path",
        },
      },
    ],
  };
}

function stubGateway(): ModelGateway {
  const delta = {
    schema_version: 1,
    audit_id: "a1",
    generated_at: new Date().toISOString(),
    model: "@cf/openai/gpt-oss-120b",
    overall_health: {
      value_moment_reached_any_persona: false,
      value_moment_reached_all_personas: false,
      loop_closed: false,
      headline: "User stuck at step 2",
    },
    per_persona_delta: [
      {
        persona: "user",
        value_moment_reached: false,
        observed_steps_to_value: null,
        intended_steps_to_value: 2,
        category_benchmark_steps: null,
        step_classifications: [
          {
            step_n: 1,
            classification: "necessary",
            rationale: "launches the flow",
            necessity_test_answer: "nothing yet",
            severity: "info",
          },
          {
            step_n: 2,
            classification: "broken",
            rationale: "blank page",
            necessity_test_answer: "N/A",
            severity: "critical",
          },
        ],
        intent_mismatches: [
          {
            marketing_claim: "Run audits fast",
            observed_reality: "blank page",
            severity: "high",
            evidence: [],
          },
        ],
        implicit_vs_stated_job: {
          stated_job: "run an audit",
          implicit_job_served: "collect leads",
          alignment: "misaligned",
          rationale: "no path to value",
        },
      },
    ],
    friction_summary: { total_friction_flags: 1, by_type: { blank_page_anxiety: 1 } },
    pattern_matches: [],
  };
  return {
    name: "stub",
    async complete() {
      return {
        text: JSON.stringify(delta),
        model: "@cf/openai/gpt-oss-120b",
        usage: { inputTokens: 5000, outputTokens: 1500, neurons: 0.1, latencyMs: 2000 },
      };
    },
  };
}

describe("runStageC", () => {
  it("produces a validated delta yaml", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageC-"));
    const result = await runStageC(
      { leanCanvas: makeCanvas(), paths: makePaths() },
      {
        gateway: stubGateway(),
        logger: nullLogger,
        auditId: "aC1",
        sessionId: "sC1",
        artifactsDir: root,
        patternLibrarySummary: "(empty for tests)",
      },
    );
    expect(result.delta.overall_health.headline).toMatch(/stuck/i);
    expect(result.delta.per_persona_delta[0]?.step_classifications[1]?.classification).toBe(
      "broken",
    );
    expect(fs.existsSync(path.join(root, "delta.yaml"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
