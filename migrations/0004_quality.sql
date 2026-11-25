-- PanPilot D1 schema v4 — per-subscription quality override (v1.0).
-- The global quality preference profile lives in the settings table
-- (key `quality`, defaults in src/quality.ts); this column is only the
-- optional per-subscription override of its preferred resolution:
-- '2160p' | '1080p' | '720p', NULL = follow the global profile.
-- (The legacy quality_pref column keeps its free-form meaning and is
-- untouched.) Re-running is safe: deploy.py treats "duplicate column"
-- as already applied.

ALTER TABLE subscriptions ADD COLUMN quality TEXT;
