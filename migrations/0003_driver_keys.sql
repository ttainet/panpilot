-- PanPilot D1 schema v3 — UI-managed Driver API keys (v0.6).
-- Each Driver can have its own named key, created/reset/revoked from the
-- settings page. The table stores ONLY the SHA-256 hash of the token plus a
-- display hint (e.g. "ppk_…ab12"); the plaintext token ("ppk_" + 32 random
-- bytes as hex) is shown exactly once, in the create/reset response, and is
-- never persisted or logged. The DRIVER_TOKEN Worker secret remains as a
-- bootstrap key that always works and is not represented in this table.
-- Idempotent: CREATE ... IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS driver_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,                        -- e.g. claude-main, home-nas-01
  token_hash   TEXT NOT NULL UNIQUE,                 -- SHA-256 hex of the full token
  token_hint   TEXT NOT NULL,                        -- display only, e.g. ppk_…ab12
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,                              -- throttled touch on successful auth
  revoked_at   INTEGER                               -- NULL = active
);
CREATE INDEX IF NOT EXISTS idx_driver_keys_hash ON driver_keys (token_hash);
