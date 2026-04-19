import * as readline from "node:readline/promises";

// Thin wrapper around node:readline so we can prompt the user at audit
// time. Non-TTY → immediately resolves to undefined so CI/--json runs
// never block.
export async function promptLine(question: string): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || undefined;
  } finally {
    rl.close();
  }
}

const URL_RE = /^https?:\/\/[^\s]+$/;

export function isValidHttpUrl(s: string): boolean {
  return URL_RE.test(s);
}
