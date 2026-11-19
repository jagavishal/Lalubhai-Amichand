'use strict';
/* =====================================================================
   MIS Financials (route 'mis-finance', Admin Section)
   ---------------------------------------------------------------------
   From the 3 Nov 2026 meeting with Saloni Ma'am: the monthly P&L, Cash
   Flow and Ratio report for the four divisions was built by hand from
   Tally exports, and the Tally data sits on local machines in different
   places, so the ERP cannot fetch it. Instead each division's Tally
   Trial Balance is exported to Excel and uploaded here:

     Tally → Display → Trial Balance (F12: show opening + closing, expand
     the groups you want split) → Export (Alt+E) → Excel
       → upload here for a division + period
       → every ledger / group is mapped to a report head (Tally's own
         group names map by default; anything new is mapped once and the
         mapping is remembered)
       → P&L, Cash Flow (indirect method), Ratios per division and
         consolidated, downloadable as one Excel workbook.

   The Excel is read in the browser (SheetJS) and sent as rows; parsing
   happens here so the same rules apply to the preview and the save.

   Access: the Admin role, the owner, or an explicit "MIS Financials"
   tick in Users → Access (HOD does not get it by default — it is the
   company's books). Settings (divisions) and mapping: same people.
   ===================================================================== */

const MF_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mis_tb_uploads (
     id INT AUTO_INCREMENT PRIMARY KEY,
     division VARCHAR(64) NOT NULL,
     period_from DATE NOT NULL,
     period_to DATE NOT NULL,
     file_name VARCHAR(255) DEFAULT '',
     company VARCHAR(255) DEFAULT '',
     has_opening TINYINT NOT NULL DEFAULT 0,
     closing_stock DECIMAL(16,2) DEFAULT NULL,
     rows_json MEDIUMTEXT,
     uploaded_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_mis_tb (division, period_from, period_to)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  // Typed on the upload when the books' opening stock differs from Tally's
  // (Export keeps its own stock summary — Jayesh, 19 Nov 2026).
  `ALTER TABLE mis_tb_uploads ADD COLUMN IF NOT EXISTS opening_stock DECIMAL(16,2) DEFAULT NULL`,
];

const CFG = { divisions: 'misfin_divisions', map: 'misfin_map', heads: 'misfin_heads' };
// The four divisions the books are kept in (Saloni, Nov 2026) — renamable on the Divisions tab.
const DEFAULT_DIVISIONS = ['Other', 'Export', 'Trading', 'Retail'];

/* ── Report heads ──────────────────────────────────────────────────
   side: 'dr' heads are positive when debit (assets, expenses), 'cr' when
   credit (liabilities, income). pl: true = nominal (P&L) account. */
const HEADS = [
  // P&L
  { key: 'revenue',        label: 'Sales / Revenue',            side: 'cr', pl: true },
  { key: 'direct_income',  label: 'Direct Income',              side: 'cr', pl: true },
  { key: 'other_income',   label: 'Other Income',               side: 'cr', pl: true },
  { key: 'interest_income',label: 'Interest Income',            side: 'cr', pl: true },
  { key: 'opening_stock',  label: 'Opening Stock',              side: 'dr', pl: true },
  { key: 'purchases',      label: 'Purchases',                  side: 'dr', pl: true },
  { key: 'direct_exp',     label: 'Direct Expenses',            side: 'dr', pl: true },
  { key: 'direct_wages',   label: 'Wages / Labour (Direct)',    side: 'dr', pl: true },
  { key: 'employee_cost',  label: 'Salary & Staff Cost',        side: 'dr', pl: true },
  { key: 'indirect_exp',   label: 'Other Indirect Expenses',    side: 'dr', pl: true },
  { key: 'depreciation',   label: 'Depreciation',               side: 'dr', pl: true },
  { key: 'finance_cost',   label: 'Interest & Finance Cost',    side: 'dr', pl: true },
  { key: 'tax',            label: 'Income Tax',                 side: 'dr', pl: true },
  // Balance sheet — liabilities
  { key: 'capital',        label: 'Capital & Reserves',         side: 'cr' },
  { key: 'pl_account',     label: 'Profit & Loss A/c (b/f)',    side: 'cr' },
  { key: 'secured_loans',  label: 'Secured Loans',              side: 'cr' },
  { key: 'unsecured_loans',label: 'Unsecured Loans',            side: 'cr' },
  { key: 'bank_od',        label: 'Bank OD / CC',               side: 'cr' },
  { key: 'creditors',      label: 'Sundry Creditors',           side: 'cr' },
  { key: 'duties_taxes',   label: 'Duties & Taxes',             side: 'cr' },
  { key: 'provisions',     label: 'Provisions',                 side: 'cr' },
  { key: 'other_cl',       label: 'Other Current Liabilities',  side: 'cr' },
  // Balance sheet — assets
  { key: 'fixed_assets',   label: 'Fixed Assets',               side: 'dr' },
  { key: 'investments',    label: 'Investments',                side: 'dr' },
  { key: 'stock',          label: 'Stock-in-Hand (Closing)',    side: 'dr' },
  { key: 'debtors',        label: 'Sundry Debtors',             side: 'dr' },
  { key: 'cash',           label: 'Cash-in-Hand',               side: 'dr' },
  { key: 'bank',           label: 'Bank Balances',              side: 'dr' },
  { key: 'loans_adv',      label: 'Loans, Advances & Deposits', side: 'dr' },
  { key: 'other_ca',       label: 'Other Current Assets',       side: 'dr' },
  { key: 'misc_asset',     label: 'Misc. Expenses (Asset)',     side: 'dr' },
  // Other
  { key: 'branch',         label: 'Branch / Divisions',         side: 'dr' },
  { key: 'suspense',       label: 'Suspense / Difference',      side: 'dr' },
  { key: 'ignore',         label: 'Ignore (do not count)',      side: 'dr' },
];
const HEAD = Object.fromEntries(HEADS.map((h) => [h.key, h]));

/* Own heads, added on the Ledger Mapping tab: { key, label, base }. Each
   one works like the built-in head it is based on (P&L or balance sheet,
   Dr / Cr side, its line in the P&L / Cash Flow) and shows as its own line
   — ledgers mapped to it are added up under its name. */
function headBook(custom) {
  const book = { ...HEAD };
  for (const c of Array.isArray(custom) ? custom : []) {
    const b = HEAD[c?.base];
    if (!b || !c.key || HEAD[c.key]) continue;
    book[c.key] = { ...b, key: c.key, label: String(c.label || ''), base: b.key, custom: true };
  }
  return book;
}
const baseOf = (book, h) => (book[h]?.custom ? book[h].base : h);

/* A saved mapping is one head key, or a split [{ h, p }] with p = percent
   adding up to 100. Returns [{ h, f }] with f a fraction, or null. */
function partsOf(value, book) {
  if (typeof value === 'string') return book[value] ? [{ h: value, f: 1 }] : null;
  if (!Array.isArray(value)) return null;
  const parts = value.filter((x) => x && book[x.h] && Number(x.p) > 0).map((x) => ({ h: x.h, f: Number(x.p) / 100 }));
  const sum = parts.reduce((a, x) => a + x.f, 0);
  return parts.length && Math.abs(sum - 1) < 0.0001 ? parts : null;
}
// Amount split by the parts; the last part takes the remainder so the
// pieces always add back to the ledger to the paisa.
function splitAmount(v, parts) {
  if (parts.length === 1) return [v];
  let left = v;
  return parts.map((x, i) => {
    if (i === parts.length - 1) return round2(left);
    const y = round2(v * x.f); left -= y; return y;
  });
}

