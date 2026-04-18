import type { Command } from "commander";
import { newSession } from "../core/session.js";
import { createLogger, type Logger } from "../core/logger.js";
import { loadOrCreateDevice, type DeviceRecord } from "../auth/device.js";
import { mergedOpts, type GlobalOpts } from "../utils/opts.js";

export interface CommandRuntime {
  logger: Logger;
  sessionId: string;
  device: DeviceRecord;
  opts: GlobalOpts;
  isJson: boolean;
}

export function bootstrap(cmd: Command): CommandRuntime {
  const opts = mergedOpts<GlobalOpts>(cmd);
  const sessionId = opts.sessionId ?? newSession().id;
  const logger = createLogger({
    sessionId,
    verbose: opts.verbose === true,
    pretty: opts.json !== true && process.stderr.isTTY === true,
  });
  const device = loadOrCreateDevice();
  return {
    logger,
    sessionId,
    device,
    opts,
    isJson: opts.json === true,
  };
}

export function emit(runtime: CommandRuntime, payload: Record<string, unknown>): void {
  if (runtime.isJson) {
    process.stdout.write(JSON.stringify(payload) + "\n");
  }
}

export function emitText(runtime: CommandRuntime, text: string): void {
  if (!runtime.isJson) process.stdout.write(text + "\n");
}
