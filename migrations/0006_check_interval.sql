-- PanPilot D1 schema v6 — per-subscription check interval (v1.3).
-- NULL = follow the global unified batch schedule (batch points at
-- Beijing 00:00 / 06:00 / 12:00 / 18:00, at least CHECK_INTERVAL_HOURS
-- after the last processing). A value (hours) schedules this
-- subscription's next check exactly that many hours after its last
-- processing, without batch alignment. Re-running is safe: deploy.py
-- treats "duplicate column" as already applied.

ALTER TABLE subscriptions ADD COLUMN check_interval_hours REAL;
