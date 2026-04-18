import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  program
    .command("cost")
    .description("Show Neuron spend — per audit, per stage, per model.")
    .option("--audit <id>", "Restrict to a single audit.")
    .option("--since <iso>", "Only count calls since this ISO 8601 timestamp.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const msg = "cost: aggregation reads from model_calls once M4 populates it.";
      runtime.logger.info("cost requested (skeleton)");
      emitText(runtime, msg);
      emit(runtime, { ok: false, skeleton: true, message: msg });
      process.exitCode = 2;
    });
}
