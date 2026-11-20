'use strict';
/* =====================================================================
   Retail Daily Sales (route 'retail-sales', Retail section)
   ---------------------------------------------------------------------
   Replaces two Google Sheets the shops kept by hand (Nov 2026):

   1. "Retail Shop Daily Report (As Per Tally)" — one tab per branch
      (SATELITE, BOPAL), a row per day: sales as per Tally; credit card and
      Paytm/UPI sales vs the amount that reached the bank (the gap is the
      bank charge); cash sales, cash received from H.O. / parties, sales
      return, cash expense, cash deposited in bank and the running physical
      cash balance; credit sales (party, amount, amount received) with a
      running balance.
   (The other daily sheet, "Retail shop Daily report", is its own system
   with its own users — backend/retail-shop-report.js. The purchase
   columns of retail_daily are left over from when the two were one page
   and are no longer entered.)

   Here the day is entered once per branch and the register is drawn from
   it. Totals, the running cash and credit balances, month-to-date
   and financial-year (from 1 April) cumulatives are worked out, never
   typed. The two sheets can be imported once (Settings) to carry the year
   so far over.

   Tables: retail_daily (branch + day) and retail_credit (credit lines of
   a day). Opening cash / credit per branch: app_config
   retail_sales_opening = { branch: { date, cash, credit } } — the balance
   at the END of `date`; running balances start the day after.

   Access: the 'retail-sales' page only (its own users); Admin/HOD always
   unless their Access list leaves it out. Opening balances, import and deleting a day:
   Admin/HOD.
   ===================================================================== */

