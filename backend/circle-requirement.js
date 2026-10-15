'use strict';
/* =====================================================================
   Circle Requirement — how many kg of aluminium circle to order for an
   export order.
   ---------------------------------------------------------------------
   Replaces the hand-made "ORDER NO. ... PLANNING" sheets. The planner used
   to look up every ordered item in the "MASTER DATA SAIF PLUS" workbook,
   copy its body and cover circle size and per-piece weight into a new
   sheet, multiply by quantity, add 10 % and round off, then add up a
   summary per circle size and gauge by hand (=J34+J36+J62 ...). Here the
   master lives in the ERP and a plan only needs order no., item, size and
   quantity — the page (public/js/pages/circle-requirement.js) does the
   rest and exports the same two blocks to Excel.

   Master rows (cr_master, one JSON document per row):
     kind 'item'  an item + size with its own body/cover circle
          'set'   a set (e.g. Busrai Tope 9X15 (7Pcs)); its circles are its
                  'part' rows, each carrying parent_id = the set's id
          'part'  one size inside a set
   Circle fields: body_dia/body_w/body_t/body_wt and cover_*; dia/w are in
   inches (unit 'in') or mm (unit 'mm', the tawas), t in mm, wt in kg/pc.
   body_w > 0 means a rectangle blank (L x W), not a round circle.

   Import reads the master workbook (MASTER_FILE_ID on Drive, or an
   uploaded .xlsx of the same layout) and merges by code + size, so rows
   added or corrected in the ERP survive a re-import. Sets the sheet left
   without part rows get them from the matching size series when every
   size is known (see deriveSetParts) — flagged auto so they can be checked.

   Plans (cr_plans): title + data JSON { extra_pct, round_step, round_mode,
   lines[], extras[] }. Calculation is done in the page, never stored.

   Access: page key 'circle-requirement' (requireAdminOrPage in server.js).
   Works in local JSON mode too (database/circle-requirement.json).
   ===================================================================== */

const fsp = require('fs').promises;
const path = require('path');

// "MASTER DATA SAIF PLUS-07-10-2026.xlsx" — shared with the service account.
const MASTER_FILE_ID = '1xihGYZ7QAxV11hXsKBPww8ineOkqzaWM';
const JSON_FILE = path.join(__dirname, '..', 'database', 'circle-requirement.json');

const CR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cr_master (
     id VARCHAR(16) PRIMARY KEY,
     sort_no INT NOT NULL DEFAULT 0,
     data LONGTEXT NOT NULL,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS cr_plans (
     id VARCHAR(16) PRIMARY KEY,
     title VARCHAR(255) NOT NULL DEFAULT '',
     data LONGTEXT NOT NULL,
     created_by VARCHAR(255) DEFAULT '',
     updated_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg) => { throw new UserError(msg); };
const str = (v, max = 255) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, '').replace(/mm$/i, ''));
  return Number.isFinite(n) ? n : 0;
};
const r3 = (n) => Math.round(n * 1000) / 1000;
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// Same density the master's weights were worked out with: every round
// circle in it is pi/4 x (D x 25.4)^2 x T x 2.8 g/cm3, to the gram.
const DENSITY = 2.8;
function circleWt(dia, w, t, unit = 'in') {
  if (!(dia > 0) || !(t > 0)) return 0;
  const k = unit === 'mm' ? 1 : 25.4;
  const area = w > 0 ? dia * k * w * k : Math.PI / 4 * (dia * k) ** 2;
  return r3(area * t * DENSITY / 1e6);
}

const MASTER_FIELDS = ['kind', 'parent_id', 'item', 'size', 'swg', 'code', 'pcs_box', 'net_wt', 'unit',
  'body_dia', 'body_w', 'body_t', 'body_wt', 'cover_dia', 'cover_w', 'cover_t', 'cover_wt', 'remarks', 'auto'];