// Tally's own primary groups and their default sub-groups.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();
const TALLY = {
  'capital account': 'capital', 'reserves & surplus': 'capital', 'reserves and surplus': 'capital',
  'loans liability': 'unsecured_loans', 'secured loans': 'secured_loans', 'unsecured loans': 'unsecured_loans',
  'bank od a c': 'bank_od', 'bank occ a c': 'bank_od', 'bank od': 'bank_od', 'bank cc a c': 'bank_od',
  'current liabilities': 'other_cl', 'sundry creditors': 'creditors', 'duties & taxes': 'duties_taxes', 'duties and taxes': 'duties_taxes', 'provisions': 'provisions',
  'fixed assets': 'fixed_assets', 'investments': 'investments',
  'current assets': 'other_ca', 'stock in hand': 'stock', 'closing stock': 'stock', 'sundry debtors': 'debtors', 'cash in hand': 'cash', 'cash': 'cash',
  'bank accounts': 'bank', 'deposits asset': 'loans_adv', 'loans & advances asset': 'loans_adv', 'loans and advances asset': 'loans_adv',
  'misc expenses asset': 'misc_asset', 'branch divisions': 'branch', 'suspense a c': 'suspense', 'difference in opening balances': 'suspense',
  'sales accounts': 'revenue', 'sales account': 'revenue', 'purchase accounts': 'purchases', 'purchase account': 'purchases',
  'direct incomes': 'direct_income', 'income direct': 'direct_income', 'direct expenses': 'direct_exp', 'expenses direct': 'direct_exp',
  'indirect incomes': 'other_income', 'income indirect': 'other_income', 'indirect expenses': 'indirect_exp', 'expenses indirect': 'indirect_exp',
  'opening stock': 'opening_stock', 'profit & loss a c': 'pl_account', 'profit and loss a c': 'pl_account',
  // LAL's own Tally groups / ledgers (Export division, Nov 2026)
  'branch transfer purchase': 'purchases', 'unadjusted forex gain loss': 'other_income',
};
// Primary groups never sit under another row (stops a coincidental sum
// from nesting one primary group inside the one above it).
const PRIMARY = new Set(['branch transfer purchase', 'unadjusted forex gain loss', 'capital account', 'loans liability', 'current liabilities', 'fixed assets', 'investments', 'current assets',
  'branch divisions', 'misc expenses asset', 'suspense a c', 'sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses',
  'indirect incomes', 'indirect expenses', 'profit & loss a c', 'difference in opening balances']);

// Ledger-name rules inside expense / income groups.
function ruleHead(name, parentHead) {
  const n = String(name || '').toLowerCase();
  const expense = ['direct_exp', 'indirect_exp', 'purchases', 'direct_wages', 'employee_cost'].includes(parentHead);
  if (expense) {
    if (/depreciation/.test(n)) return 'depreciation';
    if (/income\s*tax|provision for tax|current tax|deferred tax/.test(n)) return 'tax';
    if (/interest|bank charge|financ(e|ial) (charge|exp|cost)|processing fee|loan charge|bank commission/.test(n)) return 'finance_cost';
    if (/salar|wage|labou?r|bonus|employee|provident|\bp\.?\s?f\b|e\.?s\.?i|gratuity|staff welfare|leave encash|stipend|incentive to staff/.test(n)) {
      return parentHead === 'direct_exp' || parentHead === 'purchases' ? 'direct_wages' : 'employee_cost';
    }
  }
  if (['other_income', 'direct_income'].includes(parentHead) && /interest/.test(n)) return 'interest_income';
  return null;
}

/* ── Amounts ───────────────────────────────────────────────────────── */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// 1,23,456.00 · (1,234.00) · "1,234.00 Dr" · "-55" → { v, side }
function amount(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? { v: cell, side: null } : null;
  let s = String(cell).trim();
  if (!s) return null;
  let side = null;
  const m = /\s*(dr|cr)\.?\s*$/i.exec(s);
  if (m) { side = m[1].toLowerCase(); s = s.slice(0, m.index); }
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,₹\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  let v = Number(s);
  if (neg) v = -v;
  return { v, side };
}

