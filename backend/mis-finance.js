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
];

const CFG = { divisions: 'misfin_divisions', map: 'misfin_map' };
// The ERP's own four business sections (sidebar) — renamable in Settings.
const DEFAULT_DIVISIONS = ['Factory', 'Export', 'Trading', 'Retail'];

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
};
// Primary groups never sit under another row (stops a coincidental sum
// from nesting one primary group inside the one above it).
const PRIMARY = new Set(['capital account', 'loans liability', 'current liabilities', 'fixed assets', 'investments', 'current assets',
  'branch divisions', 'misc expenses asset', 'suspense a c', 'sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses',
  'indirect incomes', 'indirect expenses', 'opening stock', 'profit & loss a c', 'difference in opening balances']);

// Ledger-name rules inside expense / income groups.
function ruleHead(name, parentHead) {
  const n = String(name || '').toLowerCase();
  const expense = ['direct_exp', 'indirect_exp', 'purchases', 'direct_wages', 'employee_cost'].includes(parentHead);
  if (expense) {
    if (/depreciation/.test(n)) return 'depreciation';
    if (/income\s*tax|provision for tax|current tax|deferred tax/.test(n)) return 'tax';
    if (/interest|bank charge|finance charge|processing fee|loan charge|bank commission/.test(n)) return 'finance_cost';
    if (/salar|wage|labou?r|bonus|provident|\bp\.?\s?f\b|e\.?s\.?i|gratuity|staff welfare|leave encash|stipend|incentive to staff/.test(n)) {
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
  const company = rows.slice(0, hr + 1).map((r) => r.map(cellText).filter(Boolean).join(' ')).find((t) => t && !/trial balance|particulars/i.test(t)) || '';
  const headText = rows.slice(0, hr + 6).map((r) => r.map(cellText).join(' ')).join(' ');
  const period = findPeriod(headText);

  // The Debit / Credit header row (within a few rows of Particulars).
  let dc = -1;
  for (let i = hr; i < Math.min(rows.length, hr + 8); i++) {
    if (rows[i].some((c, j) => j > pc && /^(debit|dr\.?)$/i.test(cellText(c)))) { dc = i; break; }
  }
  const width = Math.max(...rows.slice(hr, hr + 8).map((r) => r.length));
  // Header label per column = the rows above, carried right across merged cells.
  const label = (c, upto) => {
    const parts = [];
    for (let i = hr; i < upto; i++) {
      let j = c;
      while (j > pc && !cellText(rows[i][j])) j--;
      const t = j > pc ? cellText(rows[i][j]) : '';
      if (t && !parts.includes(t)) parts.push(t);
    }
    return parts.join(' ').toLowerCase();
  };
  const kindOf = (l) => (/opening/.test(l) ? 'open' : /closing/.test(l) ? 'close' : /transaction|during/.test(l) ? 'txn' : null);

  const cols = [];   // { c, kind, side }
  if (dc >= 0) {
    for (let c = pc + 1; c < width; c++) {
      const t = cellText(rows[dc][c]);
      const side = /^(debit|dr\.?)$/i.test(t) ? 'dr' : /^(credit|cr\.?)$/i.test(t) ? 'cr' : null;
      if (side) cols.push({ c, side, kind: kindOf(label(c, dc)) });
    }
    const pairs = cols.filter((x) => x.side === 'dr').length;
    // Unlabelled pairs: one → closing; three → opening, transactions, closing; two → opening, closing.
    const order = pairs === 1 ? ['close'] : pairs === 3 ? ['open', 'txn', 'close'] : ['open', 'close'];
    let k = -1;
    cols.forEach((x) => { if (x.side === 'dr') k++; if (!x.kind) x.kind = order[Math.min(k, order.length - 1)] || 'close'; });
  } else {
    // One column per balance with a Dr / Cr suffix.
    for (let c = pc + 1; c < width; c++) {
      const kind = kindOf(label(c, hr + 4));
      if (kind) cols.push({ c, side: 'net', kind });
    }
    if (!cols.length) {
      const c = rows.slice(hr + 1).reduce((best, r) => best ?? r.findIndex((v, j) => j > pc && amount(v)), null);
      if (c != null && c > pc) cols.push({ c, side: 'net', kind: 'close' });
    }
  }
  const closeCols = cols.filter((x) => x.kind === 'close');
  if (!closeCols.length) throw new Error('Could not find the closing balance columns (Debit / Credit) in the sheet');
  const openCols = cols.filter((x) => x.kind === 'open');

  const net = (r, list) => {
    let v = 0, any = false;
    for (const x of list) {
      const a = amount(r[x.c]);
      if (!a) continue;
      any = true;
      if (x.side === 'dr') v += Math.abs(a.v) * (a.v < 0 ? -1 : 1);
      else if (x.side === 'cr') v -= Math.abs(a.v) * (a.v < 0 ? -1 : 1);
      else v += a.side === 'cr' ? -Math.abs(a.v) : a.side === 'dr' ? Math.abs(a.v) : a.v;
    }
    return any ? round2(v) : null;
  };

  const out = [];
  let grand = null;
  for (let i = Math.max(hr, dc) + 1; i < rows.length; i++) {
    const r = rows[i];
    const raw = String(r[pc] ?? '');
    const name = raw.trim();
    if (!name) continue;
    const close = net(r, closeCols);
    const open = openCols.length ? net(r, openCols) : null;
    if (/^grand\s*total$|^total$/i.test(name)) { grand = { close, open }; break; }
    if (close == null && open == null) continue;   // a heading line
    out.push({ name: name.slice(0, 200), indent: raw.length - raw.trimStart().length, close: close ?? 0, open: open ?? 0 });
  }
  if (!out.length) throw new Error('No ledger / group rows found under Particulars');
  return { company: company.slice(0, 255), period, hasOpening: openCols.length > 0, rows: buildTree(out), grand };
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
    return next[i];
  }
  let i = 0;
  while (i < n) i = item(i);
  return rows;
}

/* ── Head for every row, leaves summed per head ─────────────────────── */

function assignHeads(rows, map) {
  const head = new Array(rows.length).fill(null);
  const src = new Array(rows.length).fill('');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const pHead = r.parent >= 0 ? head[r.parent] : null;
    const key = norm(r.name);
    if (map[key] && HEAD[map[key]]) { head[i] = map[key]; src[i] = 'saved'; continue; }
    const rule = ruleHead(r.name, pHead);
    if (rule) { head[i] = rule; src[i] = 'rule'; continue; }
    if (TALLY[key]) { head[i] = TALLY[key]; src[i] = 'tally'; continue; }
    if (pHead) { head[i] = pHead; src[i] = 'group'; continue; }
  }
  return { head, src };
}