const RS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS retail_daily (
     branch VARCHAR(100) NOT NULL,
     day DATE NOT NULL,
     tally_sales DECIMAL(15,2) DEFAULT NULL,
     card_sales DECIMAL(15,2) NOT NULL DEFAULT 0,
     card_received DECIMAL(15,2) NOT NULL DEFAULT 0,
     upi_sales DECIMAL(15,2) NOT NULL DEFAULT 0,
     upi_received DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_sales DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_received DECIMAL(15,2) NOT NULL DEFAULT 0,
     sales_return DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_expense DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_deposit DECIMAL(15,2) NOT NULL DEFAULT 0,
     purchases DECIMAL(15,2) NOT NULL DEFAULT 0,
     purchase_return DECIMAL(15,2) NOT NULL DEFAULT 0,
     note TEXT,
     source VARCHAR(8) NOT NULL DEFAULT 'erp',
     updated_by VARCHAR(255) DEFAULT '',
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (branch, day)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS retail_credit (
     id INT AUTO_INCREMENT PRIMARY KEY,
     branch VARCHAR(100) NOT NULL,
     day DATE NOT NULL,
     party VARCHAR(255) NOT NULL DEFAULT '',
     sale DECIMAL(15,2) NOT NULL DEFAULT 0,
     received DECIMAL(15,2) NOT NULL DEFAULT 0,
     note VARCHAR(255) DEFAULT '',
     source VARCHAR(8) NOT NULL DEFAULT 'erp'
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_retail_credit_day ON retail_credit (branch, day)`,
];

// The fields a shop types for a day (all ₹).
const FIELDS = ['tally_sales', 'card_sales', 'card_received', 'upi_sales', 'upi_received', 'cash_sales', 'cash_received',
  'sales_return', 'cash_expense', 'cash_deposit', 'purchases', 'purchase_return'];

// The two Google Sheets this replaces (for the one-time import).
const TALLY_SHEET = '1RFFJtgQ6h_tpfRFQWBuI37F71ifV6gYzyVcnZ46Ubn4';   // per-branch tabs, a row per day
const DAILY_SHEET = '1K1V50dab-YYtkDB5Vs9CgmqWAL70FQOhicjldzNhKl4';   // Satellite, a month per tab
const OPENING_KEY = 'retail_sales_opening';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dOut = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v || '').slice(0, 10));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Financial year start (1 April) for a date.
const fyStart = (iso) => { const [y, m] = iso.split('-').map(Number); return `${m >= 4 ? y : y - 1}-04-01`; };
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function num(v) {
  if (v === '' || v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? round2(n) : 0;
}

class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const bad = (m) => { throw new UserError(m); };

/* ── One branch's days → the computed figures ──────────────────────────
   rows: retail_daily rows (any order), credit: retail_credit rows, opening:
   { date, cash, credit } or null. Returns a Map day → computed day. */
function computeDays(rows, credit, opening) {
  const byDay = new Map();
  for (const r of rows) byDay.set(dOut(r.day), r);
  const lines = new Map();
  for (const c of credit) {
    const k = dOut(c.day);
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push({ id: c.id, party: c.party || '', sale: num(c.sale), received: num(c.received), note: c.note || '' });
  }
  const days = [...new Set([...byDay.keys(), ...lines.keys()])].sort();
  const from = opening?.date || null;
  let cash = opening ? num(opening.cash) : 0;
  let cred = opening ? num(opening.credit) : 0;
  let fy = null, ym = null;
  let mtdSales = 0, fySales = 0, mtdPur = 0, fyPur = 0;
  const out = new Map();
  for (const d of days) {
    if (from && d <= from) continue;   // already inside the opening balance
    const r = byDay.get(d) || {};
    const f = Object.fromEntries(FIELDS.map((k) => [k, k === 'tally_sales' ? (r.tally_sales == null ? null : num(r.tally_sales)) : num(r[k])]));
    const cl = lines.get(d) || [];
    const creditSales = round2(cl.reduce((a, x) => a + x.sale, 0));
    const creditRecd = round2(cl.reduce((a, x) => a + x.received, 0));
    if (fyStart(d) !== fy) { fy = fyStart(d); fySales = 0; fyPur = 0; }
    if (d.slice(0, 7) !== ym) { ym = d.slice(0, 7); mtdSales = 0; mtdPur = 0; }
    const totalSales = round2(f.cash_sales + f.card_sales + f.upi_sales + creditSales - f.sales_return);
    const netPur = round2(f.purchases - f.purchase_return);
    mtdSales = round2(mtdSales + totalSales); fySales = round2(fySales + totalSales);
    mtdPur = round2(mtdPur + netPur); fyPur = round2(fyPur + netPur);
    const cashOpen = cash;
    cash = round2(cash + f.cash_sales + f.cash_received - f.sales_return - f.cash_expense - f.cash_deposit);
    const credOpen = cred;
    cred = round2(cred + creditSales - creditRecd);
    out.set(d, {
      day: d, entered: byDay.has(d), source: r.source || '', note: r.note || '', updated_by: r.updated_by || '',
      ...f, credit: cl, credit_sales: creditSales, credit_received: creditRecd,
      card_charge: round2(f.card_sales - f.card_received), upi_charge: round2(f.upi_sales - f.upi_received),
      card_upi_credit: round2(f.card_sales + f.upi_sales + creditSales),
      total_sales: totalSales, mtd_sales: mtdSales, fy_sales: fySales,
      net_purchases: netPur, mtd_purchases: mtdPur, fy_purchases: fyPur,
      cash_open: cashOpen, cash_close: cash, credit_open: credOpen, credit_close: cred,
    });
  }
  return { out, lastCash: cash, lastCredit: cred };
}

/* ── Import parsers (pure, so they can be tested on a saved copy) ──── */

// Tally sheet tab rows (UNFORMATTED_VALUE) → { opening, days: [{ day, fields, credit }] }
function parseTallyTab(rows) {
  const opening = num(rows[2]?.[16]);
  const days = [];
  for (const r of rows.slice(3)) {
    const a = r[0];
    if (typeof a !== 'number' || a < 40000) continue;
    const has = (i) => r[i] !== '' && r[i] != null;
    const any = [1, 3, 4, 7, 8, 11, 12, 13, 14, 15, 19, 20].some(has);
    if (!any) continue;
    const day = serialToIso(a);
    const fields = {
      tally_sales: has(1) ? num(r[1]) : null,
      card_sales: num(r[3]), card_received: num(r[4]),
      upi_sales: num(r[7]), upi_received: num(r[8]),
      cash_sales: num(r[11]), cash_received: num(r[12]), sales_return: num(r[13]), cash_expense: num(r[14]), cash_deposit: num(r[15]),
    };
    const credit = (has(19) || has(20)) ? [{ party: String(r[18] ?? '').trim().slice(0, 255), sale: num(r[19]), received: num(r[20]) }] : [];
    days.push({ day, fields, credit });
  }
  return { opening, days };
}

// "Retail shop Daily report" month tabs → Map day → { purchases, purchase_return }
function parseDailyTabs(tabs) {
  const out = new Map();
  const asDate = (v) => {
    if (typeof v === 'number') return v > 40000 && v < 60000 ? serialToIso(v) : null;
    const m = /^(\d{1,2})-([a-z]{3})[a-z]*-(\d{4})$/i.exec(String(v || '').trim());
    if (!m || !MON[m[2].toLowerCase()]) return null;
    return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  };
  for (const rows of Object.values(tabs)) {
    let cols = null;      // index → iso date for the current block
    let afterPurchases = false;
    for (const r of rows) {
      const dates = (r || []).map((v, i) => (i === 0 ? null : asDate(v)));
      // A date header: no label, at least one date, and no ordinary figure
      // (0 … 40000 or above the date range) — a row of zeros is not a header.
      const isHeader = !String(r?.[0] ?? '').trim() && dates.some(Boolean)
        && !(r || []).slice(1).some((v) => typeof v === 'number' && ((v >= 0 && v <= 40000) || v >= 60000));
      if (isHeader) {
        // A mistyped date between good ones (the sheet has a few) is the day
        // after the one before it.
        for (let i = 1; i < dates.length; i++) {
          if (dates[i - 1] && typeof r[i] === 'number' && (!dates[i] || dates[i] <= dates[i - 1])) dates[i] = addDays(dates[i - 1], 1);
        }
        cols = dates; afterPurchases = false; continue;
      }
      if (!cols) continue;
      const label = String(r[0] ?? '').trim().toLowerCase();
      let key = null;
      if (label === 'purchases') { key = 'purchases'; afterPurchases = true; }
      else if (label === '(-) returns' && afterPurchases) { key = 'purchase_return'; afterPurchases = false; }
      if (!key) continue;
      cols.forEach((d, i) => {
        if (!d) return;
        const v = r[i];
        if (typeof v !== 'number') return;
        const cur = out.get(d) || { purchases: 0, purchase_return: 0 };
        cur[key] = round2(v);
        out.set(d, cur);
      });
    }
  }
  return out;
}

/* ===================================================================== */

function mountRetailSales(app, ctx) {
  const { q, pool, ensureSchema, requireAuth, useDb, canOpen, isAdmin, branches, getGoogleAuth } = ctx;

  async function readOpening() {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [OPENING_KEY]);
      if (rows.length) { const v = JSON.parse(rows[0].value); if (v && typeof v === 'object') return v; }
    } catch (e) { if (!(e instanceof SyntaxError)) console.error('[retail-sales] opening', e.message); }
    return {};
  }
  async function writeOpening(v) {
    const json = JSON.stringify(v);
    await q(`INSERT INTO app_config ("key","value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value"=$3`, [OPENING_KEY, json, json]);
  }

  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'Daily Sales needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        if (!(await canOpen(user))) return res.status(403).json({ error: 'You do not have access to Retail Daily Sales' });
        const admin = await isAdmin(user);
        if (need === 'admin' && !admin) return res.status(403).json({ error: 'Only an Admin / HOD can do this' });
        req.rs = { user, admin, by: user.name || user.email || '' };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[retail-sales]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }

  async function branchIn(v) {
    const list = await branches();
    const b = list.find((x) => x.toLowerCase() === String(v || '').trim().toLowerCase());
    if (!b) bad('Choose the branch');
    return b;
  }

  // Everything for a branch up to `to` (inclusive), computed.
  async function branchDays(branch, to) {
    const [rows, credit, opening] = await Promise.all([
      q('SELECT * FROM retail_daily WHERE branch = $1 AND day <= $2 ORDER BY day', [branch, to]),
      q('SELECT * FROM retail_credit WHERE branch = $1 AND day <= $2 ORDER BY day, id', [branch, to]),
      readOpening(),
    ]);
    return { ...computeDays(rows, credit, opening[branch] || null), opening: opening[branch] || null };
  }

  app.get('/api/retail-sales/meta', requireAuth, route(null, async (req) => {
    const list = await branches();
    const opening = await readOpening();
    const last = await q('SELECT branch, MAX(day) AS last FROM retail_daily GROUP BY branch');
    return {
      branches: list, admin: req.rs.admin, opening,
      lastDay: Object.fromEntries(last.map((r) => [r.branch, dOut(r.last)])),
      sheets: { tally: TALLY_SHEET, daily: DAILY_SHEET },
    };
  }));

  // A month, every day of it (blank days too) — both report layouts use this.
  app.get('/api/retail-sales/month', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.query.branch);
    const ym = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(ym)) bad('Choose the month');
    const end = monthEnd(ym);
    const { out, opening } = await branchDays(branch, end);
    // Balances carried into the month = those after the last entered day before it.
    const before = [...out.values()].filter((d) => d.day < `${ym}-01`);
    const prev = before[before.length - 1];
    let carryCash = prev ? prev.cash_close : (opening ? num(opening.cash) : 0);
    let carryCredit = prev ? prev.credit_close : (opening ? num(opening.credit) : 0);
    let mtdS = 0, mtdP = 0;
    let fyS = prev && fyStart(prev.day) === fyStart(`${ym}-01`) ? prev.fy_sales : 0;
    let fyP = prev && fyStart(prev.day) === fyStart(`${ym}-01`) ? prev.fy_purchases : 0;
    const days = [];
    for (let d = `${ym}-01`; d <= end; d = addDays(d, 1)) {
      const x = out.get(d);
      if (x) {
        days.push(x);
        carryCash = x.cash_close; carryCredit = x.credit_close; mtdS = x.mtd_sales; mtdP = x.mtd_purchases; fyS = x.fy_sales; fyP = x.fy_purchases;
      } else {
        // A blank day still shows the balances it carries.
        days.push({ day: d, entered: false, credit: [], cash_open: carryCash, cash_close: carryCash, credit_open: carryCredit, credit_close: carryCredit,
          mtd_sales: mtdS, fy_sales: fyS, mtd_purchases: mtdP, fy_purchases: fyP });
      }
    }
    const sum = (k) => round2(days.reduce((a, x) => a + (x.entered || x.credit.length ? num(x[k]) : 0), 0));
    const totals = Object.fromEntries([...FIELDS, 'credit_sales', 'credit_received', 'card_charge', 'upi_charge', 'total_sales', 'net_purchases'].map((k) => [k, sum(k)]));
    return { branch, month: ym, opening, days, totals };
  }));

  // One day for the entry form, with the cash it opens with and the cash
  // expenses already logged on the Retail Dashboard for that day.
  app.get('/api/retail-sales/day', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.query.branch);
    const day = String(req.query.date || '');
    if (!ISO_RE.test(day)) bad('Choose the date');
    const { out, opening } = await branchDays(branch, day);
    const all = [...out.values()];
    const cur = out.get(day) || null;
    const prev = all.filter((d) => d.day < day).pop();
    let logged = 0;
    try {
      const r = await q(`SELECT COALESCE(SUM(amount),0) AS s FROM retail_expenses WHERE branch_name = $1 AND entry_date = $2 AND payment_type = 'Cash'`, [branch, day]);
      logged = num(r[0]?.s);
    } catch { /* the expense table may not exist yet */ }
    return {
      branch, day, entry: cur,
      cash_open: cur ? cur.cash_open : (prev ? prev.cash_close : (opening ? num(opening.cash) : 0)),
      credit_open: cur ? cur.credit_open : (prev ? prev.credit_close : (opening ? num(opening.credit) : 0)),
      before_opening: !!(opening && day <= opening.date),
      logged_cash_expense: logged,
      parties: (await q('SELECT party, COUNT(*) AS n FROM retail_credit WHERE branch = $1 AND party <> \'\' GROUP BY party ORDER BY n DESC LIMIT 200', [branch])).map((r) => r.party),
    };
  }));

  app.put('/api/retail-sales/day', requireAuth, route(null, async (req) => {
    const b = req.body || {};
    const branch = await branchIn(b.branch);
    const day = String(b.date || '');
    if (!ISO_RE.test(day)) bad('Choose the date');
    const istToday = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    if (day > istToday) bad('That date is in the future');
    const f = {};
    for (const k of FIELDS) {
      const v = b[k];
      if (k === 'tally_sales' && (v === '' || v == null)) { f[k] = null; continue; }
      const n = num(v);
      if (n < 0) bad('Amounts cannot be negative');
      f[k] = n;
    }
    const credit = (Array.isArray(b.credit) ? b.credit : []).slice(0, 50)
      .map((c) => ({ party: String(c?.party || '').trim().slice(0, 255), sale: num(c?.sale), received: num(c?.received), note: String(c?.note || '').trim().slice(0, 255) }))
      .filter((c) => c.party || c.sale || c.received);
    if (credit.some((c) => !c.party)) bad('Each credit line needs the party name');
    if (credit.some((c) => c.sale < 0 || c.received < 0)) bad('Amounts cannot be negative');
    const cols = FIELDS.join(', ');
    const ph = FIELDS.map((_, i) => `$${i + 3}`).join(',');
    const set = FIELDS.map((k, i) => `${k}=$${FIELDS.length + 7 + i}`).join(', ');
    const vals = FIELDS.map((k) => f[k]);
    const note = String(b.note || '').trim().slice(0, 2000);
    await q(`INSERT INTO retail_daily (branch, day, ${cols}, note, source, updated_by, updated_at)
             VALUES ($1,$2,${ph},$${FIELDS.length + 3},'erp',$${FIELDS.length + 4},NOW())
             ON CONFLICT (branch, day) DO UPDATE SET note=$${FIELDS.length + 5}, source='erp', updated_by=$${FIELDS.length + 6}, updated_at=NOW(), ${set}`,
      [branch, day, ...vals, note, req.rs.by, note, req.rs.by, ...vals]);
    await q('DELETE FROM retail_credit WHERE branch = $1 AND day = $2', [branch, day]);
    for (const c of credit) {
      await q('INSERT INTO retail_credit (branch, day, party, sale, received, note, source) VALUES ($1,$2,$3,$4,$5,$6,\'erp\')',
        [branch, day, c.party, c.sale, c.received, c.note]);
    }
    return { ok: true };
  }));

  app.delete('/api/retail-sales/day', requireAuth, route('admin', async (req) => {
    const branch = await branchIn(req.query.branch);
    const day = String(req.query.date || '');
    if (!ISO_RE.test(day)) bad('Choose the date');
    await q('DELETE FROM retail_credit WHERE branch = $1 AND day = $2', [branch, day]);
    await q('DELETE FROM retail_daily WHERE branch = $1 AND day = $2', [branch, day]);
    return { ok: true };
  }));

  // Credit parties for a branch: sold, received, balance — and the overall
  // running balance (which also carries the opening credit balance).
  app.get('/api/retail-sales/credit', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.query.branch);
    const rows = await q('SELECT * FROM retail_credit WHERE branch = $1 ORDER BY day, id', [branch]);
    const opening = (await readOpening())[branch] || null;
    const parties = new Map();
    for (const r of rows) {
      if (opening && dOut(r.day) <= opening.date) continue;
      const k = String(r.party || '').trim().toLowerCase();
      if (!parties.has(k)) parties.set(k, { party: r.party, sale: 0, received: 0, first: dOut(r.day), last: dOut(r.day), lines: [] });
      const p = parties.get(k);
      p.sale = round2(p.sale + num(r.sale)); p.received = round2(p.received + num(r.received)); p.last = dOut(r.day);
      p.lines.push({ day: dOut(r.day), sale: num(r.sale), received: num(r.received), note: r.note || '' });
    }
    const list = [...parties.values()].map((p) => ({ ...p, balance: round2(p.sale - p.received) })).sort((a, b) => b.balance - a.balance);
    const openingCredit = opening ? num(opening.credit) : 0;
    return { branch, openingCredit, parties: list, outstanding: round2(openingCredit + list.reduce((a, p) => a + p.balance, 0)) };
  }));

  app.post('/api/retail-sales/opening', requireAuth, route('admin', async (req) => {
    const b = req.body || {};
    const branch = await branchIn(b.branch);
    const all = await readOpening();
    if (b.clear) { delete all[branch]; await writeOpening(all); return { ok: true }; }
    const date = String(b.date || '');
    if (!ISO_RE.test(date)) bad('Enter the date the opening balance is for');
    all[branch] = { date, cash: num(b.cash), credit: num(b.credit) };
    await writeOpening(all);
    return { ok: true };
  }));

  /* ── One-time import of the two Google Sheets ──────────────────────
     The per-branch "As Per Tally" tabs give every day's figures and the
     opening cash; the Satellite month tabs add purchases. A day already
     saved from the ERP is left alone unless `overwrite` is ticked. */
  app.post('/api/retail-sales/import', requireAuth, route('admin', async (req) => {
    const auth = getGoogleAuth && getGoogleAuth();
    if (!auth) bad('Google Sheets is not configured on this server');
    const overwrite = !!req.body?.overwrite;
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const list = await branches();
    const findBranch = (tab) => {
      const t = tab.toLowerCase().replace(/[^a-z]/g, '');
      return list.find((b) => { const n = b.toLowerCase().replace(/[^a-z]/g, ''); return n === t || n.replace(/l+/g, 'l') === t.replace(/l+/g, 'l'); }) || null;
    };
    const getTabs = async (id) => {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,hidden)' });
      const titles = meta.data.sheets.filter((s) => !s.properties.hidden).map((s) => s.properties.title);
      const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'!A1:AD1000`), valueRenderOption: 'UNFORMATTED_VALUE' });
      return Object.fromEntries(r.data.valueRanges.map((v, i) => [titles[i], v.values || []]));
    };
    const tally = await getTabs(TALLY_SHEET);
    const report = { branches: {}, skipped: [] };
    const opening = await readOpening();
    const firstDay = {};
    for (const [tab, rows] of Object.entries(tally)) {
      const branch = findBranch(tab);
      if (!branch) { report.skipped.push(tab); continue; }
      const { opening: op, days } = parseTallyTab(rows);
      if (!days.length) continue;
      firstDay[branch] = days[0].day;
      if (!opening[branch]) opening[branch] = { date: addDays(days[0].day, -1), cash: op, credit: 0 };
      const existing = new Set((await q(`SELECT day FROM retail_daily WHERE branch = $1 AND source = 'erp'`, [branch])).map((r) => dOut(r.day)));
      let n = 0, kept = 0;
      for (const d of days) {
        if (existing.has(d.day) && !overwrite) { kept++; continue; }
        await upsertImported(branch, d.day, d.fields);
        await q('DELETE FROM retail_credit WHERE branch = $1 AND day = $2', [branch, d.day]);
        for (const c of d.credit) {
          await q(`INSERT INTO retail_credit (branch, day, party, sale, received, source) VALUES ($1,$2,$3,$4,$5,'sheet')`, [branch, d.day, c.party, c.sale, c.received]);
        }
        n++;
      }
      report.branches[branch] = { days: n, keptErp: kept, from: days[0].day, to: days[days.length - 1].day, openingCash: opening[branch].cash };
    }
    await writeOpening(opening);

    return report;
  }));

  async function upsertImported(branch, day, f) {
    const keys = Object.keys(f);
    const vals = keys.map((k) => f[k]);
    const ph = keys.map((_, i) => `$${i + 3}`).join(',');
    const set = keys.map((k, i) => `${k}=$${keys.length + 3 + i}`).join(', ');
    await q(`INSERT INTO retail_daily (branch, day, ${keys.join(', ')}, source, updated_by, updated_at) VALUES ($1,$2,${ph},'sheet','Import',NOW())
             ON CONFLICT (branch, day) DO UPDATE SET ${set}, source='sheet', updated_by='Import', updated_at=NOW()`, [branch, day, ...vals, ...vals]);
  }

  /* Udhaar settled (Shravan, 20 Nov 2026): a party pays back a credit sale
     from an earlier day. Saved as a "money came back" line on the day it
     came, so that day's register and the running balance show it; the
     Daily Entry form for that day carries it along like any other line. */
  app.post('/api/retail-sales/credit/settle', requireAuth, route(null, async (req) => {
    const b = req.body || {};
    const branch = await branchIn(b.branch);
    const day = String(b.date || '');
    if (!ISO_RE.test(day)) bad('Choose the date the money came');
    const istToday = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    if (day > istToday) bad('That date is in the future');
    const party = String(b.party || '').trim().slice(0, 255) || bad('Write the party name');
    const amount = num(b.amount);
    if (!(amount > 0)) bad('Write the amount received');
    const opening = (await readOpening())[branch];
    if (opening && day <= opening.date) bad(`That date is inside the opening balance (${opening.date}) — pick a later date`);
    const note = String(b.note || '').trim().slice(0, 240);
    await q('INSERT INTO retail_credit (branch, day, party, sale, received, note, source) VALUES ($1,$2,$3,0,$4,$5,\'erp\')',
      [branch, day, party, amount, note ? `Settled: ${note}` : 'Settled']);
    return { ok: true };
  }));

  /* For the CEO Dashboard: this month's and this financial year's sales per
     branch (cash + card + UPI + credit − returns, as the register totals it),
     and the last day entered. */
  async function summary() {
    if (!useDb) return [];
    await ensureSchema();
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const out = [];
    for (const branch of await branches()) {
      const { out: days } = await branchDays(branch, today);
      const list = [...days.values()];
      const last = list[list.length - 1];
      const inMonth = last && last.day.slice(0, 7) === today.slice(0, 7);
      const inFy = last && fyStart(last.day) === fyStart(today);
      const credit = list.length ? last.credit_close : 0;
      out.push({ branch, lastDay: last ? last.day : null, mtd: inMonth ? last.mtd_sales : 0, fy: inFy ? last.fy_sales : 0,
        today: last && last.day === today ? last.total_sales : null, creditOutstanding: credit, cash: last ? last.cash_close : null });
    }
    return out;
  }

  void pool;
  return { summary };
}

module.exports = { RS_SCHEMA, mountRetailSales, computeDays, parseTallyTab, parseDailyTabs };
