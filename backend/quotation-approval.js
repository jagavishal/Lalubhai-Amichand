'use strict';
/* =====================================================================
   Quotation & Payment Approval (route 'quotation-approval', Admin Section)
   ---------------------------------------------------------------------
   Built from the MIS requirement note "Quotation & Payment Approval
   Dashboard" (Oct 2026). One purchase walks through:

     Admin submits 3 vendor quotations (amount, GST, total, attachments),
       urgency Urgent / Medium and the payment type
         └─► Pending Director Approval
     A Director compares them and approves ONE (or rejects all)
         ├─► Rejected (final)
         └─► Approved – Pending Forwarding      (mail to the Admin)
     The Admin reviews the payment terms and clicks Forward to Accounts
         └─► Pending Payment                    (mail to Accounts)
     Accounts records each payment (date, amount, mode, reference)
         ├─► Advance Paid / Part Paid           (balance still due)
         └─► Payment Completed                  (balance nil)

   Who is who:
   - Admins: anyone who can open the page — Admin/HOD by default, anyone
     else ticked under Users → Access (canOpenPage in server.js). They
     submit and forward, and see every request.
   - Directors: app_config qa_directors (default: Saloni Anchan and Sajil
     Shah, the two directors the urgent-payment mail already names, else
     every Admin). Each gets their own mail with one Approve button per
     quotation + Reject, bound to their address (/qa-action) — so they can
     decide without logging in. In the app they see every request.
   - Accounts: app_config qa_accounts (users) + qa_accounts_emails (default
     accounts@laltd.in). Mailed on forwarding; in the app they see requests
     from Pending Payment on and record payments.

   Attachments are written to uploads/quotation-approval/<id>/ (git-ignored
   like the other upload folders) and listed in the row's `documents` JSON;
   downloads go through the authenticated route by index. Every step is in
   qa_log, every payment in qa_payments — the "complete approval / payment
   history" the note asks for.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'quotation-approval');

// utf8mb4_unicode_ci outright — that is what `users` is forced to, and a
// table on the server default fails JOINs against it.
const QA_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS qa_requests (
     id VARCHAR(16) PRIMARY KEY,
     title VARCHAR(255) NOT NULL,
     department VARCHAR(128) NOT NULL DEFAULT '',
     urgency VARCHAR(16) NOT NULL DEFAULT 'Medium',
     payment_type VARCHAR(16) NOT NULL DEFAULT 'Full',
     advance_amount DECIMAL(14,2) DEFAULT NULL,
     schedule TEXT,
     remarks TEXT,
     quotes TEXT,
     documents TEXT,
     status VARCHAR(40) NOT NULL DEFAULT 'Pending Director Approval',
     approved_index TINYINT DEFAULT NULL,
     approved_vendor VARCHAR(255) DEFAULT '',
     approved_amount DECIMAL(14,2) DEFAULT NULL,
     director_remarks TEXT,
     decided_by_id VARCHAR(16) DEFAULT NULL,
     decided_by_name VARCHAR(255) DEFAULT '',
     decided_at DATETIME DEFAULT NULL,
     forwarded_by VARCHAR(255) DEFAULT '',
     forwarded_at DATETIME DEFAULT NULL,
     forward_note TEXT,
     paid_total DECIMAL(14,2) NOT NULL DEFAULT 0,
     submitted_by_id VARCHAR(16) DEFAULT NULL,
     submitted_by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_qa_status ON qa_requests (status)`,
  `CREATE TABLE IF NOT EXISTS qa_payments (
     id INT AUTO_INCREMENT PRIMARY KEY,
     request_id VARCHAR(16) NOT NULL,
     pay_key VARCHAR(16) NOT NULL DEFAULT '',
     paid_date DATE NOT NULL,
     amount DECIMAL(14,2) NOT NULL,
     mode VARCHAR(32) DEFAULT '',
     reference VARCHAR(128) DEFAULT '',
     note TEXT,
     by_id VARCHAR(16) DEFAULT NULL,
     by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_qa_pay_req ON qa_payments (request_id)`,
  `CREATE TABLE IF NOT EXISTS qa_log (
     id INT AUTO_INCREMENT PRIMARY KEY,
     request_id VARCHAR(16) NOT NULL,
     action VARCHAR(40) NOT NULL,
     note TEXT,
     by_id VARCHAR(16) DEFAULT NULL,
     by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_qa_log_req ON qa_log (request_id)`,
];

const QUOTES = 3;                                   // "uploads 3 vendor quotations"
const URGENCIES = ['Urgent', 'Medium'];
const PAY_TYPES = ['Advance', 'Part', 'Full'];      // shown as "… Payment"
const PAY_MODES = ['NEFT / RTGS', 'IMPS / UPI', 'Cheque', 'Cash', 'Other'];
const S = {
  PENDING: 'Pending Director Approval',
  REJECTED: 'Rejected',
  APPROVED: 'Approved – Pending Forwarding',
  PAYMENT: 'Pending Payment',
  ADVANCE: 'Advance Paid',
  PART: 'Part Paid',
  DONE: 'Payment Completed',
};
const STATUSES = Object.values(S);
const PAYABLE = [S.PAYMENT, S.ADVANCE, S.PART];
const TOKEN_NS = 'qa:';
const CFG = { directors: 'qa_directors', accounts: 'qa_accounts', accountsEmails: 'qa_accounts_emails' };
const DEFAULT_DIRECTORS = ['Saloni Anchan', 'Sajil Shah'];
const DEFAULT_ACCOUNTS_EMAILS = ['accounts@laltd.in'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_TYPES = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const DOC_PER_QUOTE = 3;
const DOC_BYTES = 4 * 1024 * 1024;
const DOC_TOTAL = 8 * 1024 * 1024;   // express.json caps the body at 10mb of base64
const MAIL_ATTACH_MAX = 15 * 1024 * 1024;

/* ── Small helpers ─────────────────────────────────────────────────── */

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg) => { throw new UserError(msg); };
const str = (v, max = 255) => String(v ?? '').trim().slice(0, max);
const round2 = (n) => Math.round(n * 100) / 100;
function money(v, label, { required = true } = {}) {
  if (v === '' || v == null) { if (required) bad(`${label} is required`); return 0; }
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) bad(`${label} must be a positive number`);
  return round2(n);
}
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
const parseJson = (raw, dflt) => { try { const d = typeof raw === 'string' ? JSON.parse(raw) : raw; return d ?? dflt; } catch { return dflt; } };
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const payTypeLabel = (t) => `${t} Payment`;

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m || !m[2]) return null;
  return { mimeType: (m[1] || '').toLowerCase(), buffer: Buffer.from(m[3], 'base64') };
}

