-- ============================================================================
-- IMS Trading — standardise UOM on KGS
--
-- The Trading book's forms now offer KGS and nothing else (see TRADING_UOM in
-- public/js/pages/inward.js / outward.js, and the UOM field on the Report tab's
-- item form in ims.js). This brings the rows that are already in the database
-- into line: the Hindalco import seeded ims_items.uom blank for the whole
-- Trading catalog, and entries logged before this change carry whatever unit
-- was picked at the time ('Kg', 'KGS', or blank).
--
-- MySQL/MariaDB dialect (production is MariaDB — the Postgres snippets in
-- DEPLOY.md do not apply here).
--
-- Scope: category='Trading' only. Stores / ALU / Accessories keep their own
-- mixed units and are untouched by every statement below.
--
-- Run the two SELECTs first to see what will change, then the two UPDATEs.
-- ============================================================================

-- Preview 1 — catalog rows and the unit they carry today.
SELECT COALESCE(NULLIF(uom, ''), '(blank)') AS current_uom, COUNT(*) AS items
FROM ims_items
WHERE category = 'Trading'
GROUP BY COALESCE(NULLIF(uom, ''), '(blank)')
ORDER BY items DESC;

-- Preview 2 — ledger entries (Inward/Outward/adjustments) against those items.
SELECT COALESCE(NULLIF(t.uom, ''), '(blank)') AS current_uom, COUNT(*) AS entries
FROM ims_transactions t
JOIN ims_items i ON i.item_code = t.item_code
WHERE i.category = 'Trading'
GROUP BY COALESCE(NULLIF(t.uom, ''), '(blank)')
ORDER BY entries DESC;

-- ── Apply ───────────────────────────────────────────────────────────────────
-- Only the unit label changes. No quantity, current_stock or status is touched,
-- so nothing here moves a balance — the Trading book was always weighed in
-- kilograms, this just says so consistently.

UPDATE ims_items
SET uom = 'KGS'
WHERE category = 'Trading' AND uom <> 'KGS';

UPDATE ims_transactions t
JOIN ims_items i ON i.item_code = t.item_code
SET t.uom = 'KGS'
WHERE i.category = 'Trading' AND t.uom <> 'KGS';

-- Verify — both queries should come back with KGS as the only row.
SELECT COALESCE(NULLIF(uom, ''), '(blank)') AS uom_after, COUNT(*) AS items
FROM ims_items WHERE category = 'Trading' GROUP BY COALESCE(NULLIF(uom, ''), '(blank)');

SELECT COALESCE(NULLIF(t.uom, ''), '(blank)') AS uom_after, COUNT(*) AS entries
FROM ims_transactions t JOIN ims_items i ON i.item_code = t.item_code
WHERE i.category = 'Trading' GROUP BY COALESCE(NULLIF(t.uom, ''), '(blank)');
