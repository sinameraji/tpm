import pino, { type Logger } from "pino";

export interface LoggerOptions {
  sessionId: string;
  verbose?: boolean;
  pretty?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  // Quiet by default — only actual errors print to the terminal. The
  // stage-runner's semantic-retry WARNs ("stage output failed semantic
  // checks, violations: [...]") are internal debugging: users saw
  // "file_path not in seed_files" and reasonably asked what that
  // meant. Those belong behind --verbose, not in the happy path.
  // TPM_LOG_LEVEL env still wins so CI can force any level.
  const level = opts.verbose ? "debug" : (process.env["TPM_LOG_LEVEL"] ?? "error");

  const base = {
    level,
    base: { session_id: opts.sessionId, tpm: "cli" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // pino defaults to stdout; we want stderr so stdout stays clean for --json piping.
  const destination = pino.destination({ fd: 2, sync: false });

  if (opts.pretty) {
    const transport = pino.transport({
      target: "pino-pretty",
      options: { destination: 2, colorize: true, singleLine: false },
    });
    return pino(base, transport);
  }

  return pino(base, destination);
}

export type { Logger };
