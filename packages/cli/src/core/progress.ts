// Minimal TTY progress helper. Writes a spinner to stderr while a task
// runs, replaces it with a check/x on completion. Falls back to plain
// "start/done" lines on non-TTY (CI, --json piping).

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BRAND = "\x1b[38;5;33m"; // blue-ish (ANSI 256 color 33)
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function elapsed(start: number): string {
  return ((Date.now() - start) / 1000).toFixed(1) + "s";
}

export async function withProgress<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const stderr = process.stderr;
  const interactive = stderr.isTTY && !process.env["TPM_NO_PROGRESS"];
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
    // Clear the line fully, then write the done message.
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
