import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  const cfg = program
    .command("config")
    .description("Get/set TPM config values (user-level ~/.tpm/config.yaml).");

  cfg
    .command("get <key>")
    .description("Print a single config value.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      emitText(runtime, "config get: skeleton — full reader lands alongside M4.");
      emit(runtime, { ok: false, skeleton: true });
      process.exitCode = 2;
    });

  cfg
    .command("set <key> <value>")
    .description("Set a config value.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      emitText(runtime, "config set: skeleton — full writer lands alongside M4.");
      emit(runtime, { ok: false, skeleton: true });
      process.exitCode = 2;
    });

  cfg
    .command("show")
    .description("Print the full resolved config.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      emitText(runtime, "config show: skeleton.");
      emit(runtime, { ok: false, skeleton: true });
      process.exitCode = 2;
    });
}
