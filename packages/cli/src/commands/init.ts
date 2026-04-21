import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { projectPaths, ensureDir } from "../core/paths.js";
import { openDatabase } from "../db/init.js";
import { saveProjectConfig, type ProjectConfig } from "../core/project-config.js";
import { runKeyWizard } from "../core/init-wizard.js";
import { printPitch } from "../core/pre-flight.js";
import { askProductContext } from "../core/product-context-prompt.js";
import { bootstrap, emit, emitText } from "./_runtime.js";

// `tpm init` is idempotent: run it as many times as you want. It
// does two independent things:
//   1. Project-level init — creates .tpm/ with a SQLite db and a
//      project config yaml. Safe to re-run; everything here uses
//      {recursive: true} / open-or-create semantics.
//   2. Key wizard — sets / replaces the Anthropic key in
//      ~/.tpm/config.yaml. The wizard itself handles "key already
//      set, replace? [y/N]" so we don't guard it here.

export function register(program: Command): void {
  program
    .command("init")
    .description("Initialize TPM for the current project and set up your Anthropic API key.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      if (!runtime.isJson) printPitch();
      const cwd = process.cwd();
      const paths = projectPaths(cwd);
      const already = fs.existsSync(paths.root);

      ensureDir(paths.root, 0o755);
      ensureDir(paths.artifactsDir, 0o755);

      const db = openDatabase(paths.dbFile);
      db.close();

      const cfg: ProjectConfig = { schema_version: 1, project_path: cwd };
      // Ask for product context on first init (TTY only). Saves the
      // audit from defaulting to "distributable product" + inventing
      // target personas when the repo is a personal/internal/WIP tool.
      if (!runtime.isJson) {
        const ctx = await askProductContext();
        if (ctx) cfg.product_context = ctx;
      }
      saveProjectConfig(cfg, cwd);

      if (already) {
        emitText(
          runtime,
          `TPM project dir already set up at ${path.relative(cwd, paths.root)}/ — existing audits preserved.`,
        );
      } else {
        emitText(runtime, `Initialized TPM at ${paths.root}`);
        emitText(runtime, ` - db:        ${path.relative(cwd, paths.dbFile)}`);
        emitText(runtime, ` - artifacts: ${path.relative(cwd, paths.artifactsDir)}/`);
        emitText(runtime, ` - config:    ${path.relative(cwd, paths.configYaml)}`);
      }

      // Key wizard is TTY-only; CI / scripted init stays quiet and
      // the user can set the key via `tpm config set anthropic-key`.
      if (!runtime.isJson) {
        await runKeyWizard({ allowReplace: true });
      }

      emitText(runtime, "Now run:  tpm audit");
      emit(runtime, {
        ok: true,
        initialized: true,
        project_already_existed: already,
        paths: {
          root: paths.root,
          db: paths.dbFile,
          artifacts: paths.artifactsDir,
          config: paths.configYaml,
        },
      });
    });
}
