'use strict';
/* =====================================================================
   Production Norms — piece-rate norms per department and the daily
   production booked against them.
   ---------------------------------------------------------------------
   Replaces the "PRODUCTION NORMS ..." workbooks (Welding, NMJ fitting,
   Kettle holing/fitting, Naxi dabba, Rolling & cutting, Pressing, Out
   cutting, Stamping, Spinning). Every sheet in them is the same table:
   item, size, pieces in an 8 hour shift, the day's rate in Rs., and the
   per-piece rate = day rate / pieces. Rolling & cutting and Pressing
   repeat the table once per operator with that operator's own day rate
   (JITU / DEEPAK / BHIKHU, BHARAT / ANAND / VIRENDER 10 HRS).

   Norm rows (pn_norms, one JSON document per row):
     dept, section (a sub-heading such as "MILK CAN" or "BADNA (NAXI)
     WITHOUT BASE"), item, size, worker ('' = everyone, else that
     operator's own rate), norm_pcs (pieces per `hours`, normally 8),
     day_rate, pc_rate (stored only when the sheet gives a per-piece rate
     with no norm, e.g. MILK JUG TOTI & PATRI 0.80; otherwise day_rate /
     norm_pcs), eff_date (the date printed on the sheet), remarks.

   Production (pn_entries): one row per worker x item line of a day sheet.
   A day sheet is (entry_date, dept); saving it replaces that day's lines
   for that department, so editing is just saving again. Each line keeps a
   copy of the norm and rate it was booked at — changing a rate later does
   not rewrite past wages.

   Import reads the norms workbooks themselves (upload, one or several
   files) and merges by dept + section + item + size + worker, so rows
   added or corrected here survive a re-import. The older "SPINNING (2)"
   draft (OLD/NEW norm columns) is skipped.

   Access: page key 'production-norms' (requireAdminOrPage in server.js);
   changing norms needs Admin/HOD. Works in local JSON mode too
   (database/production-norms.json).
   ===================================================================== */

const fsp = require('fs').promises;
const path = require('path');

const JSON_FILE = path.join(__dirname, '..', 'database', 'production-norms.json');

