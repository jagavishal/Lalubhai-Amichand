-- ============================================================================
-- IMS Stores -- current_stock sync from the "IMS (Stores)" Google Sheet's
-- Closing Stock column (IMS tab, col L), sheet day 2026-09-23, run date 2026-09-23
-- https://docs.google.com/spreadsheets/d/19wbm97_bYYsVDCpgOzGHZlriYc81McuPSKpqumf96MI/edit?gid=1105757494#gid=1105757494
--
-- Dialect: MySQL / MariaDB  (production DB is MariaDB -- ignore the Postgres
--          instructions in DEPLOY.md).
--
-- GENERATED FILE -- do not hand-edit. Regenerate with:
--   node scripts/gen-ims-stores-stock-update.js --date=2026-09-23 --by="Akhilesh (ERP)"
--
-- WHAT THIS FILE DOES
--   STEP 1 (recommended) : backup snapshot of the Stores book's stock, for undo.
--   STEP 2 (required)    : load the sheet's 84 Closing Stock values into a
--                          temporary table.
--   STEP 3 (required)    : log one 'ADJ' ims_transactions row per item whose DB
--                          stock differs from the sheet -- exactly what the app's
--                          Physical Stock form does (see _imsPhysicalStockUpdate
--                          in server.js), so the Report tab's Day-wise Stock
--                          history stays correct for days before 2026-09-23.
--                          Items that already match get no row.
--   STEP 4 (required)    : UPDATE current_stock to the sheet value for every
--                          Stores item that has a row in the sheet.
--   STEP 5 (optional)    : INSERT any sheet item code that does not exist in
--                          ims_items yet (guarded by NOT EXISTS). Nothing to
--                          adjust for these -- the sheet value is their opening.
--   STEP 6               : verification SELECTs.
--
-- Run STEPS 2-6 in ONE session (the temporary table is session-scoped) and in
-- this order -- STEP 3 must read current_stock BEFORE STEP 4 overwrites it.
--
-- NOTES / DATA QUALITY
--   - 87 sheet rows read, 84 carry a Closing Stock, 0 duplicates.
--   - 3 row(s) have a BLANK Closing Stock. Blank is not zero, so they
--     are NOT in the temp table and their DB stock is left untouched:
--       SKU 14 (COCONUT OIL)
--       SKU 44 (EXTRA SANDPAPER J-297)
--       SKU 87 (120 NO EMERY PAPER)
--   - 16 of the 84 items close at exactly 0; 0 NEGATIVE.
--   - Sum of all Closing Stock values loaded = 84307.25.
--   - The generator asserted Closing Stock == the sheet's last date column
--     (2026-09-23) on every row, so this really is that day's closing figure.
--   - Safe to re-run: STEP 3 only logs items that still differ, so a second run
--     the same day logs nothing; STEP 4 re-asserts the same numbers; STEP 5 is
--     guarded by NOT EXISTS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 (recommended) -- undo snapshot. Run this BEFORE step 3.
-- ----------------------------------------------------------------------------
-- CREATE TABLE ims_items_stores_stock_bak_20260923 AS
-- SELECT item_code, current_stock AS old_stock, NOW() AS backed_up_at
-- FROM   ims_items WHERE category = 'Stores';
--
-- To undo later (also cancel/delete the ADJ rows STEP 3 inserted -- see STEP 6):
-- UPDATE ims_items i
--   JOIN ims_items_stores_stock_bak_20260923 b ON b.item_code = i.item_code
--   SET  i.current_stock = b.old_stock, i.updated_at = NOW()
-- WHERE i.category = 'Stores';


