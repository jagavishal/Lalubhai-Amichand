'use strict';
/* =====================================================================
   Bulk Email — mail a set of PDFs, one per person, to a saved master list
   ---------------------------------------------------------------------
   The yearly job this replaces: TDS gives back a folder of Part A PDFs,
   one per person, each named by PAN (AAGPS6986H_2026-27.pdf), plus a
   master sheet ("File Name, Email Ids, ...") saying who gets which file
   — and someone mails them out one by one.

   Upload. The PDFs may arrive as a ZIP, as loose files, or as a whole
   folder — the page sends every file, one request each, into one batch.
   An Excel/CSV that comes along (inside the ZIP or beside the PDFs) is
   read for its "File Name / PAN / Name / Email" columns.

   Master list. Every address that sheet carries is saved into
   bulk_mail_master, keyed by PAN when the file name holds one (else by
   the file name itself). Next year's PDFs — same PANs, new year in the
   name — match without any sheet at all, and an address typed in by hand
   for a missing row is remembered the same way.

   Send. One POST starts a background job on the server that walks the
   selected rows sequentially over a single pooled Gmail connection; the
   page polls its progress. No request ever waits on SMTP, so a slow
   Gmail conversation or a strict proxy timeout can no longer strand a
   chunk half-way. Each row records Sent/Failed with the real reason, so a
   re-run only touches the failures. An SMTP check and a "send a test to
   me" route exist so "mail is not going" gets a concrete answer.

   The PDFs sit on the server's own disk (uploads/bulk-mail/<batch>/),
   never in git and never in the DB; only the row metadata is stored. If
   a redeploy ever clears the folder, a send says exactly that per file
   and a re-upload of the same files rebuilds the batch.

   Same shape as backend/hrms.js: a self-contained CommonJS module that
   borrows the host's pool, guards and helpers via mountBulkMail(app, ctx).
   ===================================================================== */

const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'bulk-mail');

