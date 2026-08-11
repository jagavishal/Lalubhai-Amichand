'use strict';
/**
 * Regenerates ims_items_accessories_import.sql from the "IMS (Accessory Store)"
 * Google Sheet. Read-only against the sheet — it writes a .sql file for you to
 * review and run, it never touches the database itself.
 *
 * Needs the same GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars
 * server.js uses (the service account must have at least view access to the
 * sheet). Run from the repo root:
 *
 *   node scripts/gen-ims-accessories-import.js [outfile] [--dialect=mysql|postgres]
 *
 * Dialect defaults to mysql, because that is what production actually runs
 * (DEPLOY.md: MariaDB on the VPS; the schema in server.js is full of
 * ENGINE=InnoDB and utf8mb4_unicode_ci). The app itself writes Postgres syntax
 * and runs it through pgToMysql() at query time, but this file is meant to be
 * pasted straight into a SQL client, so it has to be in the real dialect —
 * ON CONFLICT / EXCLUDED are Postgres-only and would just error on MariaDB.
 *
 * Column mapping, and why:
 *   "Item List" tab -> item_code, description, moq (col M), max_level (col N)
 *   "IMS" tab       -> current_stock, from the Closing Stock column (col L)
 *
 * The "Item List" tab labels its MOQ column "MOQ (KG)", but the numbers are
 * PIECES. Two independent cross-checks confirm it, and both are asserted below
 * so a future sheet restructure fails loudly here instead of silently importing
 * garbage:
 *   Max Level     = (Average Daily Consumption x Lead Time) + Safety Factor
 *   Available in% = Closing Stock / Max Level
 * Neither holds if any of those columns were in kilograms.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1hoNaa_Xt87IRIDJIGvN-AuyM0Tv5BZqUbuelbh9wtto';
const CATEGORY = 'Accessories';
const argv = process.argv.slice(2);
const DIALECT = (argv.find(a => a.startsWith('--dialect='))?.split('=')[1] || 'mysql').toLowerCase();
if (!['mysql', 'postgres'].includes(DIALECT)) throw new Error(`--dialect must be mysql or postgres, got "${DIALECT}"`);
const OUT = argv.find(a => !a.startsWith('--')) || path.join(__dirname, '../ims_items_accessories_import.sql');

// Column indexes, 0-based, in each tab's row array.
const IL = { code: 0, name: 1, group: 2, dept: 4, weight: 5, adc: 9, leadTime: 10, safety: 11, moq: 12, maxLevel: 13 };
const IM = { code: 0, name: 1, maxLevel: 4, availablePct: 10, closingStock: 11 };

function normalizeKey(k) {
  if (!k) return null;
  let s = k.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.replace(/\\n/g, '\n');
}

const sqlStr = (v) => `'${String(v == null ? '' : v).replace(/'/g, "''")}'`;
const n2 = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

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

  const catalogRows = await read(`'Item List'!A2:O2000`);
  const imsRows = await read(`'IMS'!A2:L2000`);

  /* ── sanity assertions on the sheet's own arithmetic ──────────────── */
  // Trailing empty cells make Google return short rows, so only rows with all
  // the inputs present can be checked. One clean match is enough to prove the
  // column indexes; zero checkable rows means the sheet changed shape.
  let checkedMax = 0, checkedPct = 0;
  for (const r of catalogRows) {
    const adc = parseFloat(r[IL.adc]), lt = parseFloat(r[IL.leadTime]);
    const sf = parseFloat(r[IL.safety]), max = parseFloat(r[IL.maxLevel]);
    if (![adc, lt, sf, max].every(Number.isFinite) || !max) continue;
    if (Math.abs(adc * lt + sf - max) > 0.51) {
      throw new Error(`Item List column mapping looks wrong at ${r[IL.code]}: ADC*LeadTime+Safety = ${(adc * lt + sf).toFixed(2)} but Max Level = ${max}`);
    }
    checkedMax++;
  }
  for (const r of imsRows) {
    const pct = parseFloat(r[IM.availablePct]), closing = parseFloat(r[IM.closingStock]), max = parseFloat(r[IM.maxLevel]);
    if (![pct, closing, max].every(Number.isFinite) || !max) continue;
    if (Math.abs(closing / max * 100 - pct) > 0.51) {
      throw new Error(`IMS column mapping looks wrong at ${r[IM.code]}: Closing/Max = ${(closing / max * 100).toFixed(2)}% but Available in % = ${pct}`);
    }
    checkedPct++;
  }
  if (!checkedMax || !checkedPct) throw new Error(`Could not verify column mapping (Max Level rows: ${checkedMax}, Available% rows: ${checkedPct}) — the sheet's layout has probably changed`);
  console.log(`column mapping verified: Max Level on ${checkedMax} rows, Available-percent on ${checkedPct} rows`);

  /* ── join the two tabs ─────────────────────────────────────────────── */
  const stats = { catalogRead: 0, imsRead: 0, dupes: [], noStock: [], imsOnly: [], negative: [], zeroStock: 0, noMoq: 0, noMax: 0 };

  const stockByCode = new Map();
  for (const r of imsRows) {
    const code = String(r[IM.code] ?? '').trim();
    if (!code) continue;
    stats.imsRead++;
    stockByCode.set(code, { closing: n2(r[IM.closingStock]), maxLevel: n2(r[IM.maxLevel]), name: String(r[IM.name] ?? '').trim() });
  }

  const items = new Map();
  for (const r of catalogRows) {
    const code = String(r[IL.code] ?? '').trim();
    const name = String(r[IL.name] ?? '').trim();
    if (!code || !name) continue;
    stats.catalogRead++;
    if (items.has(code)) { stats.dupes.push(code); continue; }
    const stock = stockByCode.get(code);
    if (!stock) stats.noStock.push(code);
    const moq = n2(r[IL.moq]);
    const maxLevel = n2(r[IL.maxLevel]);
    const current = stock ? stock.closing : 0;
    if (!moq) stats.noMoq++;
    if (!maxLevel) stats.noMax++;
    if (current < 0) stats.negative.push(`${code}:${current}`);
    if (current === 0) stats.zeroStock++;
    items.set(code, { code, name, moq, maxLevel, current, maxFromIms: stock ? stock.maxLevel : null });
  }
  for (const [code, s] of stockByCode) if (!items.has(code)) stats.imsOnly.push(`${code} (${s.name})`);

  const maxMismatch = [...items.values()]
    .filter(i => i.maxFromIms != null && Math.abs(i.maxFromIms - i.maxLevel) > 0.5)
    .map(i => `${i.code}: ItemList=${i.maxLevel} vs IMS=${i.maxFromIms}`);

  const list = [...items.values()];
  if (!list.length) throw new Error('No items read from the sheet — refusing to write an empty import');
  const totalStock = list.reduce((a, i) => a + i.current, 0);

  /* ── emit ──────────────────────────────────────────────────────────── */
  const header = `-- One-time bulk import of ims_items for the Accessories catalog (category='${CATEGORY}'),
-- sourced from the "IMS (Accessory Store)" Google Sheet
-- (${SHEET_ID}): catalog fields from the
-- "Item List" tab, current_stock from the "IMS" tab's Closing Stock column.
-- Same one-time-seed exception as ims_items_opening_stock.sql /
-- ims_items_alu_import.sql / ims_items_trading_import.sql: current_stock is
-- normally only moved by Inward/Outward routes; this direct insert seeds the
-- historical balance that already existed in the sheet.
--
-- GENERATED FILE — do not hand-edit. Regenerate with:
--   node scripts/gen-ims-accessories-import.js
--
-- Dialect: ${DIALECT === 'postgres' ? 'PostgreSQL' : 'MySQL / MariaDB'}. ${DIALECT === 'postgres'
    ? 'Re-run the generator with --dialect=mysql\n-- if the target is MariaDB (ON CONFLICT is Postgres-only syntax).'
    : 'Re-run the generator with --dialect=postgres\n-- if the target is PostgreSQL (ON DUPLICATE KEY UPDATE is MySQL-only syntax).'}
--
-- Unlike the earlier import files this one upserts rather than being a bare
-- INSERT, so re-running it after the sheet changes refreshes the catalog
-- instead of failing on the item_code primary key. Re-running DOES reset
-- current_stock back to the sheet's Closing Stock — if Inward/Outward entries
-- have been logged in the app since the last run, they will be overwritten.
--
-- Unit note: the "Item List" tab labels its MOQ column "MOQ (KG)", but the
-- numbers are PIECES, not kilograms. Two cross-checks confirm it (both asserted
-- by the generator): Max Level = (Average Daily Consumption × Lead Time) +
-- Safety Factor, and the IMS tab's "Available in %" = Closing Stock / Max
-- Level. Neither holds if anything here were in kilograms, so uom is 'PCS'.
--
-- Data-quality notes (verify against the physical store if anything looks off):
--   - ${list.length} unique item codes imported from ${stats.catalogRead} catalog rows${stats.dupes.length ? `, ${stats.dupes.length} duplicate code(s) skipped: ${stats.dupes.slice(0, 10).join(', ')}` : ', 0 duplicates'}.
--   - ${stats.imsRead} rows read from the IMS tab; total seeded stock ${Math.round(totalStock)} pcs.
--   - ${stats.zeroStock} item(s) seed to exactly 0 stock; ${stats.negative.length} seed NEGATIVE${stats.negative.length ? ` (${stats.negative.slice(0, 10).join(', ')})` : ''}.
--   - ${stats.noStock.length} catalog item(s) have no row in the IMS tab, seeded to 0${stats.noStock.length ? `: ${stats.noStock.slice(0, 15).join(', ')}${stats.noStock.length > 15 ? ', …' : ''}` : ''}.
--   - ${stats.imsOnly.length} IMS-tab item(s) are missing from the Item List tab and were NOT imported${stats.imsOnly.length ? `: ${stats.imsOnly.slice(0, 15).join(', ')}${stats.imsOnly.length > 15 ? ', …' : ''}` : ''}.
--   - ${stats.noMoq} item(s) have no MOQ, so the Report tab's Low Stock flag
--     (current_stock <= moq) can only fire for them at zero stock. Set an MOQ in
--     the app, or in the sheet before regenerating, for those to be useful.
--   - ${stats.noMax} item(s) have no Max Level. These are the rows whose Average
--     Daily Consumption is 0 — the sheet's own Max Level formula returns blank
--     rather than falling back to the Safety Factor — so they import as 0 rather
--     than having a value invented here. Max Level is display-only in the app.
--   - ${maxMismatch.length} Max Level disagreement(s) between the two tabs${maxMismatch.length ? ` (Item List wins): ${maxMismatch.slice(0, 10).join('; ')}` : ''}.
--   - The sheet's Group / DEPARTMENT / Weight-per-pc / ADC / Lead Time / Safety
--     Factor columns have no equivalent in ims_items and are NOT imported. size,
--     on_order_qty and vendor_name are left blank/0 for the same reason.

INSERT INTO ims_items (item_code, description, size, uom, moq, max_level, on_order_qty, vendor_name, current_stock, category) VALUES
`;

  const values = list.map(i =>
    `  (${sqlStr(i.code)}, ${sqlStr(i.name)}, '', 'PCS', ${i.moq}, ${i.maxLevel}, 0, '', ${i.current}, ${sqlStr(CATEGORY)})`
  ).join(',\n');

  const footer = DIALECT === 'postgres' ? `
ON CONFLICT (item_code) DO UPDATE SET
  description   = EXCLUDED.description,
  uom           = EXCLUDED.uom,
  moq           = EXCLUDED.moq,
  max_level     = EXCLUDED.max_level,
  current_stock = EXCLUDED.current_stock,
  category      = EXCLUDED.category,
  updated_at    = NOW();
` : `
ON DUPLICATE KEY UPDATE
  description   = VALUES(description),
  uom           = VALUES(uom),
  moq           = VALUES(moq),
  max_level     = VALUES(max_level),
  current_stock = VALUES(current_stock),
  category      = VALUES(category),
  updated_at    = NOW();
`;

  fs.writeFileSync(OUT, header + values + footer, 'utf8');
  console.log(`wrote ${OUT} — ${list.length} items, ${Math.round(totalStock)} pcs total stock`);
  console.log(JSON.stringify({
    catalogRead: stats.catalogRead, imsRead: stats.imsRead, duplicates: stats.dupes.length,
    catalogWithoutStockRow: stats.noStock.length, imsOnly: stats.imsOnly.length,
    negativeStock: stats.negative.length, zeroStock: stats.zeroStock,
    noMoq: stats.noMoq, noMaxLevel: stats.noMax, maxLevelMismatch: maxMismatch.length,
  }, null, 2));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
