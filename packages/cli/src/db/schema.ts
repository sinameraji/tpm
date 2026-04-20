// Postgres-compatible: UUID strings, ISO 8601 UTC text, JSON stored as TEXT,
// no SQLite-only features (AUTOINCREMENT, STRICT, without rowid). Keeps the
// door open to moving to Postgres later without rewriting queries.
//
// Cost-column semantics (starting v1.2.0):
// ----------------------------------------
// `model_calls.neurons`, `stage_runs.cost_neurons`, and `audits.total_neurons`
// store **integer micro-USD** (USD × 1e6) as of v1.2.0. The column names are
// preserved from the Workers-AI era so existing users' local SQLite files
// keep working without an ALTER TABLE. Read via COST_COLUMN_SEMANTIC and
// format through core/pricing.ts (formatUsd). A proper rename waits for a
// future 2.0 with an explicit migration path.
export const COST_COLUMN_SEMANTIC = "micro_usd_since_1.2.0" as const;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audits (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL,
  project_path              TEXT NOT NULL,
  target                    TEXT NOT NULL,
  started_at                TEXT NOT NULL,
  ended_at                  TEXT,
  status                    TEXT NOT NULL,
  tpm_version               TEXT NOT NULL,
  config_hash               TEXT,
  pattern_library_hash      TEXT,
  total_neurons             REAL,
  notes                     TEXT
);

CREATE INDEX IF NOT EXISTS idx_audits_started_at ON audits (started_at);
CREATE INDEX IF NOT EXISTS idx_audits_session ON audits (session_id);

CREATE TABLE IF NOT EXISTS stage_runs (
  id                        TEXT PRIMARY KEY,
  audit_id                  TEXT NOT NULL,
  session_id                TEXT NOT NULL,
  stage                     TEXT NOT NULL,
  started_at                TEXT NOT NULL,
  ended_at                  TEXT,
  status                    TEXT NOT NULL,
  model                     TEXT,
  input_hash                TEXT,
  artifact_path             TEXT,
  cost_neurons              REAL,
  error_message             TEXT,
  FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stage_runs_audit ON stage_runs (audit_id);
CREATE INDEX IF NOT EXISTS idx_stage_runs_session ON stage_runs (session_id);

CREATE TABLE IF NOT EXISTS model_calls (
  id                        TEXT PRIMARY KEY,
  audit_id                  TEXT,
  stage_run_id              TEXT,
  session_id                TEXT NOT NULL,
  stage                     TEXT,
  model                     TEXT NOT NULL,
  request_at                TEXT NOT NULL,
  latency_ms                INTEGER,
  input_tokens              INTEGER,
  output_tokens             INTEGER,
  neurons                   REAL,
  status                    TEXT NOT NULL,
  error_message             TEXT,
  FOREIGN KEY (audit_id) REFERENCES audits(id) ON DELETE SET NULL,
  FOREIGN KEY (stage_run_id) REFERENCES stage_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_model_calls_audit ON model_calls (audit_id);
CREATE INDEX IF NOT EXISTS idx_model_calls_session ON model_calls (session_id);
CREATE INDEX IF NOT EXISTS idx_model_calls_request_at ON model_calls (request_at);

CREATE TABLE IF NOT EXISTS schema_meta (
  key                       TEXT PRIMARY KEY,
  value                     TEXT NOT NULL
);
`;

export const DB_SCHEMA_VERSION = "1";
