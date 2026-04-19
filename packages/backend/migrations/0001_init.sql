-- TPM backend — D1 schema (Cloudflare's Postgres-compatible sqlite).
-- UUID TEXT ids, ISO 8601 UTC text timestamps, JSON stored as TEXT.
-- OSS pivot: no Stripe; every device is on the hosted trial until it
-- graduates to self-host.

CREATE TABLE IF NOT EXISTS devices (
  id                        TEXT PRIMARY KEY,        -- device uuid v4 (client-generated)
  fingerprint_hash          TEXT NOT NULL,           -- sha256 of hostname|platform|arch|cpus
  first_seen_at             TEXT NOT NULL,
  last_seen_at              TEXT NOT NULL,
  ip_first_seen             TEXT,
  abuse_flag                INTEGER NOT NULL DEFAULT 0,
  banned_at                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices (fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_devices_abuse ON devices (abuse_flag);

-- Backend-side audit metadata (summary only; full artifacts live in R2).
CREATE TABLE IF NOT EXISTS audits (
  id                        TEXT PRIMARY KEY,
  device_id                 TEXT NOT NULL,
  session_id                TEXT NOT NULL,
  target                    TEXT NOT NULL,
  started_at                TEXT NOT NULL,
  ended_at                  TEXT,
  status                    TEXT NOT NULL,
  tier_at_run               TEXT NOT NULL DEFAULT 'hosted_trial',
  total_neurons             REAL,
  cost_per_stage_json       TEXT,
  r2_prefix                 TEXT,
  tpm_version               TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audits_device_started ON audits (device_id, started_at);
CREATE INDEX IF NOT EXISTS idx_audits_session ON audits (session_id);

CREATE TABLE IF NOT EXISTS usage_log (
  id                        TEXT PRIMARY KEY,        -- uuid v4
  device_id                 TEXT NOT NULL,
  audit_id                  TEXT,
  session_id                TEXT NOT NULL,
  stage                     TEXT,                    -- A | B | C | D | E | F | meta
  model                     TEXT NOT NULL,
  request_at                TEXT NOT NULL,
  input_tokens              INTEGER,
  output_tokens             INTEGER,
  neurons                   REAL,
  latency_ms                INTEGER,
  status                    TEXT NOT NULL,
  error_message             TEXT,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_device_ts ON usage_log (device_id, request_at);
CREATE INDEX IF NOT EXISTS idx_usage_audit ON usage_log (audit_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key                       TEXT NOT NULL,
  window_start              TEXT NOT NULL,
  count                     INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key                       TEXT PRIMARY KEY,
  value                     TEXT NOT NULL
);

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
