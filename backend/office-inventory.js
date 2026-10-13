'use strict';
/* =====================================================================
   Office Inventory — office consumables: what was bought, what was used,
   what is left.
   ---------------------------------------------------------------------
   Replaces the "Inventory Management System" Google Sheet + its Apps
   Script web app (sheet id below). Same three moves:
     Purchase     date, branch, vendor, item(s), qty, rate, GST, invoice
     Consumption  date, item(s), who used it, qty
     Stock        opening + purchased − consumed, per item
   An item's stock is always computed from those rows, never stored, so it
   can't drift the way a hand-kept "Current Remaining Stock" tab can.

   One purchase form can carry several items from one bill (the sheet took
   one row per item, repeating the invoice link); each line is still its
   own oi_purchases row, sharing a bill_ref and the invoice file.

   The old data comes in through POST /api/office-inventory/import, which
   reads the sheet with the server's service account, replaces everything
   in the oi_* tables and reports the per-item stock against the sheet's
   own "Current Remaining Stock" tab. Safe to re-run until the cut-over.

   Access: the page key 'office-inventory' (Users → Access), checked by
   requireAccess (requireAdminOrPage in server.js). Deleting rows, editing
   the dropdown lists and importing need an Admin/HOD or the owner.

   Invoices are written to uploads/office-inventory/<bill_ref>/ on disk.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'office-inventory');
const SHEET_ID = '1ankblJ9uxcl0qmO8DurNHViW1s0wEahXxua7FsKnYdc';

const OI_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS oi_items (
     id VARCHAR(16) PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     category VARCHAR(128) DEFAULT '',
     unit VARCHAR(32) DEFAULT 'Pcs',
     opening_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
     min_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
     active TINYINT NOT NULL DEFAULT 1,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_oi_items_name (name)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS oi_purchases (
     id VARCHAR(16) PRIMARY KEY,
     bill_ref VARCHAR(32) DEFAULT '',
     purchase_date DATE NOT NULL,
     branch VARCHAR(128) DEFAULT '',
     vendor VARCHAR(255) DEFAULT '',
     bill_no VARCHAR(64) DEFAULT '',
     item_id VARCHAR(16) NOT NULL,
     category VARCHAR(128) DEFAULT '',
     unit VARCHAR(32) DEFAULT '',
     qty DECIMAL(14,3) NOT NULL DEFAULT 0,
     rate DECIMAL(14,2) NOT NULL DEFAULT 0,
     gst DECIMAL(5,2) NOT NULL DEFAULT 0,
     total DECIMAL(14,2) NOT NULL DEFAULT 0,
     invoice_url TEXT,
     invoice_file TEXT,
     added_by VARCHAR(255) DEFAULT '',
     source VARCHAR(8) NOT NULL DEFAULT 'erp',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_oi_pur_item ON oi_purchases (item_id)`,
  `CREATE INDEX idx_oi_pur_date ON oi_purchases (purchase_date)`,
  `CREATE TABLE IF NOT EXISTS oi_consumption (
     id VARCHAR(16) PRIMARY KEY,
     use_date DATE NOT NULL,
     item_id VARCHAR(16) NOT NULL,
     used_by VARCHAR(255) DEFAULT '',
     qty DECIMAL(14,3) NOT NULL DEFAULT 0,
     remarks TEXT,
     added_by VARCHAR(255) DEFAULT '',
     source VARCHAR(8) NOT NULL DEFAULT 'erp',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_oi_con_item ON oi_consumption (item_id)`,
  `CREATE INDEX idx_oi_con_date ON oi_consumption (use_date)`,
];

// The dropdowns — app_config 'oi_lists'. Seeded from the sheet's Helper tab
// on import; these are only the first-run defaults.
const LIST_KEYS = ['branches', 'vendors', 'categories', 'users', 'units', 'gst'];
const DEFAULT_LISTS = {
  branches: ['Mumbai Office', 'Ahmedabad Factory'],
  vendors: [],
  categories: ['Cleaning', 'Office Stationery', 'Grocery', 'Electronic Items', 'House Hold', 'Legal'],
  users: [],
  units: ['Pcs', 'Ltr', 'Kg', 'Gr', 'mL'],
  gst: ['0', '3', '5', '12', '18', '28'],
};

const ADJUST_USER = 'Stock adjustment';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg) => { throw new UserError(msg); };
const str = (v, max = 255) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;

function dstr(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).slice(0, 10);
  return ISO_RE.test(s) ? s : null;
}
const tsOut = (v) => (v instanceof Date ? v.toISOString() : v || null);
function dateIn(v, label) {
  const s = str(v, 10);
  if (!s) bad(`${label} is required`);
  if (!ISO_RE.test(s) || isNaN(new Date(s + 'T00:00:00Z').getTime())) bad(`${label} is not a valid date`);
  return s;
}

/* Sheet dates. The forms wrote day/month/year; rows that went through a JS
   Date (they carry a time, "7/22/2025 5:30:00") are month/day/year. */
