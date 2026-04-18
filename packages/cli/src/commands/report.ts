import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  program
    .command("report")
    .description("Show a prior audit's spec.md (or open its PDF).")
    .argument("[audit_id]", "Audit id. Defaults to latest.")
    .option("--all", "List all audits instead of showing one.")
    .option("--pdf", "Open the PDF artifact instead of stdout.")
    .action(async function action(this: Command, auditId?: string) {
      const runtime = bootstrap(this);
      const msg = "report: no audits yet — artifact assembly lands in M12.";
      runtime.logger.info({ auditId }, "report requested (skeleton)");
      emitText(runtime, msg);
      emit(runtime, { ok: false, skeleton: true, stage: "F", message: msg });
      process.exitCode = 2;
    });
}
