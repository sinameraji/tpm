import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { Command } from "commander";
import { projectPaths } from "../core/paths.js";
import { openDatabase } from "../db/init.js";
import { formatUsd } from "../core/pricing.js";
import { bootstrap, emit, emitText } from "./_runtime.js";

interface AuditRow {
  id: string;
  started_at: string;
  status: string;
  total_neurons: number | null;
}

function resolveAuditDir(projectRoot: string, auditIdOrPrefix?: string): string | null {
  const paths = projectPaths(projectRoot);
  if (!fs.existsSync(paths.artifactsDir)) return null;

  if (auditIdOrPrefix) {
    const exact = path.join(paths.artifactsDir, auditIdOrPrefix);
    if (fs.existsSync(exact)) return exact;
    // Prefix match (e.g., first 8 chars of the UUID).
    const matches = fs
      .readdirSync(paths.artifactsDir)
      .filter((name) => name.startsWith(auditIdOrPrefix));
    if (matches.length === 1) return path.join(paths.artifactsDir, matches[0]!);
    if (matches.length > 1) return null; // ambiguous
    return null;
  }

  // No id given — use the db to find the latest succeeded audit, else fall back to mtime.
  if (fs.existsSync(paths.dbFile)) {
    const db = openDatabase(paths.dbFile);
    try {
      const row = db
        .prepare<
          [],
          AuditRow
        >("SELECT id, started_at, status, total_neurons FROM audits ORDER BY started_at DESC LIMIT 1")
        .get();
      if (row) {
        const dir = path.join(paths.artifactsDir, row.id);
        if (fs.existsSync(dir)) return dir;
      }
    } finally {
      db.close();
    }
  }
  const entries = fs
    .readdirSync(paths.artifactsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const full = path.join(paths.artifactsDir, e.name);
      return { name: e.name, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0] ? path.join(paths.artifactsDir, entries[0].name) : null;
}

function listAudits(projectRoot: string): AuditRow[] {
  const paths = projectPaths(projectRoot);
  if (!fs.existsSync(paths.dbFile)) return [];
  const db = openDatabase(paths.dbFile);
  try {
    return db
      .prepare<
        [],
        AuditRow
      >("SELECT id, started_at, status, total_neurons FROM audits ORDER BY started_at DESC")
      .all();
  } finally {
    db.close();
  }
}

function openInBrowser(filePath: string): { ok: boolean; error?: string } {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [filePath], { detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function register(program: Command): void {
  program
    .command("report")
    .description("Open a prior audit's spec.html (or print its path).")
    .argument("[audit_id]", "Audit id or its first N chars. Defaults to the latest audit.")
    .option("--all", "List all audits in this project instead of opening one.")
    .option("--md", "Print the path to spec.md instead of opening spec.html.")
    .action(async function action(
      this: Command,
      auditId: string | undefined,
      opts: { all?: boolean; md?: boolean },
    ) {
      const runtime = bootstrap(this);
      const projectRoot = process.cwd();

      if (opts.all) {
        const audits = listAudits(projectRoot);
        if (audits.length === 0) {
          emitText(runtime, "No audits in this project. Run `tpm audit` first.");
          emit(runtime, { ok: true, audits: [] });
          return;
        }
        for (const a of audits) {
          // total_neurons has been integer micro-USD since v1.2.0
          // (see db/schema.ts COST_COLUMN_SEMANTIC). Format as $ even
          // though the column name is preserved for back-compat.
          const cost = a.total_neurons !== null ? formatUsd(a.total_neurons) : "—";
          emitText(runtime, `  ${a.id}  ${a.started_at}  ${a.status}  ${cost}`);
        }
        emit(runtime, { ok: true, audits });
        return;
      }

      const dir = resolveAuditDir(projectRoot, auditId);
      if (!dir) {
        const hint = auditId
          ? `No audit matches "${auditId}". Try \`tpm report --all\` to list audits.`
          : "No audits in this project. Run `tpm audit` first.";
        emitText(runtime, hint);
        emit(runtime, { ok: false, error: "audit not found" });
        process.exitCode = 1;
        return;
      }

      const specMd = path.join(dir, "spec.md");
      const specHtml = path.join(dir, "spec.html");

      if (opts.md) {
        if (!fs.existsSync(specMd)) {
          emitText(runtime, `spec.md not found in ${dir}`);
          emit(runtime, { ok: false, error: "spec.md missing" });
          process.exitCode = 1;
          return;
        }
        emitText(runtime, specMd);
        emit(runtime, { ok: true, audit_dir: dir, spec_md: specMd });
        return;
      }

      if (!fs.existsSync(specHtml)) {
        emitText(runtime, `spec.html not found in ${dir}`);
        emit(runtime, { ok: false, error: "spec.html missing" });
        process.exitCode = 1;
        return;
      }

      // In JSON mode or without a TTY, print the path instead of opening a browser.
      if (runtime.isJson || !process.stdout.isTTY) {
        emitText(runtime, specHtml);
        emit(runtime, { ok: true, audit_dir: dir, spec_html: specHtml });
        return;
      }

      const res = openInBrowser(specHtml);
      if (!res.ok) {
        emitText(runtime, `Could not open ${specHtml}: ${res.error}`);
        emit(runtime, { ok: false, error: res.error });
        process.exitCode = 1;
        return;
      }
      emitText(runtime, `Opening ${specHtml}`);
      emit(runtime, { ok: true, audit_dir: dir, spec_html: specHtml });
    });
}
