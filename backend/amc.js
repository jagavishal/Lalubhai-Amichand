'use strict';
/* =====================================================================
   AMC Management — annual maintenance contracts and their service calls
   ---------------------------------------------------------------------
   What the company pays vendors to keep running (DG sets, lifts, ACs,
   compressors, fire systems, software), when each contract runs out, what
   it cost every year, and the breakdown calls raised against it.

   Masters. Vendors (amc_vendors) and equipment (amc_assets) are this
   module's own: the Accounts "Vendor Master" is a payments book and the
   HR Assets register is laptops-and-phones-per-employee, neither of which
   is the plant equipment a maintenance contract covers. A contract links
   to any number of assets through amc_contract_assets.

   Renewal. A contract keeps its AMC id for life. Renewing moves its dates
   and amount forward in place and writes the term it replaces to
   amc_renewals, so the renewal history (and every past year's cost) is
   one table and the reports never have to stitch chains of ids together.

   Reminders. A sweep every half hour (same claim-then-send pattern as the
   daily greetings) mails each contract at the configured offsets before
   expiry — 30/15/7/0 days unless Settings says otherwise. Every mail is
   claimed in amc_notification_log under a unique key first (contract +
   expiry date + offset), so a restart, a second server process or a
   manual "run now" can never send the same reminder twice; a failed send
   stays in the log as Failed and is retried by the next sweep. The same
   sweep mails overdue service requests once per expected date.

   Roles. ERP Admin (and the owner) is AMC Admin. Everyone else is what
   Settings → Roles says, else Manager for an HOD and Employee for anyone
   else. Employee raises requests and sees their own; Maintenance works
   the requests assigned to them; Manager runs contracts, renewals,
   masters and assignment; Admin also owns settings, roles and deletes.

   Documents are written to uploads/amc/<id>/ on the server's disk, like
   the urgent-payment attachments — never in git, never in the DB.

   Same shape as backend/bulk-mail.js: a self-contained CommonJS module that
   borrows the host's pool, guards and helpers via mountAmc(app, ctx).
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'amc');

// Every table states utf8mb4_unicode_ci outright: that is what fixCollations
// in server.js forces `users` and the older tables to, and a table left on
// the server default (general_ci / uca1400) fails every JOIN against users
// with "Illegal mix of collations".
const AMC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS amc_vendors (
     id VARCHAR(16) PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     contact_person VARCHAR(255) DEFAULT '',
     phone VARCHAR(64) DEFAULT '',
     email VARCHAR(255) DEFAULT '',
     address TEXT,
     gstin VARCHAR(32) DEFAULT '',
     services VARCHAR(500) DEFAULT '',
     active TINYINT NOT NULL DEFAULT 1,
     notes TEXT,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS amc_assets (
     id VARCHAR(16) PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     category VARCHAR(128) DEFAULT '',
     make_model VARCHAR(255) DEFAULT '',
     serial_no VARCHAR(128) DEFAULT '',
     department VARCHAR(128) DEFAULT '',
     location VARCHAR(255) DEFAULT '',
     purchase_date DATE DEFAULT NULL,
     status VARCHAR(32) NOT NULL DEFAULT 'Active',
     notes TEXT,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS amc_contracts (
     id VARCHAR(16) PRIMARY KEY,
     contract_name VARCHAR(255) NOT NULL,
     vendor_id VARCHAR(16) NOT NULL,
     department VARCHAR(128) DEFAULT '',
     location VARCHAR(255) DEFAULT '',
     amc_type VARCHAR(32) NOT NULL DEFAULT 'Comprehensive',
     start_date DATE NOT NULL,
     expiry_date DATE NOT NULL,
     amount DECIMAL(14,2) NOT NULL DEFAULT 0,
     renewal_frequency VARCHAR(32) NOT NULL DEFAULT 'Yearly',
     renewal_status VARCHAR(32) NOT NULL DEFAULT 'Not Due',
     owner_user_id VARCHAR(16) DEFAULT NULL,
     owner_name VARCHAR(255) DEFAULT '',
     remarks TEXT,
     documents TEXT,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_amc_contracts_vendor ON amc_contracts (vendor_id)`,
  `CREATE INDEX idx_amc_contracts_expiry ON amc_contracts (expiry_date)`,
  `CREATE TABLE IF NOT EXISTS amc_contract_assets (
     contract_id VARCHAR(16) NOT NULL,
     asset_id VARCHAR(16) NOT NULL,
     PRIMARY KEY (contract_id, asset_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_amc_ca_asset ON amc_contract_assets (asset_id)`,
  // One row per renewal: the term that was replaced and the one that replaced it.
  `CREATE TABLE IF NOT EXISTS amc_renewals (
     id INT AUTO_INCREMENT PRIMARY KEY,
     contract_id VARCHAR(16) NOT NULL,
     old_start DATE DEFAULT NULL,
     old_expiry DATE DEFAULT NULL,
     old_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
     old_amc_type VARCHAR(32) DEFAULT '',
     old_vendor_id VARCHAR(16) DEFAULT '',
     new_start DATE DEFAULT NULL,
     new_expiry DATE DEFAULT NULL,
     new_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
     remarks TEXT,
     renewed_by VARCHAR(255) DEFAULT '',
     renewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_amc_renewals_contract ON amc_renewals (contract_id)`,
  `CREATE TABLE IF NOT EXISTS amc_service_requests (
     id VARCHAR(16) PRIMARY KEY,
     contract_id VARCHAR(16) DEFAULT NULL,
     asset_id VARCHAR(16) DEFAULT NULL,
     request_date DATE NOT NULL,
     issue TEXT NOT NULL,
     priority VARCHAR(16) NOT NULL DEFAULT 'Medium',
     status VARCHAR(32) NOT NULL DEFAULT 'Open',
     department VARCHAR(128) DEFAULT '',
     location VARCHAR(255) DEFAULT '',
     raised_by_id VARCHAR(16) DEFAULT NULL,
     raised_by_name VARCHAR(255) DEFAULT '',
     assigned_user_id VARCHAR(16) DEFAULT NULL,
     assigned_user_name VARCHAR(255) DEFAULT '',
     assigned_vendor_id VARCHAR(16) DEFAULT NULL,
     expected_date DATE DEFAULT NULL,
     actual_date DATE DEFAULT NULL,
     resolution TEXT,
     documents TEXT,
     closed_at DATETIME DEFAULT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_amc_sr_status ON amc_service_requests (status)`,
  `CREATE INDEX idx_amc_sr_contract ON amc_service_requests (contract_id)`,
  `CREATE INDEX idx_amc_sr_assigned ON amc_service_requests (assigned_user_id)`,
  `CREATE INDEX idx_amc_sr_raised ON amc_service_requests (raised_by_id)`,
  // The request's timeline: notes, status changes, assignments.
  `CREATE TABLE IF NOT EXISTS amc_sr_notes (
     id INT AUTO_INCREMENT PRIMARY KEY,
     sr_id VARCHAR(16) NOT NULL,
     kind VARCHAR(16) NOT NULL DEFAULT 'note',
     note TEXT,
     by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_amc_sr_notes_sr ON amc_sr_notes (sr_id)`,
  // notif_key is the dedupe: one row per reminder/notice ever due.
  `CREATE TABLE IF NOT EXISTS amc_notification_log (
     id INT AUTO_INCREMENT PRIMARY KEY,
     notif_key VARCHAR(191) NOT NULL,
     kind VARCHAR(32) NOT NULL,
     ref_id VARCHAR(16) DEFAULT '',
     offset_days INT DEFAULT NULL,
     subject VARCHAR(500) DEFAULT '',
     recipients TEXT,
     status VARCHAR(16) NOT NULL DEFAULT 'Sending',
     error VARCHAR(500) DEFAULT '',
     attempts INT NOT NULL DEFAULT 0,
     triggered_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     sent_at DATETIME DEFAULT NULL,
     UNIQUE KEY uq_amc_notif_key (notif_key)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_amc_notif_ref ON amc_notification_log (ref_id)`,
  `CREATE TABLE IF NOT EXISTS amc_activity_log (
     id INT AUTO_INCREMENT PRIMARY KEY,
     entity VARCHAR(32) NOT NULL,
     entity_id VARCHAR(32) DEFAULT '',
     action VARCHAR(64) NOT NULL,
     detail TEXT,
     user_id VARCHAR(16) DEFAULT NULL,
     user_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_amc_activity_entity ON amc_activity_log (entity, entity_id)`,
  `CREATE TABLE IF NOT EXISTS amc_roles (
     user_id VARCHAR(16) PRIMARY KEY,
     role VARCHAR(16) NOT NULL,
     updated_by VARCHAR(255) DEFAULT '',
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const AMC_TYPES = ['Comprehensive', 'Non-Comprehensive'];
const FREQUENCIES = { Monthly: 1, Quarterly: 3, 'Half-Yearly': 6, Yearly: 12, '2 Years': 24, '3 Years': 36 };
const RENEWAL_STATUSES = ['Not Due', 'In Progress', 'Renewed', 'Not Renewing', 'Discontinued'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const SR_STATUSES = ['Open', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed'];
const SR_DONE = new Set(['Resolved', 'Closed']);
const ASSET_STATUSES = ['Active', 'Inactive', 'Scrapped'];
const ROLES = ['admin', 'manager', 'maintenance', 'employee'];
const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', maintenance: 'Maintenance Team', employee: 'Employee' };

// Settings live in app_config under these keys, as JSON.
const CFG = {
  reminderDays: 'amc_reminder_days',      // [30, 15, 7, 0]
  reminderHour: 'amc_reminder_hour',      // 9 (IST)
  reminderTo: 'amc_reminder_notify',      // ['user:U0001', 'x@y.com']
  srTo: 'amc_sr_notify',                  // same shape
  upcomingWindow: 'amc_upcoming_window',  // 30 (days) — "upcoming renewal"
  overdueMail: 'amc_sr_overdue_mail',     // true
};
const DEFAULTS = {
  reminderDays: [30, 15, 7, 0], reminderHour: 9, reminderTo: [], srTo: [], upcomingWindow: 30, overdueMail: true,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_TYPES = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const DOC_MAX = 5;
const DOC_BYTES = 4 * 1024 * 1024;
const DOC_TOTAL = 7 * 1024 * 1024;  // express.json caps the body at 10mb of base64
const DOC_KEEP = 20;                // per contract / request, across uploads

/* ── Small helpers ─────────────────────────────────────────────────── */

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg) => { throw new UserError(msg); };

const str = (v, max = 255) => String(v ?? '').trim().slice(0, max);
const money = (v) => {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) bad('Amount must be a positive number');
  return Math.round(n * 100) / 100;
};

// mysql2 hands DATE columns back as a Date at LOCAL midnight, so the local
// components are the stored date whatever the host's timezone is
// (toISOString would shift it a day on any host east of UTC).
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

function dateIn(v, label, { required = false } = {}) {
  const s = str(v, 10);
  if (!s) { if (required) bad(`${label} is required`); return null; }
  if (!ISO_RE.test(s) || isNaN(new Date(s + 'T00:00:00Z').getTime())) bad(`${label} is not a valid date`);
  return s;
}

const dayNum = (iso) => Math.round(new Date(iso + 'T00:00:00Z').getTime() / 86400000);
const daysBetween = (fromIso, toIso) => dayNum(toIso) - dayNum(fromIso);
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Same day-of-month N months on, clamped (31 Jan + 1 month = 28/29 Feb).
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
// Indian financial year of a date: '2026-10-09' → 2026 (FY 2026-27).
const fyOf = (iso) => (+iso.slice(5, 7) >= 4 ? +iso.slice(0, 4) : +iso.slice(0, 4) - 1);
const fyLabel = (fy) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;

// The one reminder offset due today for a contract: the smallest configured
// offset that days-left has reached. A contract entered ten days before
// expiry gets its 15-day reminder at once and its 7-day one on time. Once
// expired only the expiry-day notice (offset 0) can still go, caught up for
// up to 3 days if the server was down on the day — and only when 0 is one
// of the configured offsets.
function dueOffset(daysLeft, offsets) {
  if (daysLeft < -3) return null;
  const reached = offsets.filter((o) => daysLeft <= o);
  if (!reached.length) return null;
  const o = Math.min(...reached);
  if (daysLeft < 0 && o !== 0) return null;
  return o;
}

// A Failed/Skipped notification is retried by each sweep (every 30 min)
// up to this many attempts — about a day — then left in the log as is.
const MAX_ATTEMPTS = 48;

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseDocs(raw) {
  try { const d = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m || !m[2]) return null;
  return { mimeType: (m[1] || '').toLowerCase(), buffer: Buffer.from(m[3], 'base64') };
}

