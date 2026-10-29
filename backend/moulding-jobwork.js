'use strict';
/* =====================================================================
   Moulding IN-OUT and Job Work IN-OUT.
   ---------------------------------------------------------------------
   Replaces two Google workbooks:

   1. "MOULDING IN OUT" (1iyj9To2…) — one "DPR <MONTH>" tab a month, one
      row a day: aluminium scrap put into the bhatti (INPUT WT.), scrap left
      at the end of the shift (BALANCE), so ACTUAL INPUT = input − balance;
      the parts that came out (OUTPUT WT., QTY, NAME OF THE PARTS), the
      chhay (dross) weight, the operators, and MELTING LOSS % =
      (actual input − output) / actual input. Those two are computed here,
      never typed, so they cannot disagree with the weights.

   2. "VAKHARIA-2026-2027" (1ZXeiY60…) — one tab per job-work party
      (VAKHARIA, SUBHASH METAL): scrap sent OUT on a challan (LJ/03 …) with
      5 % melting loss taken off, so FINAL WT. = weight × 0.95 is what the
      party owes back; goods coming IN against bills; AVAILABLE QUANTITY is
      the running balance still with the party, "DONE" when it reaches 0.
      Here the balance is computed from the entries — OPENING + Σ final wt
      OUT − Σ received IN — rather than kept by hand down a column.

   Both live in one table (mj_entries), kind 'dpr' or 'jw'. Each row keeps
   its figures as a JSON document like the other factory modules.

   Import reads both workbooks straight from Google (the app's service
   account can read them) and replaces whatever an earlier import brought
   in (source 'sheet'); entries made in the ERP are never touched, so the
   import can be re-run while the sheets are still being kept in parallel.

   Access: page key 'moulding-jobwork' (requireAdminOrPage in server.js).
   Deleting an entry and running the import need Admin/HOD. Works in local
   JSON mode too (database/moulding-jobwork.json).
   ===================================================================== */

const fsp = require('fs').promises;
const path = require('path');

const JSON_FILE = path.join(__dirname, '..', 'database', 'moulding-jobwork.json');

// The two source workbooks, for the import.
const MOULDING_SHEET_ID = '1iyj9To2RMMjFb9_GhYNFVb0gkuUOvTEC66f4XiSS1K0';
const JOBWORK_SHEET_ID = '1ZXeiY60ZYqPLycoBqU_Z9gC38XmslA2mwYGoBlN1DOY';

const DEFAULT_PROCESS = 'ALUM. SHEET CUTTING';
// What goes into the bhatti; the DPR sheet only ever had scrap.
const DEFAULT_MATERIAL = 'ALU. SCRAP';

const MJ_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mj_entries (
     id VARCHAR(24) PRIMARY KEY,
     kind VARCHAR(8) NOT NULL,
     entry_date DATE NOT NULL,
     party VARCHAR(160) NOT NULL DEFAULT '',
     seq BIGINT NOT NULL DEFAULT 0,
     source VARCHAR(16) NOT NULL DEFAULT 'erp',
     data LONGTEXT NOT NULL,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     KEY idx_mj_kind_date (kind, entry_date),
     KEY idx_mj_party (party)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg, status) => { throw new UserError(msg, status); };
const str = (v, max = 255) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[,\s%]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const partyKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/* ── Cleaning one entry ─────────────────────────────────────────── */

function cleanDpr(src) {
  const input = Math.max(0, num(src.input_wt));
  const balance = Math.max(0, num(src.balance_wt));
  const actual = Math.max(0, input - balance);
  const output = Math.max(0, num(src.output_wt));
  return {
    entry_date: isoDate(src.entry_date),
    process: str(src.process, 120).toUpperCase() || DEFAULT_PROCESS,
    input_material: str(src.input_material, 60).toUpperCase() || DEFAULT_MATERIAL,
    input_wt: r3(input),
    balance_wt: r3(balance),
    actual_wt: r3(actual),
    output_wt: r3(output),
    qty_pcs: Math.max(0, Math.round(num(src.qty_pcs))),
    parts: str(src.parts, 500),
    chhay_wt: r3(Math.max(0, num(src.chhay_wt))),
    loss_pct: actual > 0 ? r2(((actual - output) / actual) * 100) : 0,
    operators: str(src.operators, 255),
    remarks: str(src.remarks, 500),
  };
}