// Validate files before anything is stored, so one bad file rejects the
// whole submission rather than leaving it half-saved.
function decodeFiles(list, label, budget) {
  if (!Array.isArray(list) || !list.length) return [];
  return list.map((d, i) => {
    const name = String(d?.name || `document-${i + 1}`).replace(/[\\/]+/g, '_').slice(0, 120);
    const parsed = parseDataUrl(d?.dataUrl);
    if (!parsed) bad(`${label}: could not read "${name}"`);
    const ext = DOC_TYPES[parsed.mimeType];
    if (!ext) bad(`${label}: "${name}" — only PDF, images, Excel and Word files are accepted`);
    if (parsed.buffer.length > DOC_BYTES) bad(`${label}: "${name}" is over 4 MB`);
    budget.total += parsed.buffer.length;
    if (budget.total > DOC_TOTAL) bad('Attachments together must be under 8 MB');
    const safe = name.replace(/[^\w.\- ()]/g, '_').replace(/\.[^.]*$/, '') || 'document';
    return { name, safe, ext, size: parsed.buffer.length, type: parsed.mimeType, buffer: parsed.buffer };
  });
}

// File names carry a timestamp so a later upload never overwrites.
async function writeFiles(id, files, meta) {
  if (!files.length) return [];
  const dir = path.join(UPLOAD_ROOT, id);
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = Date.now().toString(36);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const file = `${stamp}-${meta.kind}${meta.q ?? ''}-${i + 1}-${f.safe}.${f.ext}`;
    await fs.promises.writeFile(path.join(dir, file), f.buffer);
    out.push({ name: f.name, file, size: f.size, type: f.type, ...meta, at: new Date().toISOString() });
  }
  return out;
}

/* ── Mail shell ────────────────────────────────────────────────────── */

function mailHtml({ heading, colour = '#0150AA', lead, rows = [], extraHtml = '', actions = '', footer, link }) {
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
      ${link ? `<p><a href="${escHtml(link)}" style="display:inline-block;background:#0150AA;color:#fff;padding:9px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open in ERP</a></p>` : ''}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">This is an automated notification from the Lallubhai Amichand ERP — Quotation &amp; Payment Approval.</p>
    </div>`;
}

// Coloured table cells around padded links — renders alike in Outlook, Gmail and Apple Mail.
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

// The three quotations side by side; the lowest total is marked L1 and the
// approved one (once there is one) is highlighted.
function quotesTableHtml(r) {
  const totals = r.quotes.map((x) => x.total);
  const low = Math.min(...totals);
  const head = ['#', 'Vendor', 'Amount', 'GST', 'Total'].map((h) => `<th style="padding:7px;background:#f1f5f9;text-align:left;font-size:12px;color:#334155">${h}</th>`).join('');
  const rows = r.quotes.map((x, i) => {
    const on = r.approved_index === i;
    return `<tr style="${on ? 'background:#f0fdf4' : ''}">
      <td style="padding:7px;border-bottom:1px solid #eef2f7">${i + 1}</td>
      <td style="padding:7px;border-bottom:1px solid #eef2f7"><b>${escHtml(x.vendor)}</b>${x.total === low ? ' <span style="color:#16a34a;font-size:11px;font-weight:bold">L1</span>' : ''}${on ? ' <span style="color:#16a34a;font-size:11px;font-weight:bold">✔ APPROVED</span>' : ''}</td>
      <td style="padding:7px;border-bottom:1px solid #eef2f7">${inr(x.amount)}</td>
      <td style="padding:7px;border-bottom:1px solid #eef2f7">${inr(x.gst)}</td>
      <td style="padding:7px;border-bottom:1px solid #eef2f7"><b>${inr(x.total)}</b></td></tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:13px;border:1px solid #e2e8f0">${'<tr>' + head + '</tr>'}${rows}</table>`;
}

/* ===================================================================== */

