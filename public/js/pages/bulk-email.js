/* =====================================================================
   Bulk Email
   ---------------------------------------------------------------------
   Mails a ZIP of PDFs (Form 16 Part A) to the addresses in the master
   Excel/CSV that travels INSIDE the same ZIP ("File Name, Email Ids").
   Two tabs, matching how the work actually goes:

   Upload & Match — drop the ZIP in, see instantly who matched, who has
   no email in the sheet (fill it in right there), and which PDFs the
   sheet does not mention at all.

   Send Emails — the subject/body template, the tick-list of who is about
   to get mail, and the one button. Sends run in chunks of five with a
   progress bar; every row remembers Sent/Failed so a re-run after a
   bounce touches only the failures.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['bulk-email'] = (() => {
  const H = window.HR;

  let _tab = 'upload';
  let _batches = [];
  let _batchId = '';
  let _detail = null;      // { batch, files, summary }
  let _uploading = false;
  let _send = null;        // { running, total, done, sent, failed }
  let _checked = null;     // Set of file ids ticked on the Send tab

  const LS_SUBJECT = 'bulkmail.subject';
  const LS_BODY = 'bulkmail.body';
  const DEF_SUBJECT = 'Form 16 (Part A) – {year}';
  const DEF_BODY = 'Dear {name},\n\nPlease find attached your Form 16 (Part A) for {year}.\n\nThis is an automated email — please do not reply.';

  const VARIANT = { Ready: 'success', 'No Email': 'warning', 'No Match': 'danger', Sent: 'success', Failed: 'danger', Pending: 'neutral' };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');

  async function load() {
    _batches = await H.api('/api/bulk-mail/batches');
    if (!_batchId && _batches.length) _batchId = _batches[0].id;
    await loadDetail();
  }

  async function loadDetail() {
    _detail = _batchId ? await H.api('/api/bulk-mail/batches/' + encodeURIComponent(_batchId)) : null;
    // Fresh detail = fresh default selection: everything mailable not yet sent.
    _checked = new Set((_detail?.files || [])
      .filter((f) => f.email && f.send_status !== 'Sent')
      .map((f) => f.id));
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  // Every checkbox tick re-renders the page; without this, a half-typed
  // subject or body would be wiped back to the last saved one each time.
  function stashTemplate() {
    const s = document.getElementById('bm-subject');
    if (s) localStorage.setItem(LS_SUBJECT, s.value);
    const b = document.getElementById('bm-body');
    if (b) localStorage.setItem(LS_BODY, b.value);
  }

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    stashTemplate();
    const files = _detail?.files || [];
    const sendable = files.filter((f) => f.email).length;
    el.innerHTML = `<div class="animate-fade-in">
      ${H.header('Bulk Email', 'Upload a ZIP (PDFs + master Excel/CSV) and mail each PDF to its person', batchPicker())}
      ${H.tabs('bm', [
        { key: 'upload', label: 'Upload & Match', count: files.length || null },
        { key: 'send', label: 'Send Emails', count: sendable || null },
      ], _tab)}
      ${_tab === 'upload' ? uploadTab() : sendTab()}
    </div>`;
    bind();
  }

  function batchPicker() {
    if (!_batches.length) return '';
    const opts = _batches.map((b) =>
      `<option value="${H.esc(b.id)}"${b.id === _batchId ? ' selected' : ''}>${H.esc(b.id)} — ${H.esc(b.zip_name)} (${b.summary.total} files)</option>`).join('');
    return `<select id="bm-batch" style="${H.CONTROL}width:auto;min-width:230px;">${opts}</select>`;
  }

  /* ── Tab 1: Upload & Match ────────────────────────────────────────── */

  function uploadTab() {
    return uploadCard() + (_detail ? matchResults() : (_batches.length ? '' : H.empty(
      'No batches yet', 'Upload the ZIP you received — the PDFs plus a master Excel/CSV with "File Name" and "Email" columns, all in one ZIP.')));
  }

  function uploadCard() {
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:16px;
                display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <input type="file" id="bm-zip" accept=".zip,application/zip" style="font-size:13px;color:#334155;" />
      <button id="bm-upload" class="btn-primary" ${_uploading ? 'disabled' : ''}>${_uploading ? 'Uploading & matching…' : 'Upload ZIP'}</button>
      <span style="font-size:12px;color:#94a3b8;">The ZIP must hold the PDFs plus a master Excel/CSV ("File Name" and "Email" columns) — each PDF is matched to its row in that sheet.</span>
    </div>`;
  }

  function matchResults() {
    const s = _detail.summary;
    const files = _detail.files;
    const noEmail = files.filter((f) => f.match_status === 'No Email' || (f.match_status === 'No Match' && !f.email));
    const ready = files.filter((f) => f.email);

    const fixRow = (f) => [
      H.esc(f.file_name),
      H.esc(f.pan),
      f.person_name ? H.esc(f.person_name)
        : f.match_status === 'No Match' ? `<span style="color:#dc2626;font-weight:600;">Not in master sheet</span>` : '—',
      `<div style="display:flex;gap:6px;align-items:center;min-width:260px;">
         <input id="bm-em-${H.esc(f.id)}" type="email" placeholder="Enter email id…" style="${H.CONTROL}min-width:190px;" />
         <button class="btn-primary" data-save="${H.esc(f.id)}" style="white-space:nowrap;">Save</button>
       </div>`,
    ];

    return `
      ${H.stats([
        { label: 'PDFs in ZIP', value: s.total },
        { label: 'Ready to send', value: s.ready, color: '#16a34a' },
        { label: 'Email missing', value: s.noEmail, color: '#d97706' },
        { label: 'Not in master sheet', value: s.noMatch, color: '#dc2626' },
        { label: 'Already sent', value: s.sent, color: '#16a34a' },
      ])}
      ${noEmail.length ? `
        <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 8px;">
          <div style="font-size:13px;font-weight:700;color:#b45309;">Missing email ids — fill them in here (${noEmail.length})</div>
          <button id="bm-csv" class="btn-secondary" style="font-size:12px;">Download list (CSV)</button>
        </div>
        ${H.table(['File', 'PAN', 'Name', 'Email id'], noEmail.map(fixRow))}
        <div style="font-size:11.5px;color:#94a3b8;margin:6px 0 16px;">These files had no email against them in the master sheet — an email saved here applies to this batch.</div>
      ` : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;font-size:13px;color:#166534;margin-bottom:16px;">
             Every PDF has an email id — open the <b>Send Emails</b> tab to send them out.</div>`}
      <div style="font-size:13px;font-weight:700;color:#334155;margin:4px 0 8px;">Matched &amp; ready (${ready.length})</div>
      ${H.table(['File', 'PAN', 'Name', 'Email id', 'Status'],
        ready.map((f) => [H.esc(f.file_name), H.esc(f.pan), H.esc(f.person_name || '—'), H.esc(f.email),
          f.send_status === 'Sent' ? pill('Sent') + ` <span style="font-size:11px;color:#94a3b8;">${H.fmtDate(f.sent_at)}</span>` : pill(f.send_status)]),
        { maxHeight: '420px' })}`;
  }

  /* ── Tab 2: Send Emails ───────────────────────────────────────────── */

  function sendTab() {
    if (!_detail) return H.empty('No batch selected', 'Upload a ZIP on the first tab, or pick a batch from the dropdown above.');
    const files = _detail.files.filter((f) => f.email);
    if (!files.length) return H.empty('Nothing to send in this batch', 'No PDF here has an email id yet — fill them in on the Upload & Match tab.');

    const subject = localStorage.getItem(LS_SUBJECT) || DEF_SUBJECT;
    const body = localStorage.getItem(LS_BODY) || DEF_BODY;
    const nSel = files.filter((f) => _checked.has(f.id)).length;

    const rows = files.map((f) => [
      `<input type="checkbox" data-check="${H.esc(f.id)}" ${_checked.has(f.id) ? 'checked' : ''} ${_send?.running ? 'disabled' : ''} />`,
      H.esc(f.file_name),
      H.esc(f.person_name || '—'),
      H.esc(f.email),
      f.send_status === 'Sent'
        ? pill('Sent') + ` <span style="font-size:11px;color:#94a3b8;">${H.fmtDate(f.sent_at)}</span>`
        : f.send_status === 'Failed'
          ? pill('Failed') + ` <span style="font-size:11px;color:#dc2626;">${H.esc(String(f.error || '').slice(0, 80))}</span>`
          : pill('Pending'),
    ]);

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:16px;">
        ${H.grid(
          H.field('bm-subject', 'Email subject', subject, { span: 2 })
          + H.textarea('bm-body', 'Email message', body, { rows: 4, span: 2 }), 2)}
        <div style="font-size:11.5px;color:#94a3b8;margin-top:8px;">
          Placeholders: <code>{name}</code> name from the master sheet · <code>{year}</code> from the file name (e.g. 2026-27) · <code>{pan}</code> · <code>{file}</code>. The PDF goes as an attachment.</div>
      </div>
      ${_send ? progressBar() : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="bm-sel-pending" class="btn-secondary" style="font-size:12px;" ${_send?.running ? 'disabled' : ''}>Select unsent</button>
          <button id="bm-sel-none" class="btn-secondary" style="font-size:12px;" ${_send?.running ? 'disabled' : ''}>Clear selection</button>
          <span style="font-size:12.5px;color:#64748b;">${nSel} of ${files.length} selected</span>
        </div>
        <button id="bm-send" class="btn-primary" ${(!nSel || _send?.running) ? 'disabled' : ''}>
          ${_send?.running ? 'Sending…' : `Send ${nSel} Email${nSel === 1 ? '' : 's'}`}</button>
      </div>
      ${H.table([{ label: '' }, 'File', 'Name', 'Email id', 'Status'], rows, { maxHeight: '460px' })}`;
  }

  function progressBar() {
    const p = _send;
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#475569;margin-bottom:8px;">
        <span>${p.running ? 'Sending…' : 'Done.'} ${p.done} / ${p.total}</span>
        <span><b style="color:#16a34a;">${p.sent} sent</b>${p.failed ? ` · <b style="color:#dc2626;">${p.failed} failed</b>` : ''}</span>
      </div>
      <div style="height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${p.failed ? '#d97706' : '#16a34a'};transition:width .3s;"></div>
      </div>
    </div>`;
  }

  /* ── Actions ──────────────────────────────────────────────────────── */

  async function uploadZip() {
    const input = document.getElementById('bm-zip');
    const file = input?.files?.[0];
    if (!file) return H.toast('Choose a ZIP file first', 'error');
    if (!/\.zip$/i.test(file.name)) return H.toast('That is not a .zip file', 'error');
    _uploading = true; render();
    try {
      // Raw binary body, not JSON — see the upload route in backend/bulk-mail.js.
      const res = await fetch('/api/bulk-mail/upload?name=' + encodeURIComponent(file.name), {
        method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { window.location.hash = '#login'; return; }
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      _batchId = data.batchId;
      _batches = await H.api('/api/bulk-mail/batches');
      await loadDetail();
      const s = data.summary;
      H.toast(`${s.total} PDFs matched: ${s.ready} ready, ${s.noEmail + s.noMatch} need an email id`, 'success');
    } catch (e) { H.fail(e); }
    _uploading = false; render();
  }

  async function saveEmail(id) {
    const email = (document.getElementById('bm-em-' + id)?.value || '').trim();
    if (!email) return H.toast('Type the email id first', 'error');
    try {
      await H.patch('/api/bulk-mail/files/' + encodeURIComponent(id), { email });
      H.toast('Saved', 'success');
      await loadDetail(); render();
    } catch (e) { H.fail(e); }
  }

  async function sendSelected() {
    const files = (_detail?.files || []).filter((f) => f.email && _checked.has(f.id));
    if (!files.length) return;
    const subject = H.val('bm-subject') || DEF_SUBJECT;
    const body = H.val('bm-body') || DEF_BODY;
    localStorage.setItem(LS_SUBJECT, subject);
    localStorage.setItem(LS_BODY, body);

    const already = files.filter((f) => f.send_status === 'Sent').length;
    const go = () => runSend(files.map((f) => f.id), subject, body);
    H.openModal({
      id: 'bm-confirm', title: `Send ${files.length} email${files.length === 1 ? '' : 's'}?`,
      subtitle: 'Each person gets their own PDF as an attachment.',
      bodyHTML: `<div style="font-size:13px;color:#475569;line-height:1.6;">
        Batch <b>${H.esc(_batchId)}</b> — ${files.length} selected.
        ${already ? `<br><span style="color:#d97706;">⚠ ${already} of these were already sent before and will go again.</span>` : ''}
      </div>`,
      confirmText: 'Send now',
      onConfirm: async () => { H.closeModal('bm-confirm'); await go(); },
    });
  }

  async function runSend(ids, subject, body) {
    _send = { running: true, total: ids.length, done: 0, sent: 0, failed: 0 };
    render();
    const CHUNK = 5; // small chunks: each request stays far inside the 45s client timeout
    for (let i = 0; i < ids.length; i += CHUNK) {
      try {
        const { results } = await H.post('/api/bulk-mail/send', { ids: ids.slice(i, i + CHUNK), subject, body });
        for (const r of results) { _send.done++; r.ok ? _send.sent++ : _send.failed++; }
      } catch (e) {
        // A whole chunk failing (network, restart) should not silently strand
        // the rest — count it and keep going; per-row status stays truthful.
        _send.done += Math.min(CHUNK, ids.length - i);
        _send.failed += Math.min(CHUNK, ids.length - i);
      }
      render();
    }
    _send.running = false;
    await loadDetail().catch(() => {});
    render();
    H.toast(_send.failed ? `${_send.sent} sent, ${_send.failed} failed — see the Status column` : `All ${_send.sent} emails sent`,
      _send.failed ? 'error' : 'success');
  }

  /* ── Bind ─────────────────────────────────────────────────────────── */

  function bind() {
    document.querySelectorAll('[data-bm-tab]').forEach((b) =>
      b.addEventListener('click', () => { _tab = b.dataset.bmTab; render(); }));

    document.getElementById('bm-batch')?.addEventListener('change', async (e) => {
      _batchId = e.target.value; _send = null;
      try { await loadDetail(); } catch (err) { H.fail(err); }
      render();
    });

    document.getElementById('bm-upload')?.addEventListener('click', uploadZip);
    document.querySelectorAll('[data-save]').forEach((b) =>
      b.addEventListener('click', () => saveEmail(b.dataset.save)));

    document.getElementById('bm-csv')?.addEventListener('click', () => {
      const rows = (_detail?.files || []).filter((f) => !f.email)
        .map((f) => [f.file_name, f.pan, f.person_name || (f.match_status === 'No Match' ? 'Not in master sheet' : '')]);
      H.downloadCsv(`missing-emails-${_batchId}.csv`, ['File', 'PAN', 'Name'], rows);
    });

    document.querySelectorAll('[data-check]').forEach((c) =>
      c.addEventListener('change', () => {
        c.checked ? _checked.add(c.dataset.check) : _checked.delete(c.dataset.check);
        render();
      }));
    document.getElementById('bm-sel-pending')?.addEventListener('click', () => {
      _checked = new Set((_detail?.files || []).filter((f) => f.email && f.send_status !== 'Sent').map((f) => f.id));
      render();
    });
    document.getElementById('bm-sel-none')?.addEventListener('click', () => { _checked = new Set(); render(); });
    document.getElementById('bm-send')?.addEventListener('click', sendSelected);
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Loading batches…');
      try { await load(); } catch (e) { H.fail(e); }
      render();
    },
  };
})();
