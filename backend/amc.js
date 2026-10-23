'use strict';
/* =====================================================================
   Service Management System (was "AMC Management", route key still 'amc')
   ---------------------------------------------------------------------
   A service request — insurance, AMC, electricity / internet bills, rent,
   repairs, subscriptions… — raised by anyone (the "doer") from the
   dashboard, approved by someone from the management team, then paid by
   Accounts. One request walks through:

     Pending Approval ── approver: Approve ──► Approved
        ▲   │            approver: Reject  ──► Rejected (final)
        │   └─────────── approver: Comment ──► Query Raised
        └── doer updates + resubmits ◄────────────┘
     Approved ── doer picks the vendor (or adds a new one) ──► With Accounts
     With Accounts ── Accounts records the payment ──► Paid (final)

   Every step mails the person who has to act next: the approver on a new
   or resubmitted request, the doer on a comment / approval / rejection,
   Accounts (with the quotation PDFs attached) when it is sent to them,
   and the approver + doer once it is paid.

   Who is who. The approver is chosen on the form from the management team
   (Settings). Accounts is the Settings "Accounts team" plus any extra
   accounts email IDs. Module admins — the owner, plus whoever Users →
   Access ticks "Service Management" for (permissions.grants 'amc', see
   hasAmcAccess in server.js) — see every request and edit Settings and
   the vendor master. Everyone else sees the requests they raised, the
   ones waiting on them as approver, and (Accounts) the ones sent to pay.

   Vendors reuse the amc_vendors table, with bank details added since
   Accounts pays them. The old AMC contract / equipment / renewal tables
   are no longer created or read; whatever rows they hold stay untouched.

   Documents (quotations, payment proof) are written to
   uploads/service-requests/<id>/ on the server's disk — never in git or
   the DB.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'service-requests');

// utf8mb4_unicode_ci outright: that is what fixCollations in server.js forces
// `users` to, and a table on the server default fails JOINs against it.
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
  `ALTER TABLE amc_vendors ADD COLUMN IF NOT EXISTS pan VARCHAR(16) DEFAULT ''`,
  `ALTER TABLE amc_vendors ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE amc_vendors ADD COLUMN IF NOT EXISTS account_holder VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE amc_vendors ADD COLUMN IF NOT EXISTS account_no VARCHAR(64) DEFAULT ''`,
  `ALTER TABLE amc_vendors ADD COLUMN IF NOT EXISTS ifsc VARCHAR(16) DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS sms_requests (
     id VARCHAR(16) PRIMARY KEY,
     service_type VARCHAR(64) NOT NULL,
     frequency VARCHAR(32) NOT NULL DEFAULT 'One Time',
     department VARCHAR(128) NOT NULL DEFAULT '',
     priority VARCHAR(16) NOT NULL DEFAULT 'Medium',
     payment_date DATE DEFAULT NULL,
     remarks TEXT,
     status VARCHAR(32) NOT NULL DEFAULT 'Pending Approval',
     raised_by_id VARCHAR(16) DEFAULT NULL,
     raised_by_name VARCHAR(255) DEFAULT '',
     approver_id VARCHAR(16) DEFAULT NULL,
     approver_name VARCHAR(255) DEFAULT '',
     decided_at DATETIME DEFAULT NULL,
     vendor_id VARCHAR(16) DEFAULT NULL,
     sent_to_accounts_at DATETIME DEFAULT NULL,
     paid_date DATE DEFAULT NULL,
     paid_amount DECIMAL(14,2) DEFAULT NULL,
     paid_mode VARCHAR(32) DEFAULT '',
     paid_reference VARCHAR(128) DEFAULT '',
     paid_by VARCHAR(255) DEFAULT '',
     paid_at DATETIME DEFAULT NULL,
     documents TEXT,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_sms_req_status ON sms_requests (status)`,
  `CREATE INDEX idx_sms_req_raised ON sms_requests (raised_by_id)`,
  `CREATE INDEX idx_sms_req_approver ON sms_requests (approver_id)`,
  // The request's timeline: every step, comment and reply.
  `CREATE TABLE IF NOT EXISTS sms_request_log (
     id INT AUTO_INCREMENT PRIMARY KEY,
     request_id VARCHAR(16) NOT NULL,
     action VARCHAR(32) NOT NULL,
     note TEXT,
     by_id VARCHAR(16) DEFAULT NULL,
     by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_sms_log_req ON sms_request_log (request_id)`,
];

const SERVICE_TYPES = ['Insurance', 'AMC', 'Electricity Bills', 'Internet Bills', 'Rent Payments', 'Repairs',
  'Social Media', 'WhatsApp Rentals', 'Subscriptions', 'Maintenance Bills', 'Quotations'];
const FREQUENCIES = ['One Time', 'Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const PAY_MODES = ['NEFT / RTGS', 'IMPS / UPI', 'Cheque', 'Cash', 'Other'];
const DEFAULT_DEPARTMENTS = ['Bopal Retail Store', 'Satellite Retail Store', 'Tardeo Office', 'Vatva Factory', 'Odhav Factory',
  'Bhiwandi Godown', 'Wire Rod Factory', 'Maheshbhai Car', 'Vatva Factory Car', 'Vatva Factory Scooter', 'Dun Rooms', 'Other'];

const S = {
  PENDING: 'Pending Approval', QUERY: 'Query Raised', REJECTED: 'Rejected',
  APPROVED: 'Approved', ACCOUNTS: 'With Accounts', PAID: 'Paid',
};
const STATUSES = Object.values(S);
// Mail-action tokens share the leave/PO HMAC; the namespace keeps them apart.
const TOKEN_NS = 'sms:';

// Settings live in app_config as JSON.
const CFG = {
  approvers: 'sms_approvers',          // ['U0001', …] — the management team
  accounts: 'sms_accounts',            // ['U0007', …] — the Accounts team
  accountsEmails: 'sms_accounts_emails', // ['accounts@laltd.in']
  departments: 'sms_departments',      // DEFAULT_DEPARTMENTS + any added
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const DOC_MAX = 5;
const DOC_BYTES = 4 * 1024 * 1024;
const DOC_TOTAL = 7 * 1024 * 1024;  // express.json caps the body at 10mb of base64
const DOC_KEEP = 20;

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
// components are the stored date whatever the host's timezone is.
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
function decodeDocs(list, already = 0, { pdfOnly = false } = {}) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > DOC_MAX) bad(`At most ${DOC_MAX} files at a time`);
  if (already + list.length > DOC_KEEP) bad(`At most ${DOC_KEEP} documents per request — remove one first`);
  let total = 0;
  return list.map((d, i) => {
    const name = String(d?.name || `document-${i + 1}`).replace(/[\\/]+/g, '_').slice(0, 120);
    const parsed = parseDataUrl(d?.dataUrl);
    if (!parsed) bad(`Could not read "${name}"`);
    const ext = DOC_TYPES[parsed.mimeType];
    if (!ext || (pdfOnly && ext !== 'pdf')) bad(`"${name}": ${pdfOnly ? 'the quotation must be a PDF' : 'only PDF or image files are accepted'}`);
    if (parsed.buffer.length > DOC_BYTES) bad(`"${name}" is over 4 MB`);
    total += parsed.buffer.length;
    if (total > DOC_TOTAL) bad('Files together must be under 7 MB');
    const safe = name.replace(/[^\w.\- ()]/g, '_').replace(/\.[^.]*$/, '') || 'document';
    return { name, safe, ext, size: parsed.buffer.length, type: parsed.mimeType, buffer: parsed.buffer };
  });
}

// File names carry a timestamp so a later upload never overwrites.
async function writeDocs(id, docs, by, kind) {
  if (!docs.length) return [];
  const dir = path.join(UPLOAD_ROOT, id);
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = Date.now().toString(36);
  const out = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const file = `${stamp}-${i + 1}-${d.safe}.${d.ext}`;
    await fs.promises.writeFile(path.join(dir, file), d.buffer);
    out.push({ name: d.name, file, size: d.size, type: d.type, kind, by, at: new Date().toISOString() });
  }
  return out;
}

const docsOut = (raw) => parseDocs(raw).map(({ name, size, type, kind, by, at }) => ({ name, size, type, kind: kind || 'quotation', by: by || '', at: at || null }));

/* ── Mail ──────────────────────────────────────────────────────────── */