const BULK_MAIL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bulk_mail_batches (
     id VARCHAR(24) PRIMARY KEY,
     zip_name VARCHAR(255) DEFAULT '',
     master_name VARCHAR(255) DEFAULT '',
     file_count INT NOT NULL DEFAULT 0,
     uploaded_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS bulk_mail_files (
     id VARCHAR(32) PRIMARY KEY,
     batch_id VARCHAR(24) NOT NULL,
     file_name VARCHAR(255) NOT NULL,
     pan VARCHAR(32) DEFAULT '',
     doc_year VARCHAR(16) DEFAULT '',
     person_name VARCHAR(255) DEFAULT '',
     email VARCHAR(500) DEFAULT '',
     match_status VARCHAR(32) NOT NULL DEFAULT 'Ready',
     send_status VARCHAR(32) NOT NULL DEFAULT 'Pending',
     sent_at DATETIME DEFAULT NULL,
     sent_by VARCHAR(255) DEFAULT '',
     error VARCHAR(500) DEFAULT '',
     file_path VARCHAR(500) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_bmf_batch ON bulk_mail_files (batch_id)`,
  // The saved master list. mkey = PAN when the file name carries one, else
  // the lowercased file name without .pdf — see masterKey().
  `CREATE TABLE IF NOT EXISTS bulk_mail_master (
     mkey VARCHAR(255) PRIMARY KEY,
     pan VARCHAR(32) DEFAULT '',
     file_key VARCHAR(255) DEFAULT '',
     person_name VARCHAR(255) DEFAULT '',
     email VARCHAR(500) DEFAULT '',
     source VARCHAR(255) DEFAULT '',
     updated_by VARCHAR(255) DEFAULT '',
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_bmm_file_key ON bulk_mail_master (file_key)`,
  // A user's own mailbox for sending — see "Send from your own email".
  // `secret` is the Gmail App Password, AES-256-GCM encrypted (sealSecret).
  `CREATE TABLE IF NOT EXISTS bulk_mail_senders (
     user_id VARCHAR(64) PRIMARY KEY,
     email VARCHAR(255) NOT NULL,
     secret TEXT,
     enabled TINYINT NOT NULL DEFAULT 1,
     verified_at DATETIME DEFAULT NULL,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// AAGPS6986H = 5 letters, 4 digits, 1 letter.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const DEF_SUBJECT = 'Form 16 (Part A) – {year}';
const DEF_BODY = 'Dear {name},\n\nPlease find attached your Form 16 (Part A) for {year}.\n\nThis is an automated email — please do not reply.';

// "Email Ids" cells sometimes carry two addresses split by , ; or /.
// Valid when every non-empty part is an address; returned normalised.
function cleanEmails(raw) {
  const parts = String(raw || '').split(/[,;/\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length || !parts.every((p) => EMAIL_RE.test(p))) return '';
  return parts.join(', ');
}

// "AAGPS6986H_2026-27.pdf" → { base, pan: 'AAGPS6986H', year: '2026-27' }
function parsePdfName(name) {
  const base = String(name).replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
  const m = base.match(/^([A-Za-z0-9]+)[_\-\s]*(.*)$/);
  const pan = (m ? m[1] : base).toUpperCase().trim();
  return { base, pan: PAN_RE.test(pan) ? pan : '', year: (m && m[2] ? m[2] : '').trim() };
}

// File key: lowercased, without .pdf — so a sheet may say either
// "AAGPS6986H_2026-27" or "AAGPS6986H_2026-27.pdf".
const keyOf = (name) => String(name || '').trim().replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '').toLowerCase();
const baseName = (p) => String(p || '').replace(/^.*[\\/]/, '');
// Master key: the PAN when there is one (survives a change of year in the
// file name), else the file key.
const masterKey = (pan, fileKey) => (pan ? pan : fileKey);

const isPdf = (n) => /\.pdf$/i.test(n);
const isZip = (n) => /\.zip$/i.test(n);
const isSheet = (n) => /\.(xlsx|xls|csv)$/i.test(n);

/* A master sheet → [{ fileKey, pan, name, email }]. The xlsx lib reads
   .xlsx, .xls and .csv buffers alike. Header row is found by looking for
   a "file" or "pan" cell plus a "mail" cell in the first few rows; the
   name column is whatever "name" header exists (not "file name"), else
   the column right after the email one — where this sheet keeps
   "Ramesh Mama" for the rows that have no address yet. */
function parseMasterSheet(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  if (!rows.length) return [];

  let headerAt = -1, fileIdx = -1, panIdx = -1, emailIdx = -1, nameIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => String(c).toLowerCase().trim());
    const f = cells.findIndex((c) => /file/.test(c));
    const p = cells.findIndex((c) => /^pan\b/.test(c) || /pan (no|number)/.test(c));
    const e = cells.findIndex((c) => /mail/.test(c));
    if (e !== -1 && (f !== -1 || p !== -1)) {
      headerAt = i; fileIdx = f; panIdx = p; emailIdx = e;
      nameIdx = cells.findIndex((c) => /name/.test(c) && !/file/.test(c));
      break;
    }
  }
  // No recognisable header: assume "file, email, name" in the first columns.
  if (headerAt === -1) { fileIdx = 0; emailIdx = 1; nameIdx = 2; }
  else if (nameIdx === -1) nameIdx = emailIdx + 1;

  const out = [];
  for (const row of rows.slice(headerAt + 1)) {
    const fileRaw = fileIdx !== -1 ? String(row[fileIdx] || '').trim() : '';
    const panCell = panIdx !== -1 ? String(row[panIdx] || '').toUpperCase().trim() : '';
    const fileKey = keyOf(fileRaw);
    const pan = PAN_RE.test(panCell) ? panCell : (fileKey ? parsePdfName(fileRaw).pan : '');
    if (!fileKey && !pan) continue;
    out.push({ fileKey, pan, name: String(row[nameIdx] || '').trim(), email: cleanEmails(row[emailIdx]) });
  }
  return out;
}

// Turns a nodemailer error into a sentence the accounts team can act on.
function explainMailError(e) {
  const code = String(e?.code || '');
  const rc = Number(e?.responseCode || 0);
  const msg = String(e?.message || e || '').replace(/\s+/g, ' ').trim();
  if (code === 'EAUTH' || rc === 535) return 'Gmail rejected the login — check SMTP_USER / SMTP_PASS on the server (a Google App Password is required)';
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'EDNS', 'ECONNRESET'].includes(code)) {
    return 'Could not reach smtp.gmail.com from the server (outbound SMTP blocked or network down): ' + msg.slice(0, 160);
  }
  if (code === 'EENVELOPE' || (rc >= 550 && rc < 560)) return 'Recipient rejected by the mail server: ' + msg.slice(0, 260);
  if (rc === 421 || rc === 450 || rc === 451 || /quota|limit|rate/i.test(msg)) return 'Gmail is throttling this account (daily limit or too many messages) — wait and re-send the failures: ' + msg.slice(0, 200);
  return msg.slice(0, 400);
}

