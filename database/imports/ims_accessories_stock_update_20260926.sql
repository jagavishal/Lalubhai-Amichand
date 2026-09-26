-- ============================================================================
-- IMS Accessories -- current_stock sync from the "IMS (Accessory Store)"
-- Google Sheet's Closing Stock column (IMS tab, col L), sheet day 2026-09-26, run date 2026-09-26
-- https://docs.google.com/spreadsheets/d/1hoNaa_Xt87IRIDJIGvN-AuyM0Tv5BZqUbuelbh9wtto/edit
--
-- Dialect: MySQL / MariaDB  (production DB is MariaDB -- ignore the Postgres
--          instructions in DEPLOY.md).
--
-- GENERATED FILE -- do not hand-edit. Regenerate with:
--   node scripts/gen-ims-accessories-stock-update.js --date=2026-09-26 --by="Akhilesh (ERP)"
--
-- WHAT THIS FILE DOES
--   STEP 1 (recommended) : backup snapshot of the Accessories book's stock, for undo.
--   STEP 2 (required)    : load the sheet's 226 Closing Stock values into a
--                          temporary table.
--   STEP 3 (required)    : log one 'ADJ' ims_transactions row per item whose DB
--                          stock differs from the sheet -- exactly what the app's
--                          Physical Stock form does (see _imsPhysicalStockUpdate
--                          in server.js), so the Report tab's Day-wise Stock
--                          history stays correct for days before 2026-09-26.
--                          Items that already match get no row.
--   STEP 4 (required)    : UPDATE current_stock to the sheet value for every
--                          Accessories item that has a row in the sheet.
--   STEP 5 (optional)    : INSERT any sheet item code that does not exist in
--                          ims_items yet, uom='PCS' (every Accessories item is
--                          pieces -- see ims_items_accessories_import.sql).
--   STEP 6               : verification SELECTs.
--
-- Run STEPS 2-6 in ONE session (the temporary table is session-scoped) and in
-- this order -- STEP 3 must read current_stock BEFORE STEP 4 overwrites it.
--
-- NOTES / DATA QUALITY
--   - 234 sheet rows read, 226 carry a Closing Stock, 0 duplicates.
--   - 8 row(s) have a BLANK Closing Stock. Blank is not zero, so they
--     are NOT in the temp table and their DB stock is left untouched:
--       ACC-12 (KEETLE PIPE NO.00 FOR 8")
--       ACC-147 (D.COVER HANDLE)
--       ACC-187 (1/8MMX8MM-FLAT HEAD)
--       ACC-196 (6.5MMX10MM-ROUND HEAD)
--       ACC-210 (MODERN KETTLE HANDLE - 12'')
--       ACC-211 (MODERN KETTLE HANDLE - 14'')
--       ACC-231 (MODERN KETTLE PIPE NO 3)
--       ACC-232 (MODERN KETTLE PIPE NO 4)
--   - 77 of the 226 items close at exactly 0; 0 NEGATIVE.
--   - Sum of all Closing Stock values loaded = 1012881.4.
--   - The generator asserted Closing Stock == the sheet's last date column
--     (2026-09-26) on every row, and cross-checked Available-% = Closing/Max
--     on 91 rows, so this really is that day's closing figure.
--   - Safe to re-run: STEP 3 only logs items that still differ, so a second run
--     the same day logs nothing; STEP 4 re-asserts the same numbers; STEP 5 is
--     guarded by NOT EXISTS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 (recommended) -- undo snapshot. Run this BEFORE step 3.
-- ----------------------------------------------------------------------------
-- CREATE TABLE ims_items_accessories_stock_bak_20260926 AS
-- SELECT item_code, current_stock AS old_stock, NOW() AS backed_up_at
-- FROM   ims_items WHERE category = 'Accessories';
--
-- To undo later (also cancel/delete the ADJ rows STEP 3 inserted -- see STEP 6):
-- UPDATE ims_items i
--   JOIN ims_items_accessories_stock_bak_20260926 b ON b.item_code = i.item_code
--   SET  i.current_stock = b.old_stock, i.updated_at = NOW()
-- WHERE i.category = 'Accessories';


-- ----------------------------------------------------------------------------
-- STEP 2 (required) -- the sheet's Closing Stock, one row per item code.
-- ----------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_accessories_closing_20260926;
CREATE TEMPORARY TABLE tmp_accessories_closing_20260926 (
  item_code   VARCHAR(32)   NOT NULL PRIMARY KEY,
  description VARCHAR(255)  NOT NULL DEFAULT '',
  closing     DECIMAL(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;  -- same collation ims_items is normalized to (server.js), so the JOIN cannot hit an "illegal mix of collations"

INSERT INTO tmp_accessories_closing_20260926 (item_code, description, closing) VALUES
  ('ACC-01', 'KETTLE MOGRA NO.1 FOR 10-12"', 4650.00),
  ('ACC-02', 'KETTLE MOGRA NO.2 FOR 13-15"', 2000.00),
  ('ACC-03', 'KETTLE MOGRA NO.3 FOR 16-32"', 2490.00),
  ('ACC-04', 'KAVADANi MOGRA NO.O FOR 5-9', 1780.00),
  ('ACC-05', 'KETTLE MOGRA WASHER', 10000.00),
  ('ACC-06', 'KETTLE PIPE NO.1 FOR 10-11"', 236.00),
  ('ACC-07', 'KETTLE PIPE NO.2 FOR 12-13"', 606.00),
  ('ACC-08', 'KETTLE PIPE NO.3 FOR 14-15"', 250.00),
  ('ACC-09', 'KETTLE PIPE NO.4 FOR 16', 480.00),
  ('ACC-10', 'KETTLE PIPE NO.5 FOR 17-20"', 0.00),
  ('ACC-11', 'KETTLE PIPE NO.6 FOR 22-32"', 80.00),
  ('ACC-13', 'KEETLE PIPE NO.0 FOR 9"', 0.00),
  ('ACC-14', 'KEETLE HANDLE 5"x 7" (PVC)', 888.00),
  ('ACC-15', 'KEETLE HANDLE 8" (PVC)', 2595.00),
  ('ACC-16', 'KEETLE HANDLE 9" (PVC)', 0.00),
  ('ACC-17', 'KETTLE HANDLE 10X11"(PVC)', 3769.00),
  ('ACC-18', 'KETTLE HANDLE 12X13"(PVC)', 4450.00),
  ('ACC-19', 'KETTLE HANDLE 14X15"(PVC)', 1970.00),
  ('ACC-20', 'KETTLE HANDLE 16" (PVC)', 3529.00),
  ('ACC-21', 'KETTLE HANDLE 17X18"(PVC)', 348.00),
  ('ACC-22', 'KETTLE HANDLE 20"(PVC)', 420.00),
  ('ACC-23', 'KETTLE HANDLE 22"(PVC)', 0.00),
  ('ACC-24', 'KETTLE HANDLE 24"(PVC)', 1422.00),
  ('ACC-25', 'KETTLE HANDLE 26"(PVC)', 1106.00),
  ('ACC-26', 'KETTLE HANDLE 28"(PVC)', 483.00),
  ('ACC-27', 'KETTLE HANDLE 30"(PVC)', 588.00),
  ('ACC-28', 'KEETLE HANDLE 32" (PVC)', 6.00),
  ('ACC-29', 'KETTLE HANDLE 10X11"', 904.00),
  ('ACC-30', 'KETTLE HANDLE 12X13"', 188.00),
  ('ACC-31', 'KETTLE HANDLE 14X15"', 171.00),
  ('ACC-32', 'KETTLE HANDLE 16"', 230.00),
  ('ACC-33', 'KETTLE HANDLE 17X18"', 48.00),
  ('ACC-34', 'KETTLE HANDLE 20"', 0.00),
  ('ACC-35', 'KETTLE HANDLE 22', 34.00),
  ('ACC-36', 'KETTLE HANDLE 24', 0.00),
  ('ACC-37', 'KETTLE HANDLE 26"', 52.00),
  ('ACC-38', 'KETTLE HANDLE 28"', 51.00),
  ('ACC-39', 'MOGRA NO.1 FOR 10"', 470.00),
  ('ACC-40', 'MOGRA NO.2 FOR 12-14"', 309.00),
  ('ACC-41', 'MOGRA NO.3 FOR 16-32"', 350.00),
  ('ACC-42', 'HANDLE NO.1 FOR 10"', 530.00),
  ('ACC-43', 'HANDLE NO.2 FOR 12"', 160.00),
  ('ACC-44', 'HANDLE NO.3 FOR 14"', 240.00),
  ('ACC-45', 'HANDLE NO.4 FOR 16"', 143.00),
  ('ACC-46', 'HANDLE NO.5 FOR 18"20', 399.00),
  ('ACC-47', 'HANDLE NO.6 FOR 22"', 1354.00),
  ('ACC-48', 'HANDLE NO.7 FOR 24-32"', 140.00),
  ('ACC-49', 'BODY HANDLE-16 FOR 20"', 0.00),
  ('ACC-50', 'BODY HANDLE -18 FOR 22"', 60.00),
  ('ACC-51', 'BODY HANDLE -20 FOR 24"', 166.00),
  ('ACC-52', 'BODY HANDLE -22 FOR 24"', 78.00),
  ('ACC-53', 'BODY HANDLE -24 FOR 26"', 57.00),
  ('ACC-54', 'BODY HANDLE - 26 FOR 28"', 0.00),
  ('ACC-55', 'BODY HANDLE - 28', 0.00),
  ('ACC-56', 'TOPE KANPA -32-40"(SMALL)', 2470.00),
  ('ACC-57', 'TOPE HANDLE-32-40"(SMALL)', 1129.00),
  ('ACC-58', 'TOPE KANPA-42-58"(BIG)', 2222.00),
  ('ACC-59', 'TOPE HANDLE -42-58"(BIG)', 875.00),
  ('ACC-60', 'BADNA PIPE', 0.00),
  ('ACC-61', 'BADNA BRACKET-13-15', 500.00),
  ('ACC-62', 'BADNA HANDLE -13X15', 1135.00),
  ('ACC-63', 'HANDLE NO.1', 1311.00),
  ('ACC-64', 'HANDLE NO.2 FOR 11"', 0.00),
  ('ACC-65', 'HANDLE NO.3 FOR 12-13"', 109.00),
  ('ACC-66', 'HANDLE NO.4 FOR 14"', 0.00),
  ('ACC-67', 'SAUCE PAN BRACKET', 0.00),
  ('ACC-68', 'KHUMASDAN HANDLE (SMALL)10-17', 1265.00),
  ('ACC-69', 'KHUMASDAN HANDLE (BIG) 18-28', 1320.00),
  ('ACC-70', 'MILK JUG TOTI PATRI SET', 3500.00),
  ('ACC-71', 'MILK JUG TOTI PATRI (WELDING)', 1000.00),
  ('ACC-72', 'MILK JUG BRACKET -11X13', 5380.00),
  ('ACC-73', 'MILK JUG BRACKET - 15X20', 2100.00),
  ('ACC-74', 'MILK JUG HANDLE(SMALL)FOR 11"', 9580.00),
  ('ACC-75', 'MILK JUG HANDLE (MEDIUM)13-15', 2000.00),
  ('ACC-76', 'MILK JUG HANDLE(BIG)FOR 17-20', 2700.00),
  ('ACC-77', 'CLASSIC MILK JUG TOTI PATRI SET', 1800.00),
  ('ACC-78', 'CLASSIC MILK JUG TOTI PATRI WEL', 0.00),
  ('ACC-79', 'CLASSIC MILK JUG COVER BRACKET', 8250.00),
  ('ACC-80', 'CLASSICS MILK JUG BODY BRACKET', 12800.00),
  ('ACC-81', 'CLASSIC MILK JUG HANDLE 11"', 490.00),
  ('ACC-82', 'CLASSIC MILK JUG HANDLE 13"', 275.00),
  ('ACC-83', 'CLASSIC MILK JUG HANDLE 15"', 215.00),
  ('ACC-84', 'HANDLE NO.1 FOR 9-10"', 0.00),
  ('ACC-85', 'HANDLE NO.2 FOR 11-12"', 130.00),
  ('ACC-86', 'HANDLE NO.3 FOR 13-15"', 234.00),
  ('ACC-87', 'HANDLE NO.4 FOR 16-18"', 0.00),
  ('ACC-88', 'HANDLE NO.1 FOR 8-9"', 3066.00),
  ('ACC-89', 'HANDLE NO.2 FOR 10"', 713.00),
  ('ACC-90', 'HANDLE NO.3 FOR 11-12"', 60.00),
  ('ACC-91', 'HANDLE NO.4 FOR 13"', 102.00),
  ('ACC-92', 'HANDLE NO.5 FOR 14"', 713.00),
  ('ACC-93', 'HANDLE NO.6', 0.00),
  ('ACC-94', 'HANDLE NO.7 FOR 16-18"', 70.00),
  ('ACC-95', 'WIRE HANDLE KADI FOR 6-7-8-9', 6500.00),
  ('ACC-96', 'WIRE HANDLE PATRI FOR 6-9"', 34800.00),
  ('ACC-97', 'FRONT MIJAGAR FOR 6-9"', 14980.00),
  ('ACC-98', 'BACK MIJAGAR FOR 6-9"', 19270.00),
  ('ACC-99', 'NAKUCHA NO.0 FOR 6-7-8-9"', 23650.00),
  ('ACC-100', 'HANDLE NO.1 FOR 10"', 720.00),
  ('ACC-101', 'HANDLE NO.2 FOR 12-18"', 595.00),
  ('ACC-102', 'FRONT MIJAGAR FOR 10-28"', 0.00),
  ('ACC-103', 'BACK MIJAGAR FOR 10-28"', 470.00),
  ('ACC-104', 'HANDLE PATRI FOR 10-28"', 6600.00),
  ('ACC-105', 'NEW NAXI DABBA PATRI (BIG)', 0.00),
  ('ACC-106', 'WIRE HANDLE -10"', 480.00),
  ('ACC-107', 'WIRE HANDLE -12"', 0.00),
  ('ACC-108', 'WIRE HANDLE -14"', 0.00),
  ('ACC-109', 'WIRE HANDLE -16"', 184.00),
  ('ACC-110', 'WIRE HANDLE -18"', 132.00),
  ('ACC-111', 'WIRE HANDLE-20 "', 361.00),
  ('ACC-112', 'WIRE HANDLE -22"', 377.00),
  ('ACC-113', 'WIRE HANDLE -24"', 1.80),
  ('ACC-114', 'WIRE HANDLE -26"', 1.80),
  ('ACC-115', 'WIRE HANDLE -28"', 1.80),
  ('ACC-116', 'M/CAN FRONT MIJAGAR (SMALL)', 3940.00),
  ('ACC-117', 'M/CAN FRONT MIJAGRA (MEDIUM)', 2468.00),
  ('ACC-118', 'M/CAN FRONT MIJAGAR (BIG)', 125.00),
  ('ACC-119', 'M/CAN BACK MIJAGRA (SMALL)', 5084.00),
  ('ACC-120', 'M/CAN BACK MIJAGAR(MEDIUM)', 0.00),
  ('ACC-121', 'M/CAN NAKUCHA(SMALL)', 0.00),
  ('ACC-122', 'M/CAN NAKUCHA (BIG)', 0.00),
  ('ACC-123', 'M/CAN KANPA(SMALL)', 3745.00),
  ('ACC-124', 'M/CAN KANPA(BIG)', 4413.00),
  ('ACC-125', 'BALTI KANPA', 692.00),
  ('ACC-126', 'MUG HANDLE SMALL (7-8)', 6425.00),
  ('ACC-127', 'MUG HANDLE MEDIUM (9-10)', 5450.00),
  ('ACC-128', 'MUG HANDLE BIG (11-12)', 133.00),
  ('ACC-129', 'COLLENDER HANDLE(2 HOLE)SMALL', 500.00),
  ('ACC-130', 'COLLENDER HANDLE ( 2 HOLE)BIG', 328.00),
  ('ACC-131', 'COLLENDER HANDLE ( 3 HOLE)BIG', 0.00),
  ('ACC-132', 'COLLENDER HANDLE FOR PARAT', 0.00),
  ('ACC-133', 'COLLENDER HANDLE W/O CHAPLA', 0.00),
  ('ACC-134', 'COLLENDER HANDLE FOR CHHIBA', 0.00),
  ('ACC-135', 'ALU.TRAY WIRE HANDLE', 0.00),
  ('ACC-136', 'ALU.TRAY HANDLE BRACKET', 4913.00),
  ('ACC-137', 'S.S.WIRE HANDLE FOR ALU.TRAY', 100.00),
  ('ACC-138', 'LADEL HANDLE', 260.00),
  ('ACC-139', 'S.S. ENGLAND TYPE CASEROLL HANDLE', 0.00),
  ('ACC-140', 'CASEROLL WIRE HANDLE SMALL', 0.00),
  ('ACC-141', 'CASEROLL WIRE HANDLE BIG', 0.00),
  ('ACC-142', 'HALWAI HANDLE NO.01', 1003.00),
  ('ACC-143', 'HALWAI HANDLE NO.02', 65.00),
  ('ACC-144', 'HALWAI HANDLE NO.03', 32.00),
  ('ACC-145', 'D.HANDLE', 808.00),
  ('ACC-146', 'D.KANPA', 101.00),
  ('ACC-148', 'ALU.SHEET-24X36X4.47MM-07SWG', 0.00),
  ('ACC-149', 'ALU.SHEET-24X36X3.25MM-10SWG', 0.00),
  ('ACC-150', 'ALU.SHEET-24X36X2.60MM-12SWG', 0.00),
  ('ACC-151', 'ALU.SHEET-24X36X2.0MM- 14SWG', 0.00),
  ('ACC-152', 'ALU.STRIPS-245MMX16.5MMX12G', 0.00),
  ('ACC-153', 'ALU.STRIPS-290MMX19.5X12SWG', 0.00),
  ('ACC-154', 'ALU STRIPS -330MMX19.5X12SWG', 0.00),
  ('ACC-155', 'ALU.STRIPS-59MMX12SWG', 0.00),
  ('ACC-156', 'ALU.STRIPS-90MMX12SWG', 0.00),
  ('ACC-157', 'ALU STRIPS-57MMX12G', 0.00),
  ('ACC-158', 'ALU STRIPS-68MMX12G', 0.00),
  ('ACC-159', 'ALU STRIPS-250MMX24MMX12G', 0.00),
  ('ACC-160', 'ALU.STRIPS-370MMX1"X10SWG', 0.00),
  ('ACC-161', 'ALU STRIPS 16"X1X10SWG', 0.00),
  ('ACC-162', 'ALU.STRIPS-102MMX10SWG', 0.00),
  ('ACC-163', 'ALU STRIPS -54MMX14 SWG', 0.00),
  ('ACC-164', 'ALU STRIPS-33MMX14SWG', 0.00),
  ('ACC-165', 'ALU STRIPS-37MMX14SWG', 0.00),
  ('ACC-166', 'ALU.STRIPS-44MMX14SWG', 0.00),
  ('ACC-167', 'ALU STRIPS-95MMX14SWG', 0.00),
  ('ACC-168', 'ALU.STRIPS-50MM X 14SWG', 0.00),
  ('ACC-169', 'ALU STRIPS-65MMX14SWG', 0.00),
  ('ACC-170', 'ALU STRIPS-170MMX14SWG', 0.00),
  ('ACC-171', 'ALU STRIPS-214MMX14SWG', 0.00),
  ('ACC-172', 'ALU STRIPS-17"MMX1X7SWG', 0.00),
  ('ACC-173', 'ALU STRIPS-18:MMX1X7SWG', 0.00),
  ('ACC-174', 'ALU STRIPS-20"MMX1X7SWG', 0.00),
  ('ACC-175', 'ALU STRIPS-21"MMX1X7SWG', 0.00),
  ('ACC-176', 'ALY STRIPS-22"MMX1X7SWG', 0.00),
  ('ACC-177', 'ALU STRIPS-24"MMX1X7SWG', 0.00),
  ('ACC-178', 'ALU STRIPS-26"MMX1X7SWG', 0.00),
  ('ACC-179', 'ALU STRIPS-51/4MMX7SWG', 0.00),
  ('ACC-180', 'ALU STRIPS 94MMX18SWG', 0.00),
  ('ACC-181', 'ALU-STRIPS-39MMX20SWG', 0.00),
  ('ACC-182', '5MM X 11MM-FLAT HEAD', 31400.00),
  ('ACC-183', '5MMX12.5MM-FLATE HEAD', 38500.00),
  ('ACC-184', '5MMX17MM-RH', 40000.00),
  ('ACC-185', '4MMX9MM-FLATE HEAD', 41600.00),
  ('ACC-186', '4MMX11MM-FLATE HEAD', 36800.00),
  ('ACC-188', '1/8MMX24MM-ROUND HEAD', 38950.00),
  ('ACC-189', '1.8MMX21MM-ROUND HEAD', 19300.00),
  ('ACC-190', '3.8MMX9MM-FLATE HEAD', 128400.00),
  ('ACC-191', '3.8MMX7MM-FLATE HEAD', 10300.00),
  ('ACC-192', '7MMX18MM-ROUND HEAD', 11810.00),
  ('ACC-193', '7MMX21MM-ROUND HEAD', 3433.00),
  ('ACC-194', '7MM X 13MM-ROUND HEAD', 0.00),
  ('ACC-195', '7MMX15MM-ROUND HEAD', 32772.00),
  ('ACC-197', '3.16MMX13MM-ROUND HEAD', 12500.00),
  ('ACC-198', '2.5MMX21MM-FLAT HEAD', 86400.00),
  ('ACC-199', '2.5MMX27MM-FLATE HEAD', 148872.00),
  ('ACC-200', '2.5MMX29MM-FLATE HEAD', 6500.00),
  ('ACC-201', '1.8MMX34MM-FLATE HEAD', 17400.00),
  ('ACC-202', '5MMX17MM-FLATE HEAD', 35500.00),
  ('ACC-203', 'ROUND KEETLE HANDLE - 10"', 0.00),
  ('ACC-204', 'ROUND KEETLE HANDLE - 12"', 179.00),
  ('ACC-205', 'ROUND KEETLE HANDLE - 14"', 159.00),
  ('ACC-206', 'ROUND KEETLE HANDLE - 16"', 0.00),
  ('ACC-207', 'ROUND KEETLE HANDLE - 18"', 0.00),
  ('ACC-208', 'ROUND KEETLE HANDLE - 20"', 100.00),
  ('ACC-209', 'ROUND KEETLE HANDLE - 22"', 0.00),
  ('ACC-212', 'MODERN KETTLE HANDLE - 16''''', 133.00),
  ('ACC-213', 'kETTLE HANDLE 5X7', 0.00),
  ('ACC-214', 'KETTLE HANDLE 8"', 0.00),
  ('ACC-215', 'KETTLE HANDLE 9"', 54.00),
  ('ACC-216', 'MODERN MJ CASTING HANDLE 11X13', 0.00),
  ('ACC-217', 'MODERN MJ CASTING HANDLE 15"', 0.00),
  ('ACC-218', 'S. NALI - NO.4', 275.00),
  ('ACC-219', 'S. NALI - NO.6', 85.00),
  ('ACC-220', 'S. NALI - NO.7', 0.00),
  ('ACC-221', 'S. NALI - NO.9', 0.00),
  ('ACC-222', 'S. MOGRA NO.1', 2020.00),
  ('ACC-223', 'S. MOGRA NO.2', 391.00),
  ('ACC-224', 'S. KETTLE HANDLE 10"', 250.00),
  ('ACC-225', 'S. KETTLE HANDLE 11"', 40.00),
  ('ACC-226', 'S. KETTLE HANDLE 12+13"', 41.00),
  ('ACC-227', 'S. KETTLE HANDLE 14+15"', 68.00),
  ('ACC-228', 'S. KETTLE HANDLE 16"', 39.00),
  ('ACC-229', 'MODERN KETTLE PIPE NO 1', 374.00),
  ('ACC-230', 'MODERN KETTLE PIPE NO 2', 206.00),
  ('ACC-233', 'MODERN KETTLE PIPE NO 5', 300.00),
  ('ACC-234', 'MODERN KETTLE PIPE NO 6', 227.00);


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
  '2026-09-26',
  'ADJ',
  i.item_code,
  i.description,
  i.size,
  ROUND(t.closing - i.current_stock, 2),
  i.uom,
  '',
  CONCAT('Physical count: ', t.closing + 0, ' (system was ', i.current_stock + 0,
         ', variance ', IF(t.closing > i.current_stock, '+', ''), ROUND(t.closing - i.current_stock, 2) + 0,
         '). Synced from IMS (Accessory Store) sheet Closing Stock for 2026-09-26.'),
  'Active',
  'Akhilesh (ERP)',
  ''
FROM   tmp_accessories_closing_20260926 t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  i.category = 'Accessories'
  AND  ROUND(t.closing - i.current_stock, 2) <> 0
ORDER  BY i.item_code;


-- ----------------------------------------------------------------------------
-- STEP 4 (required) -- set current_stock to the sheet's Closing Stock.
-- ----------------------------------------------------------------------------
UPDATE ims_items i
  JOIN tmp_accessories_closing_20260926 t ON t.item_code = i.item_code
  SET  i.current_stock = t.closing, i.updated_at = NOW()
WHERE i.category = 'Accessories';


-- ----------------------------------------------------------------------------
-- STEP 5 (optional) -- sheet items that do not exist in ims_items yet.
-- uom is 'PCS' (every Accessories item is pieces); size, moq, max_level,
-- vendor are left blank/0 to be filled in from the IMS page.
-- ----------------------------------------------------------------------------
INSERT INTO ims_items
  (item_code, description, size, uom, moq, max_level, on_order_qty, vendor_name, current_stock, category)
SELECT t.item_code, t.description, '', 'PCS', 0, 0, 0, '', t.closing, 'Accessories'
FROM   tmp_accessories_closing_20260926 t
WHERE  NOT EXISTS (SELECT 1 FROM ims_items i WHERE i.item_code = t.item_code);


-- ----------------------------------------------------------------------------
-- STEP 6 -- verification.
-- ----------------------------------------------------------------------------
-- Expect: accessories_items >= 226, sum_stock = 1012881.4 + stock of the
-- 8 blank-closing item(s) left untouched.
SELECT COUNT(*) AS accessories_items, ROUND(SUM(current_stock), 2) AS sum_stock
FROM   ims_items WHERE category = 'Accessories';

-- ADJ rows this run created (one per item that moved):
SELECT id, item_code, quantity, remarks
FROM   ims_transactions
WHERE  direction = 'ADJ' AND txn_date = '2026-09-26' AND created_by = 'Akhilesh (ERP)'
ORDER  BY id;

-- Should be empty -- any sheet code still differing from the DB:
SELECT t.item_code, t.closing, i.current_stock
FROM   tmp_accessories_closing_20260926 t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  ROUND(t.closing - i.current_stock, 2) <> 0;

-- Sheet codes filed under a different book (they were NOT touched by STEP 3/4):
SELECT i.item_code, i.category, i.current_stock, t.closing
FROM   tmp_accessories_closing_20260926 t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  i.category <> 'Accessories';

DROP TEMPORARY TABLE IF EXISTS tmp_accessories_closing_20260926;
