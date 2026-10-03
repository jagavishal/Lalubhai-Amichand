'use strict';
/**
 * Generates database/imports/retail_expenses_import.sql from the legacy
 * "Expense Tracker" Google Sheet (the old Apps Script branch expense tracker).
 * Read-only against the sheet — writes a .sql file for you to review and run;
 * it never touches the database itself.
 *
 * Needs the same GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY(_B64) env
 * vars server.js uses, and the sheet shared (Viewer) with that account.
 *
 *   node scripts/gen-retail-expenses-import.js [outfile]
 *
 * MySQL/MariaDB dialect (what production runs). Idempotent: every row gets a
 * deterministic id RL0001.. (RL = legacy, so it can never collide with the
 * app's own RE#### ids) and is written with INSERT IGNORE, so re-running the
 * file is a no-op. Rows keep their original Timestamp as created_at.
 *
 * Normalisation, and why (the legacy sheet had free-typed values):
 *   branch   "South Bopal" -> "Bopal" (the ERP's branch list is Satellite, Bopal)
 *   category mapped onto the ERP's category list (Food -> Food & Dining, ...)
 *   person   trimmed + Title Case (YASH / yash / Yash -> Yash). "Yash Patel" is
 *            NOT merged into "Yash" — can't tell from the sheet that it's the same person.
 *   item     trimmed; obvious typos fixed (Repering -> Repairing, Maintance)
 *   invoice  the Drive link goes into note ("Invoice: <url>") — the files stay
 *            in Drive, they are not copied into uploads/retail-expenses.
 */
const R = require('path').join(__dirname, '..');
require('dotenv').config({ path: require('path').join(R, '.env.local'), quiet: true });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1b8yi56NYvsACd5vbUufUzPT9tXYuSqq56volKE83k-g';
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(R, 'database/imports/retail_expenses_import.sql');

// Sheet columns (0-based): Timestamp, Month-Year, Date, Branch, Person, Item,
// Category, Amount, PaymentType, InvoiceUrl, User, Note, ChequeDate, ChequeNo, ChequeAmount
const BRANCH = { 'south bopal': 'Bopal', bopal: 'Bopal', satellite: 'Satellite' };
const CATEGORY = {
  'food': 'Food & Dining', 'bills': 'Bills & Utilities', 'repair & maintance': 'Repair & Maintenance',
  'repairing': 'Repair & Maintenance', 'house keeping': 'House Keeping',
};
const ITEM = { repering: 'Repairing', 'activa maintance': 'Activa Maintenance' };
const PAYMENT = ['Cash', 'Credit Card', 'Debit Card', 'UPI', 'Bank Transfer', 'Cheque'];

