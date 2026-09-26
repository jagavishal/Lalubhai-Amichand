'use strict';
/**
 * Generates a dated MySQL/MariaDB update file that syncs the IMS Stores book's
 * current_stock to the "Closing Stock" column of the "IMS (Stores)" Google
 * Sheet's IMS tab. Read-only against the sheet — it writes a .sql file for you
 * to review and run against production, it never touches the database itself.
 *
 * Needs the same GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars
 * server.js uses (the service account must have view access to the sheet).
 * Run from the repo root:
 *
 *   node scripts/gen-ims-stores-stock-update.js [--date=YYYY-MM-DD] [--by="Name"] [outfile]
 *
 * --date defaults to today (IST) and is used both in the output filename and
 * as txn_date on the ADJ rows. --by is the created_by on those rows.
 *
 * WHY ADJ ROWS AND NOT A BARE UPDATE
 *   The app's Physical Stock feature (POST /api/ims/physical-stock, see
 *   _imsPhysicalStockUpdate in server.js) never overwrites current_stock
 *   silently: it logs the signed variance as an 'ADJ' entry in
 *   ims_transactions, then moves current_stock by that variance. The Report
 *   tab's Day-wise Stock walks BACKWARDS from current_stock undoing each day's
 *   movements, so a bare UPDATE would shift every historical day by the
 *   variance, while an ADJ entry keeps yesterday and before unchanged. This
 *   file therefore does the same thing the UI would do if someone typed each
 *   Closing Stock into the Physical Stock form — just for all items at once,
 *   with the variance computed against the live DB at run time. The one
 *   difference: the UI logs a zero-variance count too ("system was right"),
 *   this file only logs items that actually moved, so the Physical Stock tab
 *   doesn't fill up with 80 no-op rows per sync.
 *
 * Column mapping (IMS tab): A = item code, B = item name, D = unit,
 * L = Closing Stock. The daily columns from M onward are one column per date;
 * the generator asserts that Closing Stock equals the LAST date column so a
 * stale sheet (Closing Stock formula pointing at an older day) fails loudly.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '19wbm97_bYYsVDCpgOzGHZlriYc81McuPSKpqumf96MI';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=1105757494#gid=1105757494`;
const CATEGORY = 'Stores';
const argv = process.argv.slice(2);
const arg = (name) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function todayIST() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
const RUN_DATE = arg('date') || todayIST();
if (!/^\d{4}-\d{2}-\d{2}$/.test(RUN_DATE)) throw new Error(`--date must be YYYY-MM-DD, got "${RUN_DATE}"`);
const CREATED_BY = arg('by') || 'Sheet sync';
const OUT = argv.find(a => !a.startsWith('--'))
  || path.join(__dirname, `../database/imports/ims_stores_stock_update_${RUN_DATE.replace(/-/g, '')}.sql`);

// Column indexes, 0-based, in the IMS tab's row array.
const IM = { code: 0, name: 1, dept: 2, uom: 3, closingStock: 11, firstDateCol: 12 };

function normalizeKey(k) {
  if (!k) return null;
  let s = k.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.replace(/\\n/g, '\n');
}
const sqlStr = (v) => `'${String(v == null ? '' : v).replace(/'/g, "''")}'`;
const n2 = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const serialToISO = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = normalizeKey(process.env.GOOGLE_PRIVATE_KEY);
  if (!email || !key) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY not set');

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const read = async (range) => (await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range, valueRenderOption: 'UNFORMATTED_VALUE',
  })).data.values || [];

  const rows = await read(`'IMS'!A1:CZ1500`);
  const header = rows[0] || [];
  if (String(header[IM.closingStock] ?? '').trim() !== 'Closing Stock') {
    throw new Error(`Expected "Closing Stock" in column L of the IMS tab, found "${header[IM.closingStock]}" — the sheet's layout has changed`);
  }

  /* ── which day is the sheet's Closing Stock actually for? ──────────── */
  // Header cells from column M onward are date serials, one per day. The
  // right-most one is the day the Closing Stock column currently reflects.
  const dateCols = header.map((h, i) => ({ h, i }))
    .filter(x => x.i >= IM.firstDateCol && typeof x.h === 'number' && x.h > 40000);
  if (!dateCols.length) throw new Error('No date columns found from column M onward — the sheet layout has changed');
  const lastDate = dateCols[dateCols.length - 1];
  const sheetDay = serialToISO(lastDate.h);

  /* ── read the rows ─────────────────────────────────────────────────── */
  const stats = { read: 0, dupes: [], blank: [], negative: [], zero: 0, mismatch: 0 };
  const items = new Map();
  for (const r of rows.slice(1)) {
    const code = String(r[IM.code] ?? '').trim();
    if (!code) continue;
    stats.read++;
    if (items.has(code)) { stats.dupes.push(code); continue; }
    const name = String(r[IM.name] ?? '').trim();
    const uom = String(r[IM.uom] ?? '').trim();
    const closing = n2(r[IM.closingStock]);
    if (closing == null) { stats.blank.push(`${code} (${name})`); continue; }
    const lastDay = n2(r[lastDate.i]);
    if (lastDay != null && Math.abs(lastDay - closing) > 0.005) stats.mismatch++;
    if (closing < 0) stats.negative.push(`${code}:${closing}`);
    if (closing === 0) stats.zero++;
    items.set(code, { code, name, uom, closing });
  }
  if (stats.mismatch) {
    throw new Error(`Closing Stock disagrees with the last date column (${sheetDay}) on ${stats.mismatch} row(s) — is the sheet's Closing Stock formula pointing at an older day?`);
  }
  const list = [...items.values()];
  if (!list.length) throw new Error('No items read from the sheet — refusing to write an empty update');
  const total = Math.round(list.reduce((a, i) => a + i.closing, 0) * 100) / 100;
  console.log(`sheet Closing Stock is for ${sheetDay}; ${list.length} items with a value, ${stats.blank.length} blank, total ${total}`);
  if (sheetDay !== RUN_DATE) console.warn(`WARNING: the sheet's last date column is ${sheetDay} but this file is dated ${RUN_DATE}`);

  /* ── emit ──────────────────────────────────────────────────────────── */
  const stamp = RUN_DATE.replace(/-/g, '');
  const tmp = `tmp_stores_closing_${stamp}`;
  const bak = `ims_items_stores_stock_bak_${stamp}`;
  const blankNote = stats.blank.length ? `:\n--       ${stats.blank.join('\n--       ')}` : '.';
  const negNote = stats.negative.length
    ? ` (${stats.negative.join(', ')}) -- the app's own\n--     Physical Stock form would refuse these; applied as the sheet says`
    : '';
  const dupeNote = stats.dupes.length ? `, ${stats.dupes.length} duplicate code(s) skipped: ${stats.dupes.join(', ')}` : ', 0 duplicates';
  const values = list.map(i => `  (${sqlStr(i.code)}, ${sqlStr(i.name)}, ${sqlStr(i.uom)}, ${i.closing.toFixed(2)})`).join(',\n');

  const out = `-- ============================================================================
-- IMS Stores -- current_stock sync from the "IMS (Stores)" Google Sheet's
-- Closing Stock column (IMS tab, col L), sheet day ${sheetDay}, run date ${RUN_DATE}
-- ${SHEET_URL}
--
-- Dialect: MySQL / MariaDB  (production DB is MariaDB -- ignore the Postgres
--          instructions in DEPLOY.md).
--
-- GENERATED FILE -- do not hand-edit. Regenerate with:
--   node scripts/gen-ims-stores-stock-update.js --date=${RUN_DATE} --by="${CREATED_BY}"
--
-- WHAT THIS FILE DOES
--   STEP 1 (recommended) : backup snapshot of the Stores book's stock, for undo.
--   STEP 2 (required)    : load the sheet's ${list.length} Closing Stock values into a
--                          temporary table.
--   STEP 3 (required)    : log one 'ADJ' ims_transactions row per item whose DB
--                          stock differs from the sheet -- exactly what the app's
--                          Physical Stock form does (see _imsPhysicalStockUpdate
--                          in server.js), so the Report tab's Day-wise Stock
--                          history stays correct for days before ${RUN_DATE}.
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
--   - ${stats.read} sheet rows read, ${list.length} carry a Closing Stock${dupeNote}.
--   - ${stats.blank.length} row(s) have a BLANK Closing Stock. Blank is not zero, so they
--     are NOT in the temp table and their DB stock is left untouched${blankNote}
--   - ${stats.zero} of the ${list.length} items close at exactly 0; ${stats.negative.length} NEGATIVE${negNote}.
--   - Sum of all Closing Stock values loaded = ${total}.
--   - The generator asserted Closing Stock == the sheet's last date column
--     (${sheetDay}) on every row, so this really is that day's closing figure.
--   - Safe to re-run: STEP 3 only logs items that still differ, so a second run
--     the same day logs nothing; STEP 4 re-asserts the same numbers; STEP 5 is
--     guarded by NOT EXISTS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 (recommended) -- undo snapshot. Run this BEFORE step 3.
-- ----------------------------------------------------------------------------
-- CREATE TABLE ${bak} AS
-- SELECT item_code, current_stock AS old_stock, NOW() AS backed_up_at
-- FROM   ims_items WHERE category = ${sqlStr(CATEGORY)};
--
-- To undo later (also cancel/delete the ADJ rows STEP 3 inserted -- see STEP 6):
-- UPDATE ims_items i
--   JOIN ${bak} b ON b.item_code = i.item_code
--   SET  i.current_stock = b.old_stock, i.updated_at = NOW()
-- WHERE i.category = ${sqlStr(CATEGORY)};


-- ----------------------------------------------------------------------------
-- STEP 2 (required) -- the sheet's Closing Stock, one row per item code.
-- ----------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS ${tmp};
CREATE TEMPORARY TABLE ${tmp} (
  item_code   VARCHAR(32)   NOT NULL PRIMARY KEY,
  description VARCHAR(255)  NOT NULL DEFAULT '',
  uom         VARCHAR(16)   NOT NULL DEFAULT '',
  closing     DECIMAL(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;  -- same collation ims_items is normalized to (server.js), so the JOIN cannot hit an "illegal mix of collations"

INSERT INTO ${tmp} (item_code, description, uom, closing) VALUES
${values};


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
  ${sqlStr(RUN_DATE)},
  'ADJ',
  i.item_code,
  i.description,
  i.size,
  ROUND(t.closing - i.current_stock, 2),
  i.uom,
  '',
  CONCAT('Physical count: ', t.closing + 0, ' (system was ', i.current_stock + 0,
         ', variance ', IF(t.closing > i.current_stock, '+', ''), ROUND(t.closing - i.current_stock, 2) + 0,
         '). Synced from IMS (Stores) sheet Closing Stock for ${sheetDay}.'),
  'Active',
  ${sqlStr(CREATED_BY)},
  ''
FROM   ${tmp} t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  i.category = ${sqlStr(CATEGORY)}
  AND  ROUND(t.closing - i.current_stock, 2) <> 0
ORDER  BY CAST(SUBSTRING(i.item_code, 5) AS UNSIGNED), i.item_code;


-- ----------------------------------------------------------------------------
-- STEP 4 (required) -- set current_stock to the sheet's Closing Stock.
-- ----------------------------------------------------------------------------
UPDATE ims_items i
  JOIN ${tmp} t ON t.item_code = i.item_code
  SET  i.current_stock = t.closing, i.updated_at = NOW()
WHERE i.category = ${sqlStr(CATEGORY)};


-- ----------------------------------------------------------------------------
-- STEP 5 (optional) -- sheet items that do not exist in ims_items yet.
-- Description / unit come from the sheet; moq, max_level, size, vendor are
-- left blank/0 to be filled in from the IMS page. Inserts nothing if every
-- sheet code already exists.
-- ----------------------------------------------------------------------------
INSERT INTO ims_items
  (item_code, description, size, uom, moq, max_level, on_order_qty, vendor_name, current_stock, category)
SELECT t.item_code, t.description, '', t.uom, 0, 0, 0, '', t.closing, ${sqlStr(CATEGORY)}
FROM   ${tmp} t
WHERE  NOT EXISTS (SELECT 1 FROM ims_items i WHERE i.item_code = t.item_code);


-- ----------------------------------------------------------------------------
-- STEP 6 -- verification.
-- ----------------------------------------------------------------------------
-- Expect: stores_items >= ${list.length}, sum_stock = ${total} + stock of the
-- ${stats.blank.length} blank-closing item(s) left untouched.
SELECT COUNT(*) AS stores_items, ROUND(SUM(current_stock), 2) AS sum_stock
FROM   ims_items WHERE category = ${sqlStr(CATEGORY)};

-- ADJ rows this run created (one per item that moved):
SELECT id, item_code, quantity, remarks
FROM   ims_transactions
WHERE  direction = 'ADJ' AND txn_date = ${sqlStr(RUN_DATE)} AND created_by = ${sqlStr(CREATED_BY)}
ORDER  BY id;

-- Should be empty -- any sheet code still differing from the DB:
SELECT t.item_code, t.closing, i.current_stock
FROM   ${tmp} t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  ROUND(t.closing - i.current_stock, 2) <> 0;

-- Sheet codes filed under a different book (they were NOT touched by STEP 3/4):
SELECT i.item_code, i.category, i.current_stock, t.closing
FROM   ${tmp} t
JOIN   ims_items i ON i.item_code = t.item_code
WHERE  i.category <> ${sqlStr(CATEGORY)};

DROP TEMPORARY TABLE IF EXISTS ${tmp};
`;

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${list.length} items, ${stats.blank.length} blank skipped)`);
})().catch(e => { console.error(e.message); process.exit(1); });
