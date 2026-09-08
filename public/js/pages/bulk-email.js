/* =====================================================================
   Bulk Email
   ---------------------------------------------------------------------
   Mails one PDF per person (Form 16 Part A, named by PAN) to the address
   the saved master list holds for them. Three tabs, matching how the
   work actually goes:

   Upload & Match — drop in the PDFs however they come: a ZIP, loose
   files, or a whole folder. An Excel/CSV that comes along feeds the
   master list. See instantly who matched, who has no email (fill it in
   right there — it is remembered), and which PDFs nobody knows.

   Send Emails — the subject/body template, a mail-account check, a
   "send a test to me" button, the tick-list of who is about to get mail,
   and the one big button. The send runs on the server; this page only
   polls its progress, so a slow Gmail or a strict proxy cannot strand it.

   Master List — every saved address, searchable and editable, plus the
   place to upload next year's sheet in advance.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['bulk-email'] = (() => {
  const H = window.HR;

  let _tab = 'upload';
  let _batches = [];
  let _batchId = '';
  let _detail = null;      // { batch, files, summary }
  let _master = null;      // { count, withEmail, lastUpdated, rows }
  let _pick = null;        // { files: File[], label }  — chosen, not yet uploaded
  let _upload = null;      // { running, total, done, pdfs, masterRows, errors: [] }
  let _job = null;         // server send job, polled
  let _pollTimer = null;
  let _smtp = null;        // { checking, ok, user, error, ms }
  let _checked = null;     // Set of file ids ticked on the Send tab
  let _masterSearch = '';

  const LS_SUBJECT = 'bulkmail.subject';
  const LS_BODY = 'bulkmail.body';
  const DEF_SUBJECT = 'Form 16 (Part A) – {year}';
  const DEF_BODY = 'Dear {name},\n\nPlease find attached your Form 16 (Part A) for {year}.\n\nThis is an automated email — please do not reply.';

  const VARIANT = { Ready: 'success', 'No Email': 'warning', 'No Match': 'danger', Sent: 'success', Failed: 'danger', Pending: 'neutral' };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');
  const enc = encodeURIComponent;
  const isPdf = (n) => /\.pdf$/i.test(n);
  const isZip = (n) => /\.zip$/i.test(n);
  const isSheet = (n) => /\.(xlsx|xls|csv)$/i.test(n);
  const CARD = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:16px;';

  /* ── Data ─────────────────────────────────────────────────────────── */

  async function load() {
    [_batches, _master, _job] = await Promise.all([
      H.api('/api/bulk-mail/batches'),
      H.api('/api/bulk-mail/master'),
      H.api('/api/bulk-mail/send/status').catch(() => null),
    ]);
    if (!_batchId || !_batches.some((b) => b.id === _batchId)) _batchId = _batches[0]?.id || '';
    // A job that finished a while ago is history, not a progress card.
    if (_job && !_job.running && (!_job.finishedAt || Date.now() - Date.parse(_job.finishedAt) > 3600e3)) _job = null;
    await loadDetail(true);
    if (_job?.running) startPolling();
  }

  async function loadDetail(resetSelection) {
    _detail = _batchId ? await H.api('/api/bulk-mail/batches/' + enc(_batchId)) : null;
    // Fresh detail = fresh default selection: everything mailable not yet sent.
    if (resetSelection || !_checked) {
      _checked = new Set((_detail?.files || []).filter((f) => f.email && f.send_status !== 'Sent').map((f) => f.id));
    } else {
      const live = new Set((_detail?.files || []).map((f) => f.id));
      _checked = new Set([..._checked].filter((id) => live.has(id)));
    }
  }

  async function reloadMaster() { _master = await H.api('/api/bulk-mail/master'); }

  /* ── Render ───────────────────────────────────────────────────────── */

  // Every checkbox tick re-renders the page; without this, a half-typed
  // subject or body would be wiped back to the last saved one each time.
  function stashTemplate() {
    const s = document.getElementById('bm-subject');
    if (s) localStorage.setItem(LS_SUBJECT, s.value);
    const b = document.getElementById('bm-body');
    if (b) localStorage.setItem(LS_BODY, b.value);
    const q = document.getElementById('bm-msearch');
    if (q) _masterSearch = q.value;
  }

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    stashTemplate();
    const files = _detail?.files || [];
    const sendable = files.filter((f) => f.email).length;
    el.innerHTML = `<div class="animate-fade-in" data-bm-page>
      ${H.header('Bulk Email', 'Upload PDFs (ZIP, files or a folder) and mail each one to its person', headerActions())}
      ${H.tabs('bm', [
        { key: 'upload', label: 'Upload & Match', count: files.length || null },
        { key: 'send', label: 'Send Emails', count: sendable || null },
        { key: 'master', label: 'Master List', count: _master?.count || null },
      ], _tab)}
      ${_tab === 'upload' ? uploadTab() : _tab === 'send' ? sendTab() : masterTab()}
    </div>`;
    bind();
  }

  function headerActions() {
    if (!_batches.length) return '';
    const opts = _batches.map((b) =>
      `<option value="${H.esc(b.id)}"${b.id === _batchId ? ' selected' : ''}>${H.esc(b.id)} — ${H.esc(b.zip_name)} (${b.summary.total} files, ${b.summary.sent} sent)</option>`).join('');
    return `<select id="bm-batch" style="${H.CONTROL}width:auto;min-width:230px;">${opts}</select>
      ${H.isOwner() && _batchId ? `<button id="bm-del-batch" class="btn-ghost" style="font-size:12px;color:#dc2626;">Delete batch</button>` : ''}`;
  }

  /* ── Tab 1: Upload & Match ────────────────────────────────────────── */

  function uploadTab() {
    return uploadCard() + masterStrip() + (_detail ? matchResults() : '');
  }

  const ICON_UP = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>`;

  function uploadCard() {
    if (_upload) return uploadProgress();
    if (_pick) return pickSummary();
    return `<div id="bm-drop" style="${CARD}border:2px dashed #cbd5e1;background:#fafcff;padding:34px 24px;text-align:center;transition:all .15s;cursor:pointer;">
      <div style="width:52px;height:52px;border-radius:14px;background:var(--color-primary-light);color:var(--color-primary);
                  display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">${ICON_UP}</div>
      <div style="font-size:14.5px;font-weight:700;color:#0f172a;">Drag &amp; drop the PDFs here</div>
      <div style="font-size:12.5px;color:#64748b;margin-top:4px;">A ZIP, the loose PDF files, or the whole folder — with or without the Excel/CSV list.</div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;flex-wrap:wrap;">
        <button id="bm-pick-files" class="btn-primary">Choose files</button>
        <button id="bm-pick-folder" class="btn-secondary">Choose folder</button>
        <button id="bm-pick-zip" class="btn-secondary">Choose ZIP</button>
      </div>
      <input type="file" id="bm-in-files" multiple accept=".pdf,.zip,.xlsx,.xls,.csv" style="display:none;" />
      <input type="file" id="bm-in-folder" webkitdirectory directory multiple style="display:none;" />
      <input type="file" id="bm-in-zip" accept=".zip,application/zip" style="display:none;" />
      <div style="font-size:11.5px;color:#94a3b8;margin-top:14px;">Each PDF is matched by the PAN in its name (AAGPS6986H_2026-27.pdf) against the saved master list. An Excel/CSV dropped with them ("File Name", "Email", "Name" columns) updates that list.</div>
    </div>`;
  }

  function pickSummary() {
    const fs = _pick.files;
    const pdfs = fs.filter((f) => isPdf(f.name)).length;
    const zips = fs.filter((f) => isZip(f.name)).length;
    const sheets = fs.filter((f) => isSheet(f.name)).length;
    const other = fs.length - pdfs - zips - sheets;
    const chip = (n, label, tone) => n ? `<span class="pill pill-${tone}" style="font-size:12px;padding:4px 11px;">${n} ${label}</span>` : '';
    const sheetOnly = !pdfs && !zips && sheets;
    return `<div style="${CARD}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:14px;font-weight:700;color:#0f172a;">Ready to upload</div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            ${chip(pdfs, pdfs === 1 ? 'PDF' : 'PDFs', 'brand')}${chip(zips, zips === 1 ? 'ZIP' : 'ZIPs', 'info')}
            ${chip(sheets, sheets === 1 ? 'Excel/CSV list' : 'Excel/CSV lists', 'success')}${chip(other, 'other (ignored)', 'neutral')}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="bm-pick-clear" class="btn-secondary">Clear</button>
          <button id="bm-upload" class="btn-primary" style="padding:9px 20px;font-size:13.5px;">
            ${sheetOnly ? 'Update master list' : 'Upload & match'}</button>
        </div>
      </div>
      ${sheetOnly
        ? `<div style="font-size:12.5px;color:#64748b;margin-top:12px;">Only a list was chosen — its addresses go into the master list${_batchId ? ` and batch <b>${H.esc(_batchId)}</b> is re-matched` : ''}. Add the PDFs to create a batch.</div>`
        : `<div style="margin-top:14px;max-width:420px;">${H.field('bm-label', 'Batch name', _pick.label, { hint: 'How this upload shows in the batch dropdown.' })}</div>`}
      ${!sheets && !_master?.withEmail ? `<div style="margin-top:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:10px 14px;font-size:12.5px;color:#92400e;">
        No master list is saved yet and no Excel/CSV was chosen — every PDF will land as "not in master list" until you add the sheet or type the addresses in.</div>` : ''}
    </div>`;
  }

  function uploadProgress() {
    const u = _upload;
    const pct = u.total ? Math.round((u.done / u.total) * 100) : 0;
    return `<div style="${CARD}">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#334155;margin-bottom:8px;">
        <span><b>${u.running ? 'Uploading…' : 'Upload finished.'}</b> ${u.done} / ${u.total} files</span>
        <span style="color:#64748b;">${u.pdfs} PDFs stored${u.masterRows ? ` · ${u.masterRows} list rows saved` : ''}${u.errors.length ? ` · <b style="color:#dc2626;">${u.errors.length} failed</b>` : ''}</span>
      </div>
      <div style="height:9px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${u.errors.length ? '#d97706' : 'var(--color-primary)'};transition:width .25s;"></div>
      </div>
      ${u.errors.length ? `<div style="margin-top:10px;font-size:12px;color:#b91c1c;line-height:1.6;">${u.errors.slice(0, 8).map(H.esc).join('<br>')}${u.errors.length > 8 ? '<br>…' : ''}</div>` : ''}
      ${!u.running ? `<div style="margin-top:12px;"><button id="bm-up-done" class="btn-secondary" style="font-size:12px;">OK</button></div>` : ''}
    </div>`;
  }

  function masterStrip() {
    const m = _master || { count: 0, withEmail: 0 };
    const ok = m.withEmail > 0;
    return `<div style="${CARD}padding:12px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
                ${ok ? '' : 'background:#fffbeb;border-color:#fde68a;'}">
      <div style="font-size:12.5px;color:${ok ? '#334155' : '#92400e'};">
        <b>Master list:</b> ${ok
          ? `${m.withEmail} email id${m.withEmail === 1 ? '' : 's'} saved${m.count > m.withEmail ? ` (${m.count - m.withEmail} without email)` : ''}${m.lastUpdated ? ` · updated ${H.esc(H.fmtDate(m.lastUpdated))}` : ''}. Every upload is matched against it — no need to send the Excel again.`
          : 'nothing saved yet. Upload the Excel/CSV once (with the PDFs or here) and the addresses are kept for every future upload.'}
      </div>
      <div style="display:flex;gap:8px;">
        <button id="bm-master-up" class="btn-secondary" style="font-size:12px;">Upload Excel/CSV</button>
        <button id="bm-master-open" class="btn-ghost" style="font-size:12px;">Open list</button>
        <input type="file" id="bm-in-master" accept=".xlsx,.xls,.csv" style="display:none;" />
      </div>
    </div>`;
  }

  function matchResults() {
    const s = _detail.summary;
    const files = _detail.files;
    const noEmail = files.filter((f) => !f.email);
    const ready = files.filter((f) => f.email);

    const fixRow = (f) => [
      H.esc(f.file_name),
      H.esc(f.pan || '—'),
      `<input id="bm-nm-${H.esc(f.id)}" type="text" value="${H.esc(f.person_name || '')}" placeholder="${f.match_status === 'No Match' ? 'Not in master list — name' : 'Name'}" style="${H.CONTROL}min-width:150px;" />`,
      `<div style="display:flex;gap:6px;align-items:center;min-width:280px;">
         <input id="bm-em-${H.esc(f.id)}" type="email" placeholder="Enter email id…" style="${H.CONTROL}min-width:190px;" />
         <button class="btn-primary" data-save="${H.esc(f.id)}" style="white-space:nowrap;">Save</button>
       </div>`,
    ];

    return `
      ${H.stats([
        { label: 'PDFs in batch', value: s.total },
        { label: 'Ready to send', value: s.ready, color: '#16a34a' },
        { label: 'Email missing', value: s.noEmail, color: '#d97706' },
        { label: 'Not in master list', value: s.noMatch, color: '#dc2626' },
        { label: 'Sent', value: s.sent, color: '#16a34a' },
        { label: 'Failed', value: s.failed, color: s.failed ? '#dc2626' : '#94a3b8' },
      ])}
      ${noEmail.length ? `
        <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 8px;gap:8px;flex-wrap:wrap;">
          <div style="font-size:13px;font-weight:700;color:#b45309;">Missing email ids — fill them in here (${noEmail.length})</div>
          <button id="bm-csv" class="btn-secondary" style="font-size:12px;">Download list (CSV)</button>
        </div>
        ${H.table(['File', 'PAN', 'Name', 'Email id'], noEmail.map(fixRow))}
        <div style="font-size:11.5px;color:#94a3b8;margin:6px 0 16px;">An email saved here goes into the master list too, so the same PAN needs no typing next year.</div>
      ` : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;font-size:13px;color:#166534;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
             <span>Every PDF has an email id.</span>
             <button id="bm-go-send" class="btn-primary" style="font-size:12.5px;">Go to Send Emails →</button></div>`}
      <div style="font-size:13px;font-weight:700;color:#334155;margin:4px 0 8px;">Matched &amp; ready (${ready.length})</div>
      ${H.table(['File', 'PAN', 'Name', 'Email id', 'Status'],
        ready.map((f) => [H.esc(f.file_name), H.esc(f.pan || '—'), H.esc(f.person_name || '—'), H.esc(f.email), statusCell(f)]),
        { maxHeight: '420px' })}`;
  }

  function statusCell(f) {
    if (f.send_status === 'Sent') return pill('Sent') + ` <span style="font-size:11px;color:#94a3b8;">${H.esc(H.fmtDate(f.sent_at))}</span>`;
    if (f.send_status === 'Failed') return pill('Failed') + `<div style="font-size:11px;color:#dc2626;margin-top:3px;max-width:380px;line-height:1.4;">${H.esc(f.error || '')}</div>`;
    return pill('Pending');
  }

  /* ── Tab 2: Send Emails ───────────────────────────────────────────── */

  function sendTab() {
    if (!_detail) return H.empty('No batch selected', 'Upload the PDFs on the first tab, or pick a batch from the dropdown above.');
    const files = _detail.files.filter((f) => f.email);
    if (!files.length) return H.empty('Nothing to send in this batch', 'No PDF here has an email id yet — fill them in on the Upload & Match tab.');

    const subject = localStorage.getItem(LS_SUBJECT) || DEF_SUBJECT;
    const body = localStorage.getItem(LS_BODY) || DEF_BODY;
    const nSel = files.filter((f) => _checked.has(f.id)).length;
    const running = !!_job?.running;
    const unsent = files.filter((f) => f.send_status !== 'Sent').length;
    const allTicked = files.length && files.every((f) => _checked.has(f.id));

    const rows = files.map((f) => [
      `<input type="checkbox" data-check="${H.esc(f.id)}" ${_checked.has(f.id) ? 'checked' : ''} ${running ? 'disabled' : ''} style="width:15px;height:15px;cursor:pointer;" />`,
      H.esc(f.file_name),
      H.esc(f.person_name || '—'),
      H.esc(f.email),
      statusCell(f),
    ]);

    return `
      <div style="${CARD}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="font-size:13px;font-weight:700;color:#0f172a;">Email template</div>
          ${smtpChip()}
        </div>
        ${H.grid(
          H.field('bm-subject', 'Subject', subject, { span: 2 })
          + H.textarea('bm-body', 'Message', body, { rows: 4, span: 2 }), 2)}
        <div style="font-size:11.5px;color:#94a3b8;margin-top:8px;">
          Placeholders: <code>{name}</code> · <code>{year}</code> from the file name (e.g. 2026-27) · <code>{pan}</code> · <code>{file}</code>. The PDF goes as an attachment.</div>
      </div>

      ${_job ? progressCard() : ''}

      <div style="${CARD}display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
                  ${nSel && !running ? 'border-color:var(--color-primary);box-shadow:0 0 0 3px var(--color-primary-light);' : ''}">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button id="bm-sel-pending" class="btn-secondary" style="font-size:12px;" ${running ? 'disabled' : ''}>Select unsent (${unsent})</button>
          <button id="bm-sel-all" class="btn-secondary" style="font-size:12px;" ${running ? 'disabled' : ''}>Select all (${files.length})</button>
          <button id="bm-sel-none" class="btn-ghost" style="font-size:12px;" ${running ? 'disabled' : ''}>Clear</button>
          <span style="font-size:13px;color:#334155;margin-left:4px;"><b>${nSel}</b> of ${files.length} selected</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button id="bm-test" class="btn-secondary" ${running ? 'disabled' : ''}
            title="Sends one real email, with the first selected PDF, to ${H.esc(window.currentUser?.email || 'your login email')}">Send a test to me</button>
          ${running
            ? `<button id="bm-stop" class="btn-danger" style="padding:10px 22px;font-size:14px;">Stop sending</button>`
            : `<button id="bm-send" class="btn-primary" style="padding:10px 24px;font-size:14px;" ${!nSel ? 'disabled' : ''}>
                 ${nSel ? `Send ${nSel} email${nSel === 1 ? '' : 's'}` : 'Select who to send to'}</button>`}
        </div>
      </div>
      <div id="bm-send-table" data-all="${allTicked ? '1' : ''}" data-running="${running ? '1' : ''}">
        ${H.table([{ label: '' }, 'File', 'Name', 'Email id', 'Status'], rows, { maxHeight: '480px' })}
      </div>`;
  }

  function smtpChip() {
    const s = _smtp;
    const box = (bg, border, color, inner) =>
      `<div id="bm-smtp" style="display:flex;align-items:center;gap:8px;font-size:12px;padding:6px 12px;border-radius:999px;background:${bg};border:1px solid ${border};color:${color};">${inner}</div>`;
    if (!s || s.checking) return box('#f8fafc', '#e2e8f0', '#64748b', `<span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;"></span> Checking mail account…`);
    if (s.ok) return box('#f0fdf4', '#bbf7d0', '#166534', `<span style="width:8px;height:8px;border-radius:50%;background:#16a34a;"></span> Mail account OK — ${H.esc(s.user || '')} <a href="#" id="bm-smtp-again" style="color:#166534;opacity:.7;">re-check</a>`);
    return box('#fef2f2', '#fecaca', '#b91c1c', `<span style="width:8px;height:8px;border-radius:50%;background:#dc2626;"></span> <span style="max-width:520px;">Mail problem: ${H.esc(s.error || 'unknown')}</span> <a href="#" id="bm-smtp-again" style="color:#b91c1c;opacity:.8;white-space:nowrap;">re-check</a>`);
  }

  function progressCard() {
    const p = _job;
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    const title = p.running ? `Sending… ${p.done} / ${p.total}` : p.cancelled ? `Stopped at ${p.done} / ${p.total}` : `Finished — ${p.done} / ${p.total}`;
    return `<div id="bm-progress" style="${CARD}">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#334155;margin-bottom:8px;gap:10px;flex-wrap:wrap;">
        <span><b>${title}</b>${p.running && p.current ? ` <span style="color:#64748b;">· ${H.esc(p.current)}</span>` : ''}${p.batchId && p.batchId !== _batchId ? ` <span style="color:#94a3b8;">(batch ${H.esc(p.batchId)})</span>` : ''}</span>
        <span><b style="color:#16a34a;">${p.sent} sent</b>${p.failed ? ` · <b style="color:#dc2626;">${p.failed} failed</b>` : ''}</span>
      </div>
      <div style="height:9px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${p.failed ? '#d97706' : '#16a34a'};transition:width .3s;"></div>
      </div>
      ${p.lastError ? `<div style="margin-top:9px;font-size:12px;color:#b91c1c;line-height:1.5;">Last error: ${H.esc(p.lastError)}</div>` : ''}
      ${!p.running && p.failed ? `<div style="margin-top:6px;font-size:12px;color:#64748b;">The failed rows keep their reason in the Status column — fix the cause, click <b>Select unsent</b> and send again.</div>` : ''}
    </div>`;
  }

  /* ── Tab 3: Master List ───────────────────────────────────────────── */

  function masterTab() {
    const m = _master || { count: 0, withEmail: 0, rows: [] };
    const needle = _masterSearch.trim().toLowerCase();
    const rows = (m.rows || []).filter((r) => !needle ||
      [r.pan, r.file_key, r.person_name, r.email].some((v) => String(v || '').toLowerCase().includes(needle)));
    return `
      <div style="${CARD}display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 18px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <input id="bm-msearch" type="search" value="${H.esc(_masterSearch)}" placeholder="Search PAN, name, email…" style="${H.CONTROL}width:260px;" />
          <span style="font-size:12.5px;color:#64748b;">${m.withEmail} with email · ${m.count - m.withEmail} without${m.lastUpdated ? ` · updated ${H.esc(H.fmtDate(m.lastUpdated))}` : ''}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="bm-master-up" class="btn-primary" style="font-size:12.5px;">Upload Excel/CSV</button>
          <button id="bm-master-add" class="btn-secondary" style="font-size:12.5px;">Add entry</button>
          <button id="bm-master-csv" class="btn-ghost" style="font-size:12.5px;">Download CSV</button>
          <input type="file" id="bm-in-master" accept=".xlsx,.xls,.csv" style="display:none;" />
        </div>
      </div>
      <div style="font-size:11.5px;color:#94a3b8;margin:-8px 0 12px;">A sheet uploaded here is merged in: new PANs are added, existing ones get the sheet's email unless the sheet's cell is blank. Matching uses the PAN in the file name, so next year's PDFs need no new sheet.</div>
      ${H.table(['PAN', 'File name', 'Name', 'Email id', 'Source', 'Updated', { label: '' }],
        rows.map((r) => [
          H.esc(r.pan || '—'), H.esc(r.file_key || '—'), H.esc(r.person_name || '—'),
          r.email ? H.esc(r.email) : `<span style="color:#d97706;font-weight:600;">missing</span>`,
          `<span style="font-size:11.5px;color:#94a3b8;">${H.esc(r.source || '')}</span>`,
          `<span style="font-size:11.5px;color:#94a3b8;">${H.esc(H.fmtDate(r.updated_at))}${r.updated_by ? ` · ${H.esc(r.updated_by)}` : ''}</span>`,
          `<div style="display:flex;gap:4px;white-space:nowrap;">
             <button class="btn-ghost" data-medit="${H.esc(r.mkey)}" style="font-size:12px;padding:4px 9px;">Edit</button>
             <button class="btn-ghost" data-mdel="${H.esc(r.mkey)}" style="font-size:12px;padding:4px 9px;color:#dc2626;">Delete</button>
           </div>`,
        ]), { maxHeight: '560px', empty: needle ? 'No entry matches that search' : 'No addresses saved yet — upload the Excel/CSV list' })}`;
  }

  /* ── Upload actions ───────────────────────────────────────────────── */

  // Flat file list from a drop: walks folders via the FileSystem entries API
  // so a dropped folder yields its PDFs, not one opaque directory item.
  async function filesFromDrop(dt) {
    const entries = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) return [...(dt.files || [])];
    const out = [];
    const walk = (entry) => new Promise((resolve) => {
      if (entry.isFile) return entry.file((f) => { out.push(f); resolve(); }, () => resolve());
      if (!entry.isDirectory) return resolve();
      const reader = entry.createReader();
      const readMore = () => reader.readEntries(async (list) => {
        if (!list.length) return resolve();
        for (const e of list) await walk(e);
        readMore();
      }, () => resolve());
      readMore();
    });
    for (const e of entries) await walk(e);
    return out;
  }

  function pickFiles(list, labelHint) {
    const files = [...list].filter((f) => f && f.name && !/^\./.test(f.name) && !/__MACOSX/.test(f.webkitRelativePath || ''));
    if (!files.length) return H.toast('No files chosen', 'error');
    const pdfs = files.filter((f) => isPdf(f.name));
    const zips = files.filter((f) => isZip(f.name));
    const sheets = files.filter((f) => isSheet(f.name));
    if (!pdfs.length && !zips.length && !sheets.length) return H.toast('Only PDF, ZIP and Excel/CSV files are accepted', 'error');
    const folder = (files[0].webkitRelativePath || '').split('/')[0];
    const label = labelHint || (zips.length === 1 && !pdfs.length ? zips[0].name : folder) ||
      `${pdfs.length} PDF${pdfs.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    _pick = { files, label };
    render();
  }

  async function putFile(url, file) {
    // Raw binary body, not JSON — see the file routes in backend/bulk-mail.js.
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    if (res.status === 401) { window.location.replace(window.location.pathname); throw new Error('Signed out'); }
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error(`Server error (HTTP ${res.status}) uploading ${file.name}`); }
    if (!res.ok) throw new Error(data?.error || `Upload failed for ${file.name}`);
    return data;
  }

  async function startUpload() {
    if (!_pick || _upload) return;
    const files = _pick.files;
    const sheets = files.filter((f) => isSheet(f.name));
    const zips = files.filter((f) => isZip(f.name));
    const pdfs = files.filter((f) => isPdf(f.name));
    const label = (document.getElementById('bm-label')?.value || _pick.label || 'Upload').trim();

    // A sheet on its own refreshes the master list (and re-matches the batch
    // in view) — no new batch.
    if (!pdfs.length && !zips.length) {
      _upload = { running: true, total: sheets.length, done: 0, pdfs: 0, masterRows: 0, errors: [] };
      render();
      for (const f of sheets) {
        try {
          const r = await putFile(`/api/bulk-mail/master/upload?name=${enc(f.name)}&batch=${enc(_batchId)}`, f);
          _upload.masterRows += r.rows || 0;
        } catch (e) { _upload.errors.push(e.message); }
        _upload.done += 1; render();
      }
      await finishUpload(`Master list updated — ${_upload.masterRows} rows read`);
      return;
    }

    _upload = { running: true, total: sheets.length + zips.length + pdfs.length, done: 0, pdfs: 0, masterRows: 0, errors: [] };
    render();
    let batchId;
    try {
      ({ batchId } = await H.post('/api/bulk-mail/batches', { name: label }));
    } catch (e) { _upload = null; render(); return H.fail(e); }

    const one = async (f) => {
      try {
        const r = await putFile(`/api/bulk-mail/batches/${enc(batchId)}/files?name=${enc(f.name)}`, f);
        _upload.pdfs += r.pdfs || 0;
        _upload.masterRows += r.masterRows || 0;
        for (const s of r.skipped || []) _upload.errors.push(s);
      } catch (e) { _upload.errors.push(e.message); }
      _upload.done += 1; render();
    };
    // Sheets first so the PDFs match against a fresh master; ZIPs next
    // (each is a whole batch on its own); loose PDFs three at a time.
    for (const f of sheets) await one(f);
    for (const f of zips) await one(f);
    let i = 0;
    await Promise.all([0, 1, 2].map(async () => { while (i < pdfs.length) await one(pdfs[i++]); }));

    _batchId = batchId;
    await finishUpload(null);
  }

  async function finishUpload(msg) {
    _upload.running = false;
    try {
      _batches = await H.api('/api/bulk-mail/batches');
      if (!_batches.some((b) => b.id === _batchId)) _batchId = _batches[0]?.id || '';
      await reloadMaster();
      await loadDetail(true);
    } catch (e) { H.fail(e); }
    const errs = _upload.errors.length;
    const s = _detail?.summary;
    const text = msg || (s ? `${_upload.pdfs} PDFs stored: ${s.ready} ready to send, ${s.noEmail + s.noMatch} need an email id` : 'Upload finished');
    H.toast(errs ? `${text} — ${errs} file${errs === 1 ? '' : 's'} failed` : text, errs ? 'error' : 'success');
    if (!errs) { _upload = null; _pick = null; } else { _pick = null; }
    render();
  }

  async function saveEmail(id) {
    const email = (document.getElementById('bm-em-' + id)?.value || '').trim();
    const name = (document.getElementById('bm-nm-' + id)?.value || '').trim();
    if (!email) return H.toast('Type the email id first', 'error');
    try {
      await H.patch('/api/bulk-mail/files/' + enc(id), { email, name });
      H.toast('Saved — and remembered in the master list', 'success');
      await Promise.all([loadDetail(true), reloadMaster()]);
      render();
    } catch (e) { H.fail(e); }
  }

  /* ── Send actions ─────────────────────────────────────────────────── */

  async function checkSmtp(force) {
    if (_smtp && !force) return;
    _smtp = { checking: true };
    const chip = document.getElementById('bm-smtp');
    if (chip) chip.outerHTML = smtpChip();
    try { _smtp = await H.api('/api/bulk-mail/smtp-check'); }
    catch (e) { _smtp = { ok: false, error: e.message }; }
    const again = document.getElementById('bm-smtp');
    if (again) { again.outerHTML = smtpChip(); document.getElementById('bm-smtp-again')?.addEventListener('click', (ev) => { ev.preventDefault(); checkSmtp(true); }); }
  }

  function templateValues() {
    const subject = H.val('bm-subject') || DEF_SUBJECT;
    const body = H.val('bm-body') || DEF_BODY;
    localStorage.setItem(LS_SUBJECT, subject);
    localStorage.setItem(LS_BODY, body);
    return { subject, body };
  }

  async function sendTest() {
    const files = (_detail?.files || []).filter((f) => f.email);
    const pick = files.find((f) => _checked.has(f.id)) || files[0];
    if (!pick) return H.toast('No file with an email id to test with', 'error');
    const btn = document.getElementById('bm-test');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending test…'; }
    try {
      const { subject, body } = templateValues();
      const r = await H.post('/api/bulk-mail/send/test', { fileId: pick.id, subject, body });
      H.toast(`Test sent to ${r.to} (${pick.file_name}) — check your inbox`, 'success');
    } catch (e) { H.fail(e); }
    if (btn) { btn.disabled = false; btn.textContent = 'Send a test to me'; }
  }

  function sendSelected() {
    const files = (_detail?.files || []).filter((f) => f.email && _checked.has(f.id));
    if (!files.length) return;
    const { subject, body } = templateValues();
    const already = files.filter((f) => f.send_status === 'Sent').length;
    const smtpBad = _smtp && !_smtp.checking && !_smtp.ok;
    H.openModal({
      id: 'bm-confirm', title: `Send ${files.length} email${files.length === 1 ? '' : 's'}?`,
      subtitle: 'Each person gets their own PDF as an attachment.',
      bodyHTML: `<div style="font-size:13px;color:#475569;line-height:1.7;">
        Batch <b>${H.esc(_batchId)}</b> — ${files.length} selected.<br>
        Subject: <b>${H.esc(subject)}</b>
        ${already ? `<br><span style="color:#d97706;">⚠ ${already} of these were already sent before and will go again.</span>` : ''}
        ${smtpBad ? `<br><span style="color:#dc2626;">⚠ The mail account check failed (${H.esc(_smtp.error || '')}) — the send will most likely fail too.</span>` : ''}
      </div>`,
      confirmText: 'Send now',
      onConfirm: async () => {
        const r = await H.post('/api/bulk-mail/send', { ids: files.map((f) => f.id), batchId: _batchId, subject, body });
        H.closeModal('bm-confirm');
        _job = r.job;
        render();
        startPolling();
      },
    });
  }

  async function stopSend() {
    try { _job = await H.post('/api/bulk-mail/send/cancel'); H.toast('Stopping after the current email…', 'success'); }
    catch (e) { H.fail(e); }
  }

  function startPolling() { stopPolling(); _pollTimer = setInterval(pollOnce, 1500); }
  function stopPolling() { if (_pollTimer) clearInterval(_pollTimer); _pollTimer = null; }

  async function pollOnce() {
    // The user has moved to another page: let the job run, stop asking.
    if (!document.querySelector('[data-bm-page]')) return stopPolling();
    let j;
    try { j = await H.api('/api/bulk-mail/send/status'); } catch { return; }
    if (!j) return;
    _job = j;
    if (j.running) {
      // Patch only the progress card — a full render every tick would fight
      // with anything the user is typing.
      const card = document.getElementById('bm-progress');
      if (card) card.outerHTML = progressCard();
      return;
    }
    stopPolling();
    try { await loadDetail(true); } catch { /* keep what we have */ }
    render();
    H.toast(j.failed ? `${j.sent} sent, ${j.failed} failed — see the Status column` : j.cancelled ? `Stopped: ${j.sent} sent` : `All ${j.sent} emails sent`,
      j.failed ? 'error' : 'success');
  }

  /* ── Master actions ───────────────────────────────────────────────── */

  async function uploadMasterSheet(file) {
    if (!file) return;
    if (!isSheet(file.name)) return H.toast('Upload an Excel (.xlsx/.xls) or CSV file', 'error');
    H.toast(`Reading ${file.name}…`, 'success');
    try {
      const r = await putFile(`/api/bulk-mail/master/upload?name=${enc(file.name)}&batch=${enc(_batchId)}`, file);
      await Promise.all([reloadMaster(), loadDetail(true)]);
      H.toast(`${r.rows} rows read, ${r.withEmail} with email${r.rematched ? ` · ${r.rematched} file${r.rematched === 1 ? '' : 's'} in ${_batchId} matched` : ''}`, 'success');
      render();
    } catch (e) { H.fail(e); }
  }

  function masterForm(entry) {
    const isNew = !entry;
    const e = entry || { pan: '', file_key: '', person_name: '', email: '' };
    H.openModal({
      id: 'bm-mform', title: isNew ? 'Add to master list' : 'Edit entry',
      subtitle: 'Matched by PAN when the file name carries one, else by the file name.',
      bodyHTML: H.grid(
        H.field('bm-mf-pan', 'PAN', e.pan, { placeholder: 'AAGPS6986H', readonly: !isNew && !!e.pan })
        + H.field('bm-mf-file', 'File name (optional)', e.file_key, { placeholder: 'AAGPS6986H_2026-27', readonly: !isNew && !e.pan })
        + H.field('bm-mf-name', 'Name', e.person_name)
        + H.field('bm-mf-email', 'Email id', e.email, { type: 'email', required: true, hint: 'Two addresses may be separated by a comma.' }), 2),
      confirmText: isNew ? 'Add' : 'Save',
      onConfirm: async () => {
        await H.post('/api/bulk-mail/master', {
          pan: H.val('bm-mf-pan'), fileKey: H.val('bm-mf-file'), name: H.val('bm-mf-name'), email: H.val('bm-mf-email'), batchId: _batchId,
        });
        H.closeModal('bm-mform');
        await Promise.all([reloadMaster(), loadDetail(false)]);
        H.toast('Saved', 'success');
        render();
      },
    });
  }

  async function deleteMaster(mkey) {
    const r = (_master?.rows || []).find((x) => x.mkey === mkey);
    H.openModal({
      id: 'bm-mdel', title: 'Remove this entry?', bodyHTML: `<div style="font-size:13px;color:#475569;">${H.esc(r?.pan || r?.file_key || mkey)} — ${H.esc(r?.person_name || '')} ${H.esc(r?.email || '')}</div>`,
      confirmText: 'Remove',
      onConfirm: async () => {
        await H.del('/api/bulk-mail/master/' + enc(mkey));
        H.closeModal('bm-mdel');
        await reloadMaster(); render();
      },
    });
  }

  function deleteBatch() {
    H.openModal({
      id: 'bm-bdel', title: `Delete batch ${_batchId}?`,
      bodyHTML: `<div style="font-size:13px;color:#475569;line-height:1.6;">Removes its ${_detail?.files?.length || 0} PDFs from the server and the sent/failed record for this batch. The master list is not touched.</div>`,
      confirmText: 'Delete',
      onConfirm: async () => {
        await H.del('/api/bulk-mail/batches/' + enc(_batchId));
        H.closeModal('bm-bdel');
        _batchId = ''; _job = null;
        await load(); render();
      },
    });
  }

  /* ── Bind ─────────────────────────────────────────────────────────── */

  const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

  function bind() {
    document.querySelectorAll('[data-bm-tab]').forEach((b) =>
      b.addEventListener('click', () => { _tab = b.dataset.bmTab; render(); if (_tab === 'send') checkSmtp(false); }));
    if (_tab === 'send') checkSmtp(false);

    on('bm-batch', 'change', async (e) => {
      _batchId = e.target.value;
      try { await loadDetail(true); } catch (err) { H.fail(err); }
      render();
    });
    on('bm-del-batch', 'click', deleteBatch);

    // Upload tab
    const drop = document.getElementById('bm-drop');
    if (drop) {
      const hi = (onOff) => { drop.style.borderColor = onOff ? 'var(--color-primary)' : '#cbd5e1'; drop.style.background = onOff ? 'var(--color-primary-light)' : '#fafcff'; };
      drop.addEventListener('dragover', (e) => { e.preventDefault(); hi(true); });
      drop.addEventListener('dragleave', () => hi(false));
      drop.addEventListener('drop', async (e) => {
        e.preventDefault(); hi(false);
        const files = await filesFromDrop(e.dataTransfer);
        pickFiles(files);
      });
      drop.addEventListener('click', (e) => { if (!e.target.closest('button')) document.getElementById('bm-in-files')?.click(); });
    }
    on('bm-pick-files', 'click', (e) => { e.stopPropagation(); document.getElementById('bm-in-files')?.click(); });
    on('bm-pick-folder', 'click', (e) => { e.stopPropagation(); document.getElementById('bm-in-folder')?.click(); });
    on('bm-pick-zip', 'click', (e) => { e.stopPropagation(); document.getElementById('bm-in-zip')?.click(); });
    on('bm-in-files', 'change', (e) => pickFiles(e.target.files));
    on('bm-in-folder', 'change', (e) => pickFiles(e.target.files));
    on('bm-in-zip', 'change', (e) => pickFiles(e.target.files, e.target.files[0]?.name));
    on('bm-pick-clear', 'click', () => { _pick = null; render(); });
    on('bm-upload', 'click', startUpload);
    on('bm-up-done', 'click', () => { _upload = null; render(); });
    on('bm-go-send', 'click', () => { _tab = 'send'; render(); checkSmtp(false); });
    on('bm-master-open', 'click', () => { _tab = 'master'; render(); });
    on('bm-master-up', 'click', () => document.getElementById('bm-in-master')?.click());
    on('bm-in-master', 'change', (e) => uploadMasterSheet(e.target.files[0]));
    document.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => saveEmail(b.dataset.save)));
    document.querySelectorAll('[id^="bm-em-"]').forEach((inp) =>
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEmail(inp.id.slice(6)); }));
    on('bm-csv', 'click', () => {
      const rows = (_detail?.files || []).filter((f) => !f.email)
        .map((f) => [f.file_name, f.pan, f.person_name || (f.match_status === 'No Match' ? 'Not in master list' : '')]);
      H.downloadCsv(`missing-emails-${_batchId}.csv`, ['File', 'PAN', 'Name'], rows);
    });

    // Send tab
    document.querySelectorAll('[data-check]').forEach((c) =>
      c.addEventListener('change', () => { c.checked ? _checked.add(c.dataset.check) : _checked.delete(c.dataset.check); render(); }));
    const wrap = document.getElementById('bm-send-table');
    const th0 = wrap?.querySelector('thead th');
    if (th0) th0.innerHTML = `<input type="checkbox" id="bm-check-all" ${wrap.dataset.all ? 'checked' : ''} ${wrap.dataset.running ? 'disabled' : ''} style="width:15px;height:15px;cursor:pointer;" title="Tick / untick everything" />`;
    on('bm-check-all', 'change', (e) => {
      const files = (_detail?.files || []).filter((f) => f.email);
      _checked = e.target.checked ? new Set(files.map((f) => f.id)) : new Set();
      render();
    });
    on('bm-sel-pending', 'click', () => {
      _checked = new Set((_detail?.files || []).filter((f) => f.email && f.send_status !== 'Sent').map((f) => f.id)); render();
    });
    on('bm-sel-all', 'click', () => { _checked = new Set((_detail?.files || []).filter((f) => f.email).map((f) => f.id)); render(); });
    on('bm-sel-none', 'click', () => { _checked = new Set(); render(); });
    on('bm-send', 'click', sendSelected);
    on('bm-stop', 'click', stopSend);
    on('bm-test', 'click', sendTest);
    on('bm-smtp-again', 'click', (e) => { e.preventDefault(); checkSmtp(true); });

    // Master tab
    on('bm-msearch', 'input', (e) => {
      _masterSearch = e.target.value;
      clearTimeout(bind._t); bind._t = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = document.getElementById('bm-msearch'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 200);
    });
    on('bm-master-add', 'click', () => masterForm(null));
    on('bm-master-csv', 'click', () => H.downloadCsv('bulk-email-master.csv', ['PAN', 'File name', 'Name', 'Email id'],
      (_master?.rows || []).map((r) => [r.pan, r.file_key, r.person_name, r.email])));
    document.querySelectorAll('[data-medit]').forEach((b) => b.addEventListener('click', () =>
      masterForm((_master?.rows || []).find((r) => r.mkey === b.dataset.medit))));
    document.querySelectorAll('[data-mdel]').forEach((b) => b.addEventListener('click', () => deleteMaster(b.dataset.mdel)));
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Loading batches…');
      stopPolling();
      try { await load(); } catch (e) { H.fail(e); }
      render();
    },
  };
})();
