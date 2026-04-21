// Pure cost calculator. Takes a model ID and a gateway Usage record
// and returns a micro-USD total plus the per-kind breakdown. Used by
// stage-runner (to populate model_calls.cost), by the progress UI
// (to tick up the live cost counter), and by the `pm cost` command
// (to render historical totals).
//
// Pure: no I/O, no logging, no mutation. Keeps the surface testable
// and easy to reuse without pulling in the rest of the CLI.

import type { Usage } from "../gateway/index.js";
import { ratesFor, tokensToMicroUsd } from "./pricing.js";

export interface CostBreakdown {
  inputMicroUsd: number;
  outputMicroUsd: number;
  cacheReadMicroUsd: number;
  cacheCreationMicroUsd: number;
  totalMicroUsd: number;
}

export function calcCost(model: string, usage: Usage): CostBreakdown {
  const rates = ratesFor(model);

  // Cache-read and cache-creation tokens are *also* input tokens, but
  // Anthropic's usage accounting reports them separately and the
  // top-level `input_tokens` value represents the uncached-only
  // portion. We treat them as disjoint buckets here. If a future
  // gateway double-counts, normalize at the gateway layer, not here.
  const inputMicroUsd = tokensToMicroUsd(usage.inputTokens, rates.input);
  const outputMicroUsd = tokensToMicroUsd(usage.outputTokens, rates.output);
  const cacheReadMicroUsd = tokensToMicroUsd(usage.cacheReadInputTokens ?? 0, rates.cacheRead);
  const cacheCreationMicroUsd = tokensToMicroUsd(
    usage.cacheCreationInputTokens ?? 0,
    rates.cacheCreation,
  );

  const totalMicroUsd = inputMicroUsd + outputMicroUsd + cacheReadMicroUsd + cacheCreationMicroUsd;

  return {
    inputMicroUsd,
    outputMicroUsd,
    cacheReadMicroUsd,
    cacheCreationMicroUsd,
    totalMicroUsd,
  };
}

// Sum a list of breakdowns (e.g., per-attempt -> per-stage, or
// per-stage -> per-audit).
export function sumBreakdowns(breakdowns: CostBreakdown[]): CostBreakdown {
  return breakdowns.reduce<CostBreakdown>(
    (acc, b) => ({
      inputMicroUsd: acc.inputMicroUsd + b.inputMicroUsd,
      outputMicroUsd: acc.outputMicroUsd + b.outputMicroUsd,
      cacheReadMicroUsd: acc.cacheReadMicroUsd + b.cacheReadMicroUsd,
      cacheCreationMicroUsd: acc.cacheCreationMicroUsd + b.cacheCreationMicroUsd,
      totalMicroUsd: acc.totalMicroUsd + b.totalMicroUsd,
    }),
    {
      inputMicroUsd: 0,
      outputMicroUsd: 0,
      cacheReadMicroUsd: 0,
      cacheCreationMicroUsd: 0,
      totalMicroUsd: 0,
    },
  );
}
