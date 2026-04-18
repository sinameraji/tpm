import type { Command } from "commander";

// Commander collision note: when a parent command declares `--json` as a global
// option and a subcommand also surfaces `--json`, the parent's declaration wins
// and `cmd.opts().json` returns only the parent's view. `optsWithGlobals()`
// merges parent + subcommand opts so callers get the full picture. This bit us
// in a prior scaffold; wrapping it here keeps the fix documented and re-usable.
export function mergedOpts<T>(cmd: Command): T {
  return cmd.optsWithGlobals() as T;
}

export interface GlobalOpts {
  json?: boolean;
  verbose?: boolean;
  sessionId?: string;
}
