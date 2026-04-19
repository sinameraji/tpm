import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import type { Problems } from "@tpm/shared/schemas/problems";
import type { Delta } from "@tpm/shared/schemas/delta";
import { runStageE, STAGE_E_SPEC_MODEL } from "./stage-e.js";

const nullLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => nullLogger,
} as unknown as Logger;

function makeProblems(): Problems {
  return {
    schema_version: 1,
    audit_id: "a1",
    generated_at: new Date().toISOString(),
    model: "@cf/openai/gpt-oss-120b",
    problems: [
      {
        id: "P001",
        rank: 1,
        title: "Self-serve path missing",
        source_findings: [{ delta_ref: "x" }],
        severity: "critical",
        reach: "all_personas",
        funnel_position: "entry",
        blast_radius: "unblocks_many",
        effort_estimate: "medium",
        confidence: "high",
        leverage_argument: "entry-funnel dominates",
        unblocks: [],
        related_patterns: [],
      },
    ],
  };
}

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
      headline: "",
    },
    per_persona_delta: [],
    friction_summary: { total_friction_flags: 0, by_type: {} },
    pattern_matches: [],
  };
}

function stubGateway(): ModelGateway {
  return {
    name: "stub",
    async complete(model) {
      if (model === STAGE_E_SPEC_MODEL) {
        const spec = {
          id: "S001",
          problem_ref: "P001",
          title: "Replace demo-gate with self-serve template gallery",
          change: {
            what: "Homepage CTA → template gallery → minimal signup → pre-populated canvas",
            scope: ["new_component: TemplateGallery", "new_route: /templates"],
          },
          why_right_fix: "The core promise is unreachable without self-serve",
          unblocks: [],
          implementation_outline: [
            "Build TemplateGallery",
            "Shorten signup to 2 fields",
            "Wire template selection into onboarding flow",
          ],
          effort_estimate: { size: "medium", rationale: "templates exist in the data model" },
          risks_and_tradeoffs: [
            { risk: "Sales loses qualification signal", mitigation: "Opt-in post-run form" },
          ],
          success_metric: {
            primary: "Signup-to-first-workflow conversion",
            target: ">40% within 7d",
            measurement_window: "30d",
          },
        };
        return {
          text: JSON.stringify(spec),
          model,
          usage: { inputTokens: 3000, outputTokens: 700, neurons: 0.06, latencyMs: 1500 },
        };
      }
      // prototype — must clear the 500-char minimum and include doctype/body.
      const filler = "<p>Proposed self-serve flow section describing the change.</p>".repeat(12);
      return {
        text: `<!doctype html><html><head><title>Prototype</title></head><body><h1>Prototype</h1>${filler}</body></html>`,
        model,
        usage: { inputTokens: 600, outputTokens: 400, neurons: 0.03, latencyMs: 800 },
      };
    },
  };
}

describe("runStageE", () => {
  it("produces solutions.yaml + prototypes/*.html for top-N", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageE-"));
    const result = await runStageE(
      { problems: makeProblems(), delta: makeDelta() },
      {
        gateway: stubGateway(),
        logger: nullLogger,
        auditId: "aE1",
        sessionId: "sE1",
        artifactsDir: root,
        topN: 1,
      },
    );
    expect(result.solutions.solutions).toHaveLength(1);
    const s = result.solutions.solutions[0];
    expect(s?.id).toBe("S001");
    expect(s?.prototype?.path).toBeDefined();
    const protoAbs = path.join(root, s!.prototype!.path);
    expect(fs.existsSync(protoAbs)).toBe(true);
    expect(fs.readFileSync(protoAbs, "utf8")).toContain("<h1>Prototype</h1>");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