-- ----------------------------------------------------------------------------
-- STEP 2 (required) -- the sheet's Closing Stock, one row per item code.
-- ----------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_stores_closing_20260923;
CREATE TEMPORARY TABLE tmp_stores_closing_20260923 (
  item_code   VARCHAR(32)   NOT NULL PRIMARY KEY,
  description VARCHAR(255)  NOT NULL DEFAULT '',
  uom         VARCHAR(16)   NOT NULL DEFAULT '',
  closing     DECIMAL(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;  -- same collation ims_items is normalized to (server.js), so the JOIN cannot hit an "illegal mix of collations"

INSERT INTO tmp_stores_closing_20260923 (item_code, description, uom, closing) VALUES
  ('SKU 1', 'ALUMINUM WELDING ROD 1.63 MM SMALL', 'Kg', 8.45),
  ('SKU 2', 'ALUMINUM WELDING ROD 2 MM', 'Kg', 13.50),
  ('SKU 3', 'LUBRICANT OIL 40 NO', 'Ltr', 234.22),
  ('SKU 4', 'ALUMINUM DRAWING POWDER', 'kg', 173.10),
  ('SKU 5', 'COTTON WASTE', 'kg', 127.24),
  ('SKU 6', 'WHITE COTTON WASTE', 'kg', 42.45),
  ('SKU 7', 'PHOSPHORIC ACID', 'PCS', 28.00),
  ('SKU 8', 'SULFURIC ACID', 'PCS', 27.00),
  ('SKU 9', 'NITRIC ACID', 'PCS', 23.00),
  ('SKU 10', 'HYDROFLUORIC ACID', 'PCS', 5.00),
  ('SKU 11', 'CHROMIC ACID', 'kg', 62.75),
  ('SKU 12', 'CAUSTIC SODA', 'kg', 300.00),
  ('SKU 13', 'LIME POWDER', 'kg', 3.30),
  ('SKU 15', 'KEROSENE', 'Ltr', 31.11),
  ('SKU 16', 'HYDRAULIC OIL 68 NO', 'Ltr', 182.05),
  ('SKU 17', 'COMPRESSOR OIL 220 NO', 'Ltr', 24.00),
  ('SKU 18', 'ALL-PURPOSE GREASE', 'kg', 10.50),
  ('SKU 19', 'BRASS INSERT', 'kg', 45.00),
  ('SKU 20', 'OXYGEN CYLINDER', 'c.m', 5.00),
  ('SKU 21', 'LPG CYLINDER', 'kg', 3.00),
  ('SKU 22', 'POLYETHYLENE BAG 8*8', 'kg', 144.22),
  ('SKU 23', 'POLYETHYLENE BAG 10*10', 'kg', 128.71),
  ('SKU 24', 'POLYETHYLENE BAG 10*12', 'kg', 162.40),
  ('SKU 25', 'POLYETHYLENE BAG 11*13', 'kg', 74.95),
  ('SKU 26', 'POLYETHYLENE BAG 12*12', 'kg', 67.14),
  ('SKU 27', 'POLYETHYLENE BAG 13*15', 'kg', 154.70),
  ('SKU 28', 'POLYETHYLENE BAG 14*16', 'kg', 87.85),
  ('SKU 29', 'POLYETHYLENE BAG 16*18', 'kg', 132.50),
  ('SKU 30', 'POLYETHYLENE BAG 18*20', 'kg', 109.18),
  ('SKU 31', 'POLYETHYLENE BAG 20*20', 'kg', 157.90),
  ('SKU 32', 'POLYETHYLENE BAG 20*22', 'kg', 85.80),
  ('SKU 33', 'POLYETHYLENE BAG 24*24', 'kg', 243.52),
  ('SKU 34', 'POLYETHYLENE BAG 26*26', 'kg', 197.74),
  ('SKU 35', 'POLYETHYLENE BAG 28*28', 'kg', 96.80),
  ('SKU 36', 'POLYETHYLENE BAG 32*32', 'kg', 120.70),
  ('SKU 37', 'TAPER WHEEL', 'pcs', 5.00),
  ('SKU 38', 'QUENCHING OIL', 'Ltr', 0.00),
  ('SKU 39', 'HYDRAULIC OIL 100 FOR CNC', 'Ltr', 0.00),
  ('SKU 40', 'STEEL WOOL', 'kg', 0.00),
  ('SKU 41', 'LIME POWDER LIQUID', 'Ltr', 870.00),
  ('SKU 42', 'AMMONIUM ALUM', 'kg', 777.27),
  ('SKU 43', 'SANDPAPER COARSE 297', 'PCS', 21.00),
  ('SKU 45', 'EMERY PAPER J-297 FINE', 'PCS', 0.00),
  ('SKU 46', 'RANI PAPER', 'PCS', 139.00),
  ('SKU 47', 'EMERY PAPER 320 NO', 'PCS', 254.00),
  ('SKU 48', 'GREEN POLISHING BAR', 'PCS', 75.00),
  ('SKU 49', 'MADRAS BUFF 12 * 12', 'PCS', 6.00),
  ('SKU 50', 'COTTON HAND GLOVES JE', 'PCS', 39.00),
  ('SKU 51', 'KNITTED HAND GLOVES SMALL', 'PCS', 108.00),
  ('SKU 52', 'KNITTED HAND GLOVES HEAVY', 'PCS', 0.00),
  ('SKU 53', 'PVC-COATED HAND GLOVES', 'PCS', 18.00),
  ('SKU 54', 'GREEN SCOTCH-BRITE HAND PAD', 'PCS', 150.00),
  ('SKU 55', 'MILD STEEL WELDING ROD NO.10', 'PKT', 58.00),
  ('SKU 56', 'MILD STEEL WELDING ROD NO.08', 'PKT', 0.00),
  ('SKU 57', 'BAKLITE MILK JUG KNOB', 'PCS', 35500.00),
  ('SKU 58', 'STAINLESS STEEL MILK JUG SCREW', 'PCS', 38616.00),
  ('SKU 59', 'WOODEN STICK', 'PCS', 14.00),
  ('SKU 60', 'ALUMINUM BRAZING POWDER (PUNE)', 'PCS', 42.00),
  ('SKU 61', 'ALUMINUM BRAZING POWDER (MUMBAI)', 'PCS', 7.00),
  ('SKU 62', 'BOPP TAPE ROLL (BROWN)', 'PCS', 251.00),
  ('SKU 63', 'YELLOW CLOTH', 'KG', 0.00),
  ('SKU 64', 'MILD STEEL WIRE', 'KG', 0.00),
  ('SKU 65', 'WOOD WASTE', 'KG', 9.00),
  ('SKU 66', 'SAFETY MASK', 'PCS', 0.00),
  ('SKU 67', 'APRON', 'PCS', 0.00),
  ('SKU 68', 'SAFETY GOGGLES', 'PCS', 0.00),
  ('SKU 69', 'GUMBOOT', 'PCS', 0.00),
  ('SKU 70', 'STEEL CAP RIVET', 'KG', 5.00),
  ('SKU 71', 'TUBE LIGHT', 'PCS', 2.00),
  ('SKU 72', '4 MFD CAPACITOR', 'PCS', 0.00),
  ('SKU 73', '6 MFD CAPACITOR', 'PCS', 0.00),
  ('SKU 74', '2.5 MFD CAPACITOR', 'PCS', 2.00),
  ('SKU 75', 'L&T MK-1 4 TO 6.5 A', 'PCS', 0.00),
  ('SKU 76', 'L&T MK-1 4 TO 10 A', 'PCS', 0.00),
  ('SKU 77', '35 AMPERE SWITCH', 'PCS', 1.00),
  ('SKU 78', 'HALOGEN LIGHT 200W', 'PCS', 1.00),
  ('SKU 79', 'WHITE TAPE ROLL 3"', 'PCS', 287.00),
  ('SKU 80', 'WHITE TAPE ROLL 1/2"', 'PCS', 1024.00),
  ('SKU 81', 'WOOD BLOCK', 'PCS', 8.00),
  ('SKU 82', 'SAW FIREWOOD', 'KGS', 2310.00),
  ('SKU 83', 'GLASS WOOD', 'KG', 2.20),
  ('SKU 84', 'MODERN M.JUG BAKLITE KNOB', 'PCS', 380.00),
  ('SKU 85', '6KW ELECTRIC HEATER', 'KGS', 3.00),
  ('SKU 86', 'CONTAINER CARGO NET', 'PCS', 10.00);


-- ----------------------------------------------------------------------------
-- STEP 3 (required) -- log the variance as ADJ ledger rows, same shape as the
-- app's Physical Stock form. Ids continue the app's ADJ000001 sequence.
-- ----------------------------------------------------------------------------
SET @adj_seq := (
  SELECT COALESCE(MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)), 0)
  FROM   ims_transactions
  WHERE  id LIKE 'ADJ%' AND SUBSTRING(id, 4) REGEXP '^[0-9]+$'
);

