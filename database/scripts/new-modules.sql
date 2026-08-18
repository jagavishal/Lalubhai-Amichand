-- =====================================================================
--  NEW MODULES MIGRATION
--  Run this ONCE on your Neon Postgres database (SQL editor or psql).
--  Creates tables for: Daily Task (timesheet), Leave Tracker.
--  Daily Reports needs NO new table (it reads daily_tasks + delegations).
-- =====================================================================

-- 1) DAILY TASK (timesheet) ------------------------------------------------
--    One submission = one or more rows that share the same doer + entry_date.
CREATE TABLE IF NOT EXISTS daily_tasks (
  id          TEXT PRIMARY KEY,
  entry_date  DATE NOT NULL,
  doer_id     TEXT,
  doer        TEXT NOT NULL,
  client      TEXT,
  department  TEXT,
  description TEXT,
  minutes     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_doer_date ON daily_tasks (doer_id, entry_date);

-- 2) LEAVE TRACKER ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaves (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  user_name   TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'Leave',     -- Leave | WFH | Extra Working
  from_date   DATE NOT NULL,
  to_date     DATE NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  approver    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leaves_user ON leaves (user_id);
