import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelGateway, CompletionResult } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
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

// Route a scripted queue by model name — classify/modeler/synthesizer/walker
// each have distinct model ids, so we can keep the fixture readable.
function routedGateway(routes: Record<string, Array<Partial<CompletionResult>>>): ModelGateway {
  const counters: Record<string, number> = {};
  return {
    name: "routed",
    async complete(model) {
      const queue = routes[model];
      if (!queue) throw new Error(`routedGateway: no script for model ${model}`);
      const i = counters[model] ?? 0;
      counters[model] = i + 1;
      const step = queue[i];
      if (!step) throw new Error(`routedGateway: queue exhausted for ${model} at call ${i + 1}`);
      return {
        text: step.text ?? "",
        model: step.model ?? model,
        usage: step.usage ?? {
          inputTokens: 1000,
          outputTokens: 400,
          neurons: 0.04,
          latencyMs: 500,
        },
      };
    },
  };
}

function makeCanvas(): LeanCanvas {
  return {
    schema_version: 1,
    extracted_at: new Date().toISOString(),
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
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

let repo: string;
let artifacts: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageB-repo-"));
  artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageB-out-"));
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "test-app", main: "./main.js" }),
  );
  fs.writeFileSync(path.join(repo, "main.js"), "console.log('hi')\n");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(
    path.join(repo, "src", "Home.tsx"),
    "export default function Home() { return <button>Run audit</button>; }\n",
  );
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(artifacts, { recursive: true, force: true });
});

describe("runStageB — snapshot → classify → model → walk", () => {
  it("writes app-model.yaml + paths.yaml end-to-end", async () => {
    const profile = {
      schema_version: 1,
      description:
        "A small Node.js app with a main entry and a React Home component; simple test fixture.",
      candidate_entry_points: [{ file_path: "main.js", rationale: "package.json main" }],
      candidate_screen_files: [
        { file_path: "src/Home.tsx", rationale: "default-export component" },
      ],
      confidence: "high",
      unknowns: [],
    };

    const appModelOutput = {
      schema_version: 1,
      audit_id: "aB1",
      generated_at: new Date().toISOString(),
      models: ["claude-sonnet-4-6"],
      profile,
      entry_points: [
        {
          id: "E001",
          kind_label: "main process",
          file_path: "main.js",
          opens_screen_id: "S001",
          notes: "loads Home",
        },
      ],
      walls: [],
      screens: [
        {
          id: "S001",
          title: "Home",
          file_path: "src/Home.tsx",
          is_entry: true,
          gated_by_walls: [],
          visible_elements: [
            {
              kind_label: "button",
              label: "Run audit",
              action: {
                kind_label: "submit",
                target_screen_id: null,
                handler_file: "src/Home.tsx",
                handler_symbol: "onClick",
              },
            },
          ],
          known_unknowns: [],
        },
      ],
      navigation_graph: [],
      known_unknowns: [],
      seed_files_used: ["main.js", "src/Home.tsx"],
    };
    const walkerOutput = {
      steps: [
        {
          n: 1,
          screen_id: "S001",
          location: "src/Home.tsx",
          url: null,
          observation_summary: "Home screen with Run audit button",
          decision: "click",
          target: "Run audit",
          reasoning: "primary CTA on the only screen",
          value_moment_reached: false,
          friction_flags: [],
        },
        {
          n: 2,
          screen_id: "S001",
          location: "src/Home.tsx",
          url: null,
          observation_summary: "Report visible",
          decision: "value_reached",
          target: null,
          reasoning: "same screen shows output",
          value_moment_reached: true,
          friction_flags: [],
        },
      ],
      outcome: {
        status: "value_reached",
        loop_closed: true,
        value_moment_reached: true,
        stuck_reason: null,
      },
    };

    const gateway = routedGateway({
      // All three B sub-stages now go to Sonnet after the v1.2.0
      // ensemble collapse (C10).
      "claude-sonnet-4-6": [
        { text: JSON.stringify({ mode: "final", profile }) }, // B-classify
        { text: JSON.stringify(appModelOutput) }, // B-model (single call)
        { text: JSON.stringify(walkerOutput) }, // B-walk persona
      ],
    });

    const result = await runStageB(makeCanvas(), {
      gateway,
      logger: nullLogger,
      auditId: "aB1",
      sessionId: "sB1",
      artifactsDir: artifacts,
      projectRoot: repo,
      stepBudget: 5,
    });

    expect(result.paths.paths).toHaveLength(1);
    const p = result.paths.paths[0];
    expect(p?.outcome.status).toBe("value_reached");
    expect(p?.steps_taken).toBe(2);
    expect(p?.steps[0]?.screen_id).toBe("S001");
    expect(p?.steps[0]?.location).toBe("src/Home.tsx");
    expect(p?.steps[0]?.url).toBeNull(); // desktop-style — no web URL
    expect(fs.existsSync(path.join(artifacts, "paths.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(artifacts, "app-model.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(artifacts, "project-profile.yaml"))).toBe(true);
    expect(result.appModel.screens).toHaveLength(1);
    expect(result.appModel.entry_points).toHaveLength(1);
  });
});