const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const isoDate = v => (/^\d{4}-\d\d-\d\d$/.test(String(v || '').trim()) ? String(v).trim() : null);
const q = v => (v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'");

async function main() {
  let key = process.env.GOOGLE_PRIVATE_KEY_B64 ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64.trim(), 'base64').toString('utf8') : (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (key.trim().startsWith('{')) { const j = JSON.parse(key); key = j.private_key; email = email || j.client_email; }
  const auth = new google.auth.GoogleAuth({ credentials: { client_email: email, private_key: key }, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Expenses!A2:O' });
  const rows = (data.values || []).filter(r => r.some(c => String(c || '').trim()));

  const out = [], skipped = [], unmapped = { branch: new Set(), category: new Set(), payment: new Set() };
  rows.forEach((r, i) => {
    const line = i + 2;
    const date = isoDate(r[2]), amount = num(r[7]);
    if (!date || !amount || amount <= 0) { skipped.push(`row ${line}: bad date/amount (${r[2]} / ${r[7]})`); return; }
    const branch = BRANCH[String(r[3] || '').trim().toLowerCase()];
    if (!branch) { unmapped.branch.add(r[3]); return; }
    const catRaw = String(r[6] || '').trim();
    const category = CATEGORY[catRaw.toLowerCase()] || catRaw;
    const payment = PAYMENT.find(p => p.toLowerCase() === String(r[8] || '').trim().toLowerCase());
    if (!payment) { unmapped.payment.add(r[8]); return; }
    const itemRaw = String(r[5] || '').trim();
    const item = ITEM[itemRaw.toLowerCase()] || itemRaw;
    const noteParts = [String(r[11] || '').replace(/\s+/g, ' ').trim(), r[9] ? `Invoice: ${String(r[9]).trim()}` : ''].filter(Boolean);
    const ts = new Date(r[0]);
    const created = isNaN(ts) ? `${date} 00:00:00` : ts.toISOString().slice(0, 19).replace('T', ' ');
    out.push({
      id: 'RL' + String(out.length + 1).padStart(4, '0'), date, branch, person: titleCase(String(r[4] || '').trim()), item, category,
      amount, payment, chequeDate: isoDate(r[12]), chequeNo: String(r[13] || '').trim(), chequeAmount: num(r[14]),
      note: noteParts.join(' | '), by: String(r[10] || '').trim(), created,
    });
  });
  if (unmapped.branch.size || unmapped.payment.size) {
    throw new Error('Unmapped values — extend the maps: ' + JSON.stringify({ branch: [...unmapped.branch], payment: [...unmapped.payment] }));
  }

  const lines = [
    '-- Retail Expense Tracker: legacy sheet import (generated by scripts/gen-retail-expenses-import.js)',
    `-- ${out.length} rows. Idempotent: ids RL0001.., INSERT IGNORE. MySQL/MariaDB dialect.`,
    '-- The retail_expenses table is created lazily by the app; open Retail Dashboard once first, or run this CREATE:',
    `CREATE TABLE IF NOT EXISTS retail_expenses (
  id VARCHAR(16) PRIMARY KEY, entry_date DATE DEFAULT NULL, branch_name VARCHAR(100) DEFAULT '',
  person_name VARCHAR(150) DEFAULT '', item_name VARCHAR(150) DEFAULT '', category VARCHAR(100) DEFAULT '',
  amount DECIMAL(15,2) NOT NULL DEFAULT 0, payment_type VARCHAR(32) DEFAULT '',
  cheque_date DATE DEFAULT NULL, cheque_no VARCHAR(64) DEFAULT '', cheque_amount DECIMAL(15,2) DEFAULT NULL,
  invoice_file VARCHAR(255) DEFAULT '', invoice_name VARCHAR(255) DEFAULT '', note TEXT DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT '', created_by_id VARCHAR(16) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
    '',
    'INSERT IGNORE INTO retail_expenses (id,entry_date,branch_name,person_name,item_name,category,amount,payment_type,cheque_date,cheque_no,cheque_amount,note,created_by,created_at) VALUES',
    out.map(o => `(${[q(o.id), q(o.date), q(o.branch), q(o.person), q(o.item), q(o.category), o.amount.toFixed(2), q(o.payment),
      q(o.chequeDate), q(o.chequeNo), o.chequeAmount === null ? 'NULL' : o.chequeAmount.toFixed(2), q(o.note), q(o.by), q(o.created)].join(',')})`).join(',\n') + ';',
    '',
  ];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'));

  const sum = (k) => out.reduce((m, o) => { m[o[k]] = (m[o[k]] || 0) + 1; return m; }, {});
  console.log(`wrote ${OUT}`);
  console.log(`sheet rows ${rows.length} -> import ${out.length}, skipped ${skipped.length}`);
  skipped.forEach(s => console.log('  skipped', s));
  console.log('total amount', out.reduce((s, o) => s + o.amount, 0).toFixed(2));
  console.log('by branch', JSON.stringify(sum('branch')));
  console.log('by category', JSON.stringify(sum('category')));
  console.log('by person', JSON.stringify(sum('person')));
  console.log('date range', out.map(o => o.date).sort()[0], '->', out.map(o => o.date).sort().pop());
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
