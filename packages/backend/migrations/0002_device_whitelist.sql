-- Adds a whitelist flag to the devices table. Whitelisted devices skip
-- the hosted-trial quota (used for the maintainer, OSS contributors,
-- and anyone else who should have unlimited hosted audits).

ALTER TABLE devices ADD COLUMN is_whitelisted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_devices_whitelisted ON devices (is_whitelisted);
