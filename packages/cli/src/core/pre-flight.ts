// Pre-flight + completion blocks for `pm audit`.
//
// Pre-flight (before Stage A): sets expectations — tier, codebase,
// marketing, output path, ~time + ~cost. Explicit cost range is how
// the anti-anxiety UX works: if a user sees "$1-3" up front, they
// won't hit Ctrl+C at the 4-minute mark thinking it's stuck.
//
// Completion block: final cost, specs produced, where to read them.
//
// All tunable numbers live here in one exported constants block so
// we can refresh them from real-run data without hunting through
// five files.

import type { ModelTier } from "./config.js";
import { formatUsd } from "./pricing.js";

const BRAND = "\x1b[38;5;33m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

// One-liner pitch. Shown at the top of `pm init` and `pm audit` so
// first-time users know what they're running before they commit to
// it. Kept short so it's not noise on repeat invocations.
export function printPitch(): void {
  process.stderr.write(`\n${BRAND}PM${RESET} — Product Manager\n`);
  process.stderr.write(
    `${DIM}Reads your codebase and suggests a few high-leverage improvements (specs + prototypes).${RESET}\n`,
  );
}

// Refresh from real-audit data after the 5-repo test matrix (C13)
// lands. Numbers here are the pre-matrix estimate from the brief.
export const TIME_COST_ESTIMATES = {
  fast: {
    timeLabel: "about 8-12 minutes",
    costLabel: "roughly $1-3 in Anthropic API credits",
  },
  deep: {
    timeLabel: "about 18-25 minutes",
    costLabel: "roughly $6-10 in Anthropic API credits",
  },
} as const;

// Just the model names — "tier" terminology (fast/deep) is an
// internal concept we haven't surfaced to first-run users. A user
// who sees "Tier: fast" reasonably wonders what other tiers exist,
// and the answer pulls them into a decision they don't need to make.
// Users who've opted into deep via `pm config set model-tier deep`
// see both model names, which is self-explanatory.
function modelTagline(tier: ModelTier): string {
  return tier === "deep" ? "Claude Opus 4.7 + Claude Sonnet 4.6" : "Claude Sonnet 4.6";
}

export interface PreFlightInput {
  repoName: string;
  projectPath: string;
  marketingUrl?: string | undefined;
  tier: ModelTier;
  outputPath: string;
}

function writeStderr(line: string): void {
  process.stderr.write(line + "\n");
}

export function printPreFlight(input: PreFlightInput): void {
  const est = TIME_COST_ESTIMATES[input.tier];
  printPitch();
  writeStderr("");
  writeStderr(`${BRAND}Audit${RESET} · ${input.repoName}`);
  writeStderr("");
  writeStderr(`${DIM}This will take ${est.timeLabel} and cost ${est.costLabel}${RESET}`);
  writeStderr(`${DIM}(based on your account's current rates). Large repos take longer.${RESET}`);
  writeStderr("");
  writeStderr(`${DIM}Model:${RESET}     ${modelTagline(input.tier)}`);
  writeStderr(`${DIM}Codebase:${RESET}  ${input.projectPath}`);
  writeStderr(`${DIM}Marketing:${RESET} ${input.marketingUrl ?? "(none — code-only)"}`);
  writeStderr(`${DIM}Output:${RESET}    ${input.outputPath}`);
  writeStderr("");
  writeStderr(
    `${DIM}Press Ctrl+C any time to stop. Artifacts save as each stage completes.${RESET}`,
  );
  writeStderr("");
}

export interface CompletionInput {
  elapsedMs: number;
  totalMicroUsd: number;
  specMdPath: string;
  specHtmlPath: string;
  specMdBytes: number | null;
  problemCount: number;
  solutionCount: number;
  prototypeCount: number;
  openCommand: string; // "open" / "xdg-open" / "start"
  cacheHitMicroUsd?: number;
}

function humanDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

export function printCompletion(input: CompletionInput): void {
  writeStderr("");
  writeStderr(
    `${GREEN}✓${RESET} Audit complete · ${humanDuration(input.elapsedMs)} · ${formatUsd(input.totalMicroUsd)}`,
  );
  writeStderr("");
  const sizeTag = input.specMdBytes !== null ? ` (${Math.round(input.specMdBytes / 1024)} KB)` : "";
  writeStderr(`  Read:    spec.md${sizeTag}`);
  writeStderr(`  Open:    ${input.openCommand} ${input.specHtmlPath}`);
  writeStderr("");
  writeStderr(
    `  ${input.problemCount} problems ranked · ${input.solutionCount} solutions specced · ${input.prototypeCount} prototypes`,
  );
  if (input.cacheHitMicroUsd && input.cacheHitMicroUsd > 0) {
    writeStderr(`  ${DIM}cache savings: ${formatUsd(input.cacheHitMicroUsd)}${RESET}`);
  }
  writeStderr("");
  writeStderr(`  ${DIM}How was this audit? tpm feedback${RESET}`);
  writeStderr("");
}
