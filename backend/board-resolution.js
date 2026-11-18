'use strict';
/* =====================================================================
   Board Resolution (route 'board-resolution', Admin Section)
   ---------------------------------------------------------------------
   Replaces the Google Form + Drive flow Saloni Ma'am showed in the
   3 Nov 2026 meeting. One resolution walks through:

     Anyone raises a request (what is needed, why, supporting files)
       → BR number (BR0001…)                       └─► With CS
     The CS (company secretary) either
       ├─ asks the requester for more details       └─► Query to Requester
       │    the requester replies (note + files)    └─► With CS
       └─ uploads the draft resolution (v1, v2 …)   └─► Pending Director Approval
     A Director (here or from the mail)
       ├─ Approve — optionally with her own modified copy as the final text
       │                                            └─► Approved – Awaiting Signed Copy
       ├─ Request Changes (what to change, optional marked-up file)
       │                                            └─► Changes Requested → CS uploads v+1
       └─ Reject (reason)                           └─► Rejected
     The CS prints, gets it signed and uploads the signed copy
                                                    └─► Completed (mailed to all; saved to Drive)

   The loop CS ⇄ Director repeats until the Director approves — the Form
   had only one round, after which everything moved to phone calls.

   Who is who:
   - Requester: anyone with a login (the page is on everyone's menu). Sees
     only their own requests.
   - CS: app_config br_cs (users). Drafts, queries, uploads the signed copy.
   - Directors: app_config br_directors (default Saloni Anchan by name,
     else the Admin-role users). Each gets their own mail with Approve /
     Request Changes / Reject buttons (/br-action, token ns 'br:').
   - Managers: the Admin role, the owner, or anyone ticked "Board
     Resolution (admin)" in Users → Access. See everything and Settings.
   CS and Directors see every request too.

   Files live in uploads/board-resolution/<id>/ (git-ignored) and are
   listed in the row's `documents` JSON with a kind: request / reply /
   draft (with version) / director / signed. Every step is in br_log.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'board-resolution');

const BR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS br_requests (
     id VARCHAR(16) PRIMARY KEY,
     title VARCHAR(255) NOT NULL,
     category VARCHAR(64) NOT NULL DEFAULT 'Other',
     meeting_type VARCHAR(40) NOT NULL DEFAULT 'Board Meeting',
     meeting_date DATE DEFAULT NULL,
     priority VARCHAR(16) NOT NULL DEFAULT 'Normal',
     description TEXT,
     documents TEXT,
     status VARCHAR(40) NOT NULL DEFAULT 'With CS',
     version INT NOT NULL DEFAULT 0,
     final_doc INT DEFAULT NULL,
     signed_doc INT DEFAULT NULL,
     drive_link VARCHAR(512) DEFAULT '',
     passed_date DATE DEFAULT NULL,
     director_remarks TEXT,
     decided_by_id VARCHAR(16) DEFAULT NULL,
     decided_by_name VARCHAR(255) DEFAULT '',
     decided_at DATETIME DEFAULT NULL,
     requested_by_id VARCHAR(16) DEFAULT NULL,
     requested_by_name VARCHAR(255) DEFAULT '',
     department VARCHAR(128) NOT NULL DEFAULT '',
     completed_at DATETIME DEFAULT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_br_status ON br_requests (status)`,
  `CREATE TABLE IF NOT EXISTS br_log (
     id INT AUTO_INCREMENT PRIMARY KEY,
     request_id VARCHAR(16) NOT NULL,
     action VARCHAR(40) NOT NULL,
     note TEXT,
     docs TEXT,
     by_id VARCHAR(16) DEFAULT NULL,
     by_name VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE INDEX idx_br_log_req ON br_log (request_id)`,
];

const CATEGORIES = [
  'Bank Account / Signatory', 'Borrowing / Loan', 'Investment / Loan Given', 'Appointment', 'Resignation / Cessation',
  'Shares / Allotment / Transfer', 'Property / Assets', 'Authorisation (Agreements, Govt. work)', 'Statutory / Compliance', 'Other',
];
const MEETING_TYPES = ['Board Meeting', 'Circular Resolution', 'General Meeting (AGM / EGM)'];
const PRIORITIES = ['Normal', 'Urgent'];
const S = {
  CS: 'With CS',
  QUERY: 'Query to Requester',
  PENDING: 'Pending Director Approval',
  CHANGES: 'Changes Requested',
  APPROVED: 'Approved – Awaiting Signed Copy',
  DONE: 'Completed',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};
const STATUSES = Object.values(S);
const OPEN = [S.CS, S.QUERY, S.PENDING, S.CHANGES, S.APPROVED];
const TOKEN_NS = 'br:';
const CFG = { cs: 'br_cs', directors: 'br_directors', extraEmails: 'br_cc_emails' };
const DEFAULT_DIRECTORS = ['Saloni Anchan'];
const DRIVE_FOLDER_NAME = 'Board Resolutions';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_TYPES = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const DOC_MAX = 5;
const DOC_BYTES = 4 * 1024 * 1024;
const DOC_TOTAL = 8 * 1024 * 1024;   // express.json caps the body at 10mb of base64
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
function optDate(v, label) {
  const s = str(v, 10);
  if (!s) return null;
  if (!ISO_RE.test(s) || isNaN(new Date(s + 'T00:00:00Z').getTime())) bad(`${label} is not a valid date`);
  return s;
}
const parseJson = (raw, dflt) => { try { const d = typeof raw === 'string' ? JSON.parse(raw) : raw; return d ?? dflt; } catch { return dflt; } };
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const nl2br = (s) => escHtml(s).replace(/\n/g, '<br>');

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
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">This is an automated notification from the Lallubhai Amichand ERP — Board Resolution.</p>
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

/* ===================================================================== */