function sheetDate(raw, { mdyWithTime = false } = {}) {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (!m) return null;
  let [a, b, y] = [+m[1], +m[2], +m[3]];
  const timed = /\d:\d/.test(s);
  let day = a, month = b;
  if (mdyWithTime && timed) { day = b; month = a; }
  if (month > 12 && day <= 12) [day, month] = [month, day];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m || !m[2]) return null;
  return { mimeType: (m[1] || '').toLowerCase(), buffer: Buffer.from(m[3], 'base64') };
}

/* ===================================================================== */

function mountOfficeInventory(app, ctx) {
  const { q, pool, ensureSchema, requireAuth, requireAccess, withSeqId, isAdminUser, isSuperAdmin, getGoogleAuth, useDb } = ctx;
  const BASE = '/api/office-inventory';
  const canManage = (u) => isSuperAdmin(u) || isAdminUser(u);

  function route(fn, { manage = false } = {}) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'Office Inventory needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        if (manage && !canManage(user)) return res.status(403).json({ error: 'Only an Admin/HOD can do this' });
        req.oi = { user, by: user?.name || user?.email || '', manage: canManage(user) };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[office-inventory]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  const guard = [requireAuth, requireAccess];

  /* ── Lists ─────────────────────────────────────────────────────── */

  async function readLists() {
    const out = { ...DEFAULT_LISTS };
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, ['oi_lists']);
      if (rows.length) Object.assign(out, JSON.parse(rows[0].value));
    } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    for (const k of LIST_KEYS) out[k] = Array.isArray(out[k]) ? out[k].map(String) : [];
    return out;
  }
  async function writeLists(lists) {
    const json = JSON.stringify(lists);
    await q(`INSERT INTO app_config ("key","value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value"=$3`, ['oi_lists', json, json]);
  }
  // Case-insensitive de-dupe, first spelling wins.
  const uniq = (list) => {
    const seen = new Set();
    return list.map((x) => str(x)).filter((x) => { const k = x.toLowerCase(); if (!x || seen.has(k)) return false; seen.add(k); return true; });
  };
  // A value typed on a form that isn't on its list yet joins it.
  async function remember(pairs) {
    const lists = await readLists();
    let changed = false;
    for (const [k, v] of pairs) {
      if (v && !lists[k].some((x) => x.toLowerCase() === String(v).toLowerCase())) { lists[k].push(String(v)); changed = true; }
    }
    if (changed) await writeLists(lists);
  }

  /* ── Reads ─────────────────────────────────────────────────────── */

  async function stockRows() {
    const [items, pur, con] = await Promise.all([
      q('SELECT * FROM oi_items ORDER BY name'),
      q('SELECT item_id, SUM(qty) AS qty, SUM(total) AS amount, MAX(purchase_date) AS last_date FROM oi_purchases GROUP BY item_id'),
      q('SELECT item_id, SUM(qty) AS qty, MAX(use_date) AS last_date FROM oi_consumption GROUP BY item_id'),
    ]);
    const P = new Map(pur.map((r) => [r.item_id, r]));
    const C = new Map(con.map((r) => [r.item_id, r]));
    return items.map((i) => {
      const opening = Number(i.opening_qty || 0), bought = Number(P.get(i.id)?.qty || 0), used = Number(C.get(i.id)?.qty || 0);
      return {
        id: i.id, name: i.name, category: i.category || '', unit: i.unit || '', active: !!Number(i.active),
        opening_qty: r3(opening), min_qty: r3(Number(i.min_qty || 0)),
        purchased: r3(bought), consumed: r3(used), stock: r3(opening + bought - used),
        spend: r2(Number(P.get(i.id)?.amount || 0)),
        last_purchase: dstr(P.get(i.id)?.last_date), last_used: dstr(C.get(i.id)?.last_date),
      };
    });
  }

  app.get(`${BASE}/data`, ...guard, route(async (req) => {
    const [items, purchases, consumption, lists] = await Promise.all([
      stockRows(),
      q('SELECT * FROM oi_purchases ORDER BY purchase_date DESC, created_at DESC, id DESC'),
      q('SELECT * FROM oi_consumption ORDER BY use_date DESC, created_at DESC, id DESC'),
      readLists(),
    ]);
    const name = new Map(items.map((i) => [i.id, i.name]));
    return {
      manage: req.oi.manage,
      items, lists,
      purchases: purchases.map((p) => ({
        id: p.id, bill_ref: p.bill_ref || '', purchase_date: dstr(p.purchase_date), branch: p.branch || '', vendor: p.vendor || '',
        bill_no: p.bill_no || '', item_id: p.item_id, item_name: name.get(p.item_id) || p.item_id, category: p.category || '', unit: p.unit || '',
        qty: Number(p.qty), rate: Number(p.rate), gst: Number(p.gst), total: Number(p.total),
        invoice_url: p.invoice_url || '', has_file: !!p.invoice_file, added_by: p.added_by || '', source: p.source,
        created_at: tsOut(p.created_at),
      })),
      consumption: consumption.map((c) => ({
        id: c.id, use_date: dstr(c.use_date), item_id: c.item_id, item_name: name.get(c.item_id) || c.item_id,
        used_by: c.used_by || '', qty: Number(c.qty), remarks: c.remarks || '', added_by: c.added_by || '', source: c.source,
        created_at: tsOut(c.created_at),
      })),
    };
  }));

  app.get(`${BASE}/purchases/:id/invoice`, ...guard, route(async (req, res) => {
    const row = (await q('SELECT bill_ref, invoice_file FROM oi_purchases WHERE id = $1', [req.params.id]))[0];
    let doc = null;
    try { doc = JSON.parse(row?.invoice_file || 'null'); } catch {}
    if (!doc?.file) throw new UserError('No invoice file on this purchase', 404);
    res.download(path.join(UPLOAD_ROOT, path.basename(row.bill_ref), path.basename(doc.file)), doc.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'The invoice file is missing on the server' });
    });
  }));

  /* ── Items ─────────────────────────────────────────────────────── */

  function itemFromBody(b) {
    const it = {
      name: str(b.name), category: str(b.category, 128), unit: str(b.unit, 32) || 'Pcs',
      opening_qty: b.opening_qty === '' || b.opening_qty == null ? 0 : num(b.opening_qty),
      min_qty: b.min_qty === '' || b.min_qty == null ? 0 : num(b.min_qty),
      active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
    };
    if (!it.name) bad('Item name is required');
    if (!(it.opening_qty >= 0)) bad('Opening stock must be 0 or more');
    if (!(it.min_qty >= 0)) bad('Minimum stock must be 0 or more');
    return it;
  }

  app.post(`${BASE}/items`, ...guard, route(async (req) => {
    const it = itemFromBody(req.body || {});
    const dup = await q('SELECT id FROM oi_items WHERE LOWER(name) = LOWER($1)', [it.name]);
    if (dup.length) bad(`"${it.name}" is already an item (${dup[0].id})`);
    const id = await withSeqId('oi_items', 'ITM', 4, (nid) => q(
      'INSERT INTO oi_items (id, name, category, unit, opening_qty, min_qty, active) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [nid, it.name, it.category, it.unit, it.opening_qty, it.min_qty, it.active]));
    await remember([['categories', it.category], ['units', it.unit]]);
    return { id };
  }));

  app.patch(`${BASE}/items/:id`, ...guard, route(async (req) => {
    const it = itemFromBody(req.body || {});
    const dup = await q('SELECT id FROM oi_items WHERE LOWER(name) = LOWER($1) AND id <> $2', [it.name, req.params.id]);
    if (dup.length) bad(`Another item is already named "${it.name}"`);
    const r = await pool.query('UPDATE oi_items SET name=$1, category=$2, unit=$3, opening_qty=$4, min_qty=$5, active=$6 WHERE id=$7',
      [it.name, it.category, it.unit, it.opening_qty, it.min_qty, it.active, req.params.id]);
    if (!r.rowCount) throw new UserError('Item not found', 404);
    await remember([['categories', it.category], ['units', it.unit]]);
    return { ok: true };
  }));

  app.delete(`${BASE}/items/:id`, ...guard, route(async (req) => {
    const used = await q(`SELECT (SELECT COUNT(*) FROM oi_purchases WHERE item_id=$1) + (SELECT COUNT(*) FROM oi_consumption WHERE item_id=$1) AS n`, [req.params.id]);
    if (Number(used[0].n)) bad('This item has purchases or consumption — mark it Inactive instead');
    await q('DELETE FROM oi_items WHERE id = $1', [req.params.id]);
    return { ok: true };
  }, { manage: true }));

  /* ── Purchases ─────────────────────────────────────────────────── */

  app.post(`${BASE}/purchases`, ...guard, route(async (req) => {
    const b = req.body || {};
    const date = dateIn(b.purchase_date, 'Date of purchase');
    const branch = str(b.branch, 128) || bad('Choose the company branch');
    const vendor = str(b.vendor) || bad('Choose the vendor');
    const billNo = str(b.bill_no, 64);
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!lines.length) bad('Add at least one item');
    if (lines.length > 50) bad('At most 50 items on one bill');
    const items = new Map((await q('SELECT * FROM oi_items')).map((i) => [i.id, i]));
    const clean = lines.map((l, i) => {
      const it = items.get(str(l.item_id, 16));
      if (!it) bad(`Line ${i + 1}: choose an item`);
      const qty = num(l.qty), rate = num(l.rate), gst = l.gst === '' || l.gst == null ? 0 : num(l.gst);
      if (!(qty > 0)) bad(`Line ${i + 1} (${it.name}): quantity must be more than 0`);
      if (!(rate >= 0)) bad(`Line ${i + 1} (${it.name}): rate is not a number`);
      if (!(gst >= 0 && gst <= 100)) bad(`Line ${i + 1} (${it.name}): GST % looks wrong`);
      return { it, qty: r3(qty), rate: r2(rate), gst, total: r2(qty * rate * (1 + gst / 100)) };
    });
    let invoice = null;
    if (b.invoice?.dataUrl) {
      const p = parseDataUrl(b.invoice.dataUrl);
      const ext = p && DOC_TYPES[p.mimeType];
      if (!ext) bad('The invoice must be a PDF or an image');
      if (p.buffer.length > 6 * 1024 * 1024) bad('The invoice file is over 6 MB');
      invoice = { name: str(b.invoice.name, 120) || `invoice.${ext}`, ext, buffer: p.buffer };
    }
    const billRef = 'B' + Date.now().toString(36).toUpperCase();
    let fileMeta = null;
    if (invoice) {
      const dir = path.join(UPLOAD_ROOT, billRef);
      await fs.promises.mkdir(dir, { recursive: true });
      const file = `${(invoice.name.replace(/\.[^.]*$/, '').replace(/[^\w.\- ()]/g, '_') || 'invoice')}.${invoice.ext}`;
      await fs.promises.writeFile(path.join(dir, file), invoice.buffer);
      fileMeta = JSON.stringify({ name: invoice.name, file });
    }
    const ids = [];
    for (const l of clean) {
      ids.push(await withSeqId('oi_purchases', 'PUR', 5, (nid) => q(
        `INSERT INTO oi_purchases (id, bill_ref, purchase_date, branch, vendor, bill_no, item_id, category, unit, qty, rate, gst, total, invoice_url, invoice_file, added_by, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'',$14,$15,'erp')`,
        [nid, billRef, date, branch, vendor, billNo, l.it.id, l.it.category || '', l.it.unit || '', l.qty, l.rate, l.gst, l.total, fileMeta, req.oi.by])));
    }
    await remember([['branches', branch], ['vendors', vendor], ...clean.map((l) => ['gst', String(l.gst)])]);
    return { ids, total: r2(clean.reduce((n, l) => n + l.total, 0)) };
  }));

  app.delete(`${BASE}/purchases/:id`, ...guard, route(async (req) => {
    const row = (await q('SELECT * FROM oi_purchases WHERE id = $1', [req.params.id]))[0];
    if (!row) throw new UserError('Purchase not found', 404);
    await q('DELETE FROM oi_purchases WHERE id = $1', [row.id]);
    // The invoice file goes with the last line that used it.
    if (row.invoice_file && row.bill_ref && !(await q('SELECT id FROM oi_purchases WHERE bill_ref = $1 LIMIT 1', [row.bill_ref])).length) {
      fs.promises.rm(path.join(UPLOAD_ROOT, path.basename(row.bill_ref)), { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true };
  }, { manage: true }));

  /* ── Consumption ───────────────────────────────────────────────── */

  app.post(`${BASE}/consumption`, ...guard, route(async (req) => {
    const b = req.body || {};
    const date = dateIn(b.use_date, 'Date');
    const usedBy = str(b.used_by) || bad('Choose who used it');
    const remarks = str(b.remarks, 2000);
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!lines.length) bad('Add at least one item');
    if (lines.length > 50) bad('At most 50 items at a time');
    const stock = new Map((await stockRows()).map((s) => [s.id, s]));
    const want = new Map();
    const clean = lines.map((l, i) => {
      const s = stock.get(str(l.item_id, 16));
      if (!s) bad(`Line ${i + 1}: choose an item`);
      const qty = num(l.qty);
      if (!(qty > 0)) bad(`Line ${i + 1} (${s.name}): quantity must be more than 0`);
      want.set(s.id, r3((want.get(s.id) || 0) + qty));
      return { s, qty: r3(qty) };
    });
    // Nobody can use what the cupboard doesn't have.
    for (const [id, qty] of want) {
      const s = stock.get(id);
      if (qty > s.stock + 1e-9) bad(`Only ${s.stock} ${s.unit} of "${s.name}" is in stock — can't record ${qty}`);
    }
    const ids = [];
    for (const l of clean) {
      ids.push(await withSeqId('oi_consumption', 'CON', 5, (nid) => q(
        `INSERT INTO oi_consumption (id, use_date, item_id, used_by, qty, remarks, added_by, source) VALUES ($1,$2,$3,$4,$5,$6,$7,'erp')`,
        [nid, date, l.s.id, usedBy, l.qty, remarks, req.oi.by])));
    }
    await remember([['users', usedBy]]);
    return { ids };
  }));

  app.delete(`${BASE}/consumption/:id`, ...guard, route(async (req) => {
    const r = await pool.query('DELETE FROM oi_consumption WHERE id = $1', [req.params.id]);
    if (!r.rowCount) throw new UserError('Entry not found', 404);
    return { ok: true };
  }, { manage: true }));

  /* ── Settings: dropdown lists ──────────────────────────────────── */

  app.post(`${BASE}/lists`, ...guard, route(async (req) => {
    const b = req.body || {};
    const lists = await readLists();
    for (const k of LIST_KEYS) {
      if (b[k] === undefined) continue;
      if (!Array.isArray(b[k])) bad(`${k}: send a list`);
      lists[k] = uniq(b[k]).slice(0, 500);
    }
    if (lists.gst.some((g) => !(num(g) >= 0 && num(g) <= 100))) bad('GST values must be numbers between 0 and 100');
    await writeLists(lists);
    return lists;
  }, { manage: true }));

  /* ── Import the old Google Sheet ───────────────────────────────── */

  async function readSheet() {
    const auth = getGoogleAuth();
    if (!auth) bad('Google is not configured on this server');
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const tabs = ['All Items', 'Purchase Stock', 'Opening Stock', 'Consumption', 'Helper', 'Current Remaining Stock'];
    let r;
    try {
      r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges: tabs.map((t) => `'${t}'!A:Z`) });
    } catch (e) {
      bad(`Could not read the Inventory sheet — share it with the ERP's Google account. (${e.message})`);
    }
    const out = {};
    r.data.valueRanges.forEach((v, i) => { out[tabs[i]] = (v.values || []).slice(1); });
    return out;
  }

  app.post(`${BASE}/import`, ...guard, route(async (req) => {
    if (!isSuperAdmin(req.oi.user) && !isAdminUser(req.oi.user)) bad('Only an Admin can import');
    const d = await readSheet();
    const warnings = [];
    const key = (s) => str(s).toLowerCase().replace(/\s+/g, ' ');

    // Items: everything named anywhere in the sheet, first spelling wins.
    const items = new Map();
    const touch = (name, extra = {}) => {
      const n = str(name);
      if (!n) return null;
      const k = key(n);
      if (!items.has(k)) items.set(k, { name: n, category: '', unit: '', opening: 0 });
      const it = items.get(k);
      if (extra.category) it.category = extra.category;
      if (extra.unit) it.unit = extra.unit;
      return it;
    };
    d['All Items'].forEach((r) => touch(r[0]));
    d.Helper.forEach((r) => touch(r[0]));
    d['Opening Stock'].forEach((r) => {
      const it = touch(r[0], { category: str(r[1]) });
      if (it) it.opening = r3(it.opening + (num(r[2]) || 0));
    });

    const purchases = [];
    d['Purchase Stock'].forEach((r, i) => {
      if (!str(r[4])) return;
      const date = sheetDate(r[0]);
      if (!date) { warnings.push(`Purchase row ${i + 2}: unreadable date "${r[0]}" — skipped`); return; }
      const cat = str(r[3]);
      const it = touch(r[4], { category: cat ? cat[0].toUpperCase() + cat.slice(1) : '', unit: str(r[5]) });
      purchases.push({ date, branch: str(r[1]), vendor: str(r[2]), it, category: cat, unit: str(r[5]),
        qty: num(r[6]) || 0, rate: num(r[7]) || 0, gst: num(r[8]) || 0, total: num(r[9]) || 0, url: str(r[10], 2000), by: str(r[11]) });
    });
    const consumption = [];
    d.Consumption.forEach((r, i) => {
      if (!str(r[1])) return;
      const date = sheetDate(r[0], { mdyWithTime: true });
      if (!date) { warnings.push(`Consumption row ${i + 2}: unreadable date "${r[0]}" — skipped`); return; }
      consumption.push({ date, it: touch(r[1]), by: str(r[2]), qty: num(r[3]) || 0 });
    });

    // Lists from the Helper columns plus whatever the rows actually used.
    const col = (rows, i) => rows.map((r) => r[i]).filter(Boolean);
    const lists = {
      branches: uniq([...col(d.Helper, 6), ...purchases.map((p) => p.branch)]),
      vendors: uniq([...col(d.Helper, 2), ...purchases.map((p) => p.vendor)]),
      categories: uniq([...col(d.Helper, 1), ...purchases.map((p) => p.category)].filter(Boolean).map((c) => c[0].toUpperCase() + c.slice(1))),
      users: uniq([...col(d.Helper, 3), ...consumption.map((c) => c.by)]),
      units: uniq([...col(d.Helper, 5), ...purchases.map((p) => p.unit)]),
      gst: uniq([...col(d.Helper, 4), ...purchases.map((p) => String(p.gst))]).sort((a, b) => num(a) - num(b)),
    };

    // Replace everything. Ids are minted here in order (not withSeqId) since
    // the tables start empty.
    await q('DELETE FROM oi_consumption');
    await q('DELETE FROM oi_purchases');
    await q('DELETE FROM oi_items');
    let n = 0;
    for (const it of items.values()) {
      it.id = 'ITM' + String(++n).padStart(4, '0');
      await q('INSERT INTO oi_items (id, name, category, unit, opening_qty, min_qty, active) VALUES ($1,$2,$3,$4,$5,0,1)',
        [it.id, it.name, it.category, it.unit || 'Pcs', it.opening]);
    }
    n = 0;
    for (const p of purchases) {
      // One bill_ref per invoice link (or per date+vendor when there isn't one).
      const ref = 'S' + Buffer.from(p.url || `${p.date}|${p.vendor}`).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(-20);
      await q(`INSERT INTO oi_purchases (id, bill_ref, purchase_date, branch, vendor, bill_no, item_id, category, unit, qty, rate, gst, total, invoice_url, invoice_file, added_by, source, created_at)
               VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,$11,$12,$13,NULL,$14,'sheet',$15)`,
        ['PUR' + String(++n).padStart(5, '0'), ref, p.date, p.branch, p.vendor, p.it.id, p.category, p.unit, p.qty, p.rate, p.gst, p.total, p.url, p.by, p.date + ' 12:00:00']);
    }
    n = 0;
    for (const c of consumption) {
      await q(`INSERT INTO oi_consumption (id, use_date, item_id, used_by, qty, remarks, added_by, source, created_at) VALUES ($1,$2,$3,$4,$5,'','sheet','sheet',$6)`,
        ['CON' + String(++n).padStart(5, '0'), c.date, c.it.id, c.by, c.qty, c.date + ' 12:00:00']);
    }
    await writeLists(lists);

    /* The sheet's "Current Remaining Stock" is a counter its script kept,
       not a sum of the Consumption log — rows deleted from the log after
       the fact left the two apart. The counter is what the office has been
       reading, so each gap becomes one labelled adjustment row (dated the
       day of import) and the ERP opens on exactly the sheet's figures. */
    const mine = new Map((await stockRows()).map((s) => [key(s.name), s]));
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const adjustments = [];
    for (const r of d['Current Remaining Stock']) {
      const s = mine.get(key(r[0]));
      const want = num(r[1]);
      if (!s || !Number.isFinite(want) || Math.abs(want - s.stock) < 1e-6) continue;
      const diff = r3(s.stock - want);
      if (diff > 0) {
        await q(`INSERT INTO oi_consumption (id, use_date, item_id, used_by, qty, remarks, added_by, source) VALUES ($1,$2,$3,$4,$5,$6,'sheet','sheet')`,
          ['CON' + String(++n).padStart(5, '0'), today, s.id, ADJUST_USER, diff, 'Sheet import: brings stock to the sheet’s "Current Remaining Stock"']);
      } else {
        await q('UPDATE oi_items SET opening_qty = opening_qty + $1 WHERE id = $2', [-diff, s.id]);
      }
      adjustments.push({ item: s.name, log: s.stock, sheet: want, adjusted: -diff });
    }
    return { items: items.size, purchases: purchases.length, consumption: consumption.length, lists, adjustments, warnings };
  }));

  return {};
}

module.exports = { OI_SCHEMA, mountOfficeInventory, _internals: { sheetDate } };
