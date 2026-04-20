import type { Command } from "commander";
import { openDatabase } from "../db/init.js";
import { projectPaths } from "../core/paths.js";
import { formatUsd } from "../core/pricing.js";
import { bootstrap, emit, emitText } from "./_runtime.js";

interface CostRow {
  id: string;
  started_at: string;
  status: string;
  total_neurons: number | null;
}

export function register(program: Command): void {
  program
    .command("cost")
    .description("Show what your TPM audits cost (reads local SQLite).")
    .option("--audit <id>", "Restrict to a single audit id or prefix.")
    .option("--since <iso>", "Only include audits started after this ISO 8601 timestamp.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      const opts = this.opts<{ audit?: string; since?: string }>();
      const paths = projectPaths(process.cwd());
      const db = openDatabase(paths.dbFile);
      try {
        // total_neurons has stored micro-USD integers since v1.2.0
        // (see db/schema.ts COST_COLUMN_SEMANTIC). The column name is
        // preserved for SQLite back-compat.
        const where: string[] = [];
        const args: Array<string> = [];
        if (opts.audit) {
          where.push("id LIKE ?");
          args.push(`${opts.audit}%`);
        }
        if (opts.since) {
          where.push("started_at >= ?");
          args.push(opts.since);
        }
        const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const rows = db
          .prepare<
            unknown[],
            CostRow
          >(`SELECT id, started_at, status, total_neurons FROM audits ${whereSql} ORDER BY started_at DESC`)
          .all(...args);

        if (rows.length === 0) {
          emitText(runtime, "No audits match (or no audits in this project yet).");
          emit(runtime, { ok: true, audits: [], total_micro_usd: 0 });
          return;
        }

        let total = 0;
        if (!runtime.isJson) {
          emitText(runtime, "id          started                   status        cost");
          emitText(runtime, "────────    ──────────────────────    ─────────     ─────────");
          for (const r of rows) {
            const micro = r.total_neurons ?? 0;
            total += micro;
            const cost = formatUsd(micro).padStart(9);
            emitText(
              runtime,
              `${r.id.slice(0, 8)}    ${r.started_at.padEnd(22)}    ${r.status.padEnd(9)}    ${cost}`,
            );
          }
          emitText(runtime, "────────    ──────────────────────    ─────────     ─────────");
          emitText(
            runtime,
            `                                                     ${formatUsd(total).padStart(9)} total`,
          );
        } else {
          for (const r of rows) total += r.total_neurons ?? 0;
        }

        emit(runtime, {
          ok: true,
          audits: rows.map((r) => ({
            id: r.id,
            started_at: r.started_at,
            status: r.status,
            micro_usd: r.total_neurons ?? 0,
          })),
          total_micro_usd: total,
        });
      } finally {
        db.close();
      }
    });
}
