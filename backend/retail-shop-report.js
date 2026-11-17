'use strict';
/* =====================================================================
   Retail Shop Daily Report (route 'retail-shop-report', Retail section)
   ---------------------------------------------------------------------
   Replaces the "Retail shop Daily report" Google Sheet — a month per tab,
   the days across, kept by the shop:

     Cash Sales · (−) Returns · (+) Cr.Card Sales & Cr.Sales · Total Sales
     · from 1st of the month · Cumulative Sales (from 1 April)
     Purchases · (−) Returns · Net Purchases · MTD · Cumulative Purchases
     Cash Balance: Op. balance · (+) Cash Sales · (−) Cash Deposit in bank
     · (+) Cash recd from H.O. & Party Payment · (−) Cash expense · Closing

   A separate system from the "As per Tally" report (retail-sales.js), kept
   by different people: its own page key, table and opening balance.

   The cash block runs on its own (closing = op + cash sales − deposit +
   received − expense, exactly the sheet's arithmetic); a day may carry an
   Op. balance override where the shop adjusted the cash by hand — the
   sheet did that, and the import keeps those adjustments.

   Table retail_shop_daily (branch + day). Opening: app_config
   retail_shop_opening = { branch: { date, cash } } — cash at the END of
   `date`. Access: the 'retail-shop-report' page (Admin/HOD always unless
   their Access list leaves it out); opening, import, delete: Admin/HOD.
   ===================================================================== */

const RSR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS retail_shop_daily (
     branch VARCHAR(100) NOT NULL,
     day DATE NOT NULL,
     cash_sales DECIMAL(15,2) NOT NULL DEFAULT 0,
     sales_return DECIMAL(15,2) NOT NULL DEFAULT 0,
     card_credit_sales DECIMAL(15,2) NOT NULL DEFAULT 0,
     purchases DECIMAL(15,2) NOT NULL DEFAULT 0,
     purchase_return DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_deposit DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_received DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_expense DECIMAL(15,2) NOT NULL DEFAULT 0,
     cash_open_override DECIMAL(15,2) DEFAULT NULL,
     note TEXT,
     source VARCHAR(8) NOT NULL DEFAULT 'erp',
     updated_by VARCHAR(255) DEFAULT '',
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (branch, day)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const FIELDS = ['cash_sales', 'sales_return', 'card_credit_sales', 'purchases', 'purchase_return', 'cash_deposit', 'cash_received', 'cash_expense'];
const SHEET_ID = '1K1V50dab-YYtkDB5Vs9CgmqWAL70FQOhicjldzNhKl4';
const OPENING_KEY = 'retail_shop_opening';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { if (v === '' || v == null) return 0; const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, '')); return Number.isFinite(n) ? round2(n) : 0; };
const dOut = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v || '').slice(0, 10));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fyStart = (iso) => { const [y, m] = iso.split('-').map(Number); return `${m >= 4 ? y : y - 1}-04-01`; };
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const bad = (m) => { throw new UserError(m); };

/* rows → Map day → computed day (running cash, MTD, FY cumulative). */
function computeDays(rows, opening) {
  const list = rows.map((r) => ({ ...r, day: dOut(r.day) })).sort((a, b) => a.day.localeCompare(b.day));
  const from = opening?.date || null;
  let cash = opening ? num(opening.cash) : 0;
  let fy = null, ym = null, mtdS = 0, fyS = 0, mtdP = 0, fyP = 0;
  const out = new Map();
  for (const r of list) {
    if (from && r.day <= from) continue;
    const f = Object.fromEntries(FIELDS.map((k) => [k, num(r[k])]));
    if (fyStart(r.day) !== fy) { fy = fyStart(r.day); fyS = 0; fyP = 0; }
    if (r.day.slice(0, 7) !== ym) { ym = r.day.slice(0, 7); mtdS = 0; mtdP = 0; }
    const total = round2(f.cash_sales - f.sales_return + f.card_credit_sales);
    const netP = round2(f.purchases - f.purchase_return);
    mtdS = round2(mtdS + total); fyS = round2(fyS + total); mtdP = round2(mtdP + netP); fyP = round2(fyP + netP);
    const carried = cash;
    const open = r.cash_open_override == null ? carried : num(r.cash_open_override);
    cash = round2(open + f.cash_sales - f.cash_deposit + f.cash_received - f.cash_expense);
    out.set(r.day, {
      day: r.day, entered: true, source: r.source || '', note: r.note || '', updated_by: r.updated_by || '', ...f,
      total_sales: total, mtd_sales: mtdS, fy_sales: fyS, net_purchases: netP, mtd_purchases: mtdP, fy_purchases: fyP,
      cash_carried: carried, cash_open_override: r.cash_open_override == null ? null : num(r.cash_open_override), cash_open: open, cash_close: cash,
    });
  }
  return out;
}

