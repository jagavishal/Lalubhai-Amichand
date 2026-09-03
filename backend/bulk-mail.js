'use strict';
/* =====================================================================
   Bulk Email — mail a ZIP of PDFs to the addresses in its own master sheet
   ---------------------------------------------------------------------
   The yearly job this replaces: TDS gives back a folder of Part A PDFs,
   one per person, each named by PAN (AAGPS6986H_2026-27.pdf), plus a
   master sheet ("File Name, Email Ids, ...") saying who gets which file
   — and someone mails them out one by one.

   Here the whole folder comes in as one ZIP. The master Excel/CSV found
   INSIDE the ZIP is the matching source: each PDF's name is looked up in
   it, the ones with no address are surfaced as a list to fill in, and a
   second tab sends every matched PDF to its person as an attachment —
   recording per-file who got what and when, so a re-run after a bounce
   only touches the failures.

   The PDFs sit on the server's own disk (uploads/bulk-mail/<batch>/),
   never in git and never in the DB; only the row metadata is stored. If
   a redeploy ever clears the folder, a send says exactly that per file
   and a re-upload of the same ZIP rebuilds the batch.

   Same shape as backend/hrms.js: a self-contained CommonJS module that
   borrows the host's pool, guards and mailer via mountBulkMail(app, ctx).
   ===================================================================== */

