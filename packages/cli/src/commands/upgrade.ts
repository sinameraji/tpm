import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  program
    .command("upgrade")
    .description("Upgrade to TPM Pro or Team — opens the browser to complete checkout.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const msg = "upgrade: Stripe flow lands in M15.";
      runtime.logger.info({ device: runtime.device.device_id }, "upgrade requested (skeleton)");
      emitText(runtime, msg);
      emit(runtime, {
        ok: false,
        skeleton: true,
        device_id: runtime.device.device_id,
        message: msg,
      });
      process.exitCode = 2;
    });
}
