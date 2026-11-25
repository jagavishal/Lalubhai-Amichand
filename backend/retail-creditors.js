'use strict';
/* =====================================================================
   Retail Creditor List (route 'retail-creditors', Retail section)
   ---------------------------------------------------------------------
   Built 25 Nov 2026 from the meeting with Archana ji and Sachin: the shops'
   "Creditor List" Google Sheet, on which the retail payments are made.

   - Per shop (Satellite / Bopal — the retail branch list), chosen at the top
     like the Daily Report (Tally).
   - Bills come in by Excel upload: Party Name · Bill Date · Bill No · Amount
     (a minus amount — a credit note — is allowed). Everything else is worked
     out: party-wise totals and grand total, days since the bill, and Overdue
     once a bill is more than 60 days old (by how many days).
   - Settle: tick a party's bills, type the cheque number and the cheque
     signing date — they are settled and stay in the register.
   - Month-wise: the bill month filter; an upload of the same bill again is
     skipped, not doubled.
   ===================================================================== */

const RC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS retail_creditor_bills (
     id INT AUTO_INCREMENT PRIMARY KEY,
     branch VARCHAR(64) NOT NULL,
     party VARCHAR(255) NOT NULL,
     bill_date DATE NOT NULL,
     bill_no VARCHAR(64) NOT NULL DEFAULT '',
     amount DECIMAL(14,2) NOT NULL DEFAULT 0,
     status VARCHAR(16) NOT NULL DEFAULT 'Open',
     cheque_no VARCHAR(64) NOT NULL DEFAULT '',
     cheque_date DATE DEFAULT NULL,
     settled_by VARCHAR(255) NOT NULL DEFAULT '',
     settled_at DATETIME DEFAULT NULL,
     file_name VARCHAR(255) NOT NULL DEFAULT '',
     uploaded_by VARCHAR(255) NOT NULL DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     KEY idx_rcb_branch (branch, bill_date)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const DUE_DAYS = 60;   // "60 days se compare … more than 60 is overdue"

class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const bad = (m) => { throw new UserError(m); };
const str = (v, max = 255) => String(v ?? '').trim().slice(0, max);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/* A bill date as the sheet has it — "12-11-2026", "12/11/26", "12-Nov-2026",
   "2026-11-12", an Excel serial — day first, as written in India. A date
   that only makes sense month-first ("11/25/2026") is read that way. */
function dateIn(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/. ]([a-z]{3})[a-z]*[-/. ,']*(\d{2,4})$/i.exec(s);
  if (m && MON[m[2].toLowerCase()]) return ok(year(m[3]), MON[m[2].toLowerCase()], +m[1]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = year(m[3]);
    if (a > 12 && b <= 12) return ok(y, b, a);
    if (b > 12 && a <= 12) return ok(y, a, b);
    return ok(y, b, a);   // day first
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return dateIn(Number(s));
  return null;
  function year(y) { y = +y; return y < 100 ? 2000 + y : y; }
  function ok(y, mo, d) {
    if (!(y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    return dt.toISOString().slice(0, 10);
  }
}
const money = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,₹\s]|rs\.?/gi, '');
  if (/(cr|dr)$/i.test(s)) { if (/cr$/i.test(s)) neg = !neg; s = s.replace(/(cr|dr)$/i, ''); }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return (neg ? -1 : 1) * Number(s);
};

/* The sheet: a header row naming Party / Bill Date / Bill No / Amount (in
   any order, anywhere in the first 15 rows). A row with no party carries the
   party above it (sheets often write the name once per group). */
function parseSheet(rows) {
  rows = (Array.isArray(rows) ? rows : []).slice(0, 5000).map((r) => (Array.isArray(r) ? r : []));
  const txt = (v) => String(v ?? '').trim();
  const find = (r, re) => r.findIndex((c) => re.test(txt(c)));
  let hr = -1, col = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i];
    const c = { party: find(r, /party|supplier|vendor|creditor|name/i), date: find(r, /bill\s*date|inv(oice)?\s*date|^date$/i),
      no: find(r, /bill\s*no|inv(oice)?\s*no|bill\s*number|^no\.?$/i), amount: find(r, /amount|amt|value|total/i) };
    if (c.party >= 0 && c.date >= 0 && c.amount >= 0) { hr = i; col = c; break; }
  }
  if (hr < 0) bad('Could not find the columns — the sheet needs Party Name, Bill Date, Bill No and Amount headings');
  const out = [], skipped = [];
  let party = '';
  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i];
    const p = txt(r[col.party]);
    if (/^(sub\s*)?total|grand\s*total/i.test(p)) continue;
    if (p) party = p;
    const amount = money(r[col.amount]);
    const date = dateIn(r[col.date]);
    if (amount == null && !date) continue;           // a blank or heading row
    if (!party) { skipped.push(`Row ${i + 1}: no party`); continue; }
    if (!date) { skipped.push(`Row ${i + 1} (${party}): bill date "${txt(r[col.date])}" not read`); continue; }
    if (amount == null) { skipped.push(`Row ${i + 1} (${party}): no amount`); continue; }
    out.push({ party: party.slice(0, 255), date, no: col.no >= 0 ? txt(r[col.no]).slice(0, 64) : '', amount: round2(amount) });
  }
  if (!out.length) bad('No bills found under the headings');
  return { bills: out, skipped };
}