const NUM_FIELDS = new Set(['pcs_box', 'net_wt', 'body_dia', 'body_w', 'body_t', 'body_wt', 'cover_dia', 'cover_w', 'cover_t', 'cover_wt']);

function cleanMaster(src) {
  const m = {};
  for (const f of MASTER_FIELDS) {
    if (NUM_FIELDS.has(f)) m[f] = r3(num(src[f]));
    else if (f === 'auto') m[f] = !!src[f];
    else m[f] = str(src[f], f === 'remarks' ? 500 : 255);
  }
  if (!['item', 'set', 'part'].includes(m.kind)) m.kind = 'item';
  if (m.unit !== 'mm') m.unit = 'in';
  return m;
}

/* ── Reading the master workbook ──────────────────────────────────── */

// The sheet has one header row; the circle blocks are three columns wide
// (L, W, T) with only the first labelled, followed by their weight column.
function parseMasterWorkbook(buffer) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const hi = rows.slice(0, 8).findIndex((r) => r.some((c) => /OUR ITEM NAME/i.test(String(c))));
    if (hi < 0) continue;
    const H = rows[hi].map((c) => String(c).replace(/\s+/g, ' ').trim().toUpperCase());
    const col = (re, from = 0) => { const i = H.findIndex((h, k) => k >= from && re.test(h)); return i; };
    const C = {
      item: col(/OUR ITEM NAME/), size: col(/^SIZE$/), swg: col(/^SWG$/), net: col(/NET\. ?WT/),
      pcs: col(/PACKING/), code: col(/PRODUCT CODE/), remarks: col(/^REMARKS/),
      body: col(/BODY CIRCLE SIZE/), bodyWt: col(/BODY CIRCLE GR/),
      cover: col(/COVER CIRCLE SIZE/), coverWt: col(/COVER GR/),
    };
    if (C.item < 0 || C.body < 0 || C.bodyWt < 0) bad(`Sheet "${name}" is missing the item / body circle columns`);
    return { sheet: name, rows: masterFromRows(rows.slice(hi + 1), C) };
  }
  bad('No sheet with an "OUR ITEM NAME" header was found in that workbook');
}

const cellOk = (v) => v !== '' && v != null && !/^#/.test(String(v));
function dims(r, at) {
  // "360MM" means the tawa blanks, measured in mm rather than inches.
  const raw = [r[at], r[at + 1], r[at + 2]];
  const unit = raw.some((v) => /mm/i.test(String(v))) ? 'mm' : 'in';
  return { unit, dia: num(raw[0]), w: num(raw[1]), t: num(raw[2]) };
}

function masterFromRows(rows, C) {
  const out = [];
  let lastTop = null;
  rows.forEach((r) => {
    const item = str(r[C.item]);
    const size = str(r[C.size]);
    if (!item && !size) return;
    const b = cellOk(r[C.body]) ? dims(r, C.body) : { unit: 'in', dia: 0, w: 0, t: 0 };
    const c = C.cover >= 0 && cellOk(r[C.cover]) ? dims(r, C.cover) : { unit: 'in', dia: 0, w: 0, t: 0 };
    const row = {
      item, size, swg: str(r[C.swg]), code: C.code >= 0 ? str(r[C.code]) : '',
      pcs_box: C.pcs >= 0 ? num(r[C.pcs]) : 0, net_wt: C.net >= 0 ? num(r[C.net]) : 0,
      unit: b.unit,
      body_dia: b.dia, body_w: b.w, body_t: b.t, body_wt: cellOk(r[C.bodyWt]) ? num(r[C.bodyWt]) : 0,
      cover_dia: c.dia, cover_w: c.w, cover_t: c.t, cover_wt: C.coverWt >= 0 && cellOk(r[C.coverWt]) ? num(r[C.coverWt]) : 0,
      remarks: C.remarks >= 0 ? str(r[C.remarks], 500) : '',
    };
    if (item) {
      row.kind = 'item';
      out.push(row);
      lastTop = row;
    } else if (lastTop && row.body_dia > 0) {
      // A row with only a size under an item: one size of that set.
      row.kind = 'part';
      row.item = lastTop.item;
      row._parent = lastTop;
      lastTop.kind = 'set';
      out.push(row);
    }
  });
  // An item row with no circle of its own whose size reads like a set
  // ("9X15 (7Pcs)", "10,13,17,21", "6, 7 & 8", "Set of 3") is a set too.
  for (const r of out) {
    if (r.kind === 'item' && !(r.body_dia > 0) && /PCS|SET|,|&/i.test(r.size)) r.kind = 'set';
    if (!(r.body_wt > 0) && r.body_dia > 0) r.body_wt = circleWt(r.body_dia, r.body_w, r.body_t, r.unit);
    if (!(r.cover_wt > 0) && r.cover_dia > 0) r.cover_wt = circleWt(r.cover_dia, r.cover_w, r.cover_t, r.unit);
  }
  return out;
}