/* The job-work sheets keep one block per LOT: a lot is opened by sending
   material (or by a balance carried in), and the bills that come back are
   ticked off against that lot until its AVAILABLE QUANTITY reaches 0
   ("DONE"). Three kinds of lot sit side by side on one party's tab:
     JOB WORK  scrap melted for us, 5 % melting loss
     INGOT     our ingots melted, 4 % loss
     PURCHASE  material bought at a rate per kg, 0 % loss
   So OUT and OPENING entries open (or add to) a lot, and every IN names the
   lot it is against. */
const JW_TYPES = ['OUT', 'IN', 'OPENING'];
const LOT_TYPES = { 'JOB WORK': 5, INGOT: 4, PURCHASE: 0 };
function cleanJw(src) {
  const type = String(src.type || '').toUpperCase();
  const lotType = String(src.lot_type || '').toUpperCase();
  const e = {
    entry_date: isoDate(src.entry_date),
    party: str(src.party, 160).toUpperCase(),
    type: JW_TYPES.includes(type) ? type : '',
    lot_no: str(src.lot_no, 20).toUpperCase(),
    lot_type: LOT_TYPES[lotType] != null ? lotType : 'JOB WORK',
    rate: r2(Math.max(0, num(src.rate))),
    doc_no: str(src.doc_no, 60),
    description: str(src.description, 255).toUpperCase(),
    weight: 0, loss_pct: 0, loss_wt: 0, final_wt: 0, qty: 0,
    remarks: str(src.remarks, 500),
  };
  if (e.type === 'OUT') {
    e.weight = r3(Math.max(0, num(src.weight)));
    const pct = src.loss_pct === '' || src.loss_pct == null ? LOT_TYPES[e.lot_type] : num(src.loss_pct);
    e.loss_pct = r2(Math.min(100, Math.max(0, pct)));
    e.loss_wt = r3((e.weight * e.loss_pct) / 100);
    e.final_wt = r3(e.weight - e.loss_wt);
  } else {
    e.qty = r3(Math.max(0, num(src.qty)));
  }
  if (e.type === 'IN') { e.lot_type = ''; e.rate = 0; }
  return e;
}

// Oldest first, each entry carrying the party's running balance (all its
// lots together) and its own lot's running balance.
function withBalances(entries) {
  const sorted = entries.slice().sort((a, b) =>
    a.party.localeCompare(b.party) || a.entry_date.localeCompare(b.entry_date) || (a.seq - b.seq));
  const bal = new Map();
  const lotBal = new Map();
  for (const e of sorted) {
    const delta = e.type === 'OUT' ? e.final_wt : e.type === 'OPENING' ? e.qty : -e.qty;
    const p = (bal.get(e.party) || 0) + delta;
    const lk = `${e.party}|${e.lot_no}`;
    const l = (lotBal.get(lk) || 0) + delta;
    bal.set(e.party, p); lotBal.set(lk, l);
    e.balance = r3(p);
    e.lot_balance = r3(l);
  }
  return sorted;
}

// One row per lot: what was sent, what came back, what is still out.
function lotSummary(entries) {
  const lots = new Map();
  for (const e of entries) {
    const k = `${e.party}|${e.lot_no}`;
    const L = lots.get(k) || { party: e.party, lot_no: e.lot_no, lot_type: '', rate: 0, loss_pct: 0, description: '', docs: [],
      first_date: e.entry_date, last_date: e.entry_date, sent: 0, final: 0, received: 0, bills: 0 };
    if (e.type !== 'IN') {
      L.lot_type = L.lot_type || e.lot_type; L.rate = L.rate || e.rate; L.loss_pct = L.loss_pct || e.loss_pct;
      L.description = L.description || e.description;
      if (e.doc_no) L.docs.push(e.doc_no);
      L.sent += e.type === 'OUT' ? e.weight : e.qty;
      L.final += e.type === 'OUT' ? e.final_wt : e.qty;
    } else { L.received += e.qty; L.bills++; }
    if (e.entry_date < L.first_date) L.first_date = e.entry_date;
    if (e.entry_date > L.last_date) L.last_date = e.entry_date;
    lots.set(k, L);
  }
  return [...lots.values()].map((L) => {
    const balance = r3(L.final - L.received);
    // The sheets write DONE on a lot once the last bill is in even when a
    // few kg are left (50.2 of 10,000): within 1 % that is SHORT, a closed
    // lot with a shortage, not one still waiting for material.
    const status = Math.abs(balance) < 0.005 ? 'DONE' : balance < 0 ? 'EXCESS'
      : balance <= L.final * 0.01 ? 'SHORT' : 'OPEN';
    return { ...L, sent: r3(L.sent), final: r3(L.final), received: r3(L.received), balance, status };
  }).sort((a, b) => a.party.localeCompare(b.party) || a.first_date.localeCompare(b.first_date) || a.lot_no.localeCompare(b.lot_no));
}