/* The sheet's month tabs → [{ day, fields, op, close }] sorted by day.
   A block starts at a header row of dates (first cell blank or a date);
   rows below are read by their label until the next header. */
function parseShopSheet(tabs) {
  const byDay = new Map();
  const asDate = (v) => {
    if (typeof v === 'number') return v > 40000 && v < 60000 ? serialToIso(v) : null;
    const m = /^(\d{1,2})-([a-z]{3})[a-z]*-(\d{4})$/i.exec(String(v || '').trim());
    if (!m || !MON[m[2].toLowerCase()]) return null;
    return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  };
  const LABELS = [
    ['cash sales', 'cash_sales'], ['(+) cr.card', 'card_credit_sales'], ['purchases', 'purchases'],
    ['(-) cash deposit', 'cash_deposit'], ['(+) cash recd', 'cash_received'], ['(-) cash exp', 'cash_expense'],
    ['op. balance', 'op'], ['closing balance', 'close'],
  ];
  for (const rows of Object.values(tabs)) {
    let cols = null, afterPurchases = false, purchasesEmpty = false;
    for (const r of rows) {
      const cells = r || [];
      const lead = cells[0];
      const leadIsDate = typeof lead === 'number' && !!asDate(lead);
      const dates = cells.map((v, i) => (i === 0 ? null : asDate(v)));
      const isHeader = (!String(lead ?? '').trim() || leadIsDate) && dates.some(Boolean)
        && !cells.slice(1).some((v) => typeof v === 'number' && ((v >= 0 && v <= 40000) || v >= 60000));
      if (isHeader) {
        for (let i = 1; i < dates.length; i++) {
          if (dates[i - 1] && typeof cells[i] === 'number' && (!dates[i] || dates[i] <= dates[i - 1])) dates[i] = addDays(dates[i - 1], 1);
        }
        cols = dates; afterPurchases = false; purchasesEmpty = false;
        continue;
      }
      if (!cols) continue;
      const label = String(lead ?? '').trim().toLowerCase();
      let key = null;
      if (label === '(-) returns') {
        // The returns row after Purchases is purchase returns — unless the
        // Purchases row was left empty and the figures went in here (the
        // sheet's own cumulative counts them as purchases then).
        key = afterPurchases ? (purchasesEmpty ? 'purchases' : 'purchase_return') : 'sales_return';
        afterPurchases = false;
      } else {
        const hit = LABELS.find(([p]) => label.startsWith(p));
        if (hit) key = hit[1];
        if (key === 'purchases') { afterPurchases = true; purchasesEmpty = !cells.slice(1).some((v) => typeof v === 'number'); }
      }
      if (!key) continue;
      cols.forEach((d, i) => {
        if (!d || typeof cells[i] !== 'number') return;
        const cur = byDay.get(d) || { day: d, fields: {} };
        if (key === 'op' || key === 'close') cur[key] = round2(cells[i]);
        else cur.fields[key] = round2(cells[i]);
        byDay.set(d, cur);
      });
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/* ===================================================================== */

function mountRetailShopReport(app, ctx) {
  const { q, ensureSchema, requireAuth, useDb, canOpen, isAdmin, branches, getGoogleAuth } = ctx;

  async function readOpening() {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [OPENING_KEY]);
      if (rows.length) { const v = JSON.parse(rows[0].value); if (v && typeof v === 'object') return v; }
    } catch (e) { if (!(e instanceof SyntaxError)) console.error('[retail-shop] opening', e.message); }
    return {};
  }
  async function writeOpening(v) {
    const json = JSON.stringify(v);
    await q(`INSERT INTO app_config ("key","value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value"=$3`, [OPENING_KEY, json, json]);
  }

  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'Shop Daily Report needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        if (!(await canOpen(user))) return res.status(403).json({ error: 'You do not have access to the Shop Daily Report' });
        const admin = await isAdmin(user);
        if (need === 'admin' && !admin) return res.status(403).json({ error: 'Only an Admin / HOD can do this' });
        req.rsr = { user, admin, by: user.name || user.email || '' };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[retail-shop]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  async function branchIn(v) {
    const b = (await branches()).find((x) => x.toLowerCase() === String(v || '').trim().toLowerCase());
    if (!b) bad('Choose the branch');
    return b;
  }
  async function branchDays(branch, to) {
    const [rows, opening] = await Promise.all([q('SELECT * FROM retail_shop_daily WHERE branch = $1 AND day <= $2 ORDER BY day', [branch, to]), readOpening()]);
    return { out: computeDays(rows, opening[branch] || null), opening: opening[branch] || null };
  }

  app.get('/api/retail-shop-report/meta', requireAuth, route(null, async (req) => {
    const last = await q('SELECT branch, MAX(day) AS last FROM retail_shop_daily GROUP BY branch');
    return { branches: await branches(), admin: req.rsr.admin, opening: await readOpening(),
      lastDay: Object.fromEntries(last.map((r) => [r.branch, dOut(r.last)])), sheet: SHEET_ID };
  }));

  app.get('/api/retail-shop-report/month', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.query.branch);
    const ym = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(ym)) bad('Choose the month');
    const end = monthEnd(ym);
    const { out, opening } = await branchDays(branch, end);
    const prev = [...out.values()].filter((d) => d.day < `${ym}-01`).pop();
    let cash = prev ? prev.cash_close : (opening ? num(opening.cash) : 0);
    const sameFy = prev && fyStart(prev.day) === fyStart(`${ym}-01`);
    let mtdS = 0, mtdP = 0, fyS = sameFy ? prev.fy_sales : 0, fyP = sameFy ? prev.fy_purchases : 0;
    const days = [];
    for (let d = `${ym}-01`; d <= end; d = addDays(d, 1)) {
      const x = out.get(d);
      if (x) { days.push(x); cash = x.cash_close; mtdS = x.mtd_sales; mtdP = x.mtd_purchases; fyS = x.fy_sales; fyP = x.fy_purchases; }
      else days.push({ day: d, entered: false, cash_open: cash, cash_close: cash, mtd_sales: mtdS, fy_sales: fyS, mtd_purchases: mtdP, fy_purchases: fyP });
    }
    const sum = (k) => round2(days.reduce((a, x) => a + (x.entered ? num(x[k]) : 0), 0));
    const totals = Object.fromEntries([...FIELDS, 'total_sales', 'net_purchases'].map((k) => [k, sum(k)]));
    return { branch, month: ym, days, totals };
  }));

  app.get('/api/retail-shop-report/day', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.query.branch);
    const day = String(req.query.date || '');
    if (!ISO_RE.test(day)) bad('Choose the date');
    const { out, opening } = await branchDays(branch, day);
    const cur = out.get(day) || null;
    const prev = [...out.values()].filter((d) => d.day < day).pop();
    let logged = 0;
    try {
      const r = await q(`SELECT COALESCE(SUM(amount),0) AS s FROM retail_expenses WHERE branch_name = $1 AND entry_date = $2 AND payment_type = 'Cash'`, [branch, day]);
      logged = num(r[0]?.s);
    } catch { /* no expense table yet */ }
    return {
      branch, day, entry: cur,
      cash_carried: cur ? cur.cash_carried : (prev ? prev.cash_close : (opening ? num(opening.cash) : 0)),
      before_opening: !!(opening && day <= opening.date),
      mtd_sales_before: prev && prev.day.slice(0, 7) === day.slice(0, 7) ? prev.mtd_sales : 0,
      fy_sales_before: prev && fyStart(prev.day) === fyStart(day) ? prev.fy_sales : 0,
      logged_cash_expense: logged,
    };
  }));

  app.put('/api/retail-shop-report/day', requireAuth, route(null, async (req) => {
    const b = req.body || {};
    const branch = await branchIn(b.branch);
    const day = String(b.date || '');
    if (!ISO_RE.test(day)) bad('Choose the date');
    if (day > istToday()) bad('That date is in the future');
    const vals = FIELDS.map((k) => { const n = num(b[k]); if (n < 0) bad('Amounts cannot be negative'); return n; });
    const override = b.cash_open_override === '' || b.cash_open_override == null ? null : num(b.cash_open_override);
    const note = String(b.note || '').trim().slice(0, 2000);
    const n = FIELDS.length;
    const ph = FIELDS.map((_, i) => `$${i + 3}`).join(',');
    // Placeholders become positional '?' on MySQL, so they appear in order.
    const set = FIELDS.map((k, i) => `${k}=$${n + 9 + i}`).join(', ');
    await q(`INSERT INTO retail_shop_daily (branch, day, ${FIELDS.join(', ')}, cash_open_override, note, source, updated_by, updated_at)
             VALUES ($1,$2,${ph},$${n + 3},$${n + 4},'erp',$${n + 5},NOW())
             ON CONFLICT (branch, day) DO UPDATE SET cash_open_override=$${n + 6}, note=$${n + 7}, source='erp', updated_by=$${n + 8}, updated_at=NOW(), ${set}`,
      [branch, day, ...vals, override, note, req.rsr.by, override, note, req.rsr.by, ...vals]);
    return { ok: true };
  }));

  app.delete('/api/retail-shop-report/day', requireAuth, route('admin', async (req) => {
    const branch = await branchIn(req.query.branch);
    const day = String(req.query.date || '');
    if (!ISO_RE.test(day)) bad('Choose the date');
    await q('DELETE FROM retail_shop_daily WHERE branch = $1 AND day = $2', [branch, day]);
    return { ok: true };
  }));

  app.post('/api/retail-shop-report/opening', requireAuth, route('admin', async (req) => {
    const b = req.body || {};
    const branch = await branchIn(b.branch);
    const all = await readOpening();
    if (b.clear) delete all[branch];
    else {
      if (!ISO_RE.test(String(b.date || ''))) bad('Enter the date the opening balance is for');
      all[branch] = { date: b.date, cash: num(b.cash) };
    }
    await writeOpening(all);
    return { ok: true };
  }));

  /* Import the Google Sheet into a branch (the sheet has no branch of its
     own — it is Satellite's). Days saved here are kept unless overwrite.
     The sheet's Op. balance becomes an override only where it does not
     follow from the day before — its hand adjustments. */
  app.post('/api/retail-shop-report/import', requireAuth, route('admin', async (req) => {
    const branch = await branchIn(req.body?.branch);
    const overwrite = !!req.body?.overwrite;
    const auth = getGoogleAuth && getGoogleAuth();
    if (!auth) bad('Google Sheets is not configured on this server');
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties(title,hidden)' });
    const titles = meta.data.sheets.filter((s) => !s.properties.hidden).map((s) => s.properties.title);
    const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'!A1:AD1000`), valueRenderOption: 'UNFORMATTED_VALUE' });
    const tabs = Object.fromEntries(r.data.valueRanges.map((v, i) => [titles[i], v.values || []]));
    const today = istToday();
    const days = parseShopSheet(tabs).filter((d) => d.day <= today);
    if (!days.length) bad('Nothing found in the sheet');
    const opening = await readOpening();
    if (!opening[branch] && days[0].op != null) { opening[branch] = { date: addDays(days[0].day, -1), cash: days[0].op }; await writeOpening(opening); }
    const keep = new Set((await q(`SELECT day FROM retail_shop_daily WHERE branch = $1 AND source = 'erp'`, [branch])).map((x) => dOut(x.day)));
    // `ours` is the closing this system will work out; where the sheet's Op.
    // balance differs from it (a hand adjustment, or a closing typed that
    // did not follow from the day's figures), the day gets the sheet's Op.
    // balance as its override — so from then on the two agree again.
    let n = 0, kept = 0, adjustments = 0;
    let ours = opening[branch] ? num(opening[branch].cash) : 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const override = d.op != null && Math.abs(d.op - ours) > 1 ? d.op : null;
      const f = FIELDS.map((k) => num(d.fields[k]));
      ours = round2((override ?? ours) + num(d.fields.cash_sales) - num(d.fields.cash_deposit) + num(d.fields.cash_received) - num(d.fields.cash_expense));
      if (keep.has(d.day) && !overwrite) { kept++; continue; }
      if (override != null) adjustments++;
      const nF = FIELDS.length;
      await q(`INSERT INTO retail_shop_daily (branch, day, ${FIELDS.join(', ')}, cash_open_override, source, updated_by, updated_at)
               VALUES ($1,$2,${FIELDS.map((_, j) => `$${j + 3}`).join(',')},$${nF + 3},'sheet','Import',NOW())
               ON CONFLICT (branch, day) DO UPDATE SET ${FIELDS.map((k, j) => `${k}=$${nF + 4 + j}`).join(', ')}, cash_open_override=$${2 * nF + 4}, source='sheet', updated_by='Import', updated_at=NOW()`,
        [branch, d.day, ...f, override, ...f, override]);
      n++;
    }
    return { branch, days: n, keptErp: kept, adjustments, from: days[0].day, to: days[days.length - 1].day, opening: opening[branch] };
  }));

  return {};
}

module.exports = { RSR_SCHEMA, mountRetailShopReport, computeDays, parseShopSheet };