function mountRetailCreditors(app, ctx) {
  const { q, ensureSchema, requireAuth, useDb, canOpen, isAdmin, branches } = ctx;

  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'The Creditor List needs the database' });
        await ensureSchema();
        const user = req.session.user;
        if (!(await canOpen(user))) return res.status(403).json({ error: 'You do not have access to the Creditor List' });
        const admin = await isAdmin(user);
        if (need === 'admin' && !admin) return res.status(403).json({ error: 'Only an Admin / HOD can do this' });
        req.rc = { user, admin, by: user.name || user.email || '' };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[retail-creditors]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  async function branchIn(v) {
    const list = await branches();
    const b = list.find((x) => x.toLowerCase() === str(v).toLowerCase());
    if (!b) bad('Choose the shop');
    return b;
  }
  const dOut = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : (v ? String(v).slice(0, 10) : null));
  const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const days = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

  app.get('/api/retail-creditors/meta', requireAuth, route(null, async (req) => ({ branches: await branches(), admin: req.rc.admin, dueDays: DUE_DAYS, today: istToday() })));

  // Every bill of a shop, worked out: days, overdue, party totals.
  app.get('/api/retail-creditors/bills', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.query.branch);
    const today = istToday();
    const rows = await q('SELECT * FROM retail_creditor_bills WHERE branch = $1 ORDER BY party, bill_date, id', [branch]);
    const bills = rows.map((r) => {
      const bd = dOut(r.bill_date), cd = dOut(r.cheque_date);
      const settled = r.status === 'Settled';
      // Open: days till today. Settled: days till the cheque was signed.
      const total = days(bd, settled && cd ? cd : today);
      return { id: r.id, party: r.party, bill_date: bd, bill_no: r.bill_no, amount: Number(r.amount), status: r.status,
        total_days: total, overdue_days: total > DUE_DAYS ? total - DUE_DAYS : 0,
        cheque_no: r.cheque_no || '', cheque_date: cd, settled_by: r.settled_by || '', file_name: r.file_name || '' };
    });
    return { branch, today, dueDays: DUE_DAYS, bills };
  }));

  app.post('/api/retail-creditors/preview', requireAuth, route(null, async (req) => {
    const p = parseSheet(req.body?.sheet);
    return { count: p.bills.length, total: round2(p.bills.reduce((a, b) => a + b.amount, 0)), parties: new Set(p.bills.map((b) => b.party.toLowerCase())).size,
      from: p.bills.reduce((a, b) => (a && a < b.date ? a : b.date), null), to: p.bills.reduce((a, b) => (a && a > b.date ? a : b.date), null),
      skipped: p.skipped.slice(0, 30), sample: p.bills.slice(0, 8) };
  }));

  // Upload: new bills added; a bill already there (same party, date, no. and amount) is skipped.
  app.post('/api/retail-creditors/upload', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.body?.branch);
    const p = parseSheet(req.body?.sheet);
    const file = str(req.body?.file_name);
    const have = await q('SELECT party, bill_date, bill_no, amount FROM retail_creditor_bills WHERE branch = $1', [branch]);
    const key = (party, date, no, amt) => [party.toLowerCase().replace(/\s+/g, ' '), date, String(no).toLowerCase(), round2(amt).toFixed(2)].join('|');
    const seen = new Set(have.map((r) => key(r.party, dOut(r.bill_date), r.bill_no, Number(r.amount))));
    let added = 0, dup = 0;
    for (const b of p.bills) {
      const k = key(b.party, b.date, b.no, b.amount);
      if (seen.has(k)) { dup++; continue; }
      seen.add(k);
      await q('INSERT INTO retail_creditor_bills (branch, party, bill_date, bill_no, amount, file_name, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [branch, b.party, b.date, b.no, b.amount, file, req.rc.by]);
      added++;
    }
    return { ok: true, added, duplicates: dup, skipped: p.skipped };
  }));

  // Settle: cheque number + signing date on one or more bills of the shop.
  app.post('/api/retail-creditors/settle', requireAuth, route(null, async (req) => {
    const branch = await branchIn(req.body?.branch);
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n) => n > 0);
    if (!ids.length) bad('Tick the bills to settle');
    const chequeNo = str(req.body?.cheque_no, 64) || bad('Type the cheque number');
    const chequeDate = dateIn(req.body?.cheque_date) || bad('Pick the cheque signing date');
    const r = await q(`UPDATE retail_creditor_bills SET status='Settled', cheque_no=$1, cheque_date=$2, settled_by=$3, settled_at=NOW()
                        WHERE branch=$4 AND status='Open' AND id IN (${ids.map((_, i) => '$' + (i + 5)).join(',')})`,
      [chequeNo, chequeDate, req.rc.by, branch, ...ids]);
    return { ok: true, settled: r.affectedRows ?? r.rowCount ?? ids.length };
  }));

  // Undo a settle (a wrong cheque entered) — Admin / HOD.
  app.post('/api/retail-creditors/unsettle', requireAuth, route('admin', async (req) => {
    const id = Number(req.body?.id);
    await q(`UPDATE retail_creditor_bills SET status='Open', cheque_no='', cheque_date=NULL, settled_by='', settled_at=NULL WHERE id=$1`, [id]);
    return { ok: true };
  }));

  // Fix or remove one bill — Admin / HOD.
  app.patch('/api/retail-creditors/bills/:id', requireAuth, route('admin', async (req) => {
    const b = req.body || {};
    const date = dateIn(b.bill_date) || bad('Bill date is not valid');
    const amount = money(b.amount);
    if (amount == null) bad('Amount is not valid');
    await q('UPDATE retail_creditor_bills SET party=$1, bill_date=$2, bill_no=$3, amount=$4 WHERE id=$5',
      [str(b.party) || bad('Party is required'), date, str(b.bill_no, 64), round2(amount), Number(req.params.id)]);
    return { ok: true };
  }));
  app.delete('/api/retail-creditors/bills/:id', requireAuth, route('admin', async (req) => {
    await q('DELETE FROM retail_creditor_bills WHERE id = $1', [Number(req.params.id)]);
    return { ok: true };
  }));

  return {};
}

module.exports = { RC_SCHEMA, mountRetailCreditors, parseSheet, dateIn };
