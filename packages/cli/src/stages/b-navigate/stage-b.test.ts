import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Map as MapNs } from "@tpm/shared";
import { buildStaticMap } from "../a-intent/static-map.js";
import { runStageB } from "./stage-b.js";

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
      {
        segment_id: "user",
        value_moment: "first audit report visible",
        rationale: "core promise",
        confidence: 0.8,
      },
    ],
    intended_critical_paths: [
      {
        segment_id: "user",
        ideal_steps: ["land", "click audit", "see report"],
        estimated_step_count: 3,
        source: "inferred",
        confidence: 0.7,
      },
    ],
  };
}

function tinyMap(): MapNs.Map {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageB-map-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { next: "^14" } }),
  );
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "app", "page.tsx"),
    "export default function Home() { return <h1>Run an audit</h1>; }",
  );
  const map = buildStaticMap(root);
  fs.rmSync(root, { recursive: true, force: true });
  return map;
}

function stubGateway(payload: object): ModelGateway {
  return {
    name: "stub",
    async complete() {
      return {
        text: JSON.stringify(payload),
        model: "@cf/qwen/qwen3-30b-a3b-fp8",
        usage: { inputTokens: 3000, outputTokens: 500, neurons: 0.08, latencyMs: 700 },
      };
    },
  };
}

describe("runStageB — imagined path from static map", () => {
  it("writes paths.yaml with the persona's inferred journey", async () => {
    const steps = [
      {
        n: 1,
        url: "/",
        observation_summary: "Landing with a 'Run audit' CTA inferred from <h1> + button",
        decision: "click",
        target: "Run audit button",
        reasoning: "primary CTA visible in code at /",
        value_moment_reached: false,
        friction_flags: [],
      },
      {
        n: 2,
        url: "/audits/new",
        observation_summary: "Audit form",
        decision: "fill_form",
        target: "form#audit",
        reasoning: "form at /audits/new in the static map",
        value_moment_reached: false,
        friction_flags: [
          { type: "premature_data_collection", detail: "5 required fields before run" },
        ],
      },
      {
        n: 3,
        url: "/audits/123",
        observation_summary: "Report visible",
        decision: "value_reached",
        target: null,
        reasoning: "report is the value moment",
        value_moment_reached: true,
        friction_flags: [],
      },
    ];
    const gateway = stubGateway({
      steps,
      outcome: {
        status: "value_reached",
        loop_closed: true,
        value_moment_reached: true,
        stuck_reason: null,
      },
    });

    const out = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageB-out-"));
    const result = await runStageB(makeCanvas(), tinyMap(), {
      gateway,
      logger: nullLogger,
      auditId: "aB1",
      sessionId: "sB1",
      artifactsDir: out,
      stepBudget: 5,
    });

    expect(result.paths.paths).toHaveLength(1);
    const p = result.paths.paths[0];
    expect(p?.outcome.status).toBe("value_reached");
    expect(p?.steps_taken).toBe(3);
    expect(p?.entry_point).toBe("(code-only)");
    expect(fs.existsSync(path.join(out, "paths.yaml"))).toBe(true);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
