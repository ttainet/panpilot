-- PanPilot D1 schema v2 — poster / overview / rating on subscriptions.
-- Filled from TMDB when a subscription is created via the discover flow
-- (poster_path is the raw TMDB path, e.g. /abc123.jpg; the UI prefixes it
-- with https://image.tmdb.org/t/p/...). All columns nullable: manual
-- subscriptions simply have no poster.
-- Idempotency: `wrangler d1 migrations apply` tracks applied files locally
-- and remotely; scripts/deploy.py tolerates "duplicate column" errors when
-- re-applying, so running this twice is harmless.

ALTER TABLE subscriptions ADD COLUMN poster_path TEXT;
ALTER TABLE subscriptions ADD COLUMN overview TEXT;
ALTER TABLE subscriptions ADD COLUMN rating REAL;
