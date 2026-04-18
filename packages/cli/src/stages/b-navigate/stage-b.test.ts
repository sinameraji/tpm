import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserFactory, BrowserPage, DomState } from "./browser.js";
import type { ModelGateway } from "../../gateway/index.js";
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
        trigger: "wants product insight",
        success_criterion: "audit report visible",
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

function makeScriptedPage(states: DomState[]): {
  page: BrowserPage;
  actions: Array<{ kind: string; target?: string }>;
} {
  const actions: Array<{ kind: string; target?: string }> = [];
  let idx = 0;
  const page: BrowserPage = {
    async current() {
      return states[Math.min(idx, states.length - 1)] as DomState;
    },
    async goto(url) {
      actions.push({ kind: "goto", target: url });
      idx = Math.min(idx + 1, states.length - 1);
    },
    async click(selector) {
      actions.push({ kind: "click", target: selector });
      idx = Math.min(idx + 1, states.length - 1);
    },
    async fill(selector, value) {
      actions.push({ kind: "fill", target: `${selector}=${value}` });
    },
    async submit(selector) {
      actions.push({ kind: "submit", target: selector });
      idx = Math.min(idx + 1, states.length - 1);
    },
    async screenshot() {},
    async close() {},
  };
  return { page, actions };
}

function makeFactory(page: BrowserPage): BrowserFactory {
  return {
    async launchPage() {
      return page;
    },
  };
}

function domAt(url: string, opts: Partial<DomState> = {}): DomState {
  return {
    url,
    title: opts.title ?? "Title",
    h1: opts.h1 ?? ["Head"],
    h2: opts.h2 ?? [],
    visible_text: opts.visible_text ?? "",
    clickables: opts.clickables ?? [],
    forms: opts.forms ?? [],
    html_hash: opts.html_hash ?? url,
  };
}

function scriptedGateway(responses: string[]): ModelGateway {
  let i = 0;
  return {
    name: "script",
    async complete() {
      const text = responses[Math.min(i, responses.length - 1)] as string;
      i += 1;
      return {
        text,
        model: "@cf/qwen/qwen3-30b-a3b-fp8",
        usage: { inputTokens: 500, outputTokens: 80, neurons: 0.05, latencyMs: 300 },
      };
    },
  };
}

describe("runStageB — 3-step happy path", () => {
  it("clicks an audit CTA then reaches value moment", async () => {
    const states: DomState[] = [
      domAt("https://example.test/", {
        clickables: [{ role: "a", label: "Run audit", selector: "#run", kind: "link" }],
      }),
      domAt("https://example.test/audits/new", {
        clickables: [{ role: "a", label: "View report", selector: "#view", kind: "link" }],
      }),
      domAt("https://example.test/audits/123", { h1: ["Audit report"] }),
    ];
    const { page, actions } = makeScriptedPage(states);
    const gateway = scriptedGateway([
      JSON.stringify({
        observation_summary: "Landing with a Run audit CTA",
        decision: "click",
        target: "#run",
        reasoning: "go to audit flow",
        value_moment_reached: false,
        friction_flags: [],
      }),
      JSON.stringify({
        observation_summary: "New audit page; View report link",
        decision: "click",
        target: "#view",
        reasoning: "advance to report",
        value_moment_reached: false,
        friction_flags: [],
      }),
      JSON.stringify({
        observation_summary: "Audit report page visible",
        decision: "value_reached",
        target: null,
        reasoning: "first audit report visible",
        value_moment_reached: true,
        friction_flags: [],
      }),
    ]);

    const out = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageB-"));
    const result = await runStageB(makeCanvas(), {
      gateway,
      logger: nullLogger,
      auditId: "aB1",
      sessionId: "sB1",
      artifactsDir: out,
      browserFactory: makeFactory(page),
      entryPoint: "https://example.test/",
      stepBudget: 5,
    });

    expect(result.paths.paths).toHaveLength(1);
    const p = result.paths.paths[0];
    expect(p?.outcome.status).toBe("value_reached");
    expect(p?.outcome.value_moment_reached).toBe(true);
    expect(p?.steps_taken).toBe(3);
    expect(actions.map((a) => a.kind)).toEqual(["click", "click"]);
    expect(fs.existsSync(path.join(out, "paths.yaml"))).toBe(true);
    fs.rmSync(out, { recursive: true, force: true });
  });
});

describe("runStageB — stuck with friction flags", () => {
  it("records stuck reason + friction flags", async () => {
    const states: DomState[] = [
      domAt("https://example.test/", {
        h1: ["Welcome"],
        clickables: [],
      }),
    ];
    const { page } = makeScriptedPage(states);
    const gateway = scriptedGateway([
      JSON.stringify({
        observation_summary: "Blank landing with no CTA",
        decision: "stuck",
        target: null,
        reasoning: "no forward action visible",
        value_moment_reached: false,
        friction_flags: [{ type: "blank_page_anxiety", detail: "no CTA" }],
      }),
    ]);

    const out = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageB-stuck-"));
    const result = await runStageB(makeCanvas(), {
      gateway,
      logger: nullLogger,
      auditId: "aB2",
      sessionId: "sB2",
      artifactsDir: out,
      browserFactory: makeFactory(page),
      entryPoint: "https://example.test/",
      stepBudget: 3,
    });
    const p = result.paths.paths[0];
    expect(p?.outcome.status).toBe("stuck");
    expect(p?.steps[0]?.friction_flags[0]?.type).toBe("blank_page_anxiety");
    fs.rmSync(out, { recursive: true, force: true });
  });
});

describe("runStageB — cycle detection", () => {
  it("marks cycle_detected when URL+DOM state repeats 3 times", async () => {
    const sameState = domAt("https://example.test/loop", {
      clickables: [{ role: "a", label: "Retry", selector: "#r", kind: "link" }],
    });
    const { page } = makeScriptedPage([sameState]);
    const gateway = scriptedGateway([
      JSON.stringify({
        observation_summary: "loop A",
        decision: "click",
        target: "#r",
        reasoning: "try again",
        value_moment_reached: false,
        friction_flags: [],
      }),
    ]);

    const out = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-stageB-cycle-"));
    const result = await runStageB(makeCanvas(), {
      gateway,
      logger: nullLogger,
      auditId: "aB3",
      sessionId: "sB3",
      artifactsDir: out,
      browserFactory: makeFactory(page),
      entryPoint: "https://example.test/loop",
      stepBudget: 10,
    });
    const p = result.paths.paths[0];
    expect(p?.outcome.status).toBe("cycle_detected");
    fs.rmSync(out, { recursive: true, force: true });
  });
});
