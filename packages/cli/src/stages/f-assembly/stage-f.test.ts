import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelGateway } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import { runStageF, renderMarkdownToHtml } from "./stage-f.js";
import type { LeanCanvas } from "@tpm/shared/schemas/lean-canvas";
import type { Paths } from "@tpm/shared/schemas/paths";
import type { Delta } from "@tpm/shared/schemas/delta";
import type { Problems } from "@tpm/shared/schemas/problems";
import type { Solutions } from "@tpm/shared/schemas/solutions";

const nullLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => nullLogger,
} as unknown as Logger;

describe("renderMarkdownToHtml", () => {
  it("handles h1/h2/h3, paragraphs, lists, bold/italic/code/links", () => {
    const md = [
      "# Title",
      "",
      "## Section",
      "",
      "Paragraph with **bold** and *italic* and `code` and [link](https://x).",
      "",
      "### Sub",
      "",
      "- item 1",
      "- item 2",
    ].join("\n");
    const html = renderMarkdownToHtml(md);
    expect(html).toMatch(/<h1>Title<\/h1>/);
    expect(html).toMatch(/<h2>Section<\/h2>/);
    expect(html).toMatch(/<h3>Sub<\/h3>/);
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<em>italic<\/em>/);
    expect(html).toMatch(/<code>code<\/code>/);
    expect(html).toMatch(/<a href="https:\/\/x">link<\/a>/);
    expect(html).toMatch(/<ul>\s*<li>item 1<\/li>\s*<li>item 2<\/li>\s*<\/ul>/);
  });
});

function stubGateway(): ModelGateway {
  // Emits a markdown skeleton that passes the Stage F semantic check
  // (7 required sections + 1000-char minimum). Filler is deliberate:
  // we're testing orchestration, not prose quality.
  const filler = "Synthesized prose for test purposes. ".repeat(40);
  const md = [
    "# Executive Summary",
    "",
    `No persona reached the value moment. ${filler}`,
    "",
    "## Intended Product",
    "",
    `Bank automation platform for compliance teams. ${filler}`,
    "",
    "## Observed Reality",
    "",
    `Users get stuck at the demo-request gate. ${filler}`,
    "",
    "## The Delta",
    "",
    `Promise and product diverge at the entry. ${filler}`,
    "",
    "## Top Problems",
    "",
    `P001 dominates — entry funnel is broken. ${filler}`,
    "",
    "## Recommended Actions",
    "",
    `Ship a self-serve template gallery. ${filler}`,
    "",
    "## Appendix — Methodology",
    "",
    `Six-stage TPM pipeline. ${filler}`,
    "",
  ].join("\n");
  return {
    name: "stub",
    async complete() {
      return {
        text: md,
        model: "@cf/openai/gpt-oss-120b",
        usage: { inputTokens: 10_000, outputTokens: 1500, neurons: 0.1, latencyMs: 3000 },
      };
    },
  };
}

function tinyLeanCanvas(): LeanCanvas {
  return {
    schema_version: 1,
    extracted_at: new Date().toISOString(),
    model: "x",
    sources: [],
    lean_canvas: {
      problem: { items: [] },
      customer_segments: { items: [] },
      unique_value_proposition: { statement: "x", evidence: [], confidence: 0.9 },
      solution: { items: [] },
      channels: { items: [] },
      revenue_streams: { items: [] },
      cost_structure: { extractable: false },
      key_metrics: { items: [] },
      unfair_advantage: { items: [] },
    },
    intended_jtbd_per_segment: [],
    intended_value_moments: [],
    intended_critical_paths: [],
  };
}
const tinyPaths = (): Paths => ({
  schema_version: 1,
  audit_id: "a1",
  generated_at: new Date().toISOString(),
  model: "x",
  paths: [],
});
const tinyDelta = (): Delta => ({
  schema_version: 1,
  audit_id: "a1",
  generated_at: new Date().toISOString(),
  model: "x",
  overall_health: {
    value_moment_reached_any_persona: false,
    value_moment_reached_all_personas: false,
    loop_closed: false,
    headline: "",
  },
  per_persona_delta: [],
  friction_summary: { total_friction_flags: 0, by_type: {} },
  pattern_matches: [],
});
const tinyProblems = (): Problems => ({
  schema_version: 1,
  audit_id: "a1",
  generated_at: new Date().toISOString(),
  model: "x",
  problems: [],
});
const tinySolutions = (): Solutions => ({
  schema_version: 1,
  audit_id: "a1",
  generated_at: new Date().toISOString(),
  model_spec: "x",
  model_prototype: "y",
  solutions: [],
});

describe("runStageF", () => {
  it("writes spec.md from stage outputs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageF-"));
    const result = await runStageF(
      {
        leanCanvas: tinyLeanCanvas(),
        paths: tinyPaths(),
        delta: tinyDelta(),
        problems: tinyProblems(),
        solutions: tinySolutions(),
      },
      {
        gateway: stubGateway(),
        logger: nullLogger,
        auditId: "aF1",
        sessionId: "sF1",
        artifactsDir: root,
        renderPdf: false, // skip PDF in CI
      },
    );
    expect(fs.existsSync(result.markdownPath)).toBe(true);
    const md = fs.readFileSync(result.markdownPath, "utf8");
    expect(md).toMatch(/Executive Summary/);
    expect(result.pdfPath).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
