import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelGateway } from "../gateway/index.js";
import { wrapGatewayForProgress, type StageProgressCtx } from "./progress.js";

function fakeGateway(): ModelGateway & {
  lastOpts?: Parameters<ModelGateway["complete"]>[2];
} {
  const g = {
    name: "fake",
    lastOpts: undefined as Parameters<ModelGateway["complete"]>[2] | undefined,
    complete: vi.fn(async (_model, _messages, opts) => {
      g.lastOpts = opts;
      // Simulate the gateway firing onToken a couple of times.
      opts?.onToken?.(10);
      opts?.onToken?.(42);
      return {
        text: "hi",
        model: "claude-sonnet-4-6",
        usage: {
          inputTokens: 500,
          outputTokens: 42,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          latencyMs: 12,
        },
      };
    }),
  };
  return g;
}

function fakeCtx(): StageProgressCtx & {
  tokens: number[];
  costs: number[];
  inputs: number[];
  retries: Array<{ kind: string; n: number }>;
} {
  const tokens: number[] = [];
  const costs: number[] = [];
  const inputs: number[] = [];
  const retries: Array<{ kind: string; n: number }> = [];
  return {
    tokens,
    costs,
    inputs,
    retries,
    onToken: (n) => tokens.push(n),
    noteCost: (c) => costs.push(c),
    onRetry: (kind, n) => retries.push({ kind, n }),
    noteInput: (i) => inputs.push(i),
  };
}

describe("wrapGatewayForProgress", () => {
  it("threads ctx.onToken through to the inner gateway", async () => {
    const inner = fakeGateway();
    const ctx = fakeCtx();
    const wrapped = wrapGatewayForProgress(inner, ctx);
    await wrapped.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]);
    expect(ctx.tokens).toEqual([10, 42]);
  });

  it("notes input tokens and cost after the attempt completes", async () => {
    const inner = fakeGateway();
    const ctx = fakeCtx();
    const wrapped = wrapGatewayForProgress(inner, ctx);
    await wrapped.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }]);
    expect(ctx.inputs).toEqual([500]);
    // 500 × $3/MTok + 42 × $15/MTok = 1500 + 630 = 2130 micro-USD
    expect(ctx.costs).toEqual([2130]);
  });

  it("preserves an existing onToken from the caller and fires both", async () => {
    const inner = fakeGateway();
    const ctx = fakeCtx();
    const wrapped = wrapGatewayForProgress(inner, ctx);
    const callerTokens: number[] = [];
    await wrapped.complete("claude-sonnet-4-6", [{ role: "user", content: "hi" }], {
      onToken: (n) => callerTokens.push(n),
    });
    expect(callerTokens).toEqual([10, 42]);
    expect(ctx.tokens).toEqual([10, 42]);
  });

  it("wrapped gateway name is suffixed for traceability", () => {
    const inner = fakeGateway();
    const ctx = fakeCtx();
    const wrapped = wrapGatewayForProgress(inner, ctx);
    expect(wrapped.name).toBe("fake+progress");
  });
});

describe("withStageProgress (non-TTY / --no-stream mode)", () => {
  let originalTTY: boolean | undefined;
  let writes: string[];

  beforeEach(() => {
    writes = [];
    originalTTY = process.stderr.isTTY;
    // Force non-TTY path. Vitest's default stderr is already non-TTY
    // in most runners, but be explicit.
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: false,
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalTTY !== undefined) {
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: originalTTY,
      });
    }
  });

  it("prints a human name with sequence number on start and completion", async () => {
    const { withStageProgress } = await import("./progress.js");
    await withStageProgress(
      { sequence: [2, 7], humanName: "Understanding what your product claims to do" },
      async () => "ok",
    );
    const joined = writes.join("");
    expect(joined).toContain("[2/7]");
    expect(joined).toContain("Understanding what your product claims to do");
    expect(joined).toMatch(/done/);
  });

  it("prints FAILED on thrown error and rethrows", async () => {
    const { withStageProgress } = await import("./progress.js");
    await expect(
      withStageProgress({ humanName: "Stage that breaks" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const joined = writes.join("");
    expect(joined).toContain("Stage that breaks");
    expect(joined).toContain("FAILED");
  });
});
