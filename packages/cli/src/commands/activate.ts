import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  program
    .command("activate")
    .description("Activate a license with a one-time code (fallback if browser polling fails).")
    .argument("[code]", "Activation code from the upgrade flow.")
    .action(async function action(this: Command, code?: string) {
      const runtime = bootstrap(this);
      const msg = "activate: lands in M15 alongside tpm upgrade.";
      runtime.logger.info({ code_provided: Boolean(code) }, "activate requested (skeleton)");
      emitText(runtime, msg);
      emit(runtime, { ok: false, skeleton: true, message: msg });
      process.exitCode = 2;
    });
}