/* Validate an uploaded list before anything is stored, so one bad file
   rejects the request rather than leaving it half-saved. */
function decodeDocs(list, already = 0) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > DOC_MAX) bad(`At most ${DOC_MAX} files at a time`);
  if (already + list.length > DOC_KEEP) bad(`At most ${DOC_KEEP} documents per record — remove one first`);
  let total = 0;
  return list.map((d, i) => {
    const name = String(d?.name || `document-${i + 1}`).replace(/[\\/]+/g, '_').slice(0, 120);
    const parsed = parseDataUrl(d?.dataUrl);
    if (!parsed) bad(`Could not read "${name}"`);
    const ext = DOC_TYPES[parsed.mimeType];
    if (!ext) bad(`"${name}": only PDF, images, Excel and Word files are accepted`);
    if (parsed.buffer.length > DOC_BYTES) bad(`"${name}" is over 4 MB`);
    total += parsed.buffer.length;
    if (total > DOC_TOTAL) bad('Files together must be under 7 MB');
    const safe = name.replace(/[^\w.\- ()]/g, '_').replace(/\.[^.]*$/, '') || 'document';
    return { name, safe, ext, size: parsed.buffer.length, type: parsed.mimeType, buffer: parsed.buffer };
  });
}

// Writes the decoded files under uploads/amc/<id>/ and returns the metadata
// to store. File names carry a timestamp so a later upload never overwrites.
async function writeDocs(id, docs, by) {
  if (!docs.length) return [];
  const dir = path.join(UPLOAD_ROOT, id);
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = Date.now().toString(36);
  const out = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const file = `${stamp}-${i + 1}-${d.safe}.${d.ext}`;
    await fs.promises.writeFile(path.join(dir, file), d.buffer);
    out.push({ name: d.name, file, size: d.size, type: d.type, by, at: new Date().toISOString() });
  }
  return out;
}

const docsOut = (raw) => parseDocs(raw).map(({ name, size, type, by, at }) => ({ name, size, type, by: by || '', at: at || null }));

/* ── Mail ──────────────────────────────────────────────────────────── */

