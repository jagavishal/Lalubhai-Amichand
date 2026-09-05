-- ============================================================================
-- IMS Trading — closing stock update
--
-- Source : Google Sheet "IMS Trading" > tab "IMS" (gid=1105757494) of
--          https://docs.google.com/spreadsheets/d/1hCHEXDFXQtKqK6HrJSPA5foWjxmTW8WdUyroZd0QLno
--          Column A = Item Code, column L = "Closing Stock". Read 2026-08-12.
--          Verified: column L matches that day's own dated column (the sheet
--          carries a rolling 31-day grid, 2026-07-13 .. 2026-08-12) for all
--          552 counted items, so column L really is today's figure.
--
-- Sets ims_items.current_stock for the Trading book (category='Trading') to that
-- sheet's closing stock. Same one-time-seed exception as ims_items_opening_stock.sql
-- / ims_items_trading_import.sql: current_stock is normally only moved by the
-- Inward/Outward routes, this writes it directly.
--
-- Dialect: MySQL/MariaDB (production DB is MariaDB — NOT Postgres, ignore the
-- Postgres instructions in DEPLOY.md).
--
-- CHANGE SINCE THE 2026-08-11 RUN: exactly one item moved —
--   TRD6   15.00 -> 0.00
-- Everything else is identical, so this is safe to run even if the 08-11 file
-- was already applied; it simply re-asserts the same numbers.
--
-- WHAT'S IN HERE
--   - 552 items with a usable closing stock (of 582 rows in the sheet).
--   - 332 positive, 218 zero, 2 negative (TRD197=-0.35, TRD373=-0.10).
--     A few more items are negative only by floating-point noise (~-1e-14) and
--     round to 0.00 at DECIMAL(12,2), which is what the DB column stores.
--   - 30 sheet rows have a BLANK closing stock and are deliberately NOT
--     included — blank is not the same as zero, so their DB stock is left alone.
--     (In the sheet these rows do carry a negative number in the dated columns,
--     which is why the Closing Stock formula leaves them empty.)
--     Fill them in the sheet and re-run if they should be updated:
--       TRD43    Alum. Bar 316 x 6061T6 x 3658
--       TRD46    Alum. Bar 316 x 6082T6 x 3660
--       TRD53    Alum. Bar 4220 x 6082T6 x 3658
--       TRD116   Alum. Rod 10140 x 2014T6 x 2000
--       TRD122   Alum. Rod 10152 x 7075T6 x 2000
--       TRD137   Alum. Rod 10219 x 2014T6 x 1000
--       TRD138   Alum. Rod 10219 x 7075T6 x 2000
--       TRD164   Alum. Rod 10397 x 6061T6 x 1000
--       TRD200   Alum. Rod 152 x 2014T6 x 2000
--       TRD203   Alum. Rod 152 x 7075T6 x 2000
--       TRD206   Alum. Rod 1552 x 6061T6 x 3660
--       TRD230   Alum. Rod 356 x 6082T6 x 3658
--       TRD246   Alum. Rod 5107 X 6061T6 X 3658
--       TRD254   Alum. Rod 5184 x 6061T6 x 3658
--       TRD262   Alum. Rod 5668 x 2014T6 x 2000
--       TRD276   Alum. Rod 5907 x 2014T6 x 2000
--       TRD278   Alum. Rod 5907 x 6061T6 x 3658
--       TRD318   Alum. Rod 8195 x 7075T6 x 1500
--       TRD328   Alum. Rod 8908 X 6061T6 X 2000
--       TRD418   Alum Section 5030
--       TRD447   Alum. Bar 2972 x 6082T6 x 3658
--       TRD471   Aluminium Scrap
--       TRD486   Alum. Rod 8905 x 2014T6 x 2000
--       TRD512   Alum. Rod 1598 x 7075T6 x 2000
--       TRD534   Alum. Bar 474 x 6082T6 x 3660
--       TRD564   Alum. Bar 4886 x 6082T6 x 3658
--       TRD568   Alum. Rod 10319 x 6061T6 x 2000
--       TRD575   Alum. Bar 1181 x 6082T6 x 3658
--       TRD581   Alum. Rod 8905 x 6061T6 x 3658
--       TRD582   Alum. Bar 2972 x 6061T6 x 3658
--   - 29 sheet codes are not in ims_items_trading_import.sql, so they may not
--     exist in the catalog at all (TRD448, TRD451, TRD455, TRD456, TRD457, TRD459, TRD461, TRD463, TRD464, TRD465, TRD468, TRD469, …).
--     Step 3a lists whatever is genuinely missing in YOUR database; step 3d can
--     create them. Nothing is created automatically.
--   - The sheet's "Max Level" (column E) is NOT touched — closing stock only.
--
-- RUN THE STEPS IN ORDER, one at a time — do not run the whole file blind.
-- Step 4 overwrites live stock numbers; step 0 is what lets you undo it.
-- Note: CREATE/DROP TABLE auto-commits in MariaDB, so only step 4 is wrapped in
-- a transaction. That is deliberate — the backup must survive a rollback.
-- ============================================================================


-- ── STEP 0 — BACKUP (run this first, always) ────────────────────────────────
CREATE TABLE ims_items_trading_stock_bak_20260812 AS
SELECT item_code, current_stock AS old_stock, NOW() AS backed_up_at
FROM   ims_items
WHERE  category = 'Trading';

SELECT COUNT(*) AS backed_up_rows FROM ims_items_trading_stock_bak_20260812;


