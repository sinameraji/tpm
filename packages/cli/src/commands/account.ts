import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  program
    .command("account")
    .description("Open the Stripe Customer Portal for this device's subscription.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const msg = "account: Customer Portal link lands in M15.";
      runtime.logger.info({ device: runtime.device.device_id }, "account requested (skeleton)");
      emitText(runtime, msg);
      emit(runtime, { ok: false, skeleton: true, message: msg });
      process.exitCode = 2;
    });
}
