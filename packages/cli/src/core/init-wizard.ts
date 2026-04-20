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

// Masked single-line input. Bypasses readline entirely — readline's
// default echo was the 1.2.0-beta.1 bug: pasted input hit the
// terminal before our '*' handler ran, so the real key leaked to
// scrollback. Here we drop into raw mode, read stdin byte-by-byte,
// and echo '*' for each printable char (and '\b \b' on backspace).
// No readline in the hot path = no echo race.
async function readMaskedLine(prompt: string): Promise<string> {
  const stdin = process.stdin;
  // If we can't disable terminal echo (unusual TTY), refuse to read
  // the key rather than leak it. Caller handles the null return.
  if (typeof stdin.setRawMode !== "function") {
    process.stderr.write(
      "\nThis terminal doesn't support masked input. Set ANTHROPIC_API_KEY in your shell env instead, or re-run tpm init in a standard terminal.\n",
    );
    throw new Error("terminal does not support raw mode");
  }

  return new Promise((resolve) => {
    process.stderr.write(prompt + " ");
    const buffer: string[] = [];
    const wasRaw = stdin.isRaw === true;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      // Don't call stdin.pause() unconditionally — other readers
      // might be waiting on it next.
    };

    // Modern terminals (iTerm2, Terminal.app, Alacritty, etc.) emit
    // bracketed-paste markers around pastes: "\e[200~" before,
    // "\e[201~" after. Raw mode forwards these verbatim — if we
    // didn't skip them, "[200~" would be echoed and stored as part
    // of the key. Track an "in escape sequence" state so everything
    // from '\e' through the terminator '~' is swallowed.
    let inEscape = false;

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (inEscape) {
          if (ch === "~" || (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
            inEscape = false;
          }
          continue;
        }
        if (ch === "\u001b") {
          // Start of a CSI / escape sequence. Don't echo, don't
          // accumulate — wait for the terminator.
          inEscape = true;
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          process.stderr.write("\n");
          cleanup();
          resolve(buffer.join(""));
          return;
        }
        if (ch === "\u0003") {
          // Ctrl-C — restore terminal before exiting so the shell
          // prompt isn't left in raw mode.
          process.stderr.write("\n");
          cleanup();
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          // Backspace / Delete — visually erase last '*'.
          if (buffer.length > 0) {
            buffer.pop();
            process.stderr.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue; // skip other control chars silently
        buffer.push(ch);
        process.stderr.write("*");
      }
    };

    stdin.on("data", onData);
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
  try {
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
  } catch {
    // readMaskedLine refuses to read when it can't disable terminal
    // echo (because leaking the key would be worse than failing).
    // The wizard bails; caller prints the follow-up pointer.
    return { cfg, keySet: false };
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
