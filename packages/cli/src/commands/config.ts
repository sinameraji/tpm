import type { Command } from "commander";
import yaml from "js-yaml";
import {
  configSummary,
  getConfigValue,
  loadConfig,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
} from "../core/config.js";
import { bootstrap, emit, emitText } from "./_runtime.js";

const SET_HELP =
  "Known keys: anthropic-key (alias: anthropic_api_key), model-tier (fast|deep), stage_models.{a,b-classify,b-model,b-walk,c,d,e-spec,e-proto,f}.";

export function register(program: Command): void {
  const cfg = program
    .command("config")
    .description("Get/set PM config values (user-level ~/.pm/config.yaml).");

  cfg
    .command("get <key>")
    .description("Print a single config value (anthropic-key is masked).")
    .action(async function action(this: Command, key: string) {
      const runtime = bootstrap(this);
      try {
        const v = getConfigValue(loadConfig(), key);
        if (v === undefined) {
          emitText(runtime, `(unset) ${key}`);
          emit(runtime, { ok: true, key, value: null });
          return;
        }
        emitText(runtime, v);
        emit(runtime, { ok: true, key, value: v });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitText(runtime, `error: ${msg}`);
        emit(runtime, { ok: false, error: msg });
        process.exitCode = 1;
      }
    });

  cfg
    .command("set <key> <value>")
    .description(`Set a config value. ${SET_HELP}`)
    .action(async function action(this: Command, key: string, value: string) {
      const runtime = bootstrap(this);
      try {
        const next = setConfigValue(loadConfig(), key, value);
        saveConfig(next);
        emitText(runtime, `set ${key}`);
        emit(runtime, { ok: true, key });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitText(runtime, `error: ${msg}`);
        emit(runtime, { ok: false, error: msg });
        process.exitCode = 1;
      }
    });

  cfg
    .command("unset <key>")
    .description(`Remove a config value. ${SET_HELP}`)
    .action(async function action(this: Command, key: string) {
      const runtime = bootstrap(this);
      try {
        const next = unsetConfigValue(loadConfig(), key);
        saveConfig(next);
        emitText(runtime, `unset ${key}`);
        emit(runtime, { ok: true, key });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitText(runtime, `error: ${msg}`);
        emit(runtime, { ok: false, error: msg });
        process.exitCode = 1;
      }
    });

  cfg
    .command("show")
    .description("Print the full resolved config (anthropic-key masked).")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const summary = configSummary(loadConfig());
      if (runtime.isJson) {
        emit(runtime, { ok: true, config: summary });
      } else {
        emitText(runtime, yaml.dump(summary, { noRefs: true, lineWidth: 120 }));
      }
    });
}
