import { describe, expect, it } from "vitest";
import type { Usage } from "../gateway/index.js";
import { calcCost, sumBreakdowns } from "./cost-calc.js";
import { formatUsd, microUsdToUsd, tokensToMicroUsd } from "./pricing.js";

function usage(partial: Partial<Usage>): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    ...partial,
  };
}

describe("calcCost", () => {
  it("prices Sonnet 4.6 input + output only", () => {
    // 1K input at $3/MTok = 0.003 USD = 3,000 micro-USD
    // 1K output at $15/MTok = 0.015 USD = 15,000 micro-USD
    const b = calcCost("claude-sonnet-4-6", usage({ inputTokens: 1000, outputTokens: 1000 }));
    expect(b.inputMicroUsd).toBe(3_000);
    expect(b.outputMicroUsd).toBe(15_000);
    expect(b.cacheReadMicroUsd).toBe(0);
    expect(b.cacheCreationMicroUsd).toBe(0);
    expect(b.totalMicroUsd).toBe(18_000);
  });

  it("prices Opus 4.7 at 5x Sonnet base rates", () => {
    const b = calcCost("claude-opus-4-7", usage({ inputTokens: 1000, outputTokens: 1000 }));
    // Opus: input $15/MTok, output $75/MTok
    expect(b.inputMicroUsd).toBe(15_000);
    expect(b.outputMicroUsd).toBe(75_000);
    expect(b.totalMicroUsd).toBe(90_000);
  });

  it("prices cache-read tokens at ~10% of input", () => {
    // Sonnet cache-read: $0.30/MTok
    const b = calcCost(
      "claude-sonnet-4-6",
      usage({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 10_000 }),
    );
    // 10K × $0.30/MTok = 0.003 USD = 3,000 micro-USD
    expect(b.cacheReadMicroUsd).toBe(3_000);
    expect(b.totalMicroUsd).toBe(3_000);
  });

  it("prices cache-creation tokens at 1.25x input", () => {
    // Sonnet cache-creation: $3.75/MTok
    const b = calcCost(
      "claude-sonnet-4-6",
      usage({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 10_000 }),
    );
    // 10K × $3.75/MTok = 0.0375 USD = 37,500 micro-USD
    expect(b.cacheCreationMicroUsd).toBe(37_500);
    expect(b.totalMicroUsd).toBe(37_500);
  });

  it("combines all four kinds", () => {
    const b = calcCost(
      "claude-sonnet-4-6",
      usage({
        inputTokens: 500,
        outputTokens: 200,
        cacheReadInputTokens: 2_000,
        cacheCreationInputTokens: 1_000,
      }),
    );
    // 500 × 3 / 1M = 1500
    // 200 × 15 / 1M = 3000
    // 2000 × 0.3 / 1M = 600
    // 1000 × 3.75 / 1M = 3750
    expect(b.inputMicroUsd).toBe(1_500);
    expect(b.outputMicroUsd).toBe(3_000);
    expect(b.cacheReadMicroUsd).toBe(600);
    expect(b.cacheCreationMicroUsd).toBe(3_750);
    expect(b.totalMicroUsd).toBe(8_850);
  });

  it("falls back to Sonnet rates for unknown models", () => {
    const sonnet = calcCost("claude-sonnet-4-6", usage({ inputTokens: 1000, outputTokens: 1000 }));
    const unknown = calcCost(
      "claude-haiku-future",
      usage({ inputTokens: 1000, outputTokens: 1000 }),
    );
    expect(unknown.totalMicroUsd).toBe(sonnet.totalMicroUsd);
  });

  it("returns zero for empty usage", () => {
    const b = calcCost("claude-sonnet-4-6", usage({}));
    expect(b.totalMicroUsd).toBe(0);
  });
});

describe("sumBreakdowns", () => {
  it("adds multiple breakdowns across models", () => {
    const a = calcCost("claude-sonnet-4-6", usage({ inputTokens: 1000, outputTokens: 1000 }));
    const b = calcCost("claude-opus-4-7", usage({ inputTokens: 1000, outputTokens: 1000 }));
    const summed = sumBreakdowns([a, b]);
    expect(summed.totalMicroUsd).toBe(a.totalMicroUsd + b.totalMicroUsd);
  });

  it("handles the empty list", () => {
    expect(sumBreakdowns([]).totalMicroUsd).toBe(0);
  });
});

describe("tokensToMicroUsd rounding", () => {
  it("rounds to nearest integer micro-USD", () => {
    // 333 tokens × $1/MTok = 0.000333 USD = 333 micro-USD
    expect(tokensToMicroUsd(333, 1)).toBe(333);
    // 1 token × $3/MTok = 0.000003 USD = 3 micro-USD
    expect(tokensToMicroUsd(1, 3)).toBe(3);
  });

  it("never goes negative", () => {
    expect(tokensToMicroUsd(0, 10)).toBe(0);
    expect(tokensToMicroUsd(-5, 10)).toBe(0);
  });
});

describe("formatUsd", () => {
  it("shows 4 decimals for sub-cent amounts", () => {
    expect(formatUsd(3_200)).toBe("$0.0032");
  });

  it("shows 2 decimals for cents and up", () => {
    expect(formatUsd(50_000)).toBe("$0.05");
    expect(formatUsd(1_620_000)).toBe("$1.62");
  });

  it("handles zero", () => {
    expect(formatUsd(0)).toBe("$0.0000");
  });
});

describe("microUsdToUsd", () => {
  it("converts micro-USD to USD", () => {
    expect(microUsdToUsd(1_000_000)).toBe(1);
    expect(microUsdToUsd(1_620_000)).toBe(1.62);
  });
});
