import pino, { type Logger } from "pino";

export interface LoggerOptions {
  sessionId: string;
  verbose?: boolean;
  pretty?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const level = opts.verbose ? "debug" : (process.env["TPM_LOG_LEVEL"] ?? "info");

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