const PN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pn_norms (
     id VARCHAR(16) PRIMARY KEY,
     sort_no INT NOT NULL DEFAULT 0,
     data LONGTEXT NOT NULL,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS pn_entries (
     id VARCHAR(24) PRIMARY KEY,
     entry_date DATE NOT NULL,
     dept VARCHAR(120) NOT NULL DEFAULT '',
     worker VARCHAR(120) NOT NULL DEFAULT '',
     line_no INT NOT NULL DEFAULT 0,
     data LONGTEXT NOT NULL,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     KEY idx_pn_date_dept (entry_date, dept),
     KEY idx_pn_worker (worker)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  /* Every change to a day already saved: who, why, and the lines before and
     after — pay is worked out from these lines, so a change must leave a trail. */
  `CREATE TABLE IF NOT EXISTS pn_day_log (
     id INT AUTO_INCREMENT PRIMARY KEY,
     entry_date DATE NOT NULL,
     dept VARCHAR(120) NOT NULL DEFAULT '',
     action VARCHAR(20) NOT NULL DEFAULT 'edit',
     reason TEXT,
     before_data LONGTEXT,
     after_data LONGTEXT,
     by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     KEY idx_pnlog_date_dept (entry_date, dept)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg) => { throw new UserError(msg); };
const str = (v, max = 255) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r4 = (n) => Math.round(n * 10000) / 10000;
const r2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

const NORM_FIELDS = ['dept', 'section', 'item', 'size', 'worker', 'norm_pcs', 'hours', 'day_rate', 'pc_rate', 'eff_date', 'remarks'];
function cleanNorm(src) {
  const m = {};
  for (const f of NORM_FIELDS) {
    if (['norm_pcs', 'hours', 'day_rate', 'pc_rate'].includes(f)) m[f] = r4(Math.max(0, num(src[f])));
    else if (f === 'eff_date') m[f] = isoDate(src[f]);
    else m[f] = str(src[f], f === 'remarks' ? 500 : 160).toUpperCase();
  }
  if (m.remarks) m.remarks = str(src.remarks, 500);
  if (!(m.hours > 0)) m.hours = 8;
  // The per-piece rate follows the norm unless only a per-piece rate is known.
  if (m.norm_pcs > 0 && m.day_rate > 0) m.pc_rate = r4(m.day_rate / m.norm_pcs);
  return m;
}
const normKey = (m) => [m.dept, m.section, m.item, m.size, m.worker].map(norm).join('|');

/* ── Reading the norms workbooks ──────────────────────────────────── */

const excelDate = (v) => {
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(String(v || '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

// "PRODUCTION NORMS ROLLING & CUTTING" -> "ROLLING & CUTTING",
// "NAXI DABBA /FITTING NORMS LIST" -> "NAXI DABBA / FITTING".
function cleanTitle(t) {
  return str(t).toUpperCase()
    .replace(/\bPRODUCTION NORMS\b|\bNORMS\b|\bLIST\b|\bDEPARTMENTS?\b/g, ' ')
    .replace(/\bCIRLCE\b/g, 'CIRCLE')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\(\s*/g, '(').replace(/\s*\)/g, ')')
    .replace(/\s+/g, ' ').replace(/^[\s/]+|[\s/]+$/g, '').trim();
}

function parseNormsWorkbook(buffer) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const out = [];
  const skipped = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    // A merged cell's value only sits in its top-left cell; spread it so a
    // remark merged over two rows (Pressing: BHARAT over 4.5 and 5.5 NO)
    // reaches both.
    for (const mg of ws['!merges'] || []) {
      const v = grid[mg.s.r]?.[mg.s.c];
      if (v === '' || v == null) continue;
      for (let r = mg.s.r; r <= mg.e.r; r++) {
        grid[r] = grid[r] || [];
        for (let c = mg.s.c; c <= mg.e.c; c++) if (grid[r][c] === '' || grid[r][c] == null) grid[r][c] = v;
      }
    }
    const rows = parseSheet(grid);
    if (rows === null) { skipped.push(name); continue; }
    rows.forEach((r) => { r.sheet = name; });
    out.push(...rows);
  }
  return { rows: out, skipped };
}

const isHeader = (r) => r.some((c) => /^S[RL]\.?\s*NO/i.test(String(c).trim())) && r.some((c) => /8\s*H|\(\s*8/i.test(String(c)));

function parseSheet(grid) {
  const out = [];
  let dept = '', deptFixed = false, section = '', worker = '', effDate = '';
  let C = null;
  const nextNonEmpty = (i) => { for (let k = i + 1; k < grid.length; k++) if ((grid[k] || []).some((c) => c !== '' && c != null)) return grid[k]; return []; };

  for (let i = 0; i < grid.length; i++) {
    const r = grid[i] || [];
    if (!r.some((c) => c !== '' && c != null)) continue;

    if (isHeader(r)) {
      const H = r.map((c) => String(c).replace(/\s+/g, ' ').trim().toUpperCase());
      // The old spinning draft: OLD / NEW norms side by side — not the live sheet.
      if (H.some((h) => /\(OLD\)/.test(h))) return null;
      const col = (re) => H.findIndex((h) => re.test(h));
      C = {
        sr: col(/^S[RL]\.?\s*NO/), item: col(/ITEMS?\s*NAME|^ITEMS?$|MACHINE/), size: col(/^SIZE/),
        pcs: col(/8\s*H|\(\s*8/), rate: col(/RATE PER DAY|PER DAY RATE/), pc: col(/PER PCS/), rem: col(/^REMARK/),
        machine: H.some((h) => /MACHINE/.test(h)),
      };
      continue;
    }

    const texts = [...new Set(r.filter((c) => typeof c === 'string' && c.trim() && !/^DATE$/i.test(c.trim())).map((c) => str(c)))]
      .filter((t) => !excelDate(t));
    const dated = r.some((c) => excelDate(c));
    const srVal = C ? r[C.sr] : '';
    const isData = C && C.item >= 0 && str(r[C.item]) && (typeof srVal === 'number' || /^\d+$/.test(String(srVal).trim()));

    if (!isData) {
      if (texts.length !== 1) continue;
      const t = texts[0];
      if (/LAL+UBHAI/i.test(t)) continue;
      const d = r.map(excelDate).find(Boolean);
      if (d) effDate = d;
      if (/DEPARTMENT/i.test(t)) { dept = cleanTitle(t); deptFixed = true; section = ''; worker = ''; continue; }
      if (dated) {
        // A title with the sheet date: the department, or — under a
        // "SPINNING DEPARTMENTS" heading — one product's block.
        if (deptFixed) section = cleanTitle(t);
        else { dept = cleanTitle(t); section = ''; }
        worker = '';
        continue;
      }
      // A plain name right above the header row (JITU GAWDEKAR): that
      // operator's own copy of the table.
      if (isHeader(nextNonEmpty(i)) && !/NORMS/i.test(t) && dept) { worker = t.toUpperCase(); continue; }
      section = cleanTitle(t);
      continue;
    }

    const remark = C.rem >= 0 ? str(r[C.rem]) : '';
    let w = worker, hours = 8, remarks = remark;
    // Pressing: the remark column carries the operator ("VIRENDER 10 HRS").
    if (C.machine && remark) {
      const hm = /(\d+(?:\.\d+)?)\s*HRS?/i.exec(remark);
      if (hm) hours = +hm[1];
      w = remark.replace(/(\d+(?:\.\d+)?)\s*HRS?/i, '').trim().toUpperCase();
      remarks = hm ? `${hours} hour shift` : '';
    }
    let item = str(r[C.item]).toUpperCase();
    if (C.machine) item = `${dept || 'PRESSING'} ${item}`.trim();
    const row = cleanNorm({
      dept: dept || 'GENERAL', section, item, size: str(r[C.size]), worker: w,
      norm_pcs: C.pcs >= 0 ? num(r[C.pcs]) : 0, hours,
      day_rate: C.rate >= 0 ? num(r[C.rate]) : 0, pc_rate: C.pc >= 0 ? num(r[C.pc]) : 0,
      eff_date: effDate, remarks,
    });
    if (!(row.norm_pcs > 0) && !(row.pc_rate > 0)) continue;
    out.push(row);
  }
  return out;
}

/* ===================================================================== */

function mountProductionNorms(app, ctx) {
  const { q, ensureSchema, requireAuth, requireAccess, isAdminUser, isSuperAdmin, useDb } = ctx;
  const BASE = '/api/production-norms';
  const canManage = (u) => isSuperAdmin(u) || isAdminUser(u);

  /* ── Storage: tables in the DB, one JSON file in local JSON mode ── */

  async function readFile() {
    try { const d = JSON.parse(await fsp.readFile(JSON_FILE, 'utf8')); return { norms: d.norms || [], entries: d.entries || [], log: d.log || [] }; }
    catch { return { norms: [], entries: [], log: [] }; }
  }
  async function writeFile(d) {
    await fsp.mkdir(path.dirname(JSON_FILE), { recursive: true });
    await fsp.writeFile(JSON_FILE, JSON.stringify(d, null, 1));
  }
  const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
  const dOut = (v) => (v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v || '').slice(0, 10));
  const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

  const store = {
    async norms() {
      if (!useDb) return (await readFile()).norms;
      const rows = await q('SELECT id, data FROM pn_norms ORDER BY sort_no, id');
      return rows.map((r) => ({ ...parse(r.data), id: r.id }));
    },
    async replaceNorms(list) {
      if (!useDb) { const d = await readFile(); d.norms = list; return writeFile(d); }
      await q('DELETE FROM pn_norms');
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const params = [];
        const values = chunk.map((m, k) => {
          params.push(m.id, i + k, JSON.stringify({ ...m, id: undefined }));
          return `($${params.length - 2},$${params.length - 1},$${params.length})`;
        });
        await q(`INSERT INTO pn_norms (id, sort_no, data) VALUES ${values.join(',')}`, params);
      }
    },
    async saveNorm(m, sortNo) {
      if (!useDb) {
        const d = await readFile();
        const i = d.norms.findIndex((x) => x.id === m.id);
        if (i >= 0) d.norms[i] = m; else d.norms.push(m);
        return writeFile(d);
      }
      const data = JSON.stringify({ ...m, id: undefined });
      const ex = await q('SELECT id FROM pn_norms WHERE id = $1', [m.id]);
      if (ex.length) await q('UPDATE pn_norms SET data = $1, updated_at = $2 WHERE id = $3', [data, nowSql(), m.id]);
      else await q('INSERT INTO pn_norms (id, sort_no, data) VALUES ($1,$2,$3)', [m.id, sortNo, data]);
    },
    async deleteNorms(ids) {
      if (!ids.length) return;
      if (!useDb) { const d = await readFile(); d.norms = d.norms.filter((x) => !ids.includes(x.id)); return writeFile(d); }
      await q(`DELETE FROM pn_norms WHERE id IN (${ids.map((_, i) => '$' + (i + 1)).join(',')})`, ids);
    },
    // Lines between two dates (inclusive), optionally one department.
    async entries({ from, to, dept = '' }) {
      if (!useDb) {
        return (await readFile()).entries
          .filter((e) => e.entry_date >= from && e.entry_date <= to && (!dept || e.dept === dept))
          .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.dept.localeCompare(b.dept) || a.line_no - b.line_no);
      }
      const params = [from, to];
      let sql = 'SELECT id, entry_date, dept, worker, line_no, data, created_by FROM pn_entries WHERE entry_date >= $1 AND entry_date <= $2';
      if (dept) { params.push(dept); sql += ' AND dept = $3'; }
      const rows = await q(sql + ' ORDER BY entry_date, dept, line_no', params);
      return rows.map((r) => ({ ...parse(r.data), id: r.id, entry_date: dOut(r.entry_date), dept: r.dept, worker: r.worker, line_no: r.line_no, created_by: r.created_by }));
    },
    async replaceDay(date, dept, lines, by) {
      if (!useDb) {
        const d = await readFile();
        d.entries = d.entries.filter((e) => !(e.entry_date === date && e.dept === dept))
          .concat(lines.map((l) => ({ ...l, created_by: by })));
        return writeFile(d);
      }
      await q('DELETE FROM pn_entries WHERE entry_date = $1 AND dept = $2', [date, dept]);
      for (let i = 0; i < lines.length; i += 100) {
        const params = [];
        const values = lines.slice(i, i + 100).map((l) => {
          const { id, entry_date, dept: dp, worker, line_no, ...rest } = l;
          params.push(id, entry_date, dp, worker, line_no, JSON.stringify(rest), by);
          const n = params.length;
          return `($${n - 6},$${n - 5},$${n - 4},$${n - 3},$${n - 2},$${n - 1},$${n})`;
        });
        await q(`INSERT INTO pn_entries (id, entry_date, dept, worker, line_no, data, created_by) VALUES ${values.join(',')}`, params);
      }
    },
    async addLog({ date, dept, action, reason, before, after, by }) {
      if (!useDb) {
        const d = await readFile();
        d.log.push({ id: d.log.length + 1, entry_date: date, dept, action, reason, before_data: before, after_data: after, by_name: by, created_at: nowSql() });
        return writeFile(d);
      }
      await q('INSERT INTO pn_day_log (entry_date, dept, action, reason, before_data, after_data, by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [date, dept, action, reason, JSON.stringify(before), JSON.stringify(after), by]);
    },
    async dayLog(date, dept) {
      if (!useDb) return (await readFile()).log.filter((l) => l.entry_date === date && l.dept === dept).reverse();
      const rows = await q('SELECT id, action, reason, before_data, after_data, by_name, created_at FROM pn_day_log WHERE entry_date = $1 AND dept = $2 ORDER BY id DESC LIMIT 50', [date, dept]);
      return rows.map((r) => ({ ...r, before_data: parse(r.before_data), after_data: parse(r.after_data), created_at: String(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at) }));
    },
    async workers() {
      if (!useDb) return [...new Set((await readFile()).entries.map((e) => e.worker))];
      return (await q('SELECT DISTINCT worker FROM pn_entries')).map((r) => r.worker);
    },
  };

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
        if (manage && !canManage(user)) return res.status(403).json({ error: 'Only an Admin/HOD can change the norms' });
        req.pn = { user, by: user?.name || user?.email || '', manage: canManage(user) };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[production-norms]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  const guard = [requireAuth, requireAccess];

  /* ── Norms ─────────────────────────────────────────────────────── */

  app.get(`${BASE}/norms`, ...guard, route(async (req) => ({
    manage: req.pn.manage, norms: await store.norms(), workers: await store.workers(),
  })));

  app.post(`${BASE}/norms/upload`, ...guard, route(async (req) => {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!files.length) bad('Choose the norms .xlsx file(s)');
    const incoming = [];
    const skipped = [];
    for (const f of files.slice(0, 20)) {
      const m = /^data:[^;,]*;base64,(.*)$/s.exec(String(f?.file || ''));
      if (!m) bad(`${str(f?.name) || 'A file'} could not be read`);
      const got = parseNormsWorkbook(Buffer.from(m[1], 'base64'));
      incoming.push(...got.rows);
      skipped.push(...got.skipped.map((s) => `${str(f.name)} → ${s}`));
    }
    if (!incoming.length) bad('No norm rows were found — is this a PRODUCTION NORMS workbook?');

    // Merge: same dept + section + item + size + worker keeps its id and
    // takes the sheet's values; rows only in the ERP stay as they are. The
    // same table twice (the Naxi dabba list sits in two sheets) counts once.
    const existing = await store.norms();
    const byKey = new Map(existing.map((r) => [normKey(r), r]));
    const mint = nextId(existing, 'PN', 5);
    const seenIn = new Map();
    let k = 0, added = 0, updated = 0, dup = 0;
    for (const r of incoming) {
      const key = normKey(r);
      if (seenIn.has(key)) { dup++; Object.assign(seenIn.get(key), r, { id: seenIn.get(key).id }); continue; }
      const ex = byKey.get(key);
      const row = { ...r, id: ex ? ex.id : mint(++k) };
      delete row.sheet;
      if (ex) updated++; else added++;
      seenIn.set(key, row);
    }
    const fresh = [...seenIn.values()];
    const freshIds = new Set(fresh.map((r) => r.id));
    const merged = [...existing.map((r) => (freshIds.has(r.id) ? fresh.find((x) => x.id === r.id) : r)),
      ...fresh.filter((r) => !existing.some((x) => x.id === r.id))];
    await store.replaceNorms(merged);
    console.log('[production-norms] import:', { added, updated, dup, total: merged.length, skipped });
    return { added, updated, dup, total: merged.length, skipped };
  }, { manage: true }));

  app.post(`${BASE}/norms`, ...guard, route(async (req) => {
    const m = cleanNorm(req.body || {});
    if (!m.dept) bad('Department is required');
    if (!m.item) bad('Item name is required');
    if (!(m.norm_pcs > 0) && !(m.pc_rate > 0)) bad('Enter the 8 hour norm (pcs) and day rate, or a per-piece rate');
    const list = await store.norms();
    const id = str(req.body?.id, 16);
    const clash = list.find((x) => x.id !== id && normKey(x) === normKey(m));
    if (clash) bad(`${m.item} ${m.size} is already in ${m.dept}${m.worker ? ` for ${m.worker}` : ''} (${clash.id})`);
    if (id) {
      if (!list.some((x) => x.id === id)) bad('That norm no longer exists', 404);
      await store.saveNorm({ ...m, id }, 0);
      return { id };
    }
    const newId = nextId(list, 'PN', 5)();
    await store.saveNorm({ ...m, id: newId }, list.length + 1);
    return { id: newId };
  }, { manage: true }));

  app.delete(`${BASE}/norms/:id`, ...guard, route(async (req) => {
    await store.deleteNorms([str(req.params.id, 16)]);
    return { ok: true };
  }, { manage: true }));

  /* ── Day sheets ────────────────────────────────────────────────── */

  app.get(`${BASE}/day`, ...guard, route(async (req) => {
    const date = isoDate(req.query.date);
    const dept = str(req.query.dept, 120).toUpperCase();
    if (!date || !dept) bad('Pick a date and a department');
    return { lines: await store.entries({ from: date, to: date, dept }) };
  }));

  app.post(`${BASE}/day`, ...guard, route(async (req) => {
    const b = req.body || {};
    const date = isoDate(b.date);
    const dept = str(b.dept, 120).toUpperCase();
    if (!date || !dept) bad('Pick a date and a department');
    if (date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) bad('That date is in the future');
    const stamp = Date.now().toString(36);
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 500).map((l, i) => {
      const qty = Math.max(0, num(l.qty));
      const hours = Math.min(24, Math.max(0, num(l.hours))) || 8;
      const normPcs = Math.max(0, num(l.norm_pcs));
      const normHours = Math.max(0, num(l.norm_hours)) || 8;
      const pcRate = Math.max(0, num(l.pc_rate));
      const dayRate = Math.max(0, num(l.day_rate));
      const normId = str(l.norm_id, 16);
      // Overtime: the day rate is for the norm's hours (8, or 10 where the
      // norm says so; always 8 for time work). Hours beyond that are paid on
      // top at day rate ÷ those hours, per hour.
      const baseHours = normId ? normHours : 8;
      const otHours = Math.max(0, hours - baseHours);
      const otAmount = dayRate && otHours ? r2(dayRate / baseHours * otHours) : 0;
      const base = normId ? qty * pcRate : dayRate * Math.min(hours, baseHours) / baseHours;
      return {
        id: `PE${stamp}${String(i).padStart(3, '0')}`, entry_date: date, dept, line_no: i + 1,
        worker: str(l.worker, 120).toUpperCase(), norm_id: normId,
        section: str(l.section, 160), item: str(l.item, 160).toUpperCase(), size: str(l.size, 64),
        qty, hours, norm_pcs: normPcs, norm_hours: normHours, day_rate: dayRate, pc_rate: normId ? r4(pcRate) : 0,
        target: normPcs ? r4(normPcs * hours / normHours) : 0,
        // Norm lines: pieces × rate; time work (no norm): the day rate for up
        // to 8 hours. Either way overtime is added on top.
        ot_hours: otHours, ot_amount: otAmount,
        amount: r2(base + otAmount),
        remark: str(l.remark, 255),
      };
    }).filter((l) => l.worker || l.item || l.qty);
    const badLine = lines.findIndex((l) => !l.worker || !l.item || (l.norm_id && !(l.qty > 0)));
    if (badLine >= 0) bad(`Line ${badLine + 1}: worker, item and qty are all needed`);
    // Changing a day that is already saved needs a reason, and is logged
    // with the lines before and after.
    const prev = await store.entries({ from: date, to: date, dept });
    const reason = str(b.reason, 500);
    if (prev.length) {
      if (!reason) bad('This day is already saved — write the reason for changing it');
      await store.addLog({ date, dept, action: lines.length ? 'edit' : 'clear', reason, before: prev, after: lines, by: req.pn.by });
    }
    await store.replaceDay(date, dept, lines, req.pn.by);
    return { saved: lines.length };
  }));

  app.get(`${BASE}/day/log`, ...guard, route(async (req) => {
    const date = isoDate(req.query.date);
    const dept = str(req.query.dept, 120).toUpperCase();
    if (!date || !dept) bad('Pick a date and a department');
    return { log: await store.dayLog(date, dept) };
  }));

  /* ── Report ────────────────────────────────────────────────────── */

  app.get(`${BASE}/entries`, ...guard, route(async (req) => {
    const from = isoDate(req.query.from);
    const to = isoDate(req.query.to);
    if (!from || !to) bad('Pick the From and To dates');
    if (from > to) bad('From is after To');
    return { lines: await store.entries({ from, to, dept: str(req.query.dept, 120).toUpperCase() }) };
  }));
}

module.exports = { PN_SCHEMA, mountProductionNorms, parseNormsWorkbook };