const lotNum = (s) => { const m = /^L(\d+)$/.exec(String(s || '')); return m ? +m[1] : 0; };
const lotLabel = (n) => `L${String(n).padStart(2, '0')}`;

/* ── Reading the Google workbooks (import) ──────────────────────── */

// A date cell read UNFORMATTED: a real date is a serial number; text is
// whatever was typed. The job-work sheet types "14.04.2026" (day first);
// the DPR tabs type "9/1/2026" (month first, US). One DPR cell even has a
// Drive link pasted after the date, so only the leading date is read.
function sheetDate(v, dayFirst) {
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(String(v || ''));
  if (!m) return '';
  let [a, b, y] = [+m[1], +m[2], +m[3]];
  if (y < 100) y += 2000;
  const [d, mo] = dayFirst ? [a, b] : [b, a];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function readTabs(sheets, spreadsheetId, filter) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const titles = meta.data.sheets.map((s) => s.properties.title).filter(filter);
  if (!titles.length) return [];
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'!A1:Z1000`),
    valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return titles.map((title, i) => ({ title, grid: res.data.valueRanges[i].values || [] }));
}

function parseDprTab(grid) {
  const H = (c) => String(c ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const hi = grid.findIndex((r) => (r || []).some((c) => /^DATE$/.test(H(c))) && (r || []).some((c) => /INPUT WT/.test(H(c))));
  if (hi < 0) return [];
  const head = grid[hi].map(H);
  const col = (re) => head.findIndex((h) => re.test(h));
  const C = {
    date: col(/^DATE$/), item: col(/^ITEM/), input: col(/^INPUT WT/), balance: col(/^BALANCE SCRAP/),
    output: col(/^OUT ?PUT WT/), qty: col(/^QTY/), parts: col(/^NAME OF THE PARTS/),
    chhay: col(/CHHAY/), ops: col(/OPERATOR/), rem: col(/^REA?MARK/),
    material: col(/MATERIAL|TYPE OF (SCRAP|INPUT)/),
  };
  // No material column: the input heading says it ("INPUT WT. (KG) ALUM. SCRAP").
  const headMaterial = C.input >= 0 && /SHEET/.test(head[C.input]) ? 'ALU. SHEET' : DEFAULT_MATERIAL;
  if (C.parts < 0) C.parts = col(/NAME OF PARTS/);
  const at = (r, k) => (C[k] >= 0 ? r[C[k]] : '');
  const out = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const date = sheetDate(at(r, 'date'), false);
    if (!date) continue;
    const row = cleanDpr({
      entry_date: date, process: at(r, 'item'), input_material: at(r, 'material') || headMaterial,
      input_wt: at(r, 'input'), balance_wt: at(r, 'balance'),
      output_wt: at(r, 'output'), qty_pcs: at(r, 'qty'), parts: at(r, 'parts'), chhay_wt: at(r, 'chhay'),
      operators: at(r, 'ops'), remarks: at(r, 'rem'),
    });
    if (!(row.input_wt > 0) && !(row.output_wt > 0)) continue;   // a blank day (Sunday, bhatti off)
    out.push(row);
  }
  return out;
}

// "VAKHARIA JOB WORK/PURCHASE 2026-27" -> "VAKHARIA".
const partyFromTab = (t) => str(t).toUpperCase().replace(/\s*JOB\s*WORK.*$/, '').replace(/\s*\d{4}\s*-\s*\d{2,4}\s*$/, '').trim();