function headTotals(rows, map) {
  const { head, src } = assignHeads(rows, map);
  const close = {}, open = {};
  const unmapped = [];
  let sumClose = 0, sumOpen = 0;
  rows.forEach((r, i) => {
    if (!r.leaf) return;
    sumClose += r.close; sumOpen += r.open;
    const h = head[i];
    if (!h) { unmapped.push({ name: r.name, close: r.close, open: r.open }); return; }
    if (h === 'ignore') return;
    close[h] = round2((close[h] || 0) + r.close);
    open[h] = round2((open[h] || 0) + r.open);
  });
  return { close, open, unmapped, head, src, diffClose: round2(sumClose), diffOpen: round2(sumOpen) };
}

/* ── Statements ─────────────────────────────────────────────────────── */

const daysBetween = (from, to) => Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
const div0 = (a, b) => (Math.abs(b) < 0.005 ? null : a / b);

// t = { close:{head:net}, open:{head:net}, hasOpening, unmapped, diff… }
function statements(t, from, to) {
  const v = (h, which = 'close') => { const x = (t[which][h] || 0); return HEAD[h].side === 'cr' ? -x : x; };
  // Nominal accounts: the period's own movement when the opening is known.
  const pl = (h) => round2(v(h) - (t.hasOpening ? v(h, 'open') : 0));
  const bal = (h) => round2(v(h));
  const chg = (h) => round2(v(h) - v(h, 'open'));

  const revenue = pl('revenue') + pl('direct_income');
  // Stock-in-Hand's own opening is the stock on the period's first day; the
  // separate "Opening Stock" line Tally shows is the year's opening, used
  // only when the file has no opening column.
  const openingStock = t.hasOpening && t.open.stock != null ? v('stock', 'open') : (t.close.opening_stock != null ? v('opening_stock') : 0);
  const closingStock = bal('stock');
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

  const P = [
    ['h', 'Revenue'],
    ['revenue', 'Sales / Revenue', r2(pl('revenue'))],
    ['direct_income', 'Direct Income', r2(pl('direct_income'))],
    ['t', 'Revenue from Operations', r2(revenue)],
    ['h', 'Cost of Goods Sold'],
    ['opening_stock', 'Opening Stock', r2(openingStock)],
    ['purchases', 'Purchases', r2(pl('purchases'))],
    ['direct_exp', 'Direct Expenses', r2(pl('direct_exp'))],
    ['direct_wages', 'Wages / Labour (Direct)', r2(pl('direct_wages'))],
    ['stock', 'Less: Closing Stock', r2(-closingStock)],
    ['t', 'Cost of Goods Sold', r2(cogs)],
    ['T', 'Gross Profit', r2(gp)],
    ['pct', 'Gross Profit %', div0(gp * 100, revenue)],
    ['other_income', 'Other Income', r2(pl('other_income'))],
    ['interest_income', 'Interest Income', r2(pl('interest_income'))],
    ['employee_cost', 'Salary & Staff Cost', r2(pl('employee_cost'))],
    ['indirect_exp', 'Other Indirect Expenses', r2(pl('indirect_exp'))],
    ['T', 'EBITDA', r2(ebitda)],
    ['pct', 'EBITDA %', div0(ebitda * 100, revenue)],
    ['depreciation', 'Depreciation', r2(dep)],
    ['finance_cost', 'Interest & Finance Cost', r2(fin)],
    ['T', 'Profit Before Tax', r2(pbt)],
    ['tax', 'Income Tax', r2(tax)],
    ['T', 'Net Profit', r2(pat)],
    ['pct', 'Net Profit %', div0(pat * 100, revenue)],
  ];

  // Cash flow — indirect method. Needs opening balances.
  let C = null;
  if (t.hasOpening) {
    const wc = [
      ['debtors', '(Increase) / Decrease in Sundry Debtors', -chg('debtors')],
      ['stock', '(Increase) / Decrease in Stock', -chg('stock')],
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
    // Opening stock entered as its own Tally line is a P&L figure, not a
    // movement; branch / suspense / unmapped movements are shown as they are.
    const other = -(chg('branch') + chg('suspense')) - t.unmapped.reduce((a, u) => a + (u.close - u.open), 0);
    const openCash = v('cash', 'open') + v('bank', 'open');
    const closeCash = bal('cash') + bal('bank');
    const net = cfo + cfi + cff + other;
    const unrec = (closeCash - openCash) - net;
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
      ...(Math.abs(other) > 0.5 ? [['branch', 'Branch / Suspense / Unmapped Movements', r2(other)]] : []),
      ['T', 'Net Increase / (Decrease) in Cash (A+B+C)', r2(net)],
      ['', 'Opening Cash & Bank', r2(openCash)],
      ['T', 'Closing Cash & Bank', r2(openCash + net)],
      ...(Math.abs(unrec) > 0.5 ? [['warn', 'Not reconciled with the closing Cash & Bank by', r2(unrec)]] : []),
      ...(Math.abs(t.diffClose || 0) > 0.5 || Math.abs(t.diffOpen || 0) > 0.5
        ? [['warn', 'Trial Balance in the file does not tally (Dr − Cr, closing)', r2(t.diffClose || 0)]] : []),
    ];
  }

  // Ratios on closing balances.
  const ca = bal('stock') + bal('debtors') + bal('cash') + bal('bank') + bal('loans_adv') + bal('other_ca');
  const cl = bal('creditors') + bal('duties_taxes') + bal('provisions') + bal('other_cl') + bal('bank_od');
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
    ['d', 'Debtor Days', div0(bal('debtors') * days, revenue)],
    ['d', 'Creditor Days', div0(bal('creditors') * days, purchases)],
    ['d', 'Inventory Days', div0(closingStock * days, cogs)],
    ['', 'Working Capital', r2(ca - cl)],
    ['', 'Total Borrowings', r2(debt)],
    ['', 'Net Worth', r2(equity)],
  ].map(([k, l, x]) => [k, l, x == null ? null : Math.round(x * 100) / 100]);

  return { P, C, R, days };
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
  function previewOf(tb, map, extra = {}) {
    const merged = { ...map, ...extra };
    const t = headTotals(tb.rows, merged);
    return {
      company: tb.company, period: tb.period, hasOpening: tb.hasOpening, grand: tb.grand,
      rows: tb.rows.map((r, i) => ({ name: r.name, close: r.close, open: r.open, leaf: r.leaf, depth: depth(tb.rows, i), head: t.head[i], src: t.src[i] })),
      unmapped: t.unmapped, diffClose: t.diffClose, diffOpen: t.diffOpen,
    };
  }
  const depth = (rows, i) => { let d = 0; let p = rows[i].parent; while (p >= 0 && d < 20) { d++; p = rows[p].parent; } return d; };

  app.get('/api/mis-finance/data', requireAuth, route(async () => {
    const ups = await q('SELECT id, division, period_from, period_to, file_name, company, has_opening, closing_stock, uploaded_by, created_at FROM mis_tb_uploads ORDER BY period_to DESC, division');
    return {
      divisions: await divisions(),
      heads: HEADS.map(({ key, label, pl }) => ({ key, label, pl: !!pl })),
      uploads: ups.map((u) => ({ id: u.id, division: u.division, from: dOut(u.period_from), to: dOut(u.period_to), file_name: u.file_name, company: u.company,
        has_opening: !!Number(u.has_opening), closing_stock: u.closing_stock == null ? null : Number(u.closing_stock), uploaded_by: u.uploaded_by, at: u.created_at instanceof Date ? u.created_at.toISOString() : u.created_at })),
    };
  }));

  app.post('/api/mis-finance/preview', requireAuth, route(async (req) => {
    const tb = parse(req.body?.sheet);
    return previewOf(tb, await mapping(), cleanMap(req.body?.mappings));
  }));

  function cleanMap(m) {
    const out = {};
    if (!m || typeof m !== 'object') return out;
    for (const [k, h] of Object.entries(m)) { const key = norm(k); if (key && HEAD[h]) out[key] = h; }
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
    let closingStock = null;
    if (b.closing_stock !== '' && b.closing_stock != null) {
      closingStock = Number(String(b.closing_stock).replace(/[,₹\s]/g, ''));
      if (!Number.isFinite(closingStock) || closingStock < 0) bad('Closing stock must be a positive number');
    }
    const extra = cleanMap(b.mappings);
    if (Object.keys(extra).length) await writeCfg(CFG.map, { ...(await mapping()), ...extra });
    const rowsJson = JSON.stringify(tb.rows.map(({ name, close, open, parent, leaf }) => ({ name, close, open, parent, leaf })));
    const by = req.session.user.name || req.session.user.email || '';
    const fileName = String(b.file_name || '').slice(0, 255);
    await q(`INSERT INTO mis_tb_uploads (division, period_from, period_to, file_name, company, has_opening, closing_stock, rows_json, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (division, period_from, period_to) DO UPDATE SET file_name=$10, company=$11, has_opening=$12, closing_stock=$13, rows_json=$14, uploaded_by=$15, created_at=NOW()`,
      [division, from, to, fileName, tb.company, tb.hasOpening ? 1 : 0, closingStock, rowsJson, by,
        fileName, tb.company, tb.hasOpening ? 1 : 0, closingStock, rowsJson, by]);
    return { ok: true };
  }));

  app.delete('/api/mis-finance/uploads/:id', requireAuth, route(async (req) => {
    await q('DELETE FROM mis_tb_uploads WHERE id = $1', [Number(req.params.id)]);
    return { ok: true };
  }));

  const prevDay = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

  // One upload as head totals; an upload without opening balances borrows
  // them from the same division's upload that ends the day before.
  async function totalsFor(u, map, all) {
    const rows = JSON.parse(u.rows_json || '[]');
    const t = headTotals(rows, map);
    // Typed on the upload when the Trial Balance shows stock at its opening value.
    if (u.closing_stock != null) t.close.stock = round2(Number(u.closing_stock));
    t.hasOpening = !!Number(u.has_opening);
    t.openingFrom = t.hasOpening ? 'file' : '';
    if (!t.hasOpening) {
      const prev = all.find((x) => x.division === u.division && dOut(x.period_to) === prevDay(dOut(u.period_from)));
      if (prev) {
        const p = headTotals(JSON.parse(prev.rows_json || '[]'), map);
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
    return t;
  }
  function addTotals(list) {
    const sum = { close: {}, open: {}, unmapped: [], hasOpening: list.every((t) => t.hasOpening), diffClose: 0, diffOpen: 0 };
    for (const t of list) {
      for (const w of ['close', 'open']) for (const [k, x] of Object.entries(t[w])) sum[w][k] = round2((sum[w][k] || 0) + x);
      sum.unmapped.push(...t.unmapped);
      sum.diffClose = round2(sum.diffClose + t.diffClose);
      sum.diffOpen = round2(sum.diffOpen + t.diffOpen);
    }
    return sum;
  }

  app.get('/api/mis-finance/report', requireAuth, route(async (req) => {
    const from = String(req.query.from || ''), to = String(req.query.to || '');
    if (!ISO.test(from) || !ISO.test(to)) bad('Choose the period');
    const map = await mapping();
    const all = await q('SELECT * FROM mis_tb_uploads');
    const divs = await divisions();
    const cols = [];
    const totals = [];
    for (const d of divs) {
      const u = all.find((x) => x.division === d && dOut(x.period_from) === from && dOut(x.period_to) === to);
      if (!u) { cols.push({ division: d, missing: true }); continue; }
      const t = await totalsFor(u, map, all);
      totals.push(t);
      cols.push({ division: d, file_name: u.file_name, company: u.company, openingFrom: t.openingFrom, diffClose: t.diffClose, diffOpen: t.diffOpen,
        unmapped: t.unmapped.length, ...statements(t, from, to) });
    }
    if (!totals.length) bad('Nothing is uploaded for this period yet');
    const consolidated = totals.length > 1 ? { division: 'Consolidated', ...statements(addTotals(totals), from, to) } : null;
    return { from, to, days: daysBetween(from, to), columns: cols, consolidated };
  }));

  // Every ledger / group name seen in the uploads, with its current head.
  app.get('/api/mis-finance/mapping', requireAuth, route(async () => {
    const map = await mapping();
    const all = await q('SELECT division, rows_json FROM mis_tb_uploads');
    const seen = new Map();
    for (const u of all) {
      const rows = JSON.parse(u.rows_json || '[]');
      const { head, src } = assignHeads(rows, map);
      rows.forEach((r, i) => {
        const k = norm(r.name);
        if (!seen.has(k)) seen.set(k, { name: r.name, head: head[i], src: src[i], leaf: r.leaf, divisions: new Set() });
        seen.get(k).divisions.add(u.division);
      });
    }
    return { names: [...seen.values()].map((x) => ({ ...x, divisions: [...x.divisions] })).sort((a, b) => a.name.localeCompare(b.name)) };
  }));

  app.post('/api/mis-finance/mapping', requireAuth, route(async (req) => {
    const b = req.body || {};
    const cur = await mapping();
    for (const [k, h] of Object.entries(b.set || {})) {
      const key = norm(k);
      if (!key) continue;
      if (h === '' || h == null) delete cur[key];
      else if (HEAD[h]) cur[key] = h;
    }
    await writeCfg(CFG.map, cur);
    return { ok: true };
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

module.exports = { MF_SCHEMA, mountMisFinance, parseTrialBalance, headTotals, statements, HEADS };
