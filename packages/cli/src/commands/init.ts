import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { projectPaths, ensureDir } from "../core/paths.js";
import { openDatabase } from "../db/init.js";
import { saveProjectConfig, type ProjectConfig } from "../core/project-config.js";
import { runKeyWizard } from "../core/init-wizard.js";
import { bootstrap, emit, emitText } from "./_runtime.js";

export function register(program: Command): void {
  program
    .command("init")
    .description("Initialize TPM in the current project (creates .tpm/ with SQLite DB + config).")
    .option("--force", "Re-initialize even if .tpm/ already exists.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const opts = this.opts<{ force?: boolean }>();
      const cwd = process.cwd();
      const paths = projectPaths(cwd);

      const already = fs.existsSync(paths.root);
      if (already && !opts.force) {
        runtime.logger.info({ path: paths.root }, "already initialized");
        emitText(runtime, `Already initialized: ${paths.root}`);
        emitText(runtime, "Pass --force to reinitialize.");
        emit(runtime, { ok: true, already_initialized: true, path: paths.root });
        return;
      }

      ensureDir(paths.root, 0o755);
      ensureDir(paths.artifactsDir, 0o755);

      const db = openDatabase(paths.dbFile);
      db.close();

      const cfg: ProjectConfig = { schema_version: 1, project_path: cwd };
      saveProjectConfig(cfg, cwd);

      runtime.logger.info({ project: cwd }, "initialized");
      emitText(runtime, `Initialized TPM at ${paths.root}`);
      emitText(runtime, ` - db:        ${path.relative(cwd, paths.dbFile)}`);
      emitText(runtime, ` - artifacts: ${path.relative(cwd, paths.artifactsDir)}/`);
      emitText(runtime, ` - config:    ${path.relative(cwd, paths.configYaml)}`);

      // v1.2.0: also walk the user through the Anthropic key + tier
      // on first init. TTY-only; CI / scripted init stays quiet and
      // the user can set the key via `tpm config set anthropic-key`.
      if (!runtime.isJson) {
        await runKeyWizard({ allowReplace: true });
      }

      emitText(runtime, "\nNow run:  tpm audit");
      emit(runtime, {
        ok: true,
        initialized: true,
        paths: {
          root: paths.root,
          db: paths.dbFile,
          artifacts: paths.artifactsDir,
          config: paths.configYaml,
        },
      });
    });
}
