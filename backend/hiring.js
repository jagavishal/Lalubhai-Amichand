'use strict';
/* =====================================================================
   Hiring FMS (route 'hr-hiring', HR Section)
   ---------------------------------------------------------------------
   Built 2026-11-17 from three handwritten pages (Hiring FMS, Onboarding
   process, Exit formality). Three flows on one page:

   1. HIRING
      Anyone raises a job request (position, division, location, salary
      bracket, interviewer(s), job description)        └─► Open (with HR)
      HR sends the JD to hiring agencies 1…n — each gets a mail (replies to
      inquiry@laltd.in) with a link to upload CVs        └─► Sourcing
      Each CV (agency link, or HR adds one) is mailed to the person who
      raised the request                        candidate └─► CV Received
      Requester shortlists / rejects            └─► Shortlisted / CV Rejected
      Interview scheduled on the Scheduler      └─► Interview Scheduled
      Interviewer approves / rejects / next round (here or from the mail)
                                                └─► Selected / Not Selected

   2. ONBOARDING (same candidate row)
      HR uploads the appointment letter → approving management
                                                └─► Offer Pending Approval
      Management approves (or sends back)      └─► Offer Approved / Offer Revision
      HR uploads the digitally signed letter → mailed to the candidate with
      a link: Accept / Accept with changes / Decline  └─► Offer Sent
      The answer is mailed to inquiry@ + HR + management
                                    └─► Offer Accepted / Candidate Asked Changes / Offer Declined
      (changes → management: revise the offer → HR again, or drop)
      Before joining: ERP login, laptop, buddy (+ Employee Master record)
      Date of joining: signed letter mailed, introductions, dashboard intro,
      buddy for the first month                 └─► Joined → Onboarded

   3. EXIT
      Notice (employee or HR)                   └─► Notice Received
      HR confirms the last working day + concerned manager
                                                └─► Dues Clearance
      Final dues cleared by Jayesh Udani + Mahendrabhai + the manager
                                                └─► Leave Contract Pending
      Employee signs the leave contract; HR uploads it └─► Completed
      (hr_exits row written, employee Inactive, ERP login off)

   Who is who (app_config, Settings tab):
   - HR: hire_hr (default ARCHANA by name; else Admins act as HR)
   - Approving management: hire_mgmt (default Saloni Anchan + Sajil Shah)
   - Final dues: hire_dues (default Jayesh Udani + Mahendra Chandulal Shah)
   - Inquiry mailbox: hire_inquiry (default inquiry@laltd.in)
   - Managers: Admin role, owner, or the 'hr-hiring' grant.

   Public links (no login), all signed with tokenFor (60-day expiry):
   /hire-cv     agency CV upload (token 'hcv:<request>', agency id)
   /hire-offer  candidate offer response (token 'hof:<candidate>')
   /hire-action interviewer result + management offer approval
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'hiring');

const HIRE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hire_requests (
     id VARCHAR(16) PRIMARY KEY,
     position VARCHAR(255) NOT NULL,
     division VARCHAR(128) NOT NULL DEFAULT '',
     location VARCHAR(128) NOT NULL DEFAULT '',
     openings INT NOT NULL DEFAULT 1,
     salary_min DECIMAL(12,2) DEFAULT NULL,
     salary_max DECIMAL(12,2) DEFAULT NULL,
     experience VARCHAR(128) NOT NULL DEFAULT '',
     interviewers TEXT,
     description TEXT,
     documents TEXT,
     agencies TEXT,
     status VARCHAR(40) NOT NULL DEFAULT 'Open',
     requested_by_id VARCHAR(16) DEFAULT NULL,
     requested_by_name VARCHAR(255) DEFAULT '',
     closed_at DATETIME DEFAULT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hire_agencies (
     id VARCHAR(16) PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     contact_person VARCHAR(255) NOT NULL DEFAULT '',
     email VARCHAR(255) NOT NULL DEFAULT '',
     phone VARCHAR(64) NOT NULL DEFAULT '',
     active SMALLINT NOT NULL DEFAULT 1,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hire_candidates (
     id VARCHAR(16) PRIMARY KEY,
     request_id VARCHAR(16) NOT NULL,
     name VARCHAR(255) NOT NULL,
     email VARCHAR(255) NOT NULL DEFAULT '',
     phone VARCHAR(64) NOT NULL DEFAULT '',
     experience VARCHAR(128) NOT NULL DEFAULT '',
     current_ctc VARCHAR(64) NOT NULL DEFAULT '',
     expected_ctc VARCHAR(64) NOT NULL DEFAULT '',
     notice_period VARCHAR(64) NOT NULL DEFAULT '',
     source VARCHAR(255) NOT NULL DEFAULT '',
     agency_id VARCHAR(16) DEFAULT NULL,
     notes TEXT,
     documents TEXT,
     status VARCHAR(40) NOT NULL DEFAULT 'CV Received',
     interview_at DATETIME DEFAULT NULL,
     interview_round INT NOT NULL DEFAULT 0,
     meeting_id VARCHAR(16) DEFAULT NULL,
     meeting_link VARCHAR(512) DEFAULT '',
     interviewers TEXT,
     result_remarks TEXT,
     result_by VARCHAR(255) DEFAULT '',
     designation VARCHAR(128) NOT NULL DEFAULT '',
     ctc VARCHAR(64) NOT NULL DEFAULT '',
     doj DATE DEFAULT NULL,
     offer_version INT NOT NULL DEFAULT 0,
     offer_remarks TEXT,
     offer_by VARCHAR(255) DEFAULT '',
     response VARCHAR(40) NOT NULL DEFAULT '',
     response_note TEXT,
     response_at DATETIME DEFAULT NULL,
     checklist TEXT,
     employee_id VARCHAR(16) DEFAULT NULL,
     user_id VARCHAR(16) DEFAULT NULL,
     buddy_id VARCHAR(16) DEFAULT NULL,
     buddy_name VARCHAR(255) DEFAULT '',
     joined_on DATE DEFAULT NULL,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_hirecand_req ON hire_candidates (request_id)`,
  `CREATE TABLE IF NOT EXISTS hire_exits (
     id VARCHAR(16) PRIMARY KEY,
     employee_id VARCHAR(16) DEFAULT NULL,
     user_id VARCHAR(16) DEFAULT NULL,
     employee_name VARCHAR(255) NOT NULL,
     email VARCHAR(255) NOT NULL DEFAULT '',
     designation VARCHAR(128) NOT NULL DEFAULT '',
     department VARCHAR(128) NOT NULL DEFAULT '',
     exit_type VARCHAR(32) NOT NULL DEFAULT 'Resignation',
     notice_date DATE DEFAULT NULL,
     last_working_day DATE DEFAULT NULL,
     reason TEXT,
     manager_id VARCHAR(16) DEFAULT NULL,
     manager_name VARCHAR(255) DEFAULT '',
     dues TEXT,
     documents TEXT,
     status VARCHAR(40) NOT NULL DEFAULT 'Notice Received',
     created_by_id VARCHAR(16) DEFAULT NULL,
     created_by_name VARCHAR(255) DEFAULT '',
     completed_at DATETIME DEFAULT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hire_log (
     id INT AUTO_INCREMENT PRIMARY KEY,
     ref_id VARCHAR(16) NOT NULL,
     action VARCHAR(60) NOT NULL,
     note TEXT,
     docs TEXT,
     by_id VARCHAR(16) DEFAULT NULL,
     by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_hirelog_ref ON hire_log (ref_id)`,
];

const RS = { OPEN: 'Open', SOURCING: 'Sourcing', HOLD: 'On Hold', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
const R_OPEN = [RS.OPEN, RS.SOURCING, RS.HOLD];
const C = {
  NEW: 'CV Received', SHORT: 'Shortlisted', CVREJ: 'CV Rejected', INTERVIEW: 'Interview Scheduled',
  SELECTED: 'Selected', NOTSEL: 'Not Selected',
  OFFER_APPROVAL: 'Offer Pending Approval', OFFER_REVISION: 'Offer Revision', OFFER_APPROVED: 'Offer Approved',
  OFFER_SENT: 'Offer Sent', CAND_CHANGES: 'Candidate Asked Changes', DECLINED: 'Offer Declined',
  ACCEPTED: 'Offer Accepted', JOINED: 'Joined', ONBOARDED: 'Onboarded', DROPPED: 'Dropped',
};
const C_HIRING = [C.NEW, C.SHORT, C.INTERVIEW];
const C_ONBOARD = [C.SELECTED, C.OFFER_APPROVAL, C.OFFER_REVISION, C.OFFER_APPROVED, C.OFFER_SENT, C.CAND_CHANGES, C.ACCEPTED, C.JOINED];
const C_CLOSED = [C.CVREJ, C.NOTSEL, C.DECLINED, C.ONBOARDED, C.DROPPED];
const X = { NOTICE: 'Notice Received', DUES: 'Dues Clearance', CONTRACT: 'Leave Contract Pending', DONE: 'Completed', WITHDRAWN: 'Withdrawn' };
const X_OPEN = [X.NOTICE, X.DUES, X.CONTRACT];
const EXIT_TYPES = ['Resignation', 'Termination', 'Retirement', 'Contract End', 'Absconding', 'Other'];

/* The onboarding checklist — the handwritten pages, in order. `stage`
   'before' must be done before the date of joining, 'doj' on/after it. */
const CHECKLIST = [
  { key: 'employee', stage: 'before', label: 'Employee record created in Employee Master' },
  { key: 'login', stage: 'before', label: 'ERP (dashboard) login created' },
  { key: 'laptop', stage: 'before', label: 'Laptop assigned on the dashboard' },
  { key: 'buddy', stage: 'before', label: 'Buddy assigned' },
  { key: 'letter', stage: 'doj', label: 'Signed appointment letter given by email' },
  { key: 'intro_mgmt', stage: 'doj', label: 'Introduction to all management + employees' },
  { key: 'intro_dash', stage: 'doj', label: 'Introduction to the dashboard (ERP)' },
  { key: 'buddy_month', stage: 'doj', label: 'Buddy for the first month of employment' },
];

const TOKEN = { cv: 'hcv:', offer: 'hof:', result: 'hir:', approve: 'hap:' };
const CFG = { hr: 'hire_hr', mgmt: 'hire_mgmt', dues: 'hire_dues', inquiry: 'hire_inquiry', cc: 'hire_cc' };
const DEFAULTS = {
  hr: [['archana']],
  mgmt: [['saloni', 'anchan'], ['sajil', 'shah']],
  dues: [['jayesh', 'udani'], ['mahendra', 'shah']],
  inquiry: 'inquiry@laltd.in',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DOC_TYPES = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const DOC_MAX = 5;
const DOC_BYTES = 4 * 1024 * 1024;
const DOC_TOTAL = 8 * 1024 * 1024;
const MAIL_ATTACH_MAX = 15 * 1024 * 1024;

/* ── Small helpers ─────────────────────────────────────────────────── */

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg) => { throw new UserError(msg); };
const str = (v, max = 255) => String(v ?? '').trim().slice(0, max);
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
// interview_at is an IST wall-clock DATETIME ("2026-11-20 11:30:00").
function wall(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}`;
  }
  return String(v).replace('T', ' ').slice(0, 16);
}
function optDate(v, label) {
  const s = str(v, 10);
  if (!s) return null;
  if (!ISO_RE.test(s) || isNaN(new Date(s + 'T00:00:00Z').getTime())) bad(`${label} is not a valid date`);
  return s;
}
function optMoney(v, label) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  if (!isFinite(n) || n < 0) bad(`${label} is not a valid amount`);
  return Math.round(n * 100) / 100;
}
const parseJson = (raw, dflt) => { try { const d = typeof raw === 'string' ? JSON.parse(raw) : raw; return d ?? dflt; } catch { return dflt; } };
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const fmtWall = (w) => { if (!w) return ''; const [d, t] = w.split(' '); const [h, mi] = (t || '00:00').split(':').map(Number); return `${fmtDate(d)} ${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const inr = (n) => (n == null ? '' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const nl2br = (s) => escHtml(s).replace(/\n/g, '<br>');
const uniq = (list) => {
  const seen = new Set();
  return list.filter((e) => { const k = String(e || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
const minus = (list, out) => list.filter((e) => !out.some((o) => o.toLowerCase() === e.toLowerCase()));

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m || !m[2]) return null;
  return { mimeType: (m[1] || '').toLowerCase(), buffer: Buffer.from(m[3], 'base64') };
}

function decodeFiles(list, label, { only } = {}) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > DOC_MAX) bad(`${label}: at most ${DOC_MAX} files`);
  let total = 0;
  return list.map((d, i) => {
    const name = String(d?.name || `document-${i + 1}`).replace(/[\\/]+/g, '_').slice(0, 120);
    const parsed = parseDataUrl(d?.dataUrl);
    if (!parsed) bad(`${label}: could not read "${name}"`);
    const ext = DOC_TYPES[parsed.mimeType];
    if (!ext || (only && !only.includes(ext))) bad(`${label}: "${name}" — only ${only ? only.map((x) => x.toUpperCase()).join(' / ') : 'PDF, images, Excel and Word'} files are accepted`);
    if (parsed.buffer.length > DOC_BYTES) bad(`${label}: "${name}" is over 4 MB`);
    total += parsed.buffer.length;
    if (total > DOC_TOTAL) bad('Attachments together must be under 8 MB');
    const safe = name.replace(/[^\w.\- ()]/g, '_').replace(/\.[^.]*$/, '') || 'document';
    return { name, safe, ext, size: parsed.buffer.length, type: parsed.mimeType, buffer: parsed.buffer };
  });
}

async function writeFiles(id, files, meta) {
  if (!files.length) return [];
  const dir = path.join(UPLOAD_ROOT, id);
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = Date.now().toString(36);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const file = `${stamp}-${meta.kind}${meta.v ? '-v' + meta.v : ''}-${i + 1}-${f.safe}.${f.ext}`;
    await fs.promises.writeFile(path.join(dir, file), f.buffer);
    out.push({ name: f.name, file, size: f.size, type: f.type, ...meta, at: new Date().toISOString() });
  }
  return out;
}

/* ── Mail shell ────────────────────────────────────────────────────── */

function mailHtml({ heading, colour = '#0150AA', lead, rows = [], extraHtml = '', actions = '', footer, link, linkLabel = 'Open in ERP' }) {
  const cells = rows
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `<tr>
        <td style="padding:8px;background:#f8fafc;font-weight:600;color:#374151;width:170px;border-bottom:1px solid #eef2f7">${escHtml(k)}</td>
        <td style="padding:8px;color:#374151;border-bottom:1px solid #eef2f7">${v}</td>
      </tr>`).join('');
  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;padding:24px;border:1px solid #e2e8f0;border-radius:8px">
      <h2 style="color:${colour};margin:0 0 16px;font-size:19px">${heading}</h2>
      <p style="color:#374151">${lead}</p>
      ${cells ? `<table style="width:100%;border-collapse:collapse;margin:16px 0">${cells}</table>` : ''}
      ${extraHtml}
      ${actions}
      ${footer ? `<p style="color:#374151">${footer}</p>` : ''}
      ${link ? `<p><a href="${escHtml(link)}" style="display:inline-block;background:#0150AA;color:#fff;padding:9px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escHtml(linkLabel)}</a></p>` : ''}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">Lallubhai Amichand Ltd.</p>
    </div>`;
}

function mailButtons(list) {
  const btn = ([label, colour, href]) => `<td style="padding:0 8px 8px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate">
        <tr><td style="background:${colour};border-radius:6px">
          <a href="${escHtml(href)}" style="display:inline-block;padding:10px 18px;font-family:Arial,sans-serif;
             font-size:13.5px;font-weight:bold;color:#ffffff;text-decoration:none">${escHtml(label)}</a>
        </td></tr>
      </table>
    </td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 6px"><tr>${list.map(btn).join('')}</tr></table>`;
}