/* ── Period text in the header: "1-Apr-25 to 31-Mar-26" ──────────── */
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function tallyDate(s) {
  const m = /(\d{1,2})[-\s/.]([a-z]{3})[a-z]*[-\s/.,]*(\d{2,4})/i.exec(s);
  if (!m || !MON[m[2].toLowerCase()]) return null;
  let y = Number(m[3]); if (y < 100) y += 2000;
  return `${y}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}
function findPeriod(text) {
  const m = /(\d{1,2}[-\s/.][a-z]{3}[a-z]*[-\s/.,]*\d{2,4})\s*(?:to|-|–)\s*(\d{1,2}[-\s/.][a-z]{3}[a-z]*[-\s/.,]*\d{2,4})/i.exec(text);
  if (!m) return null;
  const from = tallyDate(m[1]), to = tallyDate(m[2]);
  return from && to ? { from, to } : null;
}

/* ── Parse a Trial Balance sheet (array of rows) ────────────────────── */

function parseTrialBalance(sheet) {
  if (!Array.isArray(sheet) || !sheet.length) throw new Error('The sheet is empty');
  const rows = sheet.slice(0, 20000).map((r) => (Array.isArray(r) ? r : []));
  const cellText = (v) => String(v ?? '').trim();
  const hr = rows.findIndex((r) => r.some((c) => /^particulars$/i.test(cellText(c))));
  if (hr < 0) throw new Error('Could not find the "Particulars" column — upload the Trial Balance exactly as Tally exports it');
  const pc = rows[hr].findIndex((c) => /^particulars$/i.test(cellText(c)));
  const company = rows.slice(0, hr + 1).map((r) => r.map(cellText).filter(Boolean).join(' ')).find((t) => t && !/trial balance|particulars|^udyam|^cin\b/i.test(t)) || '';

  // First data row: a name under Particulars and an amount beside it.
  let ds = hr + 1;
  while (ds < rows.length && !(cellText(rows[ds][pc]) && rows[ds].some((v, j) => j > pc && amount(v)))) ds++;
  if (ds >= rows.length) throw new Error('No ledger / group rows found under Particulars');
  const top = Math.max(0, hr - 2);   // Tally puts the company / period a row or two above Particulars
  const width = Math.max(...rows.slice(top, ds + 5).map((r) => r.length));
  // Header label per column = the header rows, carried right across merged cells.
  const label = (c) => {
    const parts = [];
    for (let i = top; i < ds; i++) {
      let j = c;
      while (j > pc && !cellText(rows[i][j])) j--;
      const t = j > pc ? cellText(rows[i][j]) : '';
      if (t && !parts.includes(t)) parts.push(t);
    }
    return parts.join(' ');
  };
  const kindOf = (l) => (/opening/i.test(l) ? 'open' : /closing/i.test(l) ? 'close' : /transaction|during|nett?\b/i.test(l) ? 'txn' : null);
  const sideOf = (t) => (/^(debit|dr\.?)$/i.test(t) ? 'dr' : /^(credit|cr\.?)$/i.test(t) ? 'cr' : null);

  // Columns that carry amounts, each with its kind and side ('net' = one
  // column with a Dr / Cr suffix, as Tally writes it).
  const cols = [];
  for (let c = pc + 1; c < width; c++) {
    if (!rows.slice(ds, ds + 400).some((r) => amount(r[c]))) continue;
    const l = label(c);
    let side = null;
    for (let i = top; i < ds; i++) side = side || sideOf(cellText(rows[i][c]));
    cols.push({ c, side: side || 'net', kind: kindOf(l), label: l });
  }
  if (!cols.length) throw new Error('Could not find the balance columns in the sheet');

  // The figures themselves first: three Dr / Cr columns side by side where
  // Opening + Nett = Closing on every row are one period's block, whatever
  // the header says (a hand-edited export can have its header cells merged
  // across the wrong columns, or pasted columns beside the real ones).
  const signed = (r, x) => {
    const a = amount(r[x.c]);
    if (!a) return 0;
    return a.side === 'cr' ? -Math.abs(a.v) : a.side === 'dr' ? Math.abs(a.v) : a.v;
  };
  const body = [];
  for (let i = ds; i < rows.length && body.length < 3000; i++) {
    const name = cellText(rows[i][pc]);
    if (/^grand\s*total$|^total$/i.test(name)) break;
    if (name) body.push(rows[i]);
  }
  const fits = (a, b, c) => {
    let n = 0, ok = 0;
    for (const r of body) {
      if (!amount(r[a.c]) && !amount(r[b.c]) && !amount(r[c.c])) continue;
      n++;
      if (Math.abs(signed(r, a) + signed(r, b) - signed(r, c)) < 0.6) ok++;
    }
    return n >= 3 && ok / n >= 0.95;
  };
  const triples = [];
  for (let i = 0; i + 2 < cols.length;) {
    const [a, b, c] = [cols[i], cols[i + 1], cols[i + 2]];
    if (a.side === 'net' && b.side === 'net' && c.side === 'net' && fits(a, b, c)) {
      a.kind = 'open'; b.kind = 'txn'; c.kind = 'close';
      triples.push({ cols: [a, b, c], keys: new Set() });
      i += 3;
    } else i++;
  }

  // Else by the header: split into period blocks (Tally can put a
  // comparative period alongside): a block ends when a (kind, side) it
  // already has turns up again.
  const blocks = triples.length ? triples : [];
  let cur = null;
  for (const x of triples.length ? [] : cols) {
    const key = `${x.kind}|${x.side}`;
    if (!cur || (x.kind && cur.keys.has(key))) { cur = { cols: [], keys: new Set() }; blocks.push(cur); }
    cur.cols.push(x); cur.keys.add(key);
  }
  for (const bl of blocks) {
    // Unlabelled columns: one balance → closing; with Dr / Cr pairs the same rule per pair.
    const unl = bl.cols.filter((x) => !x.kind);
    if (unl.length) {
      const groups = bl.cols.filter((x) => x.side !== 'cr').length;
      const order = groups <= 1 ? ['close'] : groups === 3 ? ['open', 'txn', 'close'] : ['open', 'close'];
      let k = -1;
      bl.cols.forEach((x) => { if (x.side !== 'cr') k++; if (!x.kind) x.kind = order[Math.min(k, order.length - 1)]; });
    }
    bl.period = findPeriod(bl.cols.map((x) => x.label).join(' '));
  }
  const usable = blocks.filter((bl) => bl.cols.some((x) => x.kind === 'close'));
  if (!usable.length) throw new Error('Could not find the closing balance columns in the sheet');
  if (!usable[0].period) usable[0].period = findPeriod(rows.slice(0, ds).map((r) => r.map(cellText).join(' ')).join(' '));
  // A second block with no date of its own (the period cell merged across
  // both blocks) is Tally's comparative: the same dates a year earlier.
  const p0 = usable[0].period;
  if (usable[1] && p0 && (!usable[1].period || (usable[1].period.from === p0.from && usable[1].period.to === p0.to))) {
    const back = (iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
      return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
    };
    usable[1].period = { from: back(p0.from), to: back(p0.to), assumed: true };
  }

  const net = (r, list) => {
    let v = 0, any = false;
    for (const x of list) {
      const a = amount(r[x.c]);
      if (!a) continue;
      any = true;
      if (x.side === 'dr') v += a.v;
      else if (x.side === 'cr') v -= a.v;
      else v += a.side === 'cr' ? -Math.abs(a.v) : a.side === 'dr' ? Math.abs(a.v) : a.v;
    }
    return any ? round2(v) : null;
  };

  const periods = usable.slice(0, 2).map((bl) => {
    const closeCols = bl.cols.filter((x) => x.kind === 'close');
    const openCols = bl.cols.filter((x) => x.kind === 'open');
    const out = [];
    let grand = null;
    for (let i = ds; i < rows.length; i++) {
      const r = rows[i];
      const raw = String(r[pc] ?? '');
      const name = raw.trim();
      if (!name) continue;
      const close = net(r, closeCols);
      const open = openCols.length ? net(r, openCols) : null;
      if (/^grand\s*total$|^total$/i.test(name)) { grand = { close, open }; break; }
      if (close == null && open == null) continue;   // a heading line, or a row empty in this period
      out.push({ name: name.slice(0, 200), indent: raw.length - raw.trimStart().length, close: close ?? 0, open: open ?? 0 });
    }
    return { period: bl.period, hasOpening: openCols.length > 0, rows: out.length ? buildTree(out) : [], grand };
  }).filter((p) => p.rows.length);
  if (!periods.length) throw new Error('No ledger / group rows found under Particulars');
  return { company: company.slice(0, 255), ...periods[0], comparative: periods[1] || null };
}

/* Which worksheet of a workbook is the Trial Balance: the one that says
   so near the top and has a Particulars column; else the first with
   Particulars. `sheets` = [{ name, rows }]. */
function pickTrialBalance(sheets) {
  const has = (rows, re) => rows.slice(0, 15).some((r) => (r || []).some((c) => re.test(String(c ?? '').trim())));
  return sheets.find((s) => has(s.rows, /^particulars$/i) && (has(s.rows, /^trial balance$/i) || /trial|tb\b/i.test(s.name)))
    || sheets.find((s) => has(s.rows, /^particulars$/i)) || null;
}

/* Hierarchy: Tally puts a group's total on its own row and its members
   right below it. Indentation (leading spaces) is used when the export
   has it; otherwise a row is a parent when the rows straight after it add
   up to it — exactly, for both closing and opening. */
function buildTree(rows) {
  const n = rows.length;
  rows.forEach((r) => { r.parent = -1; r.leaf = true; });
  const indents = new Set(rows.map((r) => r.indent));
  if (indents.size > 1) {
    const stack = [];
    rows.forEach((r, i) => {
      while (stack.length && rows[stack[stack.length - 1]].indent >= r.indent) stack.pop();
      if (stack.length) { r.parent = stack[stack.length - 1]; rows[r.parent].leaf = false; }
      stack.push(i);
    });
    return rows;
  }
  const eq = (a, b) => Math.abs(a - b) < 0.6;
  const nonZero = (r) => Math.abs(r.close) > 0.005 || Math.abs(r.open) > 0.005;
  // next[i] = index after the item that starts at row i (memoised, so the
  // whole pass is O(n²) at worst).
  const next = new Array(n).fill(-1);
  function item(i) {
    if (next[i] >= 0) return next[i];
    const r = rows[i];
    next[i] = i + 1;
    if (!nonZero(r)) return next[i];
    let j = i + 1, sc = 0, so = 0;
    const kids = [];
    while (j < n && !PRIMARY.has(norm(rows[j].name)) && kids.length < 3000) {
      const k = item(j);
      kids.push(j);
      sc += rows[j].close; so += rows[j].open;
      j = k;
      if (eq(sc, r.close) && eq(so, r.open) && kids.some((x) => nonZero(rows[x]))) {
        kids.forEach((x) => { rows[x].parent = i; });
        r.leaf = false;
        next[i] = j;
        return j;
      }
    }
    // Tally adds its own book value of closing stock into the Current Assets
    // total, so that group never equals its members. Its members are the run
    // of rows up to the next primary group — taken as they are (the group's
    // own total is then not counted; the closing stock is typed on the upload).
    if (norm(r.name) === 'current assets' && kids.length && kids.some((x) => nonZero(rows[x]))) {
      kids.forEach((x) => { rows[x].parent = i; });
      r.leaf = false;
      next[i] = j;
      return j;
    }
    return next[i];
  }
  let i = 0;
  while (i < n) i = item(i);
  return rows;
}

/* ── Head for every row, leaves summed per head ─────────────────────── */

// head[i] = the row's (first) head, parts[i] = [{ h, f }] — several when
// the ledger (or the group it sits in) is split over heads.
function assignHeads(rows, map, custom) {
  const book = headBook(custom);
  const head = new Array(rows.length).fill(null);
  const parts = new Array(rows.length).fill(null);
  const src = new Array(rows.length).fill('');
  const one = (i, h, how) => { head[i] = h; parts[i] = [{ h, f: 1 }]; src[i] = how; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const pHead = r.parent >= 0 ? head[r.parent] : null;
    const key = norm(r.name);
    const saved = partsOf(map[key], book);
    if (saved) { head[i] = saved[0].h; parts[i] = saved; src[i] = 'saved'; continue; }
    const rule = ruleHead(r.name, pHead && baseOf(book, pHead));
    if (rule) { one(i, rule, 'rule'); continue; }
    if (TALLY[key]) { one(i, TALLY[key], 'tally'); continue; }
    if (pHead) { head[i] = pHead; parts[i] = parts[r.parent]; src[i] = 'group'; continue; }
  }
  return { head, parts, src, book };
}

function headTotals(rows, map, custom) {
  const { head, parts, src, book } = assignHeads(rows, map, custom);
  const close = {}, open = {}, detail = {};
  const unmapped = [];
  let sumClose = 0, sumOpen = 0;
  // The Profitability Statement lists ledgers under their Tally group
  // (Sales Accounts, Direct Incomes …), as the books have them — not split
  // into report heads. `groups[g]` = { rowClose, rowOpen, ledgers }.
  const groups = {};
  const topOf = (i) => { let j = i; let n = 0; while (rows[j].parent >= 0 && n++ < 50) j = rows[j].parent; return j; };
  rows.forEach((r, i) => {
    if (r.parent >= 0) return;
    const g = PROFIT_GROUP[norm(r.name)];
    if (!g) return;
    const x = (groups[g] = groups[g] || { rowClose: 0, rowOpen: 0, ledgers: {} });
    x.rowClose = round2(x.rowClose + r.close); x.rowOpen = round2(x.rowOpen + r.open);
  });
  rows.forEach((r, i) => {
    if (!r.leaf) return;
    const g = PROFIT_GROUP[norm(rows[topOf(i)].name)];
    if (g) {
      const x = groups[g].ledgers;
      const ps = parts[i] || [{ h: null, f: 1 }];
      const c = splitAmount(r.close, ps), o = splitAmount(r.open, ps);
      ps.forEach((pt, j) => {
        const own = pt.h && book[pt.h]?.custom;
        const k = own ? 'head:' + pt.h : norm(r.name);
        const d = (x[k] = x[k] || { name: own ? book[pt.h].label : r.name, close: 0, open: 0 });
        d.close = round2(d.close + c[j]); d.open = round2(d.open + o[j]);
      });
    }
  });
  rows.forEach((r, i) => {
    if (!r.leaf) return;
    sumClose += r.close; sumOpen += r.open;
    const ps = parts[i];
    if (!ps) { unmapped.push({ name: r.name, close: r.close, open: r.open }); return; }
    const c = splitAmount(r.close, ps), o = splitAmount(r.open, ps);
    ps.forEach((pt, j) => {
      const h = baseOf(book, pt.h);
      if (h === 'ignore') return;
      close[h] = round2((close[h] || 0) + c[j]);
      open[h] = round2((open[h] || 0) + o[j]);
      // Lines under each P&L head, for the detailed P&L: the ledger, or the
      // own head it is mapped to (its ledgers added up under that name).
      if (HEAD[h].pl) {
        const own = book[pt.h].custom;
        const k = own ? 'head:' + pt.h : norm(r.name);
        const name = own ? book[pt.h].label : ps.length > 1 ? `${r.name} (${Math.round(pt.f * 10000) / 100}%)` : r.name;
        detail[h] = detail[h] || {};
        const d = (detail[h][k] = detail[h][k] || { name, close: 0, open: 0 });
        d.close = round2(d.close + c[j]); d.open = round2(d.open + o[j]);
      }
    });
  });
  // How each row was mapped, as text for the upload preview.
  const headText = parts.map((ps) => (!ps ? '' : ps.length === 1 ? book[ps[0].h].label
    : ps.map((x) => `${Math.round(x.f * 10000) / 100}% ${book[x.h].label}`).join(' + ')));
  // Tally's own closing-stock figure, carried in the Current Assets total
  // but on no ledger of it (see buildTree): not a reading error, so it is
  // kept out of the "does the file tally" check. The stock typed on the
  // upload stands in for it.
  const tallyStock = { close: 0, open: 0 };
  rows.forEach((r, i) => {
    if (r.leaf || r.parent >= 0 || norm(r.name) !== 'current assets') return;
    const kids = rows.filter((x) => x.parent === i);
    tallyStock.close += r.close - kids.reduce((a, x) => a + x.close, 0);
    tallyStock.open += r.open - kids.reduce((a, x) => a + x.open, 0);
  });
  return { close, open, detail, groups, unmapped, head, headText, src,
    diffClose: round2(sumClose + tallyStock.close), diffOpen: round2(sumOpen + tallyStock.open),
    tallyStock: { close: round2(tallyStock.close), open: round2(tallyStock.open) } };
}

// Tally's P&L groups, as the Profitability Statement shows them.
const PROFIT_GROUP = {
  'sales accounts': 'sales', 'sales account': 'sales',
  'direct incomes': 'dinc', 'income direct': 'dinc',
  'purchase accounts': 'purch', 'purchase account': 'purch',
  'direct expenses': 'dexp', 'expenses direct': 'dexp',
  'indirect incomes': 'iinc', 'income indirect': 'iinc',
  'indirect expenses': 'iexp', 'expenses indirect': 'iexp',
  // As in Jayesh's Export Profitability sheet: branch transfers in are part
  // of the cost of goods; unadjusted forex is its own line before net profit.
  'branch transfer purchase': 'btp',
  'unadjusted forex gain loss': 'fx',
};
const PROFIT_SIDE = { sales: -1, dinc: -1, iinc: -1, purch: 1, btp: 1, dexp: 1, iexp: 1, fx: -1 };

/* ── Statements ─────────────────────────────────────────────────────── */

const daysBetween = (from, to) => Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
const div0 = (a, b) => (Math.abs(b) < 0.005 ? null : a / b);

// Ledger names per P&L head across several columns, so every column's
// detailed P&L has the same lines in the same order.
const DETAIL_HEADS = ['revenue', 'direct_income', 'purchases', 'direct_exp', 'direct_wages', 'other_income', 'interest_income',
  'employee_cost', 'indirect_exp', 'depreciation', 'finance_cost', 'tax'];
function detailNames(list) {
  const out = {};
  for (const h of DETAIL_HEADS) {
    const seen = new Map();
    for (const t of list) for (const [k, d] of Object.entries(t.detail?.[h] || {})) if (!seen.has(k)) seen.set(k, d.name);
    // One ledger that is the whole head adds nothing.
    if (seen.size > 1) out[h] = [...seen.entries()];
  }
  out.__F = {};
  for (const g of Object.keys(PROFIT_SIDE)) {
    // Trial Balance order; a ledger only one column has goes in after the
    // ledger it follows there, not at the end.
    const order = [];
    const name = new Map();
    for (const t of list) {
      let after = -1;
      for (const [k, d] of Object.entries(t.groups?.[g]?.ledgers || {})) {
        const at = order.indexOf(k);
        if (at >= 0) { after = at; continue; }
        order.splice(after + 1, 0, k);
        name.set(k, d.name);
        after += 1;
      }
    }
    out.__F[g] = order.map((k) => [k, name.get(k)]);
  }
  return out;
}

/* The Profitability Statement, line for line as the old sheet:
   [kind, label, value, sign]. kind: 'H' group total (bold), 'l' a line,
   'll' a ledger under a sub-total, 'G' Gross / Net profit, 'memo', 'sec' a
   heading, 'chk' a statement-less-TB check, 'sp' a blank row. sign = how
   the line moves profit (+1 income, −1 cost) — the Variance column is
   (this − last) × sign, so a better year is positive throughout. */
function profitability(t, names, stock) {
  const F = names.__F || {};
  const g = (k) => t.groups?.[k] || { rowClose: 0, rowOpen: 0, ledgers: {} };
  // Incomes (credit) and costs (debit) both come out positive.
  const val = (k, d) => (PROFIT_SIDE[k] < 0 ? round2(-(d.close - (t.hasOpening ? d.open : 0))) : round2(d.close - (t.hasOpening ? d.open : 0)));
  const ledgers = (k, kind, sign) => (F[k] || []).map(([key, name]) => [kind, name, val(k, g(k).ledgers[key] || { close: 0, open: 0 }), sign]);
  const total = (k) => round2((F[k] || []).reduce((a, [key]) => a + val(k, g(k).ledgers[key] || { close: 0, open: 0 }), 0));
  const tb = (k) => val(k, { close: g(k).rowClose, open: g(k).rowOpen });
  const sales = total('sales'), dinc = total('dinc'), purch = total('purch'), dexp = total('dexp'), iinc = total('iinc'), iexp = total('iexp');
  const btp = total('btp'), fx = total('fx');
  const cogs = round2(stock.open + purch + btp + dexp - stock.close);
  const gp = round2(sales + dinc - cogs);
  const np = round2(gp + iinc - iexp + fx);
  // Shown only when some column has them (names are shared, so every
  // column gets the same lines and the Variance lines up).
  const hasBtp = (F.btp || []).length > 0, hasFx = (F.fx || []).length > 0;
  const dexpLines = F.dexp || [];
  const interestOnLoan = round2(Object.values(g('iexp').ledgers).filter((d) => /interest\s*on\s*loan|loan\s*interest/i.test(d.name))
    .reduce((a, d) => a + (d.close - (t.hasOpening ? d.open : 0)), 0));
  return [
    ['H', 'Sales', sales, 1], ...ledgers('sales', 'l', 1), ['sp'],
    ['H', 'Direct Income', dinc, 1], ...ledgers('dinc', 'l', 1), ['sp'],
    ['H', 'Cost of Goods Sold', cogs, -1],
    ['l', 'Opening Stock', round2(stock.open), -1],
    ['l', 'Add: Purchases', purch, -1], ...ledgers('purch', 'll', -1),
    ...(hasBtp ? [['l', 'Add: Branch Transfer (Purchase)', btp, -1], ...((F.btp || []).length > 1 ? ledgers('btp', 'll', -1) : [])] : []),
    ...(dexpLines.length === 1
      ? [['l', `Add: Direct Expenses - ${dexpLines[0][1]}`, dexp, -1]]
      : [['l', 'Add: Direct Expenses', dexp, -1], ...ledgers('dexp', 'll', -1)]),
    ['l', 'Less: Closing Stock (INPUT)', round2(stock.close), 1], ['sp'],
    ['G', 'Gross Profit', gp, 1], ['sp'],
    ['H', 'Indirect Incomes', iinc, 1], ...ledgers('iinc', 'l', 1), ['sp'],
    ['H', 'Total Indirect Expenses', iexp, -1], ...ledgers('iexp', 'l', -1), ['sp'],
    ...(hasFx ? [['H', 'Unadjusted Forex Gain / (Loss)', fx, 1], ['sp']] : []),
    ['G', 'Net Profit / (Loss) before allocation', np, 1], ['sp'],
    ['memo', 'Memo: Interest on Loan (part of Financial Expenses)', interestOnLoan, -1], ['sp'],
    ['sec', 'Checks against trial balance (should all be nil)'],
    ['chk', 'Sales: statement less TB', round2(sales - tb('sales')), 0],
    ['chk', 'Direct incomes: statement less TB', round2(dinc - tb('dinc')), 0],
    ['chk', 'Purchases: statement less TB', round2(purch - tb('purch')), 0],
    ...(hasBtp ? [['chk', 'Branch transfer (purchase): statement less TB', round2(btp - tb('btp')), 0]] : []),
    ['chk', 'Direct expenses: statement less TB', round2(dexp - tb('dexp')), 0],
    ['chk', 'Indirect incomes: statement less TB', round2(iinc - tb('iinc')), 0],
    ['chk', 'Indirect expenses: statement less TB', round2(iexp - tb('iexp')), 0],
  ];
}

// t = { close:{head:net}, open:{head:net}, detail, hasOpening, unmapped, diff… }
// names = detailNames([...]) to list ledgers under the P&L heads.
function statements(t, from, to, names = {}) {
  const v = (h, which = 'close') => { const x = (t[which][h] || 0); return HEAD[h].side === 'cr' ? -x : x; };
  // Nominal accounts: the period's own movement when the opening is known.
  const pl = (h) => round2(v(h) - (t.hasOpening ? v(h, 'open') : 0));
  const bal = (h) => round2(v(h));
  const chg = (h) => round2(v(h) - v(h, 'open'));

  const revenue = pl('revenue') + pl('direct_income');
  // Stock. Tally's Trial Balance usually shows only an "Opening Stock" line
  // (the year's opening, under Current Assets) and no closing stock — that
  // is typed on the upload ("Closing Stock (INPUT)" in the old sheet) and
  // arrives here as close.stock. The stock on the period's first day is a
  // Stock-in-Hand opening (from the file, or the previous upload's closing
  // stock), else that Opening Stock line.
  const hasOpenLine = t.close.opening_stock != null;
  const openingStock = t.open.stock != null && (t.open.stock !== 0 || !hasOpenLine || t.openStockTyped)
    ? v('stock', 'open') : (hasOpenLine ? v('opening_stock') : 0);
  const closingStock = bal('stock');
  const stockMissing = t.close.stock == null && hasOpenLine;
  const cogs = openingStock + pl('purchases') + pl('direct_exp') + pl('direct_wages') - closingStock;
  const gp = revenue - cogs;
  const otherInc = pl('other_income') + pl('interest_income');
  const opex = pl('employee_cost') + pl('indirect_exp');
  const ebitda = gp + otherInc - opex;
  const dep = pl('depreciation'), fin = pl('finance_cost');
  const pbt = ebitda - dep - fin;
  const tax = pl('tax');
  const pat = pbt - tax;
  const r2 = (x) => round2(x);

  // A head line followed by its ledgers (when there are several).
  const withDetail = (h, label, value) => {
    const out = [[h, label, r2(value)]];
    for (const [k, name] of names[h] || []) {
      const d = t.detail?.[h]?.[k];
      const x = d ? (HEAD[h].side === 'cr' ? -1 : 1) * (d.close - (t.hasOpening ? d.open : 0)) : 0;
      out.push(['d', name, r2(x)]);
    }
    return out;
  };
  const P = [
    ...(stockMissing ? [['warn', 'Closing stock not entered on the upload — Gross Profit is wrong until it is', null]] : []),
    ['h', 'Revenue'],
    ...withDetail('revenue', 'Sales / Revenue', pl('revenue')),
    ...withDetail('direct_income', 'Direct Income', pl('direct_income')),
    ['t', 'Revenue from Operations', r2(revenue)],
    ['h', 'Cost of Goods Sold'],
    ['opening_stock', 'Opening Stock', r2(openingStock)],
    ...withDetail('purchases', 'Purchases', pl('purchases')),
    ...withDetail('direct_exp', 'Direct Expenses', pl('direct_exp')),
    ...withDetail('direct_wages', 'Wages / Labour (Direct)', pl('direct_wages')),
    ['stock', 'Less: Closing Stock', r2(-closingStock)],
    ['t', 'Cost of Goods Sold', r2(cogs)],
    ['T', 'Gross Profit', r2(gp)],
    ['pct', 'Gross Profit %', div0(gp * 100, revenue)],
    ...withDetail('other_income', 'Other Income', pl('other_income')),
    ...withDetail('interest_income', 'Interest Income', pl('interest_income')),
    ...withDetail('employee_cost', 'Salary & Staff Cost', pl('employee_cost')),
    ...withDetail('indirect_exp', 'Other Indirect Expenses', pl('indirect_exp')),
    ['T', 'EBITDA', r2(ebitda)],
    ['pct', 'EBITDA %', div0(ebitda * 100, revenue)],
    ...withDetail('depreciation', 'Depreciation', dep),
    ...withDetail('finance_cost', 'Interest & Finance Cost', fin),
    ['T', 'Profit Before Tax', r2(pbt)],
    ...withDetail('tax', 'Income Tax', tax),
    ['T', 'Net Profit', r2(pat)],
    ['pct', 'Net Profit %', div0(pat * 100, revenue)],
  ];

  // Cash flow — indirect method. Needs opening balances.
  let C = null;
  if (t.hasOpening) {
    const wc = [
      ['debtors', '(Increase) / Decrease in Sundry Debtors', -chg('debtors')],
      ['stock', '(Increase) / Decrease in Inventories', -(closingStock - openingStock)],
      ['loans_adv', '(Increase) / Decrease in Loans, Advances & Deposits', -chg('loans_adv')],
      ['other_ca', '(Increase) / Decrease in Other Current Assets', -(chg('other_ca') + chg('misc_asset'))],
      ['creditors', 'Increase / (Decrease) in Sundry Creditors', chg('creditors')],
      ['duties_taxes', 'Increase / (Decrease) in Duties & Taxes', chg('duties_taxes')],
      ['provisions', 'Increase / (Decrease) in Provisions', chg('provisions')],
      ['other_cl', 'Increase / (Decrease) in Other Current Liabilities', chg('other_cl')],
    ];
    const intInc = pl('interest_income');
    const beforeWc = pbt + dep + fin - intInc;
    const cfo = beforeWc + wc.reduce((a, x) => a + x[2], 0) - tax;
    const capex = -(chg('fixed_assets') + dep);
    const inv = -chg('investments');
    const cfi = capex + inv + intInc;
    const loans = chg('secured_loans') + chg('unsecured_loans');
    const od = chg('bank_od');
    const cap = chg('capital') + chg('pl_account');
    const cff = cap + loans + od - fin;
    // Inter-division (Branch / Divisions) transfers sit between the period's
    // cash flow and the closing balance, as in the old sheet; suspense and
    // unmapped ledgers likewise.
    const branch = -chg('branch');
    const other = -chg('suspense') - t.unmapped.reduce((a, u) => a + (u.close - u.open), 0);
    const openCash = v('cash', 'open') + v('bank', 'open');
    const closeCash = bal('cash') + bal('bank');
    const net = cfo + cfi + cff;
    const unrec = (closeCash - openCash) - (net + branch + other);
    C = [
      ['h', 'A. Cash Flow from Operating Activities'],
      ['', 'Net Profit Before Tax', r2(pbt)],
      ['depreciation', 'Add: Depreciation', r2(dep)],
      ['finance_cost', 'Add: Interest & Finance Cost', r2(fin)],
      ['interest_income', 'Less: Interest Income', r2(-intInc)],
      ['t', 'Operating Profit before Working Capital Changes', r2(beforeWc)],
      ...wc.map(([k, l, x]) => [k, l, r2(x)]),
      ['tax', 'Less: Income Tax', r2(-tax)],
      ['T', 'Net Cash from Operating Activities (A)', r2(cfo)],
      ['h', 'B. Cash Flow from Investing Activities'],
      ['fixed_assets', 'Purchase of Fixed Assets (net)', r2(capex)],
      ['investments', '(Increase) / Decrease in Investments', r2(inv)],
      ['interest_income', 'Interest Received', r2(intInc)],
      ['T', 'Net Cash from Investing Activities (B)', r2(cfi)],
      ['h', 'C. Cash Flow from Financing Activities'],
      ['capital', 'Capital Introduced / (Withdrawn)', r2(cap)],
      ['secured_loans', 'Loans Taken / (Repaid)', r2(loans)],
      ['bank_od', 'Increase / (Decrease) in Bank OD / CC', r2(od)],
      ['finance_cost', 'Interest Paid', r2(-fin)],
      ['T', 'Net Cash from Financing Activities (C)', r2(cff)],
      ['T', 'Net Cash Inflow / (Outflow) during the Period (A+B+C)', r2(net)],
      ['', 'Opening Cash & Bank', r2(openCash)],
      ['branch', 'Branch / Divisions (inter-division transfers)', r2(branch)],
      ...(Math.abs(other) > 0.5 ? [['suspense', 'Suspense / Unmapped Ledgers', r2(other)]] : []),
      ['T', 'Closing Cash & Bank', r2(openCash + net + branch + other)],
      ...(Math.abs(unrec) > 0.5 ? [['warn', 'Not reconciled with the closing Cash & Bank by', r2(unrec)]] : []),
      ...(Math.abs(t.diffClose || 0) > 0.5 || Math.abs(t.diffOpen || 0) > 0.5
        ? [['warn', 'Trial Balance in the file does not tally (Dr − Cr, closing)', r2(t.diffClose || 0)]] : []),
    ];
  }

  // Ratios on closing balances. Each current head counts on the side its
  // balance is actually on — Duties & Taxes is often a debit (input credit
  // not yet set off), and then it is an asset, not a liability.
  let ca = closingStock, cl = 0;
  for (const h of ['debtors', 'cash', 'bank', 'loans_adv', 'other_ca', 'creditors', 'duties_taxes', 'provisions', 'other_cl', 'bank_od']) {
    const x = t.close[h] || 0;   // Dr − Cr
    if (x > 0) ca += x; else cl -= x;
  }
  const debt = bal('secured_loans') + bal('unsecured_loans') + bal('bank_od');
  const equity = bal('capital') + bal('pl_account') + pat;
  const days = daysBetween(from, to);
  const ebit = pbt + fin;
  const purchases = pl('purchases');
  const R = [
    ['pct', 'Gross Profit Margin %', div0(gp * 100, revenue)],
    ['pct', 'EBITDA Margin %', div0(ebitda * 100, revenue)],
    ['pct', 'Net Profit Margin %', div0(pat * 100, revenue)],
    ['x', 'Current Ratio', div0(ca, cl)],
    ['x', 'Quick Ratio', div0(ca - bal('stock'), cl)],
    ['x', 'Debt / Equity', div0(debt, equity)],
    ['x', 'Interest Coverage (EBIT / Interest)', div0(ebit, fin)],
    ['pct', 'Return on Capital Employed % (period)', div0(ebit * 100, equity + debt)],
    ['days', 'Debtor Days', div0(bal('debtors') * days, revenue)],
    ['days', 'Creditor Days', div0(bal('creditors') * days, purchases)],
    ['days', 'Inventory Days', div0(closingStock * days, cogs)],
    ['', 'Working Capital', r2(ca - cl)],
    ['', 'Total Borrowings', r2(debt)],
    ['', 'Net Worth', r2(equity)],
  ].map(([k, l, x]) => [k, l, x == null ? null : Math.round(x * 100) / 100]);

  return { F: profitability(t, names, { open: openingStock, close: closingStock }), P, C, R, days };
}

/* ===================================================================== */

function mountMisFinance(app, ctx) {
  const { q, ensureSchema, requireAuth, useDb, canOpen } = ctx;

  async function readCfg(key) {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [key]);
      if (rows.length) return JSON.parse(rows[0].value);
    } catch (e) { if (!(e instanceof SyntaxError)) console.error('[mis-fin] setting', key, '—', e.message); }
    return null;
  }
  async function writeCfg(key, value) {
    const json = JSON.stringify(value);
    await q(`INSERT INTO app_config ("key","value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value"=$3`, [key, json, json]);
  }
  const divisions = async () => { const d = await readCfg(CFG.divisions); return Array.isArray(d) && d.length ? d : DEFAULT_DIVISIONS; };
  const mapping = async () => { const m = await readCfg(CFG.map); return m && typeof m === 'object' ? m : {}; };
  const customHeads = async () => { const h = await readCfg(CFG.heads); return Array.isArray(h) ? h : []; };

  function route(fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'MIS Financials needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        if (!(await canOpen(req.session.user))) return res.status(403).json({ error: 'You do not have access to MIS Financials — ask an Admin to tick it in Users → Access' });
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e.userError) return res.status(400).json({ error: e.message });
        console.error('[mis-fin]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  const bad = (msg) => { const e = new Error(msg); e.userError = true; throw e; };
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const dOut = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v || '').slice(0, 10));
  const parse = (sheet) => { try { return parseTrialBalance(sheet); } catch (e) { return bad(e.message); } };

  // What the upload dialog shows before saving.
  function previewOf(tb, map, extra, custom) {
    const merged = { ...map, ...extra };
    const t = headTotals(tb.rows, merged, custom);
    const c = tb.comparative;
    return {
      company: tb.company, period: tb.period, hasOpening: tb.hasOpening, grand: tb.grand,
      rows: tb.rows.map((r, i) => ({ name: r.name, close: r.close, open: r.open, leaf: r.leaf, depth: depth(tb.rows, i), head: t.head[i], headText: t.headText[i], src: t.src[i] })),
      unmapped: t.unmapped, diffClose: t.diffClose, diffOpen: t.diffOpen, tallyStock: t.tallyStock,
      // The Opening Stock line with no closing stock in the file: ask for it.
      needsClosingStock: t.close.opening_stock != null && t.close.stock == null,
      comparative: c && c.period ? { period: c.period, hasOpening: c.hasOpening, rows: c.rows.length, diffClose: headTotals(c.rows, merged, custom).diffClose } : null,
    };
  }
  const depth = (rows, i) => { let d = 0; let p = rows[i].parent; while (p >= 0 && d < 20) { d++; p = rows[p].parent; } return d; };

  app.get('/api/mis-finance/data', requireAuth, route(async () => {
    const ups = await q('SELECT id, division, period_from, period_to, file_name, company, has_opening, closing_stock, opening_stock, uploaded_by, created_at FROM mis_tb_uploads ORDER BY period_to DESC, division');
    return {
      divisions: await divisions(),
      heads: [...HEADS.map(({ key, label, pl }) => ({ key, label, pl: !!pl })),
        ...Object.values(headBook(await customHeads())).filter((h) => h.custom).map(({ key, label, pl, base }) => ({ key, label, pl: !!pl, base, custom: true }))],
      uploads: ups.map((u) => ({ id: u.id, division: u.division, from: dOut(u.period_from), to: dOut(u.period_to), file_name: u.file_name, company: u.company,
        has_opening: !!Number(u.has_opening), closing_stock: u.closing_stock == null ? null : Number(u.closing_stock), opening_stock: u.opening_stock == null ? null : Number(u.opening_stock), uploaded_by: u.uploaded_by, at: u.created_at instanceof Date ? u.created_at.toISOString() : u.created_at })),
    };
  }));

  app.post('/api/mis-finance/preview', requireAuth, route(async (req) => {
    const tb = parse(req.body?.sheet);
    const custom = await customHeads();
    return previewOf(tb, await mapping(), cleanMap(req.body?.mappings, custom), custom);
  }));

  // One head key, or a split [{ h, p }] (percent, adding up to 100).
  function cleanValue(v, book) {
    if (typeof v === 'string') return book[v] ? v : undefined;
    if (!Array.isArray(v)) return undefined;
    const list = v.map((x) => ({ h: String(x?.h || ''), p: Math.round(Number(x?.p) * 100) / 100 })).filter((x) => x.h && x.p);
    if (!list.length) return undefined;
    for (const x of list) {
      if (!book[x.h]) bad('Unknown head in the split');
      if (!(x.p > 0 && x.p <= 100)) bad('Each share must be between 0 and 100 %');
    }
    if (new Set(list.map((x) => x.h)).size !== list.length) bad('The same head is twice in the split');
    const sum = list.reduce((a, x) => a + x.p, 0);
    if (Math.abs(sum - 100) > 0.001) bad(`The split adds up to ${Math.round(sum * 100) / 100}% — it must be 100%`);
    return list.length === 1 ? list[0].h : list;
  }
  function cleanMap(m, custom) {
    const out = {};
    if (!m || typeof m !== 'object') return out;
    const book = headBook(custom);
    for (const [k, h] of Object.entries(m)) { const key = norm(k); const v = cleanValue(h, book); if (key && v !== undefined) out[key] = v; }
    return out;
  }

  app.post('/api/mis-finance/uploads', requireAuth, route(async (req) => {
    const b = req.body || {};
    const divs = await divisions();
    const division = divs.includes(b.division) ? b.division : bad('Choose the division');
    const from = ISO.test(b.from || '') ? b.from : bad('Enter the period From date');
    const to = ISO.test(b.to || '') ? b.to : bad('Enter the period To date');
    if (to < from) bad('The To date is before the From date');
    const tb = parse(b.sheet);
    const closingStock = stockIn(b.closing_stock, 'Closing stock');
    const openingStock = stockIn(b.opening_stock, 'Opening stock');
    const extra = cleanMap(b.mappings, await customHeads());
    if (Object.keys(extra).length) await writeCfg(CFG.map, { ...(await mapping()), ...extra });
    const rowsJson = JSON.stringify(tb.rows.map(({ name, close, open, parent, leaf }) => ({ name, close, open, parent, leaf })));
    const by = req.session.user.name || req.session.user.email || '';
    const fileName = String(b.file_name || '').slice(0, 255);
    await q(`INSERT INTO mis_tb_uploads (division, period_from, period_to, file_name, company, has_opening, closing_stock, opening_stock, rows_json, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (division, period_from, period_to) DO UPDATE SET file_name=$11, company=$12, has_opening=$13, closing_stock=$14, opening_stock=$15, rows_json=$16, uploaded_by=$17, created_at=NOW()`,
      [division, from, to, fileName, tb.company, tb.hasOpening ? 1 : 0, closingStock, openingStock, rowsJson, by,
        fileName, tb.company, tb.hasOpening ? 1 : 0, closingStock, openingStock, rowsJson, by]);

    // The comparative period Tally exported alongside (usually the same
    // months last year) is saved too — but never over an upload of its own.
    let comparative = null;
    const c = tb.comparative;
    if (c && c.period && !(c.period.from === from && c.period.to === to)) {
      const prevStock = stockIn(b.closing_stock_prev, 'Closing stock of the comparative period');
      const prevOpen = stockIn(b.opening_stock_prev, 'Opening stock of the comparative period');
      const exists = (await q('SELECT id, closing_stock, opening_stock FROM mis_tb_uploads WHERE division = $1 AND period_from = $2 AND period_to = $3',
        [division, c.period.from, c.period.to]))[0];
      if (!exists) {
        await q(`INSERT INTO mis_tb_uploads (division, period_from, period_to, file_name, company, has_opening, closing_stock, opening_stock, rows_json, uploaded_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [division, c.period.from, c.period.to, (fileName + ' (comparative)').slice(0, 255), tb.company, c.hasOpening ? 1 : 0, prevStock, prevOpen,
            JSON.stringify(c.rows.map(({ name, close, open, parent, leaf }) => ({ name, close, open, parent, leaf }))), by]);
        comparative = 'saved';
      } else {
        // Stock typed now for the comparative fills it in (or corrects it).
        if (prevStock != null) await q('UPDATE mis_tb_uploads SET closing_stock = $1 WHERE id = $2', [prevStock, exists.id]);
        if (prevOpen != null) await q('UPDATE mis_tb_uploads SET opening_stock = $1 WHERE id = $2', [prevOpen, exists.id]);
        comparative = 'exists';
      }
    }
    return { ok: true, comparative, comparativePeriod: c?.period || null };
  }));

  // Opening / closing stock of an upload, changed without uploading again.
  app.patch('/api/mis-finance/uploads/:id', requireAuth, route(async (req) => {
    const b = req.body || {};
    const id = Number(req.params.id);
    const u = (await q('SELECT id FROM mis_tb_uploads WHERE id = $1', [id]))[0];
    if (!u) bad('That upload is not there any more');
    await q('UPDATE mis_tb_uploads SET opening_stock = $1, closing_stock = $2 WHERE id = $3',
      [stockIn(b.opening_stock, 'Opening stock'), stockIn(b.closing_stock, 'Closing stock'), id]);
    return { ok: true };
  }));

  app.delete('/api/mis-finance/uploads/:id', requireAuth, route(async (req) => {
    await q('DELETE FROM mis_tb_uploads WHERE id = $1', [Number(req.params.id)]);
    return { ok: true };
  }));

  function stockIn(v, label) {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/[,₹\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) bad(`${label} must be a positive number`);
    return round2(n);
  }

  const prevDay = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

  // One upload as head totals; an upload without opening balances borrows
  // them from the same division's upload that ends the day before.
  async function totalsFor(u, map, all, custom) {
    const rows = JSON.parse(u.rows_json || '[]');
    const t = headTotals(rows, map, custom);
    // Typed on the upload when the Trial Balance shows stock at its opening value.
    if (u.closing_stock != null) t.close.stock = round2(Number(u.closing_stock));
    t.hasOpening = !!Number(u.has_opening);
    t.openingFrom = t.hasOpening ? 'file' : '';
    if (!t.hasOpening) {
      const prev = all.find((x) => x.division === u.division && dOut(x.period_to) === prevDay(dOut(u.period_from)));
      if (prev) {
        const p = headTotals(JSON.parse(prev.rows_json || '[]'), map, custom);
        // Nominal accounts restart at a new financial year (1 April).
        const fyStart = dOut(u.period_from).slice(5) === '04-01';
        t.open = {};
        if (prev.closing_stock != null) p.close.stock = round2(Number(prev.closing_stock));
        for (const h of HEADS) if (p.close[h.key] != null && !(h.pl && fyStart)) t.open[h.key] = p.close[h.key];
        t.unmapped = t.unmapped.map((x) => ({ ...x, open: 0 }));
        t.hasOpening = true;
        t.openingFrom = `${prev.division} ${dOut(prev.period_from)} → ${dOut(prev.period_to)}`;
      }
    }
    // Stock on the first day = the closing stock typed on the upload that
    // ends the day before (Tally's own Opening Stock line is the year's).
    if (t.open.stock == null) {
      const prev = all.find((x) => x.division === u.division && dOut(x.period_to) === prevDay(dOut(u.period_from)) && x.closing_stock != null);
      if (prev) t.open.stock = round2(Number(prev.closing_stock));
    }
    // Typed on the upload: the books' own opening stock, over everything else.
    if (u.opening_stock != null) { t.open.stock = round2(Number(u.opening_stock)); t.openStockTyped = true; }
    return t;
  }
  function addTotals(list) {
    const sum = { close: {}, open: {}, detail: {}, groups: {}, unmapped: [], hasOpening: list.every((t) => t.hasOpening), openStockTyped: list.some((t) => t.openStockTyped), diffClose: 0, diffOpen: 0 };
    for (const t of list) {
      for (const [gk, gv] of Object.entries(t.groups || {})) {
        const x = (sum.groups[gk] = sum.groups[gk] || { rowClose: 0, rowOpen: 0, ledgers: {} });
        x.rowClose = round2(x.rowClose + gv.rowClose); x.rowOpen = round2(x.rowOpen + gv.rowOpen);
        for (const [k, d] of Object.entries(gv.ledgers)) {
          const y = (x.ledgers[k] = x.ledgers[k] || { name: d.name, close: 0, open: 0 });
          y.close = round2(y.close + d.close); y.open = round2(y.open + d.open);
        }
      }
      for (const w of ['close', 'open']) for (const [k, x] of Object.entries(t[w])) sum[w][k] = round2((sum[w][k] || 0) + x);
      for (const [h, m] of Object.entries(t.detail || {})) {
        for (const [k, d] of Object.entries(m)) {
          sum.detail[h] = sum.detail[h] || {};
          const x = (sum.detail[h][k] = sum.detail[h][k] || { name: d.name, close: 0, open: 0 });
          x.close = round2(x.close + d.close); x.open = round2(x.open + d.open);
        }
      }
      sum.unmapped.push(...t.unmapped);
      sum.diffClose = round2(sum.diffClose + t.diffClose);
      sum.diffOpen = round2(sum.diffOpen + t.diffOpen);
    }
    return sum;
  }

  // Same dates a year earlier (29 Feb → 28 Feb).
  const lastYear = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periodName = (from, to) => {
    const f = from.split('-').map(Number), t = to.split('-').map(Number);
    return `${MONTHS[f[1] - 1]}${f[0] !== t[0] ? "'" + String(f[0]).slice(2) : ''}-${MONTHS[t[1] - 1]}'${String(t[0]).slice(2)}`;
  };
  // A column of figures minus another, line by line (the lines match).
  const minus = (a, b) => (a && b ? a.map((ln, i) => {
    const x = ln[2], y = b[i]?.[2];
    if (ln.length < 3) return ln;
    const sign = ln.length > 3 ? ln[3] : 1;
    return [ln[0], ln[1], x == null || y == null || sign === 0 ? null : round2((x - y) * sign), sign];
  }) : null);

  app.get('/api/mis-finance/report', requireAuth, route(async (req) => {
    const from = String(req.query.from || ''), to = String(req.query.to || '');
    if (!ISO.test(from) || !ISO.test(to)) bad('Choose the period');
    const map = await mapping();
    const custom = await customHeads();
    const all = await q('SELECT * FROM mis_tb_uploads');
    const divs = await divisions();
    const find = (d, f, t2) => all.find((x) => x.division === d && dOut(x.period_from) === f && dOut(x.period_to) === t2);
    const meta = (u, t) => ({ file_name: u.file_name, company: u.company, openingFrom: t.openingFrom, diffClose: t.diffClose, diffOpen: t.diffOpen, unmapped: t.unmapped.length });

    // One division: this period, the same period last year and the change —
    // the layout of the old Profitability sheet.
    const division = String(req.query.division || '');
    if (division) {
      if (!divs.includes(division)) bad('Unknown division');
      const u = find(division, from, to);
      if (!u) bad(`${division} has no upload for this period`);
      const pf = lastYear(from), pt = lastYear(to);
      const pu = find(division, pf, pt);
      const t = await totalsFor(u, map, all, custom);
      const pt2 = pu ? await totalsFor(pu, map, all, custom) : null;
      const names = detailNames(pt2 ? [t, pt2] : [t]);
      const cur = { division: periodName(from, to), ...meta(u, t), ...statements(t, from, to, names) };
      const columns = [cur];
      if (pt2) {
        const prev = { division: periodName(pf, pt), ...meta(pu, pt2), ...statements(pt2, pf, pt, names) };
        columns.push(prev, { division: 'Variance', change: true, F: minus(cur.F, prev.F), P: minus(cur.P, prev.P), C: minus(cur.C, prev.C), R: minus(cur.R, prev.R) });
      }
      return { from, to, days: daysBetween(from, to), division, compare: pu ? { from: pf, to: pt } : null, columns, consolidated: null };
    }

    const cols = [];
    const totals = [];
    for (const d of divs) {
      const u = find(d, from, to);
      if (!u) { cols.push({ division: d, missing: true }); continue; }
      const t = await totalsFor(u, map, all, custom);
      totals.push(t);
      cols.push({ division: d, u, t });
    }
    if (!totals.length) bad('Nothing is uploaded for this period yet');
    const sum = totals.length > 1 ? addTotals(totals) : null;
    const names = detailNames(sum ? [...totals, sum] : totals);
    const columns = cols.map((c) => (c.missing ? c : { division: c.division, ...meta(c.u, c.t), ...statements(c.t, from, to, names) }));
    const consolidated = sum ? { division: 'Consolidated', ...statements(sum, from, to, names) } : null;
    return { from, to, days: daysBetween(from, to), columns, consolidated };
  }));

  // Every ledger / group name seen in the uploads, with its current head.
  app.get('/api/mis-finance/mapping', requireAuth, route(async () => {
    const map = await mapping();
    const custom = await customHeads();
    const all = await q('SELECT division, rows_json FROM mis_tb_uploads');
    const seen = new Map();
    for (const u of all) {
      const rows = JSON.parse(u.rows_json || '[]');
      const { head, parts, src } = assignHeads(rows, map, custom);
      rows.forEach((r, i) => {
        const k = norm(r.name);
        const split = parts[i] && parts[i].length > 1 ? parts[i].map((x) => ({ h: x.h, p: Math.round(x.f * 10000) / 100 })) : null;
        if (!seen.has(k)) seen.set(k, { name: r.name, head: head[i], split, src: src[i], leaf: r.leaf, divisions: new Set() });
        seen.get(k).divisions.add(u.division);
      });
    }
    return { names: [...seen.values()].map((x) => ({ ...x, divisions: [...x.divisions] })).sort((a, b) => a.name.localeCompare(b.name)) };
  }));

  app.post('/api/mis-finance/mapping', requireAuth, route(async (req) => {
    const b = req.body || {};
    const cur = await mapping();
    const book = headBook(await customHeads());
    for (const [k, h] of Object.entries(b.set || {})) {
      const key = norm(k);
      if (!key) continue;
      if (h === '' || h == null) { delete cur[key]; continue; }
      const v = cleanValue(h, book);
      if (v !== undefined) cur[key] = v;
    }
    await writeCfg(CFG.map, cur);
    return { ok: true };
  }));

  // Own heads: add / rename (key given) / delete.
  app.post('/api/mis-finance/heads', requireAuth, route(async (req) => {
    const b = req.body || {};
    const label = String(b.label || '').trim().slice(0, 80);
    if (!label) bad('Type the head name');
    if (!HEAD[b.base] || b.base === 'ignore') bad('Choose what the head works like');
    const list = await customHeads();
    const book = headBook(list);
    const clash = Object.values(book).find((h) => h.label.toLowerCase() === label.toLowerCase() && h.key !== b.key);
    if (clash) bad(`There is already a head called “${clash.label}”`);
    let key = String(b.key || '');
    if (key) {
      const x = list.find((h) => h.key === key);
      if (!x) bad('That head is not there any more');
      x.label = label; x.base = b.base;
    } else {
      if (list.length >= 200) bad('Too many heads');
      key = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      list.push({ key, label, base: b.base });
    }
    await writeCfg(CFG.heads, list);
    return { ok: true, key };
  }));

  app.delete('/api/mis-finance/heads/:key', requireAuth, route(async (req) => {
    const key = String(req.params.key || '');
    const list = await customHeads();
    const x = list.find((h) => h.key === key);
    if (!x) bad('That head is not there any more');
    // Ledgers on it go to the head it was based on — the totals stay the same.
    const map = await mapping();
    let moved = 0;
    for (const [k, v] of Object.entries(map)) {
      if (v === key) { map[k] = x.base; moved++; continue; }
      if (!Array.isArray(v) || !v.some((p) => p.h === key)) continue;
      moved++;
      const merged = new Map();
      for (const p of v) { const h = p.h === key ? x.base : p.h; merged.set(h, Math.round(((merged.get(h) || 0) + Number(p.p)) * 100) / 100); }
      map[k] = merged.size === 1 ? [...merged.keys()][0] : [...merged].map(([h, p]) => ({ h, p }));
    }
    await writeCfg(CFG.map, map);
    await writeCfg(CFG.heads, list.filter((h) => h.key !== key));
    return { ok: true, moved };
  }));

  app.post('/api/mis-finance/divisions', requireAuth, route(async (req) => {
    const list = (Array.isArray(req.body?.divisions) ? req.body.divisions : []).map((x) => String(x || '').trim().slice(0, 64)).filter(Boolean);
    if (!list.length) bad('Keep at least one division');
    if (new Set(list.map((x) => x.toLowerCase())).size !== list.length) bad('Two divisions have the same name');
    const old = await divisions();
    // A rename keeps its uploads: same position, new name.
    for (let i = 0; i < Math.min(old.length, list.length); i++) {
      if (old[i] !== list[i] && !list.includes(old[i])) await q('UPDATE mis_tb_uploads SET division = $1 WHERE division = $2', [list[i], old[i]]);
    }
    await writeCfg(CFG.divisions, list.slice(0, 12));
    return { ok: true };
  }));

  return {};
}

module.exports = { MF_SCHEMA, mountMisFinance, parseTrialBalance, pickTrialBalance, headTotals, statements, detailNames, HEADS };