// A block title row: "VAKHARIA PURCHASE - IN - OUT 2026 - 2027 [ PURCHASE 0%
// MELTING LOSS ] RATE : - 416.12/-" -> lot type PURCHASE, rate 416.12.
function blockMeta(title) {
  const t = String(title || '').toUpperCase();
  const type = /PURCHASE/.test(t) ? 'PURCHASE' : /INGOT/.test(t) ? 'INGOT' : 'JOB WORK';
  const rm = /RATE\s*:?\s*-?\s*([\d.]+)/.exec(t);
  return { lot_type: type, rate: rm ? +rm[1] : 0 };
}

function parseJwTab(title, grid) {
  const H = (c) => String(c ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const party = partyFromTab(title);
  const rows = [];
  const blocks = [];   // per block: the sheet's own last AVAILABLE QUANTITY
  // seq keeps the sheet's own row order within a day (OUT before the INs
  // typed under it).
  const push = (src, seq) => { const e = cleanJw({ ...src, party }); e.seq = seq; rows.push(e); };
  let lastDate = '', block = null, inTable = false;
  for (let i = 0; i < grid.length; i++) {
    const r = grid[i] || [];
    const a = H(r[0]);
    // Each "… IN - OUT …" title starts a new lot.
    if (/IN\s*-\s*OUT/.test(a)) {
      block = { lot_no: lotLabel(blocks.length + 1), ...blockMeta(a), sheetBalance: null };
      blocks.push(block); inTable = false; continue;
    }
    if (a === 'DATE' && /CHALLAN/.test(H(r[1]))) { inTable = !!block; continue; }
    if (!inTable) continue;
    const [aDate, challan, desc, weight, lossWt, , , billNo, billDate, recd, avail, remark] = r;
    if (avail !== '' && avail != null && Number.isFinite(num(avail))) block.sheetBalance = num(avail);
    const rem = str(remark, 200);
    const keepRem = /^(DONE|OPP\.? ?BALANCE)$/i.test(rem) ? '' : rem;
    const lot = { lot_no: block.lot_no, lot_type: block.lot_type, rate: block.rate };
    if (num(weight) > 0) {
      const w = num(weight);
      // Purchase lots are often typed with no date — dated below from the
      // first bill against them rather than from the block above.
      const d = sheetDate(aDate, true);
      // The loss column is a formula (=D*5%, or a typed 0 on purchases):
      // take what it came to, so a 0 % purchase stays 0 %.
      const pct = lossWt !== '' && lossWt != null ? (num(lossWt) / w) * 100 : LOT_TYPES[block.lot_type];
      push({ ...lot, type: 'OUT', entry_date: d, doc_no: challan, description: desc, weight: w, loss_pct: pct, remarks: keepRem }, i * 2);
      if (d) lastDate = d;
    }
    if (num(recd) > 0) {
      const d = sheetDate(billDate, true) || sheetDate(aDate, true) || lastDate;
      push({ lot_no: block.lot_no, type: 'IN', entry_date: d, doc_no: billNo, qty: num(recd), remarks: keepRem }, i * 2 + 1);
      if (d) lastDate = d;
    }
    // A balance carried in from last year with no movement on the row
    // (VAKHARIA's "20367.55 OPP. BALANCE"). It has no date of its own.
    if (!(num(weight) > 0) && !(num(recd) > 0) && num(avail) > 0 && /OPP/i.test(rem)) {
      push({ ...lot, type: 'OPENING', entry_date: '', qty: num(avail), remarks: 'Opening balance (sheet)' }, i * 2);
    }
  }
  // An undated row (opening balance, or a purchase lot typed without a
  // date) takes the first date that follows it in its lot, else the
  // party's first date.
  const firstDate = rows.filter((x) => x.entry_date).map((x) => x.entry_date).sort()[0] || '';
  rows.forEach((x, k) => {
    if (x.entry_date) return;
    const next = rows.slice(k + 1).find((y) => y.lot_no === x.lot_no && y.entry_date);
    x.entry_date = (next && next.entry_date) || firstDate;
  });
  return {
    party, rows: rows.filter((x) => x.entry_date),
    sheetBalance: blocks.reduce((s, b) => s + (b.sheetBalance || 0), 0),
    lots: blocks.map((b) => ({ lot_no: b.lot_no, lot_type: b.lot_type, rate: b.rate, sheetBalance: b.sheetBalance })),
  };
}

/* ===================================================================== */

function mountMouldingJobwork(app, ctx) {
  const { q, ensureSchema, requireAuth, requireAccess, isAdminUser, isSuperAdmin, getGoogleAuth, useDb } = ctx;
  const BASE = '/api/moulding-jobwork';
  const canManage = (u) => isSuperAdmin(u) || isAdminUser(u);

  /* ── Storage: one table in the DB, one JSON file in local JSON mode ── */

  async function readFile() {
    try { return JSON.parse(await fsp.readFile(JSON_FILE, 'utf8')).entries || []; } catch { return []; }
  }
  async function writeFile(entries) {
    await fsp.mkdir(path.dirname(JSON_FILE), { recursive: true });
    await fsp.writeFile(JSON_FILE, JSON.stringify({ entries }, null, 1));
  }
  const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
  const dOut = (v) => (v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v || '').slice(0, 10));

  const COLS = ['id', 'kind', 'entry_date', 'party', 'seq', 'source', 'created_by'];
  const store = {
    async list(kind, { from = '', to = '' } = {}) {
      if (!useDb) {
        return (await readFile()).filter((e) => e.kind === kind && (!from || e.entry_date >= from) && (!to || e.entry_date <= to));
      }
      const params = [kind];
      let sql = 'SELECT id, kind, entry_date, party, seq, source, created_by, data FROM mj_entries WHERE kind = $1';
      if (from) { params.push(from); sql += ` AND entry_date >= $${params.length}`; }
      if (to) { params.push(to); sql += ` AND entry_date <= $${params.length}`; }
      const rows = await q(sql + ' ORDER BY entry_date, seq', params);
      return rows.map((r) => ({ ...parse(r.data), id: r.id, kind: r.kind, entry_date: dOut(r.entry_date), party: r.party, seq: Number(r.seq) || 0, source: r.source, created_by: r.created_by }));
    },
    async get(id) {
      if (!useDb) return (await readFile()).find((e) => e.id === id) || null;
      const rows = await q('SELECT id, kind, entry_date, party, seq, source, created_by, data FROM mj_entries WHERE id = $1', [id]);
      const r = rows[0];
      return r ? { ...parse(r.data), id: r.id, kind: r.kind, entry_date: dOut(r.entry_date), party: r.party, seq: Number(r.seq) || 0, source: r.source, created_by: r.created_by } : null;
    },
    async save(e) {
      const data = JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !COLS.includes(k) && k !== 'balance')));
      if (!useDb) {
        const all = await readFile();
        const i = all.findIndex((x) => x.id === e.id);
        if (i >= 0) all[i] = e; else all.push(e);
        return writeFile(all);
      }
      const ex = await q('SELECT id FROM mj_entries WHERE id = $1', [e.id]);
      if (ex.length) {
        await q('UPDATE mj_entries SET entry_date = $1, party = $2, data = $3 WHERE id = $4', [e.entry_date, e.party || '', data, e.id]);
      } else {
        await q('INSERT INTO mj_entries (id, kind, entry_date, party, seq, source, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [e.id, e.kind, e.entry_date, e.party || '', e.seq || 0, e.source || 'erp', data, e.created_by || '']);
      }
    },
    async remove(id) {
      if (!useDb) return writeFile((await readFile()).filter((e) => e.id !== id));
      await q('DELETE FROM mj_entries WHERE id = $1', [id]);
    },
    // Swap out everything an earlier import brought in for this kind.
    async replaceImported(kind, list) {
      if (!useDb) {
        const keep = (await readFile()).filter((e) => !(e.kind === kind && e.source === 'sheet'));
        return writeFile(keep.concat(list));
      }
      await q('DELETE FROM mj_entries WHERE kind = $1 AND source = $2', [kind, 'sheet']);
      for (let i = 0; i < list.length; i += 100) {
        const params = [];
        const values = list.slice(i, i + 100).map((e) => {
          const data = JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !COLS.includes(k))));
          params.push(e.id, e.kind, e.entry_date, e.party || '', e.seq || 0, 'sheet', data, e.created_by || '');
          const n = params.length;
          return `($${n - 7},$${n - 6},$${n - 5},$${n - 4},$${n - 3},$${n - 2},$${n - 1},$${n})`;
        });
        await q(`INSERT INTO mj_entries (id, kind, entry_date, party, seq, source, data, created_by) VALUES ${values.join(',')}`, params);
      }
    },
  };

  let _idSalt = 0;
  const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(++_idSalt % 1296).toString(36).padStart(2, '0')}`.toUpperCase();

  function route(fn, { manage = false } = {}) {
    return async (req, res) => {
      try {
        if (useDb) await ensureSchema();
        const user = req.session.user;
        if (manage && !canManage(user)) return res.status(403).json({ error: 'Only an Admin/HOD can do this' });
        req.mj = { user, by: user?.name || user?.email || '', manage: canManage(user) };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[moulding-jobwork]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  const guard = [requireAuth, requireAccess];
  const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  /* ── Moulding (DPR) ────────────────────────────────────────────── */

  app.get(`${BASE}/dpr`, ...guard, route(async (req) => {
    const from = isoDate(req.query.from), to = isoDate(req.query.to);
    if (!from || !to) bad('Pick the From and To dates');
    return { manage: req.mj.manage, entries: await store.list('dpr', { from, to }) };
  }));

  app.post(`${BASE}/dpr`, ...guard, route(async (req) => {
    const b = req.body || {};
    const e = cleanDpr(b);
    if (!e.entry_date) bad('Date is required');
    if (e.entry_date > tomorrow()) bad('That date is in the future');
    if (!(e.input_wt > 0)) bad('Input weight is required');
    if (e.balance_wt > e.input_wt) bad('Balance scrap cannot be more than the input');
    if (e.output_wt > e.actual_wt) bad(`Output (${e.output_wt} kg) is more than the actual input (${e.actual_wt} kg)`);
    const id = str(b.id, 24);
    if (id) {
      const ex = await store.get(id);
      if (!ex || ex.kind !== 'dpr') bad('That entry no longer exists', 404);
      await store.save({ ...ex, ...e, id });
      return { id };
    }
    const nid = newId('MD');
    await store.save({ ...e, id: nid, kind: 'dpr', party: '', seq: Date.now(), source: 'erp', created_by: req.mj.by });
    return { id: nid };
  }));

  // Everyone who has run the bhatti, for the operator picker.
  app.get(`${BASE}/dpr/workers`, ...guard, route(async () => {
    const all = await store.list('dpr', { from: '2000-01-01', to: '2999-12-31' });
    const names = new Set();
    for (const e of all) for (const n of String(e.operators || '').split(/[,/&]+/)) { const t = n.replace(/\s+/g, ' ').trim(); if (t) names.add(t.toUpperCase()); }
    return { workers: [...names].sort() };
  }));

  app.delete(`${BASE}/dpr/:id`, ...guard, route(async (req) => {
    await store.remove(str(req.params.id, 24));
    return { ok: true };
  }, { manage: true }));

  /* ── Job work ledger ───────────────────────────────────────────── */

  app.get(`${BASE}/jw`, ...guard, route(async (req) => {
    const entries = withBalances(await store.list('jw'));
    const lots = lotSummary(entries);
    const parties = [...new Set(entries.map((e) => e.party))].map((p) => {
      const mine = lots.filter((l) => l.party === p);
      return {
        party: p,
        balance: r3(mine.reduce((s, l) => s + l.balance, 0)),
        openLots: mine.filter((l) => l.status === 'OPEN').length,
        lots: mine.length,
        lastDate: mine.reduce((m, l) => (l.last_date > m ? l.last_date : m), ''),
      };
    });
    return { manage: req.mj.manage, entries, lots, parties };
  }));

  app.post(`${BASE}/jw`, ...guard, route(async (req) => {
    const b = req.body || {};
    const e = cleanJw(b);
    if (!e.party) bad('Party is required');
    if (!e.type) bad('Pick OUT (maal bheja), IN (maal aaya) or Opening');
    if (!e.entry_date) bad('Date is required');
    if (e.entry_date > tomorrow()) bad('That date is in the future');
    if (e.type === 'OUT' && !(e.weight > 0)) bad('Weight sent is required');
    if (e.type !== 'OUT' && !(e.qty > 0)) bad(e.type === 'IN' ? 'Received quantity is required' : 'Opening quantity is required');
    // Same spelling as the party already on the ledger, so one party never
    // splits into two balances over a typo in case or spacing.
    const existing = await store.list('jw');
    const known = existing.find((x) => partyKey(x.party) === partyKey(e.party));
    if (known) e.party = known.party;
    const partyLots = lotSummary(withBalances(existing.filter((x) => x.party === e.party)));
    if (e.type === 'IN') {
      // Against the lot picked; with none picked, the oldest one still open.
      if (!e.lot_no) e.lot_no = (partyLots.find((l) => l.status === 'OPEN') || {}).lot_no || '';
      if (!e.lot_no) bad(`${e.party} has no open lot to receive against — send material (OUT) or add an opening first`);
      if (!partyLots.some((l) => l.lot_no === e.lot_no)) bad(`${e.party} has no lot ${e.lot_no}`);
    } else if (!e.lot_no || !partyLots.some((l) => l.lot_no === e.lot_no)) {
      // OUT / Opening with no existing lot named: a new lot.
      e.lot_no = lotLabel(partyLots.reduce((m, l) => Math.max(m, lotNum(l.lot_no)), 0) + 1);
    }
    const id = str(b.id, 24);
    if (id) {
      const ex = existing.find((x) => x.id === id);
      if (!ex) bad('That entry no longer exists', 404);
      await store.save({ ...ex, ...e, id });
      return { id };
    }
    const nid = newId('JW');
    await store.save({ ...e, id: nid, kind: 'jw', seq: Date.now(), source: 'erp', created_by: req.mj.by });
    return { id: nid };
  }));

  app.delete(`${BASE}/jw/:id`, ...guard, route(async (req) => {
    await store.remove(str(req.params.id, 24));
    return { ok: true };
  }, { manage: true }));

  /* ── Import from the two Google workbooks ──────────────────────── */

  app.post(`${BASE}/import`, ...guard, route(async (req) => {
    const what = String(req.body?.what || 'both');
    const auth = getGoogleAuth();
    if (!auth) bad('Google Sheets is not configured on this server');
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const out = {};

    if (what === 'both' || what === 'dpr') {
      const tabs = await readTabs(sheets, MOULDING_SHEET_ID, (t) => /^DP[RE]\b/i.test(t.trim()));
      const rows = [];
      tabs.forEach((t) => parseDprTab(t.grid).forEach((r) => rows.push(r)));
      // A day typed into two month tabs counts once — the later tab wins.
      const byDate = new Map();
      rows.forEach((r) => byDate.set(r.entry_date, r));
      const list = [...byDate.values()].sort((a, b) => a.entry_date.localeCompare(b.entry_date))
        .map((r, i) => ({ ...r, id: `MDS${String(i + 1).padStart(5, '0')}`, kind: 'dpr', party: '', seq: i + 1, source: 'sheet', created_by: 'Sheet import' }));
      await store.replaceImported('dpr', list);
      out.dpr = { tabs: tabs.length, days: list.length, from: list[0]?.entry_date || '', to: list[list.length - 1]?.entry_date || '' };
    }

    if (what === 'both' || what === 'jw') {
      const tabs = await readTabs(sheets, JOBWORK_SHEET_ID, (t) => /JOB\s*WORK/i.test(t));
      const list = [];
      const parties = [];
      let n = 0;
      for (const t of tabs) {
        const got = parseJwTab(t.title, t.grid);
        got.rows.forEach((r) => list.push({ ...r, id: `JWS${String(++n).padStart(5, '0')}`, kind: 'jw', source: 'sheet', created_by: 'Sheet import' }));
        const lots = lotSummary(withBalances(got.rows.map((r) => ({ ...r }))));
        // Lot by lot against the sheet's own AVAILABLE QUANTITY, so a lot
        // that read differently is named rather than hidden in a total.
        const mismatched = got.lots.filter((s) => {
          const mine = lots.find((l) => l.lot_no === s.lot_no);
          return s.sheetBalance != null && Math.abs((mine ? mine.balance : 0) - s.sheetBalance) > 0.01;
        }).map((s) => s.lot_no);
        parties.push({ party: got.party, entries: got.rows.length, lots: lots.length,
          balance: r3(lots.reduce((s, l) => s + l.balance, 0)), sheetBalance: r3(got.sheetBalance), mismatched });
      }
      await store.replaceImported('jw', list);
      out.jw = { tabs: tabs.length, entries: list.length, parties };
    }
    console.log('[moulding-jobwork] import:', JSON.stringify(out));
    return out;
  }, { manage: true }));
}

module.exports = { MJ_SCHEMA, mountMouldingJobwork, parseDprTab, parseJwTab, cleanDpr, cleanJw, withBalances, lotSummary };
