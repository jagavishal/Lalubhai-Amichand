-- ============================================================================
-- Drop the meetings table
--
-- The Meetings page was removed in f144c4c ("Remove the Daily Task and
-- Meetings pages"), which dropped the page script, its sidebar entry, its
-- topbar title, its per-user permission checkbox, and the /api/meetings
-- routes (GET, POST, DELETE). That commit deliberately left the table behind
-- so the existing rows survived; nothing has read them since.
--
-- The table's CREATE statements are now gone from the app too -- server.js's
-- SCHEMA list, backend/lib/db-postgres.js, and
-- database/scripts/new-modules.sql -- so a fresh install never creates it
-- again and this script is what clears it from databases that already have it.
-- 'meetings' also came out of server.js's collation-repair table list, so
-- startup no longer touches it.
--
-- MySQL/MariaDB dialect (production is MariaDB -- the Postgres snippets in
-- DEPLOY.md do not apply here).
--
-- THIS DELETES DATA PERMANENTLY. Run the preview first, and take the backup
-- if you want the rows kept anywhere.
-- ============================================================================

-- Preview -- how many meetings are about to be destroyed, and their range.
SELECT COUNT(*)            AS rows_to_delete,
       MIN(meeting_date)   AS earliest,
       MAX(meeting_date)   AS latest
FROM meetings;

-- Optional backup -- keeps a copy under a new name instead of losing the rows.
-- Skip this if the data is genuinely not wanted.
-- CREATE TABLE meetings_backup_20260818 AS SELECT * FROM meetings;

-- Drop. The index idx_mtg_date lives inside the table and goes with it; no
-- other table references meetings (the schema is FK-less by design).
DROP TABLE IF EXISTS meetings;
