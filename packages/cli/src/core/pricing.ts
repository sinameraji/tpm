// Anthropic pricing table for the models TPM uses.
//
// Rates are per 1M tokens, USD. Anthropic publishes these at
// https://www.anthropic.com/pricing — update here when they change.
// Last verified: 2026-04-20 for the Claude 4 family.
//
// Four kinds of input-token are priced differently:
//   - input            — uncached input tokens
//   - output           — generated output tokens
//   - cacheRead        — input tokens served from an ephemeral prompt cache
//   - cacheCreation    — input tokens used to seed an ephemeral cache
//
// Put rates in a single place so we can swap a published price without
// touching gateway/stage code, and so docs can link to the pricing
// page instead of hardcoding numbers.

export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

const PER_MTOK = 1_000_000;

// Anthropic-direct pricing table (USD per 1M tokens).
export const MODEL_PRICING: Record<string, ModelRates> = {
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheCreation: 3.75,
  },
  "claude-opus-4-7": {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheCreation: 18.75,
  },
};

// Cloudflare Workers AI pricing for Anthropic partner models (USD
// per 1M tokens). CF prices Opus 4.7 at roughly 1/3 of Anthropic's
// direct list — verified from the CF Workers AI model catalog
// dashboard on 2026-04-21 (Opus: $5/$25/$0.50/$6.25). Sonnet is
// ASSUMED to be Anthropic-parity until the CF catalog page confirms
// otherwise; if CF turns out to charge differently, update here.
export const CLOUDFLARE_MODEL_PRICING: Record<string, ModelRates> = {
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheCreation: 3.75,
  },
  "claude-opus-4-7": {
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5,
    cacheCreation: 6.25,
  },
};

// Fallback rates for any unknown model (conservative — priced as
// Sonnet so we don't under-report cost if a new model ID slips in
// before the table is updated).
const FALLBACK_RATES: ModelRates = MODEL_PRICING["claude-sonnet-4-6"]!;

export type RateSource = "anthropic" | "cloudflare";

export function ratesFor(model: string, source: RateSource = "anthropic"): ModelRates {
  const table = source === "cloudflare" ? CLOUDFLARE_MODEL_PRICING : MODEL_PRICING;
  return table[model] ?? FALLBACK_RATES;
}

// Convert a (tokens, rate-per-1M) pair into integer micro-USD
// (USD × 1e6). We store costs as integers in SQLite (see
// db/schema.ts COST_COLUMN_SEMANTIC) so persisted values never drift
// due to floating-point rounding across sums.
export function tokensToMicroUsd(tokens: number, ratePerMTok: number): number {
  if (tokens <= 0) return 0;
  const usd = (tokens / PER_MTOK) * ratePerMTok;
  return Math.round(usd * 1_000_000);
}

export function microUsdToUsd(microUsd: number): number {
  return microUsd / 1_000_000;
}

export function formatUsd(microUsd: number): string {
  const usd = microUsdToUsd(microUsd);
  if (usd >= 10) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  // Sub-cent: show 4 decimals so a single call's cost is readable
  // during streaming (e.g. "$0.0032").
  return `$${usd.toFixed(4)}`;
}