function mailHtml({ heading, colour = '#0150AA', lead, rows, footer, link, actions }) {
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
      ${actions || ''}
      ${footer ? `<p style="color:#374151">${footer}</p>` : ''}
      ${link ? `<p><a href="${escHtml(link)}" style="display:inline-block;background:#0150AA;color:#fff;padding:9px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open in ERP</a></p>` : ''}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">This is an automated notification from the Lallubhai Amichand ERP — Service Management System.</p>
    </div>`;
}

/* Bulletproof-ish mail buttons (a coloured table cell around a padded link):
   the one construction Outlook, Gmail and Apple Mail all render the same. */
function decisionButtons(list) {
  const btn = ([label, colour, href]) => `<td style="padding:0 8px 8px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate">
        <tr><td style="background:${colour};border-radius:6px">
          <a href="${escHtml(href)}" style="display:inline-block;padding:11px 24px;font-family:Arial,sans-serif;
             font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${label}</a>
        </td></tr>
      </table>
    </td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr>${list.map(btn).join('')}</tr></table>`;
}

/* ===================================================================== */

function mountAmc(app, ctx) {
  const {
    q, pool, ensureSchema, requireAuth, hasAmcAccess,
    withSeqId, getMailer, notifyAddressFor, istToday, appOrigin, useDb,
    tokenFor, readToken, actionPage,
  } = ctx;

  const today = () => istToday().iso;
  // The router reads the whole hash as the page name, so links open the page
  // itself; the mail already names the request.
  const pageLink = () => `${appOrigin}/#amc`;

  /* ── Settings ──────────────────────────────────────────────────── */

  async function readCfg(name) {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [CFG[name]]);
      if (rows.length) return JSON.parse(rows[0].value);
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('[sms] could not read setting', name, '—', e.message);
    }
    return null;
  }
  async function writeCfg(name, value) {
    const json = JSON.stringify(value);
    await q(`INSERT INTO app_config ("key","value") VALUES ($1,$2) ON CONFLICT ("key") DO UPDATE SET "value"=$3`,
      [CFG[name], json, json]);
  }

  async function activeUsers() {
    const rows = await q(`SELECT id, name, email, department, roles, active FROM users ORDER BY name`);
    return rows.filter((u) => Number(u.active ?? 1) !== 0);
  }
  const rolesOf = (u) => String(u.roles || '').split(',').map((r) => r.trim());

  // Until Settings names them: the management team is every Admin, and
  // Accounts is everyone whose department says Accounts.
  async function settings() {
    const [approvers, accounts, accountsEmails, departments, users] = await Promise.all([
      readCfg('approvers'), readCfg('accounts'), readCfg('accountsEmails'), readCfg('departments'), activeUsers(),
    ]);
    const live = new Set(users.map((u) => u.id));
    const ids = (list) => (Array.isArray(list) ? list.map(String).filter((id) => live.has(id)) : null);
    return {
      approvers: ids(approvers) ?? users.filter((u) => rolesOf(u).includes('Admin')).map((u) => u.id),
      accounts: ids(accounts) ?? users.filter((u) => /account/i.test(u.department || '')).map((u) => u.id),
      accountsEmails: Array.isArray(accountsEmails) ? accountsEmails.filter((e) => EMAIL_RE.test(e)) : [],
      departments: Array.isArray(departments) && departments.length ? departments : DEFAULT_DEPARTMENTS,
      approversSet: Array.isArray(approvers),
      accountsSet: Array.isArray(accounts),
      users,
    };
  }

  /* ── Who is asking ─────────────────────────────────────────────── */

  // Wraps a handler: DB check, schema, who-is-who lookup, uniform errors.
  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'Service Management needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        if (!user) return res.status(401).json({ error: 'Please log in again' });
        const cfg = await settings();
        const me = {
          user, cfg, by: user.name || user.email || '',
          admin: await hasAmcAccess(user),
          approver: cfg.approvers.includes(user.id),
          accounts: cfg.accounts.includes(user.id),
        };
        if (need === 'admin' && !me.admin) return res.status(403).json({ error: 'Only a Service Management admin can do this — ask the owner to grant it from Users → Access' });
        req.sms = me;
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[sms]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }

  async function logStep(id, action, note, me) {
    await q(`INSERT INTO sms_request_log (request_id, action, note, by_id, by_name) VALUES ($1,$2,$3,$4,$5)`,
      [id, action, String(note || '').slice(0, 4000), me?.user?.id || null, me?.by || 'System']);
  }

  /* ── Row shapes ────────────────────────────────────────────────── */

  function vendorOut(r) {
    return {
      id: r.id, name: r.name || '', contact_person: r.contact_person || '', phone: r.phone || '',
      email: r.email || '', address: r.address || '', gstin: r.gstin || '', pan: r.pan || '',
      bank_name: r.bank_name || '', account_holder: r.account_holder || '', account_no: r.account_no || '', ifsc: r.ifsc || '',
      services: r.services || '', active: !!Number(r.active), notes: r.notes || '',
    };
  }

  function reqOut(r, vendors) {
    const v = r.vendor_id ? vendors.get(r.vendor_id) : null;
    return {
      id: r.id, service_type: r.service_type, frequency: r.frequency, department: r.department || '',
      priority: r.priority, payment_date: dstr(r.payment_date), remarks: r.remarks || '', status: r.status,
      raised_by_id: r.raised_by_id || null, raised_by_name: r.raised_by_name || '',
      approver_id: r.approver_id || null, approver_name: r.approver_name || '', decided_at: tsOut(r.decided_at),
      vendor_id: r.vendor_id || '', vendor_name: v?.name || '',
      sent_to_accounts_at: tsOut(r.sent_to_accounts_at),
      paid_date: dstr(r.paid_date), paid_amount: r.paid_amount == null ? null : Number(r.paid_amount),
      paid_mode: r.paid_mode || '', paid_reference: r.paid_reference || '', paid_by: r.paid_by || '', paid_at: tsOut(r.paid_at),
      documents: docsOut(r.documents),
      created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
    };
  }

  function visible(s, me) {
    if (me.admin) return true;
    const uid = me.user.id;
    if (s.raised_by_id === uid || s.approver_id === uid) return true;
    return me.accounts && (s.status === S.ACCOUNTS || s.status === S.PAID);
  }

  // What this person can do to this request right now.
  function rights(s, me) {
    const uid = me.user.id;
    return {
      decide: s.status === S.PENDING && s.approver_id === uid,
      update: s.status === S.QUERY && s.raised_by_id === uid,
      send: s.status === S.APPROVED && (s.raised_by_id === uid || me.admin),
      pay: s.status === S.ACCOUNTS && (me.accounts || me.admin),
      del: me.admin,
    };
  }

  async function vendorMap() {
    return new Map((await q('SELECT * FROM amc_vendors ORDER BY name')).map((v) => [v.id, v]));
  }

  async function loadReq(req) {
    const vendors = await vendorMap();
    const row = (await q('SELECT * FROM sms_requests WHERE id = $1', [req.params.id]))[0];
    if (!row) throw new UserError('Service request not found', 404);
    const s = reqOut(row, vendors);
    if (!visible(s, req.sms)) throw new UserError('You cannot view this request', 403);
    return { s, row, vendors };
  }

  /* ── Recipients + mail ─────────────────────────────────────────── */

  // User ids → their notification addresses (Profile), like every other mail.
  async function addressesOf(userIds) {
    const uniq = [...new Set((userIds || []).filter(Boolean))];
    if (!uniq.length) return [];
    const rows = await q(`SELECT id, email, active FROM users WHERE id IN (${uniq.map((_, i) => '$' + (i + 1)).join(',')})`, uniq);
    const out = [];
    for (const r of rows) {
      if (Number(r.active ?? 1) === 0) continue;
      const e = await notifyAddressFor(r.id, r.email);
      if (e && EMAIL_RE.test(e)) out.push(e);
    }
    return out;
  }

  const uniqMail = (list) => {
    const seen = new Set();
    return list.filter((e) => { const k = String(e).toLowerCase(); if (!e || seen.has(k)) return false; seen.add(k); return true; });
  };

  function requestRows(s) {
    return [
      ['Request ID', `<b>${escHtml(s.id)}</b>`],
      ['Type of Service', escHtml(s.service_type)],
      ['Frequency', escHtml(s.frequency)],
      ['Department', escHtml(s.department)],
      ['Priority', `<b>${escHtml(s.priority)}</b>`],
      ['Payment Date', fmtDate(s.payment_date)],
      ['Raised By', escHtml(s.raised_by_name)],
      ['Approver', escHtml(s.approver_name)],
      ['Vendor', escHtml(s.vendor_name)],
      ['Remarks', escHtml(s.remarks).replace(/\n/g, '<br>')],
      ['Status', escHtml(s.status)],
    ];
  }

  async function quotationFiles(id) {
    const row = (await q('SELECT documents FROM sms_requests WHERE id = $1', [id]))[0];
    return parseDocs(row?.documents).filter((d) => (d.kind || 'quotation') === 'quotation')
      .map((d) => ({ filename: d.name, path: path.join(UPLOAD_ROOT, id, path.basename(d.file)) }))
      .filter((a) => fs.existsSync(a.path));
  }

  // Fire-and-forget: a mail problem must never fail the step that caused it.
  function notify(s, stage, { note = '', vendor = null } = {}) {
    (async () => {
      const mailer = getMailer();
      const cfg = await settings();
      const doer = await addressesOf([s.raised_by_id]);
      const approver = await addressesOf([s.approver_id]);
      const noteRow = note ? [['Note', escHtml(note).replace(/\n/g, '<br>')]] : [];
      let to = [], cc = [], heading, colour = '#0150AA', lead, subject, attachments = [], extra = [], actions = '';
      // A no-buttons copy for someone who must hear about it but not act on it.
      let copy = null;
      if (stage === 'raised' || stage === 'resubmitted') {
        // The buttons go to the approver alone — the doer gets their own
        // copy below, so they can never approve their own request.
        to = approver;
        heading = stage === 'raised' ? 'Service Request — Approval Needed' : 'Service Request Updated — Approval Needed';
        lead = stage === 'raised'
          ? `<b>${escHtml(s.raised_by_name)}</b> has raised a service request and chose you as the approver. Please approve, reject or comment on it in the ERP.`
          : `<b>${escHtml(s.raised_by_name)}</b> has updated service request <b>${escHtml(s.id)}</b> after your comment. It is waiting for your approval again.`;
        subject = `${stage === 'raised' ? 'Approval needed' : 'Updated — approval needed'}: ${s.id} ${s.service_type} [${s.priority}]`;
        // Decide straight from the mail: each button opens a confirm page
        // (see /sms-action) bound to this approver's address.
        if (approver[0]) {
          const url = (action) => `${appOrigin}/sms-action?t=${encodeURIComponent(tokenFor(TOKEN_NS + s.id, action, approver[0]))}`;
          actions = decisionButtons([['Approve', '#16a34a', url('approve')], ['Comment', '#7c3aed', url('comment')], ['Reject', '#dc2626', url('reject')]]);
        }
        attachments = await quotationFiles(s.id);
        copy = {
          to: doer.filter((e) => !approver.some((a) => a.toLowerCase() === e.toLowerCase())),
          heading: stage === 'raised' ? 'Service Request Raised' : 'Service Request Sent Back for Approval',
          lead: `Your service request <b>${escHtml(s.id)}</b> is with <b>${escHtml(s.approver_name)}</b> for approval. You will be mailed once they decide.`,
          subject: `${stage === 'raised' ? 'Raised' : 'Updated'}: ${s.id} ${s.service_type} — with ${s.approver_name} for approval`,
        };
      } else if (stage === 'comment') {
        to = doer; cc = approver; colour = '#d97706';
        heading = 'Service Request — Comment from Approver';
        lead = `<b>${escHtml(s.approver_name)}</b> has commented on your service request <b>${escHtml(s.id)}</b>. Please update it in the ERP and send it back for approval.`;
        subject = `Comment on ${s.id} ${s.service_type} — please update`;
      } else if (stage === 'approved') {
        to = doer; cc = approver; colour = '#16a34a';
        heading = 'Service Request Approved';
        lead = `<b>${escHtml(s.approver_name)}</b> has approved your service request <b>${escHtml(s.id)}</b>. Next: choose the vendor (add the vendor's details if it is a new one) and send it to Accounts from the ERP.`;
        subject = `Approved: ${s.id} ${s.service_type} — add vendor & send to Accounts`;
      } else if (stage === 'rejected') {
        to = doer; cc = approver; colour = '#dc2626';
        heading = 'Service Request Rejected';
        lead = `<b>${escHtml(s.approver_name)}</b> has rejected your service request <b>${escHtml(s.id)}</b>.`;
        subject = `Rejected: ${s.id} ${s.service_type}`;
      } else if (stage === 'accounts') {
        to = uniqMail([...(await addressesOf(cfg.accounts)), ...cfg.accountsEmails]); cc = [...approver, ...doer];
        heading = 'Service Request — Payment Required';
        lead = `Service request <b>${escHtml(s.id)}</b>, approved by <b>${escHtml(s.approver_name)}</b>, has been sent to Accounts for payment. The quotation is attached. Please record the payment in the ERP once it is made.`;
        subject = `Payment required: ${s.id} ${s.service_type} — ${s.vendor_name}${s.payment_date ? ' by ' + fmtDate(s.payment_date) : ''}`;
        if (vendor) {
          extra = [
            ['Vendor Contact', escHtml([vendor.contact_person, vendor.phone, vendor.email].filter(Boolean).join(' · '))],
            ['GSTIN / PAN', escHtml([vendor.gstin, vendor.pan].filter(Boolean).join(' / '))],
            ['Bank', escHtml([vendor.account_holder, vendor.bank_name, vendor.account_no && 'A/c ' + vendor.account_no, vendor.ifsc && 'IFSC ' + vendor.ifsc].filter(Boolean).join(' · '))],
          ];
        }
        attachments = await quotationFiles(s.id);
      } else if (stage === 'paid') {
        to = uniqMail([...approver, ...doer]); colour = '#16a34a';
        heading = 'Service Request Paid';
        lead = `Accounts has paid service request <b>${escHtml(s.id)}</b> (${escHtml(s.service_type)} — ${escHtml(s.vendor_name)}).`;
        subject = `Paid: ${s.id} ${s.service_type} — ${s.vendor_name}`;
        extra = [
          ['Paid On', fmtDate(s.paid_date)], ['Amount Paid', s.paid_amount != null ? inr(s.paid_amount) : ''],
          ['Mode', escHtml(s.paid_mode)], ['Reference / UTR', escHtml(s.paid_reference)], ['Paid By', escHtml(s.paid_by)],
        ];
      } else return;
      to = uniqMail(to);
      cc = uniqMail(cc).filter((e) => !to.some((t) => t.toLowerCase() === e.toLowerCase()));
      if (!to.length && cc.length) to.push(cc.shift());
      // No approver address on file: the doer still hears, without buttons.
      if (copy && !to.length) { ({ to, heading, lead, subject } = copy); copy = null; actions = ''; attachments = []; }
      if (!mailer || !to.length) {
        console.log('[sms] mail not sent —', stage, s.id, '| mailer:', !!mailer, '| to:', to.join(', ') || '(none)');
        return;
      }
      const rows = [...requestRows(s), ...extra, ...noteRow];
      await mailer.sendMail({
        from: `"Service Management" <${process.env.SMTP_USER}>`,
        to: to.join(', '), ...(cc.length ? { cc: cc.join(', ') } : {}),
        subject,
        html: mailHtml({ heading, colour, lead, rows, link: pageLink(), actions }),
        ...(attachments.length ? { attachments } : {}),
      });
      console.log('[sms]', stage, s.id, 'mailed to', to.join(', '), cc.length ? '| cc: ' + cc.join(', ') : '');
      if (copy?.to.length) {
        await mailer.sendMail({
          from: `"Service Management" <${process.env.SMTP_USER}>`,
          to: uniqMail(copy.to).join(', '),
          subject: copy.subject,
          html: mailHtml({ heading: copy.heading, colour: '#64748b', lead: copy.lead, rows, link: pageLink() }),
        });
        console.log('[sms]', stage, s.id, 'copy (no buttons) mailed to', copy.to.join(', '));
      }
    })().catch((e) => console.error('[sms] mail', stage, s.id, '—', e.message));
  }

  async function fresh(id) {
    const vendors = await vendorMap();
    return reqOut((await q('SELECT * FROM sms_requests WHERE id = $1', [id]))[0], vendors);
  }

  /* ── Reads ─────────────────────────────────────────────────────── */

  // Just what the raise form needs — also used by the dashboard button.
  app.get('/api/amc/meta', requireAuth, route(null, async (req) => {
    const { cfg } = req.sms;
    const byId = new Map(cfg.users.map((u) => [u.id, u]));
    return {
      lists: { SERVICE_TYPES, FREQUENCIES, PRIORITIES, PAY_MODES, STATUSES },
      departments: cfg.departments,
      approvers: cfg.approvers.map((id) => byId.get(id)).filter(Boolean)
        .map((u) => ({ id: u.id, name: u.name, department: u.department || '' })),
    };
  }));

  app.get('/api/amc/data', requireAuth, route(null, async (req) => {
    const me = req.sms;
    const vendors = await vendorMap();
    const rows = await q('SELECT * FROM sms_requests ORDER BY created_at DESC, id DESC');
    const requests = rows.map((r) => reqOut(r, vendors)).filter((s) => visible(s, me))
      .map((s) => ({ ...s, can: rights(s, me) }));
    const byId = new Map(me.cfg.users.map((u) => [u.id, u]));
    const out = {
      today: today(),
      me: { id: me.user.id, name: me.user.name, admin: me.admin, approver: me.approver, accounts: me.accounts },
      requests,
      // The vendor picker on "send to Accounts": bank details only for the
      // people who handle payments.
      vendors: [...vendors.values()].map(vendorOut).map((v) => (me.admin || me.accounts ? v : {
        id: v.id, name: v.name, contact_person: v.contact_person, phone: v.phone, active: v.active,
      })),
      lists: { SERVICE_TYPES, FREQUENCIES, PRIORITIES, PAY_MODES, STATUSES },
      departments: me.cfg.departments,
      approvers: me.cfg.approvers.map((id) => byId.get(id)).filter(Boolean).map((u) => ({ id: u.id, name: u.name, department: u.department || '' })),
    };
    if (me.admin) {
      out.settings = {
        approvers: me.cfg.approvers, accounts: me.cfg.accounts, accountsEmails: me.cfg.accountsEmails,
        approversSet: me.cfg.approversSet, accountsSet: me.cfg.accountsSet,
      };
      out.users = me.cfg.users.map((u) => ({ id: u.id, name: u.name, department: u.department || '' }));
    }
    return out;
  }));

  app.get('/api/amc/requests/:id', requireAuth, route(null, async (req) => {
    const { s, vendors } = await loadReq(req);
    const log = (await q('SELECT * FROM sms_request_log WHERE request_id = $1 ORDER BY id', [s.id]))
      .map((n) => ({ action: n.action, note: n.note || '', by: n.by_name || '', at: tsOut(n.created_at) }));
    const v = s.vendor_id ? vendors.get(s.vendor_id) : null;
    const showBank = req.sms.admin || req.sms.accounts || s.raised_by_id === req.sms.user.id;
    return { request: { ...s, can: rights(s, req.sms) }, log, vendor: v ? (showBank ? vendorOut(v) : { id: v.id, name: v.name }) : null };
  }));

  app.get('/api/amc/requests/:id/documents/:n', requireAuth, route(null, async (req, res) => {
    const { row } = await loadReq(req);
    const doc = parseDocs(row.documents)[parseInt(req.params.n, 10)];
    if (!doc || !doc.file) throw new UserError('Document not found', 404);
    const abs = path.join(UPLOAD_ROOT, row.id, path.basename(doc.file));
    res.download(abs, doc.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'The file is missing on the server — please upload it again' });
    });
  }));

  /* ── Raise / update ────────────────────────────────────────────── */

  async function fieldsFromBody(b, me) {
    const f = {
      service_type: SERVICE_TYPES.includes(b.service_type) ? b.service_type : bad('Choose the type of service'),
      frequency: FREQUENCIES.includes(b.frequency) ? b.frequency : bad('Choose the frequency of service'),
      department: str(b.department, 128) || bad('Choose the department'),
      priority: PRIORITIES.includes(b.priority) ? b.priority : bad('Choose the priority'),
      payment_date: dateIn(b.payment_date, 'Payment date', { required: true }),
      remarks: str(b.remarks, 4000),
      approver_id: str(b.approver_id, 16) || bad('Choose the approver'),
    };
    if (!me.cfg.approvers.includes(f.approver_id)) bad('That person is not on the management team — pick an approver from the list');
    f.approver_name = me.cfg.users.find((u) => u.id === f.approver_id)?.name || '';
    // A department typed in through "+ Add new" joins the list for everyone.
    const known = me.cfg.departments.some((d) => d.toLowerCase() === f.department.toLowerCase());
    if (!known) await writeCfg('departments', [...me.cfg.departments, f.department]);
    else f.department = me.cfg.departments.find((d) => d.toLowerCase() === f.department.toLowerCase());
    return f;
  }

  app.post('/api/amc/requests', requireAuth, route(null, async (req) => {
    const me = req.sms;
    const b = req.body || {};
    const f = await fieldsFromBody(b, me);
    const docs = decodeDocs(b.documents, 0, { pdfOnly: true });
    if (!docs.length) bad('Attach the quotation PDF');
    const id = await withSeqId('sms_requests', 'SR', 5, (newId) => q(
      `INSERT INTO sms_requests (id, service_type, frequency, department, priority, payment_date, remarks, status,
         raised_by_id, raised_by_name, approver_id, approver_name, documents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[]')`,
      [newId, f.service_type, f.frequency, f.department, f.priority, f.payment_date, f.remarks, S.PENDING,
        me.user.id, me.by, f.approver_id, f.approver_name]));
    const stored = await writeDocs(id, docs, me.by, 'quotation');
    await q('UPDATE sms_requests SET documents = $1 WHERE id = $2', [JSON.stringify(stored), id]);
    await logStep(id, 'Raised', `Sent to ${f.approver_name} for approval`, me);
    notify(await fresh(id), 'raised');
    return { id };
  }));

  // The doer answers an approver's comment: edits the request, may add a
  // newer quotation, and it goes back to the (possibly changed) approver.
  app.patch('/api/amc/requests/:id', requireAuth, route(null, async (req) => {
    const { s, row } = await loadReq(req);
    if (!rights(s, req.sms).update) bad(s.status === S.QUERY ? 'Only the person who raised it can update it' : `It is ${s.status} — it can be updated only after the approver comments`);
    const b = req.body || {};
    const f = await fieldsFromBody(b, req.sms);
    const existing = parseDocs(row.documents);
    const docs = decodeDocs(b.documents, existing.length, { pdfOnly: true });
    const stored = await writeDocs(s.id, docs, req.sms.by, 'quotation');
    const reply = str(b.reply, 4000);
    if (!reply) bad('Write a reply to the approver’s comment');
    await q(`UPDATE sms_requests SET service_type=$1, frequency=$2, department=$3, priority=$4, payment_date=$5, remarks=$6,
               approver_id=$7, approver_name=$8, documents=$9, status=$10, updated_at=NOW() WHERE id=$11`,
      [f.service_type, f.frequency, f.department, f.priority, f.payment_date, f.remarks, f.approver_id, f.approver_name,
        JSON.stringify([...existing, ...stored]), S.PENDING, s.id]);
    await logStep(s.id, 'Updated', reply + (stored.length ? `\nAttached: ${stored.map((d) => d.name).join(', ')}` : ''), req.sms);
    notify(await fresh(s.id), 'resubmitted', { note: reply });
    return { ok: true };
  }));

  /* ── Approver: approve / reject / comment ──────────────────────── */

  app.post('/api/amc/requests/:id/decision', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req);
    if (!rights(s, req.sms).decide) bad(s.status === S.PENDING ? `Only ${s.approver_name || 'the chosen approver'} can decide this request` : `It is already ${s.status}`);
    const b = req.body || {};
    await decide(s, b.action, str(b.note, 4000), req.sms);
    return { ok: true };
  }));

  // One decision, from the app or from the mail (actor = { user: { id }, by }).
  async function decide(s, action, note, actor) {
    const next = { approve: S.APPROVED, reject: S.REJECTED, comment: S.QUERY }[action];
    if (!next) bad('Choose approve, reject or comment');
    if (action !== 'approve' && !note) bad(action === 'reject' ? 'Give the reason for rejecting' : 'Write your comment');
    // Conditional on the status so a double click cannot decide it twice.
    const r = await pool.query(`UPDATE sms_requests SET status=$1, decided_at=NOW(), updated_at=NOW() WHERE id=$2 AND status=$3`, [next, s.id, S.PENDING]);
    if (!r.rowCount) bad('This request was just decided — reload');
    await logStep(s.id, { approve: 'Approved', reject: 'Rejected', comment: 'Comment' }[action], note, actor);
    notify(await fresh(s.id), { approve: 'approved', reject: 'rejected', comment: 'comment' }[action], { note });
  }

  /* ── Deciding from the approver's mail ─────────────────────────────
     Outside requireAuth, like /leave-action in server.js: the signed token
     (request + decision + the approver's address) IS the authorisation.
     GET only shows a confirm page — mail scanners follow links — and the
     POST from that page decides. A token stops working once the request is
     decided or has moved to a different approver. */
  const ACTION_WORD = { approve: 'Approve', comment: 'Comment on', reject: 'Reject' };

  async function forToken(token) {
    const claim = readToken(token);
    if (!claim || !claim.id.startsWith(TOKEN_NS) || !ACTION_WORD[claim.decision]) {
      return { error: 'This link is not valid. Open Service Management in the ERP instead.' };
    }
    const row = (await q('SELECT * FROM sms_requests WHERE id = $1', [claim.id.slice(TOKEN_NS.length)]))[0];
    if (!row) return { error: 'That service request no longer exists.' };
    const s = reqOut(row, await vendorMap());
    if (s.status !== S.PENDING) return { done: s };
    const current = (await addressesOf([s.approver_id]))[0] || '';
    if (current.toLowerCase() !== String(claim.email || '').toLowerCase()) {
      return { error: `This request is now with ${s.approver_name || 'another approver'} — this link belonged to an earlier mail.` };
    }
    return { claim, s };
  }

  const pageRows = (s) => [
    ['Request ID', s.id], ['Type of Service', s.service_type], ['Frequency', s.frequency], ['Department', s.department],
    ['Priority', s.priority], ['Payment Date', fmtDate(s.payment_date)], ['Raised By', s.raised_by_name], ['Remarks', s.remarks],
  ];
  const donePage = (s) => actionPage({
    title: 'Already decided', tone: 'plain',
    lead: `Service request <b>${escHtml(s.id)}</b> is already <b>${escHtml(s.status)}</b>. Nothing more to do here.`,
    rows: pageRows(s), note: `<a href="${escHtml(pageLink())}">Open Service Management</a>`,
  });
  const failPage = (lead) => actionPage({ title: 'Link not usable', tone: 'bad', lead: escHtml(lead) });

  function formPage(s, action, token, error = '', note = '') {
    const tone = action === 'approve' ? 'good' : action === 'reject' ? 'bad' : 'plain';
    const email = readToken(token).email;
    const others = Object.keys(ACTION_WORD).filter((a) => a !== action)
      .map((a) => `<a href="/sms-action?t=${encodeURIComponent(tokenFor(TOKEN_NS + s.id, a, email))}">${a === 'comment' ? 'Comment' : ACTION_WORD[a]} instead</a>`).join(' · ');
    const placeholder = action === 'approve' ? 'Note (optional)' : action === 'reject' ? 'Reason for rejecting (required)' : 'Your comment (required)';
    return actionPage({
      title: `${ACTION_WORD[action]} ${s.id}?`, tone,
      lead: `<b>${escHtml(s.raised_by_name)}</b> raised this service request and chose you as the approver.`
        + (action === 'comment' ? ' Your comment goes back to them to update and send again.' : ''),
      rows: pageRows(s),
      form: `<form method="POST" action="/sms-action">
          <input type="hidden" name="t" value="${escHtml(token)}">
          ${error ? `<p style="color:#dc2626;font-weight:600;">${escHtml(error)}</p>` : ''}
          <textarea name="note" rows="3" placeholder="${placeholder}"
            style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font:inherit;font-size:14px;margin:0 0 14px;">${escHtml(note)}</textarea>
          <button type="submit">${action === 'comment' ? 'Send comment' : `Yes, ${action} it`}</button>
        </form>`,
      note: `${others}<br>The quotation is attached to the mail · <a href="${escHtml(pageLink())}">Open in the ERP</a>`,
    });
  }

  app.get('/sms-action', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send(failPage('Service Management needs the database.'));
      await ensureSchema();
      const r = await forToken(req.query.t);
      if (r.error) return res.status(400).send(failPage(r.error));
      if (r.done) return res.send(donePage(r.done));
      res.send(formPage(r.s, r.claim.decision, String(req.query.t)));
    } catch (e) {
      res.status(500).send(actionPage({ title: 'Something went wrong', tone: 'bad', lead: escHtml(e.message) }));
    }
  });

  app.post('/sms-action', async (req, res) => {
    const token = String(req.body?.t || '');
    const note = str(req.body?.note, 4000);
    try {
      if (!useDb) return res.status(503).send(failPage('Service Management needs the database.'));
      await ensureSchema();
      const r = await forToken(token);
      if (r.error) return res.status(400).send(failPage(r.error));
      if (r.done) return res.send(donePage(r.done));
      const { s, claim } = r;
      try {
        await decide(s, claim.decision, note, { user: { id: s.approver_id }, by: s.approver_name || claim.email });
      } catch (e) {
        if (e instanceof UserError) return res.status(400).send(formPage(s, claim.decision, token, e.message, note));
        throw e;
      }
      const after = await fresh(s.id);
      res.send(actionPage({
        title: { approve: 'Approved', reject: 'Rejected', comment: 'Comment sent' }[claim.decision],
        tone: claim.decision === 'reject' ? 'bad' : 'good',
        lead: `Service request <b>${escHtml(s.id)}</b> is now <b>${escHtml(after.status)}</b>. ${escHtml(s.raised_by_name)} has been emailed.`,
        rows: pageRows(after), note: 'You can close this tab.',
      }));
    } catch (e) {
      res.status(500).send(actionPage({ title: 'Could not record the decision', tone: 'bad', lead: escHtml(e.message) }));
    }
  });

  /* ── Doer: vendor + send to Accounts ───────────────────────────── */

  function vendorFromBody(b) {
    const v = {
      name: str(b.name), contact_person: str(b.contact_person), phone: str(b.phone, 64),
      email: str(b.email), address: str(b.address, 2000), gstin: str(b.gstin, 32).toUpperCase(), pan: str(b.pan, 16).toUpperCase(),
      bank_name: str(b.bank_name), account_holder: str(b.account_holder), account_no: str(b.account_no, 64).replace(/\s+/g, ''),
      ifsc: str(b.ifsc, 16).toUpperCase(), services: str(b.services, 500), notes: str(b.notes, 4000),
      active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
    };
    if (!v.name) bad('Vendor name is required');
    if (v.email && !v.email.split(/[,;\s]+/).filter(Boolean).every((e) => EMAIL_RE.test(e))) bad('Vendor email is not a valid address');
    if (v.phone && !/^[0-9+\-()\s/,]{6,64}$/.test(v.phone)) bad('Phone number has invalid characters');
    if (v.gstin && !/^[0-9A-Z]{15}$/.test(v.gstin)) bad('GSTIN must be 15 letters/digits');
    if (v.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.pan)) bad('PAN must look like ABCDE1234F');
    if (v.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.ifsc)) bad('IFSC must look like HDFC0001234');
    if (v.account_no && !/^[0-9A-Z]{6,34}$/i.test(v.account_no)) bad('Bank account number looks wrong');
    return v;
  }

  async function createVendor(v, by) {
    const dup = await q('SELECT id FROM amc_vendors WHERE LOWER(name) = LOWER($1)', [v.name]);
    if (dup.length) bad(`A vendor named "${v.name}" already exists (${dup[0].id}) — pick it from the list instead`);
    return withSeqId('amc_vendors', 'VND', 4, (newId) => q(
      `INSERT INTO amc_vendors (id, name, contact_person, phone, email, address, gstin, pan, bank_name, account_holder, account_no, ifsc, services, active, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [newId, v.name, v.contact_person, v.phone, v.email, v.address, v.gstin, v.pan, v.bank_name, v.account_holder, v.account_no, v.ifsc,
        v.services, v.active, v.notes, by]));
  }

  app.post('/api/amc/requests/:id/send-to-accounts', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req);
    if (!rights(s, req.sms).send) bad(s.status === S.APPROVED ? 'Only the person who raised it can send it to Accounts' : `It is ${s.status} — only an approved request goes to Accounts`);
    const b = req.body || {};
    let vendorId = str(b.vendor_id, 16);
    let isNew = false;
    if (b.new_vendor) {
      vendorId = await createVendor(vendorFromBody(b.new_vendor), req.sms.by);
      isNew = true;
    } else if (!vendorId) bad('Choose the vendor, or add the new vendor’s details');
    const vendor = (await q('SELECT * FROM amc_vendors WHERE id = $1', [vendorId]))[0];
    if (!vendor) bad('That vendor no longer exists');
    const note = str(b.note, 4000);
    const r = await pool.query(`UPDATE sms_requests SET vendor_id=$1, status=$2, sent_to_accounts_at=NOW(), updated_at=NOW() WHERE id=$3 AND status=$4`,
      [vendorId, S.ACCOUNTS, s.id, S.APPROVED]);
    if (!r.rowCount) bad('This request was just sent — reload');
    await logStep(s.id, 'Sent to Accounts', `Vendor: ${vendor.name}${isNew ? ' (new vendor added)' : ''}${note ? '\n' + note : ''}`, req.sms);
    notify(await fresh(s.id), 'accounts', { note, vendor: vendorOut(vendor) });
    return { ok: true, vendor_id: vendorId };
  }));

  /* ── Accounts: record the payment ──────────────────────────────── */

  app.post('/api/amc/requests/:id/paid', requireAuth, route(null, async (req) => {
    const { s, row } = await loadReq(req);
    if (!rights(s, req.sms).pay) bad(s.status === S.ACCOUNTS ? 'Only Accounts can record the payment' : `It is ${s.status} — only a request sent to Accounts can be paid`);
    const b = req.body || {};
    const paidDate = dateIn(b.paid_date, 'Payment date', { required: true });
    if (paidDate > today()) bad('Payment date cannot be in the future');
    const amount = money(b.amount);
    if (!(amount > 0)) bad('Enter the amount paid');
    const mode = PAY_MODES.includes(b.mode) ? b.mode : bad('Choose the payment mode');
    const reference = str(b.reference, 128);
    const note = str(b.note, 4000);
    const existing = parseDocs(row.documents);
    const stored = await writeDocs(s.id, decodeDocs(b.documents, existing.length), req.sms.by, 'payment');
    const r = await pool.query(`UPDATE sms_requests SET status=$1, paid_date=$2, paid_amount=$3, paid_mode=$4, paid_reference=$5, paid_by=$6,
               paid_at=NOW(), documents=$7, updated_at=NOW() WHERE id=$8 AND status=$9`,
      [S.PAID, paidDate, amount, mode, reference, req.sms.by, JSON.stringify([...existing, ...stored]), s.id, S.ACCOUNTS]);
    if (!r.rowCount) bad('This request was just marked paid — reload');
    await logStep(s.id, 'Paid', `${inr(amount)} on ${fmtDate(paidDate)} · ${mode}${reference ? ' · Ref ' + reference : ''}${note ? '\n' + note : ''}`, req.sms);
    notify(await fresh(s.id), 'paid', { note });
    return { ok: true };
  }));

  app.delete('/api/amc/requests/:id', requireAuth, route('admin', async (req) => {
    const { s } = await loadReq(req);
    await q('DELETE FROM sms_request_log WHERE request_id = $1', [s.id]);
    await q('DELETE FROM sms_requests WHERE id = $1', [s.id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, s.id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }));

  /* ── Vendor master (admin) ─────────────────────────────────────── */

  app.post('/api/amc/vendors', requireAuth, route('admin', async (req) => {
    const id = await createVendor(vendorFromBody(req.body || {}), req.sms.by);
    return { id };
  }));

  app.patch('/api/amc/vendors/:id', requireAuth, route('admin', async (req) => {
    const before = (await q('SELECT id FROM amc_vendors WHERE id = $1', [req.params.id]))[0];
    if (!before) throw new UserError('Vendor not found', 404);
    const v = vendorFromBody(req.body || {});
    const dup = await q('SELECT id FROM amc_vendors WHERE LOWER(name) = LOWER($1) AND id <> $2', [v.name, before.id]);
    if (dup.length) bad(`Another vendor is already named "${v.name}" (${dup[0].id})`);
    await q(`UPDATE amc_vendors SET name=$1, contact_person=$2, phone=$3, email=$4, address=$5, gstin=$6, pan=$7, bank_name=$8,
               account_holder=$9, account_no=$10, ifsc=$11, services=$12, active=$13, notes=$14, updated_at=NOW() WHERE id=$15`,
      [v.name, v.contact_person, v.phone, v.email, v.address, v.gstin, v.pan, v.bank_name, v.account_holder, v.account_no, v.ifsc,
        v.services, v.active, v.notes, before.id]);
    return { ok: true };
  }));

  app.delete('/api/amc/vendors/:id', requireAuth, route('admin', async (req) => {
    const used = await q('SELECT COUNT(*) AS n FROM sms_requests WHERE vendor_id = $1', [req.params.id]);
    if (Number(used[0].n)) bad('This vendor is used by service requests — mark it Inactive instead');
    await q('DELETE FROM amc_vendors WHERE id = $1', [req.params.id]);
    return { ok: true };
  }));

  /* ── Settings (admin) ──────────────────────────────────────────── */

  app.post('/api/amc/settings', requireAuth, route('admin', async (req) => {
    const b = req.body || {};
    const live = new Set(req.sms.cfg.users.map((u) => u.id));
    const ids = (list, label) => {
      if (!Array.isArray(list)) bad(`${label}: send a list`);
      return [...new Set(list.map(String).filter((id) => live.has(id)))];
    };
    if (b.approvers !== undefined) {
      const a = ids(b.approvers, 'Management team');
      if (!a.length) bad('Pick at least one approver for the management team');
      await writeCfg('approvers', a);
    }
    if (b.accounts !== undefined) await writeCfg('accounts', ids(b.accounts, 'Accounts team'));
    if (b.accountsEmails !== undefined) {
      const list = (Array.isArray(b.accountsEmails) ? b.accountsEmails : []).map((e) => str(e).toLowerCase()).filter(Boolean);
      const wrong = list.find((e) => !EMAIL_RE.test(e));
      if (wrong) bad(`"${wrong}" is not a valid email address`);
      await writeCfg('accountsEmails', [...new Set(list)].slice(0, 30));
    }
    if (b.departments !== undefined) {
      const list = [...new Set((Array.isArray(b.departments) ? b.departments : []).map((d) => str(d, 128)).filter(Boolean))];
      if (!list.length) bad('Keep at least one department');
      await writeCfg('departments', list);
    }
    return { ok: true };
  }));

  app.post('/api/amc/test-mail', requireAuth, route('admin', async (req) => {
    const mailer = getMailer();
    if (!mailer) bad('SMTP is not configured on this server (SMTP_USER / SMTP_PASS)');
    const cfg = req.sms.cfg;
    const to = uniqMail([...(await addressesOf(cfg.accounts)), ...cfg.accountsEmails]);
    if (!to.length) bad('Nobody is on the Accounts team yet — save it first');
    await mailer.sendMail({
      from: `"Service Management" <${process.env.SMTP_USER}>`, to: to.join(', '),
      subject: 'Service Management — test mail',
      html: mailHtml({ heading: 'Test mail', lead: 'If you can read this, service requests sent to Accounts will reach you.', rows: [['Sent by', escHtml(req.sms.by)], ['Server time', new Date().toISOString()]] }),
    });
    return { to: to.join(', ') };
  }));

  return {};
}

module.exports = { AMC_SCHEMA, mountAmc };
