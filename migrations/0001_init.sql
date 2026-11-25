-- PanPilot D1 schema v1 — DRAFT, not yet applied anywhere.
-- Mirrors DESIGN.md §4. Apply with: wrangler d1 migrations apply panpilot --remote

CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  original_title  TEXT,
  year            INTEGER,
  tmdb_id         INTEGER,
  media_type      TEXT NOT NULL DEFAULT 'tv',       -- tv | movie | variety
  region          TEXT,                              -- e.g. 国产剧
  season          INTEGER,
  total_episodes  INTEGER,
  quality_pref    TEXT,                              -- JSON array or "match_existing"
  mode            TEXT NOT NULL DEFAULT 'manual',    -- manual | auto
  status          TEXT NOT NULL DEFAULT 'pending_search',
  target_dir      TEXT,
  next_check_at   INTEGER,
  last_checked_at INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_pending ON subscriptions (status, next_check_at);

CREATE TABLE IF NOT EXISTS episodes (
  id                TEXT PRIMARY KEY,
  subscription_id   TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  season            INTEGER NOT NULL,
  episode           INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'missing', -- missing|found|transferring|stored|failed|skipped
  source_share_code TEXT,
  source_channel    TEXT,
  quark_fid         TEXT,
  file_name         TEXT,
  file_size         INTEGER,
  updated_at        INTEGER NOT NULL,
  UNIQUE (subscription_id, season, episode)
);

CREATE TABLE IF NOT EXISTS candidates (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  share_url        TEXT NOT NULL,
  share_code       TEXT NOT NULL,
  channel          TEXT,
  post_url         TEXT,
  title_raw        TEXT,
  episodes_covered TEXT,                             -- JSON array of episode numbers
  quality_label    TEXT,
  total_size       INTEGER,
  score            REAL,
  anomaly_note     TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|rejected|used|dead
  found_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS driver_tasks (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  driver_id        TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  heartbeat_at     INTEGER,
  status           TEXT NOT NULL DEFAULT 'claimed',  -- claimed|running|done|failed|expired
  attempt          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_lease ON driver_tasks (subscription_id, status, lease_expires_at);

CREATE TABLE IF NOT EXISTS logs (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  driver_id       TEXT,
  level           TEXT NOT NULL DEFAULT 'info',      -- info|warn|error
  event           TEXT NOT NULL,
  detail          TEXT,                              -- JSON/text; NEVER store cookies or tokens
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                          -- JSON string
  updated_at INTEGER NOT NULL
);
