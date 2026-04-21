import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDatabase, DB_SCHEMA_VERSION } from "./init.js";

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpm-db-test-"));
  return path.join(dir, "pm.sqlite");
}

describe("openDatabase", () => {
  let file: string;
  beforeEach(() => {
    file = tempDbFile();
  });

  it("creates the schema_meta, audits, stage_runs, model_calls tables", () => {
    const db = openDatabase(file);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["audits", "model_calls", "schema_meta", "stage_runs"]),
    );
    db.close();
  });

  it("records the schema_version in schema_meta", () => {
    const db = openDatabase(file);
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = ?").get("schema_version") as
      | { value: string }
      | undefined;
    expect(row?.value).toBe(DB_SCHEMA_VERSION);
    db.close();
  });

  it("is safe to re-open without data loss", () => {
    const db1 = openDatabase(file);
    db1
      .prepare(
        "INSERT INTO audits (id, session_id, project_path, target, started_at, status, tpm_version) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "a1",
        "s1",
        "/tmp/x",
        "https://example.com",
        new Date().toISOString(),
        "pending",
        "0.0.0",
      );
    db1.close();

    const db2 = openDatabase(file);
    const count = db2.prepare("SELECT COUNT(*) as c FROM audits").get() as { c: number };
    expect(count.c).toBe(1);
    db2.close();
  });
});
