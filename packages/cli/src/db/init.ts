import Database, { type Database as Db } from "better-sqlite3";
import { SCHEMA_SQL, DB_SCHEMA_VERSION } from "./schema.js";

export { DB_SCHEMA_VERSION };

export function openDatabase(dbFile: string): Db {
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  const upsert = db.prepare(
    "INSERT INTO schema_meta (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  upsert.run("schema_version", DB_SCHEMA_VERSION);

  return db;
}