INSERT INTO ims_transactions
  (id, txn_date, direction, item_code, item_name, size, quantity, uom, department, remarks, status, created_by, source)
SELECT
  CONCAT('ADJ', LPAD(@adj_seq := @adj_seq + 1, 6, '0')),
  '2026-09-23',
  'ADJ',
  i.item_code,
  i.description,
  i.size,
  ROUND(t.closing - i.current_stock, 2),
  i.uom,
  '',
  CONCAT('Physical count: ', t.closing + 0, ' (system was ', i.current_stock + 0,
         ', variance ', IF(t.closing > i.current_stock, '+', ''), ROUND(t.closing - i.current_stock, 2) + 0,
         '). Synced from IMS (Stores) sheet Closing Stock for 2026-09-23.'),
  'Active',
  'Akhilesh (ERP)',
  ''
FROM   tmp_stores_closing_20260923 t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  i.category = 'Stores'
  AND  ROUND(t.closing - i.current_stock, 2) <> 0
ORDER  BY CAST(SUBSTRING(i.item_code, 5) AS UNSIGNED), i.item_code;


-- ----------------------------------------------------------------------------
-- STEP 4 (required) -- set current_stock to the sheet's Closing Stock.
-- ----------------------------------------------------------------------------
UPDATE ims_items i
  JOIN tmp_stores_closing_20260923 t ON t.item_code = i.item_code
  SET  i.current_stock = t.closing, i.updated_at = NOW()
