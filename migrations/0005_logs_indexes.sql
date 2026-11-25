-- PanPilot schema v5 — logs pagination indexes (v1.1).
-- The logs table itself (id, subscription_id, driver_id, level, event,
-- detail, created_at) already exists since 0001; the web 日志 page reads
-- it newest-first with level / subscription filters, so add the indexes
-- that access pattern needs. All statements are IF NOT EXISTS, so
-- re-running (deploy.py applies every file) is a no-op.

CREATE INDEX IF NOT EXISTS idx_logs_created ON logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level_created ON logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_sub_created ON logs (subscription_id, created_at DESC);
