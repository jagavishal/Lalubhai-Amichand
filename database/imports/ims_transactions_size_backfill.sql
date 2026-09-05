-- One-time, OPTIONAL backfill for the new ims_transactions.size column.
--
-- The column is added automatically on server start (see SCHEMA in server.js)
-- and every NEW Trading Inward/Outward entry carries the Size typed on the
-- form. Entries logged BEFORE that column existed have size = '', so the Size
-- column on the Trading Inward/Outward List is blank for them.
--
-- Run this once (MySQL/MariaDB) to fill those historical rows from whatever
-- size the item currently carries in the catalog. Trading only — Stores/ALU/
-- Accessories don't show a Size column on their ledgers, so leaving their
-- entries blank matches what those screens display.
--
-- This is deliberately NOT part of the automatic schema migration: it would
-- re-run on every restart and would overwrite a Size an operator intentionally
-- left blank on a specific entry.
--
--   mysql -u <user> -p <database> < ims_transactions_size_backfill.sql

UPDATE ims_transactions t
JOIN ims_items i ON i.item_code = t.item_code
SET t.size = i.size
WHERE t.size = ''
  AND i.size <> ''
  AND i.category = 'Trading';

-- Check what it touched:
-- SELECT t.id, t.txn_date, t.item_code, t.size, t.quantity
--   FROM ims_transactions t JOIN ims_items i ON i.item_code = t.item_code
--  WHERE i.category = 'Trading' ORDER BY t.created_at DESC LIMIT 20;
