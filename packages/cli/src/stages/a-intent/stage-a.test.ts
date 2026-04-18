import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import { runStageA } from "./stage-a.js";
import { buildStaticMap } from "./static-map.js";
import { parseSurfaceHtml } from "./scraper.js";
import { LeanCanvasSchema } from "@tpm/shared/schemas/lean-canvas";

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
    sources: [{ type: "landing_page", url: "https://example.test/" }],
    lean_canvas: {
      problem: {
        items: [
          {
            statement: "Banks waste time on manual compliance workflows",
            evidence: ["landing_page: hero tagline"],
            confidence: 0.85,
          },
        ],
      },
      customer_segments: {
        items: [
          {
            segment: "Compliance officers at banks",
            evidence: ["landing_page: hero copy targets banks"],
            confidence: 0.9,
          },
        ],
      },
      unique_value_proposition: {
        statement: "AI workflows banks can deploy with audit trails regulators accept",
        evidence: ["landing_page: hero tagline"],
        confidence: 0.9,
      },
      solution: {
        items: [{ feature: "Workflow builder", evidence: ["codebase_static_map: routes"] }],
      },
      channels: {
        items: [
          {
            channel: "Direct sales to bank IT",
            evidence: ["landing_page: 'Book a demo' primary CTA"],
            confidence: 0.85,
          },
        ],
      },
      revenue_streams: {
        items: [
          {
            stream: "Enterprise contracts",
            evidence: ["pricing_page: 'Contact us' on Enterprise tier"],
            confidence: 0.8,
          },
        ],
      },
      cost_structure: { extractable: false },
      key_metrics: {
        items: [{ metric: "Signup started", evidence: ["codebase_static_map: mixpanel event"] }],
      },
      unfair_advantage: {
        items: [],
      },
    },
    intended_jtbd_per_segment: [
      {
        segment_id: "compliance_officer",
        job: "automate repetitive compliance workflows without writing code",
        actor: "compliance officer at a bank",
        trigger: "new regulatory requirement",
        success_criterion: "workflow runs unattended with regulator-acceptable audit trail",
        confidence: 0.85,
      },
    ],
    intended_value_moments: [
      {
        segment_id: "compliance_officer",
        value_moment: "first workflow executed end-to-end with audit log generated",
        rationale: "matches UVP",
        confidence: 0.8,
      },
    ],
    intended_critical_paths: [
      {
        segment_id: "compliance_officer",
        ideal_steps: [
          "Land on homepage",
          "Book demo",
          "Complete signup",
          "See templates",
          "Configure template",
          "Run with test data",
          "See audit log",
        ],
        estimated_step_count: 7,
        source: "inferred from marketing promise",
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

describe("runStageA", () => {
  it("validates output, writes lean-canvas.yaml + .json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageA-"));
    const artifacts = path.join(root, ".tpm", "artifacts", "a1");

    // Build a minimal map and scraped input
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
    const scraped = {
      schema_version: 1 as const,
      start_url: "https://example.test/",
      scraped_at: new Date().toISOString(),
      surfaces: [
        parseSurfaceHtml(
          "<html><body><h1>Bank workflows</h1></body></html>",
          "https://example.test/",
          200,
        ),
      ],
    };

    const gateway = stubGateway(makeLeanCanvasJson());
    const result = await runStageA(
      { map, scraped },
      { gateway, logger: nullLogger, auditId: "a1", sessionId: "s1", artifactsDir: artifacts },
    );

    expect(result.leanCanvas.schema_version).toBe(1);
    expect(fs.existsSync(path.join(artifacts, "lean-canvas.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(artifacts, "lean-canvas.json"))).toBe(true);
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
    const scraped = {
      schema_version: 1 as const,
      start_url: "https://example.test/",
      scraped_at: new Date().toISOString(),
      surfaces: [],
    };

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
      { map, scraped },
      { gateway, logger: nullLogger, auditId: "a2", sessionId: "s2", artifactsDir: artifacts },
    );
    expect(calls).toBe(2);
    expect(result.leanCanvas.schema_version).toBe(1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