function mountBulkMail(app, ctx) {
  const {
    q, ensureSchema, express,
    requireAuth, requireBulkEmail, requireSuperAdmin,
    getMailer, withSeqId,
  } = ctx;

  const guard = [requireAuth, requireBulkEmail];
  const who = (req) => req.session.user?.email || req.session.user?.name || '';

  // Raw binary bodies for the file routes. The app's global express.json()
  // never sees them (the page sends application/octet-stream), so its 10mb
  // cap does not apply and nothing gets base64-inflated on the wire.
  const rawBody = express.raw({ type: (req) => !/json/i.test(req.headers['content-type'] || ''), limit: '150mb' });

  /* ── Master list ────────────────────────────────────────────────── */

  async function loadMaster() {
    const rows = await q(`SELECT * FROM bulk_mail_master`);
    const byPan = new Map(), byFile = new Map();
    for (const r of rows) {
      if (r.pan) byPan.set(r.pan, r);
      if (r.file_key) byFile.set(r.file_key, r);
      if (!r.pan && !r.file_key) byFile.set(r.mkey, r);
    }
    return { byPan, byFile, size: rows.length };
  }

  const lookup = (master, pan, fileKey) => (pan && master.byPan.get(pan)) || master.byFile.get(fileKey) || null;

  /* Upsert one master entry. An incoming row with no email must never blank
     an address we already have (the sheet often lists the person with the
     email cell empty — that is exactly the row somebody filled in by hand
     last year). Names update only when the new one is non-empty. */
  async function upsertMaster({ pan, fileKey, name, email, source, by }) {
    const mkey = masterKey(pan, fileKey);
    if (!mkey) return false;
    await q(
      `INSERT INTO bulk_mail_master (mkey, pan, file_key, person_name, email, source, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (mkey) DO UPDATE SET
         pan = CASE WHEN EXCLUDED.pan <> '' THEN EXCLUDED.pan ELSE bulk_mail_master.pan END,
         file_key = CASE WHEN EXCLUDED.file_key <> '' THEN EXCLUDED.file_key ELSE bulk_mail_master.file_key END,
         person_name = CASE WHEN EXCLUDED.person_name <> '' THEN EXCLUDED.person_name ELSE bulk_mail_master.person_name END,
         email = CASE WHEN EXCLUDED.email <> '' THEN EXCLUDED.email ELSE bulk_mail_master.email END,
         source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [mkey, pan || '', fileKey || '', name || '', email || '', (source || '').slice(0, 250), by]);
    return true;
  }

  // A sheet buffer → master upserts. Returns { rows, withEmail }.
  async function absorbSheet(buf, source, by) {
    const entries = parseMasterSheet(buf);
    let withEmail = 0;
    for (const e of entries) {
      if (await upsertMaster({ ...e, source, by }) && e.email) withEmail += 1;
    }
    return { rows: entries.length, withEmail };
  }

  /* Re-run the match for every row in a batch that is not yet Ready — after
     a sheet arrives, or after somebody typed an address into the master. */
  async function rematchBatch(batchId) {
    const rows = await q(`SELECT id, file_name, pan, email, person_name, match_status FROM bulk_mail_files WHERE batch_id = $1`, [batchId]);
    if (!rows.length) return 0;
    const master = await loadMaster();
    let changed = 0;
    for (const r of rows) {
      if (r.match_status === 'Ready' && r.email) continue;
      const hit = lookup(master, r.pan, keyOf(r.file_name));
      const email = hit ? cleanEmails(hit.email) : '';
      const status = hit ? (email ? 'Ready' : 'No Email') : 'No Match';
      const name = hit?.person_name || r.person_name || '';
      if (status === r.match_status && email === (r.email || '') && name === (r.person_name || '')) continue;
      await q(`UPDATE bulk_mail_files SET email = $1, person_name = $2, match_status = $3, error = '' WHERE id = $4`,
        [email, name, status, r.id]);
      changed += 1;
    }
    return changed;
  }

  async function batchSummary(batchId) {
    const rows = await q(
      `SELECT match_status, send_status, COUNT(*) AS c
         FROM bulk_mail_files WHERE batch_id = $1
        GROUP BY match_status, send_status`, [batchId]);
    const s = { total: 0, ready: 0, noEmail: 0, noMatch: 0, sent: 0, failed: 0 };
    for (const r of rows) {
      const c = Number(r.c) || 0;
      s.total += c;
      if (r.match_status === 'Ready') s.ready += c;
      if (r.match_status === 'No Email') s.noEmail += c;
      if (r.match_status === 'No Match') s.noMatch += c;
      if (r.send_status === 'Sent') s.sent += c;
      if (r.send_status === 'Failed') s.failed += c;
    }
    return s;
  }

  async function refreshCount(batchId) {
    await q(`UPDATE bulk_mail_batches SET file_count = (SELECT COUNT(*) FROM bulk_mail_files WHERE batch_id = $1) WHERE id = $2`, [batchId, batchId]);
  }

  /* Store one PDF into a batch and match it. A file already in the batch
     (same name) is overwritten on disk and its row kept — re-dropping the
     same folder is idempotent, not a duplicate. */
  async function addPdf(batchId, name, buf, master) {
    const { base, pan, year } = parsePdfName(name);
    const hit = lookup(master, pan, keyOf(base));
    const email = hit ? cleanEmails(hit.email) : '';
    const matchStatus = hit ? (email ? 'Ready' : 'No Email') : 'No Match';
    // The name on disk is minted here, never taken raw from the upload — a
    // crafted "../" name must not be able to write outside the batch dir.
    const safe = base.replace(/[^\w.\- ]/g, '_') + '.pdf';
    const dir = path.join(UPLOAD_ROOT, batchId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, safe), buf);
    const relPath = path.join('uploads', 'bulk-mail', batchId, safe);

    const existing = (await q(`SELECT id FROM bulk_mail_files WHERE batch_id = $1 AND file_name = $2`, [batchId, base + '.pdf']))[0];
    if (existing) {
      await q(`UPDATE bulk_mail_files SET file_path = $1 WHERE id = $2`, [relPath, existing.id]);
      return { id: existing.id, matchStatus, duplicate: true };
    }
    const n = Number((await q(`SELECT COUNT(*) AS c FROM bulk_mail_files WHERE batch_id = $1`, [batchId]))[0]?.c || 0) + 1;
    let id = `${batchId}-${String(n).padStart(4, '0')}`;
    // Ids are batch-local counters; a deleted row could make the count
    // collide with a live id, so bump until free.
    for (let bump = 0; bump < 50; bump++) {
      const taken = (await q(`SELECT id FROM bulk_mail_files WHERE id = $1`, [id]))[0];
      if (!taken) break;
      id = `${batchId}-${String(n + bump + 1).padStart(4, '0')}`;
    }
    await q(
      `INSERT INTO bulk_mail_files
         (id, batch_id, file_name, pan, doc_year, person_name, email, match_status, file_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, batchId, base + '.pdf', pan, year, hit?.person_name || '', email, matchStatus, relPath]);
    return { id, matchStatus, duplicate: false };
  }

  /* ── Batches ──────────────────────────────────────────────────────── */

  // Start an empty batch; the page then posts files into it one by one.
  app.post('/api/bulk-mail/batches', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      // Batches that never received a file (an upload that died on its first
      // request) are noise in the picker — clear the stale ones.
      await q(`DELETE FROM bulk_mail_batches WHERE file_count = 0 AND created_at < NOW() - INTERVAL 1 DAY`).catch(() => {});
      const name = String(req.body?.name || 'Upload').slice(0, 250);
      const by = who(req);
      const batchId = await withSeqId('bulk_mail_batches', 'BM', 4, async (id) => {
        await q(`INSERT INTO bulk_mail_batches (id, zip_name, master_name, file_count, uploaded_by) VALUES ($1,$2,'',0,$3)`, [id, name, by]);
      });
      res.json({ batchId });
    } catch (e) {
      console.error('[bulk-mail] create batch failed:', e);
      res.status(500).json({ error: e.message });
    }
  });

  /* One file into a batch: a PDF is stored and matched; a ZIP is opened and
     every PDF/sheet inside handled the same way; an Excel/CSV feeds the
     master list and re-matches the batch. Body = raw file bytes, name in
     ?name=. */
  app.post('/api/bulk-mail/batches/:id/files', ...guard, rawBody, async (req, res) => {
    try {
      await ensureSchema();
      const batchId = String(req.params.id);
      const batch = (await q(`SELECT id FROM bulk_mail_batches WHERE id = $1`, [batchId]))[0];
      if (!batch) return res.status(404).json({ error: 'Batch not found' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty file' });
      const name = baseName(req.query.name || '');
      if (!name) return res.status(400).json({ error: 'File name missing (?name=)' });
      const by = who(req);

      const out = { name, pdfs: 0, sheets: 0, masterRows: 0, duplicates: 0, skipped: [] };

      if (isSheet(name)) {
        let r;
        try { r = await absorbSheet(req.body, name, by); }
        catch (e) { return res.status(400).json({ error: `Could not read ${name}: ${e.message}` }); }
        if (!r.rows) return res.status(400).json({ error: `${name} has no rows with a File Name / PAN and an Email column` });
        out.sheets = 1; out.masterRows = r.rows;
        await q(`UPDATE bulk_mail_batches SET master_name = $1 WHERE id = $2`, [name.slice(0, 250), batchId]);
        await rematchBatch(batchId);
      } else if (isPdf(name)) {
        const master = await loadMaster();
        const r = await addPdf(batchId, name, req.body, master);
        out.pdfs = 1; if (r.duplicate) out.duplicates = 1;
      } else if (isZip(name)) {
        let zip;
        try { zip = new AdmZip(req.body); }
        catch { return res.status(400).json({ error: `${name} is not a readable ZIP archive` }); }
        const all = zip.getEntries().filter((e) => !e.isDirectory && !/(^|\/)__MACOSX\//.test(e.entryName) && !/(^|\/)\./.test(baseName(e.entryName)));
        const pdfs = all.filter((e) => isPdf(e.entryName));
        const sheets = all.filter((e) => isSheet(e.entryName));
        if (pdfs.length > 2000) return res.status(400).json({ error: 'ZIP holds more than 2000 PDFs — split it up' });
        // Sheets first, so the PDFs that follow match against a fresh master.
        for (const s of sheets) {
          try {
            const r = await absorbSheet(s.getData(), baseName(s.entryName), by);
            out.sheets += 1; out.masterRows += r.rows;
            await q(`UPDATE bulk_mail_batches SET master_name = $1 WHERE id = $2`, [baseName(s.entryName).slice(0, 250), batchId]);
          } catch (e) { out.skipped.push(`${baseName(s.entryName)}: ${e.message}`); }
        }
        const master = await loadMaster();
        for (const e of pdfs) {
          const r = await addPdf(batchId, e.entryName, e.getData(), master);
          out.pdfs += 1; if (r.duplicate) out.duplicates += 1;
        }
        if (sheets.length) await rematchBatch(batchId);
        if (!pdfs.length && !sheets.length) return res.status(400).json({ error: `${name} holds no PDF or Excel/CSV files` });
      } else {
        return res.status(400).json({ error: `${name}: only PDF, ZIP and Excel/CSV files are accepted` });
      }

      await refreshCount(batchId);
      res.json({ ...out, summary: await batchSummary(batchId) });
    } catch (e) {
      console.error('[bulk-mail] file upload failed:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/bulk-mail/batches', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const batches = await q(`SELECT * FROM bulk_mail_batches WHERE file_count > 0 ORDER BY id DESC LIMIT 100`);
      const out = [];
      for (const b of batches) out.push({ ...b, summary: await batchSummary(b.id) });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bulk-mail/batches/:id', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const batch = (await q(`SELECT * FROM bulk_mail_batches WHERE id = $1`, [req.params.id]))[0];
      if (!batch) return res.status(404).json({ error: 'Batch not found' });
      const files = await q(`SELECT * FROM bulk_mail_files WHERE batch_id = $1 ORDER BY id ASC`, [req.params.id]);
      res.json({ batch, files, summary: await batchSummary(req.params.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Owner-only, like every hard delete in the app. Removes the rows AND the
  // batch's PDF folder on disk.
  app.delete('/api/bulk-mail/batches/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      await ensureSchema();
      const id = String(req.params.id);
      if (job?.running && job.batchId === id) return res.status(409).json({ error: 'A send is running on this batch — stop it first' });
      await q(`DELETE FROM bulk_mail_files WHERE batch_id = $1`, [id]);
      await q(`DELETE FROM bulk_mail_batches WHERE id = $1`, [id]);
      if (/^BM\d+$/.test(id)) fs.rmSync(path.join(UPLOAD_ROOT, id), { recursive: true, force: true });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Fill in a missing address ─────────────────────────────────────
     Saved on the row AND into the master, so next year's file for the
     same PAN needs no typing. */
  app.patch('/api/bulk-mail/files/:id', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const email = cleanEmails(req.body?.email);
      if (!email) return res.status(400).json({ error: 'Enter a valid email address' });
      const row = (await q(`SELECT * FROM bulk_mail_files WHERE id = $1`, [req.params.id]))[0];
      if (!row) return res.status(404).json({ error: 'File not found' });
      const name = String(req.body?.name ?? row.person_name ?? '').trim().slice(0, 250);
      await q(`UPDATE bulk_mail_files SET email = $1, person_name = $2, match_status = 'Ready', error = '' WHERE id = $3`,
        [email, name, row.id]);
      await upsertMaster({ pan: row.pan, fileKey: keyOf(row.file_name), name, email, source: 'typed in', by: who(req) });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Master list routes ───────────────────────────────────────────── */

  app.get('/api/bulk-mail/master', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const rows = await q(`SELECT * FROM bulk_mail_master ORDER BY updated_at DESC, mkey ASC LIMIT 5000`);
      const withEmail = rows.filter((r) => r.email).length;
      const lastUpdated = rows.reduce((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null);
      res.json({ count: rows.length, withEmail, lastUpdated, rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A sheet on its own (no batch), e.g. the yearly list refreshed in advance.
  // ?batch=BMxxxx re-matches that batch afterwards.
  app.post('/api/bulk-mail/master/upload', ...guard, rawBody, async (req, res) => {
    try {
      await ensureSchema();
      const name = baseName(req.query.name || 'master.xlsx');
      if (!isSheet(name)) return res.status(400).json({ error: 'Upload an Excel (.xlsx/.xls) or CSV file' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty file' });
      let r;
      try { r = await absorbSheet(req.body, name, who(req)); }
      catch (e) { return res.status(400).json({ error: `Could not read ${name}: ${e.message}` }); }
      if (!r.rows) return res.status(400).json({ error: `${name} has no rows with a File Name / PAN and an Email column` });
      let rematched = 0;
      const batchId = String(req.query.batch || '');
      if (batchId) rematched = await rematchBatch(batchId);
      res.json({ rows: r.rows, withEmail: r.withEmail, rematched });
    } catch (e) {
      console.error('[bulk-mail] master upload failed:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Add or edit one entry by hand.
  app.post('/api/bulk-mail/master', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const pan = String(req.body?.pan || '').toUpperCase().trim();
      const fileKey = keyOf(req.body?.fileKey || '');
      const email = cleanEmails(req.body?.email);
      const name = String(req.body?.name || '').trim().slice(0, 250);
      if (pan && !PAN_RE.test(pan)) return res.status(400).json({ error: 'That is not a valid PAN (e.g. AAGPS6986H)' });
      if (!pan && !fileKey) return res.status(400).json({ error: 'Give a PAN or a file name' });
      if (!email) return res.status(400).json({ error: 'Enter a valid email address' });
      const mkey = masterKey(pan, fileKey);
      // A direct edit is allowed to change everything, unlike a sheet upsert.
      await q(
        `INSERT INTO bulk_mail_master (mkey, pan, file_key, person_name, email, source, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,'typed in',$6,NOW())
         ON CONFLICT (mkey) DO UPDATE SET
           file_key = CASE WHEN EXCLUDED.file_key <> '' THEN EXCLUDED.file_key ELSE bulk_mail_master.file_key END,
           person_name = EXCLUDED.person_name, email = EXCLUDED.email,
           source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [mkey, pan, fileKey, name, email, who(req)]);
      const batchId = String(req.body?.batchId || '');
      if (batchId) await rematchBatch(batchId);
      res.json({ ok: true, mkey });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/bulk-mail/master/:key', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      await q(`DELETE FROM bulk_mail_master WHERE mkey = $1`, [String(req.params.key)]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Mail ───────────────────────────────────────────────────────────
     A pooled transport per job: one Gmail connection reused for every
     message instead of a fresh TLS handshake + login per mail (which is
     what made five mails take twenty seconds). */
  // Bulk mail goes out as accounts@laltd.in, not the ERP's own mis@ account
  // that every other notification uses ("bulk mail mis@laltd.in se jaa raha
  // hai, isko accounts@laltd.in"). Gmail only sends as the mailbox that
  // logged in, so this needs that mailbox's own App Password:
  // BULK_MAIL_SMTP_USER / BULK_MAIL_SMTP_PASS in .env.local. Until both are
  // set it falls back to SMTP_USER / SMTP_PASS, so nothing breaks meanwhile.
  function systemAccount() {
    const u = String(process.env.BULK_MAIL_SMTP_USER || '').trim(), p = String(process.env.BULK_MAIL_SMTP_PASS || '').trim();
    const acct = u && p ? { user: u, pass: p } : { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    return { ...acct, name: 'Lallubhai Amichand', own: false };
  }

  /* ── Send from your own email ──────────────────────────────────────
     "User khud ki email ko enable kare aur uski email se mail aaye": a
     user pastes a Gmail App Password for their own mailbox once, and every
     bulk mail they send goes out as them — recipients see and reply to
     that address, not the shared account. Gmail will only send as the
     mailbox that logged in, so the password has to be that mailbox's own
     (2-Step Verification on, App Password generated at
     myaccount.google.com/apppasswords). It is verified against Gmail
     before it is saved, kept AES-256-GCM encrypted under the session
     secret, and never sent back to the browser. Switching the toggle off
     keeps the password but sends from the company account again. */
  const sealKey = () => {
    const raw = process.env.MAIL_CRED_KEY || process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET || '';
    return raw ? crypto.createHash('sha256').update(String(raw)).digest() : null;
  };
  function sealSecret(plain) {
    const key = sealKey();
    if (!key) throw new Error('NEXTAUTH_SECRET is not set on the server, so a mail password cannot be stored safely');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }
  function openSecret(sealed) {
    const key = sealKey();
    const [v, iv, tag, enc] = String(sealed || '').split('.');
    if (!key || v !== 'v1' || !iv || !tag || !enc) return '';
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
    } catch { return ''; }
  }

  const senderRow = async (req) => {
    const id = String(req.session?.user?.id || '');
    return id ? (await q(`SELECT * FROM bulk_mail_senders WHERE user_id = $1`, [id]).catch(() => []))[0] || null : null;
  };

  // The account this request's mail goes out as: the user's own mailbox when
  // they have enabled one and its password still opens, else the company's.
  async function mailAccount(req) {
    const s = await senderRow(req);
    if (s && Number(s.enabled) && s.email) {
      const pass = openSecret(s.secret);
      if (pass) return { user: s.email, pass, name: req.session?.user?.name || s.email, own: true };
    }
    return systemAccount();
  }

  function makeTransport(acct) {
    const { user, pass } = acct || {};
    if (!user || !pass) return null;
    return nodemailer.createTransport({
      service: 'gmail', auth: { user, pass },
      pool: true, maxConnections: 1, maxMessages: 200,
      connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 90000,
    });
  }

  const verifyTransport = (t) => Promise.race([
    t.verify(),
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timed out after 25s'), { code: 'ETIMEDOUT' })), 25000)),
  ]);

  const senderView = (s, sys) => ({
    system: sys.user || '',
    own: s ? { email: s.email, enabled: !!Number(s.enabled), verifiedAt: s.verified_at || null, hasPassword: !!s.secret } : null,
    loginEmail: '',
  });

  app.get('/api/bulk-mail/sender', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const v = senderView(await senderRow(req), systemAccount());
      v.loginEmail = req.session?.user?.email || '';
      res.json(v);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Save (and verify) the user's own mailbox, or just flip it on/off when
  // no new password is given.
  app.post('/api/bulk-mail/sender', ...guard, async (req, res) => {
    let t = null;
    try {
      await ensureSchema();
      const userId = String(req.session?.user?.id || '');
      if (!userId) return res.status(400).json({ error: 'No user on this session' });
      const existing = await senderRow(req);
      const email = cleanEmails(req.body?.email ?? existing?.email ?? req.session?.user?.email);
      const appPassword = String(req.body?.appPassword || '').replace(/\s+/g, '');
      const enabled = req.body?.enabled === undefined ? true : !!req.body.enabled;
      if (!email || email.includes(',')) return res.status(400).json({ error: 'Enter one valid email address' });
      if (!appPassword && !existing?.secret) return res.status(400).json({ error: 'Paste the App Password for this mailbox' });
      if (appPassword && appPassword.length < 8) return res.status(400).json({ error: 'That does not look like a Gmail App Password (16 characters)' });

      let secret = existing?.secret || null, verifiedAt = existing?.verified_at || null;
      if (appPassword || (existing && email !== existing.email)) {
        const pass = appPassword || openSecret(existing.secret);
        t = makeTransport({ user: email, pass });
        if (!t) return res.status(400).json({ error: 'Paste the App Password for this mailbox' });
        try { await verifyTransport(t); }
        catch (e) { return res.status(400).json({ error: 'Gmail did not accept this login: ' + explainMailError(e) }); }
        secret = sealSecret(pass);
        verifiedAt = new Date();
      }
      await q(
        `INSERT INTO bulk_mail_senders (user_id, email, secret, enabled, verified_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
         ON DUPLICATE KEY UPDATE email = VALUES(email), secret = VALUES(secret), enabled = VALUES(enabled), verified_at = VALUES(verified_at), updated_at = NOW()`,
        [userId, email, secret, enabled ? 1 : 0, verifiedAt],
      );
      const v = senderView(await senderRow(req), systemAccount());
      v.loginEmail = req.session?.user?.email || '';
      res.json(v);
    } catch (e) {
      console.error('[bulk-mail] sender save failed:', e.message);
      res.status(500).json({ error: e.message });
    } finally { if (t) t.close(); }
  });

  app.delete('/api/bulk-mail/sender', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      await q(`DELETE FROM bulk_mail_senders WHERE user_id = $1`, [String(req.session?.user?.id || '')]);
      const v = senderView(null, systemAccount());
      v.loginEmail = req.session?.user?.email || '';
      res.json(v);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fill = (tpl, r) => String(tpl)
    .replace(/\{name\}/g, r.person_name || 'Sir/Madam')
    .replace(/\{pan\}/g, r.pan || '')
    .replace(/\{year\}/g, r.doc_year || '')
    .replace(/\{file\}/g, r.file_name || '');

  function readPdf(r) {
    try { return fs.readFileSync(path.join(__dirname, '..', r.file_path)); }
    catch { return null; }
  }

  function buildMessage(r, subjectTpl, bodyTpl, pdf, to, acct) {
    const subject = fill(subjectTpl, r);
    const text = fill(bodyTpl, r);
    return {
      from: `"${String(acct?.name || 'Lallubhai Amichand').replace(/"/g, '')}" <${acct?.user || ''}>`,
      to,
      subject,
      text,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;border:1px solid #e2e8f0;border-radius:8px">
          <h2 style="color:#0150AA;margin:0 0 16px">${escHtml(subject)}</h2>
          <p style="color:#374151;white-space:pre-line">${escHtml(text)}</p>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px">Attachment: ${escHtml(r.file_name)}</p>
        </div>`,
      attachments: [{ filename: r.file_name, content: pdf, contentType: 'application/pdf' }],
    };
  }

  // Is the mail account usable from this server? Same login Gmail sees on a
  // real send, no message goes out.
  app.get('/api/bulk-mail/smtp-check', ...guard, async (req, res) => {
    await ensureSchema().catch(() => {});
    const acct = await mailAccount(req);
    const t = makeTransport(acct);
    if (!t) return res.json({ ok: false, error: 'SMTP_USER / SMTP_PASS are not set on the server' });
    const t0 = Date.now();
    try {
      await verifyTransport(t);
      res.json({ ok: true, user: acct.user, own: acct.own, ms: Date.now() - t0 });
    } catch (e) {
      console.error('[bulk-mail] smtp check failed:', e.code, e.message);
      res.json({ ok: false, user: acct.user, own: acct.own, error: explainMailError(e), ms: Date.now() - t0 });
    } finally { t.close(); }
  });

  // One real message, to the person clicking, with the chosen row's PDF —
  // the row itself is left untouched.
  app.post('/api/bulk-mail/send/test', ...guard, async (req, res) => {
    let t = null;
    try {
      await ensureSchema();
      const to = cleanEmails(req.session.user?.email);
      if (!to) return res.status(400).json({ error: 'Your login has no email address to send the test to' });
      const r = (await q(`SELECT * FROM bulk_mail_files WHERE id = $1`, [String(req.body?.fileId || '')]))[0];
      if (!r) return res.status(404).json({ error: 'Pick a file to send as the test' });
      const pdf = readPdf(r);
      if (!pdf) return res.status(400).json({ error: 'PDF missing on server (cleared by a redeploy?) — re-upload the files' });
      const acct = await mailAccount(req);
      t = makeTransport(acct);
      if (!t) return res.status(500).json({ error: 'Email is not configured (SMTP_USER / SMTP_PASS missing)' });
      const msg = buildMessage(r, '[TEST] ' + String(req.body?.subject || DEF_SUBJECT), String(req.body?.body || DEF_BODY), pdf, to, acct);
      await t.sendMail(msg);
      res.json({ ok: true, to, from: acct.user, subject: msg.subject });
    } catch (e) {
      console.error('[bulk-mail] test mail failed:', e.code, e.message);
      res.status(500).json({ error: explainMailError(e) });
    } finally { if (t) t.close(); }
  });

  /* ── Send job ─────────────────────────────────────────────────────
     One job at a time per process, kept in memory: the POST returns at
     once and the page polls /send/status. If the process restarts mid-way
     the job is gone but every row already sent is marked, so "Select
     unsent" resumes from where it stopped. */
  let job = null;

  const jobView = () => (job ? {
    id: job.id, batchId: job.batchId, running: job.running, cancelled: job.cancelled,
    total: job.total, done: job.done, sent: job.sent, failed: job.failed,
    current: job.current, startedAt: job.startedAt, finishedAt: job.finishedAt, by: job.by, from: job.from || '',
    lastError: job.lastError,
  } : { running: false });

  async function runJob(j, subjectTpl, bodyTpl, acct) {
    const t = makeTransport(acct);
    try {
      for (const id of j.ids) {
        if (j.cancel) { j.cancelled = true; break; }
        const r = (await q(`SELECT * FROM bulk_mail_files WHERE id = $1`, [id]))[0];
        j.current = r ? r.file_name : id;
        const fail = async (msg) => {
          j.failed += 1; j.lastError = msg;
          if (r) await q(`UPDATE bulk_mail_files SET send_status = 'Failed', error = $1 WHERE id = $2`, [msg.slice(0, 490), id]).catch(() => {});
        };
        if (!r) { await fail('File not found'); j.done += 1; continue; }
        const to = cleanEmails(r.email);
        if (!to) { await fail('No valid email on this row'); j.done += 1; continue; }
        const pdf = readPdf(r);
        if (!pdf) { await fail('PDF missing on server (cleared by a redeploy?) — re-upload the files'); j.done += 1; continue; }
        try {
          await t.sendMail(buildMessage(r, subjectTpl, bodyTpl, pdf, to, acct));
          await q(`UPDATE bulk_mail_files SET send_status = 'Sent', sent_at = NOW(), sent_by = $1, error = '' WHERE id = $2`, [j.by, id]);
          j.sent += 1;
        } catch (e) {
          console.error('[bulk-mail] send failed for', id, '→', to, ':', e.code || '', e.message);
          await fail(explainMailError(e));
        }
        j.done += 1;
        // A breath between messages keeps Gmail's rate limiter friendly.
        await new Promise((ok) => setTimeout(ok, 250));
      }
    } catch (e) {
      console.error('[bulk-mail] send job crashed:', e);
      j.lastError = String(e.message || e);
    } finally {
      j.running = false; j.current = ''; j.finishedAt = new Date().toISOString();
      try { t?.close(); } catch { /* already closed */ }
    }
  }

  app.post('/api/bulk-mail/send', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      // The account is fixed when the job starts, so a toggle flipped
      // mid-send changes the next job, never this one.
      const acct = await mailAccount(req);
      if (!acct.user || !acct.pass) return res.status(500).json({ error: 'Email is not configured (SMTP_USER / SMTP_PASS missing)' });
      if (job?.running) return res.status(409).json({ error: `A send is already running (${job.done}/${job.total}) — wait for it to finish or stop it` });
      const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 5000) : [];
      if (!ids.length) return res.status(400).json({ error: 'No files selected' });
      const batchId = String(req.body?.batchId || ids[0].replace(/-\d+$/, ''));
      job = {
        id: 'J' + Date.now().toString(36), batchId, ids, running: true, cancel: false, cancelled: false,
        total: ids.length, done: 0, sent: 0, failed: 0, current: '', lastError: '',
        startedAt: new Date().toISOString(), finishedAt: null, by: who(req), from: acct.user,
      };
      // Not awaited — the job outlives this request on purpose.
      runJob(job, String(req.body?.subject || DEF_SUBJECT), String(req.body?.body || DEF_BODY), acct);
      res.json({ ok: true, job: jobView() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bulk-mail/send/status', ...guard, (req, res) => res.json(jobView()));

  app.post('/api/bulk-mail/send/cancel', ...guard, (req, res) => {
    if (job?.running) job.cancel = true;
    res.json(jobView());
  });
}

module.exports = { BULK_MAIL_SCHEMA, mountBulkMail, parseMasterSheet, parsePdfName, cleanEmails, explainMailError };