// Sizes a set's name spells out: "9X15 (7Pcs)" -> 9..15 (a step of 2 when
// the piece count says so, e.g. 24x32 10 pcs = 24,26,..,32 with lids);
// "10,13,17,21" and "6, 7 & 8" -> the listed sizes.
function setSizes(size) {
  const s = String(size || '');
  const range = /^\s*(\d+)\s*[xX]\s*(\d+)/.exec(s);
  if (range) {
    const a = +range[1], b = +range[2];
    if (!(b > a)) return null;
    const pcs = +((/\((\d+)\s*p/i.exec(s) || [])[1] || 0);
    let step = 1;
    if (pcs && pcs !== b - a + 1 && pcs !== 2 * (b - a + 1)) {
      if (pcs === (b - a) / 2 + 1 || pcs === 2 * ((b - a) / 2 + 1)) step = 2; else return null;
    }
    const list = [];
    for (let v = a; v <= b; v += step) list.push(v);
    return list;
  }
  const list = s.split(/[,&]/).map((x) => x.trim()).filter(Boolean);
  if (list.length > 1 && list.every((x) => /^\d+(\.\d+)?$/.test(x))) return list.map(Number);
  return null;
}

/* The sheet lists the size-by-size circles for only some sets (Busrai Tope
   9X23 15 pcs at 1.22 and at 2.03); the planner reused those for the 7, 10
   and 9 piece sets. Do the same: for a set without parts, take each size
   from a known part of that size — same body thickness first, any otherwise,
   in which case the body weight is reworked for this set's thickness. */
function deriveSetParts(rows) {
  const parts = rows.filter((r) => r.kind === 'part');
  const added = [];
  for (const set of rows.filter((r) => r.kind === 'set')) {
    if (rows.some((r) => r.kind === 'part' && (r._parent === set || (r.parent_id && r.parent_id === set.id)))) continue;
    const sizes = setSizes(set.size);
    if (!sizes) continue;
    const t = String(set.swg).split(/[,/]/).map((x) => num(x)).filter((x) => x > 0);
    const bodyT = t[0] || 0;
    const coverT = t[1] || 0;
    // Only from a set of the same family ("Busrai ..." from "Busrai ..."):
    // a canister 9,10,11 must not borrow a tope's 9" circle.
    const family = norm(set.item).split(' ')[0];
    const pick = sizes.map((sz) => {
      const same = parts.filter((p) => num(p.size) === sz && norm(p.item).split(' ')[0] === family);
      return same.find((p) => p.body_t === bodyT && (!coverT || p.cover_t === coverT)) || same.find((p) => !coverT || p.cover_t === coverT) || same[0];
    });
    if (!bodyT || pick.some((p) => !p)) continue;
    pick.forEach((p, i) => {
      const row = { ...p, _parent: set, parent_id: set.id || '', item: set.item, size: String(sizes[i]), swg: set.swg, kind: 'part', auto: true, remarks: 'Auto: circles copied from the same size in another set — check once' };
      delete row.id;
      if (row.body_t !== bodyT) { row.body_t = bodyT; row.body_wt = circleWt(row.body_dia, row.body_w, bodyT, row.unit); }
      if (coverT && row.cover_t !== coverT) { row.cover_t = coverT; row.cover_wt = circleWt(row.cover_dia, row.cover_w, coverT, row.unit); }
      added.push(row);
    });
  }
  return added;
}

/* ===================================================================== */

function mountCircleRequirement(app, ctx) {
  const { q, ensureSchema, requireAuth, requireAccess, isAdminUser, isSuperAdmin, getGoogleAuth, useDb } = ctx;
  const BASE = '/api/circle-requirement';
  const canManage = (u) => isSuperAdmin(u) || isAdminUser(u);

  /* ── Storage: tables in the DB, one JSON file in local JSON mode ── */

  async function readFile() {
    try { return JSON.parse(await fsp.readFile(JSON_FILE, 'utf8')); }
    catch { return { master: [], plans: [] }; }
  }
  async function writeFile(d) {
    await fsp.mkdir(path.dirname(JSON_FILE), { recursive: true });
    await fsp.writeFile(JSON_FILE, JSON.stringify(d, null, 1));
  }
  const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
  const tsOut = (v) => (v instanceof Date ? v.toISOString() : v || null);
  const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

  const store = {
    async master() {
      if (!useDb) return (await readFile()).master;
      const rows = await q('SELECT id, data FROM cr_master ORDER BY sort_no, id');
      return rows.map((r) => ({ ...parse(r.data), id: r.id }));
    },
    // The whole master in one go — import and the rare full save. Batched
    // inserts: one INSERT per row timed out on the host for a few hundred.
    async replaceMaster(list) {
      if (!useDb) { const d = await readFile(); d.master = list; return writeFile(d); }
      await q('DELETE FROM cr_master');
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const params = [];
        const values = chunk.map((m, k) => {
          params.push(m.id, i + k, JSON.stringify({ ...m, id: undefined }));
          return `($${params.length - 2},$${params.length - 1},$${params.length})`;
        });
        await q(`INSERT INTO cr_master (id, sort_no, data) VALUES ${values.join(',')}`, params);
      }
    },
    async saveMasterRow(m, sortNo) {
      if (!useDb) {
        const d = await readFile();
        const i = d.master.findIndex((x) => x.id === m.id);
        if (i >= 0) d.master[i] = m; else d.master.push(m);
        return writeFile(d);
      }
      const data = JSON.stringify({ ...m, id: undefined });
      const ex = await q('SELECT id FROM cr_master WHERE id = $1', [m.id]);
      if (ex.length) await q('UPDATE cr_master SET data = $1, updated_at = $2 WHERE id = $3', [data, nowSql(), m.id]);
      else await q('INSERT INTO cr_master (id, sort_no, data) VALUES ($1,$2,$3)', [m.id, sortNo, data]);
    },
    async deleteMasterRows(ids) {
      if (!ids.length) return;
      if (!useDb) { const d = await readFile(); d.master = d.master.filter((x) => !ids.includes(x.id)); return writeFile(d); }
      await q(`DELETE FROM cr_master WHERE id IN (${ids.map((_, i) => '$' + (i + 1)).join(',')})`, ids);
    },
    async plans() {
      if (!useDb) return (await readFile()).plans.map((p) => ({ ...p, data: undefined, lines: (p.data?.lines || []).length }));
      const rows = await q('SELECT id, title, data, created_by, updated_by, created_at, updated_at FROM cr_plans ORDER BY created_at DESC, id DESC');
      return rows.map((r) => ({
        id: r.id, title: r.title, created_by: r.created_by, updated_by: r.updated_by,
        created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at), lines: (parse(r.data).lines || []).length,
      }));
    },
    async plan(id) {
      if (!useDb) return (await readFile()).plans.find((p) => p.id === id) || null;
      const rows = await q('SELECT * FROM cr_plans WHERE id = $1', [id]);
      if (!rows.length) return null;
      const r = rows[0];
      return { id: r.id, title: r.title, data: parse(r.data), created_by: r.created_by, updated_by: r.updated_by, created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at) };
    },
    async savePlan(p, isNew) {
      if (!useDb) {
        const d = await readFile();
        const i = d.plans.findIndex((x) => x.id === p.id);
        const now = new Date().toISOString();
        if (i >= 0) d.plans[i] = { ...d.plans[i], ...p, updated_at: now };
        else d.plans.unshift({ ...p, created_at: now, updated_at: now });
        return writeFile(d);
      }
      const data = JSON.stringify(p.data);
      if (isNew) await q('INSERT INTO cr_plans (id, title, data, created_by, updated_by) VALUES ($1,$2,$3,$4,$5)', [p.id, p.title, data, p.created_by, p.updated_by]);
      else await q('UPDATE cr_plans SET title = $1, data = $2, updated_by = $3, updated_at = $4 WHERE id = $5', [p.title, data, p.updated_by, nowSql(), p.id]);
    },
    async deletePlan(id) {
      if (!useDb) { const d = await readFile(); d.plans = d.plans.filter((x) => x.id !== id); return writeFile(d); }
      await q('DELETE FROM cr_plans WHERE id = $1', [id]);
    },
  };

  // Ids are minted here rather than by withSeqId so the JSON store gets the
  // same ones: prefix + the next number after the largest in use.
  const nextId = (list, prefix, width) => {
    const max = list.reduce((m, x) => {
      const n = String(x.id || '').startsWith(prefix) ? parseInt(String(x.id).slice(prefix.length), 10) : 0;
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return (k = 1) => prefix + String(max + k).padStart(width, '0');
  };

  function route(fn, { manage = false } = {}) {
    return async (req, res) => {
      try {
        if (useDb) await ensureSchema();
        const user = req.session.user;
        if (manage && !canManage(user)) return res.status(403).json({ error: 'Only an Admin/HOD can change the master' });
        req.cr = { user, by: user?.name || user?.email || '', manage: canManage(user) };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[circle-requirement]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  const guard = [requireAuth, requireAccess];

  /* ── Master ────────────────────────────────────────────────────── */

  app.get(`${BASE}/master`, ...guard, route(async (req) => ({ manage: req.cr.manage, master: await store.master() })));

  // Merge imported rows into what is there: same code + size (or, for set
  // parts and code-less rows, same item + size + parent) keeps its id and
  // takes the sheet's values; rows only in the ERP are kept as they are.
  async function mergeImport(rows) {
    const existing = await store.master();
    const byKey = new Map();
    const keyOf = (r, parent) => (r.kind === 'part'
      ? `P|${parent?.code || norm(parent?.item)}|${norm(parent?.size)}|${norm(r.size)}`
      : r.code ? `C|${norm(r.code)}|${norm(r.size)}` : `N|${norm(r.item)}|${norm(r.size)}`);
    const exById = new Map(existing.map((r) => [r.id, r]));
    existing.forEach((r) => byKey.set(keyOf(r, exById.get(r.parent_id)), r));
    const mint = nextId(existing, 'CM', 5);
    let k = 0, added = 0, updated = 0;
    const seen = new Set();
    // Top-level rows first so a part can point at its set's id.
    for (const r of rows.filter((x) => x.kind !== 'part')) {
      const ex = byKey.get(keyOf(r));
      r.id = ex ? ex.id : mint(++k);
      if (ex) updated++; else added++;
    }
    for (const r of rows.filter((x) => x.kind === 'part')) {
      r.parent_id = r._parent.id;
      const ex = byKey.get(keyOf(r, r._parent));
      r.id = ex ? ex.id : mint(++k);
      if (ex) updated++; else added++;
    }
    const merged = [];
    const incoming = new Map(rows.map((r) => [r.id, r]));
    // Order: the sheet's own order, each set followed by its parts, then
    // anything that exists only in the ERP.
    for (const r of rows.filter((x) => x.kind !== 'part')) {
      merged.push({ ...cleanMaster(r), id: r.id });
      seen.add(r.id);
      for (const p of rows.filter((x) => x.kind === 'part' && x._parent === r)) { merged.push({ ...cleanMaster(p), id: p.id }); seen.add(p.id); }
      for (const p of existing.filter((x) => x.parent_id === r.id && !incoming.has(x.id))) { merged.push(p); seen.add(p.id); }
    }
    const kept = existing.filter((x) => !seen.has(x.id));
    merged.push(...kept);
    await store.replaceMaster(merged);
    return { added, updated, kept: kept.length, total: merged.length };
  }

  async function importBuffer(buf, label) {
    const { sheet, rows } = parseMasterWorkbook(buf);
    if (!rows.length) bad('No item rows were found in that workbook');
    // Parts for sets the sheet left blank — only where no part exists yet,
    // in the sheet or already in the ERP.
    const existing = await store.master();
    const exSets = new Map(existing.filter((r) => r.kind === 'set').map((r) => [`${norm(r.code)}|${norm(r.size)}`, r]));
    const hasErpParts = (set) => {
      const ex = exSets.get(`${norm(set.code)}|${norm(set.size)}`);
      return ex && existing.some((r) => r.parent_id === ex.id);
    };
    const derived = deriveSetParts(rows.filter((r) => !(r.kind === 'set' && hasErpParts(r))));
    // Insert each derived part right after its set's rows.
    const all = [];
    for (const r of rows) {
      all.push(r);
      if (r.kind !== 'part') all.push(...derived.filter((d) => d._parent === r));
    }
    const out = await mergeImport(all);
    console.log(`[circle-requirement] master import from ${label} (${sheet}):`, out);
    return { ...out, sheet, derived: derived.length };
  }

  app.post(`${BASE}/master/import`, ...guard, route(async () => {
    const auth = getGoogleAuth();
    if (!auth) bad('Google credentials are not set on this server');
    const { google } = require('googleapis');
    const drive = google.drive({ version: 'v3', auth });
    let buf;
    try {
      const r = await drive.files.get({ fileId: MASTER_FILE_ID, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
      buf = Buffer.from(r.data);
    } catch (e) {
      bad('Could not read the master sheet from Drive (' + e.message + '). Is it still shared with the service account?');
    }
    return importBuffer(buf, 'Drive');
  }, { manage: true }));

  app.post(`${BASE}/master/upload`, ...guard, route(async (req) => {
    const m = /^data:[^;,]*;base64,(.*)$/s.exec(String(req.body?.file || ''));
    if (!m) bad('Choose the master .xlsx file');
    return importBuffer(Buffer.from(m[1], 'base64'), 'upload ' + str(req.body?.name));
  }, { manage: true }));

  app.post(`${BASE}/master`, ...guard, route(async (req) => {
    const m = cleanMaster(req.body || {});
    if (!m.item) bad('Item name is required');
    if (!m.size) bad('Size is required');
    const list = await store.master();
    if (m.kind === 'part') {
      const parent = list.find((x) => x.id === m.parent_id && x.kind === 'set');
      if (!parent) bad('That set is not in the master');
      m.item = parent.item;
    } else m.parent_id = '';
    const id = str(req.body?.id, 16);
    if (id) {
      const ex = list.find((x) => x.id === id);
      if (!ex) bad('That master row no longer exists', 404);
      if (ex.kind === 'set' && m.kind !== 'set' && list.some((x) => x.parent_id === id)) bad('Delete this set’s sizes first, or keep it a set');
      await store.saveMasterRow({ ...m, id }, 0);
      return { id };
    }
    const dup = list.find((x) => x.kind === m.kind && norm(x.item) === norm(m.item) && norm(x.size) === norm(m.size) && (x.parent_id || '') === (m.parent_id || ''));
    if (dup) bad(`${m.item} ${m.size} is already in the master (${dup.id})`);
    const newId = nextId(list, 'CM', 5)();
    // A new set part sorts after its set's other rows; anything else last.
    await store.saveMasterRow({ ...m, id: newId }, list.length + 1);
    return { id: newId };
  }, { manage: true }));

  app.delete(`${BASE}/master/:id`, ...guard, route(async (req) => {
    const list = await store.master();
    const ids = [req.params.id, ...list.filter((x) => x.parent_id === req.params.id).map((x) => x.id)];
    await store.deleteMasterRows(ids);
    return { deleted: ids.length };
  }, { manage: true }));

  /* ── Plans ─────────────────────────────────────────────────────── */

  const LINE_PART = (p) => ({
    mode: ['need', 'stock', 'skip'].includes(p?.mode) ? p.mode : 'need',
    unit: p?.unit === 'mm' ? 'mm' : 'in',
    dia: r3(num(p?.dia)), w: r3(num(p?.w)), t: r3(num(p?.t)), wt: r3(num(p?.wt)),
  });
  function planFromBody(b) {
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 1000).map((l) => ({
      order_no: str(l.order_no, 64), master_id: str(l.master_id, 16), grp: str(l.grp, 32),
      item: str(l.item), size: str(l.size, 64), qty: Math.max(0, num(l.qty)), remark: str(l.remark, 255),
      body: LINE_PART(l.body), cover: LINE_PART(l.cover),
    })).filter((l) => l.item || l.qty);
    const extras = (Array.isArray(b.extras) ? b.extras : []).slice(0, 100).map((x) => ({
      note: str(x.note), unit: x.unit === 'mm' ? 'mm' : 'in', dia: r3(num(x.dia)), w: r3(num(x.w)), t: r3(num(x.t)), kg: r3(num(x.kg)),
    })).filter((x) => x.kg > 0);
    const pct = num(b.extra_pct);
    const step = num(b.round_step);
    return {
      title: str(b.title) || 'Circle requirement',
      data: {
        extra_pct: pct >= 0 && pct <= 100 ? pct : 10,
        round_step: step >= 0 && step <= 1000 ? step : 10,
        round_mode: ['up', 'nearest', 'none'].includes(b.round_mode) ? b.round_mode : 'up',
        lines, extras,
      },
    };
  }

  app.get(`${BASE}/plans`, ...guard, route(async () => ({ plans: await store.plans() })));

  app.get(`${BASE}/plans/:id`, ...guard, route(async (req) => {
    const p = await store.plan(req.params.id);
    if (!p) bad('That plan no longer exists', 404);
    return p;
  }));

  app.post(`${BASE}/plans`, ...guard, route(async (req) => {
    const p = planFromBody(req.body || {});
    if (!p.data.lines.length && !p.data.extras.length) bad('Add at least one item line');
    const id = str(req.body?.id, 16);
    if (id) {
      if (!(await store.plan(id))) bad('That plan no longer exists', 404);
      await store.savePlan({ id, ...p, updated_by: req.cr.by }, false);
      return { id };
    }
    // Retry on a clash: two people saving a new plan at the same moment.
    for (let attempt = 0; attempt < 5; attempt++) {
      const newId = nextId(await store.plans(), 'CR', 4)(1 + attempt);
      try { await store.savePlan({ id: newId, ...p, created_by: req.cr.by, updated_by: req.cr.by }, true); return { id: newId }; }
      catch (e) { if (!(e && (e.code === 'ER_DUP_ENTRY' || e.code === '23505'))) throw e; }
    }
    bad('Could not save — please try again');
  }));

  app.delete(`${BASE}/plans/:id`, ...guard, route(async (req) => {
    await store.deletePlan(req.params.id);
    return { ok: true };
  }));
}

module.exports = { CR_SCHEMA, mountCircleRequirement, parseMasterWorkbook, deriveSetParts, setSizes, circleWt };
