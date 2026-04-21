// Interactive picker for the product-context field. Called from
// `tpm init` (explicit) and from `tpm audit` (if the project has
// never had a context set and stdin is a TTY). Non-TTY skips and
// returns undefined; the caller decides whether to proceed with the
// neutral "not specified" lens.

import * as readline from "node:readline";
import type { ProductContext, ProductContextKind } from "./project-config.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const QUESTION = `Before we start — how do you think of this product today?

  [1] A personal tool (I'm the user)
  [2] An internal tool for my team
  [3] A product aimed at external users
  [4] A work in progress — still figuring out the shape
  [5] Something else — I'll describe it

Pick 1-5 (default 3):`;

function write(line: string): void {
  process.stderr.write(line + "\n");
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

export async function askProductContext(): Promise<ProductContext | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;

  write("");
  write(QUESTION);
  const pick = (await readLine("  >")).trim();

  let kind: ProductContextKind;
  switch (pick) {
    case "1":
      kind = "personal";
      break;
    case "2":
      kind = "internal";
      break;
    case "4":
      kind = "wip";
      break;
    case "5":
      kind = "other";
      break;
    case "3":
    case "":
    default:
      kind = "distributable";
      break;
  }

  if (kind === "other") {
    write("");
    write("Describe the product in one or two sentences:");
    const note = (await readLine("  >")).trim();
    if (!note) {
      // Empty free-form description — fall back to neutral/unspecified.
      return undefined;
    }
    return { kind, note };
  }

  // Optional single-line note for the other kinds — enriches grounding
  // without blocking if the user skips it.
  write("");
  write(`${DIM}Optional: one short note about this product (or press Enter to skip).${RESET}`);
  const note = (await readLine("  >")).trim();
  return note ? { kind, note } : { kind };
}