-- ── STEP 1 — STAGING TABLE ──────────────────────────────────────────────────
DROP TABLE IF EXISTS trd_closing_import;
CREATE TABLE trd_closing_import (
  item_code     VARCHAR(32)   NOT NULL PRIMARY KEY,
  description   VARCHAR(255)  NOT NULL DEFAULT '',
  size          VARCHAR(64)   NOT NULL DEFAULT '',
  uom           VARCHAR(16)   NOT NULL DEFAULT '',
  closing_stock DECIMAL(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── STEP 2 — SHEET DATA (552 items, straight from column A + L) ──────────────
INSERT INTO trd_closing_import (item_code, description, size, uom, closing_stock) VALUES
  ('TRD1', 'Alu. Bar 944 x 6061T6 x 3660', '200 x 20', 'KG', 234.00),
  ('TRD2', 'Alu. Bar F069 x 6082T6 x 3660', '254 x 12.7', 'KG', 129.30),
  ('TRD3', 'Alum. Bar 10051 x 2014T6 X 2000', '101.60 x 101.60', 'KG', 808.00),
  ('TRD4', 'Alum. Bar 10116 x 6061T6 x 3658', '120 x 120', 'KG', 0.00),
  ('TRD5', 'Alum. Bar 10158 x 6082T6 x 2500', '203.20 x 101.60', 'KG', 0.00),
  ('TRD6', 'Alum. Bar 10221 x 6061T6 x 2000', '152.40,', 'KG', 0.00),
  ('TRD7', 'Alum. Bar 10336 x 6061T6 x 2500', '130 x 130', 'KG', 684.00),
  ('TRD8', 'Alum. Bar 10336 x 6082T6 x 2500', '130 x 130', 'KG', 684.00),
  ('TRD9', 'Alum. Bar 10661 x 6061T6 x 3660', '127 x 76.20', 'KG', 285.00),
  ('TRD10', 'Alum. Bar 1067 x 6061T6 x 3660', '130 x 65', 'KG', 0.00),
  ('TRD11', 'Alum. Bar 1067 x 6082T6 x 3658', '130 x 65', 'KG', 248.00),
  ('TRD12', 'Alum. Bar 1088 x 6061T6 x 3658', '203 x 26', 'KG', 102.00),
  ('TRD13', 'Alum. Bar 1088 X 6082T6 x 3658', '203 x 26', 'KG', 882.00),
  ('TRD14', 'Alum. Bar 11174 x 6082T6 x 3660', '200 x 50', 'KG', 792.00),
  ('TRD15', 'Alum. Bar 1181 x 6082T6 x 3658', '101.60 x 25.40', 'KG', 0.50),
  ('TRD16', 'Alum. Bar 1185 x 6082T6 x 3658', '38.10 x 25.40', 'KG', 453.00),
  ('TRD17', 'Alum. Bar 1185 X 6082T6 X 3660', '38.10 x 25.40', 'KG', 10.25),
  ('TRD18', 'Alum. Bar 1249 x 6082T6 x 3658', '76.20 x 25.40', 'KG', 518.00),
  ('TRD19', 'Alum. Bar 1358 x 6061T6 x 3658', '203.20 x 12.70', 'KG', 228.00),
  ('TRD20', 'Alum. Bar 1358 x 6082T6 x 3658', '203.20 x 12.70', 'KG', 157.00),
  ('TRD21', 'Alum. Bar 145 x 6061T6 x 3658', '25.40 x 25.40', 'KG', 371.00),
  ('TRD22', 'Alum. Bar 145 x 6082T6 x 3658', '25.40 x 25.40', 'KG', 0.00),
  ('TRD23', 'Alum. Bar 145 x 6082T6 x 3660', '25.40 x 25.40', 'KG', 103.00),
  ('TRD24', 'Alum. Bar 1642 X 6082T6 X 3660', '125 x 75', 'KG', 0.00),
  ('TRD25', 'Alum. Bar 2059 x 6061T6 x 3658', '150 x 75', 'KG', 560.00),
  ('TRD26', 'Alum. Bar 2059 x 6082T6 x 3658', '150 x 75', 'KG', 0.00),
  ('TRD27', 'Alum. Bar 2095 x 6082T6 x 3658', '100 x 80', 'KG', 0.00),
  ('TRD28', 'Alum. Bar 2095 x 6082T6 x 3660', '100 x 80', 'KG', 237.00),
  ('TRD29', 'Alum. Bar 2107 x 6061T6 x 3660', '60 x 20', 'KG', 522.00),
  ('TRD30', 'Alum. Bar 2107 X 6082T6 X 3658', '60 x 20', 'KG', 289.30),
  ('TRD31', 'Alum. Bar 2108 x 6061T6 x 3658', '80 x 20', 'KG', 728.00),
  ('TRD32', 'Alum. Bar 2108 x 6082T6 x 3660', '80 x 20', 'KG', 0.00),
  ('TRD33', 'Alum. Bar 2199 x 6061T6 x 3658', '101.60 x 50.80', 'KG', 0.00),
  ('TRD34', 'Alum. Bar 2199 x 6082T6 x 3658', '101.60 x 50.80', 'KG', 0.00),
  ('TRD35', 'Alum. Bar 2224 x 6082T6 x 3658', '40 x 16', 'KG', 0.00),
  ('TRD36', 'Alum. Bar 2227 x 6061T6 x 3660', '65 x 35', 'KG', 0.00),
  ('TRD37', 'Alum. Bar 2616 X 6082T6 X 3658', '50.80 x 25.40', 'KG', 269.00),
  ('TRD38', 'Alum. Bar 2892 x 6061T6 x 3660', '100 x 40', 'KG', 396.00),
  ('TRD39', 'Alum. Bar 2892 x 6082T6 x 3658', '100 x 40', 'KG', 560.00),
  ('TRD40', 'Alum. Bar 3030 x 6061T6 x 3660', '80 x 40', 'KG', 474.50),
  ('TRD41', 'Alum. Bar 3030 x 6082T6 x 3658', '80 x 40', 'KG', 950.00),
  ('TRD42', 'Alum. Bar 3054 x 6082T6 x 3658', '60 x 40', 'KG', 881.00),
  ('TRD44', 'Alum. Bar 316 x 6061T6 x 3660', '76.20 x 76.20', 'KG', 58.00),
  ('TRD45', 'Alum. Bar 316 x 6082T6 x 3000', '76.20 x 76.20', 'KG', 0.00),
  ('TRD47', 'Alum. Bar 3326 x 6061T6 x 3660', '76.20 x 50.80', 'KG', 0.00),
  ('TRD48', 'Alum. Bar 3326 x 6082T6 x 3658', '76.20 x 50.80', 'KG', 456.00),
  ('TRD49', 'Alum. Bar 4167 x 6082T6 x 3660', '27 mm hex', 'KG', 6.00),
  ('TRD50', 'Alum. Bar 4174 x 6061T6 x 3660', '140 x 90', 'KG', 497.00),
  ('TRD51', 'Alum. Bar 4174 x 6082T6 x 3660', '140 x 90', 'KG', 375.00),
  ('TRD52', 'Alum. Bar 4220 x 6061T6 x 3658', '80 x 80', 'KG', 944.00),
  ('TRD54', 'Alum. Bar 4276 x 6061T6 x 3658', '105 x 65', 'KG', 0.00),
  ('TRD55', 'Alum. Bar 4276 x 6082T6 x 3658', '105 x 65', 'KG', 955.00),
  ('TRD56', 'Alum. Bar 4287 x 6082T6 x 3660', '190 x 50', 'KG', 0.00),
  ('TRD57', 'Alum. Bar 4788 x 6061T6 x 3658', '150 x 40', 'KG', 0.00),
  ('TRD58', 'Alum. Bar 4788 x 6082T6 x 3658', '150 x 40', 'KG', 2.00),
  ('TRD59', 'Alum. Bar 6291 x 6061T6 x 3660', '101.60 x 31.75', 'KG', 0.00),
  ('TRD60', 'Alum. Bar 6291 x 6082T6 x 3225', '101.60 x 31.75', 'KG', 141.00),
  ('TRD61', 'Alum. Bar 6291 x 6082T6 x 3658', '101.60 x 31.75', 'KG', 698.00),
  ('TRD62', 'Alum. Bar 6320 x 6061T6 x 3658', '127 x 31.75', 'KG', 316.00),
  ('TRD63', 'Alum. Bar 6320 x 6082T6 x 3658', '127 x 31.75', 'KG', 118.00),
  ('TRD64', 'Alum. Bar 7577 x 6061T6 x 3658', '110 sq', 'KG', 477.00),
  ('TRD65', 'Alum. Bar 7577 x 6082T6 x 3658', '110 sq', 'KG', 360.00),
  ('TRD66', 'Alum. Bar 7661 x 6101T6 x 3660', '165 x 12', 'KG', 77.00),
  ('TRD67', 'Alum. Bar 774 x 6082T6 x 3660', '31.75 hex', 'KG', 240.00),
  ('TRD68', 'Alum. Bar 7784 x 6061T6 x 3660', '101.60 sq', 'KG', 918.00),
  ('TRD69', 'Alum. Bar 7784 x 6082T6 x 3658', '101.60 sq', 'KG', 0.00),
  ('TRD70', 'Alum. Bar 8118 x 6061T6 x 3658', '150 x 50', 'KG', 73.00),
  ('TRD71', 'Alum. Bar 8118 x 6082T6 x 3660', '150 x 50', 'KG', 0.00),
  ('TRD72', 'Alum. Bar 8658 x 6061T6 x 3658', '127 x 25.40', 'KG', 256.00),
  ('TRD73', 'Alum. Bar 927 x 6061T6 x 3660', '70 x 40', 'KG', 637.00),
  ('TRD74', 'Alum. Bar 939 x 6061T6 x 3658', '65 x 50', 'KG', 0.00),
  ('TRD75', 'Alum. Bar 944 x 6082T6 x 3658', '200 x 20', 'KG', 0.00),
  ('TRD76', 'Alum. Bar F534 x 6082T6 x 3660', '229 x 19', 'KG', 0.00),
  ('TRD77', 'Alum. Bar F683 x 6082T6 x 3660', '254 x 25.4', 'KG', 0.00),
  ('TRD78', 'Alum. Bars 10435 x 6082T6 x 3658', '152.40 sq', 'KG', 924.00),
  ('TRD79', 'Alum Circle 1.00MM x 23"', '#N/A ()', 'KG', 0.00),
  ('TRD80', 'Alum Foil', '#N/A ()', 'KG', 26.35),
  ('TRD81', 'Alum. Hexagone Bar 5297 x 6082T6 x 3658', '24 mm hex', 'KG', 78.00),
  ('TRD82', 'Alum. Homgenised Billets 2014 3"', '76.2 mm', 'KG', 0.60),
  ('TRD83', 'Aluminium Bar', '#N/A ()', 'KG', 0.00),
  ('TRD84', 'Aluminium Bar & Rods 90 mm x 7075T6', '90 mm', 'KG', 37.00),
  ('TRD85', 'Aluminium Bars / Rods/ Profiles', '#N/A ()', 'KG', 0.00),
  ('TRD86', 'Aluminium Ext Bar', '#N/A ()', 'KG', 120.80),
  ('TRD87', 'Aluminium Extrusion/Bar/Rod', '#N/A ()', 'KG', 416.30),
  ('TRD88', 'Aluminium Extrusion Bars & Rods (R250 & R202 )', '#N/A ()', 'KG', 0.00),
  ('TRD89', 'Aluminium Extrusions', '#N/A ()', 'KG', 0.00),
  ('TRD90', 'Aluminium Extrusions R - 1126', '57.20 mm', 'KG', 0.30),
  ('TRD91', 'Aluminium Extrusions R5897 x 6082T6', '105 mm', 'KG', 85.00),
  ('TRD92', 'Aluminium Extusion Bar & Rod', '#N/A ()', 'KG', 722.75),
  ('TRD93', 'Aluminium Flat Bars (RE - 10665 x 6082T6)', '100 x 25', 'KG', 0.00),
  ('TRD94', 'Aluminium Flat Bars RE - 4276 X 6082T6', '105 x 65', 'KG', 0.00),
  ('TRD95', 'Aluminium Rod 655 (120mm)', '#N/A ()', 'KG', 0.00),
  ('TRD96', 'Aluminium Rod 8906 x 6101T6 x 3660', '115 mm', 'KG', 0.00),
  ('TRD97', 'Aluminium Rod (90mm)', '90 mm', 'KG', 36.30),
  ('TRD98', 'Aluminium Rod R262 x 6082T6', '22.20 mm', 'KG', 0.00),
  ('TRD99', 'Aluminium Rods', '#N/A ()', 'KG', 0.00),
  ('TRD100', 'Aluminium Round Rod 1213 x 6082T6', '32 mm', 'KG', 79.00),
  ('TRD101', 'Aluminium Round Rods', '#N/A ()', 'KG', 50.20),
  ('TRD102', 'Aluminium Round Rods (R-1077)', '76.20 mm', 'KG', 45.00),
  ('TRD103', 'Aluminium Round Rods (R - 5107)', '16 mm', 'KG', 0.00),
  ('TRD104', 'Aluminium Round Rods (R - 5127)', '19 mm', 'KG', 19.50),
  ('TRD105', 'Aluminium Round Rods (R-5161)', '25.4 mm', 'KG', 0.00),
  ('TRD106', 'Aluminium Round Rods (R - 598)', '40 mm', 'KG', 1.00),
  ('TRD107', 'Aluminium Sections', '#N/A ()', 'KG', 0.00),
  ('TRD108', 'Alum. Pipe 7122 x 6082T6 x 3660', '#N/A ()', 'KG', 0.00),
  ('TRD109', 'Alum. Pipe 808 x 6082T6 x 3660', '19.10 x 3.25 x 12.60', 'KG', 0.00),
  ('TRD110', 'Alum. Pipe & Tube 11398 x 6082T6 x 1000', '38 x 7 x 1 x 6', 'KG', 0.00),
  ('TRD111', 'Alum. Pipe& Tube 3039 x 6351T6 x 1150', '100 x 5 x 90', 'KG', 46.00),
  ('TRD112', 'Alum. Pipe & Tube 4308 x 6061T6 x 2000', '148 x 16 x 116', 'KG', 0.00),
  ('TRD113', 'Alum. Pipe & Tube 945 x 6082T6 x 3658', '90 x 17.50 x 55', 'KG', 38.00),
  ('TRD114', 'Alum. Pipe & Tubes 5483 x 6082T6 x 3660', '22 x 2.50 x 17.', 'KG', 62.10),
  ('TRD115', 'Alum Rivet', '#N/A ()', 'KG', 143.30),
  ('TRD117', 'Alum. Rod 10140 x 6082T6 x 2000', '160 MM', 'KG', 2199.00),
  ('TRD118', 'Alum. Rod 10140 x 7075T6 x 1000', '160 MM', 'KG', 0.00),
  ('TRD119', 'Alum. Rod 10152 x 2014T6 x 2000', '140 mm', 'KG', 1347.00),
  ('TRD120', 'Alum. Rod 10152 X 6061T6 X 2000', '140 mm', 'KG', 581.00),
  ('TRD121', 'Alum. Rod 10152 x 6082T6 x 2000', '140 mm', 'KG', 332.00),
  ('TRD123', 'Alum. Rod 10153 x 6061T6 x 2000', '150 mm', 'KG', 380.00),
  ('TRD124', 'Alum. Rod 10155 x 6061T6 x 1000', '305 mm', 'KG', 0.00),
  ('TRD125', 'Alum. Rod 10155 X 6082T6 X 1000', '305 mm', 'KG', 1005.00),
  ('TRD126', 'Alum. Rod 10181 x 6061T6 x 3658', '152.40 x 50.80', 'KG', 304.00),
  ('TRD127', 'Alum. Rod 10181 x 6082T6 x 3658', '152.40 x 50.80', 'KG', 153.00),
  ('TRD128', 'Alum. Rod 10193 x 6082T6 x 1000', '241.30 mm', 'KG', 0.00),
  ('TRD129', 'Alum. Rod 10193 X 6082T6 X 2000', '241.30 mm', 'KG', 0.00),
  ('TRD130', 'Alum. Rod 10194 x 2014T6 x 1000', '254 mm', 'KG', 0.00),
  ('TRD131', 'Alum. Rod 10194 x 6082T6 x 1000', '254 mm', 'KG', 0.00),
  ('TRD132', 'Alum. Rod 10214 x 2014T6 x 1500', '177.80 mm', 'KG', 105.00),
  ('TRD133', 'Alum. Rod 10217 X 6061T6 X 2000', '153 mm', 'KG', 1.00),
  ('TRD134', 'Alum. Rod 10217 x 6082T6 x 2000', '153 mm', 'KG', 0.00),
  ('TRD135', 'Alum. Rod 10218 X 6061T6 X 2000', '165.10 mm', 'KG', 1043.00),
  ('TRD136', 'Alum. Rod 10218 x 6082T6 x 2000', '165.10 mm', 'KG', 1152.00),
  ('TRD139', 'Alum. Rod 10220 x 2014T6 x 2000', '190 mm', 'KG', 0.00),
  ('TRD140', 'Alum. Rod 10220 x 6061T6 x 2000', '190 mm', 'KG', 305.00),
  ('TRD141', 'Alum. Rod 10220 X 6082T6 X 2000', '190 mm', 'KG', 89.75),
  ('TRD142', 'Alum. Rod 10220 x 7075T6 x 2000', '190 mm', 'KG', 0.00),
  ('TRD143', 'Alum. Rod 10221 x 2014T6 x 2000', '152.40 mm', 'KG', 103.00),
  ('TRD144', 'Alum. Rod 10221 x 6082T6 x 2000', '152.40 mm', 'KG', 495.00),
  ('TRD145', 'Alum. Rod 10229 x 2014T6 x 2000', '180 mm', 'KG', 718.80),
  ('TRD146', 'Alum. Rod 10229 X 6061T6 X 2000', '180 mm', 'KG', 0.00),
  ('TRD147', 'Alum. Rod 10229 x 6082T6 x 1830', '180 mm', 'KG', 127.00),
  ('TRD148', 'Alum. Rod 10229 x 6082T6 x 2000', '180 mm', 'KG', 0.00),
  ('TRD149', 'Alum. Rod 10229 x 7075T6 x 2000', '180 mm', 'KG', 0.00),
  ('TRD150', 'Alum. Rod 10230 x 2014T6 x 1000', '203.20 mm', 'KG', 0.00),
  ('TRD151', 'Alum. Rod 10230 x 2014T6 x 2000', '203.20 mm', 'KG', 0.00),
  ('TRD152', 'Alum. Rod 10230 x 6061T6 x 2000', '203.20 mm', 'KG', 531.00),
  ('TRD153', 'Alum. Rod 10230 x 6082T6 x 2000', '203.20 mm', 'KG', 1058.00),
  ('TRD154', 'Alum. Rod 10230 x 7075T6 x 2000', '203.20 mm', 'KG', 0.00),
  ('TRD155', 'Alum. Rod 10232 x 2014T6 x 2000', '211 mm', 'KG', 788.00),
  ('TRD156', 'Alum. Rod 10232 x 6082T6 x 1000', '211 mm', 'KG', 0.00),
  ('TRD157', 'Alum. Rod 10250 x 6061T6 x 2000', '170 mm', 'KG', 0.00),
  ('TRD158', 'Alum. Rod 10250 x 6082T6 X 2000', '170 mm', 'KG', 0.00),
  ('TRD159', 'Alum. Rod 102 x 2014T6511', '102 mm', 'KG', 4.20),
  ('TRD160', 'Alum. Rod 10318 x 2014T6 x 2000', '135 mm', 'KG', 566.00),
  ('TRD161', 'Alum. Rod 10318 x 6082T6 x 2000', '135 mm', 'KG', 77.00),
  ('TRD162', 'Alum. Rod 10318 x 7075T6 x 2000', '135 mm', 'KG', 0.00),
  ('TRD163', 'Alum. Rod 10319 x 6082T6 x 2000', '145 mm', 'KG', 900.00),
  ('TRD165', 'Alum. Rod 10397 x 6061T6 x 1500', '230 mm', 'KG', 0.00),
  ('TRD166', 'Alum. Rod 10397 X 6082T6 X 1000', '230 mm', 'KG', 339.00),
  ('TRD167', 'Alum. Rod 10397 x 6082T6 x 1500', '230 mm', 'KG', 1.00),
  ('TRD168', 'Alum. Rod 10398 x 6061T6 x 1000', '220 mm', 'KG', 0.00),
  ('TRD169', 'Alum. Rod 10398 x 6082T6 x 1000', '220 mm', 'KG', 0.00),
  ('TRD170', 'Alum. Rod 10506 x 6061T6 X 1000', '280 mm', 'KG', 0.00),
  ('TRD171', 'Alum. Rod 10506 x 6082T6 X 1000', '280 mm', 'KG', 671.00),
  ('TRD172', 'Alum. Rod 10748 x 2014T6 x 2000', '55 mm', 'KG', 0.00),
  ('TRD173', 'Alum. Rod 1076 x 2014T6 x 2000', '101.60 mm', 'KG', 211.90),
  ('TRD174', 'Alum. Rod 1076 x 6061F x 3658', '101.60 mm', 'KG', 0.00),
  ('TRD175', 'Alum. Rod 1076 x 6082T6 x 3658', '101.60 mm', 'KG', 80.00),
  ('TRD176', 'Alum. Rod 1076 x 7075T6 x 2000', '101.60 mm', 'KG', 91.00),
  ('TRD177', 'Alum. Rod 1077 X 6061T6 X 3658', '76.20 mm', 'KG', 763.00),
  ('TRD178', 'Alum. Rod 1077 x 6082T6 x 3658', '76.20 mm', 'KG', 540.00),
  ('TRD179', 'Alum. Rod 1077 x 7075T6 x 2000', '76.20 mm', 'KG', 0.00),
  ('TRD180', 'Alum. Rod 10816 x 6061T6 x 1000', '310 mm', 'KG', 206.00),
  ('TRD181', 'Alum. Rod 11164 x 6061T6 x 1000', '266.70 mm', 'KG', 616.00),
  ('TRD182', 'Alum. Rod 11164 x 6082T6 x 1000', '266.70 mm', 'KG', 0.00),
  ('TRD183', 'Alum. Rod 1126 x 2014T6 x 2000', '57.20 mm', 'KG', 163.85),
  ('TRD184', 'Alum. Rod 1126 x 6061T6 x 3660', '57.20 mm', 'KG', 0.00),
  ('TRD185', 'Alum. Rod 1126 x 7075T6 x 2000', '57.20 mm', 'KG', 232.50),
  ('TRD186', 'Alum. Rod 11469 x 6061T6 x 1000', '289 mm', 'KG', 178.00),
  ('TRD187', 'Alum. Rod 1154 x 6082T6 x 3658', '31.75 x 31.75', 'KG', 90.00),
  ('TRD188', 'Alum Rod 1213', '32 mm', 'KG', 0.15),
  ('TRD189', 'Alum. Rod 1213 x 2014T6 x 2000', '32 mm', 'KG', 0.00),
  ('TRD190', 'Alum. Rod 1213 x 2014T6 x 3660', '32 mm', 'KG', 0.00),
  ('TRD191', 'Alum. Rod 1213 X 6061T6 X 3658', '32 mm', 'KG', 909.40),
  ('TRD192', 'Alum. Rod 1213 X 6082T6 X 3658', '32 mm', 'KG', 342.20),
  ('TRD193', 'Alum. Rod 1213 x 7075T6 x 2000', '32 mm', 'KG', 0.05),
  ('TRD194', 'Alum. Rod 1213 x 7075T6 x 2500', '32 mm', 'KG', 11.50),
  ('TRD195', 'Alum. Rod 1280 x 6061T6 x 3660', '60 x 60', 'KG', 1.00),
  ('TRD196', 'Alum. Rod 1280 X 6082T6 X 3658', '60 x 60', 'KG', 315.50),
  ('TRD197', 'Alum. Rod 150 x 6061T6 x 3660', '19.10 mm', 'KG', -0.35),
  ('TRD198', 'Alum. Rod 150 x 6082T6 x 2000', '19.10 mm', 'KG', 2.20),
  ('TRD199', 'Alum. Rod 150 x 6082T6 x 3658', '19.10 mm', 'KG', 11.20),
  ('TRD201', 'Alum. Rod 152 x 6061T6 x 3660', '38.10 mm', 'KG', 237.00),
  ('TRD202', 'Alum. Rod 152 x 6082T6 x 3658', '38.10 mm', 'KG', 540.00),
  ('TRD204', 'Alum. Rod 1532 x 6061T6 x 3658', '82 mm', 'KG', 0.00),
  ('TRD205', 'Alum. Rod 1552 x 6061T6 x 3658', '65 x 65', 'KG', 578.00),
  ('TRD207', 'Alum. Rod 1552 x 6082T6 x 3658', '65 x 65', 'KG', 996.00),
  ('TRD208', 'Alum. Rod 1598 x 6061T6 x 3660', '85 mm', 'KG', 113.00),
  ('TRD209', 'Alum. Rod 1598 x 6082T6 x 3660', '85 mm', 'KG', 1008.00),
  ('TRD210', 'Alum. Rod 1598 x 7075T6 x 2500', '85 mm', 'KG', 0.00),
  ('TRD211', 'Alum. Rod 2070 x 2014T6 x 2000', '55 mm', 'KG', 790.00),
  ('TRD212', 'Alum. Rod 2095 x 6061T6 x 3658', '100 x 80', 'KG', 161.00),
  ('TRD213', 'Alum. Rod 250 x 2014T6 x 2000', '50.80 mm', 'KG', 51.50),
  ('TRD214', 'Alum.Rod 250 X 6061T6 X 3658', '50.80 mm', 'KG', 81.00),
  ('TRD215', 'Alum.Rod 250 X 6082T6 X 3658', '50.80 mm', 'KG', 527.00),
  ('TRD216', 'Alum. Rod 2901 X 6082T6 X 3658', '35 mm', 'KG', 521.00),
  ('TRD217', 'Alum. Rod 2901 x 7075T6 x 2000', '35 mm', 'KG', 0.00),
  ('TRD218', 'Alum. Rod 2901 x 7075T6 x 3000', '35 mm', 'KG', 0.00),
  ('TRD219', 'Alum. Rod 2933 x 2014T6 x 2000', '28 mm', 'KG', 0.60),
  ('TRD220', 'Alum. Rod 2933 x 6082T6 x 3000', '28 mm', 'KG', 86.00),
  ('TRD221', 'Alum. Rod 2933 x 6082T6 x 3000', '28 mm', 'KG', 140.00),
  ('TRD222', 'Alum. Rod 2933 x 7075T6 x 2000', '28 mm', 'KG', 0.00),
  ('TRD223', 'Alum. Rod 3037 x 6082T6 x 3658', '40 x 40', 'KG', 443.00),
  ('TRD224', 'Alum. Rod 30 x 2014T6511 x 2500', '30 mm', 'KG', 0.00),
  ('TRD225', 'Alum. Rod 3506 x 6061T6 x 3658', '65 mm', 'KG', 854.50),
  ('TRD226', 'Alum. Rod 3506 x 6082T6 x 3658', '65 mm', 'KG', 200.00),
  ('TRD227', 'Alum. Rod 3506 x 7075T6 x 2000', '65 mm', 'KG', 282.00),
  ('TRD228', 'Alum. Rod 356 x 2014T6 x 2000', '60.33 mm', 'KG', 0.00),
  ('TRD229', 'Alum. Rod 356 X 6061T6 X 3660', '60.33 mm', 'KG', 312.00),
  ('TRD231', 'Alum. Rod 356 x 7075T6 x 2000', '60.33 mm', 'KG', 120.00),
  ('TRD232', 'Alum. Rod 356 x 7075T6 x 2500', '60.33 mm', 'KG', 120.00),
  ('TRD233', 'Alum. Rod 3579 x 6061T6 x 3660', '45 x 45', 'KG', 1200.00),
  ('TRD234', 'Alum. Rod 3579 x 6082T6 x 3658', '45 x 45', 'KG', 560.00),
  ('TRD235', 'Alum. Rod 36 X 2014T6511 X 2500', '36 mm', 'KG', 0.30),
  ('TRD236', 'Alum. Rod 36 x 7075T6511 x 2500', '36 mm', 'KG', 2.65),
  ('TRD237', 'Alum. Rod 381 x 6061T6 x 2438', '381 mm', 'KG', 24.80),
  ('TRD238', 'Alum. Rod 412 x 6082T6 x 3658', '38.10 x 38.10', 'KG', 0.00),
  ('TRD239', 'Alum. Rod 45 x 7075T6511x 2500', '45 mm', 'KG', 40.00),
  ('TRD240', 'Alum. Rod 4640 x 2014T6 x 2000', '68.20 mm', 'KG', 249.00),
  ('TRD241', 'Alum. Rod 4913 x 2014T6 x 2000', '34 mm', 'KG', 0.00),
  ('TRD242', 'Alum. Rod 4913 x 7075T6 x 2000', '34 mm', 'KG', 0.00),
  ('TRD243', 'Alum. Rod 5077 x 6061T6 x 3660', '12.70 mm', 'KG', 169.00),
  ('TRD244', 'Alum. Rod 5077 x 6082T6 x 3658', '12.70 mm', 'KG', 95.00),
  ('TRD245', 'Alum. Rod 50.8 x 2014T6511 x 2500', '50.8 mm', 'KG', 6.05),
  ('TRD247', 'Alum. Rod 5107 X 6082T6 X 3658', '16 mm', 'KG', 367.00),
  ('TRD248', 'Alum. Rod 5161 x 2014T6 x 2500', '25.40 mm', 'KG', 0.00),
  ('TRD249', 'Alum. Rod 5161 x 6061T6 x 3658', '25.40 mm', 'KG', 561.70),
  ('TRD250', 'Alum. Rod 5161 x 6082T6 x 3658', '25.40 mm', 'KG', 1.00),
  ('TRD251', 'Alum. Rod 5161 x 7075T6 x 2000', '25.40 mm', 'KG', 6.00),
  ('TRD252', 'Alum. Rod 5177 x 6061T6 x 3660', '28.60 mm', 'KG', 270.30),
  ('TRD253', 'Alum. Rod 5177 x 6082T6 x 3658', '28.60 mm', 'KG', 321.00),
  ('TRD255', 'Alum. Rod 5184 x 6082T6 x 3658', '30 mm', 'KG', 175.00),
  ('TRD256', 'Alum. Rod 5184 x 7075T6 x 2000', '30 mm', 'KG', 0.00),
  ('TRD257', 'Alum. Rod 5184 x 7075T6 x 2500', '30 mm', 'KG', 24.00),
  ('TRD258', 'Alum. Rod 548 x 6061T6 x 3658', '111 mm', 'KG', 0.00),
  ('TRD259', 'Alum. Rod 548 x 6082T6 x 3658', '111 mm', 'KG', 7.00),
  ('TRD260', 'Alum Rod 548 X 6082T6 X 3660', '111 mm', 'KG', 2.00),
  ('TRD261', 'Alum. Rod 548 x 7075T6 x 2000', '111 mm', 'KG', 0.00),
  ('TRD263', 'Alum. Rod 5668 x 6061T6 x 3658', '80 mm', 'KG', 600.00),
  ('TRD264', 'Alum. Rod 5668 x 7075T6 x 2000', '80 mm', 'KG', 0.00),
  ('TRD265', 'Alum. Rod 570014 x 2014T6 x 40 x 3000', '40 mm', 'KG', 12.29),
  ('TRD266', 'Alum. Rod 57.15 X 7075T6511 x 2500', '57.15 mm', 'KG', 46.70),
  ('TRD267', 'Alum.Rod 5743 x 2014T6 x 2000', '48 mm', 'KG', 0.00),
  ('TRD268', 'Alum. Rod 5743 x 6061T6 x 3658', '48 mm', 'KG', 629.00),
  ('TRD269', 'Alum. Rod 5743 x 6082T6 x 3658', '48 mm', 'KG', 414.00),
  ('TRD270', 'Alum. Rod 5826 x 6061T6 x 3660', '95.25 mm', 'KG', 70.00),
  ('TRD271', 'Alum. Rod 5826 x 7075T6 x 2000', '95.25 mm', 'KG', 0.00),
  ('TRD272', 'Alum. Rod 5851 x 2014T6 x 1000', '35.75 mm', 'KG', 0.00),
  ('TRD273', 'Alum. Rod 5897 x 6061T6 x 3658', '105 mm', 'KG', 1.00),
  ('TRD274', 'Alum. Rod 5897 x 6082T6 x 3658', '105 mm', 'KG', 12.00),
  ('TRD275', 'Alum. Rod 5897 x 7075T6 x 2000', '105 mm', 'KG', 97.00),
  ('TRD277', 'Alum. Rod 5907 x 2014T6 x 2500', '42 mm', 'KG', 27.35),
  ('TRD279', 'Alum.Rod 5907 x 6082T6 x 3658', '42 mm', 'KG', 115.00),
  ('TRD280', 'Alum. Rod 5907 x 7075T6 x 2500', '42 mm', 'KG', 7.40),
  ('TRD281', 'Alum Rod 598', '40 mm', 'KG', 62.60),
  ('TRD282', 'Alum. Rod 598 x 2014T6 x 2000', '40 mm', 'KG', 0.00),
  ('TRD283', 'Alum.Rod 598 x 6061T6 x 3658', '40 mm', 'KG', 300.50),
  ('TRD284', 'Alum.Rod 598 x 6082T6 x 3658', '40 mm', 'KG', 0.00),
  ('TRD285', 'Alum. Rod 598 x 7075T6 x 1230', '40 mm', 'KG', 8.80),
  ('TRD286', 'Alum. Rod 598 x 7075T6 x 2000', '40 mm', 'KG', 0.05),
  ('TRD287', 'Alum. Rod 60 x 7075T6511 x 2500', '60 mm', 'KG', 75.55),
  ('TRD288', 'Alum. Rod 6289 x 2014T6 x 2000', '70 mm', 'KG', 0.00),
  ('TRD289', 'Alum.Rod 6289 x 6061T6 x 3658', '70 mm', 'KG', 820.00),
  ('TRD290', 'Alum.Rod 6289 x 6082T6 x 3658', '70 mm', 'KG', 193.20),
  ('TRD291', 'Alum. Rod 6289 x 7075T6 x 2000', '70 mm', 'KG', 0.00),
  ('TRD292', 'Alum. Rod 6538 x 2014T6 x 1000', '#N/A ()', 'KG', 46.25),
  ('TRD293', 'Alum. Rod 655 x 2014T6 x 2000', '120 mm', 'KG', 0.00),
  ('TRD294', 'Alum. Rod 655 x 6061T6 x 3658', '120 mm', 'KG', 111.00),
  ('TRD295', 'Alum. Rod 655 X 6061T6 X 3660', '120 mm', 'KG', 1.00),
  ('TRD296', 'Alum. Rod 655 x 6082T6 x 3658', '120 mm', 'KG', 556.00),
  ('TRD297', 'Alum. Rod 655 x 7075T6 x 2000', '120 mm', 'KG', 2.00),
  ('TRD298', 'Alum. Rod 6583 x 2014T6 x 2000', '52 mm', 'KG', 0.00),
  ('TRD299', 'Alum. Rod 70 x 7075T6511 x 2500', '70 mm', 'KG', 85.70),
  ('TRD300', 'Alum. Rod 739 x 2014T6 x 2000', '20 mm', 'KG', 20.00),
  ('TRD301', 'Alum. Rod 739 X 6082T6 X 3658', '20 mm', 'KG', 640.60),
  ('TRD302', 'Alum. Rod 739 x 7075T6 x 2000', '20 mm', 'KG', 0.00),
  ('TRD303', 'Alum. Rod 749 x 2014T6 x 2000', '90 mm', 'KG', 0.00),
  ('TRD304', 'Alum. Rod 749 x 6061T6 x 3658', '90 mm', 'KG', 1798.00),
  ('TRD305', 'Alum. Rod 749 x 6082T6 x 3658', '90 mm', 'KG', 945.02),
  ('TRD306', 'Alum. Rod 749 x 7075T6 x 2500', '90 mm', 'KG', 0.00),
  ('TRD307', 'Alum. Rod 74 x 2014T6511 x 2500', '74 mm', 'KG', 30.20),
  ('TRD308', 'Alum. Rod 750 x 2014T6 x 2000', '90 sq', 'KG', 182.00),
  ('TRD309', 'Alum. Rod 750 x 6061T6 x 3660', '90 sq', 'KG', 80.00),
  ('TRD310', 'Alum. Rod 750 x 6082T6 x 3658', '90 sq', 'KG', 1041.00),
  ('TRD311', 'Alum. Rod 752 x 2014T6 x 2000', '36 mm', 'KG', 260.50),
  ('TRD312', 'Alum. Rod 752 X 6061T6 X 3658', '36 mm', 'KG', 0.00),
  ('TRD313', 'Alum. Rod 752 X 6082T6X 3658', '36 mm', 'KG', 931.00),
  ('TRD314', 'Alum. Rod 752 x 7075T6 x 2000', '36 mm', 'KG', 0.00),
  ('TRD315', 'Alum. Rod 752 X 7075T6 X 2500', '36 mm', 'KG', 0.00),
  ('TRD316', 'Alum. Rod 766 X 6082T6 X 3658', '50.80 x 50.80', 'KG', 741.00),
  ('TRD317', 'Alum. Rod 8119 x 2014T6 x 1000', '28.52 mm', 'KG', 0.00),
  ('TRD319', 'Alum. Rod 839 x 2014T6 x 2000', '63.5 mm', 'KG', 0.00),
  ('TRD320', 'Alum. Rod 839 x 6082T6 x 3658', '63.5 mm', 'KG', 315.15),
  ('TRD321', 'Alum. Rod 8905 x 2014T6 x 2020', '110 mm', 'KG', 162.00),
  ('TRD322', 'Alum. Rod 8906 x 2014T6 x 1500', '115 mm', 'KG', 44.00),
  ('TRD323', 'Alum. Rod 8906 x 2014T6 x 2000', '115 mm', 'KG', 58.00),
  ('TRD324', 'Alum. Rod 8906 x 6061T6 x 3658', '115 mm', 'KG', 102.00),
  ('TRD325', 'Alum. Rod 8906 x 6082T6 x 3658', '115 mm', 'KG', 0.00),
  ('TRD326', 'Alum. Rod 8906 x 7075T6 x 2000', '115 mm', 'KG', 0.00),
  ('TRD327', 'Alum. Rod 8908 x 2014T6 x 2000', '130 mm', 'KG', 822.00),
  ('TRD329', 'Alum. Rod 8908 X 6082T6 X 2000', '130 mm', 'KG', 216.00),
  ('TRD330', 'Alum. Rod 8908 x 7075T6 x 2000', '130 mm', 'KG', 75.00),
  ('TRD331', 'Alum. Rod 8909 x 6082T6 x 2000', '133.35 mm', 'KG', 152.00),
  ('TRD332', 'Alum. Rod 904 x 2014T6 x 1000', '127 mm', 'KG', 71.00),
  ('TRD333', 'Alum. Rod 904 x 2014T6 x 2000', '127 mm', 'KG', 341.00),
  ('TRD334', 'Alum. Rod 904 X 6061T6 X 3660', '127 mm', 'KG', 250.00),
  ('TRD335', 'Alum. Rod 904 x 6082T6 x 3658', '127 mm', 'KG', 508.00),
  ('TRD336', 'Alum. Rod 904 x 7075T6 x 2000', '127 mm', 'KG', 497.00),
  ('TRD337', 'Alum. Rod 90 X 2014T6511', '90 mm', 'KG', 75.90),
  ('TRD338', 'Alum. Rod 916 x 2014T6 x 1500', '45 mm', 'KG', 0.00),
  ('TRD339', 'Alum. Rod 916 x 2014T6 x 2000', '45 mm', 'KG', 0.00),
  ('TRD340', 'Alum. Rod 916 x 6061T6 x 3658', '45 mm', 'KG', 567.10),
  ('TRD341', 'Alum. Rod 916 x 6082T6 x 3658', '45 mm', 'KG', 153.00),
  ('TRD342', 'Alum. Rod 941 x 2014T6 x 2000', '22.22 mm', 'KG', 0.00),
  ('TRD343', 'Alum Rod 941 X 6061T6 X 3660', '22.22 mm', 'KG', 68.70),
  ('TRD344', 'Alum Rod 941 X 6082T6 X 3658', '22.22 mm', 'KG', 512.70),
  ('TRD345', 'Alum. Rod R006 x 2014T6 x 2000', '25.4 mm', 'KG', 43.60),
  ('TRD346', 'Alum. Rod R008 x 2014T6 x 2000', '22.22 mm', 'KG', 0.00),
  ('TRD347', 'Alum. Rod R008 x 6061T6 x 3660', '22.22 mm', 'KG', 56.50),
  ('TRD348', 'Alum. Rod R016 X 2014T6 X 2000', '30 mm', 'KG', 0.10),
  ('TRD349', 'Alum. Rod R020 x 7075T6 x 2000', '50.8 mm', 'KG', 0.00),
  ('TRD350', 'Alum. Rod R021 x 7075T6 x 2000', '76.2 mm', 'KG', 0.00),
  ('TRD351', 'Alum. Rod R023 x 2014T6 x 1550', '31 mm', 'KG', 0.00),
  ('TRD352', 'Alum. Rod R024 x 7075T6 x 2000', '38.1 mm', 'KG', 3.50),
  ('TRD353', 'Alum. Rod R025 x 2014T6 x 1500', '63.5 mm', 'KG', 0.00),
  ('TRD354', 'Alum. Rod R025 x 2014T6 x 2000', '63.5 mm', 'KG', 0.00),
  ('TRD355', 'Alum. Rod R029 x 2014T6 x 2000', '20 mm', 'KG', 0.00),
  ('TRD356', 'Alum Rod R041 x 6082T6 x 3660', '32 mm', 'KG', 0.20),
  ('TRD357', 'Alum. Rod R041 x 7075T6 x 2000', '32 mm', 'KG', 0.00),
  ('TRD358', 'Alum. Rod R049 x 2014T6 x 2000', '42.7 mm', 'KG', 0.00),
  ('TRD359', 'Alum. Rod R050 x 2014T6 x 2000', '52 mm', 'KG', 0.00),
  ('TRD360', 'Alum. Rod R052 x 2014T6 x 2000', '110 mm', 'KG', 0.00),
  ('TRD361', 'Alum. Rod R056 x 2014T6 x 2000', '90 mm', 'KG', 46.40),
  ('TRD362', 'Alum. Rod R056 x 7075T6 x 2500', '90 mm', 'KG', 0.00),
  ('TRD363', 'Alum. Rod R059', '#N/A ()', 'KG', 0.00),
  ('TRD364', 'Alum. Rod R060 X 2014T6 X 1000', '152.40 mm', 'KG', 2.40),
  ('TRD365', 'Alum. Rod R060 x 2014T6 x 1500', '152.40 mm', 'KG', 0.00),
  ('TRD366', 'Alum. Rod R066 x 2014T6 x 2000', '45 mm', 'KG', 0.00),
  ('TRD367', 'Alum. Rod R068 x 2014T6 x 2000', '42 mm', 'KG', 86.80),
  ('TRD368', 'Alum. Rod R076 x 2014T6 x 2000', '57.15 mm', 'KG', 100.58),
  ('TRD369', 'Alum. Rod R076 x 7075T6 x 2000', '57.15 mm', 'KG', 0.80),
  ('TRD370', 'Alum. Rod R078 x 7075T6 x 2000', '65 mm', 'KG', 0.00),
  ('TRD371', 'Alum. Rod R082 X 2014T6 X 1500', '52 mm', 'KG', 0.00),
  ('TRD372', 'Alum. Rod R082 x 2014T6 x 2000', '52 mm', 'KG', 0.00),
  ('TRD373', 'Alum. Rod R089 x 2014T6 x 2000', '36 mm', 'KG', -0.10),
  ('TRD374', 'Alum. Rod R090 x 2014T6 x 2000', '92 mm', 'KG', 75.30),
  ('TRD375', 'Alum. Rod R099 x 2014T6 x 2000', '26.50 mm', 'KG', 0.00),
  ('TRD376', 'Alum. Rod R - 10434 x 6061T6', '76.20 mm', 'KG', 90.00),
  ('TRD377', 'Alum. Rod R109 X 2014T6 X 2000', '55 mm', 'KG', 0.00),
  ('TRD378', 'Alum. Rod R115 x 2014T6 x 2000', '70 mm', 'KG', 21.90),
  ('TRD379', 'Alum. Rod R115 x 7075T6 x 2500', '70 mm', 'KG', 0.30),
  ('TRD380', 'Alum. Rod R127 x 6082T6 x 2000', '165.50 mm', 'KG', 0.00),
  ('TRD381', 'Alum. Rod R128 x 6082T6 x 1150', '153 mm', 'KG', 172.20),
  ('TRD382', 'Alum. Rod R129 x 6082T6 x 1000', '187.50 mm', 'KG', 63.70),
  ('TRD383', 'Alum. Rod R132 x 2014T6 X 2000', '85 mm', 'KG', 0.20),
  ('TRD384', 'Alum. Rod R132 x 7075T6 x 2500', '85 mm', 'KG', 1.40),
  ('TRD385', 'Alum. Rod R159 x 6061T6 x 1600', '150 mm', 'KG', 112.50),
  ('TRD386', 'Alum. Rod R168 x 2014T6 x 2000', '20 mm', 'KG', 0.00),
  ('TRD387', 'Alum. Rod R169 x 2014T6 x 2000', '80 mm', 'KG', 57.15),
  ('TRD388', 'Alum. Rod R169 x 6082T6 x 2000', '80 mm', 'KG', 33.80),
  ('TRD389', 'Alum. Rod R170 x 2014T6 x 600', '280 mm', 'KG', 0.00),
  ('TRD390', 'Alum. Rod R184 x 2014T6 x 1000', '160 mm', 'KG', 0.00),
  ('TRD391', 'Alum. Rod R184 x 6082T6 x 2000', '160 mm', 'KG', 110.00),
  ('TRD392', 'Alum. Rod R195', '#N/A ()', 'KG', 0.00),
  ('TRD393', 'Alum. Rod R195 x 2014T6 x 750', '#N/A ()', 'KG', 0.00),
  ('TRD394', 'Alum. Rod R204 x 2014T6 x 2000', '48 mm', 'KG', 0.00),
  ('TRD395', 'Alum. Rod R210 X 2014T6 X 1000', '220 mm', 'KG', 0.00),
  ('TRD396', 'Alum. Rod R210 x 6082T6 x 1000', '220 mm', 'KG', 136.90),
  ('TRD397', 'Alum. Rod R240 X 2014T6 X 1250', '203 mm', 'KG', 0.80),
  ('TRD398', 'Alum. Rod R243 x 6082T6 x 1000', '216 mm', 'KG', 101.20),
  ('TRD399', 'Alum. Rod R249 x 7075T6 x 2500', '105 MM', 'KG', 0.10),
  ('TRD400', 'Alum Rod. R250 x 2014T6 x 785', '#N/A ()', 'KG', 0.00),
  ('TRD401', 'Alum Rod. R285 x 2014T6 X600', '#N/A ()', 'KG', 0.00),
  ('TRD402', 'Alum. Rod R285 x 6082T6 X 600', '#N/A ()', 'KG', 30.77),
  ('TRD403', 'Alum. Rod R287 x 2014T6 x 2000', '#N/A ()', 'KG', 192.00),
  ('TRD404', 'Alum. Rod R288 x 7075T6 x 2000', '#N/A ()', 'KG', 243.00),
  ('TRD405', 'Alum. Rod R289 x 2014T6 x 2000', '95 mm', 'KG', 0.00),
  ('TRD406', 'Alum. Rod R295 x 6082T6 x 2000', '#N/A ()', 'KG', 103.00),
  ('TRD407', 'Alum. Rod R307 x 6061T6 X 3660', '70 mm', 'KG', 37.20),
  ('TRD408', 'Alum. Rod S031 x 2014T6 x 2000', '80 x 80', 'KG', 0.55),
  ('TRD409', 'Alum. Rod S032 x 2014T6 x 1000', '#N/A ()', 'KG', 65.20),
  ('TRD410', 'Alum. Round Rods R - 548', '#N/A ()', 'KG', 95.00),
  ('TRD411', 'Alum Section 14038', '#N/A ()', 'KG', 28.70),
  ('TRD412', 'Alum Section 14155', '#N/A ()', 'KG', 7.50),
  ('TRD413', 'Alum Section 20508', '#N/A ()', 'KG', 334.80),
  ('TRD414', 'Alum Section 20842', '#N/A ()', 'KG', 9.00),
  ('TRD415', 'Alum Section 20842 (R)', '#N/A ()', 'KG', 22.50),
  ('TRD416', 'Alum Section 20874', '#N/A ()', 'KG', 57.00),
  ('TRD417', 'Alum Section 21091', '#N/A ()', 'KG', 5.20),
  ('TRD419', 'Alum Section 5107', '#N/A ()', 'KG', 8.40),
  ('TRD420', 'Alum Section 5161', '#N/A ()', 'KG', 9.90),
  ('TRD421', 'Alum Section 57-15', '#N/A ()', 'KG', 0.00),
  ('TRD422', 'Alum Section 766', '#N/A ()', 'KG', 46.00),
  ('TRD423', 'Alum Section R170', '#N/A ()', 'KG', 0.00),
  ('TRD424', 'Alum Section R210', '#N/A ()', 'KG', 0.00),
  ('TRD425', 'Alum Section R232', '#N/A ()', 'KG', 0.00),
  ('TRD426', 'Alum Section R243', '#N/A ()', 'KG', 0.00),
  ('TRD427', 'Alum Section R671', '#N/A ()', 'KG', 0.00),
  ('TRD428', 'Alum Section S048', '#N/A ()', 'KG', 8.50),
  ('TRD429', 'Alum Section Scrap 1598', '#N/A ()', 'KG', 0.00),
  ('TRD430', 'Alum Section Scrap R170', '#N/A ()', 'KG', 0.00),
  ('TRD431', 'Alum Sheet', '#N/A ()', 'KG', 165.50),
  ('TRD432', 'Alum Sheet 0.46 x 1220 x 1280', '#N/A ()', 'KG', 306.00),
  ('TRD433', 'Alum. Sheet 1.50 x 1220 x 2440', '#N/A ()', 'KG', 71.50),
  ('TRD434', 'Profile Other Than Hollow 1119 x 6351T6 x 3000', '#N/A ()', 'KG', 65.00),
  ('TRD435', 'S.S.C.R . Sheet Grade 304', '#N/A ()', 'KG', 0.00),
  ('TRD436', 'Alum. Rod 5668 x 6082T6 x 3658', '80 mm', 'kg', 150.00),
  ('TRD437', 'Alum. Bar 2082 x 6082T6 x 3660', '75 x 40', 'KG', 540.00),
  ('TRD438', 'Aluminium Plates Sheet', '90 x 30', '', 0.00),
  ('TRD439', 'Aluminium Rod 7990 x 6061T6', '12.7 mm', '', 0.00),
  ('TRD440', 'Aluminium Rod  5050  x 6061T6', '10 mm', '', 0.00),
  ('TRD441', 'Alum. Bar 927 x 6082T6 x 3658', '70 x 40', '', 83.00),
  ('TRD442', 'Alum. Rod 10151 x 6061T6 x 3658', '120 mm', '', 0.00),
  ('TRD443', 'Alum. Rod 8908 x 6061T6 x 2500', '130 mm', '', 88.00),
  ('TRD444', 'Alum. Rod 739 X 6061T6 X 3658', '20 mm', '', 0.00),
  ('TRD445', 'Alum. Rod 2901 X 6061T6 X 3658', '35 mm', '', 431.00),
  ('TRD446', 'Alum. Rod R252 x 2014T6 x 2000', '73 mm', '', 0.00),
  ('TRD448', 'Alum. Rod 1126 x 6082T6 x 3660', '57.15 mm', '', 0.00),
  ('TRD449', 'Alum. Rod 1532 x 2014T6 x 2000', '82 mm', '', 0.00),
  ('TRD450', 'Alum. Rod 1598 x 2014T6 x 2000', '85 mm', '', 20.00),
  ('TRD451', 'Alum. Bar 5492 x 6082T6 x 3660', '200 x 40', '', 0.00),
  ('TRD452', 'Alum. Rod 5826 x 2014T6 x 2000', '95.25 mm', '', 0.00),
  ('TRD453', 'Alum. Rod 3506 x 2014T6 x 2000', '65 mm', '', 0.00),
  ('TRD454', 'Alum. Rod 5177 x 2014T6 x 2000', '28.60 mm', '', 480.00),
  ('TRD455', 'Alum. Bar 10116 x 6082T6 x 2440', '120 mm Sq', '', 0.00),
  ('TRD456', 'Alum. Rod 1784 x 6082T6 x 3660', '220 x 32', '', 0.00),
  ('TRD457', 'Aluminium Round Rod - 11097', '153 mm', '', 0.00),
  ('TRD458', 'Alum. Rod 5897 x 2014T6 x 2000', '105 mm', '', 0.00),
  ('TRD459', 'Aluminium Hex Rod - H -156 x 6082', '19.10 mm hex', '', 0.00),
  ('TRD460', 'Alum. Rod 1126 x 6082T6 x 3658', '57.20 mm', '', 608.00),
  ('TRD461', 'Aluminium Round Rod - (R-4353 x 6082T6)', '72 mm', '', 0.00),
  ('TRD462', 'Alum. Rod 916 x 7075T6 x 2000', '45 mm', '', 0.00),
  ('TRD463', 'Aluminium Round Rod - (R-10393 x 6082T6)', '18 mm', '', 0.00),
  ('TRD464', 'Aluminium Flat Bar 11194', '152 x 31.75', '', 0.00),
  ('TRD465', 'Alum. Rod R006 x 6082T6 x 3658', '25.4 mm', '', 0.00),
  ('TRD466', 'Alum. Rod 1077 X 2014T6 X 2000', '76.2 mm.', '', 0.00),
  ('TRD467', 'Alum. Rod 622 x 2014T6 x 2000', '80 mm', '', 0.00),
  ('TRD468', 'Alum. Rod 5184 x 2014T6 x 2000', '30 mm', '', 178.00),
  ('TRD469', 'Alum. Rod 5907 x 2014T6 x 1500', '42 mm', '', 410.00),
  ('TRD470', 'Aluminium Round Rod R 6583 x 6082T6', '52 mm', '', 0.00),
  ('TRD472', 'Aluminium Flat Bars - (RE - 6598 )', '127 x 15.88 mm', '', 0.00),
  ('TRD473', 'Aluminium Round Rod  (R - 357 x 6082T6)', '30 mm', '', 0.00),
  ('TRD474', 'Alum. Rod 5826 x 6082T6 x 3658', '95.25 mm', '', 980.00),
  ('TRD475', 'Alum. Rod 11469 x 6082T6 x 1000', '289 mm', '', 0.00),
  ('TRD476', 'Alum. Rod 10816 x 6082T6 x 1000', '310 mm', '', 0.00),
  ('TRD477', 'Alum. Hex Rod (H 4165 x 6082T6)', '22 mm hex', '', 0.00),
  ('TRD478', 'Alum. Rod R2901 x 6082T6', '35 mm', '', 0.00),
  ('TRD479', 'Aluminium Flat Bar RE - 2892', '100 x 40', '', 0.00),
  ('TRD480', 'Alum. Bar 2616 X 6061T6 X 3658', '50.80 x 25.40', '', 611.00),
  ('TRD481', 'Alum. Bar 1067 x 6061T6 x 3658', '130 x 65', '', 83.00),
  ('TRD482', 'Alum. Rod 8905 x 6061T6 x 3660', '110 mm', '', 0.00),
  ('TRD483', 'Alum. Rod 8905 x 6082T6 x 3660', '110 mm', '', 0.00),
  ('TRD484', 'Alum. Bar 1788 x 6061T6 x 3658', '70 mm sq', '', 384.00),
  ('TRD485', 'Alum. Bar 1788 x 6082T6 x 3660', '70 mm sq', '', 389.00),
  ('TRD487', 'Alum. Rod 10319 x 2014T6 x 2000', '145 mm', '', 658.00),
  ('TRD488', 'Alum. Bar 2937 x 6082T6 x 3658', '50 x 20', '', 247.00),
  ('TRD489', 'Alum. Rod 8238 x 6061T6 x 3658', '95 mm', '', 0.00),
  ('TRD490', 'Alum. Rod 10250 x 2014T6 x 2000', '170 mm', '', 0.00),
  ('TRD491', 'Alum. Rod 5161 x 2014T6 x 2000', '25.40 mm', '', 0.00),
  ('TRD492', 'Alum. Rod 10398 x 2014T6 x 2000', '220 mm', '', 0.00),
  ('TRD493', 'Alum. Rod 1532 x 6061T6 x 3658', '82 mm', '', 0.00),
  ('TRD494', 'Alum. Rod 10194 x 2014T6 x 2000', '254 mm', '', 0.00),
  ('TRD495', 'Alum. Rod 8905 x 2014T6 x 1500', '110 mm', '', 80.00),
  ('TRD496', 'Alum. Bar 413 x 6082T6 x 3658', '50.80 x 31.75', '', 959.00),
  ('TRD497', 'Alum. Bar 413 x 6061T6 x 3660', '50.80 x 31.75', '', 78.00),
  ('TRD498', 'Alum. Rod 10397 x 2014T6 x 2000', '230 mm', '', 791.00),
  ('TRD499', 'Alum. Bar 2106 x 6082T6 x 3658', '40 x 20', '', 534.00),
  ('TRD500', 'Alum. Bar 3054 x 6061T6 x 3660', '60 x 40', '', 137.00),
  ('TRD501', 'Alum. Rod 10507 x 6061T6 X 1000', '320 mm', '', 656.00),
  ('TRD502', 'Alum.Rod 250 X 7075T6 X 2000', '50.80 mm', '', 0.00),
  ('TRD503', 'Alum. Rod 1598 x 7075T6 x 2500', '85 mm', '', 288.00),
  ('TRD504', 'Aluminium Round Rods (R- 561)', '10 mm', '', 0.00),
  ('TRD505', 'Alum. Rod 2901 x 2014T6 x 2000', '35 mm', '', 465.00),
  ('TRD506', 'Alum. Bar 3054 x 6082T6 x 3660', '60 x 40', '', 0.00),
  ('TRD507', 'Alum. Rod 1076 x 6061T6 x 3660', '101.60 mm', '', 0.00),
  ('TRD508', 'Alum. Rod 1532 x 6082T6 x 3660', '82 mm', '', 1352.00),
  ('TRD509', 'Alum. Bar 10661 x 6082T6 x 3658', '127 x 76.20', '', 0.00),
  ('TRD510', 'Aluminium Bar - (B - 10335 )', '70 x 70', '', 0.00),
  ('TRD511', 'Alum. Rod 8908 X 6061T6 X 3660', '130 mm', '', 131.00),
  ('TRD513', 'Alum. Bar 8894 x 6082T6 x 2000', '304 x 25', '', 382.00),
  ('TRD514', 'Alum. Rod R020 x 2014T6', '50.8 mm', '', 0.00),
  ('TRD515', 'Alum. Rod 10256 x 2014T6', '85 mm', '', 0.00),
  ('TRD516', 'Alum. Bars 10435 x 6061T6 x 3660', '152.40 sq', '', 918.00),
  ('TRD517', 'Alum. Rod 1154 x 6061T6 x 3660', '31.75 x 31.75', '', 148.00),
  ('TRD518', 'Alum. Rod 10507 x 6082T6 X 1000', '320 mm', '', 0.00),
  ('TRD519', 'Alum. Bar 4220 x 6082T6 x 3660', '80 x 80', '', 945.00),
  ('TRD520', 'Alum. Rod 5668 x 6061T6 x 3660', '80 mm', '', 591.00),
  ('TRD521', 'Alum. Rod 10140 x 6061T6 x 2000', '140 MM', '', 109.00),
  ('TRD522', 'Alum. Bar 11179 x 6082T6 x 3658', '254 x 25.40', '', 0.00),
  ('TRD523', 'Alum. Rod 10312 x 6061T6 x 3660', '140 sq', '', 970.00),
  ('TRD524', 'Alum. Rod 10312 x 6082T6 x 3660', '140 sq', '', 195.00),
  ('TRD525', 'Alum. Rod 8905 x 7075T6 x 2000', '110 mm', '', 0.00),
  ('TRD526', 'Aluminium Flat Bars - (RE - 11226 x 6082T6 )', '152.40 x 25.40', '', 0.00),
  ('TRD527', 'Alum. Rod 548 x 2014T6 x 2000', '111 mm', '', 594.00),
  ('TRD528', 'Alum. Bar 8896 x 6082T6 x 2000', '304 x 50', '', 0.00),
  ('TRD529', 'Alum. Rod 12140 x 2014T6 x 2000', '73.50 mm', '', 0.00),
  ('TRD530', 'Alum. Bar 474 x 6082T6 x 3658', '27 mm hex', '', 416.00),
  ('TRD531', 'Alum. Rod 1552 x 6082T6 x 3660', '65 x 65', '', 0.00),
  ('TRD532', 'Alum. Bar 2106 x 6061T6 x 3660', '40 x 20', '', 360.00),
  ('TRD533', 'Alum. Rod 1154 x 6061T6 x 3658', '31.75 x 31.75', '', 217.00),
  ('TRD535', 'Alum. Rod 10153 x 2014T6 x 2000', '150 mm', '', 0.00),
  ('TRD536', 'Alum. Rod 10218 X 2014T6 X 2000', '165.10 mm', '', 0.00),
  ('TRD537', 'Alum. Bar 2937 x 6061T6 x 3660', '50 x 20', '', 524.00),
  ('TRD538', 'Alum. Rod 152 x 6082T6 x 3660', '38.10 mm', '', 180.00),
  ('TRD539', 'Alum. Hex Bar  4165 x 6082T6 x 3658', '22 mm hex', '', 0.00),
  ('TRD540', 'Alum. Rod 1076 x 6061T6 x 3658', '101.60 mm', '', 0.00),
  ('TRD541', 'Alum. Rod 10332 x 2014T6 x 2000', '177.80 mm', '', 1050.00),
  ('TRD542', 'Alum. Bar 1067 x 6082T6 x 3660', '130 x 65', '', 84.00),
  ('TRD543', 'Alum. Rod 10140 x 2014T6 x 1100', '160 mm', '', 390.00),
  ('TRD544', 'Alum. Bar 4276 x 6082T6 x 3660', '105 x 65', '', 67.00),
  ('TRD545', 'Alum. Bar 1358 x 6082T6 x 3658', '203.20 x 12.70', '', 0.00),
  ('TRD546', 'Alum. Rod 10219 x 2014T6 x 2000', '175 mm', '', 683.00),
  ('TRD547', 'Alum. Rod 10140 x 7075T6 x 2000', '140 mm', '', 0.00),
  ('TRD548', 'Alum. Rod 10221 x 7075T6 x 2000', '152.40 mm', '', 103.00),
  ('TRD549', 'Alum. Bar 10298 x 6082T6 x 3658', '127 x 50.8', '', 0.00),
  ('TRD550', 'Alum. Rod 2933 x 6061T6 x 3660', '28mm', '', 1240.00),
  ('TRD551', 'Alum. Rod 2933 x 6082T6 x 3658', '28 mm', '', 290.00),
  ('TRD552', 'Alum. Rod 766 X 6061T6 X 3658', '50.80 x 50.80', '', 254.00),
  ('TRD553', 'Alum. Bar 8658 x 6082T6 x 3660', '127 x 25.40', '', 380.00),
  ('TRD554', 'Alum. Rod 6583 x 7075T6 x 2000', '52 mm', '', 0.00),
  ('TRD555', 'Alum. Rod 10748 x 6061T6 x 3658', '55 mm', '', 0.00),
  ('TRD556', 'Alum. Rod 1086 x 6082T6 x 3658', '167 mm x 55 mm', '', 0.00),
  ('TRD557', 'Alum. Rod 10748 x 6082T6 x 3658', '55 mm', '', 190.00),
  ('TRD558', 'Alum. Bar 5849 x 6082T6 x 3000', '80mm x 12mm', '', 0.00),
  ('TRD559', 'Alum. Rod 152 x 7075T6 x 2500', '38.10 mm', '', 546.00),
  ('TRD560', 'Alum. Rod 6583 x 6082T6 x 3660', '52 mm', '', 361.00),
  ('TRD561', 'Alum. Bar 316 x 6082T6 x 3658', '76.20 x 76.20', '', 456.00),
  ('TRD562', 'Alum. Bar 3054 x 6061T6 x 3658', '60 x 40', '', 0.00),
  ('TRD563', 'Alum. Rod 839 x 6061T6 x 3658', '63.5 mm', '', 849.00),
  ('TRD565', 'Alum. Rod 10258 x 6082T6 x 3658', '45mm', '', 0.00),
  ('TRD566', 'Alum. Rod 561 x 6082T6 x 3658', '10mm', '', 381.00),
  ('TRD567', 'Alum. Rod 10319 x 6082T6 x 2000', '145 mm', '', 2046.00),
  ('TRD569', 'Alum. Bar 4674 x 6082T6 x 3658', '68mm x 38mm', '', 304.00),
  ('TRD570', 'Alum. Rod 2070 x 6082T6T6 x 3660', '55 mm', '', 308.00),
  ('TRD571', 'Alum. Rod 147 x 6082T6T6 x 3660', '9.52mm', '', 0.00),
  ('TRD572', 'Alum. Rod 5030 x 6082T6T6 x 3658', '8.00mm', '', 180.00),
  ('TRD573', 'Alum. Rod 6583 x 6061T6 x 3660', '52 mm', '', 441.00),
  ('TRD574', 'Alum. Rod 561 x 6061T6 x 3658', '10mm', '', 90.00),
  ('TRD576', 'Alum. Rod 3037 x 6061T6 x 3658', '40 x 40', '', 502.00),
  ('TRD577', 'Alum. Bar 1181 x 6061T6 x 3658', '101.60 x 25.40', '', 507.00),
  ('TRD578', 'Alum. Bar 2082 x 6061T6 x 3660', '75 x 40', '', 534.00),
  ('TRD579', 'Alum. Bar 3326 x 6061T6 x 3658', '76.20 x 50.80', '', 494.00),
  ('TRD580', 'Alum. Rod 8908 X 6082T6 X 3660', '130 mm', '', 917.00);

SELECT COUNT(*) AS staged_rows FROM trd_closing_import;   -- expect 552


-- ── STEP 3 — PRE-CHECK (read the output before running step 4) ──────────────

-- 3a. Sheet codes NOT in the Trading catalog — these get SKIPPED by the update.
SELECT s.item_code, s.closing_stock, s.description
FROM   trd_closing_import s
LEFT   JOIN ims_items i
       ON i.item_code = s.item_code AND i.category = 'Trading'
WHERE  i.item_code IS NULL
ORDER  BY s.item_code;

-- 3b. Trading items in the DB that the sheet does NOT mention — untouched.
--     If the sheet is the complete closing count, these need a decision.
SELECT i.item_code, i.description, i.current_stock
FROM   ims_items i
LEFT   JOIN trd_closing_import s ON s.item_code = i.item_code
WHERE  i.category = 'Trading' AND s.item_code IS NULL
ORDER  BY i.item_code;

-- 3c. What will actually change, old -> new, biggest swing first.
--     If the 2026-08-11 file was already applied this should return just TRD6.
SELECT i.item_code, i.description, i.current_stock AS old_stock,
       s.closing_stock AS new_stock,
       (s.closing_stock - i.current_stock) AS diff
FROM   ims_items i
JOIN   trd_closing_import s ON s.item_code = i.item_code
WHERE  i.category = 'Trading'
  AND  i.current_stock <> s.closing_stock
ORDER  BY ABS(s.closing_stock - i.current_stock) DESC;

-- 3d. OPTIONAL — create the catalog items listed by 3a, using the sheet's own
--     name/size/unit, so their closing stock lands in step 4 as well.
--     Run ONLY if you checked 3a and those items really should exist.
-- INSERT INTO ims_items (item_code, description, size, uom, moq, max_level, on_order_qty, vendor_name, current_stock, category)
-- SELECT s.item_code, s.description, s.size, s.uom, 0, 0, 0, '', 0, 'Trading'
-- FROM   trd_closing_import s
-- LEFT   JOIN ims_items i ON i.item_code = s.item_code
-- WHERE  i.item_code IS NULL;


-- ── STEP 4 — THE UPDATE ─────────────────────────────────────────────────────
-- Only touches category='Trading' rows that appear in the sheet.
-- ims_items has no ON UPDATE clause on updated_at, so it is set explicitly.
START TRANSACTION;

UPDATE ims_items i
JOIN   trd_closing_import s ON s.item_code = i.item_code
SET    i.current_stock = s.closing_stock,
       i.updated_at    = NOW()
WHERE  i.category = 'Trading';

-- Check the affected-row count against step 3c before committing.
-- Happy? -> COMMIT;    Something off? -> ROLLBACK;
COMMIT;


-- ── STEP 5 — VERIFY ─────────────────────────────────────────────────────────
SELECT i.item_code, i.current_stock, s.closing_stock,
       IF(i.current_stock = s.closing_stock, 'YES', 'NO') AS matched
FROM   ims_items i
JOIN   trd_closing_import s ON s.item_code = i.item_code
WHERE  i.category = 'Trading'
ORDER  BY matched, i.item_code;

-- No Trading item should be negative any more except the two the sheet itself
-- reports as negative.
SELECT item_code, description, current_stock
FROM   ims_items
WHERE  category = 'Trading' AND current_stock < 0
ORDER  BY current_stock;


-- ── STEP 6 — CLEANUP (only after step 5 looks right) ────────────────────────
-- DROP TABLE trd_closing_import;
-- Keep ims_items_trading_stock_bak_20260812 for a while — it is the only undo.


-- ── ROLLBACK (if the numbers turn out wrong later) ──────────────────────────
-- UPDATE ims_items i
-- JOIN   ims_items_trading_stock_bak_20260812 b ON b.item_code = i.item_code
-- SET    i.current_stock = b.old_stock,
--        i.updated_at    = NOW()
-- WHERE  i.category = 'Trading';