/* Public page shell for the agency / candidate links — wider than the
   approval confirm page, and can carry its own script. */
function publicPage({ title, body, script = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escHtml(title)} — Lallubhai Amichand Ltd.</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; background:#f1f5f9; font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif; color:#0f172a; padding:24px 16px; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:26px 28px; max-width:620px; margin:0 auto; box-shadow:0 1px 3px rgba(15,23,42,.06); }
  .brand { font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#0150AA; margin-bottom:6px; }
  h1 { font-size:20px; margin:0 0 10px; }
  p { font-size:14px; line-height:1.55; color:#475569; margin:0 0 14px; }
  table.info { width:100%; border-collapse:collapse; margin:14px 0 18px; font-size:13.5px; }
  table.info th { text-align:left; font-weight:600; color:#334155; background:#f8fafc; padding:8px 10px; width:150px; vertical-align:top; }
  table.info td { padding:8px 10px; color:#475569; white-space:pre-wrap; }
  label { display:block; font-size:12px; font-weight:700; color:#334155; margin:12px 0 4px; }
  input, textarea, select { width:100%; padding:9px 11px; border:1.5px solid #e2e8f0; border-radius:8px; font:inherit; font-size:14px; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
  @media (max-width:560px) { .row { grid-template-columns:1fr; } .card { padding:20px 18px; } }
  button { font:inherit; font-size:14px; font-weight:700; color:#fff; background:#0150AA; border:0; border-radius:8px; padding:12px 24px; cursor:pointer; margin-top:16px; }
  button:disabled { opacity:.6; cursor:wait; }
  .opt { display:flex; gap:10px; align-items:flex-start; border:1.5px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin:8px 0; cursor:pointer; font-weight:600; font-size:14px; }
  .opt input { width:auto; margin-top:3px; }
  .opt small { display:block; font-weight:400; color:#64748b; }
  .msg { margin-top:14px; padding:10px 12px; border-radius:8px; font-size:13.5px; display:none; }
  .ok { background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; display:block; }
  .err { background:#fef2f2; color:#991b1b; border:1px solid #fecaca; display:block; }
  a { color:#0150AA; }
  .note { font-size:12px; color:#94a3b8; margin-top:20px; }
</style></head><body><div class="card">
  <div class="brand">Lallubhai Amichand Ltd.</div>
  ${body}
</div>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

/* ===================================================================== */

function mountHiring(app, ctx) {
  const {
    q, pool, ensureSchema, requireAuth, withSeqId, getMailer, notifyAddressFor,
    appOrigin, useDb, tokenFor, readToken, actionPage, isManager, createMeeting, departments,
  } = ctx;
  // server.js's istToday() returns { iso, md }.
  const istToday = () => { const t = ctx.istToday(); return typeof t === 'string' ? t : t.iso; };

  // The router has no query strings — the page opens on "Needs My Action".
  const pageLink = () => `${appOrigin}/#hr-hiring`;

  /* ── Settings ──────────────────────────────────────────────────── */

  async function readCfg(name) {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [CFG[name]]);
      if (rows.length) return JSON.parse(rows[0].value);
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('[hire] could not read setting', name, '—', e.message);
    }
    return null;
  }
  async function writeCfg(name, value) {
    const json = JSON.stringify(value);
    await q(`INSERT INTO app_config ("key","value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value"=$3`, [CFG[name], json, json]);
  }

  async function activeUsers() {
    const rows = await q(`SELECT id, name, email, department, roles, active FROM users ORDER BY name`);
    return rows.filter((u) => Number(u.active ?? 1) !== 0);
  }

  // A default person is matched by every word of their name; two matches
  // (two Archanas) means no default rather than the wrong one.
  function byWords(users, words) {
    const hits = users.filter((u) => {
      const n = String(u.name || '').toLowerCase();
      return words.every((w) => n.split(/\s+/).includes(w));
    });
    return hits.length === 1 ? hits[0].id : null;
  }

  async function settings() {
    const [hr, mgmt, dues, inquiry, cc, users] = await Promise.all([
      readCfg('hr'), readCfg('mgmt'), readCfg('dues'), readCfg('inquiry'), readCfg('cc'), activeUsers()]);
    const live = new Set(users.map((u) => u.id));
    const ids = (list, key) => (Array.isArray(list)
      ? list.map(String).filter((id) => live.has(id))
      : DEFAULTS[key].map((w) => byWords(users, w)).filter(Boolean));
    return {
      hr: ids(hr, 'hr'), mgmt: ids(mgmt, 'mgmt'), dues: ids(dues, 'dues'),
      inquiry: typeof inquiry === 'string' && EMAIL_RE.test(inquiry) ? inquiry : DEFAULTS.inquiry,
      cc: Array.isArray(cc) ? cc.filter((e) => EMAIL_RE.test(e)) : [],
      set: { hr: Array.isArray(hr), mgmt: Array.isArray(mgmt), dues: Array.isArray(dues) },
      users,
    };
  }

  /* ── Who is asking ─────────────────────────────────────────────── */

  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'Hiring FMS needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        if (!user) return res.status(401).json({ error: 'Please log in again' });
        const cfg = await settings();
        const me = { user, cfg, by: user.name || user.email || '', manager: await isManager(user) };
        // No HR picked → the managers do the HR steps.
        me.hr = cfg.hr.includes(user.id) || (me.manager && !cfg.hr.length);
        me.mgmt = cfg.mgmt.includes(user.id) || (me.manager && !cfg.mgmt.length);
        me.dues = cfg.dues.includes(user.id);
        me.staff = me.hr || me.manager;
        me.all = me.staff || me.mgmt;
        if (need === 'manager' && !me.manager) return res.status(403).json({ error: 'Only an Admin (or someone given Hiring FMS (admin) in Users → Access) can change these settings' });
        if (need === 'hr' && !me.staff) return res.status(403).json({ error: 'Only HR can do this' });
        req.hire = me;
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[hire]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }

  async function logStep(id, action, note, by, docs = []) {
    await q(`INSERT INTO hire_log (ref_id, action, note, docs, by_id, by_name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, action, String(note || '').slice(0, 4000), JSON.stringify(docs), by?.id || null, by?.name || 'System']);
  }
  const actor = (me) => ({ id: me.user.id, name: me.by });

  /* ── Row shapes ────────────────────────────────────────────────── */

  const docsOut = (raw) => parseJson(raw, []).map((d, n) => ({ name: d.name, size: d.size, kind: d.kind, v: d.v || null, by: d.by || '', at: d.at || null, n }));

  function reqOut(r) {
    return {
      id: r.id, position: r.position, division: r.division || '', location: r.location || '', openings: Number(r.openings || 1),
      salary_min: r.salary_min == null ? null : Number(r.salary_min), salary_max: r.salary_max == null ? null : Number(r.salary_max),
      experience: r.experience || '', interviewers: parseJson(r.interviewers, []), description: r.description || '',
      docs: docsOut(r.documents), agencies: parseJson(r.agencies, []), status: r.status,
      requested_by_id: r.requested_by_id || null, requested_by_name: r.requested_by_name || '',
      closed_at: tsOut(r.closed_at), created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
    };
  }
  function candOut(r) {
    return {
      id: r.id, request_id: r.request_id, name: r.name, email: r.email || '', phone: r.phone || '', experience: r.experience || '',
      current_ctc: r.current_ctc || '', expected_ctc: r.expected_ctc || '', notice_period: r.notice_period || '',
      source: r.source || '', agency_id: r.agency_id || null, notes: r.notes || '', docs: docsOut(r.documents), status: r.status,
      interview_at: wall(r.interview_at), interview_round: Number(r.interview_round || 0), meeting_id: r.meeting_id || null, meeting_link: r.meeting_link || '',
      interviewers: parseJson(r.interviewers, []), result_remarks: r.result_remarks || '', result_by: r.result_by || '',
      designation: r.designation || '', ctc: r.ctc || '', doj: dstr(r.doj), offer_version: Number(r.offer_version || 0),
      offer_remarks: r.offer_remarks || '', offer_by: r.offer_by || '',
      response: r.response || '', response_note: r.response_note || '', response_at: tsOut(r.response_at),
      checklist: parseJson(r.checklist, {}), employee_id: r.employee_id || null, user_id: r.user_id || null,
      buddy_id: r.buddy_id || null, buddy_name: r.buddy_name || '', joined_on: dstr(r.joined_on),
      created_by: r.created_by || '', created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
    };
  }
  function exitOut(r) {
    return {
      id: r.id, employee_id: r.employee_id || null, user_id: r.user_id || null, employee_name: r.employee_name, email: r.email || '',
      designation: r.designation || '', department: r.department || '', exit_type: r.exit_type, notice_date: dstr(r.notice_date),
      last_working_day: dstr(r.last_working_day), reason: r.reason || '', manager_id: r.manager_id || null, manager_name: r.manager_name || '',
      dues: parseJson(r.dues, []), docs: docsOut(r.documents), status: r.status,
      created_by_id: r.created_by_id || null, created_by_name: r.created_by_name || '',
      completed_at: tsOut(r.completed_at), created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
    };
  }

  /* ── Rights ────────────────────────────────────────────────────── */

  const reqVisible = (r, me) => me.all || r.requested_by_id === me.user.id || r.interviewers.includes(me.user.id);
  function reqRights(r, me) {
    const own = r.requested_by_id === me.user.id;
    return {
      agencies: me.staff && [RS.OPEN, RS.SOURCING, RS.HOLD].includes(r.status),
      addCv: (me.staff || own) && [RS.OPEN, RS.SOURCING].includes(r.status),
      edit: (me.staff || own) && R_OPEN.includes(r.status),
      status: me.staff,
      cancel: own && r.status === RS.OPEN,
      del: !!me.user.isSuperAdmin,
    };
  }

  const candInterviewers = (c, r) => (c.interviewers.length ? c.interviewers : r?.interviewers || []);
  const candVisible = (c, r, me) => me.all || r?.requested_by_id === me.user.id || candInterviewers(c, r).includes(me.user.id);
  function candRights(c, r, me) {
    const own = r?.requested_by_id === me.user.id;
    const iv = candInterviewers(c, r).includes(me.user.id);
    return {
      screen: (me.staff || own) && c.status === C.NEW,
      schedule: (me.staff || own) && [C.SHORT, C.INTERVIEW].includes(c.status),
      result: (iv || me.manager) && c.status === C.INTERVIEW,
      offer: me.staff && [C.SELECTED, C.OFFER_REVISION].includes(c.status),
      offerDecide: me.mgmt && c.status === C.OFFER_APPROVAL,
      sendOffer: me.staff && c.status === C.OFFER_APPROVED,
      record: me.staff && c.status === C.OFFER_SENT,
      changesDecide: (me.mgmt || me.staff) && c.status === C.CAND_CHANGES,
      checklist: me.staff && [C.ACCEPTED, C.JOINED].includes(c.status),
      joined: me.staff && c.status === C.ACCEPTED,
      edit: me.staff || (own && C_HIRING.includes(c.status)),
      drop: me.staff && !C_CLOSED.includes(c.status) && c.status !== C.JOINED,
      del: !!me.user.isSuperAdmin,
    };
  }

  const exitVisible = (x, me) => me.all || me.dues || x.user_id === me.user.id || x.manager_id === me.user.id
    || x.dues.some((d) => d.id === me.user.id);
  function exitRights(x, me) {
    const myDue = x.dues.find((d) => d.id === me.user.id && d.status === 'pending');
    return {
      confirm: me.staff && x.status === X.NOTICE,
      clear: x.status === X.DUES && (!!myDue || me.staff),
      myDue: x.status === X.DUES && !!myDue,
      contract: me.staff && x.status === X.CONTRACT,
      complete: me.staff && x.status === X.CONTRACT,
      withdraw: (me.staff || x.user_id === me.user.id) && X_OPEN.includes(x.status),
      del: !!me.user.isSuperAdmin,
    };
  }

  /* ── Loaders ───────────────────────────────────────────────────── */

  async function loadReq(id, me) {
    const row = (await q('SELECT * FROM hire_requests WHERE id = $1', [id]))[0];
    if (!row) throw new UserError('Job request not found', 404);
    const r = reqOut(row);
    if (me && !reqVisible(r, me)) throw new UserError('You cannot view this job request', 403);
    return { r, row };
  }
  async function loadCand(id, me) {
    const row = (await q('SELECT * FROM hire_candidates WHERE id = $1', [id]))[0];
    if (!row) throw new UserError('Candidate not found', 404);
    const c = candOut(row);
    const rrow = (await q('SELECT * FROM hire_requests WHERE id = $1', [c.request_id]))[0];
    const r = rrow ? reqOut(rrow) : null;
    if (me && !candVisible(c, r, me)) throw new UserError('You cannot view this candidate', 403);
    return { c, r, row };
  }
  async function loadExit(id, me) {
    const row = (await q('SELECT * FROM hire_exits WHERE id = $1', [id]))[0];
    if (!row) throw new UserError('Exit record not found', 404);
    const x = exitOut(row);
    if (me && !exitVisible(x, me)) throw new UserError('You cannot view this exit', 403);
    return { x, row };
  }
  const TABLE_OF = (id) => (id.startsWith('JR') ? 'hire_requests' : id.startsWith('CAN') ? 'hire_candidates' : 'hire_exits');

  async function addDocs(id, stored) {
    if (!stored.length) return [];
    const table = TABLE_OF(id);
    const row = (await q(`SELECT documents FROM ${table} WHERE id = $1`, [id]))[0];
    const list = [...parseJson(row?.documents, []), ...stored];
    await q(`UPDATE ${table} SET documents = $1 WHERE id = $2`, [JSON.stringify(list), id]);
    const base = list.length - stored.length;
    return stored.map((_, i) => base + i);
  }
  async function saveDocs(id, files, meta) {
    return addDocs(id, await writeFiles(id, files, meta));
  }
  // A guarded status move: refuses when someone else moved it first.
  async function move(table, id, from, to, extraSql = '', extra = []) {
    const froms = Array.isArray(from) ? from : [from];
    const params = [to, ...extra, id, ...froms];
    const base = 2 + extra.length;
    const r = await pool.query(
      `UPDATE ${table} SET status=$1${extraSql}, updated_at=NOW() WHERE id=$${base} AND status IN (${froms.map((_, i) => '$' + (base + 1 + i)).join(',')})`,
      params);
    if (!r.rowCount) bad('This record just changed — reload');
  }

  /* ── Recipients + mail ─────────────────────────────────────────── */

  async function addressOf(userId) {
    if (!userId) return '';
    const u = (await q('SELECT id, email, active FROM users WHERE id = $1', [userId]))[0];
    if (!u || Number(u.active ?? 1) === 0) return '';
    const e = await notifyAddressFor(u.id, u.email);
    return e && EMAIL_RE.test(e) ? e : '';
  }
  async function people(ids, users) {
    const out = [];
    for (const id of uniq(ids || [])) {
      const email = await addressOf(id);
      const u = users.find((x) => x.id === id);
      if (email) out.push({ id, name: u?.name || email, email });
    }
    return out;
  }
  const emails = async (ids, users) => (await people(ids, users)).map((p) => p.email);

  async function attachmentsFor(id, ns) {
    const row = (await q(`SELECT documents FROM ${TABLE_OF(id)} WHERE id = $1`, [id]))[0];
    const all = parseJson(row?.documents, []);
    const list = ns.map((n) => all[n]).filter(Boolean)
      .map((d) => ({ filename: d.name, path: path.join(UPLOAD_ROOT, id, path.basename(d.file)), size: d.size || 0, contentType: d.type || undefined }))
      .filter((a) => fs.existsSync(a.path));
    let total = 0;
    return list.filter((a) => (total += a.size) <= MAIL_ATTACH_MAX).map(({ size, ...a }) => a);
  }
  const lastDoc = (docs, kinds) => [...docs].reverse().find((d) => kinds.includes(d.kind)) || null;

  async function send(msg, tag) {
    const mailer = getMailer();
    if (!mailer) { console.log('[hire] mail not sent (no SMTP) —', tag); return false; }
    const to = uniq(String(msg.to || '').split(',').map((s) => s.trim()));
    if (!to.length) { console.log('[hire] nobody to mail —', tag); return false; }
    const cc = minus(uniq(String(msg.cc || '').split(',').map((s) => s.trim())), to);
    await mailer.sendMail({ from: `"${msg.fromName || 'Hiring – Lallubhai Amichand'}" <${process.env.SMTP_USER}>`, ...msg, to: to.join(', '), cc: cc.length ? cc.join(', ') : undefined });
    console.log('[hire]', tag, 'mailed to', to.join(', '), cc.length ? '| cc: ' + cc.join(', ') : '');
    return true;
  }
  // Fire-and-forget: a mail problem never fails the step that caused it.
  const later = (tag, fn) => { fn().catch((e) => console.error('[hire] mail', tag, '—', e.message)); };

  const salaryText = (r) => (r.salary_min != null || r.salary_max != null
    ? [r.salary_min != null ? inr(r.salary_min) : '', r.salary_max != null ? inr(r.salary_max) : ''].filter(Boolean).join(' – ') + ' per month'
    : '');
  const reqRows = (r, { salary = true } = {}) => [
    ['Job Request', `<b>${escHtml(r.id)}</b>`], ['Position', escHtml(r.position)], ['Division', escHtml(r.division)],
    ['Location', escHtml(r.location)], ['Openings', String(r.openings)], ['Experience', escHtml(r.experience)],
    ...(salary ? [['Salary Bracket', escHtml(salaryText(r))]] : []), ['Requested By', escHtml(r.requested_by_name)],
  ];
  const candRows = (c, r) => [
    ['Candidate', `<b>${escHtml(c.name)}</b> (${escHtml(c.id)})`], ['Position', escHtml(r?.position || '')],
    ['Phone', escHtml(c.phone)], ['Email', escHtml(c.email)], ['Experience', escHtml(c.experience)],
    ['Current CTC', escHtml(c.current_ctc)], ['Expected CTC', escHtml(c.expected_ctc)], ['Notice Period', escHtml(c.notice_period)],
    ['Source', escHtml(c.source)],
  ];
  const userName = (users, id) => users.find((u) => u.id === id)?.name || '';

  /* ── Data ──────────────────────────────────────────────────────── */

  app.get('/api/hiring/data', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const [reqRowsAll, candRowsAll, exitRowsAll, agencyRows] = await Promise.all([
      q('SELECT * FROM hire_requests ORDER BY created_at DESC, id DESC'),
      q('SELECT * FROM hire_candidates ORDER BY created_at DESC, id DESC'),
      q('SELECT * FROM hire_exits ORDER BY created_at DESC, id DESC'),
      q('SELECT * FROM hire_agencies ORDER BY name'),
    ]);
    const reqMap = new Map(reqRowsAll.map((row) => { const r = reqOut(row); return [r.id, r]; }));
    const requests = [...reqMap.values()].filter((r) => reqVisible(r, me)).map((r) => ({ ...r, can: reqRights(r, me) }));
    const candidates = candRowsAll.map(candOut).filter((c) => candVisible(c, reqMap.get(c.request_id), me))
      .map((c) => { const r = reqMap.get(c.request_id); return { ...c, position: r?.position || '', can: candRights(c, r, me) }; });
    const exits = exitRowsAll.map(exitOut).filter((x) => exitVisible(x, me)).map((x) => ({ ...x, can: exitRights(x, me) }));
    const users = me.cfg.users.map((u) => ({ id: u.id, name: u.name, department: u.department || '', email: me.staff ? u.email || '' : undefined }));
    const out = {
      me: { id: me.user.id, name: me.user.name, manager: me.manager, hr: me.hr, mgmt: me.mgmt, dues: me.dues, staff: me.staff, all: me.all },
      requests, candidates, exits, users,
      agencies: agencyRows.filter((a) => me.staff || Number(a.active)).map((a) => ({
        id: a.id, name: a.name, contact_person: a.contact_person || '', active: !!Number(a.active),
        ...(me.staff ? { email: a.email || '', phone: a.phone || '' } : {}),
      })),
      lists: { RS, C, X, R_OPEN, C_HIRING, C_ONBOARD, C_CLOSED, X_OPEN, EXIT_TYPES, CHECKLIST },
      people: {
        hr: me.cfg.hr.map((id) => userName(me.cfg.users, id)).filter(Boolean),
        mgmt: me.cfg.mgmt.map((id) => userName(me.cfg.users, id)).filter(Boolean),
        dues: me.cfg.dues.map((id) => userName(me.cfg.users, id)).filter(Boolean),
        inquiry: me.cfg.inquiry,
      },
      today: istToday(),
    };
    out.divisions = await departments().catch(() => []);
    out.locations = (await q(`SELECT DISTINCT branch FROM hr_employees WHERE branch <> '' ORDER BY branch`).catch(() => [])).map((r) => r.branch);
    // The person's own employee row, so "Submit my notice" can prefill.
    const self = (await q(`SELECT id, name, designation, department FROM hr_employees WHERE user_id = $1 AND status = 'Active'`, [me.user.id]).catch(() => []))[0];
    out.self = self || null;
    if (me.staff) {
      out.employees = (await q(`SELECT id, user_id, name, email, designation, department, branch, reporting_to FROM hr_employees WHERE status = 'Active' ORDER BY name`))
        .map((e) => ({ id: e.id, user_id: e.user_id || null, name: e.name, email: e.email || '', designation: e.designation || '', department: e.department || '', branch: e.branch || '', reporting_to: e.reporting_to || '' }));
    }
    if (me.manager) {
      out.settings = { hr: me.cfg.hr, mgmt: me.cfg.mgmt, dues: me.cfg.dues, inquiry: me.cfg.inquiry, cc: me.cfg.cc, set: me.cfg.set };
    }
    return out;
  }));

  app.get('/api/hiring/:kind(requests|candidates|exits)/:id/log', requireAuth, route(null, async (req) => {
    const loader = { requests: loadReq, candidates: loadCand, exits: loadExit }[req.params.kind];
    await loader(req.params.id, req.hire);
    return (await q('SELECT * FROM hire_log WHERE ref_id = $1 ORDER BY id', [req.params.id]))
      .map((n) => ({ action: n.action, note: n.note || '', docs: parseJson(n.docs, []), by: n.by_name || '', at: tsOut(n.created_at) }));
  }));

  app.get('/api/hiring/:kind(requests|candidates|exits)/:id/documents/:n', requireAuth, route(null, async (req, res) => {
    const loader = { requests: loadReq, candidates: loadCand, exits: loadExit }[req.params.kind];
    const { row } = await loader(req.params.id, req.hire);
    sendDoc(res, row, parseInt(req.params.n, 10));
  }));

  function sendDoc(res, row, n) {
    const doc = parseJson(row.documents, [])[n];
    if (!doc || !doc.file) throw new UserError('Document not found', 404);
    const abs = path.join(UPLOAD_ROOT, row.id, path.basename(doc.file));
    res.download(abs, doc.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'The file is missing on the server' });
    });
  }

  /* ================================================================
     1. HIRING
     ================================================================ */

  function reqFields(b, users) {
    const position = str(b.position) || bad('Write the position you are hiring for');
    const division = str(b.division, 128) || bad('Choose the division');
    const location = str(b.location, 128) || bad('Write the location');
    const openings = Math.max(1, Math.min(99, parseInt(b.openings, 10) || 1));
    const salary_min = optMoney(b.salary_min, 'Salary from');
    const salary_max = optMoney(b.salary_max, 'Salary to');
    if (salary_min == null && salary_max == null) bad('Give the salary bracket');
    if (salary_min != null && salary_max != null && salary_max < salary_min) bad('Salary "to" is below "from"');
    const live = new Set(users.map((u) => u.id));
    const interviewers = [...new Set((Array.isArray(b.interviewers) ? b.interviewers : []).map(String).filter((id) => live.has(id)))];
    if (!interviewers.length) bad('Pick at least one interviewer');
    return { position, division, location, openings, salary_min, salary_max, experience: str(b.experience, 128), interviewers, description: str(b.description, 8000) };
  }

  app.post('/api/hiring/requests', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const f = reqFields(req.body || {}, me.cfg.users);
    const files = decodeFiles(req.body?.documents, 'Job description');
    if (!files.length && !f.description) bad('Upload the job description (or write it)');
    const id = await withSeqId('hire_requests', 'JR', 4, (newId) => q(
      `INSERT INTO hire_requests (id, position, division, location, openings, salary_min, salary_max, experience, interviewers, description, documents, agencies, status, requested_by_id, requested_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]','[]',$11,$12,$13)`,
      [newId, f.position, f.division, f.location, f.openings, f.salary_min, f.salary_max, f.experience, JSON.stringify(f.interviewers), f.description, RS.OPEN, me.user.id, me.by]));
    const ns = await saveDocs(id, files, { kind: 'jd', by: me.by });
    await logStep(id, 'Requested', `${f.position} · ${f.division} · ${f.location}`, actor(me), ns);
    later('raised ' + id, async () => {
      const { r } = await loadReq(id);
      const to = await emails(me.cfg.hr.length ? me.cfg.hr : [], me.cfg.users);
      const cc = await emails([me.user.id], me.cfg.users);
      await send({
        to: (to.length ? to : cc).join(','), cc: to.length ? cc.join(',') : '',
        subject: `New job request ${r.id}: ${r.position} (${r.location})`,
        attachments: await attachmentsFor(id, ns),
        html: mailHtml({
          heading: 'New Job Request', lead: `<b>${escHtml(r.requested_by_name)}</b> has raised a hiring request. Send the job description to the hiring agencies from the ERP.`,
          rows: [...reqRows(r), ['Interviewer(s)', escHtml(r.interviewers.map((x) => userName(me.cfg.users, x)).join(', '))], ['Details', nl2br(r.description)]],
          footer: ns.length ? 'The job description is attached.' : '', link: pageLink(),
        }),
      }, 'raised');
    });
    return { id };
  }));

  app.patch('/api/hiring/requests/:id', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { r } = await loadReq(req.params.id, me);
    if (!reqRights(r, me).edit) bad(`It is ${r.status} — it can no longer be edited`);
    const f = reqFields({ ...r, ...req.body }, me.cfg.users);
    await q(`UPDATE hire_requests SET position=$1, division=$2, location=$3, openings=$4, salary_min=$5, salary_max=$6, experience=$7, interviewers=$8, description=$9, updated_at=NOW() WHERE id=$10`,
      [f.position, f.division, f.location, f.openings, f.salary_min, f.salary_max, f.experience, JSON.stringify(f.interviewers), f.description, r.id]);
    const files = decodeFiles(req.body?.documents, 'Job description');
    const ns = await saveDocs(r.id, files, { kind: 'jd', by: me.by });
    await logStep(r.id, 'Edited', ns.length ? 'Job description updated' : '', actor(me), ns);
    return { ok: true };
  }));

  /* HR → hiring agencies. Each agency gets its own mail (they must not see
     each other) with the JD attached and its own CV upload link. Replies go
     to the inquiry mailbox. */
  function cvLink(reqId, agency) {
    return `${appOrigin}/hire-cv?t=${encodeURIComponent(tokenFor(TOKEN.cv + reqId, agency.id, agency.email))}`;
  }
  app.post('/api/hiring/requests/:id/agencies', requireAuth, route('hr', async (req) => {
    const me = req.hire;
    const { r } = await loadReq(req.params.id, me);
    if (!reqRights(r, me).agencies) bad(`It is ${r.status} — it cannot be sent to agencies`);
    const ids = Array.isArray(req.body?.agency_ids) ? req.body.agency_ids.map(String) : [];
    if (!ids.length) bad('Tick at least one agency');
    const rows = (await q('SELECT * FROM hire_agencies')).filter((a) => ids.includes(a.id) && Number(a.active));
    const missing = rows.filter((a) => !EMAIL_RE.test(a.email || ''));
    if (missing.length) bad(`No valid email for ${missing.map((a) => a.name).join(', ')} — fix it in Settings → Agencies`);
    if (!rows.length) bad('Those agencies are not active');
    const note = str(req.body?.note, 4000);
    const showSalary = req.body?.show_salary !== false;
    const jd = r.docs.filter((d) => d.kind === 'jd').map((d) => d.n);
    const files = await attachmentsFor(r.id, jd);
    const sentAt = new Date().toISOString();
    const sent = [];
    const failed = [];
    for (const a of rows) {
      try {
        const ok = await send({
          to: a.email, replyTo: me.cfg.inquiry, fromName: 'Lallubhai Amichand – HR',
          subject: `Requirement: ${r.position} – ${r.location} (${r.id})`,
          attachments: files,
          html: mailHtml({
            heading: `Requirement: ${escHtml(r.position)}`,
            lead: `Dear ${escHtml(a.contact_person || a.name)},<br><br>We are looking for a <b>${escHtml(r.position)}</b> at <b>${escHtml(r.location)}</b>. ${files.length ? 'The job description is attached.' : ''} Please share suitable profiles through the button below — you can upload as many CVs as you have.`,
            rows: [['Position', escHtml(r.position)], ['Division', escHtml(r.division)], ['Location', escHtml(r.location)],
              ['Openings', String(r.openings)], ['Experience', escHtml(r.experience)], ...(showSalary ? [['Salary Bracket', escHtml(salaryText(r))]] : []),
              ['Job Description', r.description ? nl2br(r.description) : ''], ['Note', note ? nl2br(note) : '']],
            footer: `For any query, write to <a href="mailto:${escHtml(me.cfg.inquiry)}">${escHtml(me.cfg.inquiry)}</a> (just reply to this mail).`,
            link: cvLink(r.id, a), linkLabel: 'Upload CVs',
          }),
        }, `jd → ${a.name}`);
        if (ok) sent.push({ id: a.id, name: a.name, at: sentAt, by: me.by });
        else failed.push(a.name);
      } catch (e) {
        console.error('[hire] agency mail', a.name, '—', e.message);
        failed.push(a.name);
      }
    }
    if (!sent.length) bad(`Could not mail ${failed.join(', ')} — check the mail settings`);
    const list = [...r.agencies.filter((x) => !sent.some((s) => s.id === x.id)), ...sent];
    await q(`UPDATE hire_requests SET agencies=$1, status=$2, updated_at=NOW() WHERE id=$3`,
      [JSON.stringify(list), r.status === RS.HOLD ? RS.HOLD : RS.SOURCING, r.id]);
    await logStep(r.id, 'Sent to Agencies', [sent.map((s) => s.name).join(', '), note].filter(Boolean).join(' — '), actor(me));
    return { ok: true, sent: sent.map((s) => s.name), failed };
  }));

  app.post('/api/hiring/requests/:id/status', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { r } = await loadReq(req.params.id, me);
    const to = String(req.body?.status || '');
    const can = reqRights(r, me);
    if (!(can.status || (can.cancel && to === RS.CANCELLED))) bad('Only HR can change the status of a job request');
    if (![RS.OPEN, RS.HOLD, RS.CLOSED, RS.CANCELLED].includes(to)) bad('Choose a status');
    const back = to === RS.OPEN && r.agencies.length ? RS.SOURCING : to;
    await q(`UPDATE hire_requests SET status=$1, closed_at=${[RS.CLOSED, RS.CANCELLED].includes(to) ? 'NOW()' : 'NULL'}, updated_at=NOW() WHERE id=$2`, [back, r.id]);
    await logStep(r.id, back === RS.SOURCING || back === RS.OPEN ? 'Reopened' : back, str(req.body?.note, 2000), actor(me));
    return { ok: true };
  }));

  app.delete('/api/hiring/requests/:id', requireAuth, route(null, async (req) => {
    const { r } = await loadReq(req.params.id, req.hire);
    if (!reqRights(r, req.hire).del) bad('Only the owner account can delete a job request');
    const cands = await q('SELECT id FROM hire_candidates WHERE request_id = $1', [r.id]);
    for (const c of cands) {
      await q('DELETE FROM hire_log WHERE ref_id = $1', [c.id]);
      fs.promises.rm(path.join(UPLOAD_ROOT, c.id), { recursive: true, force: true }).catch(() => {});
    }
    await q('DELETE FROM hire_candidates WHERE request_id = $1', [r.id]);
    await q('DELETE FROM hire_log WHERE ref_id = $1', [r.id]);
    await q('DELETE FROM hire_requests WHERE id = $1', [r.id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, r.id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }));

  /* ── Candidates (CVs) ──────────────────────────────────────────── */

  function candFields(b) {
    const name = str(b.name) || bad('Write the candidate\'s name');
    const email = str(b.email).toLowerCase();
    if (email && !EMAIL_RE.test(email)) bad(`"${email}" is not a valid email`);
    const phone = str(b.phone, 64);
    if (!email && !phone) bad('Give the candidate\'s phone or email');
    return {
      name, email, phone, experience: str(b.experience, 128), current_ctc: str(b.current_ctc, 64),
      expected_ctc: str(b.expected_ctc, 64), notice_period: str(b.notice_period, 64), notes: str(b.notes, 4000),
    };
  }

  async function addCandidate(r, f, { source, agencyId = null, by, files }) {
    const id = await withSeqId('hire_candidates', 'CAN', 4, (newId) => q(
      `INSERT INTO hire_candidates (id, request_id, name, email, phone, experience, current_ctc, expected_ctc, notice_period, source, agency_id, notes, documents, status, interviewers, checklist, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[]',$13,'[]','{}',$14)`,
      [newId, r.id, f.name, f.email, f.phone, f.experience, f.current_ctc, f.expected_ctc, f.notice_period, source, agencyId, f.notes, C.NEW, by.name]));
    const ns = await saveDocs(id, files, { kind: 'cv', by: by.name });
    await logStep(id, 'CV Received', `${r.position} (${r.id}) · ${source}`, by, ns);
    // "Send to concerned person who raised the request"
    later('cv ' + id, async () => {
      const cfg = await settings();
      const { c } = await loadCand(id);
      const to = await emails([r.requested_by_id], cfg.users);
      const cc = await emails(cfg.hr, cfg.users);
      await send({
        to: (to.length ? to : cc).join(','), cc: to.length ? cc.join(',') : '',
        subject: `New CV for ${r.position}: ${c.name} (${source})`,
        attachments: await attachmentsFor(id, ns),
        html: mailHtml({
          heading: 'New CV for Your Job Request',
          lead: `A CV has come in for <b>${escHtml(r.position)}</b> (${escHtml(r.id)}). Review it and shortlist or reject it in the ERP; shortlisted candidates can then be called for an interview.`,
          rows: [...candRows(c, r), ['Notes', nl2br(c.notes)]], footer: ns.length ? 'The CV is attached.' : '', link: pageLink(),
        }),
      }, 'cv');
    });
    return id;
  }

  app.post('/api/hiring/candidates', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const b = req.body || {};
    const { r } = await loadReq(str(b.request_id, 16), me);
    if (!reqRights(r, me).addCv) bad(`${r.id} is ${r.status} — CVs cannot be added`);
    const f = candFields(b);
    const files = decodeFiles(b.documents, 'CV', { only: ['pdf', 'doc', 'docx', 'jpg', 'png', 'webp'] });
    if (!files.length) bad('Attach the CV');
    let source = str(b.source, 255) || 'Direct';
    let agencyId = null;
    if (b.agency_id) {
      const a = (await q('SELECT id, name FROM hire_agencies WHERE id = $1', [str(b.agency_id, 16)]))[0];
      if (a) { agencyId = a.id; source = a.name; }
    }
    const id = await addCandidate(r, f, { source, agencyId, by: actor(me), files });
    return { id };
  }));

  app.patch('/api/hiring/candidates/:id', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).edit) bad('You cannot edit this candidate now');
    const f = candFields({ ...c, ...req.body });
    await q(`UPDATE hire_candidates SET name=$1, email=$2, phone=$3, experience=$4, current_ctc=$5, expected_ctc=$6, notice_period=$7, notes=$8, updated_at=NOW() WHERE id=$9`,
      [f.name, f.email, f.phone, f.experience, f.current_ctc, f.expected_ctc, f.notice_period, f.notes, c.id]);
    const ns = await saveDocs(c.id, decodeFiles(req.body?.documents, 'Documents'), { kind: 'other', by: me.by });
    await logStep(c.id, 'Edited', '', actor(me), ns);
    return { ok: true };
  }));

  app.post('/api/hiring/candidates/:id/screen', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).screen) bad(`It is ${c.status} — only a new CV can be shortlisted or rejected`);
    const decision = String(req.body?.decision || '');
    if (!['shortlist', 'reject'].includes(decision)) bad('Choose Shortlist or Reject');
    const note = str(req.body?.note, 2000);
    if (decision === 'reject' && !note) bad('Give the reason for rejecting the CV');
    await move('hire_candidates', c.id, C.NEW, decision === 'shortlist' ? C.SHORT : C.CVREJ);
    await logStep(c.id, decision === 'shortlist' ? 'Shortlisted' : 'CV Rejected', note, actor(me));
    if (decision === 'shortlist') {
      later('shortlist ' + c.id, async () => {
        const to = await emails(me.cfg.hr, me.cfg.users);
        if (to.includes(await addressOf(me.user.id))) return;
        await send({
          to: to.join(','), subject: `Shortlisted: ${c.name} for ${r.position}`,
          html: mailHtml({ heading: 'CV Shortlisted', lead: `<b>${escHtml(me.by)}</b> has shortlisted <b>${escHtml(c.name)}</b>. Schedule the interview from the ERP.`, rows: [...candRows(c, r), ['Note', nl2br(note)]], link: pageLink() }),
        }, 'shortlist');
      });
    }
    return { ok: true };
  }));

  /* Interview → a Scheduler meeting (Meet link / invite mails as the
     Scheduler does them), plus a mail to the interviewers with the result
     buttons. Rescheduling makes a new meeting. */
  function resultUrl(c, decision, email) {
    return `${appOrigin}/hire-action?t=${encodeURIComponent(tokenFor(TOKEN.result + c.id, decision, email))}`;
  }
  app.post('/api/hiring/candidates/:id/interview', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).schedule) bad(`It is ${c.status} — shortlist the CV before scheduling an interview`);
    const b = req.body || {};
    const date = optDate(b.date, 'Interview date') || bad('Pick the interview date');
    const time = TIME_RE.test(String(b.time || '')) ? b.time : bad('Pick the interview time');
    const mins = Math.max(15, Math.min(240, parseInt(b.duration, 10) || 30));
    const live = new Set(me.cfg.users.map((u) => u.id));
    const ivs = [...new Set((Array.isArray(b.interviewers) && b.interviewers.length ? b.interviewers : r.interviewers).map(String).filter((id) => live.has(id)))];
    if (!ivs.length) bad('Pick at least one interviewer');
    const inPerson = b.mode === 'in-person';
    const venue = str(b.venue, 255);
    const note = str(b.note, 2000);
    const [h, m] = time.split(':').map(Number);
    const endM = h * 60 + m + mins;
    const end = endM < 1440 ? `${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}` : '23:59';
    const round = c.interview_round + 1;
    let meeting = { id: null, link: '' };
    let meetErr = '';
    try {
      const names = ivs.map((id) => userName(me.cfg.users, id)).filter(Boolean);
      const out = await createMeeting({
        title: `Interview: ${c.name} – ${r.position}${round > 1 ? ` (round ${round})` : ''}`,
        date, startTime: time, endTime: end,
        attendees: [...names, ...(c.email && b.invite_candidate !== false ? [c.email] : [])],
        location: inPerson ? venue || 'In person' : '', noLink: inPerson,
        notes: [`Candidate: ${c.name} (${c.id})`, c.phone ? `Phone: ${c.phone}` : '', `Job request: ${r.id} ${r.position}`, note].filter(Boolean).join('\n'),
      }, { id: me.user.id, name: me.by, email: me.user.email });
      meeting = { id: out.id, link: out.link || '' };
    } catch (e) {
      console.error('[hire] scheduler meeting failed for', c.id, '—', e.message);
      meetErr = e.message;
    }
    await move('hire_candidates', c.id, [C.SHORT, C.INTERVIEW], C.INTERVIEW,
      ', interview_at=$2, interview_round=$3, meeting_id=$4, meeting_link=$5, interviewers=$6',
      [`${date} ${time}:00`, round, meeting.id, meeting.link || (inPerson ? venue : ''), JSON.stringify(ivs)]);
    await logStep(c.id, `Interview Scheduled (round ${round})`,
      [`${fmtWall(`${date} ${time}`)} · ${inPerson ? 'In person' + (venue ? ' – ' + venue : '') : 'Online'}`, meeting.id ? `Scheduler ${meeting.id}` : '', note].filter(Boolean).join(' · '), actor(me));
    later('interview ' + c.id, async () => {
      const fresh = (await loadCand(c.id)).c;
      const ppl = await people(ivs, me.cfg.users);
      const cv = lastDoc(fresh.docs, ['cv']);
      const files = await attachmentsFor(c.id, cv ? [cv.n] : []);
      for (const p of ppl) {
        await send({
          to: p.email, subject: `Interview: ${c.name} for ${r.position} — ${fmtWall(`${date} ${time}`)}`,
          attachments: files,
          html: mailHtml({
            heading: 'Interview Scheduled',
            lead: `Hi <b>${escHtml(p.name)}</b>, you are interviewing <b>${escHtml(c.name)}</b> for <b>${escHtml(r.position)}</b>. After the interview, record your decision with a button below (or in the ERP).`,
            rows: [['When', `<b>${escHtml(fmtWall(`${date} ${time}`))}</b> (${mins} min)`], ['Where', inPerson ? escHtml(venue || 'In person') : meeting.link ? `<a href="${escHtml(meeting.link)}">${escHtml(meeting.link)}</a>` : 'Online (see the Scheduler)'],
              ['Round', String(round)], ...candRows(fresh, r), ['Note', nl2br(note)]],
            actions: mailButtons([['Select', '#16a34a', resultUrl(c, 'select', p.email)], ['Next Round', '#d97706', resultUrl(c, 'next', p.email)], ['Reject', '#dc2626', resultUrl(c, 'reject', p.email)]]),
            footer: cv ? 'The CV is attached.' : '', link: pageLink(),
          }),
        }, 'interview → ' + p.name);
      }
    });
    return { ok: true, meeting_id: meeting.id, link: meeting.link, meeting_error: meetErr };
  }));

  async function recordResult(c, r, decision, remarks, by) {
    if (!['select', 'reject', 'next'].includes(decision)) bad('Choose Select, Next Round or Reject');
    if (decision !== 'select' && !remarks) bad(decision === 'reject' ? 'Give the reason for rejecting' : 'Write what the next round should cover');
    const next = { select: C.SELECTED, reject: C.NOTSEL, next: C.SHORT }[decision];
    await move('hire_candidates', c.id, C.INTERVIEW, next, ', result_remarks=$2, result_by=$3', [remarks, by.name]);
    await logStep(c.id, { select: 'Selected', reject: 'Not Selected', next: 'Next Round' }[decision], remarks, by);
    later('result ' + c.id, async () => {
      const cfg = await settings();
      const to = await emails([...cfg.hr, r.requested_by_id], cfg.users);
      const lead = {
        select: `<b>${escHtml(by.name)}</b> has <b style="color:#16a34a">selected</b> <b>${escHtml(c.name)}</b> for ${escHtml(r.position)}. HR: prepare the appointment letter and send it to management for approval.`,
        reject: `<b>${escHtml(by.name)}</b> has not selected <b>${escHtml(c.name)}</b> for ${escHtml(r.position)}.`,
        next: `<b>${escHtml(by.name)}</b> wants <b>${escHtml(c.name)}</b> called for another round. Schedule it from the ERP.`,
      }[decision];
      await send({
        to: to.join(','), subject: `Interview result: ${c.name} — ${{ select: 'Selected', reject: 'Not selected', next: 'Next round' }[decision]}`,
        html: mailHtml({ heading: 'Interview Result', colour: decision === 'select' ? '#16a34a' : decision === 'reject' ? '#dc2626' : '#d97706', lead, rows: [['Remarks', nl2br(remarks)], ...candRows(c, r)], link: pageLink('onboarding') }),
      }, 'result');
    });
  }

  app.post('/api/hiring/candidates/:id/result', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).result) bad(c.status === C.INTERVIEW ? 'Only the interviewer can record the result' : `It is ${c.status}`);
    await recordResult(c, r, String(req.body?.decision || ''), str(req.body?.remarks, 4000), actor(me));
    return { ok: true };
  }));

  /* ================================================================
     2. ONBOARDING
     ================================================================ */

  function approveUrl(c, decision, email) {
    return `${appOrigin}/hire-action?t=${encodeURIComponent(tokenFor(TOKEN.approve + c.id + ':' + c.offer_version, decision, email))}`;
  }

  // Step 1: HR uploads the appointment letter → approving management.
  app.post('/api/hiring/candidates/:id/offer', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).offer) bad(`It is ${c.status} — an offer is prepared once the candidate is selected`);
    const b = req.body || {};
    const designation = str(b.designation, 128) || bad('Write the designation');
    const ctc = str(b.ctc, 64) || bad('Write the CTC offered');
    const doj = optDate(b.doj, 'Date of joining') || bad('Pick the date of joining');
    const files = decodeFiles(b.documents, 'Appointment letter', { only: ['pdf', 'doc', 'docx'] });
    if (files.length !== 1) bad('Attach the appointment letter — one PDF or Word file');
    if (!me.cfg.mgmt.length) bad('No approving management is set — ask an Admin to pick them in Settings');
    const v = c.offer_version + 1;
    const note = str(b.note, 2000);
    await move('hire_candidates', c.id, [C.SELECTED, C.OFFER_REVISION], C.OFFER_APPROVAL,
      ', designation=$2, ctc=$3, doj=$4, offer_version=$5, offer_remarks=\'\'', [designation, ctc, doj, v]);
    const ns = await saveDocs(c.id, files, { kind: 'offer', v, by: me.by });
    await logStep(c.id, `Appointment Letter v${v} for Approval`, [`${designation} · ${ctc} · joining ${fmtDate(doj)}`, note].filter(Boolean).join(' — '), actor(me), ns);
    later('offer ' + c.id, async () => {
      const { c: fresh } = await loadCand(c.id);
      const ppl = await people(me.cfg.mgmt, me.cfg.users);
      const files2 = await attachmentsFor(c.id, ns);
      for (const p of ppl) {
        await send({
          to: p.email, subject: `Approve appointment letter: ${c.name} — ${designation}`,
          attachments: files2,
          html: mailHtml({
            heading: 'Appointment Letter — Your Approval Needed',
            lead: `Hi <b>${escHtml(p.name)}</b>, <b>${escHtml(c.name)}</b> has been selected for <b>${escHtml(r.position)}</b>. The appointment letter (v${v}) is attached for your approval.`,
            rows: [['Designation', escHtml(designation)], ['CTC Offered', escHtml(ctc)], ['Date of Joining', fmtDate(doj)], ['Interview Remarks', nl2br(fresh.result_remarks)],
              ['Selected By', escHtml(fresh.result_by)], ['Note from HR', nl2br(note)], ...candRows(fresh, r), ['Salary Bracket', escHtml(salaryText(r))]],
            actions: mailButtons([['Approve', '#16a34a', approveUrl(fresh, 'approve', p.email)], ['Send Back', '#d97706', approveUrl(fresh, 'changes', p.email)]]),
            footer: 'Each button opens a confirm page where you can add remarks — no login needed.', link: pageLink('onboarding'),
          }),
        }, 'offer → ' + p.name);
      }
    });
    return { ok: true, version: v };
  }));

  async function decideOffer(c, r, decision, remarks, by) {
    if (!['approve', 'changes'].includes(decision)) bad('Choose Approve or Send Back');
    if (decision === 'changes' && !remarks) bad('Write what should change in the letter');
    await move('hire_candidates', c.id, C.OFFER_APPROVAL, decision === 'approve' ? C.OFFER_APPROVED : C.OFFER_REVISION,
      ', offer_remarks=$2, offer_by=$3', [remarks, by.name]);
    await logStep(c.id, decision === 'approve' ? `Appointment Letter v${c.offer_version} Approved` : 'Appointment Letter Sent Back', remarks, by);
    later('offer-decision ' + c.id, async () => {
      const cfg = await settings();
      const to = await emails(cfg.hr, cfg.users);
      await send({
        to: to.join(','),
        subject: decision === 'approve' ? `Approved: appointment letter for ${c.name}` : `Sent back: appointment letter for ${c.name}`,
        html: mailHtml({
          heading: decision === 'approve' ? 'Appointment Letter Approved' : 'Appointment Letter Sent Back', colour: decision === 'approve' ? '#16a34a' : '#d97706',
          lead: decision === 'approve'
            ? `<b>${escHtml(by.name)}</b> has approved the appointment letter for <b>${escHtml(c.name)}</b>. Get it digitally signed and send it to the candidate from the ERP.`
            : `<b>${escHtml(by.name)}</b> has sent the appointment letter for <b>${escHtml(c.name)}</b> back. Upload a revised letter in the ERP.`,
          rows: [['Remarks', nl2br(remarks)], ['Designation', escHtml(c.designation)], ['CTC', escHtml(c.ctc)], ['Date of Joining', fmtDate(c.doj)], ['Position', escHtml(r.position)]],
          link: pageLink('onboarding'),
        }),
      }, 'offer-decision');
    });
  }

  app.post('/api/hiring/candidates/:id/offer-decision', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).offerDecide) bad(c.status === C.OFFER_APPROVAL ? 'Only the approving management can decide' : `It is already ${c.status}`);
    await decideOffer(c, r, String(req.body?.decision || ''), str(req.body?.remarks, 4000), actor(me));
    return { ok: true };
  }));

  // Step 2: the digitally signed letter → mailed to the candidate with the
  // Accept / Accept with changes / Decline link.
  function offerLink(c) {
    return `${appOrigin}/hire-offer?t=${encodeURIComponent(tokenFor(TOKEN.offer + c.id, String(c.offer_version), c.email))}`;
  }
  app.post('/api/hiring/candidates/:id/send-offer', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).sendOffer) bad(`It is ${c.status} — the letter goes out after management approves it`);
    const b = req.body || {};
    const email = str(b.email || c.email).toLowerCase();
    if (!EMAIL_RE.test(email)) bad('The candidate needs a valid email address');
    const files = decodeFiles(b.documents, 'Signed appointment letter', { only: ['pdf'] });
    if (files.length !== 1) bad('Attach the digitally signed appointment letter — one PDF');
    const note = str(b.note, 4000);
    if (email !== c.email) await q('UPDATE hire_candidates SET email=$1 WHERE id=$2', [email, c.id]);
    const ns = await saveDocs(c.id, files, { kind: 'signed', v: c.offer_version, by: me.by });
    const fresh = { ...c, email };
    const ok = await send({
      to: email, cc: me.cfg.inquiry, replyTo: me.cfg.inquiry, fromName: 'Lallubhai Amichand – HR',
      subject: `Appointment Letter – ${c.designation} – Lallubhai Amichand Ltd.`,
      attachments: await attachmentsFor(c.id, ns),
      html: mailHtml({
        heading: 'Your Appointment Letter',
        lead: `Dear <b>${escHtml(c.name)}</b>,<br><br>We are pleased to offer you the position of <b>${escHtml(c.designation)}</b> at Lallubhai Amichand Ltd. Your digitally signed appointment letter is attached.<br><br>Please let us know your decision using the button below.`,
        rows: [['Designation', escHtml(c.designation)], ['Location', escHtml(r.location)], ['Date of Joining', fmtDate(c.doj)], ['Message', nl2br(note)]],
        footer: `For any question, write to <a href="mailto:${escHtml(me.cfg.inquiry)}">${escHtml(me.cfg.inquiry)}</a>.`,
        link: offerLink(fresh), linkLabel: 'Accept / Respond to the Offer',
      }),
    }, 'offer → candidate');
    if (!ok) bad('The mail could not be sent — check the SMTP settings');
    await move('hire_candidates', c.id, C.OFFER_APPROVED, C.OFFER_SENT, ', response=\'\', response_note=\'\', response_at=NULL');
    await logStep(c.id, 'Offer Sent to Candidate', [email, note].filter(Boolean).join(' — '), actor(me), ns);
    return { ok: true };
  }));

  // Step 3: the candidate's answer (their link, or HR records a phone call).
  const RESP = { accept: C.ACCEPTED, changes: C.CAND_CHANGES, decline: C.DECLINED };
  const RESP_LABEL = { accept: 'Accepted the offer', changes: 'Accepted with changes', decline: 'Declined the offer' };
  async function recordResponse(c, r, response, note, by, viaLink) {
    if (!RESP[response]) bad('Choose Accept, Accept with changes or Decline');
    if (response === 'changes' && !note) bad('Write the changes you would like');
    await move('hire_candidates', c.id, C.OFFER_SENT, RESP[response], ', response=$2, response_note=$3, response_at=NOW()', [response, note]);
    await logStep(c.id, `Candidate ${RESP_LABEL[response]}`, [viaLink ? 'via the offer link' : `recorded by ${by.name}`, note].filter(Boolean).join(' — '), viaLink ? { id: null, name: c.name } : by);
    // Step 3/4: inquiry@ + HR + approving management.
    later('response ' + c.id, async () => {
      const cfg = await settings();
      const to = [cfg.inquiry];
      const cc = await emails([...cfg.hr, ...cfg.mgmt, r.requested_by_id], cfg.users);
      await send({
        to: to.join(','), cc: cc.join(','),
        subject: `${c.name} ${RESP_LABEL[response].toLowerCase()} — ${c.designation}`,
        html: mailHtml({
          heading: `Offer ${response === 'accept' ? 'Accepted' : response === 'decline' ? 'Declined' : 'Accepted with Changes'}`,
          colour: response === 'accept' ? '#16a34a' : response === 'decline' ? '#dc2626' : '#d97706',
          lead: response === 'accept'
            ? `<b>${escHtml(c.name)}</b> has accepted the offer for <b>${escHtml(c.designation)}</b>, joining on <b>${fmtDate(c.doj)}</b>. HR: set up the login, laptop and buddy before the joining date.`
            : response === 'changes'
              ? `<b>${escHtml(c.name)}</b> will accept the offer for <b>${escHtml(c.designation)}</b> with the changes below. Management: decide in the ERP whether to revise the offer.`
              : `<b>${escHtml(c.name)}</b> has declined the offer for <b>${escHtml(c.designation)}</b>.`,
          rows: [[response === 'decline' ? 'Reason' : 'Changes Asked', nl2br(note)], ['Designation', escHtml(c.designation)], ['CTC', escHtml(c.ctc)], ['Date of Joining', fmtDate(c.doj)], ['Position', escHtml(r.position)]],
          link: pageLink('onboarding'),
        }),
      }, 'response');
    });
  }

  app.post('/api/hiring/candidates/:id/response', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).record) bad(`It is ${c.status} — there is no offer waiting for an answer`);
    await recordResponse(c, r, String(req.body?.response || ''), str(req.body?.note, 4000), actor(me), false);
    return { ok: true };
  }));

  // Changes asked → management revises (back to HR for a new letter) or drops.
  app.post('/api/hiring/candidates/:id/changes-decision', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).changesDecide) bad(`It is ${c.status}`);
    const decision = String(req.body?.decision || '');
    const remarks = str(req.body?.remarks, 4000);
    if (!['revise', 'drop'].includes(decision)) bad('Choose Revise the offer or Drop');
    await move('hire_candidates', c.id, C.CAND_CHANGES, decision === 'revise' ? C.OFFER_REVISION : C.DROPPED, ', offer_remarks=$2, offer_by=$3', [remarks, me.by]);
    await logStep(c.id, decision === 'revise' ? 'Offer to be Revised' : 'Dropped', remarks, actor(me));
    if (decision === 'revise') {
      later('revise ' + c.id, async () => {
        const to = await emails(me.cfg.hr, me.cfg.users);
        await send({
          to: to.join(','), subject: `Revise the offer for ${c.name}`,
          html: mailHtml({ heading: 'Revise the Appointment Letter', colour: '#d97706',
            lead: `<b>${escHtml(me.by)}</b> agreed to revise the offer for <b>${escHtml(c.name)}</b>. Upload the revised letter in the ERP — it goes for approval again.`,
            rows: [['Candidate Asked', nl2br(c.response_note)], ['Management Remarks', nl2br(remarks)]], link: pageLink('onboarding') }),
        }, 'revise');
      });
    }
    return { ok: true };
  }));

  /* Steps 5/6: the checklist. Most items are a tick; some carry what was
     done (the employee code, the login, the laptop, the buddy). 'letter'
     can mail the signed letter itself. */
  app.post('/api/hiring/candidates/:id/checklist', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).checklist) bad(`It is ${c.status} — the checklist opens once the offer is accepted`);
    const b = req.body || {};
    const item = CHECKLIST.find((x) => x.key === b.key) || bad('Unknown checklist item');
    if (item.stage === 'doj' && c.status !== C.JOINED) bad('Mark the candidate as joined first — this is a joining-day step');
    const done = b.done !== false;
    const list = { ...c.checklist };
    const entry = { done, at: new Date().toISOString(), by: me.by, note: str(b.note, 500) };
    const sets = [];
    const params = [];
    const set = (col, v) => { params.push(v); sets.push(`${col}=$${params.length}`); };
    if (done && item.key === 'employee') {
      const emp = (await q('SELECT id, name FROM hr_employees WHERE id = $1', [str(b.ref, 16).toUpperCase()]))[0] || bad('Pick the employee record');
      entry.ref = emp.id; entry.ref_name = `${emp.id} · ${emp.name}`;
      set('employee_id', emp.id);
    }
    if (done && item.key === 'login') {
      const u = me.cfg.users.find((x) => x.id === str(b.ref, 16)) || bad('Pick the ERP login');
      entry.ref = u.id; entry.ref_name = `${u.name} (${u.email || u.id})`;
      set('user_id', u.id);
      // Link the employee row to the login, so the dashboard knows them.
      const empId = c.employee_id;
      if (empId) await q(`UPDATE hr_employees SET user_id = $1 WHERE id = $2 AND (user_id IS NULL OR user_id = '')`, [u.id, empId]).catch(() => {});
    }
    if (done && item.key === 'laptop') {
      const a = (await q('SELECT id, name, assigned_to FROM hr_assets WHERE id = $1', [str(b.ref, 32)]))[0] || bad('Pick the laptop from Assets');
      entry.ref = a.id; entry.ref_name = `${a.id} · ${a.name}`;
    }
    if (done && item.key === 'buddy') {
      const u = me.cfg.users.find((x) => x.id === str(b.ref, 16)) || bad('Pick the buddy');
      entry.ref = u.id; entry.ref_name = u.name;
      set('buddy_id', u.id); set('buddy_name', u.name);
    }
    if (done && item.key === 'letter' && b.send) {
      const signed = lastDoc(c.docs, ['signed']) || bad('There is no signed letter on file to send');
      const to = str(b.email || c.email).toLowerCase();
      if (!EMAIL_RE.test(to)) bad('Give a valid email to send the letter to');
      const ok = await send({
        to, cc: me.cfg.inquiry, fromName: 'Lallubhai Amichand – HR', subject: `Signed Appointment Letter – ${c.name}`,
        attachments: await attachmentsFor(c.id, [signed.n]),
        html: mailHtml({ heading: 'Welcome to Lallubhai Amichand Ltd.', colour: '#16a34a',
          lead: `Dear <b>${escHtml(c.name)}</b>,<br><br>Welcome aboard! Your signed appointment letter is attached for your records.`,
          rows: [['Designation', escHtml(c.designation)], ['Date of Joining', fmtDate(c.joined_on || c.doj)], ['Your Buddy', escHtml(c.buddy_name)]] }),
      }, 'signed letter');
      if (!ok) bad('The mail could not be sent — check the SMTP settings');
      entry.ref_name = `Mailed to ${to}`;
    }
    list[item.key] = entry;
    set('checklist', JSON.stringify(list));
    const allDone = CHECKLIST.every((x) => list[x.key]?.done);
    if (allDone && c.status === C.JOINED) set('status', C.ONBOARDED);
    params.push(c.id);
    await q(`UPDATE hire_candidates SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    await logStep(c.id, `${done ? '✓' : 'Unticked'} ${item.label}`, [entry.ref_name, entry.note].filter(Boolean).join(' — '), actor(me));
    if (allDone && c.status === C.JOINED) await logStep(c.id, 'Onboarded', 'All onboarding steps done', actor(me));
    if (done && item.key === 'buddy') {
      later('buddy ' + c.id, async () => {
        const to = await emails([entry.ref], me.cfg.users);
        await send({
          to: to.join(','), cc: (await emails(me.cfg.hr, me.cfg.users)).join(','), subject: `You are ${c.name}'s buddy`,
          html: mailHtml({ heading: 'You Are a Buddy!', colour: '#16a34a',
            lead: `Hi <b>${escHtml(entry.ref_name)}</b>, <b>${escHtml(c.name)}</b> joins us as <b>${escHtml(c.designation)}</b> on <b>${fmtDate(c.doj)}</b>. Please be their buddy for the first month — help them settle in, show them around and answer their questions.`,
            rows: [['New Joiner', escHtml(c.name)], ['Designation', escHtml(c.designation)], ['Date of Joining', fmtDate(c.doj)], ['Phone', escHtml(c.phone)]] }),
        }, 'buddy');
      });
    }
    return { ok: true, onboarded: allDone && c.status === C.JOINED };
  }));

  app.post('/api/hiring/candidates/:id/joined', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).joined) bad(`It is ${c.status}`);
    const on = optDate(req.body?.joined_on, 'Joining date') || istToday();
    const pending = CHECKLIST.filter((x) => x.stage === 'before' && !c.checklist[x.key]?.done);
    if (pending.length && !req.body?.force) bad(`Still to do before joining: ${pending.map((x) => x.label).join('; ')}`);
    await move('hire_candidates', c.id, C.ACCEPTED, C.JOINED, ', joined_on=$2', [on]);
    await logStep(c.id, 'Joined', `${fmtDate(on)}${pending.length ? ' · skipped: ' + pending.map((x) => x.label).join('; ') : ''}`, actor(me));
    return { ok: true };
  }));

  app.post('/api/hiring/candidates/:id/drop', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { c, r } = await loadCand(req.params.id, me);
    if (!candRights(c, r, me).drop) bad(`It is ${c.status} — it cannot be dropped`);
    const note = str(req.body?.note, 2000) || bad('Give the reason');
    await move('hire_candidates', c.id, c.status, C.DROPPED);
    await logStep(c.id, 'Dropped', note, actor(me));
    return { ok: true };
  }));

  app.delete('/api/hiring/candidates/:id', requireAuth, route(null, async (req) => {
    const { c, r } = await loadCand(req.params.id, req.hire);
    if (!candRights(c, r, req.hire).del) bad('Only the owner account can delete a candidate');
    await q('DELETE FROM hire_log WHERE ref_id = $1', [c.id]);
    await q('DELETE FROM hire_candidates WHERE id = $1', [c.id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, c.id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }));

  /* ================================================================
     3. EXIT
     ================================================================ */

  app.post('/api/hiring/exits', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const b = req.body || {};
    let emp;
    if (b.self || !me.staff) {
      emp = (await q(`SELECT * FROM hr_employees WHERE user_id = $1 AND status = 'Active'`, [me.user.id]))[0];
      if (!emp) bad('Your login is not linked to an employee record — ask HR to record your notice');
    } else {
      emp = (await q(`SELECT * FROM hr_employees WHERE id = $1`, [str(b.employee_id, 16).toUpperCase()]))[0] || bad('Pick the employee');
    }
    const open = await q(`SELECT id FROM hire_exits WHERE employee_id = $1 AND status IN (${X_OPEN.map((_, i) => '$' + (i + 2)).join(',')})`, [emp.id, ...X_OPEN]);
    if (open.length) bad(`${emp.name} already has an exit in progress (${open[0].id})`);
    const notice_date = optDate(b.notice_date, 'Notice date') || istToday();
    const lwd = optDate(b.last_working_day, 'Last working day');
    if (lwd && lwd < notice_date) bad('The last working day is before the notice date');
    const exit_type = EXIT_TYPES.includes(b.exit_type) ? b.exit_type : 'Resignation';
    const reason = str(b.reason, 4000);
    const files = decodeFiles(b.documents, 'Notice / resignation letter');
    // The reporting manager, when it resolves to one login.
    const mgr = emp.reporting_to ? me.cfg.users.filter((u) => String(u.name || '').trim().toLowerCase() === String(emp.reporting_to).trim().toLowerCase()) : [];
    const manager = mgr.length === 1 ? mgr[0] : null;
    const email = emp.user_id ? (await addressOf(emp.user_id)) || emp.email || '' : emp.email || '';
    const id = await withSeqId('hire_exits', 'EX', 4, (newId) => q(
      `INSERT INTO hire_exits (id, employee_id, user_id, employee_name, email, designation, department, exit_type, notice_date, last_working_day, reason, manager_id, manager_name, dues, documents, status, created_by_id, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'[]','[]',$14,$15,$16)`,
      [newId, emp.id, emp.user_id || null, emp.name, email, emp.designation || '', emp.department || '', exit_type, notice_date, lwd, reason,
        manager?.id || null, manager?.name || '', X.NOTICE, me.user.id, me.by]));
    const ns = await saveDocs(id, files, { kind: 'notice', by: me.by });
    await logStep(id, 'Notice Received', [`${exit_type} · notice ${fmtDate(notice_date)}${lwd ? ' · LWD ' + fmtDate(lwd) : ''}`, reason].filter(Boolean).join(' — '), actor(me), ns);
    later('notice ' + id, async () => {
      const to = await emails(me.cfg.hr, me.cfg.users);
      const cc = await emails([manager?.id, emp.user_id].filter(Boolean), me.cfg.users);
      await send({
        to: (to.length ? to : cc).join(','), cc: to.length ? cc.join(',') : '',
        subject: `Notice: ${emp.name} (${exit_type})`, attachments: await attachmentsFor(id, ns),
        html: mailHtml({ heading: 'Exit Notice Received', colour: '#d97706',
          lead: `${b.self || !me.staff ? `<b>${escHtml(emp.name)}</b> has submitted their notice.` : `<b>${escHtml(me.by)}</b> has recorded the notice of <b>${escHtml(emp.name)}</b>.`} HR: confirm the last working day in the ERP to start the final dues clearance.`,
          rows: [['Employee', `${escHtml(emp.name)} (${escHtml(emp.id)})`], ['Designation', escHtml(emp.designation)], ['Department', escHtml(emp.department)],
            ['Exit Type', escHtml(exit_type)], ['Notice Date', fmtDate(notice_date)], ['Last Working Day (proposed)', lwd ? fmtDate(lwd) : ''], ['Reason', nl2br(reason)]],
          link: pageLink('exit') }),
      }, 'notice');
    });
    return { id };
  }));

  // Step 2: HR fixes the last working day + concerned manager → dues.
  app.post('/api/hiring/exits/:id/confirm', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { x } = await loadExit(req.params.id, me);
    if (!exitRights(x, me).confirm) bad(`It is ${x.status}`);
    const b = req.body || {};
    const lwd = optDate(b.last_working_day, 'Last working day') || bad('Pick the last working day');
    if (x.notice_date && lwd < x.notice_date) bad('The last working day is before the notice date');
    const mgr = b.manager_id ? me.cfg.users.find((u) => u.id === String(b.manager_id)) : null;
    if (b.manager_id && !mgr) bad('Pick the concerned manager from the list');
    const clearers = [
      ...me.cfg.dues.map((id) => ({ id, role: 'Accounts / Final dues' })),
      ...(mgr ? [{ id: mgr.id, role: 'Concerned management' }] : []),
    ].filter((d, i, a) => a.findIndex((y) => y.id === d.id) === i)
      .map((d) => ({ ...d, name: userName(me.cfg.users, d.id), status: 'pending', amount: null, direction: '', note: '', at: null }));
    if (!clearers.length) bad('Nobody is set to clear final dues — ask an Admin to pick them in Settings');
    const note = str(b.note, 2000);
    await move('hire_exits', x.id, X.NOTICE, X.DUES, ', last_working_day=$2, manager_id=$3, manager_name=$4, dues=$5',
      [lwd, mgr?.id || null, mgr?.name || '', JSON.stringify(clearers)]);
    await logStep(x.id, 'Last Working Day Confirmed', [`LWD ${fmtDate(lwd)} · dues: ${clearers.map((d) => d.name).join(', ')}`, note].filter(Boolean).join(' — '), actor(me));
    later('dues ' + x.id, async () => {
      const ppl = await people(clearers.map((d) => d.id), me.cfg.users);
      const emp = await emails([x.user_id].filter(Boolean), me.cfg.users);
      await send({
        to: ppl.map((p) => p.email).join(','), cc: emp.join(','),
        subject: `Final dues to clear: ${x.employee_name} — last day ${fmtDate(lwd)}`,
        html: mailHtml({ heading: 'Final Dues Clearance', colour: '#d97706',
          lead: `<b>${escHtml(x.employee_name)}</b> leaves on <b>${fmtDate(lwd)}</b>. Each of you, please clarify the final dues (salary, advances, assets, recoveries) and mark them cleared in the ERP.`,
          rows: [['Employee', `${escHtml(x.employee_name)} (${escHtml(x.employee_id || '')})`], ['Designation', escHtml(x.designation)], ['Department', escHtml(x.department)],
            ['Last Working Day', fmtDate(lwd)], ['To Clear', escHtml(clearers.map((d) => `${d.name} (${d.role})`).join(', '))], ['HR Note', nl2br(note)]],
          link: pageLink('exit') }),
      }, 'dues');
    });
    return { ok: true };
  }));

  // Step 3: each clearer (or HR on their behalf) records the dues.
  app.post('/api/hiring/exits/:id/dues', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { x, row } = await loadExit(req.params.id, me);
    const can = exitRights(x, me);
    if (!can.clear) bad(x.status === X.DUES ? 'You are not one of the people clearing these dues' : `It is ${x.status}`);
    const b = req.body || {};
    const who = String(b.clearer_id || me.user.id);
    if (who !== me.user.id && !me.staff) bad('You can clear only your own part');
    const dues = x.dues.map((d) => ({ ...d }));
    const d = dues.find((y) => y.id === who) || bad('That person is not on the clearance list');
    if (d.status === 'cleared') bad(`${d.name} has already cleared`);
    const direction = ['payable', 'recoverable', 'nil'].includes(b.direction) ? b.direction : bad('Choose payable to the employee, recoverable from them, or nil');
    const amount = direction === 'nil' ? 0 : optMoney(b.amount, 'Amount');
    if (direction !== 'nil' && !amount) bad('Write the amount');
    Object.assign(d, { status: 'cleared', direction, amount, note: str(b.note, 2000), at: new Date().toISOString(), by: me.by });
    const allClear = dues.every((y) => y.status === 'cleared');
    const r = await pool.query(`UPDATE hire_exits SET dues=$1, status=$2, updated_at=NOW() WHERE id=$3 AND status=$4 AND dues=$5`,
      [JSON.stringify(dues), allClear ? X.CONTRACT : X.DUES, x.id, X.DUES, row.dues]);
    if (!r.rowCount) bad('This record just changed — reload');
    const amt = direction === 'nil' ? 'Nil' : `${inr(amount)} ${direction === 'payable' ? 'payable to employee' : 'to recover'}`;
    await logStep(x.id, `Dues Cleared — ${d.name}`, [amt, who !== me.user.id ? `recorded by ${me.by}` : '', d.note].filter(Boolean).join(' · '), actor(me));
    if (allClear) {
      await logStep(x.id, 'All Dues Cleared', '', { id: null, name: 'System' });
      later('dues-done ' + x.id, async () => {
        const to = await emails(me.cfg.hr, me.cfg.users);
        await send({
          to: to.join(','), subject: `Dues cleared: ${x.employee_name} — leave contract next`,
          html: mailHtml({ heading: 'Final Dues Cleared', colour: '#16a34a',
            lead: `Everyone has cleared the final dues of <b>${escHtml(x.employee_name)}</b>. Get the final leave contract signed by the employee and upload it in the ERP.`,
            rows: dues.map((y) => [y.name, escHtml(y.direction === 'nil' ? 'Nil' : `${inr(y.amount)} ${y.direction === 'payable' ? 'payable' : 'recoverable'}`) + (y.note ? ' — ' + nl2br(y.note) : '')]),
            link: pageLink('exit') }),
        }, 'dues-done');
      });
    }
    return { ok: true, allClear };
  }));

  // Step 4 (optional): mail the leave contract to the employee to sign.
  app.post('/api/hiring/exits/:id/contract', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { x } = await loadExit(req.params.id, me);
    if (!exitRights(x, me).contract) bad(`It is ${x.status} — the leave contract follows the dues clearance`);
    const b = req.body || {};
    const files = decodeFiles(b.documents, 'Leave contract', { only: ['pdf', 'doc', 'docx'] });
    if (files.length !== 1) bad('Attach the leave contract — one PDF or Word file');
    const to = str(b.email || x.email).toLowerCase();
    if (!EMAIL_RE.test(to)) bad('Give the employee\'s email');
    const ns = await saveDocs(x.id, files, { kind: 'contract', by: me.by });
    const note = str(b.note, 2000);
    const ok = await send({
      to, cc: (await emails(me.cfg.hr, me.cfg.users)).join(','), fromName: 'Lallubhai Amichand – HR',
      subject: `Final leave contract for your signature — ${x.employee_name}`,
      attachments: await attachmentsFor(x.id, ns),
      html: mailHtml({ heading: 'Final Leave Contract',
        lead: `Dear <b>${escHtml(x.employee_name)}</b>,<br><br>Your final dues have been settled. Please sign the attached leave contract and hand it over to HR (or reply with a signed scan).`,
        rows: [['Last Working Day', fmtDate(x.last_working_day)], ['Message', nl2br(note)]] }),
    }, 'contract');
    if (!ok) bad('The mail could not be sent — check the SMTP settings');
    await logStep(x.id, 'Leave Contract Sent for Signature', [to, note].filter(Boolean).join(' — '), actor(me), ns);
    return { ok: true };
  }));

  // Step 5: the signed contract on the dashboard → Completed. Also writes the
  // HR exit record and retires the employee + their login (like Employee
  // Master's own exit form).
  app.post('/api/hiring/exits/:id/complete', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { x } = await loadExit(req.params.id, me);
    if (!exitRights(x, me).complete) bad(`It is ${x.status}`);
    const b = req.body || {};
    const files = decodeFiles(b.documents, 'Signed leave contract', { only: ['pdf', 'jpg', 'png', 'webp', 'doc', 'docx'] });
    if (files.length !== 1) bad('Attach the leave contract signed by the employee');
    await move('hire_exits', x.id, X.CONTRACT, X.DONE, ', completed_at=NOW()');
    const ns = await saveDocs(x.id, files, { kind: 'signed_contract', by: me.by });
    const net = x.dues.reduce((s, d) => s + (d.direction === 'payable' ? Number(d.amount || 0) : d.direction === 'recoverable' ? -Number(d.amount || 0) : 0), 0);
    const notes = [];
    if (x.employee_id) {
      try {
        const noticeDays = x.notice_date && x.last_working_day ? Math.round((new Date(x.last_working_day) - new Date(x.notice_date)) / 86400000) : 0;
        const clearance = Object.fromEntries(x.dues.map((d) => [d.name, `${d.direction}${d.amount ? ' ' + d.amount : ''}${d.note ? ' — ' + d.note : ''}`]));
        await pool.query(
          `INSERT INTO hr_exits (id, employee_id, resign_date, last_working_day, exit_type, reason, notice_days, notice_served, clearance, fnf_amount, fnf_status, remarks, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,'pending',$10,$11)
           ON CONFLICT (employee_id) DO UPDATE SET resign_date=$12, last_working_day=$13, exit_type=$14, reason=$15, notice_days=$16, clearance=$17, fnf_amount=$18, remarks=$19`,
          [`EXT${Date.now().toString(36).toUpperCase()}`, x.employee_id, x.notice_date, x.last_working_day, x.exit_type, x.reason, noticeDays, JSON.stringify(clearance), net, `Hiring FMS ${x.id}`, me.by,
            x.notice_date, x.last_working_day, x.exit_type, x.reason, noticeDays, JSON.stringify(clearance), net, `Hiring FMS ${x.id}`]);
        if (b.deactivate !== false) {
          await pool.query(`UPDATE hr_employees SET dol=$1, status=$2 WHERE id=$3`,
            [x.last_working_day, !x.last_working_day || x.last_working_day <= istToday() ? 'Inactive' : 'Active', x.employee_id]);
          notes.push('employee marked Inactive');
        }
      } catch (e) {
        console.error('[hire] hr_exits sync failed for', x.id, '—', e.message);
        notes.push('HR exit record not updated: ' + e.message);
      }
    }
    if (b.deactivate !== false && x.user_id && (!x.last_working_day || x.last_working_day <= istToday())) {
      await q('UPDATE users SET active = 0 WHERE id = $1', [x.user_id]).catch((e) => notes.push('login not disabled: ' + e.message));
      notes.push('ERP login disabled');
    }
    await logStep(x.id, 'Signed Leave Contract Uploaded — Completed', [`Net ${net >= 0 ? 'payable' : 'recoverable'} ${inr(Math.abs(net))}`, ...notes, str(b.note, 2000)].filter(Boolean).join(' · '), actor(me), ns);
    return { ok: true, notes };
  }));

  app.post('/api/hiring/exits/:id/withdraw', requireAuth, route(null, async (req) => {
    const me = req.hire;
    const { x } = await loadExit(req.params.id, me);
    if (!exitRights(x, me).withdraw) bad(`It is ${x.status}`);
    await move('hire_exits', x.id, X_OPEN, X.WITHDRAWN);
    await logStep(x.id, 'Withdrawn', str(req.body?.note, 2000), actor(me));
    return { ok: true };
  }));

  app.delete('/api/hiring/exits/:id', requireAuth, route(null, async (req) => {
    const { x } = await loadExit(req.params.id, req.hire);
    if (!exitRights(x, req.hire).del) bad('Only the owner account can delete an exit record');
    await q('DELETE FROM hire_log WHERE ref_id = $1', [x.id]);
    await q('DELETE FROM hire_exits WHERE id = $1', [x.id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, x.id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }));

  /* ── Settings + agencies ───────────────────────────────────────── */

  app.post('/api/hiring/settings', requireAuth, route('manager', async (req) => {
    const b = req.body || {};
    const live = new Set(req.hire.cfg.users.map((u) => u.id));
    const ids = (list, label) => {
      if (!Array.isArray(list)) bad(`${label}: send a list`);
      const out = [...new Set(list.map(String).filter((id) => live.has(id)))];
      if (!out.length) bad(`Pick at least one person for ${label}`);
      return out;
    };
    if (b.hr !== undefined) await writeCfg('hr', ids(b.hr, 'HR'));
    if (b.mgmt !== undefined) await writeCfg('mgmt', ids(b.mgmt, 'Approving management'));
    if (b.dues !== undefined) await writeCfg('dues', ids(b.dues, 'Final dues'));
    if (b.inquiry !== undefined) {
      const e = str(b.inquiry).toLowerCase();
      if (!EMAIL_RE.test(e)) bad('The inquiry mailbox is not a valid email');
      await writeCfg('inquiry', e);
    }
    return { ok: true };
  }));

  app.post('/api/hiring/agencies', requireAuth, route('hr', async (req) => {
    const b = req.body || {};
    const name = str(b.name) || bad('Write the agency name');
    const email = str(b.email).toLowerCase();
    if (!EMAIL_RE.test(email)) bad('Write a valid email for the agency');
    const vals = [name, str(b.contact_person), email, str(b.phone, 64), b.active === false ? 0 : 1];
    if (b.id) {
      const r = await pool.query('UPDATE hire_agencies SET name=$1, contact_person=$2, email=$3, phone=$4, active=$5 WHERE id=$6', [...vals, str(b.id, 16)]);
      if (!r.rowCount) bad('Agency not found');
      return { id: b.id };
    }
    const id = await withSeqId('hire_agencies', 'AG', 3, (newId) => q(
      'INSERT INTO hire_agencies (id, name, contact_person, email, phone, active) VALUES ($1,$2,$3,$4,$5,$6)', [newId, ...vals]));
    return { id };
  }));

  /* ================================================================
     Public links
     ================================================================ */

  const failPage = (lead) => actionPage({ title: 'Link not usable', tone: 'bad', lead: escHtml(lead) });

  // ── Agency CV upload ────────────────────────────────────────────
  async function cvClaim(token) {
    const claim = readToken(token);
    if (!claim || !claim.id.startsWith(TOKEN.cv)) return { error: 'This link is not valid. Please ask us for a fresh one.' };
    const row = (await q('SELECT * FROM hire_requests WHERE id = $1', [claim.id.slice(TOKEN.cv.length)]))[0];
    if (!row) return { error: 'This requirement no longer exists.' };
    const r = reqOut(row);
    const agency = (await q('SELECT * FROM hire_agencies WHERE id = $1', [claim.decision]))[0];
    if (!agency || !Number(agency.active)) return { error: 'This link is no longer active.' };
    if (![RS.OPEN, RS.SOURCING].includes(r.status)) return { closed: r, agency };
    return { r, row, agency };
  }

  app.get('/hire-cv', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send(failPage('This needs the database.'));
      await ensureSchema();
      const t = String(req.query.t || '');
      const k = await cvClaim(t);
      if (k.error) return res.status(400).send(failPage(k.error));
      const cfg = await settings();
      if (k.closed) {
        return res.send(publicPage({ title: 'Position closed', body: `<h1>This position is ${escHtml(k.closed.status.toLowerCase())}</h1>
          <p>Thank you, ${escHtml(k.agency.name)} — we are not taking more CVs for <b>${escHtml(k.closed.position)}</b> right now. For any query, write to <a href="mailto:${escHtml(cfg.inquiry)}">${escHtml(cfg.inquiry)}</a>.</p>` }));
      }
      const { r, agency } = k;
      const jd = r.docs.filter((d) => d.kind === 'jd');
      const mine = await q('SELECT name, status, created_at FROM hire_candidates WHERE request_id = $1 AND agency_id = $2 ORDER BY created_at', [r.id, agency.id]);
      // A long job description is cut to a few lines with "View more", so
      // the CV form still fits on one screen (25 Nov 2026).
      const body = `
        <style>
          .jd { max-height:7.5em; overflow:hidden; position:relative; }
          .jd.cut::after { content:''; position:absolute; left:0; right:0; bottom:0; height:2.2em; background:linear-gradient(rgba(255,255,255,0), #fff); }
          .jd.open { max-height:none; }
          .jdmore { margin-top:6px; padding:4px 10px; font-size:12.5px; font-weight:600; color:#0150AA; background:#eff6ff; border:1px solid #bfdbfe; border-radius:7px; cursor:pointer; width:auto; }
        </style>
        <h1>Share CVs: ${escHtml(r.position)}</h1>
        <p>For <b>${escHtml(agency.name)}</b>. Fill this form once per candidate — you can come back to this link any time while the position is open.</p>
        <table class="info">
          <tr><th>Position</th><td>${escHtml(r.position)}</td></tr>
          <tr><th>Location</th><td>${escHtml(r.location)}</td></tr>
          <tr><th>Openings</th><td>${r.openings}</td></tr>
          ${r.experience ? `<tr><th>Experience</th><td>${escHtml(r.experience)}</td></tr>` : ''}
          ${r.description ? `<tr><th>Details</th><td><div class="jd" id="jd">${escHtml(r.description)}</div><button type="button" class="jdmore" id="jdmore" hidden>View more ▾</button></td></tr>` : ''}
          ${jd.length ? `<tr><th>Job Description</th><td>${jd.map((d) => `<a href="/hire-cv/jd?t=${encodeURIComponent(t)}&n=${d.n}">${escHtml(d.name)}</a>`).join('<br>')}</td></tr>` : ''}
        </table>
        <form id="f">
          <div class="row">
            <div><label>Candidate name *</label><input name="name" required maxlength="255"></div>
            <div><label>Phone *</label><input name="phone" required maxlength="64"></div>
            <div><label>Email</label><input name="email" type="email" maxlength="255"></div>
            <div><label>Total experience</label><input name="experience" maxlength="128" placeholder="e.g. 4 years"></div>
            <div><label>Current CTC</label><input name="current_ctc" maxlength="64"></div>
            <div><label>Expected CTC</label><input name="expected_ctc" maxlength="64"></div>
            <div><label>Notice period</label><input name="notice_period" maxlength="64" placeholder="e.g. 30 days"></div>
          </div>
          <label>Remarks</label><textarea name="notes" rows="2" maxlength="2000"></textarea>
          <label>CV (PDF or Word, up to 4 MB) *</label><input name="cv" type="file" required accept=".pdf,.doc,.docx,application/pdf">
          <button type="submit" id="go">Submit CV</button>
          <div id="msg" class="msg"></div>
        </form>
        ${mine.length ? `<p style="margin-top:20px;font-size:13px;"><b>Already shared by you (${mine.length}):</b> ${mine.map((m) => escHtml(m.name)).join(', ')}</p>` : ''}
        <p class="note">Questions? Write to <a href="mailto:${escHtml(cfg.inquiry)}">${escHtml(cfg.inquiry)}</a>.</p>`;
      const script = `
        const jd = document.getElementById('jd'), more = document.getElementById('jdmore');
        if (jd && more && jd.scrollHeight > jd.clientHeight + 4) {
          jd.classList.add('cut'); more.hidden = false;
          more.addEventListener('click', () => {
            const open = jd.classList.toggle('open');
            jd.classList.toggle('cut', !open);
            more.textContent = open ? 'View less ▴' : 'View more ▾';
          });
        }
        const f = document.getElementById('f'), msg = document.getElementById('msg'), go = document.getElementById('go');
        const show = (t, ok) => { msg.textContent = t; msg.className = 'msg ' + (ok ? 'ok' : 'err'); };
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const file = f.cv.files[0];
          if (!file) return show('Attach the CV', false);
          if (file.size > 4 * 1024 * 1024) return show('The CV is over 4 MB', false);
          go.disabled = true; go.textContent = 'Uploading…';
          try {
            const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
            const body = { t: ${JSON.stringify(t)}, cv: { name: file.name, dataUrl } };
            ['name','phone','email','experience','current_ctc','expected_ctc','notice_period','notes'].forEach((k) => body[k] = f[k].value);
            const res = await fetch('/hire-cv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const out = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(out.error || 'Could not submit');
            show('Thank you — the CV of ' + body.name + ' has been received. You can submit another one.', true);
            f.reset();
          } catch (err) { show(err.message, false); }
          go.disabled = false; go.textContent = 'Submit CV';
        });`;
      res.send(publicPage({ title: `CVs for ${r.position}`, body, script }));
    } catch (e) {
      res.status(500).send(actionPage({ title: 'Something went wrong', tone: 'bad', lead: escHtml(e.message) }));
    }
  });

  app.get('/hire-cv/jd', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send('Not available');
      await ensureSchema();
      const k = await cvClaim(String(req.query.t || ''));
      if (k.error || k.closed) return res.status(400).send(failPage(k.error || 'This position is closed.'));
      const n = parseInt(req.query.n, 10);
      const doc = parseJson(k.row.documents, [])[n];
      if (!doc || doc.kind !== 'jd') return res.status(404).send(failPage('Document not found'));
      res.download(path.join(UPLOAD_ROOT, k.row.id, path.basename(doc.file)), doc.name, (err) => { if (err && !res.headersSent) res.status(404).send('Missing'); });
    } catch (e) { res.status(500).send(failPage(e.message)); }
  });

  app.post('/hire-cv', async (req, res) => {
    try {
      if (!useDb) return res.status(503).json({ error: 'Not available' });
      await ensureSchema();
      const b = req.body || {};
      const k = await cvClaim(String(b.t || ''));
      if (k.error) return res.status(400).json({ error: k.error });
      if (k.closed) return res.status(400).json({ error: 'This position is no longer open.' });
      const f = candFields(b);
      if (!f.phone) bad('Give the candidate\'s phone number');
      const files = decodeFiles(b.cv ? [b.cv] : [], 'CV', { only: ['pdf', 'doc', 'docx'] });
      if (!files.length) bad('Attach the CV');
      // The same person twice from the same agency is a double submit.
      const dup = await q('SELECT id FROM hire_candidates WHERE request_id=$1 AND agency_id=$2 AND (LOWER(name)=$3 AND phone=$4)', [k.r.id, k.agency.id, f.name.toLowerCase(), f.phone]);
      if (dup.length) bad(`${f.name} has already been submitted for this position`);
      const id = await addCandidate(k.r, f, { source: k.agency.name, agencyId: k.agency.id, by: { id: null, name: k.agency.name }, files });
      res.json({ ok: true, id });
    } catch (e) {
      if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
      console.error('[hire] /hire-cv —', e.message);
      res.status(500).json({ error: 'Could not save the CV — please try again' });
    }
  });

  // ── Candidate offer response ────────────────────────────────────
  async function offerClaim(token) {
    const claim = readToken(token);
    if (!claim || !claim.id.startsWith(TOKEN.offer)) return { error: 'This link is not valid. Please write to us for a fresh one.' };
    const row = (await q('SELECT * FROM hire_candidates WHERE id = $1', [claim.id.slice(TOKEN.offer.length)]))[0];
    if (!row) return { error: 'This offer no longer exists.' };
    const c = candOut(row);
    if (String(c.offer_version) !== claim.decision || c.email.toLowerCase() !== String(claim.email || '').toLowerCase()) {
      return { error: 'This offer link has been replaced by a newer one — please use the latest mail from us.' };
    }
    const r = reqOut((await q('SELECT * FROM hire_requests WHERE id = $1', [c.request_id]))[0] || {});
    return { c, r, row };
  }

  function offerPage(k, t, error = '', note = '', picked = '') {
    const { c, r } = k;
    const signed = lastDoc(c.docs, ['signed']);
    const opt = (v, label, small) => `<label class="opt"><input type="radio" name="response" value="${v}"${picked === v ? ' checked' : ''}> <span>${label}<small>${small}</small></span></label>`;
    return publicPage({ title: 'Your offer', body: `
      <h1>Dear ${escHtml(c.name)},</h1>
      <p>We are pleased to offer you the position below. Please read the appointment letter and let us know your decision.</p>
      <table class="info">
        <tr><th>Designation</th><td>${escHtml(c.designation)}</td></tr>
        <tr><th>Location</th><td>${escHtml(r.location || '')}</td></tr>
        <tr><th>Date of Joining</th><td>${fmtDate(c.doj)}</td></tr>
        ${signed ? `<tr><th>Appointment Letter</th><td><a href="/hire-offer/letter?t=${encodeURIComponent(t)}">${escHtml(signed.name)}</a></td></tr>` : ''}
      </table>
      <form method="POST" action="/hire-offer">
        <input type="hidden" name="t" value="${escHtml(t)}">
        ${error ? `<div class="msg err">${escHtml(error)}</div>` : ''}
        ${opt('accept', 'I accept the offer', 'I will join on the date above.')}
        ${opt('changes', 'I accept, with some changes', 'Write the changes you would like below — we will get back to you.')}
        ${opt('decline', 'I decline the offer', 'We would appreciate a short reason.')}
        <label>Your message</label>
        <textarea name="note" rows="4" maxlength="4000">${escHtml(note)}</textarea>
        <button type="submit">Send my answer</button>
      </form>` });
  }

  app.get('/hire-offer', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send(failPage('This needs the database.'));
      await ensureSchema();
      const t = String(req.query.t || '');
      const k = await offerClaim(t);
      if (k.error) return res.status(400).send(failPage(k.error));
      if (k.c.status !== C.OFFER_SENT) {
        return res.send(publicPage({ title: 'Answer received', body: `<h1>Thank you, ${escHtml(k.c.name)}</h1>
          <p>${k.c.response ? `We have your answer: <b>${escHtml(RESP_LABEL[k.c.response] || k.c.response)}</b>.` : 'There is no offer waiting for your answer right now.'} For anything else, write to <a href="mailto:${escHtml((await settings()).inquiry)}">${escHtml((await settings()).inquiry)}</a>.</p>` }));
      }
      res.send(offerPage(k, t, '', '', String(req.query.r || '')));
    } catch (e) { res.status(500).send(failPage(e.message)); }
  });

  app.get('/hire-offer/letter', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send('Not available');
      await ensureSchema();
      const k = await offerClaim(String(req.query.t || ''));
      if (k.error) return res.status(400).send(failPage(k.error));
      const signed = lastDoc(k.c.docs, ['signed']);
      if (!signed) return res.status(404).send(failPage('The letter is not on file'));
      sendDoc(res, k.row, signed.n);
    } catch (e) { if (!res.headersSent) res.status(500).send(failPage(e.message)); }
  });

  app.post('/hire-offer', async (req, res) => {
    const t = String(req.body?.t || '');
    const note = str(req.body?.note, 4000);
    const response = String(req.body?.response || '');
    try {
      if (!useDb) return res.status(503).send(failPage('This needs the database.'));
      await ensureSchema();
      const k = await offerClaim(t);
      if (k.error) return res.status(400).send(failPage(k.error));
      if (k.c.status !== C.OFFER_SENT) return res.redirect(303, `/hire-offer?t=${encodeURIComponent(t)}`);
      try {
        await recordResponse(k.c, k.r, response, note, null, true);
      } catch (e) {
        if (e instanceof UserError) return res.status(400).send(offerPage(k, t, e.message, note, response));
        throw e;
      }
      const cfg = await settings();
      res.send(publicPage({ title: 'Thank you', body: `<h1>Thank you, ${escHtml(k.c.name)}</h1>
        <p>${response === 'accept' ? `We are delighted! We look forward to welcoming you on <b>${fmtDate(k.c.doj)}</b>. Our HR team will be in touch with the joining details.`
          : response === 'changes' ? 'We have your request and will get back to you shortly.'
            : 'We are sorry to hear that, and thank you for letting us know. We wish you all the best.'}</p>
        <p class="note">Questions? Write to <a href="mailto:${escHtml(cfg.inquiry)}">${escHtml(cfg.inquiry)}</a>.</p>` }));
    } catch (e) { res.status(500).send(failPage('Could not record your answer: ' + e.message)); }
  });

  // ── Interviewer result / management approval from mail ──────────
  const ACTION_LABEL = { select: 'Select', next: 'Call for Next Round', reject: 'Reject', approve: 'Approve', changes: 'Send Back' };
  async function actionClaim(token) {
    const claim = readToken(token);
    if (!claim) return { error: 'This link is not valid. Open the Hiring FMS in the ERP instead.' };
    const cfg = await settings();
    if (claim.id.startsWith(TOKEN.result) && ['select', 'next', 'reject'].includes(claim.decision)) {
      const { c, r } = await loadCand(claim.id.slice(TOKEN.result.length)).catch(() => ({}));
      if (!c) return { error: 'That candidate no longer exists.' };
      if (c.status !== C.INTERVIEW) return { done: c };
      const p = (await people(candInterviewers(c, r), cfg.users)).find((x) => x.email.toLowerCase() === String(claim.email || '').toLowerCase());
      if (!p) return { error: 'This link belongs to someone who is no longer an interviewer for this candidate.' };
      return { kind: 'result', claim, c, r, by: { id: p.id, name: p.name } };
    }
    if (claim.id.startsWith(TOKEN.approve) && ['approve', 'changes'].includes(claim.decision)) {
      const [cid, v] = claim.id.slice(TOKEN.approve.length).split(':');
      const { c, r } = await loadCand(cid).catch(() => ({}));
      if (!c) return { error: 'That candidate no longer exists.' };
      if (c.status !== C.OFFER_APPROVAL || String(c.offer_version) !== v) return { done: c };
      const p = (await people(cfg.mgmt, cfg.users)).find((x) => x.email.toLowerCase() === String(claim.email || '').toLowerCase());
      if (!p) return { error: 'This link belongs to someone who is no longer on the approving management list.' };
      return { kind: 'approve', claim, c, r, by: { id: p.id, name: p.name } };
    }
    return { error: 'This link is not valid. Open the Hiring FMS in the ERP instead.' };
  }
  const actRows = (k) => [['Candidate', k.c.name], ['Position', k.r?.position || ''],
    ...(k.kind === 'approve' ? [['Designation', k.c.designation], ['CTC', k.c.ctc], ['Date of Joining', fmtDate(k.c.doj)], ['Letter', `v${k.c.offer_version}`]]
      : [['Interview', fmtWall(k.c.interview_at)], ['Round', String(k.c.interview_round)]])];
  const donePage = (c) => actionPage({ title: 'Nothing pending', tone: 'plain',
    lead: `${escHtml(c.name)} is now <b>${escHtml(c.status)}</b> — nothing is waiting on this link.`, note: `<a href="${escHtml(pageLink())}">Open the Hiring FMS</a>` });
  function actForm(k, token, error = '', remarks = '') {
    const d = k.claim.decision;
    const need = d !== 'select' && d !== 'approve';
    return actionPage({
      title: `${ACTION_LABEL[d]}: ${k.c.name}?`, tone: ['select', 'approve'].includes(d) ? 'good' : d === 'reject' ? 'bad' : 'plain',
      lead: k.kind === 'approve' ? `Appointment letter for <b>${escHtml(k.c.name)}</b>.` : `Your interview decision on <b>${escHtml(k.c.name)}</b>.`,
      rows: actRows(k),
      form: `<form method="POST" action="/hire-action">
          <input type="hidden" name="t" value="${escHtml(token)}">
          ${error ? `<p style="color:#dc2626;font-weight:600;">${escHtml(error)}</p>` : ''}
          <textarea name="remarks" rows="4" placeholder="${need ? 'Remarks (required)' : 'Remarks (optional)'}"
            style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font:inherit;font-size:14px;margin:0 0 14px;">${escHtml(remarks)}</textarea>
          <button type="submit">Yes, ${escHtml(ACTION_LABEL[d].toLowerCase())}</button>
        </form>`,
      note: `<a href="${escHtml(pageLink())}">Open the Hiring FMS in the ERP</a>`,
    });
  }
  app.get('/hire-action', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send(failPage('This needs the database.'));
      await ensureSchema();
      const k = await actionClaim(req.query.t);
      if (k.error) return res.status(400).send(failPage(k.error));
      if (k.done) return res.send(donePage(k.done));
      res.send(actForm(k, String(req.query.t)));
    } catch (e) { res.status(500).send(failPage(e.message)); }
  });
  app.post('/hire-action', async (req, res) => {
    const token = String(req.body?.t || '');
    const remarks = str(req.body?.remarks, 4000);
    try {
      if (!useDb) return res.status(503).send(failPage('This needs the database.'));
      await ensureSchema();
      const k = await actionClaim(token);
      if (k.error) return res.status(400).send(failPage(k.error));
      if (k.done) return res.send(donePage(k.done));
      try {
        if (k.kind === 'result') await recordResult(k.c, k.r, k.claim.decision, remarks, k.by);
        else await decideOffer(k.c, k.r, k.claim.decision, remarks, k.by);
      } catch (e) {
        if (e instanceof UserError) return res.status(400).send(actForm(k, token, e.message, remarks));
        throw e;
      }
      const after = (await loadCand(k.c.id)).c;
      res.send(actionPage({ title: after.status, tone: [C.NOTSEL].includes(after.status) ? 'bad' : 'good',
        lead: `Recorded — ${escHtml(after.name)} is now <b>${escHtml(after.status)}</b>. HR has been mailed.`, rows: actRows({ ...k, c: after }), note: 'You can close this tab.' }));
    } catch (e) { res.status(500).send(failPage('Could not record it: ' + e.message)); }
  });

  return {};
}

module.exports = { HIRE_SCHEMA, mountHiring };
