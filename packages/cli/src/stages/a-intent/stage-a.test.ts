import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import { runStageA } from "./stage-a.js";
import { buildStaticMap } from "./static-map.js";
import { LeanCanvasSchema } from "@pm/shared/schemas/lean-canvas";

const nullLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => nullLogger,
} as unknown as Logger;

function makeLeanCanvasJson(): string {
  return JSON.stringify({
    schema_version: 1,
    extracted_at: new Date().toISOString(),
    model: "@cf/openai/gpt-oss-120b",
    sources: [{ type: "codebase_static_map" }],
    lean_canvas: {
      problem: {
        items: [
          {
            statement: "Banks waste time on manual compliance workflows",
            evidence: ["codebase_static_map: hero h1 copy"],
            confidence: 0.85,
          },
        ],
      },
      customer_segments: {
        items: [
          {
            segment: "Compliance officers at banks",
            evidence: ["codebase_static_map: hero copy"],
            confidence: 0.9,
          },
        ],
      },
      unique_value_proposition: {
        statement: "AI workflows banks can deploy",
        evidence: ["codebase_static_map: hero h1"],
        confidence: 0.9,
      },
      solution: {
        items: [{ feature: "Workflow builder", evidence: ["codebase_static_map: routes"] }],
      },
      channels: {
        items: [
          {
            channel: "Direct sales",
            evidence: ["codebase_static_map: Book demo CTA"],
            confidence: 0.85,
          },
        ],
      },
      revenue_streams: {
        items: [
          {
            stream: "Enterprise contracts",
            evidence: ["codebase_static_map: /pricing route"],
            confidence: 0.8,
          },
        ],
      },
      cost_structure: { extractable: false },
      key_metrics: {
        items: [{ metric: "Signup started", evidence: ["codebase_static_map: mixpanel event"] }],
      },
      unfair_advantage: { items: [] },
    },
    intended_jtbd_per_segment: [
      {
        segment_id: "compliance_officer",
        job: "automate workflows",
        actor: "compliance officer",
        trigger: "regulatory requirement",
        success_criterion: "workflow runs with audit trail",
        confidence: 0.85,
      },
    ],
    intended_value_moments: [
      {
        segment_id: "compliance_officer",
        value_moment: "first workflow executed",
        rationale: "matches UVP",
        confidence: 0.8,
      },
    ],
    intended_critical_paths: [
      {
        segment_id: "compliance_officer",
        ideal_steps: ["Land on homepage", "Sign up", "Configure template", "Run workflow"],
        estimated_step_count: 4,
        source: "inferred from onboarding routes",
        confidence: 0.75,
      },
    ],
  });
}

function stubGateway(responseJson: string): ModelGateway {
  return {
    name: "stub",
    async complete() {
      return {
        text: responseJson,
        model: "@cf/openai/gpt-oss-120b",
        usage: { inputTokens: 1000, outputTokens: 400, neurons: 0.14, latencyMs: 1000 },
      };
    },
  };
}

describe("runStageA (code-only)", () => {
  it("validates output and writes lean-canvas.yaml + .json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageA-"));
    const artifacts = path.join(root, ".tpm", "artifacts", "a1");

    fs.mkdirSync(path.join(root, "app"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { next: "^14" } }),
    );
    fs.writeFileSync(
      path.join(root, "app", "page.tsx"),
      "export default function Home() { return <h1>Automate compliance</h1>; }",
    );
    const map = buildStaticMap(root);

    const gateway = stubGateway(makeLeanCanvasJson());
    const result = await runStageA(
      { map },
      { gateway, logger: nullLogger, auditId: "a1", sessionId: "s1", artifactsDir: artifacts },
    );

    expect(result.leanCanvas.schema_version).toBe(1);
    expect(fs.existsSync(path.join(artifacts, "lean-canvas.yaml"))).toBe(true);
    const parsedBack = yaml.load(
      fs.readFileSync(path.join(artifacts, "lean-canvas.yaml"), "utf8"),
    ) as unknown;
    LeanCanvasSchema.parse(parsedBack);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("retries once on schema violation then succeeds", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageA-retry-"));
    const artifacts = path.join(root, ".tpm", "artifacts", "a2");

    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { next: "^14" } }),
    );
    const map = buildStaticMap(root);

    let calls = 0;
    const gateway: ModelGateway = {
      name: "retry-stub",
      async complete() {
        calls += 1;
        return {
          text:
            calls === 1
              ? JSON.stringify({ schema_version: 1, nonsense: true })
              : makeLeanCanvasJson(),
          model: "@cf/openai/gpt-oss-120b",
          usage: { inputTokens: 1, outputTokens: 1, neurons: 0.01, latencyMs: 1 },
        };
      },
    };

    const result = await runStageA(
      { map },
      { gateway, logger: nullLogger, auditId: "a2", sessionId: "s2", artifactsDir: artifacts },
    );
    expect(calls).toBe(2);
    expect(result.leanCanvas.schema_version).toBe(1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