function mailHtml({ heading, colour = '#0150AA', lead, rows, footer, link }) {
  const cells = rows
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `<tr>
        <td style="padding:8px;background:#f8fafc;font-weight:600;color:#374151;width:160px;border-bottom:1px solid #eef2f7">${escHtml(k)}</td>
        <td style="padding:8px;color:#374151;border-bottom:1px solid #eef2f7">${v}</td>
      </tr>`).join('');
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;padding:24px;border:1px solid #e2e8f0;border-radius:8px">
      <h2 style="color:${colour};margin:0 0 16px;font-size:19px">${heading}</h2>
      <p style="color:#374151">${lead}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${cells}</table>
      ${footer ? `<p style="color:#374151">${footer}</p>` : ''}
      ${link ? `<p><a href="${escHtml(link)}" style="display:inline-block;background:#0150AA;color:#fff;padding:9px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open in ERP</a></p>` : ''}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">This is an automated notification from the Lallubhai Amichand ERP — AMC Management.</p>
    </div>`;
}

/* ===================================================================== */

function mountAmc(app, ctx) {
  const {
    q, pool, ensureSchema, requireAuth, isSuperAdmin, rolesOf,
    withSeqId, getMailer, notifyAddressFor, istToday, appOrigin, useDb,
  } = ctx;

  const today = () => istToday().iso;
  // The router reads the whole hash as the page name, so links open the page
  // itself; the mail already names the contract or request.
  const pageLink = () => `${appOrigin}/#amc`;

  /* ── Settings ──────────────────────────────────────────────────── */

  async function readCfg(name) {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [CFG[name]]);
      if (rows.length) return JSON.parse(rows[0].value);
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('[amc] could not read setting', name, '—', e.message);
    }
    return DEFAULTS[name];
  }
  async function writeCfg(name, value) {
    const json = JSON.stringify(value);
    await q(`INSERT INTO app_config ("key","value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value"=$3`,
      [CFG[name], json, json]);
  }
  async function settings() {
    const out = {};
    for (const k of Object.keys(CFG)) out[k] = await readCfg(k);
    // Normalise anything a hand edit may have left odd.
    out.reminderDays = [...new Set((Array.isArray(out.reminderDays) ? out.reminderDays : DEFAULTS.reminderDays)
      .map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => b - a);
    out.reminderHour = Number.isInteger(+out.reminderHour) && +out.reminderHour >= 0 && +out.reminderHour <= 23 ? +out.reminderHour : 9;
    out.upcomingWindow = Number.isInteger(+out.upcomingWindow) && +out.upcomingWindow > 0 ? +out.upcomingWindow : 30;
    out.reminderTo = Array.isArray(out.reminderTo) ? out.reminderTo : [];
    out.srTo = Array.isArray(out.srTo) ? out.srTo : [];
    out.overdueMail = out.overdueMail !== false;
    return out;
  }

  /* ── Who is asking ─────────────────────────────────────────────── */

  async function roleOf(user) {
    if (!user) return null;
    if (isSuperAdmin(user) || rolesOf(user).includes('Admin')) return 'admin';
    const rows = await q('SELECT role FROM amc_roles WHERE user_id = $1', [user.id]);
    if (rows[0] && ROLES.includes(rows[0].role)) return rows[0].role;
    return rolesOf(user).includes('HOD') ? 'manager' : 'employee';
  }

  const CAN = {
    admin:       { manage: true, settings: true, del: true, assign: true, work: true, reports: true, money: true },
    manager:     { manage: true, settings: false, del: false, assign: true, work: true, reports: true, money: true },
    maintenance: { manage: false, settings: false, del: false, assign: false, work: true, reports: false, money: false },
    employee:    { manage: false, settings: false, del: false, assign: false, work: false, reports: false, money: false },
  };

  // Wraps a handler: DB check, schema, role lookup, uniform errors.
  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'AMC Management needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        const role = await roleOf(user);
        const can = CAN[role];
        if (need && !can[need]) return res.status(403).json({ error: 'You do not have permission to do this' });
        req.amc = { user, role, can, by: user?.name || user?.email || '' };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[amc]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }

  async function logActivity(req, entity, entityId, action, detail = '') {
    try {
      await q(`INSERT INTO amc_activity_log (entity, entity_id, action, detail, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6)`,
        [entity, entityId || '', action, String(detail || '').slice(0, 4000), req.amc?.user?.id || null, req.amc?.by || 'System']);
    } catch (e) { console.error('[amc] activity log failed:', e.message); }
  }

  // Field-by-field "what changed" for the activity log.
  function diff(before, after, fields) {
    const out = [];
    for (const f of fields) {
      const a = before[f] ?? '', b = after[f] ?? '';
      if (String(a) !== String(b)) out.push(`${f}: "${String(a).slice(0, 80)}" → "${String(b).slice(0, 80)}"`);
    }
    return out.join('; ');
  }

  /* ── Row shapes ────────────────────────────────────────────────── */

  // `prevEnd` is the expiry of the term this one replaced: a contract renewed
  // ahead of time carries a term that starts in the future, but the old term
  // still covers it until then.
  function contractStatus(c, t, window, prevEnd) {
    if (c.renewal_status === 'Discontinued') return 'Discontinued';
    if (c.start_date && c.start_date > t && !(prevEnd && prevEnd >= t)) return 'Not Started';
    const left = daysBetween(t, c.expiry_date);
    if (left < 0) return 'Expired';
    if (left <= window) return 'Expiring Soon';
    return 'Active';
  }
  // The renewal state as the dashboard means it: anything inside the window
  // (or already past expiry) that nobody has closed off is Pending.
  function renewalState(c, t, window) {
    if (['Discontinued', 'Not Renewing', 'In Progress'].includes(c.renewal_status)) return c.renewal_status;
    const left = daysBetween(t, c.expiry_date);
    if (left <= window) return 'Pending';
    return c.renewal_status === 'Renewed' ? 'Renewed' : 'Not Due';
  }

  function contractOut(r, ctxRow) {
    const c = {
      id: r.id, contract_name: r.contract_name || '', vendor_id: r.vendor_id || '',
      vendor_name: ctxRow.vendors.get(r.vendor_id)?.name || '',
      department: r.department || '', location: r.location || '', amc_type: r.amc_type || '',
      start_date: dstr(r.start_date), expiry_date: dstr(r.expiry_date),
      amount: Number(r.amount || 0), renewal_frequency: r.renewal_frequency || '',
      renewal_status: r.renewal_status || 'Not Due',
      owner_user_id: r.owner_user_id || null, owner_name: r.owner_name || '',
      remarks: r.remarks || '', documents: docsOut(r.documents),
      created_by: r.created_by || '', created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
      asset_ids: ctxRow.assetsByContract.get(r.id) || [],
    };
    c.days_left = daysBetween(ctxRow.today, c.expiry_date);
    c.status = contractStatus(c, ctxRow.today, ctxRow.window, ctxRow.prevEnd.get(r.id));
    c.renewal_state = renewalState(c, ctxRow.today, ctxRow.window);
    c.asset_names = c.asset_ids.map((id) => ctxRow.assets.get(id)?.name).filter(Boolean);
    return c;
  }

  function vendorOut(r) {
    return {
      id: r.id, name: r.name || '', contact_person: r.contact_person || '', phone: r.phone || '',
      email: r.email || '', address: r.address || '', gstin: r.gstin || '', services: r.services || '',
      active: !!Number(r.active), notes: r.notes || '', created_at: tsOut(r.created_at),
    };
  }
  function assetOut(r) {
    return {
      id: r.id, name: r.name || '', category: r.category || '', make_model: r.make_model || '',
      serial_no: r.serial_no || '', department: r.department || '', location: r.location || '',
      purchase_date: dstr(r.purchase_date), status: r.status || 'Active', notes: r.notes || '',
      created_at: tsOut(r.created_at),
    };
  }
  function srOut(r, ctxRow) {
    const s = {
      id: r.id, contract_id: r.contract_id || '', asset_id: r.asset_id || '',
      request_date: dstr(r.request_date), issue: r.issue || '', priority: r.priority || 'Medium',
      status: r.status || 'Open', department: r.department || '', location: r.location || '',
      raised_by_id: r.raised_by_id || null, raised_by_name: r.raised_by_name || '',
      assigned_user_id: r.assigned_user_id || null, assigned_user_name: r.assigned_user_name || '',
      assigned_vendor_id: r.assigned_vendor_id || '',
      expected_date: dstr(r.expected_date), actual_date: dstr(r.actual_date),
      resolution: r.resolution || '', documents: docsOut(r.documents),
      closed_at: tsOut(r.closed_at), created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
    };
    const c = ctxRow.contracts?.get(s.contract_id);
    s.contract_name = c?.contract_name || '';
    s.asset_name = ctxRow.assets.get(s.asset_id)?.name || '';
    const vendorId = s.assigned_vendor_id || c?.vendor_id || '';
    s.vendor_id = vendorId;
    s.vendor_name = ctxRow.vendors.get(vendorId)?.name || '';
    s.assigned_vendor_name = ctxRow.vendors.get(s.assigned_vendor_id)?.name || '';
    s.overdue = !SR_DONE.has(s.status) && !!s.expected_date && s.expected_date < ctxRow.today;
    return s;
  }

  // Everything the lists need to resolve ids to names, in one read.
  async function loadAll() {
    const [vendors, assets, links, contracts, prevTerms, cfg] = await Promise.all([
      q('SELECT * FROM amc_vendors ORDER BY name'),
      q('SELECT * FROM amc_assets ORDER BY name'),
      q('SELECT * FROM amc_contract_assets'),
      q('SELECT * FROM amc_contracts ORDER BY expiry_date, id'),
      q('SELECT contract_id, MAX(old_expiry) AS prev_end FROM amc_renewals GROUP BY contract_id'),
      settings(),
    ]);
    const assetsByContract = new Map();
    const contractsByAsset = new Map();
    for (const l of links) {
      if (!assetsByContract.has(l.contract_id)) assetsByContract.set(l.contract_id, []);
      assetsByContract.get(l.contract_id).push(l.asset_id);
      if (!contractsByAsset.has(l.asset_id)) contractsByAsset.set(l.asset_id, []);
      contractsByAsset.get(l.asset_id).push(l.contract_id);
    }
    const ctxRow = {
      today: today(), window: cfg.upcomingWindow,
      vendors: new Map(vendors.map((v) => [v.id, v])),
      assets: new Map(assets.map((a) => [a.id, a])),
      assetsByContract, contractsByAsset,
      prevEnd: new Map(prevTerms.map((p) => [p.contract_id, dstr(p.prev_end)])),
    };
    const contractList = contracts.map((r) => contractOut(r, ctxRow));
    ctxRow.contracts = new Map(contractList.map((c) => [c.id, c]));
    return { ctxRow, cfg, vendors, assets, contracts: contractList };
  }

  // A Maintenance/Employee view never carries contract money or documents.
  function stripMoney(c) {
    const { amount, documents, remarks, ...rest } = c;
    return rest;
  }

  // Which requests this person may see.
  function srVisible(s, amc) {
    if (amc.can.assign) return true;
    const uid = amc.user?.id;
    if (amc.role === 'maintenance') return s.assigned_user_id === uid || s.raised_by_id === uid || (!s.assigned_user_id && !SR_DONE.has(s.status));
    return s.raised_by_id === uid;
  }

  async function users() {
    const rows = await q(`SELECT u.id, u.name, u.email, u.department, u.roles, u.active, r.role AS amc_role
                            FROM users u LEFT JOIN amc_roles r ON r.user_id = u.id ORDER BY u.name`);
    return rows.filter((u) => Number(u.active ?? 1) !== 0);
  }
  function effectiveRole(u) {
    if (isSuperAdmin(u) || rolesOf(u).includes('Admin')) return 'admin';
    if (ROLES.includes(u.amc_role)) return u.amc_role;
    return rolesOf(u).includes('HOD') ? 'manager' : 'employee';
  }

  /* ── Recipients ────────────────────────────────────────────────── */

  // ['user:U0001', 'a@b.com'] → unique addresses, users through their
  // notification address (Profile) like every other mail the app sends.
  async function resolveRecipients(list, extraUsers = []) {
    const seen = new Set();
    const out = [];
    const add = (e) => {
      const v = String(e || '').trim();
      if (!v || !EMAIL_RE.test(v) || seen.has(v.toLowerCase())) return;
      seen.add(v.toLowerCase());
      out.push(v);
    };
    const ids = [];
    for (const entry of list || []) {
      const s = String(entry || '').trim();
      if (s.startsWith('user:')) ids.push(s.slice(5));
      else add(s);
    }
    for (const u of extraUsers) if (u?.id) ids.push(u.id);
    const uniq = [...new Set(ids.filter(Boolean))];
    if (uniq.length) {
      const rows = await q(`SELECT id, email, active FROM users WHERE id IN (${uniq.map((_, i) => '$' + (i + 1)).join(',')})`, uniq);
      for (const r of rows) {
        if (Number(r.active ?? 1) === 0) continue;
        add(await notifyAddressFor(r.id, r.email));
      }
    }
    return out;
  }

  // People whose AMC role is one of `roles`, by explicit Settings → Roles
  // assignment only (an HOD's implied Manager role does not volunteer
  // them for every mail).
  async function explicitRoleUsers(roles) {
    const rows = await q(`SELECT u.id FROM amc_roles r JOIN users u ON u.id = r.user_id
                           WHERE r.role IN (${roles.map((_, i) => '$' + (i + 1)).join(',')})`, roles);
    return rows;
  }

  // Who hears about reminders and requests while Settings lists nobody:
  // the AMC Admins/Managers named in Settings → Roles, plus every ERP Admin,
  // so a fresh install never sends its first reminders into the void.
  async function fallbackUsers() {
    const explicit = await explicitRoleUsers(['admin', 'manager']);
    const admins = (await q(`SELECT id, roles, active FROM users WHERE roles LIKE $1`, ['%Admin%']))
      .filter((u) => Number(u.active ?? 1) !== 0 && rolesOf(u).includes('Admin'));
    return [...explicit, ...admins];
  }

  /* Claim a notification key and send. Returns 'sent' | 'duplicate' |
     'failed' | 'skipped'. A key already Sent is never sent again; one that
     Failed (or had nobody to go to) is re-claimed and retried. */
  async function claimAndSend({ key, kind, refId, offset = null, subject, to, cc = [], html, by = 'System' }) {
    // The insert is the claim: only one caller can create the key. A key that
    // already exists is re-claimed only from Failed/Skipped, again by a
    // single conditional UPDATE, so two sweeps can never both win it.
    const ins = await pool.query(
      `INSERT INTO amc_notification_log (notif_key, kind, ref_id, offset_days, subject, recipients, status, attempts, triggered_by)
       VALUES ($1,$2,$3,$4,$5,'','Sending',1,$6) ON CONFLICT (notif_key) DO NOTHING`,
      [key, kind, refId || '', offset, subject.slice(0, 500), by]);
    if (!ins.rowCount) {
      const upd = await pool.query(
        `UPDATE amc_notification_log SET status='Sending', attempts=attempts+1, triggered_by=$1
          WHERE notif_key=$2 AND status IN ('Failed','Skipped') AND attempts < $3`,
        [by, key, MAX_ATTEMPTS]);
      if (!upd.rowCount) return 'duplicate';
    }
    const finish = (status, error = '', recips = '') => q(
      `UPDATE amc_notification_log SET status=$1, error=$2, recipients=$3, subject=$4, sent_at=${status === 'Sent' ? 'NOW()' : 'sent_at'} WHERE notif_key=$5`,
      [status, String(error).slice(0, 500), recips, subject.slice(0, 500), key]);

    const toList = [...to];
    const ccList = cc.filter((e) => !toList.some((t) => t.toLowerCase() === e.toLowerCase()));
    if (!toList.length && ccList.length) toList.push(ccList.shift());
    if (!toList.length) { await finish('Skipped', 'No recipients configured — set them in AMC → Settings'); return 'skipped'; }
    const mailer = getMailer();
    const recips = toList.join(', ') + (ccList.length ? ' | cc: ' + ccList.join(', ') : '');
    if (!mailer) { await finish('Failed', 'SMTP is not configured on this server', recips); return 'failed'; }
    try {
      await mailer.sendMail({
        from: `"AMC Management" <${process.env.SMTP_USER}>`,
        to: toList.join(', '),
        ...(ccList.length ? { cc: ccList.join(', ') } : {}),
        subject, html,
      });
      await finish('Sent', '', recips);
      return 'sent';
    } catch (e) {
      await finish('Failed', e.message, recips);
      console.error('[amc] mail failed', key, '—', e.message);
      return 'failed';
    }
  }

  /* ── Reminder + overdue sweep ──────────────────────────────────── */

  function reminderMail(c, offset) {
    const left = c.days_left;
    const when = left > 1 ? `expires in ${left} days` : left === 1 ? 'expires tomorrow' : left === 0 ? 'expires today' : `expired ${-left} day(s) ago`;
    const subject = left <= 0
      ? `AMC ${left === 0 ? 'expires today' : 'has expired'}: ${c.contract_name} (${c.id})`
      : `AMC renewal reminder — ${c.contract_name} (${c.id}) ${when}`;
    const html = mailHtml({
      heading: left <= 0 ? 'AMC Expiry Notice' : `AMC Renewal Reminder — ${offset} day${offset === 1 ? '' : 's'}`,
      colour: left <= 7 ? '#dc2626' : '#d97706',
      lead: `The maintenance contract below <b>${escHtml(when)}</b> (${fmtDate(c.expiry_date)}). Please arrange the renewal, or mark it as Not Renewing in the ERP so these reminders stop.`,
      rows: [
        ['AMC ID', escHtml(c.id)],
        ['Contract', escHtml(c.contract_name)],
        ['Vendor', escHtml(c.vendor_name)],
        ['Vendor Contact', escHtml([c.vendor_contact, c.vendor_phone, c.vendor_email].filter(Boolean).join(' · '))],
        ['Equipment', escHtml(c.asset_names.join(', '))],
        ['Department', escHtml(c.department)],
        ['Location', escHtml(c.location)],
        ['AMC Type', escHtml(c.amc_type)],
        ['Contract Period', `${fmtDate(c.start_date)} – ${fmtDate(c.expiry_date)}`],
        ['Expiry Date', `<b>${fmtDate(c.expiry_date)}</b>`],
        ['Contract Amount', inr(c.amount)],
        ['Renewal Frequency', escHtml(c.renewal_frequency)],
        ['Renewal Status', escHtml(c.renewal_state)],
        ['Contract Owner', escHtml(c.owner_name)],
        ['Remarks', escHtml(c.remarks)],
      ],
      link: pageLink(),
    });
    return { subject, html };
  }

  let _sweeping = false;
  async function sweep({ force = false, by = 'System' } = {}) {
    if (!useDb || _sweeping) return { skipped: true };
    _sweeping = true;
    const summary = { reminders: { sent: 0, failed: 0, skipped: 0, duplicate: 0 }, overdue: { sent: 0, failed: 0, skipped: 0, duplicate: 0 } };
    try {
      await ensureSchema();
      const cfg = await settings();
      const { hour } = istToday();
      if (!force && hour < cfg.reminderHour) return { waiting: true, hour: cfg.reminderHour };
      const { contracts, ctxRow } = await loadAll();
      const reminderBase = await resolveRecipients(cfg.reminderTo, cfg.reminderTo.length ? [] : await fallbackUsers());
      for (const c of contracts) {
        // A renewed contract carries its new expiry, so its reminders key on
        // that date; only a contract nobody is renewing is left alone.
        if (c.renewal_status === 'Discontinued' || c.renewal_status === 'Not Renewing') continue;
        if (c.status === 'Not Started') continue;
        const off = dueOffset(c.days_left, cfg.reminderDays);
        if (off === null) continue;
        const v = ctxRow.vendors.get(c.vendor_id) || {};
        Object.assign(c, { vendor_contact: v.contact_person || '', vendor_phone: v.phone || '', vendor_email: v.email || '' });
        const { subject, html } = reminderMail(c, off);
        const owner = c.owner_user_id ? await resolveRecipients([], [{ id: c.owner_user_id }]) : [];
        const r = await claimAndSend({
          key: `rem:${c.id}:${c.expiry_date}:${off}`, kind: 'reminder', refId: c.id, offset: off,
          subject, to: reminderBase.length ? reminderBase : owner, cc: reminderBase.length ? owner : [], html, by,
        });
        summary.reminders[r] += 1;
      }
      if (cfg.overdueMail) {
        const srRows = await q(`SELECT * FROM amc_service_requests WHERE status NOT IN ('Resolved','Closed') AND expected_date IS NOT NULL AND expected_date < $1`, [ctxRow.today]);
        const srBase = await resolveRecipients(cfg.srTo, cfg.srTo.length ? [] : await fallbackUsers());
        for (const row of srRows) {
          const s = srOut(row, ctxRow);
          const assignee = s.assigned_user_id ? await resolveRecipients([], [{ id: s.assigned_user_id }]) : [];
          const late = daysBetween(s.expected_date, ctxRow.today);
          const r = await claimAndSend({
            key: `od:${s.id}:${s.expected_date}`, kind: 'sr_overdue', refId: s.id,
            subject: `Overdue service request ${s.id} — ${late} day(s) past expected resolution`,
            to: assignee.length ? assignee : srBase, cc: assignee.length ? srBase : [],
            html: srMailHtml(s, 'overdue', { late }), by,
          });
          summary.overdue[r] += 1;
        }
      }
      const n = summary.reminders.sent + summary.overdue.sent;
      if (n || summary.reminders.failed || summary.overdue.failed) console.log('[amc] sweep', JSON.stringify(summary));
      return summary;
    } finally { _sweeping = false; }
  }

  // Checked every half hour because a deploy restarts the process and would
  // lose a one-shot timer; the notification log makes re-runs harmless.
  setInterval(() => { sweep().catch((e) => console.error('[amc] sweep', e.message)); }, 30 * 60 * 1000).unref?.();
  setTimeout(() => { sweep().catch((e) => console.error('[amc] sweep', e.message)); }, 2 * 60 * 1000).unref?.();

  /* ── Service-request mails ─────────────────────────────────────── */

  function srMailHtml(s, stage, extra = {}) {
    const heads = {
      new: ['New Service Request', '#0150AA', `A new service request has been raised by <b>${escHtml(s.raised_by_name)}</b>.`],
      assigned: ['Service Request Assigned', '#7c3aed', `Service request <b>${escHtml(s.id)}</b> has been assigned${s.assigned_user_name ? ` to <b>${escHtml(s.assigned_user_name)}</b>` : ''}${s.assigned_vendor_name ? `${s.assigned_user_name ? ' with' : ' to'} vendor <b>${escHtml(s.assigned_vendor_name)}</b>` : ''}.`],
      overdue: ['Service Request Overdue', '#dc2626', `Service request <b>${escHtml(s.id)}</b> is <b>${extra.late} day(s)</b> past its expected resolution date and is still ${escHtml(s.status)}.`],
      resolved: ['Service Request Resolved', '#16a34a', `Your service request <b>${escHtml(s.id)}</b> has been marked ${escHtml(s.status)}.`],
    };
    const [heading, colour, lead] = heads[stage];
    return mailHtml({
      heading, colour, lead,
      rows: [
        ['Request ID', escHtml(s.id)],
        ['Priority', `<b>${escHtml(s.priority)}</b>`],
        ['Status', escHtml(s.status)],
        ['Issue', escHtml(s.issue).replace(/\n/g, '<br>')],
        ['Equipment', escHtml(s.asset_name)],
        ['AMC Contract', s.contract_id ? `${escHtml(s.contract_name)} (${escHtml(s.contract_id)})` : ''],
        ['Vendor', escHtml(s.vendor_name)],
        ['Department', escHtml(s.department)],
        ['Location', escHtml(s.location)],
        ['Raised By', escHtml(s.raised_by_name)],
        ['Request Date', fmtDate(s.request_date)],
        ['Assigned To', escHtml([s.assigned_user_name, s.assigned_vendor_name].filter(Boolean).join(' / '))],
        ['Expected Resolution', s.expected_date ? fmtDate(s.expected_date) : ''],
        ['Resolution', stage === 'resolved' ? escHtml(s.resolution).replace(/\n/g, '<br>') : ''],
      ],
      link: pageLink(),
    });
  }

  // Fire-and-forget: a mail problem must never fail the save that caused it.
  function notifySr(s, stage, req, { vendorEmail = '' } = {}) {
    (async () => {
      const cfg = await settings();
      const base = await resolveRecipients(cfg.srTo, cfg.srTo.length ? [] : await fallbackUsers());
      const requester = s.raised_by_id ? await resolveRecipients([], [{ id: s.raised_by_id }]) : [];
      let to = [], cc = [];
      if (stage === 'new') {
        const team = await resolveRecipients([], await explicitRoleUsers(['maintenance']));
        to = [...base, ...team]; cc = requester;
      } else if (stage === 'assigned') {
        to = s.assigned_user_id ? await resolveRecipients([], [{ id: s.assigned_user_id }]) : [];
        if (vendorEmail && EMAIL_RE.test(vendorEmail)) to.push(vendorEmail);
        cc = [...requester, ...base];
      } else if (stage === 'resolved') {
        to = requester; cc = [];
      }
      const seen = new Set(to.map((e) => e.toLowerCase()));
      cc = cc.filter((e) => !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
      const subject = {
        new: `New service request ${s.id} [${s.priority}] — ${s.issue.slice(0, 60)}`,
        assigned: `Service request ${s.id} assigned [${s.priority}] — ${s.issue.slice(0, 60)}`,
        resolved: `Service request ${s.id} ${s.status.toLowerCase()} — ${s.issue.slice(0, 60)}`,
      }[stage];
      // Keyed by the moment so each real event (a re-assignment, say) is its
      // own log row; the dedupe that matters for these is "one per event".
      await claimAndSend({
        key: `sr:${stage}:${s.id}:${Date.now()}`, kind: `sr_${stage}`, refId: s.id,
        subject, to, cc, html: srMailHtml(s, stage), by: req.amc.by,
      });
    })().catch((e) => console.error('[amc] sr mail', stage, s.id, '—', e.message));
  }

  /* ── Reads ─────────────────────────────────────────────────────── */

  // Everything the page needs in one call, scoped to the caller's role.
  app.get('/api/amc/data', requireAuth, route(null, async (req) => {
    const { amc } = req;
    const { ctxRow, cfg, vendors, assets, contracts } = await loadAll();
    const srRows = await q('SELECT * FROM amc_service_requests ORDER BY created_at DESC, id DESC');
    const requests = srRows.map((r) => srOut(r, ctxRow)).filter((s) => srVisible(s, amc));
    const userRows = await users();
    const out = {
      role: amc.role, roleLabel: ROLE_LABEL[amc.role], can: amc.can, today: ctxRow.today, window: cfg.upcomingWindow,
      me: { id: amc.user.id, name: amc.user.name, department: amc.user.department || '' },
      contracts: amc.can.money ? contracts : contracts.map(stripMoney),
      vendors: vendors.map(vendorOut).map((v) => (amc.can.manage || amc.can.work ? v : { id: v.id, name: v.name, active: v.active })),
      assets: assets.map(assetOut).map((a) => ({ ...a, contract_ids: ctxRow.contractsByAsset.get(a.id) || [] })),
      requests,
      // For the assign / owner pickers. Addresses only to those who manage.
      users: userRows.map((u) => ({
        id: u.id, name: u.name, department: u.department || '', role: effectiveRole(u),
        ...(amc.can.settings ? { email: u.email || '', explicitRole: ROLES.includes(u.amc_role) ? u.amc_role : '' } : {}),
      })),
      lists: { AMC_TYPES, FREQUENCIES: Object.keys(FREQUENCIES), RENEWAL_STATUSES, PRIORITIES, SR_STATUSES, ASSET_STATUSES, ROLES, ROLE_LABEL },
    };
    if (amc.can.settings) out.settings = cfg;
    return out;
  }));

  app.get('/api/amc/dashboard', requireAuth, route(null, async (req) => {
    const { amc } = req;
    const { ctxRow, cfg, contracts } = await loadAll();
    const t = ctxRow.today;
    const srAll = (await q('SELECT * FROM amc_service_requests')).map((r) => srOut(r, ctxRow)).filter((s) => srVisible(s, amc));
    const live = contracts.filter((c) => c.renewal_status !== 'Discontinued');
    const active = live.filter((c) => c.status === 'Active' || c.status === 'Expiring Soon');
    const upcoming = live.filter((c) => c.days_left >= 0 && c.days_left <= cfg.upcomingWindow && !['Not Renewing'].includes(c.renewal_status));
    const expired = live.filter((c) => c.status === 'Expired');
    const pending = live.filter((c) => c.renewal_state === 'Pending' || c.renewal_state === 'In Progress');
    const fy = fyOf(t);
    const terms = await costTerms(contracts);
    const fySpend = terms.filter((x) => x.start && fyOf(x.start) === fy).reduce((n, x) => n + x.amount, 0);
    const open = srAll.filter((s) => !SR_DONE.has(s.status));
    const overdue = open.filter((s) => s.overdue);
    const out = {
      today: t, window: cfg.upcomingWindow, fy: fyLabel(fy),
      counts: {
        active: active.length, upcoming: upcoming.length, expired: expired.length, pending: pending.length,
        openRequests: open.length, overdueRequests: overdue.length,
        criticalOpen: open.filter((s) => s.priority === 'Critical' || s.priority === 'High').length,
      },
      upcoming: upcoming.sort((a, b) => a.days_left - b.days_left).slice(0, 10).map((c) => (amc.can.money ? c : stripMoney(c))),
      expired: expired.sort((a, b) => b.days_left - a.days_left).slice(0, 10).map((c) => (amc.can.money ? c : stripMoney(c))),
      overdue: overdue.sort((a, b) => a.expected_date.localeCompare(b.expected_date)).slice(0, 10),
      recent: srAll.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8),
      byStatus: SR_STATUSES.map((s) => ({ status: s, count: srAll.filter((x) => x.status === s).length })),
    };
    if (amc.can.money) {
      out.money = {
        activeValue: active.reduce((n, c) => n + c.amount, 0),
        fySpend,
        byDepartment: Object.entries(active.reduce((m, c) => { const d = c.department || 'Unassigned'; m[d] = (m[d] || 0) + c.amount; return m; }, {}))
          .map(([department, amount]) => ({ department, amount })).sort((a, b) => b.amount - a.amount),
      };
    }
    return out;
  }));

  app.get('/api/amc/contracts/:id', requireAuth, route(null, async (req) => {
    const { amc } = req;
    const { ctxRow, contracts } = await loadAll();
    const c = contracts.find((x) => x.id === req.params.id);
    if (!c) throw new UserError('Contract not found', 404);
    const renewals = amc.can.money
      ? (await q('SELECT * FROM amc_renewals WHERE contract_id = $1 ORDER BY renewed_at DESC, id DESC', [c.id])).map((r) => ({
        id: r.id, old_start: dstr(r.old_start), old_expiry: dstr(r.old_expiry), old_amount: Number(r.old_amount || 0),
        old_amc_type: r.old_amc_type || '', old_vendor_name: ctxRow.vendors.get(r.old_vendor_id)?.name || '',
        new_start: dstr(r.new_start), new_expiry: dstr(r.new_expiry), new_amount: Number(r.new_amount || 0),
        remarks: r.remarks || '', renewed_by: r.renewed_by || '', renewed_at: tsOut(r.renewed_at),
      }))
      : [];
    const requests = (await q('SELECT * FROM amc_service_requests WHERE contract_id = $1 ORDER BY created_at DESC', [c.id]))
      .map((r) => srOut(r, ctxRow)).filter((s) => srVisible(s, amc));
    const notifications = amc.can.manage
      ? (await q(`SELECT kind, offset_days, status, recipients, error, sent_at, created_at FROM amc_notification_log WHERE ref_id = $1 ORDER BY id DESC LIMIT 50`, [c.id]))
        .map((n) => ({ ...n, sent_at: tsOut(n.sent_at), created_at: tsOut(n.created_at) }))
      : [];
    const activity = amc.can.manage
      ? (await q(`SELECT action, detail, user_name, created_at FROM amc_activity_log WHERE entity='contract' AND entity_id=$1 ORDER BY id DESC LIMIT 50`, [c.id]))
        .map((a) => ({ ...a, created_at: tsOut(a.created_at) }))
      : [];
    const v = ctxRow.vendors.get(c.vendor_id);
    return {
      contract: amc.can.money ? c : stripMoney(c),
      vendor: v ? vendorOut(v) : null,
      assets: c.asset_ids.map((id) => ctxRow.assets.get(id)).filter(Boolean).map(assetOut),
      renewals, requests, notifications, activity,
    };
  }));

  app.get('/api/amc/requests/:id', requireAuth, route(null, async (req) => {
    const { ctxRow } = await loadAll();
    const row = (await q('SELECT * FROM amc_service_requests WHERE id = $1', [req.params.id]))[0];
    if (!row) throw new UserError('Service request not found', 404);
    const s = srOut(row, ctxRow);
    if (!srVisible(s, req.amc)) throw new UserError('You cannot view this request', 403);
    const notes = (await q('SELECT * FROM amc_sr_notes WHERE sr_id = $1 ORDER BY id', [s.id]))
      .map((n) => ({ id: n.id, kind: n.kind, note: n.note || '', by: n.by_name || '', at: tsOut(n.created_at) }));
    const v = ctxRow.vendors.get(s.vendor_id);
    return { request: s, notes, vendor: v ? vendorOut(v) : null };
  }));

  // Documents: contracts need manage/money rights; requests follow visibility.
  app.get('/api/amc/:kind(contracts|requests)/:id/documents/:n', requireAuth, route(null, async (req, res) => {
    const { kind, id } = req.params;
    const n = parseInt(req.params.n, 10);
    if (!/^[A-Z]+\d+$/.test(id) || !(n >= 0)) throw new UserError('Bad request');
    let raw;
    if (kind === 'contracts') {
      if (!req.amc.can.money) throw new UserError('You cannot open contract documents', 403);
      raw = (await q('SELECT documents FROM amc_contracts WHERE id = $1', [id]))[0];
    } else {
      const { ctxRow } = await loadAll();
      const row = (await q('SELECT * FROM amc_service_requests WHERE id = $1', [id]))[0];
      if (!row || !srVisible(srOut(row, ctxRow), req.amc)) throw new UserError('Not found', 404);
      raw = row;
    }
    if (!raw) throw new UserError('Not found', 404);
    const doc = parseDocs(raw.documents)[n];
    if (!doc || !doc.file) throw new UserError('Document not found', 404);
    const abs = path.join(UPLOAD_ROOT, id, path.basename(doc.file));
    res.download(abs, doc.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'The file is missing on the server — please upload it again' });
    });
  }));

  /* ── Vendors ───────────────────────────────────────────────────── */

  function vendorFromBody(b) {
    const v = {
      name: str(b.name), contact_person: str(b.contact_person), phone: str(b.phone, 64),
      email: str(b.email), address: str(b.address, 2000), gstin: str(b.gstin, 32).toUpperCase(),
      services: str(b.services, 500), notes: str(b.notes, 4000), active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
    };
    if (!v.name) bad('Vendor name is required');
    if (v.email && !v.email.split(/[,;\s]+/).filter(Boolean).every((e) => EMAIL_RE.test(e))) bad('Vendor email is not a valid address');
    if (v.phone && !/^[0-9+\-()\s/,]{6,64}$/.test(v.phone)) bad('Phone number has invalid characters');
    if (v.gstin && !/^[0-9A-Z]{15}$/.test(v.gstin)) bad('GSTIN must be 15 letters/digits');
    return v;
  }

  app.post('/api/amc/vendors', requireAuth, route('manage', async (req) => {
    const v = vendorFromBody(req.body || {});
    const dup = await q('SELECT id FROM amc_vendors WHERE LOWER(name) = LOWER($1)', [v.name]);
    if (dup.length) bad(`A vendor named "${v.name}" already exists (${dup[0].id})`);
    const id = await withSeqId('amc_vendors', 'VND', 4, (newId) => q(
      `INSERT INTO amc_vendors (id, name, contact_person, phone, email, address, gstin, services, active, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [newId, v.name, v.contact_person, v.phone, v.email, v.address, v.gstin, v.services, v.active, v.notes, req.amc.by]));
    await logActivity(req, 'vendor', id, 'created', v.name);
    return { id };
  }));

  app.patch('/api/amc/vendors/:id', requireAuth, route('manage', async (req) => {
    const before = (await q('SELECT * FROM amc_vendors WHERE id = $1', [req.params.id]))[0];
    if (!before) throw new UserError('Vendor not found', 404);
    const v = vendorFromBody(req.body || {});
    const dup = await q('SELECT id FROM amc_vendors WHERE LOWER(name) = LOWER($1) AND id <> $2', [v.name, before.id]);
    if (dup.length) bad(`Another vendor is already named "${v.name}" (${dup[0].id})`);
    await q(`UPDATE amc_vendors SET name=$1, contact_person=$2, phone=$3, email=$4, address=$5, gstin=$6, services=$7, active=$8, notes=$9, updated_at=NOW() WHERE id=$10`,
      [v.name, v.contact_person, v.phone, v.email, v.address, v.gstin, v.services, v.active, v.notes, before.id]);
    await logActivity(req, 'vendor', before.id, 'updated', diff(before, v, ['name', 'contact_person', 'phone', 'email', 'gstin', 'services', 'active']));
    return { ok: true };
  }));

  app.delete('/api/amc/vendors/:id', requireAuth, route('del', async (req) => {
    const id = req.params.id;
    const used = await q('SELECT COUNT(*) AS n FROM amc_contracts WHERE vendor_id = $1', [id]);
    const usedSr = await q('SELECT COUNT(*) AS n FROM amc_service_requests WHERE assigned_vendor_id = $1', [id]);
    if (Number(used[0].n) || Number(usedSr[0].n)) bad('This vendor is used by contracts or service requests — mark it Inactive instead');
    const before = (await q('SELECT name FROM amc_vendors WHERE id = $1', [id]))[0];
    if (!before) throw new UserError('Vendor not found', 404);
    await q('DELETE FROM amc_vendors WHERE id = $1', [id]);
    await logActivity(req, 'vendor', id, 'deleted', before.name);
    return { ok: true };
  }));

  /* ── Assets ────────────────────────────────────────────────────── */

  function assetFromBody(b) {
    const a = {
      name: str(b.name), category: str(b.category, 128), make_model: str(b.make_model), serial_no: str(b.serial_no, 128),
      department: str(b.department, 128), location: str(b.location), purchase_date: dateIn(b.purchase_date, 'Purchase date'),
      status: ASSET_STATUSES.includes(b.status) ? b.status : 'Active', notes: str(b.notes, 4000),
    };
    if (!a.name) bad('Equipment name is required');
    if (a.purchase_date && a.purchase_date > today()) bad('Purchase date cannot be in the future');
    return a;
  }

  app.post('/api/amc/assets', requireAuth, route('manage', async (req) => {
    const a = assetFromBody(req.body || {});
    if (a.serial_no) {
      const dup = await q('SELECT id FROM amc_assets WHERE LOWER(serial_no) = LOWER($1)', [a.serial_no]);
      if (dup.length) bad(`Serial no. ${a.serial_no} is already on ${dup[0].id}`);
    }
    const id = await withSeqId('amc_assets', 'EQ', 4, (newId) => q(
      `INSERT INTO amc_assets (id, name, category, make_model, serial_no, department, location, purchase_date, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [newId, a.name, a.category, a.make_model, a.serial_no, a.department, a.location, a.purchase_date, a.status, a.notes, req.amc.by]));
    await logActivity(req, 'asset', id, 'created', a.name);
    return { id };
  }));

  app.patch('/api/amc/assets/:id', requireAuth, route('manage', async (req) => {
    const before = (await q('SELECT * FROM amc_assets WHERE id = $1', [req.params.id]))[0];
    if (!before) throw new UserError('Equipment not found', 404);
    const a = assetFromBody(req.body || {});
    if (a.serial_no) {
      const dup = await q('SELECT id FROM amc_assets WHERE LOWER(serial_no) = LOWER($1) AND id <> $2', [a.serial_no, before.id]);
      if (dup.length) bad(`Serial no. ${a.serial_no} is already on ${dup[0].id}`);
    }
    await q(`UPDATE amc_assets SET name=$1, category=$2, make_model=$3, serial_no=$4, department=$5, location=$6, purchase_date=$7, status=$8, notes=$9, updated_at=NOW() WHERE id=$10`,
      [a.name, a.category, a.make_model, a.serial_no, a.department, a.location, a.purchase_date, a.status, a.notes, before.id]);
    await logActivity(req, 'asset', before.id, 'updated', diff({ ...before, purchase_date: dstr(before.purchase_date) }, a, ['name', 'category', 'serial_no', 'department', 'location', 'status']));
    return { ok: true };
  }));

  app.delete('/api/amc/assets/:id', requireAuth, route('del', async (req) => {
    const id = req.params.id;
    const used = await q('SELECT COUNT(*) AS n FROM amc_service_requests WHERE asset_id = $1', [id]);
    if (Number(used[0].n)) bad('This equipment has service history — set its status to Inactive or Scrapped instead');
    const before = (await q('SELECT name FROM amc_assets WHERE id = $1', [id]))[0];
    if (!before) throw new UserError('Equipment not found', 404);
    await q('DELETE FROM amc_contract_assets WHERE asset_id = $1', [id]);
    await q('DELETE FROM amc_assets WHERE id = $1', [id]);
    await logActivity(req, 'asset', id, 'deleted', before.name);
    return { ok: true };
  }));

  // Service history for one piece of equipment.
  app.get('/api/amc/assets/:id', requireAuth, route(null, async (req) => {
    const { ctxRow } = await loadAll();
    const a = ctxRow.assets.get(req.params.id);
    if (!a) throw new UserError('Equipment not found', 404);
    const requests = (await q('SELECT * FROM amc_service_requests WHERE asset_id = $1 ORDER BY request_date DESC, id DESC', [a.id]))
      .map((r) => srOut(r, ctxRow)).filter((s) => srVisible(s, req.amc));
    const contracts = (ctxRow.contractsByAsset.get(a.id) || []).map((id) => ctxRow.contracts.get(id)).filter(Boolean)
      .map((c) => (req.amc.can.money ? c : stripMoney(c)));
    return { asset: assetOut(a), contracts, requests };
  }));

  /* ── Contracts ─────────────────────────────────────────────────── */

  async function contractFromBody(b) {
    const c = {
      contract_name: str(b.contract_name), vendor_id: str(b.vendor_id, 16),
      department: str(b.department, 128), location: str(b.location),
      amc_type: AMC_TYPES.includes(b.amc_type) ? b.amc_type : bad('Choose an AMC type'),
      start_date: dateIn(b.start_date, 'Start date', { required: true }),
      expiry_date: dateIn(b.expiry_date, 'Expiry date', { required: true }),
      amount: money(b.amount),
      renewal_frequency: FREQUENCIES[b.renewal_frequency] ? b.renewal_frequency : bad('Choose a renewal frequency'),
      renewal_status: RENEWAL_STATUSES.includes(b.renewal_status) ? b.renewal_status : 'Not Due',
      owner_user_id: str(b.owner_user_id, 16) || null, owner_name: '',
      remarks: str(b.remarks, 4000),
      asset_ids: Array.isArray(b.asset_ids) ? [...new Set(b.asset_ids.map((x) => str(x, 16)).filter(Boolean))] : [],
    };
    if (!c.contract_name) bad('Contract name is required');
    if (!c.vendor_id) bad('Choose a vendor');
    if (!(await q('SELECT id FROM amc_vendors WHERE id = $1', [c.vendor_id])).length) bad('That vendor no longer exists');
    if (c.expiry_date <= c.start_date) bad('Expiry date must be after the start date');
    if (daysBetween(c.start_date, c.expiry_date) > 366 * 5) bad('A contract term longer than 5 years looks like a typo — check the dates');
    if (!(c.amount > 0)) bad('Contract amount is required');
    if (c.asset_ids.length) {
      const found = await q(`SELECT id FROM amc_assets WHERE id IN (${c.asset_ids.map((_, i) => '$' + (i + 1)).join(',')})`, c.asset_ids);
      if (found.length !== c.asset_ids.length) bad('One of the selected equipment no longer exists');
    }
    if (c.owner_user_id) {
      const u = (await q('SELECT name FROM users WHERE id = $1', [c.owner_user_id]))[0];
      if (!u) bad('The contract owner is not a valid user');
      c.owner_name = u.name;
    }
    return c;
  }

  async function setContractAssets(id, assetIds) {
    await q('DELETE FROM amc_contract_assets WHERE contract_id = $1', [id]);
    for (const a of assetIds) await q('INSERT INTO amc_contract_assets (contract_id, asset_id) VALUES ($1,$2)', [id, a]);
  }

  app.post('/api/amc/contracts', requireAuth, route('manage', async (req) => {
    const b = req.body || {};
    const c = await contractFromBody(b);
    const docs = decodeDocs(b.documents);
    let stored = [];
    const id = await withSeqId('amc_contracts', 'AMC', 4, async (newId) => {
      await q(`INSERT INTO amc_contracts (id, contract_name, vendor_id, department, location, amc_type, start_date, expiry_date, amount,
                 renewal_frequency, renewal_status, owner_user_id, owner_name, remarks, documents, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [newId, c.contract_name, c.vendor_id, c.department, c.location, c.amc_type, c.start_date, c.expiry_date, c.amount,
          c.renewal_frequency, c.renewal_status, c.owner_user_id, c.owner_name, c.remarks, '[]', req.amc.by]);
    });
    stored = await writeDocs(id, docs, req.amc.by);
    if (stored.length) await q('UPDATE amc_contracts SET documents = $1 WHERE id = $2', [JSON.stringify(stored), id]);
    await setContractAssets(id, c.asset_ids);
    await logActivity(req, 'contract', id, 'created', `${c.contract_name} · ${c.start_date} → ${c.expiry_date} · ₹${c.amount}`);
    return { id };
  }));

  app.patch('/api/amc/contracts/:id', requireAuth, route('manage', async (req) => {
    const before = (await q('SELECT * FROM amc_contracts WHERE id = $1', [req.params.id]))[0];
    if (!before) throw new UserError('Contract not found', 404);
    const c = await contractFromBody(req.body || {});
    await q(`UPDATE amc_contracts SET contract_name=$1, vendor_id=$2, department=$3, location=$4, amc_type=$5, start_date=$6, expiry_date=$7,
               amount=$8, renewal_frequency=$9, renewal_status=$10, owner_user_id=$11, owner_name=$12, remarks=$13, updated_at=NOW() WHERE id=$14`,
      [c.contract_name, c.vendor_id, c.department, c.location, c.amc_type, c.start_date, c.expiry_date, c.amount,
        c.renewal_frequency, c.renewal_status, c.owner_user_id, c.owner_name, c.remarks, before.id]);
    await setContractAssets(before.id, c.asset_ids);
    const prev = { ...before, start_date: dstr(before.start_date), expiry_date: dstr(before.expiry_date), amount: Number(before.amount) };
    await logActivity(req, 'contract', before.id, 'updated',
      diff(prev, c, ['contract_name', 'vendor_id', 'department', 'location', 'amc_type', 'start_date', 'expiry_date', 'amount', 'renewal_frequency', 'renewal_status', 'owner_name', 'remarks']) || 'no field changes');
    return { ok: true };
  }));

  // Renew in place: the old term goes to amc_renewals, the contract moves on.
  app.post('/api/amc/contracts/:id/renew', requireAuth, route('manage', async (req) => {
    const b = req.body || {};
    const before = (await q('SELECT * FROM amc_contracts WHERE id = $1', [req.params.id]))[0];
    if (!before) throw new UserError('Contract not found', 404);
    const oldStart = dstr(before.start_date), oldExpiry = dstr(before.expiry_date);
    const start = dateIn(b.start_date, 'New start date', { required: true });
    const expiry = dateIn(b.expiry_date, 'New expiry date', { required: true });
    const amount = money(b.amount);
    if (!(amount > 0)) bad('New contract amount is required');
    if (expiry <= start) bad('New expiry date must be after the new start date');
    if (expiry <= oldExpiry) bad(`The renewed term must end after the current expiry (${fmtDate(oldExpiry)})`);
    if (start < oldStart) bad('The renewed term cannot start before the current one');
    const amcType = AMC_TYPES.includes(b.amc_type) ? b.amc_type : before.amc_type;
    const freq = FREQUENCIES[b.renewal_frequency] ? b.renewal_frequency : before.renewal_frequency;
    const vendorId = str(b.vendor_id, 16) || before.vendor_id;
    if (!(await q('SELECT id FROM amc_vendors WHERE id = $1', [vendorId])).length) bad('That vendor no longer exists');
    const remarks = str(b.remarks, 4000);
    const docs = decodeDocs(b.documents, parseDocs(before.documents).length);
    await q(`INSERT INTO amc_renewals (contract_id, old_start, old_expiry, old_amount, old_amc_type, old_vendor_id, new_start, new_expiry, new_amount, remarks, renewed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [before.id, oldStart, oldExpiry, Number(before.amount || 0), before.amc_type, before.vendor_id, start, expiry, amount, remarks, req.amc.by]);
    const stored = await writeDocs(before.id, docs, req.amc.by);
    const allDocs = [...parseDocs(before.documents), ...stored];
    await q(`UPDATE amc_contracts SET start_date=$1, expiry_date=$2, amount=$3, amc_type=$4, renewal_frequency=$5, vendor_id=$6,
               renewal_status='Renewed', documents=$7, updated_at=NOW() WHERE id=$8`,
      [start, expiry, amount, amcType, freq, vendorId, JSON.stringify(allDocs), before.id]);
    await logActivity(req, 'contract', before.id, 'renewed',
      `${oldStart} → ${oldExpiry} @ ₹${Number(before.amount)}  ⇒  ${start} → ${expiry} @ ₹${amount}${remarks ? ' · ' + remarks : ''}`);
    return { ok: true };
  }));

  // Suggested next term for the renew form: starts the day after expiry and
  // runs one renewal-frequency period.
  app.get('/api/amc/contracts/:id/next-term', requireAuth, route('manage', async (req) => {
    const c = (await q('SELECT expiry_date, renewal_frequency, amount FROM amc_contracts WHERE id = $1', [req.params.id]))[0];
    if (!c) throw new UserError('Contract not found', 404);
    const start = addDays(dstr(c.expiry_date), 1);
    const months = FREQUENCIES[c.renewal_frequency] || 12;
    return { start_date: start, expiry_date: addDays(addMonths(start, months), -1), amount: Number(c.amount || 0) };
  }));

  app.post('/api/amc/contracts/:id/documents', requireAuth, route('manage', async (req) => {
    const row = (await q('SELECT documents FROM amc_contracts WHERE id = $1', [req.params.id]))[0];
    if (!row) throw new UserError('Contract not found', 404);
    const existing = parseDocs(row.documents);
    const docs = decodeDocs(req.body?.documents, existing.length);
    if (!docs.length) bad('Choose a file to upload');
    const stored = await writeDocs(req.params.id, docs, req.amc.by);
    await q('UPDATE amc_contracts SET documents = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify([...existing, ...stored]), req.params.id]);
    await logActivity(req, 'contract', req.params.id, 'document added', stored.map((d) => d.name).join(', '));
    return { ok: true };
  }));

  app.delete('/api/amc/contracts/:id/documents/:n', requireAuth, route('manage', async (req) => {
    const row = (await q('SELECT documents FROM amc_contracts WHERE id = $1', [req.params.id]))[0];
    if (!row) throw new UserError('Contract not found', 404);
    const docs = parseDocs(row.documents);
    const n = parseInt(req.params.n, 10);
    const d = docs[n];
    if (!d) throw new UserError('Document not found', 404);
    docs.splice(n, 1);
    await q('UPDATE amc_contracts SET documents = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(docs), req.params.id]);
    fs.promises.unlink(path.join(UPLOAD_ROOT, req.params.id, path.basename(d.file))).catch(() => {});
    await logActivity(req, 'contract', req.params.id, 'document removed', d.name);
    return { ok: true };
  }));

  app.delete('/api/amc/contracts/:id', requireAuth, route('del', async (req) => {
    const id = req.params.id;
    const before = (await q('SELECT contract_name FROM amc_contracts WHERE id = $1', [id]))[0];
    if (!before) throw new UserError('Contract not found', 404);
    const used = await q('SELECT COUNT(*) AS n FROM amc_service_requests WHERE contract_id = $1', [id]);
    if (Number(used[0].n)) bad('This contract has service requests — set its renewal status to Discontinued instead');
    await q('DELETE FROM amc_contract_assets WHERE contract_id = $1', [id]);
    await q('DELETE FROM amc_renewals WHERE contract_id = $1', [id]);
    await q('DELETE FROM amc_contracts WHERE id = $1', [id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, id), { recursive: true, force: true }).catch(() => {});
    await logActivity(req, 'contract', id, 'deleted', before.contract_name);
    return { ok: true };
  }));

  /* ── Service requests ──────────────────────────────────────────── */

  app.post('/api/amc/requests', requireAuth, route(null, async (req) => {
    const b = req.body || {};
    const { amc } = req;
    const issue = str(b.issue, 4000);
    if (issue.length < 5) bad('Describe the issue (at least a few words)');
    const priority = PRIORITIES.includes(b.priority) ? b.priority : bad('Choose a priority');
    const assetId = str(b.asset_id, 16) || null;
    let contractId = str(b.contract_id, 16) || null;
    if (!assetId && !contractId) bad('Choose the equipment or the AMC contract this is about');
    const asset = assetId ? (await q('SELECT * FROM amc_assets WHERE id = $1', [assetId]))[0] : null;
    if (assetId && !asset) bad('That equipment no longer exists');
    if (contractId && !(await q('SELECT id FROM amc_contracts WHERE id = $1', [contractId])).length) bad('That contract no longer exists');
    // Equipment picked without a contract: link the contract covering it
    // today (the one running longest, if two overlap).
    if (assetId && !contractId) {
      const { ctxRow } = await loadAll();
      const cov = (ctxRow.contractsByAsset.get(assetId) || []).map((id) => ctxRow.contracts.get(id))
        .filter((c) => c && (c.status === 'Active' || c.status === 'Expiring Soon'))
        .sort((x, y) => y.expiry_date.localeCompare(x.expiry_date));
      contractId = cov[0]?.id || null;
    }
    const requestDate = dateIn(b.request_date, 'Request date') || today();
    if (requestDate > today()) bad('Request date cannot be in the future');
    const docs = decodeDocs(b.documents);
    const department = str(b.department, 128) || asset?.department || amc.user.department || '';
    const location = str(b.location) || asset?.location || '';
    const id = await withSeqId('amc_service_requests', 'SR', 5, (newId) => q(
      `INSERT INTO amc_service_requests (id, contract_id, asset_id, request_date, issue, priority, status, department, location,
         raised_by_id, raised_by_name, documents) VALUES ($1,$2,$3,$4,$5,$6,'Open',$7,$8,$9,$10,'[]')`,
      [newId, contractId, assetId, requestDate, issue, priority, department, location, amc.user.id, amc.by]));
    const stored = await writeDocs(id, docs, amc.by);
    if (stored.length) await q('UPDATE amc_service_requests SET documents = $1 WHERE id = $2', [JSON.stringify(stored), id]);
    await q(`INSERT INTO amc_sr_notes (sr_id, kind, note, by_name) VALUES ($1,'status',$2,$3)`, [id, 'Request raised', amc.by]);
    await logActivity(req, 'request', id, 'created', `${priority} · ${issue.slice(0, 120)}`);
    const { ctxRow } = await loadAll();
    const s = srOut((await q('SELECT * FROM amc_service_requests WHERE id = $1', [id]))[0], ctxRow);
    notifySr(s, 'new', req);
    return { id };
  }));

  // Who may do what to one request.
  function srRights(s, amc) {
    const uid = amc.user.id;
    const mine = s.raised_by_id === uid;
    const assignedToMe = s.assigned_user_id === uid;
    return {
      edit: amc.can.assign || (mine && s.status === 'Open'),
      work: amc.can.assign || (amc.role === 'maintenance' && (assignedToMe || !s.assigned_user_id)),
      note: amc.can.assign || mine || assignedToMe || amc.role === 'maintenance',
      close: amc.can.assign || mine,
    };
  }

  async function loadSr(req) {
    const { ctxRow } = await loadAll();
    const row = (await q('SELECT * FROM amc_service_requests WHERE id = $1', [req.params.id]))[0];
    if (!row) throw new UserError('Service request not found', 404);
    const s = srOut(row, ctxRow);
    if (!srVisible(s, req.amc)) throw new UserError('You cannot view this request', 403);
    return { s, ctxRow, row };
  }

  // Issue / priority / equipment edits.
  app.patch('/api/amc/requests/:id', requireAuth, route(null, async (req) => {
    const { s } = await loadSr(req);
    if (!srRights(s, req.amc).edit) throw new UserError('Only the requester (while it is Open) or a manager can edit this request', 403);
    const b = req.body || {};
    const issue = str(b.issue ?? s.issue, 4000);
    if (issue.length < 5) bad('Describe the issue (at least a few words)');
    const priority = PRIORITIES.includes(b.priority) ? b.priority : s.priority;
    const assetId = b.asset_id !== undefined ? (str(b.asset_id, 16) || null) : (s.asset_id || null);
    const contractId = b.contract_id !== undefined ? (str(b.contract_id, 16) || null) : (s.contract_id || null);
    if (!assetId && !contractId) bad('Choose the equipment or the AMC contract this is about');
    if (assetId && !(await q('SELECT id FROM amc_assets WHERE id = $1', [assetId])).length) bad('That equipment no longer exists');
    if (contractId && !(await q('SELECT id FROM amc_contracts WHERE id = $1', [contractId])).length) bad('That contract no longer exists');
    const department = b.department !== undefined ? str(b.department, 128) : s.department;
    const location = b.location !== undefined ? str(b.location) : s.location;
    await q(`UPDATE amc_service_requests SET issue=$1, priority=$2, asset_id=$3, contract_id=$4, department=$5, location=$6, updated_at=NOW() WHERE id=$7`,
      [issue, priority, assetId, contractId, department, location, s.id]);
    const d = diff(s, { issue, priority, asset_id: assetId || '', contract_id: contractId || '', department, location }, ['issue', 'priority', 'asset_id', 'contract_id', 'department', 'location']);
    if (d) await q(`INSERT INTO amc_sr_notes (sr_id, kind, note, by_name) VALUES ($1,'edit',$2,$3)`, [s.id, 'Edited — ' + d, req.amc.by]);
    await logActivity(req, 'request', s.id, 'updated', d || 'no field changes');
    return { ok: true };
  }));

  app.post('/api/amc/requests/:id/assign', requireAuth, route('assign', async (req) => {
    const { s, ctxRow } = await loadSr(req);
    if (SR_DONE.has(s.status)) bad(`This request is already ${s.status} — reopen it first`);
    const b = req.body || {};
    const userId = str(b.assigned_user_id, 16) || null;
    const vendorId = str(b.assigned_vendor_id, 16) || null;
    if (!userId && !vendorId) bad('Assign it to a person, a vendor, or both');
    let userName = '';
    if (userId) {
      const u = (await q('SELECT name, active FROM users WHERE id = $1', [userId]))[0];
      if (!u || Number(u.active ?? 1) === 0) bad('That person is not an active user');
      userName = u.name;
    }
    const vendor = vendorId ? ctxRow.vendors.get(vendorId) : null;
    if (vendorId && !vendor) bad('That vendor no longer exists');
    const expected = dateIn(b.expected_date, 'Expected resolution date', { required: true });
    if (expected < s.request_date) bad('Expected resolution date cannot be before the request date');
    const status = ['Open', 'Assigned'].includes(s.status) ? 'Assigned' : s.status;
    await q(`UPDATE amc_service_requests SET assigned_user_id=$1, assigned_user_name=$2, assigned_vendor_id=$3, expected_date=$4, status=$5, updated_at=NOW() WHERE id=$6`,
      [userId, userName, vendorId, expected, status, s.id]);
    const who = [userName, vendor?.name].filter(Boolean).join(' / ');
    const note = str(b.note, 2000);
    await q(`INSERT INTO amc_sr_notes (sr_id, kind, note, by_name) VALUES ($1,'assign',$2,$3)`,
      [s.id, `Assigned to ${who}, expected by ${fmtDate(expected)}${note ? ' — ' + note : ''}`, req.amc.by]);
    await logActivity(req, 'request', s.id, 'assigned', `${who} · expected ${expected}`);
    const fresh = srOut((await q('SELECT * FROM amc_service_requests WHERE id = $1', [s.id]))[0], ctxRow);
    notifySr(fresh, 'assigned', req, { vendorEmail: b.notify_vendor && vendor?.email ? vendor.email.split(/[,;\s]+/)[0] : '' });
    return { ok: true };
  }));

  // Status moves, with the resolution captured on the way to Resolved.
  app.post('/api/amc/requests/:id/status', requireAuth, route(null, async (req) => {
    const { s, ctxRow } = await loadSr(req);
    const rights = srRights(s, req.amc);
    const b = req.body || {};
    const status = SR_STATUSES.includes(b.status) ? b.status : bad('Choose a valid status');
    if (status === s.status) bad(`It is already ${status}`);
    const reopening = SR_DONE.has(s.status) && !SR_DONE.has(status);
    if (status === 'Closed' || reopening) {
      if (!rights.close) throw new UserError('Only the requester or a manager can close or reopen a request', 403);
    } else if (!rights.work) {
      throw new UserError('Only the assigned maintenance person or a manager can change the status', 403);
    }
    if (status === 'Assigned' && !s.assigned_user_id && !s.assigned_vendor_id) bad('Use Assign to choose who handles it');
    if (status === 'Closed' && !SR_DONE.has(s.status) && !req.amc.can.assign) bad('It must be Resolved before the requester can close it');
    let resolution = s.resolution, actual = s.actual_date;
    if (status === 'Resolved' || (status === 'Closed' && !s.actual_date)) {
      resolution = str(b.resolution ?? s.resolution, 4000);
      if (resolution.length < 3) bad('Describe the resolution');
      actual = dateIn(b.actual_date, 'Actual resolution date') || today();
      if (actual < s.request_date) bad('Resolution date cannot be before the request date');
      if (actual > today()) bad('Resolution date cannot be in the future');
    }
    if (reopening) { actual = null; }
    // A maintenance person working an unassigned request takes it on.
    if (req.amc.role === 'maintenance' && !s.assigned_user_id) {
      await q('UPDATE amc_service_requests SET assigned_user_id=$1, assigned_user_name=$2 WHERE id=$3', [req.amc.user.id, req.amc.by, s.id]);
      await q(`INSERT INTO amc_sr_notes (sr_id, kind, note, by_name) VALUES ($1,'assign',$2,$3)`, [s.id, `Picked up by ${req.amc.by}`, req.amc.by]);
    }
    const note = str(b.note, 2000);
    await q(`UPDATE amc_service_requests SET status=$1, resolution=$2, actual_date=$3,
               closed_at=${status === 'Closed' ? 'NOW()' : reopening ? 'NULL' : 'closed_at'}, updated_at=NOW() WHERE id=$4`,
      [status, resolution || '', actual, s.id]);
    await q(`INSERT INTO amc_sr_notes (sr_id, kind, note, by_name) VALUES ($1,'status',$2,$3)`,
      [s.id, `${s.status} → ${status}${status === 'Resolved' ? ' — ' + resolution : ''}${note ? ' — ' + note : ''}`, req.amc.by]);
    await logActivity(req, 'request', s.id, 'status', `${s.status} → ${status}`);
    if (status === 'Resolved') {
      const fresh = srOut((await q('SELECT * FROM amc_service_requests WHERE id = $1', [s.id]))[0], ctxRow);
      notifySr(fresh, 'resolved', req);
    }
    return { ok: true };
  }));

  app.post('/api/amc/requests/:id/notes', requireAuth, route(null, async (req) => {
    const { s, row } = await loadSr(req);
    if (!srRights(s, req.amc).note) throw new UserError('You cannot add notes to this request', 403);
    const b = req.body || {};
    const note = str(b.note, 4000);
    const existing = parseDocs(row.documents);
    const docs = decodeDocs(b.documents, existing.length);
    if (!note && !docs.length) bad('Write a note or attach a file');
    const stored = await writeDocs(s.id, docs, req.amc.by);
    if (stored.length) await q('UPDATE amc_service_requests SET documents = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify([...existing, ...stored]), s.id]);
    const text = [note, stored.length ? `Attached: ${stored.map((d) => d.name).join(', ')}` : ''].filter(Boolean).join('\n');
    await q(`INSERT INTO amc_sr_notes (sr_id, kind, note, by_name) VALUES ($1,'note',$2,$3)`, [s.id, text, req.amc.by]);
    await q('UPDATE amc_service_requests SET updated_at = NOW() WHERE id = $1', [s.id]);
    return { ok: true };
  }));

  app.delete('/api/amc/requests/:id', requireAuth, route('del', async (req) => {
    const { s } = await loadSr(req);
    await q('DELETE FROM amc_sr_notes WHERE sr_id = $1', [s.id]);
    await q('DELETE FROM amc_service_requests WHERE id = $1', [s.id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, s.id), { recursive: true, force: true }).catch(() => {});
    await logActivity(req, 'request', s.id, 'deleted', s.issue.slice(0, 120));
    return { ok: true };
  }));

  /* ── Reports ───────────────────────────────────────────────────── */

  // Every term a contract has run, oldest first: past ones from the
  // renewal history, plus the current one. A term's cost is booked to the
  // month it starts in.
  async function costTerms(contracts) {
    const renewals = await q('SELECT contract_id, old_start, old_expiry, old_amount, old_vendor_id FROM amc_renewals ORDER BY id');
    const out = [];
    const byId = new Map(contracts.map((c) => [c.id, c]));
    for (const r of renewals) {
      const c = byId.get(r.contract_id);
      if (!c) continue;
      out.push({ contract: c, start: dstr(r.old_start), expiry: dstr(r.old_expiry), amount: Number(r.old_amount || 0), vendor_id: r.old_vendor_id || c.vendor_id });
    }
    for (const c of contracts) out.push({ contract: c, start: c.start_date, expiry: c.expiry_date, amount: c.amount, vendor_id: c.vendor_id });
    return out;
  }

  const inRange = (iso, from, to) => !!iso && (!from || iso >= from) && (!to || iso <= to);

  app.get('/api/amc/reports/:type', requireAuth, route('reports', async (req) => {
    const { ctxRow, cfg, contracts } = await loadAll();
    const t = ctxRow.today;
    const from = dateIn(req.query.from, 'From date');
    const to = dateIn(req.query.to, 'To date');
    const fy = /^\d{4}$/.test(String(req.query.fy || '')) ? +req.query.fy : fyOf(t);
    const vname = (id) => ctxRow.vendors.get(id)?.name || id || '—';
    const live = contracts.filter((c) => c.renewal_status !== 'Discontinued');
    const contractRow = (c) => [c.id, c.contract_name, c.vendor_name, c.asset_names.join(', '), c.department, c.location, c.amc_type,
      c.start_date, c.expiry_date, c.days_left, c.amount, c.renewal_frequency, c.status, c.renewal_state];
    const contractCols = ['AMC ID', 'Contract', 'Vendor', 'Equipment', 'Department', 'Location', 'Type', 'Start', 'Expiry', 'Days Left', 'Amount', 'Frequency', 'Status', 'Renewal'];
    const type = req.params.type;

    if (type === 'active' || type === 'expired' || type === 'upcoming') {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || cfg.upcomingWindow));
      const list = type === 'active' ? live.filter((c) => c.status === 'Active' || c.status === 'Expiring Soon')
        : type === 'expired' ? live.filter((c) => c.status === 'Expired')
        : live.filter((c) => c.days_left >= 0 && c.days_left <= days);
      const rows = list.map(contractRow);
      return { title: { active: 'Active AMCs', expired: 'Expired AMCs', upcoming: `AMCs expiring in the next ${days} days` }[type], columns: contractCols,
        money: [10], rows, totals: { 10: list.reduce((n, c) => n + c.amount, 0) } };
    }

    if (type === 'vendor-summary') {
      const m = new Map();
      for (const c of contracts) {
        const k = c.vendor_id;
        if (!m.has(k)) m.set(k, { name: vname(k), total: 0, active: 0, expired: 0, upcoming: 0, value: 0 });
        const r = m.get(k);
        r.total += 1;
        if (c.renewal_status === 'Discontinued') continue;
        if (c.status === 'Active' || c.status === 'Expiring Soon') { r.active += 1; r.value += c.amount; }
        if (c.status === 'Expired') r.expired += 1;
        if (c.days_left >= 0 && c.days_left <= cfg.upcomingWindow) r.upcoming += 1;
      }
      const rows = [...m.entries()].map(([id, r]) => [id, r.name, r.total, r.active, r.upcoming, r.expired, r.value]).sort((a, b) => b[6] - a[6]);
      return { title: 'Vendor-wise AMC Summary', columns: ['Vendor ID', 'Vendor', 'Contracts', 'Active', 'Expiring Soon', 'Expired', 'Active Value'],
        money: [6], rows, totals: { 2: rows.reduce((n, r) => n + r[2], 0), 6: rows.reduce((n, r) => n + r[6], 0) } };
    }

    const terms = await costTerms(contracts);

    if (type === 'department-expenses') {
      const m = new Map();
      for (const x of terms) {
        if (!x.start || fyOf(x.start) !== fy) continue;
        const d = x.contract.department || 'Unassigned';
        if (!m.has(d)) m.set(d, { n: 0, amount: 0, comp: 0, non: 0 });
        const r = m.get(d);
        r.n += 1; r.amount += x.amount;
        if (x.contract.amc_type === 'Comprehensive') r.comp += x.amount; else r.non += x.amount;
      }
      const rows = [...m.entries()].map(([d, r]) => [d, r.n, r.comp, r.non, r.amount]).sort((a, b) => b[4] - a[4]);
      return { title: `Department-wise AMC Expenses — ${fyLabel(fy)}`, note: 'A contract term is booked to the month it starts.',
        columns: ['Department', 'Contract Terms', 'Comprehensive', 'Non-Comprehensive', 'Total'], money: [2, 3, 4], rows,
        totals: { 1: rows.reduce((n, r) => n + r[1], 0), 2: rows.reduce((n, r) => n + r[2], 0), 3: rows.reduce((n, r) => n + r[3], 0), 4: rows.reduce((n, r) => n + r[4], 0) } };
    }

    if (type === 'cost-monthly') {
      const months = [];
      for (let i = 0; i < 12; i++) months.push(addMonths(`${fy}-04-01`, i).slice(0, 7));
      const rows = months.map((mk) => {
        const list = terms.filter((x) => x.start && x.start.slice(0, 7) === mk);
        const label = new Date(mk + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        return [label, list.length, list.filter((x) => x.contract.amc_type === 'Comprehensive').reduce((n, x) => n + x.amount, 0),
          list.filter((x) => x.contract.amc_type !== 'Comprehensive').reduce((n, x) => n + x.amount, 0), list.reduce((n, x) => n + x.amount, 0)];
      });
      return { title: `Monthly AMC Cost — ${fyLabel(fy)}`, note: 'A contract term is booked to the month it starts.',
        columns: ['Month', 'Terms Started', 'Comprehensive', 'Non-Comprehensive', 'Total'], money: [2, 3, 4], rows, chart: { label: 0, value: 4 },
        totals: { 1: rows.reduce((n, r) => n + r[1], 0), 2: rows.reduce((n, r) => n + r[2], 0), 3: rows.reduce((n, r) => n + r[3], 0), 4: rows.reduce((n, r) => n + r[4], 0) } };
    }

    if (type === 'cost-yearly') {
      const m = new Map();
      for (const x of terms) {
        if (!x.start) continue;
        const y = fyOf(x.start);
        if (!m.has(y)) m.set(y, { n: 0, amount: 0, vendors: new Set(), contracts: new Set() });
        const r = m.get(y);
        r.n += 1; r.amount += x.amount; r.vendors.add(x.vendor_id); r.contracts.add(x.contract.id);
      }
      const rows = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([y, r]) => [fyLabel(y), r.contracts.size, r.vendors.size, r.n, r.amount]);
      return { title: 'Yearly AMC Cost (by financial year)', note: 'A contract term is booked to the financial year it starts in.',
        columns: ['Financial Year', 'Contracts', 'Vendors', 'Terms', 'Total'], money: [4], rows, chart: { label: 0, value: 4 },
        totals: { 4: rows.reduce((n, r) => n + r[4], 0) } };
    }

    if (type === 'renewals') {
      const rs = await q('SELECT * FROM amc_renewals ORDER BY renewed_at DESC, id DESC');
      const byId = new Map(contracts.map((c) => [c.id, c]));
      const rows = rs.filter((r) => inRange(tsOut(r.renewed_at)?.slice(0, 10), from, to)).map((r) => {
        const c = byId.get(r.contract_id) || {};
        const oldA = Number(r.old_amount || 0), newA = Number(r.new_amount || 0);
        return [r.contract_id, c.contract_name || '', vname(c.vendor_id), dstr(r.old_start), dstr(r.old_expiry), oldA,
          dstr(r.new_start), dstr(r.new_expiry), newA, newA - oldA, oldA ? Math.round(((newA - oldA) / oldA) * 1000) / 10 : '',
          r.renewed_by || '', tsOut(r.renewed_at)?.slice(0, 10) || '', r.remarks || ''];
      });
      return { title: 'AMC Renewal History', columns: ['AMC ID', 'Contract', 'Vendor', 'Prev. Start', 'Prev. Expiry', 'Prev. Amount',
        'New Start', 'New Expiry', 'New Amount', 'Change', 'Change %', 'Renewed By', 'Renewed On', 'Remarks'], money: [5, 8, 9], rows,
        totals: { 5: rows.reduce((n, r) => n + r[5], 0), 8: rows.reduce((n, r) => n + r[8], 0), 9: rows.reduce((n, r) => n + r[9], 0) } };
    }

    const srs = (await q('SELECT * FROM amc_service_requests ORDER BY request_date DESC, id DESC')).map((r) => srOut(r, ctxRow));
    const srInRange = srs.filter((s) => inRange(s.request_date, from, to));
    const srCols = ['Request ID', 'Date', 'Priority', 'Status', 'Issue', 'Equipment', 'Contract', 'Vendor', 'Department', 'Raised By', 'Assigned To', 'Expected', 'Resolved On', 'Days Open', 'Overdue'];
    const srRow = (s) => [s.id, s.request_date, s.priority, s.status, s.issue, s.asset_name, s.contract_id, s.vendor_name, s.department, s.raised_by_name,
      [s.assigned_user_name, s.assigned_vendor_name].filter(Boolean).join(' / '), s.expected_date || '', s.actual_date || '',
      daysBetween(s.request_date, s.actual_date || t), s.overdue ? 'Yes' : ''];

    if (type === 'sr-status') {
      const summary = SR_STATUSES.map((st) => [st, ...PRIORITIES.map((p) => srInRange.filter((s) => s.status === st && s.priority === p).length),
        srInRange.filter((s) => s.status === st).length]);
      return { title: 'Service Request Status', columns: ['Status', ...PRIORITIES, 'Total'], rows: summary,
        totals: Object.fromEntries([1, 2, 3, 4, 5].map((i) => [i, summary.reduce((n, r) => n + r[i], 0)])),
        detail: { columns: srCols, rows: srInRange.map(srRow) } };
    }

    if (type === 'sr-pending') {
      const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      const list = srInRange.filter((s) => !SR_DONE.has(s.status))
        .sort((a, b) => (b.overdue - a.overdue) || (rank[a.priority] - rank[b.priority]) || a.request_date.localeCompare(b.request_date));
      return { title: 'Pending Service Requests', columns: srCols, rows: list.map(srRow) };
    }

    if (type === 'vendor-performance') {
      const m = new Map();
      for (const s of srInRange) {
        const k = s.vendor_id || '';
        if (!m.has(k)) m.set(k, { total: 0, resolved: 0, open: 0, overdue: 0, onTime: 0, withExpected: 0, days: 0 });
        const r = m.get(k);
        r.total += 1;
        if (SR_DONE.has(s.status)) {
          r.resolved += 1;
          if (s.actual_date) r.days += daysBetween(s.request_date, s.actual_date);
          if (s.expected_date && s.actual_date) { r.withExpected += 1; if (s.actual_date <= s.expected_date) r.onTime += 1; }
        } else {
          r.open += 1;
          if (s.overdue) r.overdue += 1;
        }
      }
      const rows = [...m.entries()].map(([id, r]) => [id ? vname(id) : '(No vendor)', r.total, r.resolved, r.open, r.overdue,
        r.resolved ? Math.round((r.days / r.resolved) * 10) / 10 : '', r.withExpected ? Math.round((r.onTime / r.withExpected) * 1000) / 10 : '',
        r.total ? Math.round((r.resolved / r.total) * 1000) / 10 : 0]).sort((a, b) => b[1] - a[1]);
      return { title: 'Vendor-wise Service Performance', note: 'Vendor = the vendor the request was assigned to, else the vendor of its AMC contract.',
        columns: ['Vendor', 'Requests', 'Resolved', 'Open', 'Overdue', 'Avg. Days to Resolve', 'On-time %', 'Resolution %'], rows };
    }

    throw new UserError('Unknown report', 404);
  }));

  /* ── Logs ──────────────────────────────────────────────────────── */

  app.get('/api/amc/notifications', requireAuth, route('manage', async () => {
    const rows = await q('SELECT * FROM amc_notification_log ORDER BY id DESC LIMIT 500');
    return rows.map((r) => ({
      id: r.id, kind: r.kind, ref_id: r.ref_id || '', offset_days: r.offset_days, subject: r.subject || '',
      recipients: r.recipients || '', status: r.status, error: r.error || '', attempts: Number(r.attempts || 0),
      triggered_by: r.triggered_by || '', created_at: tsOut(r.created_at), sent_at: tsOut(r.sent_at),
    }));
  }));

  app.get('/api/amc/activity', requireAuth, route('manage', async () => {
    const rows = await q('SELECT * FROM amc_activity_log ORDER BY id DESC LIMIT 500');
    return rows.map((r) => ({ id: r.id, entity: r.entity, entity_id: r.entity_id || '', action: r.action, detail: r.detail || '',
      user_name: r.user_name || '', created_at: tsOut(r.created_at) }));
  }));

  /* ── Settings (Admin) ──────────────────────────────────────────── */

  function cleanRecipients(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const e of list) {
      const s = String(e || '').trim();
      if (!s) continue;
      if (s.startsWith('user:') && /^user:[\w-]{1,16}$/.test(s)) out.push(s);
      else if (EMAIL_RE.test(s)) out.push(s.toLowerCase());
      else bad(`"${s}" is not a valid email address`);
    }
    return [...new Set(out)].slice(0, 50);
  }

  app.post('/api/amc/settings', requireAuth, route('settings', async (req) => {
    const b = req.body || {};
    const before = await settings();
    if (b.reminderDays !== undefined) {
      const days = (Array.isArray(b.reminderDays) ? b.reminderDays : String(b.reminderDays).split(/[,\s]+/))
        .map((x) => String(x).trim()).filter((x) => x !== '').map(Number);
      if (!days.length) bad('Give at least one reminder day (0 = on the expiry date)');
      if (days.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) bad('Reminder days must be whole numbers between 0 and 365');
      await writeCfg('reminderDays', [...new Set(days)].sort((a, b2) => b2 - a));
    }
    if (b.reminderHour !== undefined) {
      const h = Number(b.reminderHour);
      if (!Number.isInteger(h) || h < 0 || h > 23) bad('Reminder hour must be 0–23');
      await writeCfg('reminderHour', h);
    }
    if (b.upcomingWindow !== undefined) {
      const w = Number(b.upcomingWindow);
      if (!Number.isInteger(w) || w < 1 || w > 180) bad('The "upcoming renewal" window must be 1–180 days');
      await writeCfg('upcomingWindow', w);
    }
    if (b.reminderTo !== undefined) await writeCfg('reminderTo', cleanRecipients(b.reminderTo));
    if (b.srTo !== undefined) await writeCfg('srTo', cleanRecipients(b.srTo));
    if (b.overdueMail !== undefined) await writeCfg('overdueMail', !!b.overdueMail);
    const after = await settings();
    await logActivity(req, 'settings', '', 'updated', diff(
      Object.fromEntries(Object.entries(before).map(([k, v]) => [k, JSON.stringify(v)])),
      Object.fromEntries(Object.entries(after).map(([k, v]) => [k, JSON.stringify(v)])), Object.keys(CFG)));
    return after;
  }));

  app.post('/api/amc/roles', requireAuth, route('settings', async (req) => {
    const userId = str(req.body?.user_id, 16);
    const role = str(req.body?.role, 16);
    if (!userId) bad('Choose a user');
    const u = (await q('SELECT id, name, email, roles FROM users WHERE id = $1', [userId]))[0];
    if (!u) bad('That user does not exist');
    if (isSuperAdmin(u) || rolesOf(u).includes('Admin')) bad(`${u.name} is an ERP Admin and is always AMC Admin`);
    if (!role) {
      await q('DELETE FROM amc_roles WHERE user_id = $1', [userId]);
    } else {
      if (!ROLES.includes(role)) bad('Unknown role');
      await q(`INSERT INTO amc_roles (user_id, role, updated_by, updated_at) VALUES ($1,$2,$3,NOW())
               ON CONFLICT (user_id) DO UPDATE SET role=$4, updated_by=$5, updated_at=NOW()`, [userId, role, req.amc.by, role, req.amc.by]);
    }
    await logActivity(req, 'role', userId, 'set', `${u.name} → ${role ? ROLE_LABEL[role] : 'default'}`);
    return { ok: true };
  }));

  app.post('/api/amc/test-mail', requireAuth, route('settings', async (req) => {
    const mailer = getMailer();
    if (!mailer) bad('SMTP is not configured on this server (SMTP_USER / SMTP_PASS)');
    const to = await notifyAddressFor(req.amc.user.id, req.amc.user.email);
    if (!to || !EMAIL_RE.test(to)) bad('Your account has no email address to send the test to');
    await mailer.sendMail({
      from: `"AMC Management" <${process.env.SMTP_USER}>`, to,
      subject: 'AMC Management — test mail',
      html: mailHtml({ heading: 'Test mail', lead: 'If you can read this, AMC reminders and service-request mails can reach you.', rows: [['Sent by', escHtml(req.amc.by)], ['Server time', new Date().toISOString()]] }),
    });
    return { to };
  }));

  // Run the reminder/overdue sweep now (ignores the reminder hour). Safe to
  // press repeatedly — the notification log only lets each mail out once.
  app.post('/api/amc/run-reminders', requireAuth, route('settings', async (req) => {
    const r = await sweep({ force: true, by: req.amc.by });
    if (r.skipped) bad('A reminder run is already in progress — try again in a minute');
    await logActivity(req, 'settings', '', 'ran reminders', JSON.stringify(r));
    return r;
  }));

  // Every AMC table as one JSON file — the module's own backup.
  app.get('/api/amc/backup', requireAuth, route('settings', async (req, res) => {
    const tables = ['amc_vendors', 'amc_assets', 'amc_contracts', 'amc_contract_assets', 'amc_renewals', 'amc_service_requests',
      'amc_sr_notes', 'amc_roles', 'amc_notification_log', 'amc_activity_log'];
    const data = { exported_at: new Date().toISOString(), exported_by: req.amc.by, settings: await settings() };
    for (const tbl of tables) data[tbl] = await q(`SELECT * FROM ${tbl}`);
    await logActivity(req, 'settings', '', 'backup downloaded', '');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="amc-backup-${today()}.json"`);
    res.send(JSON.stringify(data, null, 1));
  }));

  return { sweep };
}

module.exports = { AMC_SCHEMA, mountAmc, _internals: { dueOffset, addMonths, addDays, fyOf, daysBetween } };
