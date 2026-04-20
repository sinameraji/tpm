import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { ModelGateway, CompletionResult } from "../../gateway/index.js";
import type { Logger } from "../../core/logger.js";
import { jsonParse, runStage, StageError, zodValidate, type StageSpec } from "./stage-runner.js";

const nullLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => nullLogger,
} as unknown as Logger;

// Scripted gateway: hands back a queue of responses in order. If the
// test queues more than it consumes it asserts at end via the remaining
// count. Lets us script the retry cases without a real model.
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
        usage: step.usage ?? { inputTokens: 100, outputTokens: 50, neurons: 0.01, latencyMs: 100 },
      };
    },
  };
}

const Shape = z.object({ id: z.string(), items: z.array(z.string()) });
type Shape = z.infer<typeof Shape>;

function specOf(overrides: Partial<StageSpec<Shape>> = {}): StageSpec<Shape> {
  return {
    name: "A",
    label: "test",
    model: "claude-sonnet-4-6",
    maxTokens: 1000,
    temperature: 0,
    responseFormat: "json",
    systemPrompt: "sys",
    userPrompt: "user",
    parse: jsonParse,
    validate: zodValidate(Shape),
    maxRetries: 2,
    ...overrides,
  };
}

const deps = {
  gateway: scriptedGateway([]),
  logger: nullLogger,
  auditId: "a1",
  sessionId: "s1",
};

describe("runStage", () => {
  it("happy path — returns output on first attempt", async () => {
    const gw = scriptedGateway([{ text: JSON.stringify({ id: "x", items: ["a"] }) }]);
    const res = await runStage(specOf(), { ...deps, gateway: gw });
    expect(res.output.id).toBe("x");
    expect(res.attempts).toHaveLength(1);
    expect(res.attempts[0]?.kind).toBe("initial");
    // `totalNeurons` has meant integer micro-USD since v1.2.0 (see
    // db/schema.ts COST_COLUMN_SEMANTIC). The default scripted usage
    // reports 100 input + 50 output tokens at Sonnet rates:
    // 100 × $3/MTok + 50 × $15/MTok = 0.0003 + 0.00075 USD = 1050 μUSD.
    expect(res.totalNeurons).toBe(1050);
  });

  it("empty output → retry with doubled budget → success", async () => {
    const gw = scriptedGateway([{ text: "" }, { text: JSON.stringify({ id: "x", items: [] }) }]);
    const res = await runStage(specOf(), { ...deps, gateway: gw });
    expect(res.output.id).toBe("x");
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]?.failure).toBe("empty output");
    expect(res.attempts[1]?.kind).toBe("retry-empty");
  });

  it("parse fail → retry with correction → success", async () => {
    const gw = scriptedGateway([
      { text: "not json at all" },
      { text: JSON.stringify({ id: "x", items: [] }) },
    ]);
    const res = await runStage(specOf(), { ...deps, gateway: gw });
    expect(res.output.id).toBe("x");
    expect(res.attempts[0]?.failure).toMatch(/^parse:/);
  });

  it("schema fail → retry with correction → success", async () => {
    const gw = scriptedGateway([
      { text: JSON.stringify({ id: 123 }) }, // wrong type + missing items
      { text: JSON.stringify({ id: "x", items: [] }) },
    ]);
    const res = await runStage(specOf(), { ...deps, gateway: gw });
    expect(res.output.id).toBe("x");
    expect(res.attempts[0]?.failure).toMatch(/^schema:/);
  });

  it("semantic fail → retry with hints → success", async () => {
    const semanticCheck = (out: Shape) => ({
      ok: out.items.length > 0,
      violations: out.items.length > 0 ? [] : ["items must be non-empty"],
    });
    const gw = scriptedGateway([
      { text: JSON.stringify({ id: "x", items: [] }) },
      { text: JSON.stringify({ id: "x", items: ["one"] }) },
    ]);
    const res = await runStage(specOf({ semanticCheck }), { ...deps, gateway: gw });
    expect(res.output.items).toEqual(["one"]);
    expect(res.attempts[0]?.failure).toMatch(/^semantic:/);
  });

  it("hits max retries on repeated empty → throws StageError", async () => {
    const gw = scriptedGateway([{ text: "" }, { text: "" }, { text: "" }]);
    await expect(runStage(specOf(), { ...deps, gateway: gw })).rejects.toBeInstanceOf(StageError);
  });

  it("StageError carries stage + session + attempt history", async () => {
    const gw = scriptedGateway([{ text: "" }, { text: "" }, { text: "" }]);
    try {
      await runStage(specOf(), { ...deps, gateway: gw });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StageError);
      const se = err as StageError;
      expect(se.stage).toBe("A");
      expect(se.sessionId).toBe("s1");
      expect(se.attempts.length).toBe(3);
    }
  });

  it("gateway throw surfaces as StageError with one attempt recorded", async () => {
    const gw = scriptedGateway([new Error("network down")]);
    try {
      await runStage(specOf(), { ...deps, gateway: gw });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StageError);
      const se = err as StageError;
      expect(se.attempts[0]?.failure).toMatch(/network down/);
    }
  });

  it("pre-flight token check throws before any model call", async () => {
    const hugePrompt = "x".repeat(800_000); // ~228K tokens est
    const gw = scriptedGateway([]); // empty: any call would throw
    await expect(
      runStage(specOf({ userPrompt: hugePrompt, maxTokens: 50_000 }), { ...deps, gateway: gw }),
    ).rejects.toBeInstanceOf(StageError);
  });
});