WHERE i.category = 'Stores';


-- ----------------------------------------------------------------------------
-- STEP 5 (optional) -- sheet items that do not exist in ims_items yet.
-- Description / unit come from the sheet; moq, max_level, size, vendor are
-- left blank/0 to be filled in from the IMS page. Inserts nothing if every
-- sheet code already exists.
-- ----------------------------------------------------------------------------
INSERT INTO ims_items
  (item_code, description, size, uom, moq, max_level, on_order_qty, vendor_name, current_stock, category)
SELECT t.item_code, t.description, '', t.uom, 0, 0, 0, '', t.closing, 'Stores'
FROM   tmp_stores_closing_20260923 t
WHERE  NOT EXISTS (SELECT 1 FROM ims_items i WHERE i.item_code = t.item_code);


-- ----------------------------------------------------------------------------
-- STEP 6 -- verification.
-- ----------------------------------------------------------------------------
-- Expect: stores_items >= 84, sum_stock = 84307.25 + stock of the
-- 3 blank-closing item(s) left untouched.
SELECT COUNT(*) AS stores_items, ROUND(SUM(current_stock), 2) AS sum_stock
FROM   ims_items WHERE category = 'Stores';

-- ADJ rows this run created (one per item that moved):
SELECT id, item_code, quantity, remarks
FROM   ims_transactions
WHERE  direction = 'ADJ' AND txn_date = '2026-09-23' AND created_by = 'Akhilesh (ERP)'
ORDER  BY id;

-- Should be empty -- any sheet code still differing from the DB:
SELECT t.item_code, t.closing, i.current_stock
FROM   tmp_stores_closing_20260923 t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  ROUND(t.closing - i.current_stock, 2) <> 0;

-- Sheet codes filed under a different book (they were NOT touched by STEP 3/4):
SELECT i.item_code, i.category, i.current_stock, t.closing
FROM   tmp_stores_closing_20260923 t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  i.category <> 'Stores';

DROP TEMPORARY TABLE IF EXISTS tmp_stores_closing_20260923;