function mountBoardResolution(app, ctx) {
  const {
    q, pool, ensureSchema, requireAuth, withSeqId, getMailer, notifyAddressFor,
    appOrigin, useDb, tokenFor, readToken, actionPage, isManager, getGoogleAuth, sharedDriveId,
  } = ctx;

  const pageLink = () => `${appOrigin}/#board-resolution`;

  /* ── Settings ──────────────────────────────────────────────────── */

  async function readCfg(name) {
    try {
      const rows = await q(`SELECT "value" FROM app_config WHERE "key" = $1`, [CFG[name]]);
      if (rows.length) return JSON.parse(rows[0].value);
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('[br] could not read setting', name, '—', e.message);
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
    const [cs, directors, extraEmails, users] = await Promise.all([readCfg('cs'), readCfg('directors'), readCfg('extraEmails'), activeUsers()]);
    const live = new Set(users.map((u) => u.id));
    const ids = (list) => (Array.isArray(list) ? list.map(String).filter((id) => live.has(id)) : null);
    const byName = DEFAULT_DIRECTORS.map((n) => users.find((u) => String(u.name || '').trim().toLowerCase() === n.toLowerCase())).filter(Boolean);
    const admins = users.filter((u) => String(u.roles || '').split(',').map((r) => r.trim()).includes('Admin'));
    return {
      cs: ids(cs) ?? [],
      directors: ids(directors) ?? (byName.length ? byName : admins).map((u) => u.id),
      extraEmails: Array.isArray(extraEmails) ? extraEmails.filter((e) => EMAIL_RE.test(e)) : [],
      csSet: Array.isArray(cs), directorsSet: Array.isArray(directors),
      users,
    };
  }

  /* ── Who is asking ─────────────────────────────────────────────── */

  function route(need, fn) {
    return async (req, res) => {
      try {
        if (!useDb) return res.status(503).json({ error: 'Board Resolution needs the database — it is not available in local JSON mode' });
        await ensureSchema();
        const user = req.session.user;
        if (!user) return res.status(401).json({ error: 'Please log in again' });
        const cfg = await settings();
        const me = {
          user, cfg, by: user.name || user.email || '',
          manager: await isManager(user),
          cs: cfg.cs.includes(user.id),
          director: cfg.directors.includes(user.id),
        };
        me.all = me.manager || me.cs || me.director;
        if (need === 'manager' && !me.manager) return res.status(403).json({ error: 'Only an Admin (or someone given Board Resolution admin in Users → Access) can change these settings' });
        req.br = me;
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[br]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }

  async function logStep(id, action, note, by, docs = []) {
    await q(`INSERT INTO br_log (request_id, action, note, docs, by_id, by_name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, action, String(note || '').slice(0, 4000), JSON.stringify(docs), by?.id || null, by?.name || 'System']);
  }
  const actor = (me) => ({ id: me.user.id, name: me.by });

  /* ── Row shape ─────────────────────────────────────────────────── */

  function reqOut(r) {
    const docs = parseJson(r.documents, []).map((d, n) => ({ name: d.name, size: d.size, kind: d.kind, v: d.v || null, by: d.by || '', at: d.at || null, n }));
    return {
      id: r.id, title: r.title, category: r.category, meeting_type: r.meeting_type, meeting_date: dstr(r.meeting_date),
      priority: r.priority, description: r.description || '', status: r.status, version: Number(r.version || 0),
      docs, final_doc: r.final_doc == null ? null : Number(r.final_doc), signed_doc: r.signed_doc == null ? null : Number(r.signed_doc),
      drive_link: r.drive_link || '', passed_date: dstr(r.passed_date),
      director_remarks: r.director_remarks || '', decided_by_id: r.decided_by_id || null, decided_by_name: r.decided_by_name || '', decided_at: tsOut(r.decided_at),
      requested_by_id: r.requested_by_id || null, requested_by_name: r.requested_by_name || '', department: r.department || '',
      completed_at: tsOut(r.completed_at), created_at: tsOut(r.created_at), updated_at: tsOut(r.updated_at),
    };
  }
  // The newest draft (CS) or Director's own copy — what is on the table now.
  const latestDraft = (s) => [...s.docs].reverse().find((d) => d.kind === 'draft' || d.kind === 'director') || null;

  const mine = (s, me) => s.requested_by_id === me.user.id;
  const visible = (s, me) => me.all || mine(s, me);

  function rights(s, me) {
    const csLike = me.cs || (me.manager && !me.cfg.cs.length);
    return {
      draft: csLike && [S.CS, S.CHANGES].includes(s.status),
      query: csLike && [S.CS, S.CHANGES].includes(s.status),
      reply: mine(s, me) && s.status === S.QUERY,
      decide: me.director && s.status === S.PENDING,
      sign: csLike && s.status === S.APPROVED,
      withdraw: (mine(s, me) || me.manager) && [S.CS, S.QUERY, S.CHANGES].includes(s.status),
      del: !!me.user.isSuperAdmin,
    };
  }

  async function loadReq(id, me) {
    const row = (await q('SELECT * FROM br_requests WHERE id = $1', [id]))[0];
    if (!row) throw new UserError('Board resolution request not found', 404);
    const s = reqOut(row);
    if (me && !visible(s, me)) throw new UserError('You cannot view this request', 403);
    return { s, row };
  }
  const fresh = async (id) => (await loadReq(id)).s;

  async function addDocs(id, row, stored) {
    const list = [...parseJson(row.documents, []), ...stored];
    await q('UPDATE br_requests SET documents = $1 WHERE id = $2', [JSON.stringify(list), id]);
    const base = list.length - stored.length;
    return stored.map((_, i) => base + i);
  }

  /* ── Recipients + mail ─────────────────────────────────────────── */

  async function addressOf(userId) {
    if (!userId) return '';
    const u = (await q('SELECT id, email, active FROM users WHERE id = $1', [userId]))[0];
    if (!u || Number(u.active ?? 1) === 0) return '';
    const e = await notifyAddressFor(u.id, u.email);
    return e && EMAIL_RE.test(e) ? e : '';
  }
  async function peopleWithMail(ids, users) {
    const out = [];
    for (const id of ids) {
      const email = await addressOf(id);
      const u = users.find((x) => x.id === id);
      if (email) out.push({ id, name: u?.name || email, email });
    }
    return out;
  }
  const uniq = (list) => {
    const seen = new Set();
    return list.filter((e) => { const k = String(e || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  };
  const minus = (list, out) => list.filter((e) => !out.some((o) => o.toLowerCase() === e.toLowerCase()));

  async function attachmentsFor(id, ns) {
    const row = (await q('SELECT documents FROM br_requests WHERE id = $1', [id]))[0];
    const all = parseJson(row?.documents, []);
    const list = ns.map((n) => all[n]).filter(Boolean)
      .map((d) => ({ filename: d.name, path: path.join(UPLOAD_ROOT, id, path.basename(d.file)), size: d.size || 0, contentType: d.type || undefined }))
      .filter((a) => fs.existsSync(a.path));
    let total = 0;
    return list.filter((a) => (total += a.size) <= MAIL_ATTACH_MAX).map(({ size, ...a }) => a);
  }

  function summaryRows(s) {
    return [
      ['BR No.', `<b>${escHtml(s.id)}</b>`],
      ['Subject', escHtml(s.title)],
      ['Category', escHtml(s.category)],
      ['Type', escHtml(s.meeting_type)],
      ['Date of Meeting', s.meeting_date ? fmtDate(s.meeting_date) : ''],
      ['Priority', s.priority === 'Urgent' ? '<b style="color:#dc2626">URGENT</b>' : ''],
      ['Requested By', escHtml([s.requested_by_name, s.department].filter(Boolean).join(' · '))],
      ['Requirement', nl2br(s.description)],
      ['Draft Version', s.version ? `v${s.version}` : ''],
    ];
  }

  async function send(mailer, msg, tag) {
    await mailer.sendMail({ from: `"Board Resolution" <${process.env.SMTP_USER}>`, ...msg });
    console.log('[br]', tag, 'mailed to', msg.to, msg.cc ? '| cc: ' + msg.cc : '');
  }

  // Fire-and-forget: a mail problem must never fail the step that caused it.
  function notify(id, stage, { note = '', docs = [] } = {}) {
    (async () => {
      const mailer = getMailer();
      if (!mailer) { console.log('[br] mail not sent (no SMTP) —', stage, id); return; }
      const s = await fresh(id);
      const cfg = await settings();
      const requester = await addressOf(s.requested_by_id);
      // Until a CS is picked in Settings the Admins do the CS steps (see
      // rights()), so they get the CS mails too — with no CS set, a new
      // request used to mail nobody at all.
      const admins = cfg.users.filter((u) => String(u.roles || '').split(',').map((r) => r.trim()).includes('Admin')).map((u) => u.id);
      // The Admin fallback is only for when neither a CS nor an extra mail
      // address is set.
      const cs = (await peopleWithMail(cfg.cs.length ? cfg.cs : (cfg.extraEmails.length ? [] : admins), cfg.users)).map((p) => p.email);
      const subj = `${s.id} ${s.title}${s.priority === 'Urgent' ? ' [URGENT]' : ''}`;
      const noteRow = (label) => (note ? [[label, nl2br(note)]] : []);

      if (stage === 'raised' || stage === 'replied') {
        // A new request (and a reply) goes to the CS and every extra address
        // in Settings; the requester is copied below.
        let to = uniq([...cs, ...cfg.extraEmails]);
        // Nobody to draft it has a mail address: still tell the requester it
        // was received, and say why in the log.
        if (!to.length) { console.log('[br] no CS / Admin address — mailing only the requester of', id); to = uniq([requester]); }
        if (!to.length) return console.log('[br] no address at all for', id);
        const cc = minus(uniq([requester]), to);
        await send(mailer, {
          to: to.join(', '), ...(cc.length ? { cc: cc.join(', ') } : {}),
          subject: stage === 'raised' ? `New BR request: ${subj}` : `Details received: ${subj}`,
          attachments: await attachmentsFor(id, docs),
          html: mailHtml({
            heading: stage === 'raised' ? 'New Board Resolution Request' : 'Requester Replied to Your Query',
            lead: stage === 'raised'
              ? `<b>${escHtml(s.requested_by_name)}</b> has requested a board resolution. Draft it and upload it in the ERP for the Director's approval, or ask for any missing details.`
              : `<b>${escHtml(s.requested_by_name)}</b> has answered your query on <b>${escHtml(s.id)}</b>.`,
            rows: [...summaryRows(s), ...noteRow('Reply')],
            footer: docs.length ? 'The supporting documents are attached.' : '', link: pageLink(),
          }),
        }, stage);
        return;
      }

      if (stage === 'query') {
        if (!requester) return console.log('[br] no address for the requester of', id);
        const cc = minus(cs, [requester]);
        await send(mailer, {
          to: requester, ...(cc.length ? { cc: cc.join(', ') } : {}),
          subject: `Details needed: ${subj}`,
          html: mailHtml({
            heading: 'The CS Needs More Details', colour: '#d97706',
            lead: `The CS has a query on your board resolution request <b>${escHtml(s.id)}</b>. Open it in the ERP and reply with the details / documents.`,
            rows: [...noteRow('Query'), ...summaryRows(s)], link: pageLink(),
          }),
        }, 'query');
        return;
      }

      if (stage === 'drafted') {
        const dirs = await peopleWithMail(cfg.directors, cfg.users);
        const draft = latestDraft(s);
        const files = await attachmentsFor(id, draft ? [draft.n] : []);
        for (const d of dirs) {
          const url = (decision) => `${appOrigin}/br-action?t=${encodeURIComponent(tokenFor(TOKEN_NS + s.id, decision, d.email))}`;
          await send(mailer, {
            to: d.email,
            subject: `Approval needed: ${subj} — draft v${s.version}`,
            attachments: files,
            html: mailHtml({
              heading: 'Board Resolution — Your Approval Needed', colour: s.priority === 'Urgent' ? '#dc2626' : '#0150AA',
              lead: `Hi <b>${escHtml(d.name)}</b>, the CS has uploaded draft <b>v${s.version}</b> of <b>${escHtml(s.title)}</b>. Approve it, send it back with the changes you want, or reject it.`,
              rows: [...summaryRows(s), ...noteRow('Note from CS')],
              actions: mailButtons([['Approve', '#16a34a', url('approve')], ['Request Changes', '#d97706', url('changes')], ['Reject', '#dc2626', url('reject')]]),
              footer: 'The draft is attached. Each button opens a confirm page where you can write remarks — no login needed. To approve with your own edited copy, open the request in the ERP and attach it there.',
              link: pageLink(),
            }),
          }, 'drafted → ' + d.name);
        }
        return;
      }

      if (stage === 'changes' || stage === 'approved' || stage === 'rejected') {
        const to = stage === 'rejected' ? uniq([requester, ...cs]) : (cs.length ? cs : uniq([requester]));
        if (!to.length) return console.log('[br] nobody to mail for', stage, id);
        const cc = stage === 'approved' ? minus(uniq([requester]), to) : [];
        const T = {
          changes: { h: 'Changes Requested on the Draft', c: '#d97706', sub: `Changes requested: ${subj} (v${s.version})`,
            lead: `<b>${escHtml(s.decided_by_name)}</b> has sent draft v${s.version} back. Make the changes and upload the revised draft in the ERP.` },
          approved: { h: 'Board Resolution Approved', c: '#16a34a', sub: `Approved: ${subj}`,
            lead: `<b>${escHtml(s.decided_by_name)}</b> has approved <b>${escHtml(s.title)}</b>. Print it, get it signed and upload the signed copy in the ERP to close it.` },
          rejected: { h: 'Board Resolution Rejected', c: '#dc2626', sub: `Rejected: ${subj}`,
            lead: `<b>${escHtml(s.decided_by_name)}</b> has rejected <b>${escHtml(s.title)}</b>.` },
        }[stage];
        await send(mailer, {
          to: to.join(', '), ...(cc.length ? { cc: cc.join(', ') } : {}),
          subject: T.sub,
          attachments: await attachmentsFor(id, stage === 'approved' && s.final_doc != null ? [s.final_doc] : docs),
          html: mailHtml({
            heading: T.h, colour: T.c, lead: T.lead,
            rows: [[stage === 'approved' ? 'Remarks' : stage === 'changes' ? 'Changes Wanted' : 'Reason', nl2br(s.director_remarks)], ...summaryRows(s)],
            footer: stage === 'approved' ? 'The approved text is attached.' : '', link: pageLink(),
          }),
        }, stage);
        return;
      }

      if (stage === 'completed') {
        const dirs = (await peopleWithMail(cfg.directors, cfg.users)).map((p) => p.email);
        const to = uniq([requester, ...dirs]);
        const cc = minus(uniq([...cs, ...cfg.extraEmails]), to);
        if (!to.length && !cc.length) return;
        await send(mailer, {
          to: (to.length ? to : cc).join(', '), ...(to.length && cc.length ? { cc: cc.join(', ') } : {}),
          subject: `Signed copy: ${subj}`,
          attachments: await attachmentsFor(id, s.signed_doc != null ? [s.signed_doc] : []),
          html: mailHtml({
            heading: 'Board Resolution Signed & Completed', colour: '#16a34a',
            lead: `The signed copy of <b>${escHtml(s.title)}</b> (${escHtml(s.id)}) is attached.`,
            rows: [['Passed On', s.passed_date ? fmtDate(s.passed_date) : ''], ['Approved By', escHtml(s.decided_by_name)],
              ['Saved on Drive', s.drive_link ? `<a href="${escHtml(s.drive_link)}">Open</a>` : ''], ...summaryRows(s)],
            link: pageLink(),
          }),
        }, 'completed');
      }
    })().catch((e) => console.error('[br] mail', stage, id, '—', e.message));
  }

  /* ── Drive copy of the signed resolution (best effort) ─────────── */

  let folderId = null;
  async function saveToDrive(s, doc) {
    const auth = getGoogleAuth && getGoogleAuth();
    const driveId = typeof sharedDriveId === 'function' ? sharedDriveId() : sharedDriveId;
    if (!auth || !driveId) return '';
    const { google } = require('googleapis');
    const drive = google.drive({ version: 'v3', auth });
    if (!folderId) {
      folderId = process.env.BR_DRIVE_FOLDER_ID?.trim() || null;
      if (!folderId) {
        const found = await drive.files.list({
          q: `name = '${DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          corpora: 'drive', driveId, includeItemsFromAllDrives: true, supportsAllDrives: true, fields: 'files(id)', pageSize: 1,
        });
        folderId = found.data.files?.[0]?.id || (await drive.files.create({
          requestBody: { name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [driveId] }, fields: 'id', supportsAllDrives: true,
        })).data.id;
      }
    }
    const file = await drive.files.create({
      requestBody: { name: `${s.id} - ${s.title} (signed).${doc.ext}`.replace(/[\\/]/g, '-'), parents: [folderId] },
      media: { mimeType: doc.type, body: Readable.from(doc.buffer) },
      fields: 'id,webViewLink', supportsAllDrives: true,
    });
    return file.data.webViewLink || '';
  }

  /* ── Reads ─────────────────────────────────────────────────────── */

  app.get('/api/board-resolution/data', requireAuth, route(null, async (req) => {
    const me = req.br;
    const rows = await q('SELECT * FROM br_requests ORDER BY created_at DESC, id DESC');
    const requests = rows.map(reqOut).filter((s) => visible(s, me)).map((s) => ({ ...s, can: rights(s, me) }));
    const byId = new Map(me.cfg.users.map((u) => [u.id, u]));
    const out = {
      me: { id: me.user.id, name: me.user.name, department: me.user.department || '', manager: me.manager, cs: me.cs, director: me.director, all: me.all },
      requests,
      lists: { CATEGORIES, MEETING_TYPES, PRIORITIES, STATUSES, OPEN },
      cs: me.cfg.cs.map((id) => byId.get(id)?.name).filter(Boolean),
      directors: me.cfg.directors.map((id) => byId.get(id)?.name).filter(Boolean),
    };
    if (me.manager) {
      out.settings = { cs: me.cfg.cs, directors: me.cfg.directors, extraEmails: me.cfg.extraEmails, csSet: me.cfg.csSet, directorsSet: me.cfg.directorsSet };
      out.users = me.cfg.users.map((u) => ({ id: u.id, name: u.name, department: u.department || '' }));
    }
    return out;
  }));

  app.get('/api/board-resolution/requests/:id', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req.params.id, req.br);
    const log = (await q('SELECT * FROM br_log WHERE request_id = $1 ORDER BY id', [s.id]))
      .map((n) => ({ action: n.action, note: n.note || '', docs: parseJson(n.docs, []), by: n.by_name || '', at: tsOut(n.created_at) }));
    return { request: { ...s, can: rights(s, req.br) }, log };
  }));

  app.get('/api/board-resolution/requests/:id/documents/:n', requireAuth, route(null, async (req, res) => {
    const { row } = await loadReq(req.params.id, req.br);
    const doc = parseJson(row.documents, [])[parseInt(req.params.n, 10)];
    if (!doc || !doc.file) throw new UserError('Document not found', 404);
    const abs = path.join(UPLOAD_ROOT, row.id, path.basename(doc.file));
    res.download(abs, doc.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'The file is missing on the server' });
    });
  }));

  /* ── Anyone: raise ─────────────────────────────────────────────── */

  app.post('/api/board-resolution/requests', requireAuth, route(null, async (req) => {
    const me = req.br;
    const b = req.body || {};
    const title = str(b.title) || bad('Write the subject — what the resolution is for');
    const description = str(b.description, 8000) || bad('Describe what is needed in the resolution');
    const category = CATEGORIES.includes(b.category) ? b.category : bad('Choose the category');
    const meeting_type = MEETING_TYPES.includes(b.meeting_type) ? b.meeting_type : MEETING_TYPES[0];
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'Normal';
    const meeting_date = optDate(b.meeting_date, 'Date of meeting');
    const files = decodeFiles(b.documents, 'Supporting documents');
    const id = await withSeqId('br_requests', 'BR', 4, (newId) => q(
      `INSERT INTO br_requests (id, title, category, meeting_type, meeting_date, priority, description, documents, status, requested_by_id, requested_by_name, department)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'[]',$8,$9,$10,$11)`,
      [newId, title, category, meeting_type, meeting_date, priority, description, S.CS, me.user.id, me.by, str(b.department || me.user.department, 128)]));
    const stored = await writeFiles(id, files, { kind: 'request', by: me.by });
    const ns = stored.length ? await addDocs(id, { documents: '[]' }, stored) : [];
    await logStep(id, 'Requested', `${category} · ${meeting_type}${meeting_date ? ' · meeting ' + fmtDate(meeting_date) : ''}`, actor(me), ns);
    notify(id, 'raised', { docs: ns });
    return { id };
  }));

  /* ── CS: query the requester / upload a draft ──────────────────── */

  app.post('/api/board-resolution/requests/:id/query', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req.params.id, req.br);
    if (!rights(s, req.br).query) bad(`It is ${s.status} — only the CS can query a request that is with them`);
    const note = str(req.body?.note, 4000) || bad('Write what details you need from the requester');
    const r = await pool.query(`UPDATE br_requests SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, [S.QUERY, s.id, s.status]);
    if (!r.rowCount) bad('This request just changed — reload');
    await logStep(s.id, 'Query to Requester', note, actor(req.br));
    notify(s.id, 'query', { note });
    return { ok: true };
  }));

  app.post('/api/board-resolution/requests/:id/reply', requireAuth, route(null, async (req) => {
    const { s, row } = await loadReq(req.params.id, req.br);
    if (!rights(s, req.br).reply) bad(`It is ${s.status} — there is no query waiting on you`);
    const note = str(req.body?.note, 4000);
    const files = decodeFiles(req.body?.documents, 'Documents');
    if (!note && !files.length) bad('Write the details or attach the documents asked for');
    const r = await pool.query(`UPDATE br_requests SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, [S.CS, s.id, S.QUERY]);
    if (!r.rowCount) bad('This request just changed — reload');
    const ns = files.length ? await addDocs(s.id, row, await writeFiles(s.id, files, { kind: 'reply', by: req.br.by })) : [];
    await logStep(s.id, 'Replied', note, actor(req.br), ns);
    notify(s.id, 'replied', { note, docs: ns });
    return { ok: true };
  }));

  app.post('/api/board-resolution/requests/:id/draft', requireAuth, route(null, async (req) => {
    const { s, row } = await loadReq(req.params.id, req.br);
    if (!rights(s, req.br).draft) bad(`It is ${s.status} — a draft is uploaded while the request is with the CS`);
    const b = req.body || {};
    const files = decodeFiles(b.documents, 'Draft', { only: ['pdf', 'doc', 'docx'] });
    if (files.length !== 1) bad('Attach the draft resolution — one PDF or Word file');
    const note = str(b.note, 4000);
    const meeting_date = b.meeting_date !== undefined ? optDate(b.meeting_date, 'Date of meeting') : s.meeting_date;
    const meeting_type = MEETING_TYPES.includes(b.meeting_type) ? b.meeting_type : s.meeting_type;
    const v = s.version + 1;
    const r = await pool.query(
      `UPDATE br_requests SET status=$1, version=$2, meeting_date=$3, meeting_type=$4, director_remarks='', updated_at=NOW() WHERE id=$5 AND status=$6 AND version=$7`,
      [S.PENDING, v, meeting_date, meeting_type, s.id, s.status, s.version]);
    if (!r.rowCount) bad('This request just changed — reload');
    const ns = await addDocs(s.id, row, await writeFiles(s.id, files, { kind: 'draft', v, by: req.br.by }));
    await logStep(s.id, `Draft v${v} for Approval`, note, actor(req.br), ns);
    notify(s.id, 'drafted', { note });
    return { ok: true, version: v };
  }));

  /* ── Director: approve / request changes / reject ──────────────── */

  // One decision, from the app or the mail.
  async function decide(s, decision, remarks, by, files = []) {
    if (!['approve', 'changes', 'reject'].includes(decision)) bad('Choose Approve, Request Changes or Reject');
    if (decision !== 'approve' && !remarks) bad(decision === 'reject' ? 'Give the reason for rejecting' : 'Write what should be changed');
    const next = { approve: S.APPROVED, changes: S.CHANGES, reject: S.REJECTED }[decision];
    const row = (await q('SELECT * FROM br_requests WHERE id = $1', [s.id]))[0];
    let ns = [];
    if (files.length) ns = await addDocs(s.id, row, await writeFiles(s.id, files, { kind: 'director', v: s.version, by: by.name }));
    // The Director's own copy is the final text; else the draft she saw.
    const finalDoc = decision === 'approve' ? (ns[0] ?? latestDraft(reqOut(row))?.n ?? null) : null;
    const r = await pool.query(
      `UPDATE br_requests SET status=$1, director_remarks=$2, decided_by_id=$3, decided_by_name=$4, decided_at=NOW(), final_doc=$5, updated_at=NOW()
        WHERE id=$6 AND status=$7 AND version=$8`,
      [next, remarks, by.id, by.name, finalDoc, s.id, S.PENDING, s.version]);
    if (!r.rowCount) bad('This draft was just decided — reload');
    const label = { approve: files.length ? 'Approved (with modifications)' : 'Approved', changes: 'Changes Requested', reject: 'Rejected' }[decision];
    await logStep(s.id, label, `v${s.version}${remarks ? ' — ' + remarks : ''}`, by, ns);
    notify(s.id, { approve: 'approved', changes: 'changes', reject: 'rejected' }[decision], { docs: ns });
  }

  app.post('/api/board-resolution/requests/:id/decision', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req.params.id, req.br);
    if (!rights(s, req.br).decide) bad(s.status === S.PENDING ? 'Only a Director can decide' : `It is already ${s.status}`);
    const b = req.body || {};
    const files = decodeFiles(b.documents, 'Your copy', { only: ['pdf', 'doc', 'docx'] });
    if (files.length > 1) bad('Attach one file only');
    if (files.length && b.decision === 'reject') bad('A file is not needed to reject');
    await decide(s, String(b.decision || ''), str(b.remarks, 4000), actor(req.br), files);
    return { ok: true };
  }));

  /* Deciding from the Director's mail — like /qa-action: the signed token
     (request + decision + the Director's address) IS the authorisation; GET
     shows a confirm page, POST decides. A token minted for draft v1 still
     works on v2 only if it is still pending — so the page names the version
     and attaches nothing; it decides what is pending now. */
  async function forToken(token) {
    const claim = readToken(token);
    if (!claim || !claim.id.startsWith(TOKEN_NS) || !['approve', 'changes', 'reject'].includes(claim.decision)) {
      return { error: 'This link is not valid. Open Board Resolution in the ERP instead.' };
    }
    const row = (await q('SELECT * FROM br_requests WHERE id = $1', [claim.id.slice(TOKEN_NS.length)]))[0];
    if (!row) return { error: 'That board resolution request no longer exists.' };
    const s = reqOut(row);
    if (s.status !== S.PENDING) return { done: s };
    const cfg = await settings();
    const director = (await peopleWithMail(cfg.directors, cfg.users)).find((d) => d.email.toLowerCase() === String(claim.email || '').toLowerCase());
    if (!director) return { error: 'This link belongs to someone who is no longer a Director on Board Resolution.' };
    return { claim, s, director };
  }

  const LABEL = { approve: 'Approve', changes: 'Request Changes', reject: 'Reject' };
  const pageRows = (s) => [['BR No.', s.id], ['Subject', s.title], ['Category', s.category], ['Draft', s.version ? `v${s.version}` : ''],
    ['Date of Meeting', s.meeting_date ? fmtDate(s.meeting_date) : ''], ['Requested By', s.requested_by_name]];
  const failPage = (lead) => actionPage({ title: 'Link not usable', tone: 'bad', lead: escHtml(lead) });
  const donePage = (s) => actionPage({
    title: 'Nothing pending', tone: 'plain',
    lead: `${escHtml(s.id)} is <b>${escHtml(s.status)}</b>${s.decided_by_name ? ' — last decided by ' + escHtml(s.decided_by_name) : ''}. There is no draft waiting for approval.`,
    rows: pageRows(s), note: `<a href="${escHtml(pageLink())}">Open Board Resolution</a>`,
  });

  function formPage(r, token, error = '', remarks = '') {
    const { s, claim } = r;
    const d = claim.decision;
    const others = Object.keys(LABEL).filter((k) => k !== d)
      .map((k) => `<a href="/br-action?t=${encodeURIComponent(tokenFor(TOKEN_NS + s.id, k, claim.email))}">${escHtml(LABEL[k])}</a>`).join(' · ');
    return actionPage({
      title: `${LABEL[d]} ${s.id}?`,
      tone: d === 'approve' ? 'good' : d === 'reject' ? 'bad' : 'plain',
      lead: d === 'approve'
        ? `You are approving draft <b>v${s.version}</b> of <b>${escHtml(s.title)}</b>. The CS will be mailed to get it signed.`
        : d === 'changes'
          ? `Draft <b>v${s.version}</b> of <b>${escHtml(s.title)}</b> goes back to the CS with your changes.`
          : `You are rejecting <b>${escHtml(s.title)}</b>. This closes the request.`,
      rows: pageRows(s),
      form: `<form method="POST" action="/br-action">
          <input type="hidden" name="t" value="${escHtml(token)}">
          ${error ? `<p style="color:#dc2626;font-weight:600;">${escHtml(error)}</p>` : ''}
          <textarea name="remarks" rows="4" placeholder="${d === 'approve' ? 'Remarks (optional)' : d === 'changes' ? 'What should be changed (required)' : 'Reason for rejecting (required)'}"
            style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font:inherit;font-size:14px;margin:0 0 14px;">${escHtml(remarks)}</textarea>
          <button type="submit">Yes, ${escHtml(LABEL[d].toLowerCase())}</button>
        </form>`,
      note: `${others}<br>To approve with your own edited copy, <a href="${escHtml(pageLink())}">open it in the ERP</a> and attach it there.`,
    });
  }

  app.get('/br-action', async (req, res) => {
    try {
      if (!useDb) return res.status(503).send(failPage('Board Resolution needs the database.'));
      await ensureSchema();
      const r = await forToken(req.query.t);
      if (r.error) return res.status(400).send(failPage(r.error));
      if (r.done) return res.send(donePage(r.done));
      res.send(formPage(r, String(req.query.t)));
    } catch (e) {
      res.status(500).send(actionPage({ title: 'Something went wrong', tone: 'bad', lead: escHtml(e.message) }));
    }
  });

  app.post('/br-action', async (req, res) => {
    const token = String(req.body?.t || '');
    const remarks = str(req.body?.remarks, 4000);
    try {
      if (!useDb) return res.status(503).send(failPage('Board Resolution needs the database.'));
      await ensureSchema();
      const r = await forToken(token);
      if (r.error) return res.status(400).send(failPage(r.error));
      if (r.done) return res.send(donePage(r.done));
      try {
        await decide(r.s, r.claim.decision, remarks, { id: r.director.id, name: r.director.name });
      } catch (e) {
        if (e instanceof UserError) return res.status(400).send(formPage(r, token, e.message, remarks));
        throw e;
      }
      const after = await fresh(r.s.id);
      res.send(actionPage({
        title: after.status, tone: after.status === S.REJECTED ? 'bad' : after.status === S.CHANGES ? 'plain' : 'good',
        lead: after.status === S.APPROVED ? `${escHtml(after.id)} is approved. The CS has been mailed to get it signed.`
          : after.status === S.CHANGES ? `${escHtml(after.id)} has gone back to the CS with your changes. You will get the revised draft by mail.`
            : `${escHtml(after.id)} has been rejected.`,
        rows: pageRows(after), note: 'You can close this tab.',
      }));
    } catch (e) {
      res.status(500).send(actionPage({ title: 'Could not record the decision', tone: 'bad', lead: escHtml(e.message) }));
    }
  });

  /* ── CS: signed copy → Completed ───────────────────────────────── */

  app.post('/api/board-resolution/requests/:id/signed', requireAuth, route(null, async (req) => {
    const { s, row } = await loadReq(req.params.id, req.br);
    if (!rights(s, req.br).sign) bad(`It is ${s.status} — the signed copy is uploaded after the Director approves`);
    const b = req.body || {};
    const files = decodeFiles(b.documents, 'Signed copy', { only: ['pdf', 'jpg', 'png', 'webp'] });
    if (files.length !== 1) bad('Attach the signed copy — one PDF or scanned image');
    const passed_date = optDate(b.passed_date, 'Date passed') || s.meeting_date;
    const r = await pool.query(`UPDATE br_requests SET status=$1, passed_date=$2, completed_at=NOW(), updated_at=NOW() WHERE id=$3 AND status=$4`,
      [S.DONE, passed_date, s.id, S.APPROVED]);
    if (!r.rowCount) bad('This request just changed — reload');
    const ns = await addDocs(s.id, row, await writeFiles(s.id, files, { kind: 'signed', by: req.br.by }));
    await q('UPDATE br_requests SET signed_doc = $1 WHERE id = $2', [ns[0], s.id]);
    await logStep(s.id, 'Signed Copy Uploaded', str(b.note, 4000), actor(req.br), ns);
    // Drive first (so the mail can carry the link), but never let it block.
    let link = '';
    try { link = await saveToDrive(s, files[0]); } catch (e) { console.error('[br] Drive save failed for', s.id, '—', e.message); }
    if (link) await q('UPDATE br_requests SET drive_link = $1 WHERE id = $2', [link, s.id]);
    notify(s.id, 'completed');
    return { ok: true, drive_link: link };
  }));

  /* ── Resend the mail of the step it is at (Admin) ──────────────── */

  const STAGE_MAIL = {
    [S.CS]: 'raised', [S.QUERY]: 'query', [S.PENDING]: 'drafted', [S.CHANGES]: 'changes',
    [S.APPROVED]: 'approved', [S.DONE]: 'completed', [S.REJECTED]: 'rejected',
  };
  app.post('/api/board-resolution/requests/:id/resend', requireAuth, route('manager', async (req) => {
    const { s } = await loadReq(req.params.id, req.br);
    const stage = STAGE_MAIL[s.status];
    if (!stage) bad(`Nothing to mail for a ${s.status} request`);
    if (!getMailer()) bad('Mail is not set up on this server');
    const docs = stage === 'raised' ? s.docs.filter((d) => d.kind === 'request').map((d) => d.n) : [];
    notify(s.id, stage, { docs });
    await logStep(s.id, 'Mail Resent', `${stage} mail`, actor(req.br));
    return { ok: true, stage };
  }));

  /* ── Withdraw / delete ─────────────────────────────────────────── */

  app.post('/api/board-resolution/requests/:id/withdraw', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req.params.id, req.br);
    if (!rights(s, req.br).withdraw) bad(`It is ${s.status} — it can be withdrawn only before a draft is with the Director`);
    const r = await pool.query(`UPDATE br_requests SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, [S.WITHDRAWN, s.id, s.status]);
    if (!r.rowCount) bad('This request just changed — reload');
    await logStep(s.id, 'Withdrawn', str(req.body?.note, 4000), actor(req.br));
    return { ok: true };
  }));

  app.delete('/api/board-resolution/requests/:id', requireAuth, route(null, async (req) => {
    const { s } = await loadReq(req.params.id, req.br);
    if (!rights(s, req.br).del) bad('Only the owner account can delete a board resolution');
    await q('DELETE FROM br_log WHERE request_id = $1', [s.id]);
    await q('DELETE FROM br_requests WHERE id = $1', [s.id]);
    fs.promises.rm(path.join(UPLOAD_ROOT, s.id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }));

  /* ── Settings ──────────────────────────────────────────────────── */

  app.post('/api/board-resolution/settings', requireAuth, route('manager', async (req) => {
    const b = req.body || {};
    const live = new Set(req.br.cfg.users.map((u) => u.id));
    const ids = (list, label) => {
      if (!Array.isArray(list)) bad(`${label}: send a list`);
      return [...new Set(list.map(String).filter((id) => live.has(id)))];
    };
    if (b.cs !== undefined) {
      const c = ids(b.cs, 'CS');
      if (!c.length) bad('Pick at least one CS');
      await writeCfg('cs', c);
    }
    if (b.directors !== undefined) {
      const d = ids(b.directors, 'Directors');
      if (!d.length) bad('Pick at least one Director');
      await writeCfg('directors', d);
    }
    if (b.extraEmails !== undefined) {
      const list = (Array.isArray(b.extraEmails) ? b.extraEmails : []).map((e) => str(e).toLowerCase()).filter(Boolean);
      const wrong = list.find((e) => !EMAIL_RE.test(e));
      if (wrong) bad(`"${wrong}" is not a valid email address`);
      await writeCfg('extraEmails', [...new Set(list)].slice(0, 30));
    }
    return { ok: true };
  }));

  return {};
}

module.exports = { BR_SCHEMA, mountBoardResolution };
