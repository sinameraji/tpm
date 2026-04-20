// Progress UI. Two surfaces:
//
//   withProgress(label, fn)         — legacy single-line spinner for
//                                     stages that don't yet stream
//                                     through the Anthropic gateway.
//   withStageProgress(meta, fn)     — v1.2.0 progress: live token
//                                     count + running cost, human
//                                     stage names, visible retries,
//                                     slow-stage reassurance.
//
// Streaming rendering:
//   [2/7] Understanding what your product claims to do
//         38s · 2,847 in · 1,204 out · ~$0.06
//
// On completion the line collapses to a one-line checkmark keeping
// the elapsed time + final cost. Prior stages remain visible above.
//
// --no-stream / non-TTY: falls back to plain "start / done / failed"
// lines, no cursor manipulation. Drives by `stderr.isTTY` — the
// audit command sets TPM_NO_STREAM=1 when invoked with --no-stream.

import { formatUsd } from "./pricing.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BRAND = "\x1b[38;5;33m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const SLOW_STAGE_HINT_AFTER_MS = 60_000;

function elapsed(startMs: number): string {
  const s = (Date.now() - startMs) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

function isStreamingEnabled(): boolean {
  if (process.env["TPM_NO_STREAM"] === "1") return false;
  if (process.env["TPM_NO_PROGRESS"] === "1") return false;
  return Boolean(process.stderr.isTTY);
}

// ---- legacy withProgress (unchanged API) -----------------------------

export async function withProgress<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const stderr = process.stderr;
  const interactive = isStreamingEnabled();
  const start = Date.now();

  if (!interactive) {
    stderr.write(`  ${label}...\n`);
    try {
      const out = await fn();
      stderr.write(`  ${label} — done (${elapsed(start)})\n`);
      return out;
    } catch (err) {
      stderr.write(`  ${label} — FAILED (${elapsed(start)})\n`);
      throw err;
    }
  }

  let i = 0;
  const draw = (): void => {
    const frame = FRAMES[i++ % FRAMES.length];
    stderr.write(`\r${BRAND}${frame}${RESET} ${label} ${DIM}(${elapsed(start)})${RESET}`);
  };
  draw();
  const handle = setInterval(draw, 90);
  try {
    const out = await fn();
    clearInterval(handle);
    stderr.write(`\r\x1b[K${GREEN}✓${RESET} ${label} ${DIM}(${elapsed(start)})${RESET}\n`);
    return out;
  } catch (err) {
    clearInterval(handle);
    stderr.write(`\r\x1b[K${RED}✗${RESET} ${label} ${DIM}(${elapsed(start)})${RESET}\n`);
    throw err;
  }
}

export function printHeader(text: string): void {
  if (process.stderr.isTTY) {
    process.stderr.write(`\n${BRAND}▸${RESET} ${text}\n`);
  } else {
    process.stderr.write(`\n▸ ${text}\n`);
  }
}

// ---- v1.2.0 streaming progress ---------------------------------------

export interface StageMeta {
  sequence?: [number, number]; // [2, 7] => "[2/7]"
  humanName: string;
  // Optional "slow-stage expected" hint shown once when the stage
  // passes 60s. Copy like "this is the longest stage, ~90s typical".
  slowNote?: string;
}

export interface StageProgressCtx {
  // Fired on every gateway output-token delta — usually from the
  // Anthropic gateway's internal stream. Value is cumulative for the
  // current attempt; retries reset it.
  onToken: (cumulativeOutputTokens: number) => void;
  // Fired by the stage-runner (or a gateway wrapper) after each
  // attempt's usage is known. Accumulates across retries within the
  // same stage.
  noteCost: (microUsd: number) => void;
  // Fired by the stage-runner on a retry. Visible: the UI line
  // shows the retry kind and attempt count.
  onRetry: (kind: string, attemptNumber: number) => void;
  // Track input tokens too, so the UI can show "2,847 in".
  noteInput: (inputTokens: number) => void;
}

function noOpCtx(): StageProgressCtx {
  return {
    onToken: () => {},
    noteCost: () => {},
    onRetry: () => {},
    noteInput: () => {},
  };
}

interface StageState {
  inputTokens: number;
  currentAttemptOutputTokens: number;
  totalOutputTokensAcrossAttempts: number;
  costMicroUsd: number;
  retries: Array<{ kind: string; n: number }>;
  slowHintShown: boolean;
}

function buildLine(meta: StageMeta, state: StageState, frame: string, startMs: number): string {
  const seq = meta.sequence ? `${DIM}[${meta.sequence[0]}/${meta.sequence[1]}]${RESET} ` : "";
  const lastRetry = state.retries.at(-1);
  const retryTag = lastRetry
    ? ` ${YELLOW}⚠ retry ${lastRetry.n}/3 (${lastRetry.kind})${RESET}`
    : "";
  const input = state.inputTokens > 0 ? `${fmtCount(state.inputTokens)} in` : "";
  const output =
    state.currentAttemptOutputTokens > 0 ? `${fmtCount(state.currentAttemptOutputTokens)} out` : "";
  const cost = state.costMicroUsd > 0 ? `~${formatUsd(state.costMicroUsd)}` : "";
  const pieces = [elapsed(startMs), input, output, cost].filter(Boolean);
  return `\r\x1b[K${BRAND}${frame}${RESET} ${seq}${meta.humanName}${retryTag}\n       ${DIM}${pieces.join(" · ")}${RESET}\x1b[1A`;
}

export async function withStageProgress<T>(
  meta: StageMeta,
  fn: (ctx: StageProgressCtx) => Promise<T>,
): Promise<T> {
  const stderr = process.stderr;
  const interactive = isStreamingEnabled();
  const start = Date.now();

  if (!interactive) {
    const seq = meta.sequence ? `[${meta.sequence[0]}/${meta.sequence[1]}] ` : "";
    stderr.write(`  ${seq}${meta.humanName}...\n`);
    const ctx = noOpCtx();
    try {
      const out = await fn(ctx);
      stderr.write(`  ${seq}${meta.humanName} — done (${elapsed(start)})\n`);
      return out;
    } catch (err) {
      stderr.write(`  ${seq}${meta.humanName} — FAILED (${elapsed(start)})\n`);
      throw err;
    }
  }

  const state: StageState = {
    inputTokens: 0,
    currentAttemptOutputTokens: 0,
    totalOutputTokensAcrossAttempts: 0,
    costMicroUsd: 0,
    retries: [],
    slowHintShown: false,
  };

  let i = 0;
  // Reserve two rows for the stage line + detail subline — the
  // buildLine code ends with \x1b[1A so the cursor comes back to the
  // first row for the next redraw.
  stderr.write("\n\n\x1b[2A");
  const draw = (): void => {
    const frame = FRAMES[i++ % FRAMES.length];
    stderr.write(buildLine(meta, state, frame, start));
    // Slow-stage reassurance, once.
    if (!state.slowHintShown && meta.slowNote && Date.now() - start >= SLOW_STAGE_HINT_AFTER_MS) {
      state.slowHintShown = true;
      stderr.write(`\n       ${DIM}${meta.slowNote}${RESET}\n\x1b[1A`);
    }
  };
  draw();
  const handle = setInterval(draw, 140);

  const ctx: StageProgressCtx = {
    onToken: (cumulativeOut) => {
      state.currentAttemptOutputTokens = cumulativeOut;
    },
    noteCost: (microUsd) => {
      state.costMicroUsd += microUsd;
    },
    onRetry: (kind, n) => {
      state.retries.push({ kind, n });
      // Reset the per-attempt streaming counter. Input tokens stay;
      // they already paid.
      state.currentAttemptOutputTokens = 0;
    },
    noteInput: (inputTokens) => {
      state.inputTokens += inputTokens;
    },
  };

  try {
    const out = await fn(ctx);
    clearInterval(handle);
    const seq = meta.sequence ? `${DIM}[${meta.sequence[0]}/${meta.sequence[1]}]${RESET} ` : "";
    const cost = state.costMicroUsd > 0 ? ` · ${formatUsd(state.costMicroUsd)}` : "";
    stderr.write(
      `\r\x1b[K${GREEN}✓${RESET} ${seq}${meta.humanName} ${DIM}(${elapsed(start)}${cost})${RESET}\n\x1b[K\n\x1b[1A`,
    );
    return out;
  } catch (err) {
    clearInterval(handle);
    const seq = meta.sequence ? `${DIM}[${meta.sequence[0]}/${meta.sequence[1]}]${RESET} ` : "";
    stderr.write(
      `\r\x1b[K${RED}✗${RESET} ${seq}${meta.humanName} ${DIM}(${elapsed(start)})${RESET}\n\x1b[K\n\x1b[1A`,
    );
    throw err;
  }
}

// ---- gateway progress wrapping --------------------------------------

import type { ModelGateway } from "../gateway/index.js";
import { calcCost } from "./cost-calc.js";

// Wrap a gateway so every complete() call feeds the progress ctx.
// This is how Stage A (and every ported stage) gets live token
// counts + cost without the stage knowing about progress.
export function wrapGatewayForProgress(inner: ModelGateway, ctx: StageProgressCtx): ModelGateway {
  return {
    name: `${inner.name}+progress`,
    async complete(model, messages, opts = {}) {
      // Layer our onToken callback on top of any existing one. If
      // the caller already set onToken, both fire.
      const innerOnToken = opts.onToken;
      const result = await inner.complete(model, messages, {
        ...opts,
        onToken: (cumulativeOutputTokens) => {
          innerOnToken?.(cumulativeOutputTokens);
          ctx.onToken(cumulativeOutputTokens);
        },
      });
      ctx.noteInput(result.usage.inputTokens);
      const cost = calcCost(model, result.usage).totalMicroUsd;
      ctx.noteCost(cost);
      return result;
    },
  };
}
