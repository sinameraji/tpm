import { Command } from "commander";
import { TPM_VERSION } from "@tpm/shared";
import { register as registerInit } from "./commands/init.js";
import { register as registerAudit } from "./commands/audit.js";
import { register as registerReport } from "./commands/report.js";
import { register as registerConfig } from "./commands/config.js";
import { register as registerSelfHost } from "./commands/self-host.js";
import { register as registerCost } from "./commands/cost.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("tpm")
    .description(
      "TPM — Technical Product Manager. Audits software products via a deterministic six-stage pipeline.",
    )
    .version(TPM_VERSION)
    .option("--json", "Emit structured JSON on stdout; logs remain on stderr.")
    .option("--verbose", "Enable debug-level logs.")
    .option(
      "--session-id <id>",
      "Override the session id (default: fresh UUID v4 per invocation).",
    );

  registerInit(program);
  registerAudit(program);
  registerReport(program);
  registerConfig(program);
  registerSelfHost(program);
  registerCost(program);

  return program;
}

export async function run(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv, { from: "user" });
}
