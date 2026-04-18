-- TPM backend — D1 schema (Cloudflare's Postgres-compatible sqlite).
-- UUID TEXT ids, ISO 8601 UTC text timestamps, JSON stored as TEXT.

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

CREATE TABLE IF NOT EXISTS licenses (
  id                        TEXT PRIMARY KEY,        -- uuid v4
  device_id                 TEXT NOT NULL,
  tier                      TEXT NOT NULL,           -- free | pro | team
  status                    TEXT NOT NULL,           -- active | canceled | past_due | trialing
  stripe_customer_id        TEXT,
  stripe_subscription_id    TEXT,
  seat_count                INTEGER NOT NULL DEFAULT 1,
  current_period_start      TEXT,
  current_period_end        TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  canceled_at               TEXT,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_licenses_device ON licenses (device_id);
CREATE INDEX IF NOT EXISTS idx_licenses_stripe_sub ON licenses (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses (status);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                        TEXT PRIMARY KEY,        -- stripe subscription id
  license_id                TEXT NOT NULL,
  device_id                 TEXT NOT NULL,
  stripe_customer_id        TEXT NOT NULL,
  price_id                  TEXT NOT NULL,
  status                    TEXT NOT NULL,
  cancel_at_period_end      INTEGER NOT NULL DEFAULT 0,
  current_period_start      TEXT,
  current_period_end        TEXT,
  raw_event_json            TEXT,                    -- last webhook event for audit
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subs_device ON subscriptions (device_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions (status);

-- Backend-side audit metadata (summary only; full artifacts live in R2).
CREATE TABLE IF NOT EXISTS audits (
  id                        TEXT PRIMARY KEY,
  device_id                 TEXT NOT NULL,
  session_id                TEXT NOT NULL,
  target                    TEXT NOT NULL,
  started_at                TEXT NOT NULL,
  ended_at                  TEXT,
  status                    TEXT NOT NULL,
  tier_at_run               TEXT NOT NULL,
  total_neurons             REAL,
  cost_per_stage_json       TEXT,                    -- {"A": 0.10, "B": 0.15, ...}
  r2_prefix                 TEXT,                    -- s3-style prefix for artifacts
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

CREATE TABLE IF NOT EXISTS patterns (
  id                        TEXT PRIMARY KEY,
  slug                      TEXT NOT NULL UNIQUE,
  title                     TEXT NOT NULL,
  category                  TEXT NOT NULL,
  body_json                 TEXT NOT NULL,           -- full pattern body (works_when, fails_when, exemplars, detection_signals)
  source                    TEXT NOT NULL,           -- built_in | custom_project | custom_org
  owner_device_id           TEXT,                    -- null for built_in
  version                   INTEGER NOT NULL DEFAULT 1,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patterns_source ON patterns (source);
CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns (category);

CREATE TABLE IF NOT EXISTS webhook_events (
  id                        TEXT PRIMARY KEY,        -- stripe event id (idempotency key)
  type                      TEXT NOT NULL,
  received_at               TEXT NOT NULL,
  processed_at              TEXT,
  status                    TEXT NOT NULL,           -- received | processed | failed | replay
  raw_json                  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_type ON webhook_events (type);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events (status);

CREATE TABLE IF NOT EXISTS rate_limits (
  key                       TEXT NOT NULL,           -- e.g. "device_register:1.2.3.4"
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