function mountQuotationApproval(app, ctx) {
  const {
    q, pool, ensureSchema, requireAuth, withSeqId, getMailer, notifyAddressFor,
    istToday, appOrigin, useDb, tokenFor, readToken, actionPage, canOpenPage, isAdminUser,
  } = ctx;

  const today = () => istToday().iso;
  const pageLink = () => `${appOrigin}/#quotation-approval`;

  /* ── Settings ──────────────────────────────────────────────────── */

  async function readCfg(name) {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [CFG[name]]);
      if (rows.length) return JSON.parse(rows[0].value);
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('[qa] could not read setting', name, '—', e.message);
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

  async function settings() {
    const [directors, accounts, accountsEmails, users] = await Promise.all([
      readCfg('directors'), readCfg('accounts'), readCfg('accountsEmails'), activeUsers(),
    ]);
    const live = new Set(users.map((u) => u.id));
    const ids = (list) => (Array.isArray(list) ? list.map(String).filter((id) => live.has(id)) : null);
    const byName = DEFAULT_DIRECTORS.map((n) => users.find((u) => String(u.name || '').trim().toLowerCase() === n.toLowerCase())).filter(Boolean);
    const admins = users.filter((u) => String(u.roles || '').split(',').map((r) => r.trim()).includes('Admin'));
    return {
      directors: ids(directors) ?? (byName.length ? byName : admins).map((u) => u.id),
      accounts: ids(accounts) ?? users.filter((u) => DEFAULT_ACCOUNTS_EMAILS.includes(String(u.email || '').toLowerCase())).map((u) => u.id),
      accountsEmails: Array.isArray(accountsEmails) ? accountsEmails.filter((e) => EMAIL_RE.test(e)) : DEFAULT_ACCOUNTS_EMAILS,
      directorsSet: Array.isArray(directors), accountsSet: Array.isArray(accounts),
      users,
    };
  }

  /* ── Who is asking ─────────────────────────────────────────────── */

  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'Quotation Approval needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        if (!user) return res.status(401).json({ error: 'Please log in again' });
        const cfg = await settings();
        const me = {
          user, cfg, by: user.name || user.email || '',
          admin: await canOpenPage(user),
          director: cfg.directors.includes(user.id),
          accounts: cfg.accounts.includes(user.id),
        };
        me.settings = me.admin && isAdminUser(user);
        if (!me.admin && !me.director && !me.accounts) return res.status(403).json({ error: 'You do not have access to Quotation Approval — ask an Admin to give it from Users → Access' });
        if (need === 'admin' && !me.admin) return res.status(403).json({ error: 'Only an Admin can do this' });
        if (need === 'settings' && !me.settings) return res.status(403).json({ error: 'Only an Admin/HOD can change these settings' });
        req.qa = me;
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[qa]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }

  async function logStep(id, action, note, by) {
    await q(`INSERT INTO qa_log (request_id, action, note, by_id, by_name) VALUES ($1,$2,$3,$4,$5)`,
      [id, action, String(note || '').slice(0, 4000), by?.id || null, by?.name || 'System']);
  }
  const actor = (me) => ({ id: me.user.id, name: me.by });

  /* ── Row shape ─────────────────────────────────────────────────── */

  function reqOut(r) {
    const docs = parseJson(r.documents, []);
    const quotes = parseJson(r.quotes, []).map((x, i) => ({
      vendor: x.vendor || '', amount: Number(x.amount || 0), gst: Number(x.gst || 0), total: Number(x.total || 0), notes: x.notes || '',
      docs: docs.map((d, n) => ({ ...d, n })).filter((d) => d.kind === 'quote' && d.q === i).map(({ name, size, n }) => ({ name, size, n })),
    }));
    const approvedAmount = r.approved_amount == null ? null : Number(r.approved_amount);
    const paid = Number(r.paid_total || 0);
    return {
      id: r.id, title: r.title, department: r.department || '', urgency: r.urgency, payment_type: r.payment_type,
      advance_amount: r.advance_amount == null ? null : Number(r.advance_amount),
      schedule: parseJson(r.schedule, []), remarks: r.remarks || '', quotes, status: r.status,
      approved_index: r.approved_index == null ? null : Number(r.approved_index),
      approved_vendor: r.approved_vendor || '', approved_amount: approvedAmount,
      director_remarks: r.director_remarks || '', decided_by_id: r.decided_by_id || null, decided_by_name: r.decided_by_name || '', decided_at: tsOut(r.decided_at),
      forwarded_by: r.forwarded_by || '', forwarded_at: tsOut(r.forwarded_at), forward_note: r.forward_note || '',
      paid_total: paid, balance: approvedAmount == null ? null : round2(Math.max(0, approvedAmount - paid)),
      submitted_by_id: r.submitted_by_id || null, submitted_by_name: r.submitted_by_name || '',
      payment_docs: docs.map((d, n) => ({ ...d, n })).filter((d) => d.kind === 'payment').map(({ name, size, n, pay }) => ({ name, size, n, pay })),
      created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
    };
  }

  function visible(s, me) {
    if (me.admin || me.director) return true;
    return me.accounts && (PAYABLE.includes(s.status) || s.status === S.DONE);
  }

  function rights(s, me) {
    return {
      decide: s.status === S.PENDING && me.director,
      forward: s.status === S.APPROVED && me.admin,
      pay: PAYABLE.includes(s.status) && (me.accounts || me.settings),
      del: !!me.user.isSuperAdmin || (me.settings && s.status === S.PENDING),
    };
  }

  async function loadReq(id, me) {
    const row = (await q('SELECT * FROM qa_requests WHERE id = $1', [id]))[0];
    if (!row) throw new UserError('Quotation request not found', 404);
    const s = reqOut(row);
    if (me && !visible(s, me)) throw new UserError('You cannot view this request', 403);
    return { s, row };
  }
  const fresh = async (id) => (await loadReq(id)).s;

  /* ── Recipients + mail ─────────────────────────────────────────── */

  async function addressOf(userId) {
    if (!userId) return '';
    const u = (await q('SELECT id, email, active FROM users WHERE id = $1', [userId]))[0];
    if (!u || Number(u.active ?? 1) === 0) return '';
    const e = await notifyAddressFor(u.id, u.email);
    return e && EMAIL_RE.test(e) ? e : '';
  }
  async function directorsWithMail(cfg) {
    const out = [];
    for (const id of cfg.directors) {
      const email = await addressOf(id);
      const u = cfg.users.find((x) => x.id === id);
      if (email) out.push({ id, name: u?.name || email, email });
    }
    return out;
  }
  const uniq = (list) => {
    const seen = new Set();
    return list.filter((e) => { const k = String(e || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  };

  async function attachmentsFor(id, pick) {
    const row = (await q('SELECT documents FROM qa_requests WHERE id = $1', [id]))[0];
    const list = parseJson(row?.documents, []).filter(pick)
      .map((d) => ({ filename: d.name, path: path.join(UPLOAD_ROOT, id, path.basename(d.file)), size: d.size || 0, contentType: d.type || undefined }))
      .filter((a) => fs.existsSync(a.path));
    let total = 0;
    return list.filter((a) => (total += a.size) <= MAIL_ATTACH_MAX).map(({ size, ...a }) => a);
  }

  function summaryRows(s) {
    return [
      ['Request ID', `<b>${escHtml(s.id)}</b>`],
      ['Purchase / Work', escHtml(s.title)],
      ['Department', escHtml(s.department)],
      ['Urgency', s.urgency === 'Urgent' ? '<b style="color:#dc2626">URGENT</b>' : escHtml(s.urgency)],
      ['Payment Type', escHtml(payTypeLabel(s.payment_type))],
      ['Advance Amount', s.payment_type !== 'Full' && s.advance_amount != null ? inr(s.advance_amount) : ''],
      ['Payment Schedule', s.schedule.length ? s.schedule.map((x) => `${fmtDate(x.date)} — ${inr(x.amount)}${x.note ? ' (' + escHtml(x.note) + ')' : ''}`).join('<br>') : ''],
      ['Submitted By', escHtml(s.submitted_by_name)],
      ['Remarks', escHtml(s.remarks).replace(/\n/g, '<br>')],
    ];
  }
  function approvalRows(s) {
    return [
      ['Approved Vendor', `<b>${escHtml(s.approved_vendor)}</b>`],
      ['Approved Amount', `<b>${inr(s.approved_amount)}</b>`],
      ['Approved By', `${escHtml(s.decided_by_name)}${s.decided_at ? ' on ' + escHtml(new Date(s.decided_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })) : ''}`],
      ['Director Remarks', escHtml(s.director_remarks).replace(/\n/g, '<br>')],
    ];
  }

  async function send(mailer, msg, tag) {
    await mailer.sendMail({ from: `"Quotation Approval" <${process.env.SMTP_USER}>`, ...msg });
    console.log('[qa]', tag, 'mailed to', msg.to, msg.cc ? '| cc: ' + msg.cc : '');
  }

  // Fire-and-forget: a mail problem must never fail the step that caused it.
  function notify(id, stage, { note = '', payment = null } = {}) {
    (async () => {
      const mailer = getMailer();
      if (!mailer) { console.log('[qa] mail not sent (no SMTP) —', stage, id); return; }
      const s = await fresh(id);
      const cfg = await settings();
      const submitter = await addressOf(s.submitted_by_id);
      const subjBase = `${s.id} ${s.title}${s.urgency === 'Urgent' ? ' [URGENT]' : ''}`;

      if (stage === 'submitted') {
        // Each Director their own mail, buttons bound to their address.
        const quoteFiles = await attachmentsFor(id, (d) => d.kind === 'quote');
        const dirs = (await directorsWithMail(cfg)).filter((d) => d.email.toLowerCase() !== String(submitter).toLowerCase() || cfg.directors.length === 1);
        for (const d of dirs) {
          const url = (decision) => `${appOrigin}/qa-action?t=${encodeURIComponent(tokenFor(TOKEN_NS + s.id, decision, d.email))}`;
          await send(mailer, {
            to: d.email,
            subject: `Approval needed: ${subjBase} — 3 quotations`,
            attachments: quoteFiles,
            html: mailHtml({
              heading: 'Quotations — Your Approval Needed', colour: s.urgency === 'Urgent' ? '#dc2626' : '#0150AA',
              lead: `Hi <b>${escHtml(d.name)}</b>, <b>${escHtml(s.submitted_by_name)}</b> has submitted ${s.quotes.length} quotations. Compare them and approve one vendor, or reject.`,
              rows: summaryRows(s), extraHtml: quotesTableHtml(s),
              actions: mailButtons([
                ...s.quotes.map((x, i) => [`Approve ${x.vendor.length > 22 ? x.vendor.slice(0, 21) + '…' : x.vendor}`, '#16a34a', url('q' + i)]),
                ['Reject', '#dc2626', url('reject')],
              ]),
              footer: 'Each button opens a confirm page where you can add remarks — no login needed. The quotations are attached.',
              link: pageLink(),
            }),
          }, 'submitted → ' + d.name);
        }
        return;
      }

      if (stage === 'approved' || stage === 'rejected') {
        const ok = stage === 'approved';
        const to = uniq([submitter]);
        if (!to.length) return console.log('[qa] no address for the submitter of', id);
        await send(mailer, {
          to: to.join(', '),
          subject: ok ? `Approved: ${subjBase} — ${s.approved_vendor} ${inr(s.approved_amount)}` : `Rejected: ${subjBase}`,
          attachments: ok ? await attachmentsFor(id, (d) => d.kind === 'quote' && d.q === s.approved_index) : undefined,
          html: mailHtml({
            heading: ok ? 'Quotation Approved' : 'Quotations Rejected', colour: ok ? '#16a34a' : '#dc2626',
            lead: ok
              ? `<b>${escHtml(s.decided_by_name)}</b> has approved <b>${escHtml(s.approved_vendor)}</b> for <b>${escHtml(s.title)}</b>. Review the details and click <b>Forward to Accounts</b> in the ERP.`
              : `<b>${escHtml(s.decided_by_name)}</b> has rejected the quotations for <b>${escHtml(s.title)}</b>.`,
            rows: [...(ok ? approvalRows(s) : [['Rejected By', escHtml(s.decided_by_name)], ['Reason', escHtml(s.director_remarks).replace(/\n/g, '<br>')]]), ...summaryRows(s)],
            extraHtml: quotesTableHtml(s),
            footer: ok ? 'The approved quotation is attached.' : '',
            link: pageLink(),
          }),
        }, stage);
        return;
      }

      if (stage === 'forwarded') {
        const to = uniq([...(await Promise.all(cfg.accounts.map(addressOf))), ...cfg.accountsEmails]);
        const dir = await addressOf(s.decided_by_id);
        const cc = uniq([submitter, dir]).filter((e) => !to.some((t) => t.toLowerCase() === e.toLowerCase()));
        if (!to.length) return console.log('[qa] no Accounts address configured —', id);
        await send(mailer, {
          to: to.join(', '), ...(cc.length ? { cc: cc.join(', ') } : {}),
          subject: `Payment required: ${subjBase} — ${s.approved_vendor} ${inr(s.approved_amount)} (${payTypeLabel(s.payment_type)})`,
          attachments: await attachmentsFor(id, (d) => d.kind === 'quote' && d.q === s.approved_index),
          html: mailHtml({
            heading: 'Approved Quotation — Payment Required', colour: '#d97706',
            lead: `<b>${escHtml(s.forwarded_by)}</b> has forwarded the approved quotation for <b>${escHtml(s.title)}</b> to Accounts. Please process the payment and record it in the ERP.`,
            rows: [...approvalRows(s), ...summaryRows(s), ['Note from Admin', escHtml(s.forward_note).replace(/\n/g, '<br>')]],
            extraHtml: quotesTableHtml(s),
            footer: 'The approved quotation and its supporting documents are attached.',
            link: pageLink(),
          }),
        }, 'forwarded');
        return;
      }

      if (stage === 'paid' && payment) {
        const dir = await addressOf(s.decided_by_id);
        const to = uniq([submitter, dir]);
        if (!to.length) return;
        await send(mailer, {
          to: to.join(', '),
          subject: `${s.status}: ${subjBase} — ${inr(payment.amount)} paid, balance ${inr(s.balance)}`,
          html: mailHtml({
            heading: s.status === S.DONE ? 'Payment Completed' : `Payment Recorded — ${s.status}`, colour: '#16a34a',
            lead: `Accounts has recorded a payment of <b>${inr(payment.amount)}</b> to <b>${escHtml(s.approved_vendor)}</b> for <b>${escHtml(s.title)}</b>.`,
            rows: [
              ['Paid On', fmtDate(payment.paid_date)], ['Amount', inr(payment.amount)], ['Mode', escHtml(payment.mode)],
              ['Transaction / Ref No.', escHtml(payment.reference)], ['Recorded By', escHtml(payment.by_name)],
              ['Approved Amount', inr(s.approved_amount)], ['Paid So Far', inr(s.paid_total)], ['Remaining Balance', `<b>${inr(s.balance)}</b>`],
              ['Note', escHtml(note).replace(/\n/g, '<br>')],
            ],
            link: pageLink(),
          }),
        }, 'paid');
      }
    })().catch((e) => console.error('[qa] mail', stage, id, '—', e.message));
  }

  /* ── Reads ─────────────────────────────────────────────────────── */

  app.get('/api/quotation-approval/data', requireAuth, route(null, async (req) => {
    const me = req.qa;
    const rows = await q('SELECT * FROM qa_requests ORDER BY created_at DESC, id DESC');
    const requests = rows.map(reqOut).filter((s) => visible(s, me)).map((s) => ({ ...s, can: rights(s, me) }));
    const byId = new Map(me.cfg.users.map((u) => [u.id, u]));
    const out = {
      today: today(),
      me: { id: me.user.id, name: me.user.name, admin: me.admin, director: me.director, accounts: me.accounts, settings: me.settings },
      requests,
      lists: { URGENCIES, PAY_TYPES, PAY_MODES, STATUSES, QUOTES },
      directors: me.cfg.directors.map((id) => byId.get(id)?.name).filter(Boolean),
      // Vendor names typed before — a suggestion list on the form.
      vendors: [...new Set(rows.flatMap((r) => parseJson(r.quotes, []).map((x) => x.vendor)).filter(Boolean))].sort().slice(0, 300),
    };
    if (me.settings) {
      // Who on the two lists cannot open the page (they still get the mails).
      const noPage = [];
      for (const id of [...new Set([...me.cfg.directors, ...me.cfg.accounts])]) {
        const u = byId.get(id);
        if (u && !(await canOpenPage({ id: u.id, email: u.email, roles: u.roles }))) noPage.push(u.name);
      }
      out.settings = {
        directors: me.cfg.directors, accounts: me.cfg.accounts, accountsEmails: me.cfg.accountsEmails,
        directorsSet: me.cfg.directorsSet, accountsSet: me.cfg.accountsSet, noPage,
      };
      out.users = me.cfg.users.map((u) => ({ id: u.id, name: u.name, department: u.department || '' }));
    }
    return out;
  }));

  app.get('/api/quotation-approval/requests/:id', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req.params.id, req.qa);
    const log = (await q('SELECT * FROM qa_log WHERE request_id = $1 ORDER BY id', [s.id]))
      .map((n) => ({ action: n.action, note: n.note || '', by: n.by_name || '', at: tsOut(n.created_at) }));
    const payments = (await q('SELECT * FROM qa_payments WHERE request_id = $1 ORDER BY paid_date, id', [s.id]))
      .map((p) => ({ id: p.id, key: p.pay_key || '', paid_date: dstr(p.paid_date), amount: Number(p.amount), mode: p.mode || '', reference: p.reference || '', note: p.note || '', by: p.by_name || '', at: tsOut(p.created_at) }));
    return { request: { ...s, can: rights(s, req.qa) }, log, payments };
  }));

  app.get('/api/quotation-approval/requests/:id/documents/:n', requireAuth, route(null, async (req, res) => {
    const { row } = await loadReq(req.params.id, req.qa);
    const doc = parseJson(row.documents, [])[parseInt(req.params.n, 10)];
    if (!doc || !doc.file) throw new UserError('Document not found', 404);
    const abs = path.join(UPLOAD_ROOT, row.id, path.basename(doc.file));
    res.download(abs, doc.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'The file is missing on the server' });
    });
  }));

  /* ── Payment terms (submit + forward) ──────────────────────────── */

  function termsFromBody(b, total) {
    const payment_type = PAY_TYPES.includes(b.payment_type) ? b.payment_type : bad('Choose the payment type');
    let advance_amount = null;
    let schedule = [];
    if (payment_type !== 'Full') {
      advance_amount = money(b.advance_amount, payment_type === 'Advance' ? 'Advance amount' : 'First (advance) payment');
      if (!(advance_amount > 0)) bad('Enter the advance amount');
      if (total != null && advance_amount > total) bad('The advance cannot be more than the quotation total');
      schedule = (Array.isArray(b.schedule) ? b.schedule : []).filter((x) => x && (x.date || x.amount)).slice(0, 12).map((x, i) => ({
        date: dateIn(x.date, `Schedule line ${i + 1} date`),
        amount: money(x.amount, `Schedule line ${i + 1} amount`),
        note: str(x.note, 200),
      }));
      if (payment_type === 'Part' && !schedule.length) bad('Add the payment schedule for the balance (date and amount)');
    }
    return { payment_type, advance_amount, schedule };
  }

  /* ── Admin: submit ─────────────────────────────────────────────── */

  app.post('/api/quotation-approval/requests', requireAuth, route('admin', async (req) => {
    const me = req.qa;
    const b = req.body || {};
    const title = str(b.title) || bad('Write what the purchase / work is for');
    const urgency = URGENCIES.includes(b.urgency) ? b.urgency : bad('Choose the urgency — Urgent or Medium');
    const list = Array.isArray(b.quotes) ? b.quotes : [];
    if (list.length !== QUOTES) bad(`Enter all ${QUOTES} vendor quotations`);
    const budget = { total: 0 };
    const quotes = list.map((x, i) => {
      const label = `Quotation ${i + 1}`;
      const vendor = str(x?.vendor) || bad(`${label}: vendor name is required`);
      const amount = money(x?.amount, `${label}: quotation amount`);
      if (!(amount > 0)) bad(`${label}: quotation amount is required`);
      const gst = money(x?.gst, `${label}: GST`, { required: false });
      const files = decodeFiles(x?.documents, label, budget);
      if (!files.length) bad(`${label}: attach the quotation`);
      if (files.length > DOC_PER_QUOTE) bad(`${label}: at most ${DOC_PER_QUOTE} files`);
      return { vendor, amount, gst, total: round2(amount + gst), notes: str(x?.notes, 500), files };
    });
    const names = quotes.map((x) => x.vendor.toLowerCase());
    if (new Set(names).size !== names.length) bad('The three quotations must be from three different vendors');
    const terms = termsFromBody(b, Math.max(...quotes.map((x) => x.total)));
    const id = await withSeqId('qa_requests', 'QA', 4, (newId) => q(
      `INSERT INTO qa_requests (id, title, department, urgency, payment_type, advance_amount, schedule, remarks, quotes, documents, status, submitted_by_id, submitted_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]',$10,$11,$12)`,
      [newId, title, str(b.department, 128), urgency, terms.payment_type, terms.advance_amount, JSON.stringify(terms.schedule), str(b.remarks, 4000),
        JSON.stringify(quotes.map(({ files, ...x }) => x)), S.PENDING, me.user.id, me.by]));
    const stored = [];
    for (let i = 0; i < quotes.length; i++) stored.push(...await writeFiles(id, quotes[i].files, { kind: 'quote', q: i, by: me.by }));
    await q('UPDATE qa_requests SET documents = $1 WHERE id = $2', [JSON.stringify(stored), id]);
    await logStep(id, 'Submitted', `${quotes.map((x) => `${x.vendor} ${inr(x.total)}`).join(' · ')}\n${urgency} · ${payTypeLabel(terms.payment_type)}`, actor(me));
    notify(id, 'submitted');
    return { id };
  }));

  /* ── Director: approve one / reject ────────────────────────────── */

  // One decision, from the app or the mail. choice = 0..2 or 'reject'.
  async function decide(s, choice, remarks, by) {
    const reject = choice === 'reject';
    const i = reject ? null : Number(choice);
    if (!reject && !(Number.isInteger(i) && s.quotes[i])) bad('Choose which quotation to approve');
    if (reject && !remarks) bad('Give the reason for rejecting');
    const qt = reject ? null : s.quotes[i];
    // Conditional on the status so two Directors (or a double click) cannot both decide.
    const r = await pool.query(
      `UPDATE qa_requests SET status=$1, approved_index=$2, approved_vendor=$3, approved_amount=$4, director_remarks=$5,
              decided_by_id=$6, decided_by_name=$7, decided_at=NOW(), updated_at=NOW() WHERE id=$8 AND status=$9`,
      [reject ? S.REJECTED : S.APPROVED, i, qt ? qt.vendor : '', qt ? qt.total : null, remarks, by.id, by.name, s.id, S.PENDING]);
    if (!r.rowCount) bad('This request was just decided — reload');
    await logStep(s.id, reject ? 'Rejected' : 'Approved', reject ? remarks : `${qt.vendor} — ${inr(qt.total)}${remarks ? '\n' + remarks : ''}`, by);
    notify(s.id, reject ? 'rejected' : 'approved');
  }

  app.post('/api/quotation-approval/requests/:id/decision', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req.params.id, req.qa);
    if (!rights(s, req.qa).decide) bad(s.status === S.PENDING ? 'Only a Director can approve quotations' : `It is already ${s.status}`);
    const b = req.body || {};
    await decide(s, b.choice === 'reject' ? 'reject' : Number(b.choice), str(b.remarks, 4000), actor(req.qa));
    return { ok: true };
  }));

  /* ── Deciding from the Director's mail ─────────────────────────────
     Outside requireAuth, like /leave-action: the signed token (request +
     choice + the Director's address) IS the authorisation. GET shows a
     confirm page (mail scanners follow links); its POST decides. The
     address must still be a Director's when the link is used. */
  async function forToken(token) {
    const claim = readToken(token);
    if (!claim || !claim.id.startsWith(TOKEN_NS) || !/^(q\d|reject)$/.test(claim.decision)) {
      return { error: 'This link is not valid. Open Quotation Approval in the ERP instead.' };
    }
    const row = (await q('SELECT * FROM qa_requests WHERE id = $1', [claim.id.slice(TOKEN_NS.length)]))[0];
    if (!row) return { error: 'That quotation request no longer exists.' };
    const s = reqOut(row);
    if (s.status !== S.PENDING) return { done: s };
    const cfg = await settings();
    const director = (await directorsWithMail(cfg)).find((d) => d.email.toLowerCase() === String(claim.email || '').toLowerCase());
    if (!director) return { error: 'This link belongs to someone who is no longer a Director on Quotation Approval.' };
    const choice = claim.decision === 'reject' ? 'reject' : Number(claim.decision.slice(1));
    if (choice !== 'reject' && !s.quotes[choice]) return { error: 'That quotation is not on this request.' };
    return { claim, s, director, choice };
  }

  const pageRows = (s) => [
    ['Request', `${s.id} — ${s.title}`], ['Urgency', s.urgency], ['Payment Type', payTypeLabel(s.payment_type)], ['Submitted By', s.submitted_by_name],
    ...s.quotes.map((x, i) => [`Quotation ${i + 1}`, `${x.vendor} — ${inr(x.total)} (incl. GST ${inr(x.gst)})`]),
  ];
  const failPage = (lead) => actionPage({ title: 'Link not usable', tone: 'bad', lead: escHtml(lead) });
  const donePage = (s) => actionPage({
    title: 'Already decided', tone: 'plain',
    lead: `${escHtml(s.id)} is already <b>${escHtml(s.status)}</b>${s.decided_by_name ? ' — decided by ' + escHtml(s.decided_by_name) : ''}${s.approved_vendor ? ' (' + escHtml(s.approved_vendor) + ')' : ''}. Nothing more to do here.`,
    rows: pageRows(s), note: `<a href="${escHtml(pageLink())}">Open Quotation Approval</a>`,
  });

  function formPage(r, token, error = '', remarks = '') {
    const { s, choice, claim } = r;
    const reject = choice === 'reject';
    const others = [...s.quotes.map((x, i) => ['q' + i, `Approve ${x.vendor}`]), ['reject', 'Reject']]
      .filter(([k]) => k !== claim.decision)
      .map(([k, l]) => `<a href="/qa-action?t=${encodeURIComponent(tokenFor(TOKEN_NS + s.id, k, claim.email))}">${escHtml(l)}</a>`).join(' · ');
    return actionPage({
      title: reject ? `Reject ${s.id}?` : `Approve ${s.quotes[choice].vendor}?`,
      tone: reject ? 'bad' : 'good',
      lead: reject
        ? `You are about to reject all ${s.quotes.length} quotations for <b>${escHtml(s.title)}</b>.`
        : `You are about to approve <b>${escHtml(s.quotes[choice].vendor)}</b> at <b>${inr(s.quotes[choice].total)}</b> for <b>${escHtml(s.title)}</b>. ${escHtml(s.submitted_by_name)} will be emailed to forward it to Accounts.`,
      rows: pageRows(s),
      form: `<form method="POST" action="/qa-action">
          <input type="hidden" name="t" value="${escHtml(token)}">
          ${error ? `<p style="color:#dc2626;font-weight:600;">${escHtml(error)}</p>` : ''}
          <textarea name="remarks" rows="3" placeholder="${reject ? 'Reason for rejecting (required)' : 'Remarks (optional)'}"
            style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font:inherit;font-size:14px;margin:0 0 14px;">${escHtml(remarks)}</textarea>
          <button type="submit">${reject ? 'Yes, reject' : 'Yes, approve this vendor'}</button>
        </form>`,
      note: `${others}<br>The quotations are attached to the mail · <a href="${escHtml(pageLink())}">Open in the ERP</a>`,
    });
  }

  app.get('/qa-action', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send(failPage('Quotation Approval needs the database.'));
      await ensureSchema();
      const r = await forToken(req.query.t);
      if (r.error) return res.status(400).send(failPage(r.error));
      if (r.done) return res.send(donePage(r.done));
      res.send(formPage(r, String(req.query.t)));
    } catch (e) {
      res.status(500).send(actionPage({ title: 'Something went wrong', tone: 'bad', lead: escHtml(e.message) }));
    }
  });

  app.post('/qa-action', async (req, res) => {
    const token = String(req.body?.t || '');
    const remarks = str(req.body?.remarks, 4000);
    try {
      if (!useDb) return res.status(503).send(failPage('Quotation Approval needs the database.'));
      await ensureSchema();
      const r = await forToken(token);
      if (r.error) return res.status(400).send(failPage(r.error));
      if (r.done) return res.send(donePage(r.done));
      try {
        await decide(r.s, r.choice, remarks, { id: r.director.id, name: r.director.name });
      } catch (e) {
        if (e instanceof UserError) return res.status(400).send(formPage(r, token, e.message, remarks));
        throw e;
      }
      const after = await fresh(r.s.id);
      res.send(actionPage({
        title: after.status === S.REJECTED ? 'Rejected' : 'Approved',
        tone: after.status === S.REJECTED ? 'bad' : 'good',
        lead: after.status === S.REJECTED
          ? `${escHtml(after.id)} has been rejected. ${escHtml(after.submitted_by_name)} has been emailed.`
          : `<b>${escHtml(after.approved_vendor)}</b> (${inr(after.approved_amount)}) is approved. ${escHtml(after.submitted_by_name)} has been emailed to forward it to Accounts.`,
        rows: pageRows(after), note: 'You can close this tab.',
      }));
    } catch (e) {
      res.status(500).send(actionPage({ title: 'Could not record the decision', tone: 'bad', lead: escHtml(e.message) }));
    }
  });

  /* ── Admin: forward to Accounts ────────────────────────────────── */

  app.post('/api/quotation-approval/requests/:id/forward', requireAuth, route('admin', async (req) => {
    const { s } = await loadReq(req.params.id, req.qa);
    if (!rights(s, req.qa).forward) bad(`It is ${s.status} — only an approved quotation can be forwarded`);
    const b = req.body || {};
    // The Admin reviews (and may correct) the payment terms on the way.
    const terms = termsFromBody(b, s.approved_amount);
    const note = str(b.note, 4000);
    const r = await pool.query(
      `UPDATE qa_requests SET status=$1, payment_type=$2, advance_amount=$3, schedule=$4, forwarded_by=$5, forwarded_at=NOW(), forward_note=$6, updated_at=NOW()
        WHERE id=$7 AND status=$8`,
      [S.PAYMENT, terms.payment_type, terms.advance_amount, JSON.stringify(terms.schedule), req.qa.by, note, s.id, S.APPROVED]);
    if (!r.rowCount) bad('This request was just forwarded — reload');
    await logStep(s.id, 'Forwarded to Accounts', `${payTypeLabel(terms.payment_type)}${terms.advance_amount ? ' · advance ' + inr(terms.advance_amount) : ''}${note ? '\n' + note : ''}`, actor(req.qa));
    notify(s.id, 'forwarded');
    return { ok: true };
  }));

  /* ── Accounts: record a payment ────────────────────────────────── */

  app.post('/api/quotation-approval/requests/:id/payments', requireAuth, route(null, async (req) => {
    const { s, row } = await loadReq(req.params.id, req.qa);
    if (!rights(s, req.qa).pay) bad(PAYABLE.includes(s.status) ? 'Only Accounts can record payments' : `It is ${s.status} — payments are recorded after it is forwarded to Accounts`);
    const b = req.body || {};
    const paid_date = dateIn(b.paid_date, 'Payment date');
    if (paid_date > today()) bad('Payment date cannot be in the future');
    const amount = money(b.amount, 'Amount paid');
    if (!(amount > 0)) bad('Enter the amount paid');
    if (amount > s.balance + 0.005) bad(`That is more than the remaining balance of ${inr(s.balance)}`);
    const mode = PAY_MODES.includes(b.mode) ? b.mode : bad('Choose the payment mode');
    const reference = str(b.reference, 128);
    const note = str(b.note, 4000);
    const files = decodeFiles(b.documents, 'Payment proof', { total: 0 });
    if (files.length > 3) bad('At most 3 payment-proof files');
    const payKey = Date.now().toString(36);
    const paidTotal = round2(s.paid_total + amount);
    const balance = round2(s.approved_amount - paidTotal);
    const next = balance <= 0.005 ? S.DONE : (s.payment_type === 'Advance' && s.paid_total === 0 ? S.ADVANCE : S.PART);
    // Conditional on paid_total so two Accounts people cannot both overpay.
    const r = await pool.query(`UPDATE qa_requests SET paid_total=$1, status=$2, updated_at=NOW() WHERE id=$3 AND paid_total=$4 AND status=$5`,
      [paidTotal, next, s.id, s.paid_total, s.status]);
    if (!r.rowCount) bad('Another payment was just recorded — reload');
    await q(`INSERT INTO qa_payments (request_id, pay_key, paid_date, amount, mode, reference, note, by_id, by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [s.id, payKey, paid_date, amount, mode, reference, note, req.qa.user.id, req.qa.by]);
    if (files.length) {
      const stored = await writeFiles(s.id, files, { kind: 'payment', pay: payKey, by: req.qa.by });
      await q('UPDATE qa_requests SET documents = $1 WHERE id = $2', [JSON.stringify([...parseJson(row.documents, []), ...stored]), s.id]);
    }
    await logStep(s.id, next === S.DONE ? 'Payment Completed' : 'Payment', `${inr(amount)} on ${fmtDate(paid_date)} · ${mode}${reference ? ' · Ref ' + reference : ''} · balance ${inr(Math.max(0, balance))}${note ? '\n' + note : ''}`, actor(req.qa));
    notify(s.id, 'paid', { note, payment: { paid_date, amount, mode, reference, by_name: req.qa.by } });
    return { ok: true, status: next, balance: Math.max(0, balance) };
  }));

  app.delete('/api/quotation-approval/requests/:id', requireAuth, route('admin', async (req) => {
    const { s } = await loadReq(req.params.id, req.qa);
    if (!rights(s, req.qa).del) bad('Only a request still waiting for the Director can be deleted');
    await q('DELETE FROM qa_log WHERE request_id = $1', [s.id]);
    await q('DELETE FROM qa_payments WHERE request_id = $1', [s.id]);
    await q('DELETE FROM qa_requests WHERE id = $1', [s.id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, s.id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }));

  /* ── Settings (Admin/HOD with page access) ─────────────────────── */

  app.post('/api/quotation-approval/settings', requireAuth, route('settings', async (req) => {
    const b = req.body || {};
    const live = new Set(req.qa.cfg.users.map((u) => u.id));
    const ids = (list, label) => {
      if (!Array.isArray(list)) bad(`${label}: send a list`);
      return [...new Set(list.map(String).filter((id) => live.has(id)))];
    };
    if (b.directors !== undefined) {
      const d = ids(b.directors, 'Directors');
      if (!d.length) bad('Pick at least one Director');
      await writeCfg('directors', d);
    }
    if (b.accounts !== undefined) await writeCfg('accounts', ids(b.accounts, 'Accounts team'));
    if (b.accountsEmails !== undefined) {
      const list = (Array.isArray(b.accountsEmails) ? b.accountsEmails : []).map((e) => str(e).toLowerCase()).filter(Boolean);
      const wrong = list.find((e) => !EMAIL_RE.test(e));
      if (wrong) bad(`"${wrong}" is not a valid email address`);
      await writeCfg('accountsEmails', [...new Set(list)].slice(0, 30));
    }
    return { ok: true };
  }));

  return {};
}

module.exports = { QA_SCHEMA, mountQuotationApproval };
