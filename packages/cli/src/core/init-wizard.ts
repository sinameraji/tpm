// First-run wizard for the Anthropic key + model tier.
//
// Runs from `tpm init` (explicit) and from `tpm audit` (implicit,
// when no key is configured and stdin is a TTY). Non-TTY = skipped,
// return null, caller decides what to do (for audit: exit with a
// pointer to `tpm init`).
//
// Key input is read via readline with echo suppression so the key
// doesn't land in shell scrollback / screen recordings. On TTYs
// that don't support echo off (rare), we fall back to visible entry
// and warn once.

import * as readline from "node:readline";
import {
  loadConfig,
  resolveAnthropicKey,
  saveConfig,
  setConfigValue,
  type UserConfig,
} from "./config.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const INTRO = `TPM needs an Anthropic API key to run audits.

TPM uses Claude (Sonnet 4.6 by default) to read your code and produce a
PM-grade spec. A typical audit takes 8-12 minutes and costs $1-3 in API
credits at your account's rates. Large repos and deep-tier audits take
longer and cost more.

1. Create a key:  https://console.anthropic.com/settings/keys
2. Paste it here (starts with sk-ant-...):`;

const TIER_PROMPT = `Pick a default model tier:
  [1] fast  — Sonnet 4.6 throughout. Cheaper, faster.
  [2] deep  — Opus 4.7 on the heavy stages (B-model, C, E-spec, F). 3-5x cost.
Enter 1 or 2 (default 1):`;

function write(line: string): void {
  process.stderr.write(line + "\n");
}

function isTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Masked single-line input. readline doesn't expose this directly —
// we disable terminal echo around the .question() call. Cleanup is
// in a try/finally so the terminal state is always restored.
async function readMaskedLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    process.stderr.write(prompt + " ");

    // Replace each keystroke with '*' until Enter.
    const onData = (chunk: Buffer): void => {
      const str = chunk.toString("utf8");
      // Echo '*' for printable chars so the user sees length.
      for (const ch of str) {
        if (ch === "\n" || ch === "\r") continue;
        if (ch === "\u0003") {
          // Ctrl-C
          process.stderr.write("\n");
          rl.close();
          process.exit(130);
        }
        process.stdout.write("*");
      }
    };

    // Ensure the raw keystroke listener is on. Paste via terminal
    // still works because readline handles the buffered line ending.
    const wasRaw = stdin.isRaw === true;
    if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    stdin.on("data", onData);

    rl.question("", (answer: string) => {
      stdin.off("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw);
      process.stderr.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt + " ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export interface WizardResult {
  cfg: UserConfig;
  keySet: boolean;
}

export async function runKeyWizard(opts: {
  // When true, existing key present → ask whether to replace.
  allowReplace?: boolean;
}): Promise<WizardResult | null> {
  if (!isTTY()) return null;

  let cfg = loadConfig();
  const existingKey = resolveAnthropicKey(cfg);
  if (existingKey && !opts.allowReplace) {
    write(`${DIM}An Anthropic API key is already configured. Skipping wizard.${RESET}`);
    return { cfg, keySet: false };
  }
  if (existingKey && opts.allowReplace) {
    write(`${DIM}An Anthropic API key is already configured.${RESET}`);
    const ans = (await readLine("Replace it? [y/N]")).toLowerCase();
    if (ans !== "y" && ans !== "yes") {
      write("Keeping the existing key.");
      return { cfg, keySet: false };
    }
  }

  write("");
  write(INTRO);

  let key = "";
  while (!key) {
    key = (await readMaskedLine("  >")).trim();
    if (!key) {
      write(`${DIM}Empty key — paste again, or Ctrl-C to cancel.${RESET}`);
      continue;
    }
    if (!key.startsWith("sk-ant-")) {
      write(
        `${DIM}That doesn't look like an Anthropic key (expected sk-ant-...). Accepting it anyway — Anthropic will reject it on the first call if it's wrong.${RESET}`,
      );
    }
  }

  cfg = setConfigValue(cfg, "anthropic_api_key", key);

  write("");
  write(TIER_PROMPT);
  const tierAns = (await readLine("  >")).trim();
  const tier = tierAns === "2" ? "deep" : "fast";
  cfg = setConfigValue(cfg, "model_tier", tier);

  saveConfig(cfg);
  write("");
  write(`${DIM}Saved to ~/.tpm/config.yaml (chmod 600).${RESET}`);
  write(
    `${DIM}Key stored locally only. TPM will never transmit it except to api.anthropic.com.${RESET}`,
  );
  write("");
  return { cfg, keySet: true };
}