const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
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
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// PAN shown per row is informative only (matching is by file name); pulled
// from the name when it looks like one. AAGPS6986H = 5 letters, 4 digits, 1.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// "Email Ids" cells sometimes carry two addresses split by , ; or /.
// Valid when every non-empty part is an address; returned normalised.
function cleanEmails(raw) {
  const parts = String(raw || '').split(/[,;/\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length || !parts.every((p) => EMAIL_RE.test(p))) return '';
  return parts.join(', ');
}

function mountBulkMail(app, ctx) {
  const {
    q, ensureSchema, express,
    requireAuth, requireBulkEmail, requireSuperAdmin,
    getMailer, withSeqId,
  } = ctx;

  const guard = [requireAuth, requireBulkEmail];

  // "AAGPS6986H_2026-27.pdf" → { base, pan: 'AAGPS6986H', year: '2026-27' }
  function parsePdfName(name) {
    const base = String(name).replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
    const m = base.match(/^([A-Za-z0-9]+)[_\-\s]*(.*)$/);
    const pan = (m ? m[1] : base).toUpperCase().trim();
    return { base, pan: PAN_RE.test(pan) ? pan : '', year: (m && m[2] ? m[2] : '').trim() };
  }

  // Lookup key: file name, lowercased, without .pdf — so the sheet may say
  // either "AAGPS6986H_2026-27" or "AAGPS6986H_2026-27.pdf".
  const keyOf = (name) => String(name || '').trim().replace(/\.pdf$/i, '').toLowerCase();

  /* The master sheet from inside the ZIP → Map(file key → { email, name }).
     The xlsx lib reads .xlsx, .xls and .csv buffers alike. Header row is
     found by looking for "file" + "mail" cells in the first few rows; the
     name column is whatever "name" header exists, else the column right
     after the email one — where this sheet keeps "Ramesh Mama" for the
     rows that have no address yet. */
  function parseMaster(buf) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    if (!rows.length) return null;

    let headerAt = -1, fileIdx = 0, emailIdx = 1, nameIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = rows[i].map((c) => String(c).toLowerCase());
      const f = cells.findIndex((c) => /file/.test(c));
      const e = cells.findIndex((c) => /mail/.test(c));
      if (f !== -1 && e !== -1) {
        headerAt = i; fileIdx = f; emailIdx = e;
        nameIdx = cells.findIndex((c) => /name/.test(c) && !/file/.test(c));
        break;
      }
    }
    if (nameIdx === -1) nameIdx = emailIdx + 1;

    const map = new Map();
    for (const row of rows.slice(headerAt + 1)) {
      const key = keyOf(row[fileIdx]);
      if (!key) continue;
      map.set(key, {
        email: cleanEmails(row[emailIdx]),
        name: String(row[nameIdx] || '').trim(),
      });
    }
    return map.size ? map : null;
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

  /* ── Upload ─────────────────────────────────────────────────────────
     The ZIP travels as a raw binary body (Content-Type: application/zip),
     not JSON — the app's global express.json() and its 10mb cap never see
     it, and nothing gets base64-inflated on the wire. express.raw() here
     is route-local for the same reason. ─────────────────────────────── */
  app.post('/api/bulk-mail/upload', ...guard,
    express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '150mb' }),
    async (req, res) => {
      try {
        await ensureSchema();
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
          return res.status(400).json({ error: 'Send the ZIP file as the request body (Content-Type: application/zip)' });
        }

        let zip;
        try { zip = new AdmZip(req.body); }
        catch { return res.status(400).json({ error: 'That file is not a readable ZIP archive' }); }

        const all = zip.getEntries().filter((e) => !e.isDirectory);
        const pdfs = all.filter((e) => /\.pdf$/i.test(e.entryName));
        const masterEntry = all.find((e) => /\.(xlsx|xls|csv)$/i.test(e.entryName));
        if (!pdfs.length) return res.status(400).json({ error: 'No PDF files found inside the ZIP' });
        if (!masterEntry) return res.status(400).json({ error: 'No master Excel/CSV found inside the ZIP — it must contain a sheet with "File Name" and "Email" columns' });
        if (pdfs.length > 2000) return res.status(400).json({ error: 'ZIP holds more than 2000 PDFs — split it up' });

        let master;
        try { master = parseMaster(masterEntry.getData()); } catch { master = null; }
        if (!master) return res.status(400).json({ error: `Could not read the master sheet (${masterEntry.entryName.replace(/^.*[\\/]/, '')}) — it needs "File Name" and "Email" columns` });

        const zipName = String(req.query.name || 'upload.zip').slice(0, 250);
        const by = req.session.user?.email || req.session.user?.name || '';

        const batchId = await withSeqId('bulk_mail_batches', 'BM', 4, async (id) => {
          await q(`INSERT INTO bulk_mail_batches (id, zip_name, master_name, file_count, uploaded_by) VALUES ($1,$2,$3,$4,$5)`,
            [id, zipName, masterEntry.entryName.replace(/^.*[\\/]/, '').slice(0, 250), pdfs.length, by]);
        });

        const dir = path.join(UPLOAD_ROOT, batchId);
        fs.mkdirSync(dir, { recursive: true });

        let n = 0;
        for (const e of pdfs) {
          n += 1;
          const { base, pan, year } = parsePdfName(e.entryName);
          const hit = master.get(keyOf(base));
          const matchStatus = hit ? (hit.email ? 'Ready' : 'No Email') : 'No Match';
          // The name on disk is minted here, never taken raw from the archive —
          // a crafted "../" entry must not be able to write outside the batch dir.
          const safe = base.replace(/[^\w.\- ]/g, '_') + '.pdf';
          fs.writeFileSync(path.join(dir, safe), e.getData());
          await q(
            `INSERT INTO bulk_mail_files
               (id, batch_id, file_name, pan, doc_year, person_name, email, match_status, file_path)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [`${batchId}-${String(n).padStart(4, '0')}`, batchId, base + '.pdf', pan, year,
             hit?.name || '', hit?.email || '', matchStatus, path.join('uploads', 'bulk-mail', batchId, safe)]);
        }

        res.json({ batchId, summary: await batchSummary(batchId) });
      } catch (e) {
        console.error('[bulk-mail] upload failed:', e);
        res.status(500).json({ error: e.message });
      }
    });

  /* ── Batches ──────────────────────────────────────────────────────── */
  app.get('/api/bulk-mail/batches', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const batches = await q(`SELECT * FROM bulk_mail_batches ORDER BY id DESC LIMIT 100`);
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
      await q(`DELETE FROM bulk_mail_files WHERE batch_id = $1`, [req.params.id]);
      await q(`DELETE FROM bulk_mail_batches WHERE id = $1`, [req.params.id]);
      const id = String(req.params.id);
      if (/^BM\d+$/.test(id)) fs.rmSync(path.join(UPLOAD_ROOT, id), { recursive: true, force: true });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Fill in a missing address ─────────────────────────────────────── */
  app.patch('/api/bulk-mail/files/:id', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const email = cleanEmails(req.body?.email);
      if (!email) return res.status(400).json({ error: 'Enter a valid email address' });
      const row = (await q(`SELECT id FROM bulk_mail_files WHERE id = $1`, [req.params.id]))[0];
      if (!row) return res.status(404).json({ error: 'File not found' });
      await q(`UPDATE bulk_mail_files SET email = $1, match_status = 'Ready', error = '' WHERE id = $2`,
        [email, row.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ── Send ───────────────────────────────────────────────────────────
     Takes a SMALL list of file ids per call — the page sends in chunks of
     five so its 45s request timeout can never outlast a Gmail conversation,
     and a progress bar falls out for free. Sequential on purpose: Gmail
     throttles parallel blasts from one account. */
  app.post('/api/bulk-mail/send', ...guard, async (req, res) => {
    try {
      await ensureSchema();
      const mailer = getMailer();
      if (!mailer) return res.status(500).json({ error: 'Email is not configured (SMTP_USER / SMTP_PASS missing)' });

      const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 10) : [];
      if (!ids.length) return res.status(400).json({ error: 'No files selected' });
      const subjectTpl = String(req.body?.subject || 'Form 16 (Part A) – {year}');
      const bodyTpl = String(req.body?.body ||
        'Dear {name},\n\nPlease find attached your Form 16 (Part A) for {year}.\n\nThis is an automated email — please do not reply.');
      const by = req.session.user?.email || req.session.user?.name || '';

      const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const fill = (tpl, r) => tpl
        .replace(/\{name\}/g, r.person_name || 'Sir/Madam')
        .replace(/\{pan\}/g, r.pan || '')
        .replace(/\{year\}/g, r.doc_year || '')
        .replace(/\{file\}/g, r.file_name || '');

      const results = [];
      for (const id of ids) {
        const r = (await q(`SELECT * FROM bulk_mail_files WHERE id = $1`, [id]))[0];
        if (!r) { results.push({ id, ok: false, error: 'File not found' }); continue; }
        const to = cleanEmails(r.email);
        if (!to) { results.push({ id, ok: false, error: 'No valid email on this row' }); continue; }

        let pdf = null;
        try { pdf = fs.readFileSync(path.join(__dirname, '..', r.file_path)); }
        catch {
          const msg = 'PDF missing on server (cleared by a redeploy?) — re-upload the ZIP';
          await q(`UPDATE bulk_mail_files SET send_status = 'Failed', error = $1 WHERE id = $2`, [msg, id]).catch(() => {});
          results.push({ id, ok: false, error: msg });
          continue;
        }

        try {
          const subject = fill(subjectTpl, r);
          const text = fill(bodyTpl, r);
          await mailer.sendMail({
            from: `"Lallubhai Amichand ERP" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;border:1px solid #e2e8f0;border-radius:8px">
                <h2 style="color:#0150AA;margin:0 0 16px">${escHtml(subject)}</h2>
                <p style="color:#374151;white-space:pre-line">${escHtml(text)}</p>
                <p style="color:#94a3b8;font-size:12px;margin-top:24px">Attachment: ${escHtml(r.file_name)}</p>
              </div>`,
            attachments: [{ filename: r.file_name, content: pdf, contentType: 'application/pdf' }],
          });
          await q(`UPDATE bulk_mail_files SET send_status = 'Sent', sent_at = NOW(), sent_by = $1, error = '' WHERE id = $2`, [by, id]);
          results.push({ id, ok: true });
        } catch (e) {
          const msg = String(e.message || e).slice(0, 490);
          await q(`UPDATE bulk_mail_files SET send_status = 'Failed', error = $1 WHERE id = $2`, [msg, id]).catch(() => {});
          results.push({ id, ok: false, error: msg });
        }
        // A breath between messages keeps Gmail's rate limiter friendly.
        await new Promise((ok) => setTimeout(ok, 300));
      }
      res.json({ results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { BULK_MAIL_SCHEMA, mountBulkMail };
