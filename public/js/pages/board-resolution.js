/* =====================================================================
   Board Resolution (route 'board-resolution')
   ---------------------------------------------------------------------
   Anyone requests a resolution → the CS drafts it (or asks for details)
   → a Director approves / requests changes / rejects (here or from the
   mail; the CS ⇄ Director loop repeats until approved) → the CS uploads
   the signed copy. Server side and the full flow:
   backend/board-resolution.js. Built on window.HR like Quotation Approval.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['board-resolution'] = (() => {
  const H = window.HR;
  const esc = H.esc;

  let D = null;              // /api/board-resolution/data
  let _tab = 'action';
  const _f = { q: '', status: 'Open', category: 'All' };

  const VARIANT = {
    'With CS': 'info', 'Query to Requester': 'warning', 'Pending Director Approval': 'warning', 'Changes Requested': 'purple',
    'Approved – Awaiting Signed Copy': 'info', Completed: 'success', Rejected: 'danger', Withdrawn: 'neutral', Urgent: 'danger',
  };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');
  const needsMe = (s) => s.can.draft || s.can.reply || s.can.decide || s.can.sign;
  const docHref = (id, n) => `/api/board-resolution/requests/${encodeURIComponent(id)}/documents/${n}`;
  const KIND = { request: 'Supporting', reply: 'Requester reply', draft: 'Draft', director: "Director's copy", signed: 'Signed copy' };

  // How long it has been open — the process is meant to take a day.
  function age(s) {
    const end = s.completed_at || (['Rejected', 'Withdrawn'].includes(s.status) ? s.updated_at : null) || new Date().toISOString();
    const h = Math.max(0, (new Date(end) - new Date(s.created_at)) / 3600000);
    return h < 24 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
  }

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function load() {
    D = await H.api('/api/board-resolution/data');
    if (!tabsFor().some((t) => t.key === _tab)) _tab = D.me.all ? 'action' : 'mine';
  }
  async function refresh() {
    try { await load(); render(); } catch (e) { H.fail(e); }
  }

  function tabsFor() {
    const t = [];
    const act = D.requests.filter(needsMe).length;
    if (D.me.all || act) t.push({ key: 'action', label: 'Needs My Action', count: act });
    t.push({ key: 'mine', label: 'My Requests', count: D.requests.filter((s) => s.requested_by_id === D.me.id).length });
    if (D.me.all) t.push({ key: 'all', label: 'All Resolutions', count: D.requests.length });
    if (D.me.register) t.push({ key: 'register', label: 'Register', count: (D.register || []).filter((e) => e.fy === D.regLists.currentFy && e.status === 'Final').length });
    if (D.me.manager) t.push({ key: 'settings', label: 'Settings' });
    return t;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        @media (max-width: 767px) {
          .br-filt { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px !important; }
          .br-filt > input, .br-filt > select { max-width:none !important; min-height:40px; }
          .br-filt > input { grid-column:1 / -1; }
          .br-two { grid-template-columns:1fr !important; }
        }
        .br-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px; }
        .br-card h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:0 0 10px; }
        .br-link { color:var(--color-primary);cursor:pointer;font-weight:600;background:none;border:none;padding:0;font:inherit;text-align:left; }
        .br-link:hover { text-decoration:underline; }
        .br-doc { display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--color-primary);font-weight:600;word-break:break-all;padding:3px 0;text-decoration:none; }
        .br-doc:hover { text-decoration:underline; }
      </style>
      ${H.header('Board Resolution', 'Request → CS drafts → Director approves → signed copy',
        '<button id="br-new" class="btn-primary btn-sm">+ Request a Resolution</button>')}
      ${H.tabs('br', tabsFor(), _tab)}
      ${_tab === 'settings' ? settingsTab() : _tab === 'register' ? registerTab() : listTab()}
    </div>`;
    bind();
  }

  /* ── List ─────────────────────────────────────────────────────────── */

  function actionLabel(s) {
    if (s.can.decide) return 'Review & Approve';
    if (s.can.draft) return s.status === 'Changes Requested' ? 'Upload Revised Draft' : 'Upload Draft';
    if (s.can.reply) return 'Reply to CS';
    if (s.can.sign) return 'Upload Signed Copy';
    return 'Open';
  }

  function listTab() {
    const n = _f.q.trim().toLowerCase();
    const base = _tab === 'action' ? D.requests.filter(needsMe)
      : _tab === 'mine' ? D.requests.filter((s) => s.requested_by_id === D.me.id) : D.requests;
    const list = base.filter((s) => {
      if (_tab !== 'action') {
        if (_f.status === 'Open' && !D.lists.OPEN.includes(s.status)) return false;
        if (_f.status !== 'Open' && _f.status !== 'All' && s.status !== _f.status) return false;
      }
      if (_f.category !== 'All' && s.category !== _f.category) return false;
      if (n && ![s.id, s.title, s.category, s.requested_by_name, s.department, s.description].join(' ').toLowerCase().includes(n)) return false;
      return true;
    });
    const all = D.requests;
    const count = (st) => all.filter((s) => st.includes(s.status)).length;
    const tiles = D.me.all ? [
      { label: 'With CS', value: count(['With CS', 'Changes Requested']) },
      { label: 'Query to Requester', value: count(['Query to Requester']), color: '#d97706' },
      { label: 'Pending Director', value: count(['Pending Director Approval']), color: '#d97706' },
      { label: 'Awaiting Signature', value: count(['Approved – Awaiting Signed Copy']) },
      { label: 'Completed', value: count(['Completed']), color: '#16a34a' },
    ] : [];
    const empty = _tab === 'action' ? 'Nothing is waiting on you' : _tab === 'mine' ? 'You have not requested a resolution yet' : 'No resolutions yet';
    return `
      ${D.me.manager && D.settings && !D.settings.csSet ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        <b>No CS chosen yet.</b> New requests are mailed to the extra email IDs in <b>Settings</b> (or the Admins when there are none).</div>` : ''}
      ${H.stats(tiles)}
      <div class="br-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <input id="br-q" value="${esc(_f.q)}" placeholder="Search BR no., subject, person…" style="${H.CONTROL}max-width:300px;" />
        ${_tab === 'action' ? '' : `<select id="br-status" style="${H.CONTROL}max-width:240px;">
          ${['Open', 'All', ...D.lists.STATUSES].map((s) => `<option value="${esc(s)}"${_f.status === s ? ' selected' : ''}>${esc(s === 'Open' ? 'All Open' : s === 'All' ? 'All Statuses' : s)}</option>`).join('')}
        </select>`}
        <select id="br-cat" style="${H.CONTROL}max-width:240px;">
          ${['All', ...D.lists.CATEGORIES].map((s) => `<option value="${esc(s)}"${_f.category === s ? ' selected' : ''}>${esc(s === 'All' ? 'All Categories' : s)}</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" id="br-export">Export CSV</button>
      </div>
      ${H.table([
        'BR No.', 'Date', { label: 'Subject', m: 'title' }, 'Category', 'Meeting', 'Draft', 'Status', 'Open For', { label: '', m: 'actions' },
      ], list.map((s) => [
        `<button class="br-link" data-view="${esc(s.id)}">${esc(s.id)}</button>`,
        H.fmtDate(s.created_at),
        `${esc(s.title)}${s.priority === 'Urgent' ? ' ' + pill('Urgent') : ''}<div style="font-size:11px;color:#94a3b8;">${esc([s.requested_by_name, s.department].filter(Boolean).join(' · '))}</div>`,
        esc(s.category),
        `${esc(s.meeting_type)}<div style="font-size:11px;color:#94a3b8;">${s.meeting_date ? H.fmtDate(s.meeting_date) : ''}</div>`,
        s.version ? `v${s.version}` : '—',
        pill(s.status),
        esc(age(s)),
        `<button class="${needsMe(s) ? 'btn-primary' : 'btn-secondary'} btn-sm" data-view="${esc(s.id)}">${esc(actionLabel(s))}</button>`,
      ]), { empty, cards: true, page: { key: 'br-requests', sig: [_tab, _f.q, _f.status, _f.category], onPage: render } })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${list.length} request${list.length === 1 ? '' : 's'}</div>`;
  }

  function exportList() {
    const cols = ['BR No.', 'Requested On', 'Subject', 'Category', 'Type', 'Date of Meeting', 'Priority', 'Requested By', 'Department',
      'Status', 'Draft Version', 'Decided By', 'Decided On', 'Director Remarks', 'Passed On', 'Completed On', 'Drive Link'];
    const rows = D.requests.map((s) => [s.id, (s.created_at || '').slice(0, 10), s.title, s.category, s.meeting_type, s.meeting_date || '', s.priority,
      s.requested_by_name, s.department, s.status, s.version || '', s.decided_by_name, (s.decided_at || '').slice(0, 10), s.director_remarks,
      s.passed_date || '', (s.completed_at || '').slice(0, 10), s.drive_link]);
    H.downloadCsv(`board-resolutions-${H.todayISO()}.csv`, cols, rows);
  }

  /* ── Files ────────────────────────────────────────────────────────── */

  const ACCEPT_ANY = '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx,application/pdf,image/*';
  const ACCEPT_DRAFT = '.pdf,.doc,.docx,application/pdf';
  const ACCEPT_SIGNED = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*';
  async function readFiles(input, label, max = 5) {
    const files = [...(input?.files || [])];
    if (files.length > max) throw new Error(`${label}: at most ${max} file${max === 1 ? '' : 's'}`);
    let total = 0;
    for (const f of files) { if (f.size > 4 * 1024 * 1024) throw new Error(`${label}: "${f.name}" is over 4 MB`); total += f.size; }
    if (total > 8 * 1024 * 1024) throw new Error('Attachments together must be under 8 MB');
    return Promise.all(files.map((f) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, dataUrl: r.result });
      r.onerror = () => rej(new Error(`Could not read "${f.name}"`));
      r.readAsDataURL(f);
    })));
  }
  const fileInput = (id, label, accept, { multiple = true, required = false, hint = '' } = {}) => `<div style="grid-column:span 2;">
      <label style="${H.LABEL}">${esc(label)}${required ? ' <span style="color:#ef4444">*</span>' : ''}</label>
      <input id="${id}" type="file" ${multiple ? 'multiple' : ''} accept="${accept}" style="${H.CONTROL}padding:6px;" />
      ${hint ? `<div style="font-size:10.5px;color:#94a3b8;margin-top:3px;">${esc(hint)}</div>` : ''}</div>`;
  const sub = (t) => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:18px 0 8px;">${esc(t)}</div>`;

  /* ── Request form ─────────────────────────────────────────────────── */

  function requestForm() {
    H.openModal({
      id: 'br-form', width: 720, title: 'Request a Board Resolution',
      subtitle: D.cs.length ? `Goes to the CS (${D.cs.join(', ')}) to draft` : 'Goes to the CS to draft',
      bodyHTML: H.grid(
        H.field('bf-title', 'Subject', '', { required: true, span: 2, placeholder: 'e.g. Opening a current account with HDFC Bank, Vatva' })
        + H.select('bf-cat', 'Category', '', D.lists.CATEGORIES, { required: true, placeholder: 'Choose…' })
        + H.select('bf-type', 'Type', D.lists.MEETING_TYPES[0], D.lists.MEETING_TYPES)
        + H.field('bf-date', 'Date of Meeting (if known)', '', { type: 'date' })
        + H.select('bf-pri', 'Priority', 'Normal', D.lists.PRIORITIES)
        + H.textarea('bf-desc', 'What is needed *', '', { rows: 6, placeholder: 'What should the resolution say — names, amounts, bank / party, authorised signatories, why it is needed…' })
        + fileInput('bf-docs', 'Supporting documents', ACCEPT_ANY, { hint: 'Optional · PDF / image / Excel / Word · up to 5 files, 4 MB each' }),
      ),
      confirmText: 'Submit Request',
      onOpen: () => document.getElementById('bf-title')?.focus(),
      onConfirm: async () => {
        const body = {
          title: H.val('bf-title').trim(), category: H.val('bf-cat'), meeting_type: H.val('bf-type'),
          meeting_date: H.val('bf-date'), priority: H.val('bf-pri'), description: H.val('bf-desc').trim(),
        };
        if (!body.title) throw new Error('Write the subject');
        if (!body.category) throw new Error('Choose the category');
        if (!body.description) throw new Error('Describe what is needed');
        body.documents = await readFiles(document.getElementById('bf-docs'), 'Supporting documents');
        const r = await H.post('/api/board-resolution/requests', body);
        H.closeModal('br-form');
        H.toast(`${r.id} submitted — the CS has been emailed`);
        _tab = D.me.all ? _tab : 'mine';
        await refresh();
        view(r.id);
      },
    });
  }

  /* ── Request drawer ───────────────────────────────────────────────── */

  const ACTION_COLOUR = {
    Requested: '#0150AA', 'Query to Requester': '#d97706', Replied: '#0150AA', 'Changes Requested': '#7c3aed',
    Approved: '#16a34a', 'Approved (with modifications)': '#16a34a', Rejected: '#dc2626', 'Signed Copy Uploaded': '#16a34a', Withdrawn: '#94a3b8',
  };
  const docLink = (s, d) => `<a class="br-doc" href="${docHref(s.id, d.n)}" target="_blank" rel="noopener">📎 ${esc(d.name)}</a>`;

  async function view(id) {
    let d;
    try { d = await H.api(`/api/board-resolution/requests/${encodeURIComponent(id)}`); } catch (e) { return H.fail(e); }
    const s = d.request;
    const c = s.can;
    const draft = [...s.docs].reverse().find((x) => x.kind === 'draft' || x.kind === 'director');
    const lastNote = [...d.log].reverse().find((n) => ['Query to Requester', 'Changes Requested'].includes(n.action));
    let act = '';
    if (c.decide) {
      act = `<div class="br-card" style="border-color:#fde68a;background:#fffbeb;margin-bottom:14px;">
        <h3>Your decision on draft v${s.version}</h3>
        ${draft ? `<div style="margin-bottom:10px;">${docLink(s, draft)}</div>` : ''}
        ${H.grid(H.textarea('bv-remarks', 'Remarks / changes wanted', '', { rows: 3, placeholder: 'Optional to approve · required to send back or reject' })
          + fileInput('bv-file', 'Your edited copy (optional)', ACCEPT_DRAFT, { multiple: false, hint: 'Approve with this file and it becomes the final text; send it back with it as a marked-up copy for the CS.' }))}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn-primary btn-sm" data-decide="approve">Approve</button>
          <button class="btn-secondary btn-sm" data-decide="changes" style="color:#b45309;">Request Changes</button>
          <button class="btn-secondary btn-sm" data-decide="reject" style="color:#dc2626;">Reject</button>
        </div></div>`;
    } else if (c.draft) {
      act = `<div class="br-card" style="border-color:#bfdbfe;background:#eff6ff;margin-bottom:14px;">
        <h3>${s.status === 'Changes Requested' ? `Upload the revised draft (v${s.version + 1})` : 'Draft the resolution'}</h3>
        ${s.status === 'Changes Requested' && s.director_remarks ? `<div style="font-size:12.5px;color:#6b21a8;margin-bottom:10px;white-space:pre-wrap;"><b>${esc(s.decided_by_name)} wants:</b> ${esc(s.director_remarks)}</div>` : ''}
        ${H.grid(
          fileInput('bd-file', 'Draft resolution', ACCEPT_DRAFT, { multiple: false, required: true, hint: 'One PDF or Word file — goes to the Director by mail' })
          + H.select('bd-type', 'Type', s.meeting_type, D.lists.MEETING_TYPES)
          + H.field('bd-date', 'Date of Meeting', s.meeting_date || '', { type: 'date' })
          + H.textarea('bd-note', 'Note for the Director (optional)', '', { rows: 2 }),
        )}
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:10px;">
          <button class="btn-secondary btn-sm" id="bd-query">Ask Requester for Details…</button>
          <button class="btn-primary btn-sm" id="bd-send">Send for Approval</button>
        </div></div>`;
    } else if (c.reply) {
      act = `<div class="br-card" style="border-color:#fde68a;background:#fffbeb;margin-bottom:14px;">
        <h3>The CS needs more details</h3>
        ${lastNote ? `<div style="font-size:12.5px;color:#92400e;margin-bottom:10px;white-space:pre-wrap;">${esc(lastNote.note)}</div>` : ''}
        ${H.grid(H.textarea('br-reply', 'Your reply', '', { rows: 3 }) + fileInput('br-reply-docs', 'Documents', ACCEPT_ANY, { hint: 'Up to 5 files, 4 MB each' }))}
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary btn-sm" id="br-reply-send">Send Reply</button></div>
      </div>`;
    } else if (c.sign) {
      const fin = s.final_doc != null ? s.docs.find((x) => x.n === s.final_doc) : null;
      act = `<div class="br-card" style="border-color:#bbf7d0;background:#f0fdf4;margin-bottom:14px;">
        <h3>Approved — print, sign and upload</h3>
        ${fin ? `<div style="margin-bottom:10px;">Approved text: ${docLink(s, fin)}</div>` : ''}
        ${H.grid(
          fileInput('bs-file', 'Signed copy', ACCEPT_SIGNED, { multiple: false, required: true, hint: 'Scanned PDF or photo — mailed to everyone and saved on Drive' })
          + H.field('bs-date', 'Passed On', s.meeting_date || H.todayISO(), { type: 'date' })
          + H.textarea('bs-note', 'Note (optional)', '', { rows: 2, span: 1 }),
        )}
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary btn-sm" id="bs-send">Upload & Complete</button></div>
      </div>`;
    }

    const groups = ['signed', 'director', 'draft', 'request', 'reply'].map((k) => {
      const list = s.docs.filter((x) => x.kind === k);
      if (!list.length) return '';
      return `<div style="margin-bottom:8px;"><div style="font-size:11.5px;color:#64748b;font-weight:600;">${esc(KIND[k])}</div>
        ${list.map((x) => `<div>${docLink(s, x)}${x.v ? ` <span style="font-size:11px;color:#94a3b8;">v${x.v}</span>` : ''}
          <span style="font-size:11px;color:#94a3b8;">· ${esc(x.by)} · ${H.fmtDate(x.at)}</span></div>`).join('')}</div>`;
    }).join('');

    H.openModal({
      id: 'br-view', variant: 'drawer', width: 820, hideConfirm: true, cancelText: 'Close',
      title: `${s.id} · ${s.title}`, subtitle: `Requested by ${s.requested_by_name} on ${H.fmtDate(s.created_at)} · open ${age(s)}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${pill(s.status)} ${s.priority === 'Urgent' ? pill('Urgent') : ''} ${H.pill(s.category, 'neutral')} ${s.version ? H.pill('Draft v' + s.version, 'neutral') : ''}</div>
        ${act}
        ${sub('Request')}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Type', s.meeting_type)}${H.readout('Date of Meeting', s.meeting_date ? H.fmtDate(s.meeting_date) : '')}
          ${H.readout('Requested By', s.requested_by_name)}${H.readout('Department', s.department)}
          ${s.decided_by_name ? H.readout('Last Decision By', s.decided_by_name) + H.readout('On', s.decided_at ? `${H.fmtDate(s.decided_at)} ${H.fmtTime(s.decided_at)}` : '') : ''}
          ${s.passed_date ? H.readout('Passed On', H.fmtDate(s.passed_date)) : ''}${s.completed_at ? H.readout('Completed', `${H.fmtDate(s.completed_at)} ${H.fmtTime(s.completed_at)}`) : ''}
        </div>
        <div style="font-size:12.5px;color:#334155;margin-top:10px;white-space:pre-wrap;">${esc(s.description)}</div>
        ${s.drive_link ? `<div style="margin-top:8px;"><a class="br-doc" href="${esc(s.drive_link)}" target="_blank" rel="noopener">Open the signed copy on Drive ↗</a></div>` : ''}
        ${(() => {
          if (!D.me.register || s.status !== 'Completed') return '';
          const e = (D.register || []).find((x) => x.request_id === s.id);
          return e ? `<div style="margin-top:8px;font-size:12.5px;">On the register: <b>FY ${esc(e.fy)} · No. ${esc(e.no)}</b></div>`
            : '<div style="margin-top:8px;"><button class="btn-secondary btn-sm" id="bv-register">Add to Register</button></div>';
        })()}
        ${groups ? sub('Documents') + groups : ''}
        ${sub('History')}
        <div>${d.log.map((n) => `<div style="border-left:3px solid ${ACTION_COLOUR[n.action] || (n.action.startsWith('Draft') ? '#0150AA' : '#cbd5e1')};padding:4px 0 4px 10px;margin:6px 0;">
          <div style="font-size:12.5px;color:#1e293b;"><b>${esc(n.action)}</b> · ${esc(n.by)}</div>
          ${n.note ? `<div style="font-size:12.5px;color:#475569;white-space:pre-wrap;">${esc(n.note)}</div>` : ''}
          ${(n.docs || []).map((k) => s.docs.find((x) => x.n === k)).filter(Boolean).map((x) => docLink(s, x)).join(' ')}
          <div style="font-size:11px;color:#94a3b8;">${H.fmtDate(n.at)} ${H.fmtTime(n.at)}</div></div>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;">
          ${c.withdraw ? '<button class="btn-secondary btn-sm" id="bv-withdraw">Withdraw request</button>' : ''}
          ${D.me.manager && s.status !== 'Withdrawn' ? '<button class="btn-secondary btn-sm" id="bv-resend">Resend mail</button>' : ''}
          ${c.del ? '<button class="btn-secondary btn-sm" id="bv-del" style="color:#dc2626;">Delete</button>' : ''}
        </div>`,
      onOpen: () => bindView(s),
    });
  }

  function bindView(s) {
    const $ = (id) => document.getElementById(id);
    const base = `/api/board-resolution/requests/${encodeURIComponent(s.id)}`;
    const after = async (msg) => { H.closeModal('br-view'); H.toast(msg); await refresh(); };
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { btn.disabled = false; H.fail(e); } };

    document.querySelectorAll('#br-view [data-decide]').forEach((b) => b.addEventListener('click', (e) => busy(e.target, async () => {
      const decision = b.getAttribute('data-decide');
      const remarks = H.val('bv-remarks').trim();
      if (decision !== 'approve' && !remarks) throw new Error(decision === 'reject' ? 'Write the reason for rejecting' : 'Write what should be changed');
      const documents = await readFiles($('bv-file'), 'Your copy', 1);
      if (decision === 'reject' && documents.length) throw new Error('Remove the file to reject — it is not needed');
      const words = { approve: documents.length ? `Approve ${s.id} with your edited copy as the final text?` : `Approve draft v${s.version} of ${s.id}?`,
        changes: `Send ${s.id} back to the CS with your changes?`, reject: `Reject ${s.id}? This closes the request.` }[decision];
      if (!(await Utils.showConfirm(words, { title: 'Board Resolution', confirmText: { approve: 'Approve', changes: 'Send back', reject: 'Reject' }[decision], danger: decision === 'reject' }))) { e.target.disabled = false; return; }
      await H.post(`${base}/decision`, { decision, remarks, documents });
      await after({ approve: `${s.id} approved — the CS has been emailed to get it signed`, changes: `${s.id} sent back to the CS`, reject: `${s.id} rejected` }[decision]);
    })));

    $('bd-send')?.addEventListener('click', (e) => busy(e.target, async () => {
      const documents = await readFiles($('bd-file'), 'Draft', 1);
      if (!documents.length) throw new Error('Attach the draft resolution');
      await H.post(`${base}/draft`, { documents, meeting_type: H.val('bd-type'), meeting_date: H.val('bd-date'), note: H.val('bd-note').trim() });
      await after(`Draft sent to the Director${D.directors.length > 1 ? 's' : ''} for approval`);
    }));
    $('bd-query')?.addEventListener('click', () => {
      H.openModal({
        id: 'br-query', title: `Ask ${s.requested_by_name} for details`, subtitle: `${s.id} goes back to them until they reply`,
        bodyHTML: H.grid(H.textarea('bq-note', 'What do you need?', '', { rows: 4, placeholder: 'e.g. Board meeting date, list of authorised signatories, sanction letter copy…' })),
        confirmText: 'Send Query',
        onOpen: () => $('bq-note')?.focus(),
        onConfirm: async () => {
          const note = H.val('bq-note').trim();
          if (!note) throw new Error('Write what details you need');
          await H.post(`${base}/query`, { note });
          H.closeModal('br-query');
          await after(`Query sent to ${s.requested_by_name}`);
        },
      });
    });
    $('br-reply-send')?.addEventListener('click', (e) => busy(e.target, async () => {
      const note = H.val('br-reply').trim();
      const documents = await readFiles($('br-reply-docs'), 'Documents');
      if (!note && !documents.length) throw new Error('Write the details or attach the documents');
      await H.post(`${base}/reply`, { note, documents });
      await after('Reply sent to the CS');
    }));
    $('bs-send')?.addEventListener('click', (e) => busy(e.target, async () => {
      const documents = await readFiles($('bs-file'), 'Signed copy', 1);
      if (!documents.length) throw new Error('Attach the signed copy');
      const r = await H.post(`${base}/signed`, { documents, passed_date: H.val('bs-date'), note: H.val('bs-note').trim() });
      await after(r.drive_link ? `${s.id} completed — saved on Drive and mailed` : `${s.id} completed — mailed to everyone`);
    }));
    $('bv-register')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const r = await H.post(`${base}/register`, {}); await after(`On the register — FY ${r.fy} · No. ${r.no}`); } catch (err) { e.target.disabled = false; H.fail(err); }
    });
    $('bv-resend')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const r = await H.post(`${base}/resend`, {}); H.toast(`Mail sent again (${r.stage})`); } catch (err) { H.fail(err); }
      e.target.disabled = false;
    });
    $('bv-withdraw')?.addEventListener('click', async () => {
      if (!(await Utils.showConfirm(`Withdraw ${s.id}? The CS will stop working on it.`, { title: 'Withdraw request', confirmText: 'Withdraw' }))) return;
      try { await H.post(`${base}/withdraw`, {}); await after(`${s.id} withdrawn`); } catch (err) { H.fail(err); }
    });
    $('bv-del')?.addEventListener('click', async () => {
      if (!(await Utils.showConfirm(`Delete ${s.id}, its history and files? This cannot be undone.`, { title: 'Delete', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(base); await after('Deleted'); } catch (err) { H.fail(err); }
    });
  }

  /* ── Register ─────────────────────────────────────────────────────
     What the LAL\ROC\FY 2025-26\Board Resolution folder was: numbered
     entries per financial year, each with the signed copy and, apart, the
     file it was drafted from. Draft / Cancelled were sub-folders there and
     are a status here. A completed request lands here by itself. ── */

  const _rf = { fy: '', status: 'Final', q: '' };
  const regHref = (e, n) => `/api/board-resolution/register/${e.id}/documents/${n}`;
  const fyList = () => [...new Set([D.regLists.currentFy, ...(D.register || []).map((e) => e.fy)])].sort().reverse();
  const REG_VARIANT = { Final: 'success', Draft: 'warning', Cancelled: 'neutral' };
  const docOf = (e, kind) => e.docs.find((d) => d.kind === kind);
  const noKey = (no) => String(no || '').split(/[.\-/]/).map((x) => String(parseInt(x, 10) || 0).padStart(5, '0')).join('.');

  function registerTab() {
    if (!_rf.fy) _rf.fy = D.regLists.currentFy;
    const n = _rf.q.trim().toLowerCase();
    const list = (D.register || []).filter((e) => e.fy === _rf.fy && (_rf.status === 'All' || e.status === _rf.status)
      && (!n || [e.no, e.title, e.kind, e.notes, e.request_id].join(' ').toLowerCase().includes(n)))
      .sort((a, b) => noKey(a.no).localeCompare(noKey(b.no)));
    const inFy = (D.register || []).filter((e) => e.fy === _rf.fy);
    const fileCell = (e, kind) => { const d = docOf(e, kind); return d ? `<a class="br-doc" href="${regHref(e, d.n)}" target="_blank" rel="noopener">📎 ${esc(d.name)}</a>` : '<span style="color:#cbd5e1;">—</span>'; };
    return `
      <div class="br-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <select id="rg-fy" style="${H.CONTROL}max-width:150px;font-weight:700;">${fyList().map((f) => `<option value="${f}"${f === _rf.fy ? ' selected' : ''}>FY ${f}</option>`).join('')}</select>
        <select id="rg-status" style="${H.CONTROL}max-width:170px;">${['Final', 'Draft', 'Cancelled', 'All'].map((x) => `<option value="${x}"${x === _rf.status ? ' selected' : ''}>${x === 'All' ? 'All' : x} (${x === 'All' ? inFy.length : inFy.filter((e) => e.status === x).length})</option>`).join('')}</select>
        <input id="rg-q" value="${esc(_rf.q)}" placeholder="Search no., subject…" style="${H.CONTROL}max-width:260px;" />
        <span style="margin-left:auto;display:flex;gap:8px;">
          <button class="btn-secondary btn-sm" id="rg-bulk">Upload many files…</button>
          <button class="btn-primary btn-sm" id="rg-add">+ Add to Register</button></span>
      </div>
      ${H.table([{ label: 'No.', nowrap: true }, { label: 'Subject', m: 'title' }, 'Type', 'Date', 'Status', 'Signed Copy', 'Source File', 'From', { label: '', m: 'actions' }],
        list.map((e) => [
          `<b>${esc(e.no)}</b>`, esc(e.title) + (e.notes ? `<div style="font-size:11px;color:#94a3b8;">${esc(e.notes)}</div>` : ''),
          esc(e.kind), e.passed_on ? H.fmtDate(e.passed_on) : '—', H.pill(e.status, REG_VARIANT[e.status] || 'neutral'),
          fileCell(e, 'signed'), fileCell(e, 'source'),
          e.request_id ? `<button class="br-link" data-view="${esc(e.request_id)}">${esc(e.request_id)}</button>` : '<span style="color:#94a3b8;">Uploaded</span>',
          `<button class="btn-secondary btn-sm" data-reg="${e.id}">Edit</button>`,
        ]), { empty: `Nothing in FY ${_rf.fy}${_rf.status === 'All' ? '' : ' (' + _rf.status + ')'} yet`, cards: true, page: { key: 'br-reg', sig: [_rf.fy, _rf.status, _rf.q], onPage: render } })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">A request completed here goes on the register by itself (next number, signed copy + last draft). Made outside the ERP? Add it, or upload a whole folder of files at once.</div>`;
  }

  function regForm(e) {
    const fy = e?.fy || _rf.fy || D.regLists.currentFy;
    H.openModal({
      id: 'br-reg', width: 720, title: e ? `FY ${e.fy} · No. ${e.no}` : 'Add to Register', subtitle: e ? e.title : 'A resolution / CTC made outside the request flow',
      bodyHTML: H.grid(
        H.field('rg-fyv', 'Financial year', fy, { placeholder: '2025-26' })
        + H.field('rg-no', 'No.', e?.no || '', { placeholder: 'blank = next number', hint: '1, 2, 2.1 … as in the folder' })
        + H.field('rg-title', 'Subject', e?.title || '', { required: true, span: 2 })
        + H.select('rg-kind', 'Type', e?.kind || D.regLists.KINDS[0], D.regLists.KINDS)
        + H.field('rg-date', 'Date', e?.passed_on || '', { type: 'date' })
        + H.select('rg-st', 'Status', e?.status || 'Final', D.regLists.STATUS)
        + '<div></div>'
        + fileInput('rg-signed', e && docOf(e, 'signed') ? 'Replace signed copy' : 'Signed copy', '.pdf,.jpg,.jpeg,.png,application/pdf,image/*', { multiple: false, hint: e && docOf(e, 'signed') ? `Now: ${docOf(e, 'signed').name}` : 'PDF / scan' })
        + fileInput('rg-source', e && docOf(e, 'source') ? 'Replace source file' : 'Source file (draft it was made from)', '.doc,.docx,.pdf,.xls,.xlsx', { multiple: false, hint: e && docOf(e, 'source') ? `Now: ${docOf(e, 'source').name}` : 'Word usually' })
        + H.textarea('rg-notes', 'Notes', e?.notes || '', { rows: 2 })
        + (e ? `<div style="grid-column:span 2;font-size:11.5px;color:#94a3b8;">Added by ${esc(e.created_by)} on ${H.fmtDate(e.created_at)}${e.docs.some((d) => d.kind.startsWith('old-')) ? ` · older files: ${e.docs.filter((d) => d.kind.startsWith('old-')).map((d) => `<a class="br-doc" href="${regHref(e, d.n)}" target="_blank" rel="noopener">${esc(d.name)}</a>`).join(', ')}` : ''}</div>` : ''),
      ),
      confirmText: e ? 'Save' : 'Add',
      onConfirm: async () => {
        const body = { fy: H.val('rg-fyv').trim(), no: H.val('rg-no').trim(), title: H.val('rg-title').trim(), kind: H.val('rg-kind'),
          passed_on: H.val('rg-date'), status: H.val('rg-st'), notes: H.val('rg-notes').trim() };
        if (!body.title) throw new Error('Write the subject');
        body.signed = await readFiles(document.getElementById('rg-signed'), 'Signed copy', 1);
        body.source = await readFiles(document.getElementById('rg-source'), 'Source file', 1);
        let r;
        if (e) { await H.patch(`/api/board-resolution/register/${e.id}`, body); r = { fy: body.fy || e.fy, no: body.no || e.no }; }
        else r = await H.post('/api/board-resolution/register', body);
        H.closeModal('br-reg');
        H.toast(`Saved — FY ${r.fy} · No. ${r.no}`);
        _rf.fy = r.fy;
        await refresh();
      },
    });
  }

  /* Many files at once — number, subject, date and type read from file
     names like "2.4 BR to open bank account for Solar Loan with HDFC
     Bank_15-4-2025.pdf". A Word file with the same name is its source. */
  function parseName(file) {
    const stem = file.replace(/\.[^.]+$/, '').trim();
    let rest = stem, no = '', date = '';
    const m = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(rest);
    if (m) { no = m[1]; rest = m[2]; }
    const d = /[_\s-]+(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(rest);
    if (d) {
      date = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      rest = rest.slice(0, d.index);
    }
    const kind = /^CTC\b|^CTC_/i.test(rest) ? 'CTC (Certified True Copy)' : /circular/i.test(rest) ? 'Circular Resolution' : /\bAGM\b|\bEGM\b/i.test(rest) ? 'General Meeting (AGM / EGM)' : 'Board Resolution';
    const title = rest.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return { stem: stem.toLowerCase(), no, date, kind, title: title || stem };
  }
  function bulkForm() {
    let items = [];
    H.openModal({
      id: 'br-bulk', width: 980, title: 'Upload many files to the Register', subtitle: 'Pick the files of one financial year (e.g. everything in FY 2025-26\\Board Resolution)',
      bodyHTML: `${H.grid(
        H.field('rb-fy', 'Financial year', _rf.fy || D.regLists.currentFy, { placeholder: '2025-26' })
        + H.select('rb-st', 'Status for all', 'Final', D.regLists.STATUS, { hint: 'Upload the Draft / Cancelled folders separately with that status' })
        + `<div style="grid-column:span 2;"><label style="${H.LABEL}">Files</label><input id="rb-files" type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style="${H.CONTROL}padding:6px;" />
            <div style="font-size:10.5px;color:#94a3b8;margin-top:3px;">PDFs are the signed copies; a Word file with the same name goes with it as the source. 4 MB per file.</div></div>`)}
        <div id="rb-list" style="margin-top:12px;"></div>`,
      confirmText: 'Upload All',
      onOpen: () => {
        document.getElementById('rb-files').addEventListener('change', (ev) => {
          const files = [...ev.target.files];
          const groups = new Map();
          for (const f of files) {
            const p = parseName(f.name);
            const g = groups.get(p.stem) || { ...p, signed: null, source: null };
            if (/\.(docx?|xlsx?)$/i.test(f.name)) g.source = f; else g.signed = g.signed || f;
            groups.set(p.stem, g);
          }
          items = [...groups.values()].sort((a, b) => noKey(a.no).localeCompare(noKey(b.no)));
          document.getElementById('rb-list').innerHTML = items.length ? `<div style="max-height:420px;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#f8fafc;text-align:left;">
              <th style="padding:6px;">No.</th><th style="padding:6px;">Subject</th><th style="padding:6px;">Type</th><th style="padding:6px;">Date</th><th style="padding:6px;">Files</th><th style="padding:6px;"></th></tr></thead>
            <tbody>${items.map((it, i) => `<tr data-i="${i}" style="border-top:1px solid #f1f5f9;">
              <td style="padding:4px;"><input class="rb-no" value="${esc(it.no)}" placeholder="next" style="${H.CONTROL}width:64px;padding:4px 6px;" /></td>
              <td style="padding:4px;"><input class="rb-title" value="${esc(it.title)}" style="${H.CONTROL}padding:4px 6px;" /></td>
              <td style="padding:4px;"><select class="rb-kind" style="${H.CONTROL}padding:4px 6px;">${D.regLists.KINDS.map((k) => `<option${k === it.kind ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select></td>
              <td style="padding:4px;"><input class="rb-date" type="date" value="${esc(it.date)}" style="${H.CONTROL}padding:4px 6px;" /></td>
              <td style="padding:4px;font-size:11px;color:#475569;">${it.signed ? '📄 ' + esc(it.signed.name) : ''}${it.source ? '<br>📝 ' + esc(it.source.name) : ''}</td>
              <td style="padding:4px;" class="rb-out"></td></tr>`).join('')}</tbody></table></div>
            <div style="font-size:11.5px;color:#64748b;margin-top:6px;">${items.length} entr${items.length === 1 ? 'y' : 'ies'} — check the numbers and subjects, then Upload All.</div>` : '';
        });
      },
      onConfirm: async () => {
        if (!items.length) throw new Error('Pick the files');
        const fy = H.val('rb-fy').trim(), status = H.val('rb-st');
        let okN = 0, bad = 0;
        for (const [i, it] of items.entries()) {
          const row = document.querySelector(`#rb-list tr[data-i="${i}"]`);
          const out = row.querySelector('.rb-out');
          if (out.dataset.done) continue;
          out.innerHTML = '<span style="color:#64748b;">…</span>';
          try {
            const wrap = async (f) => (f ? [await new Promise((res, rej) => { if (f.size > 4 * 1024 * 1024) return rej(new Error(`"${f.name}" is over 4 MB`)); const r = new FileReader(); r.onload = () => res({ name: f.name, dataUrl: r.result }); r.onerror = () => rej(new Error('Could not read ' + f.name)); r.readAsDataURL(f); })] : []);
            const r = await H.post('/api/board-resolution/register', {
              fy, status, no: row.querySelector('.rb-no').value.trim(), title: row.querySelector('.rb-title').value.trim(),
              kind: row.querySelector('.rb-kind').value, passed_on: row.querySelector('.rb-date').value,
              signed: await wrap(it.signed), source: await wrap(it.source),
            });
            out.innerHTML = `<span style="color:#16a34a;font-weight:700;">✓ ${esc(r.no)}</span>`; out.dataset.done = '1'; okN++;
          } catch (err) { out.innerHTML = `<span style="color:#dc2626;">${esc(err.message)}</span>`; bad++; }
        }
        if (bad) { H.toast(`${okN} added, ${bad} not — fix those rows and press Upload All again`, 'error'); _rf.fy = fy; return; }
        H.closeModal('br-bulk');
        H.toast(`${okN} added to FY ${fy}`);
        _rf.fy = fy; _rf.status = status;
        await refresh();
      },
    });
  }

  function bindRegister() {
    const $ = (id) => document.getElementById(id);
    $('rg-fy')?.addEventListener('change', (e) => { _rf.fy = e.target.value; render(); });
    $('rg-status')?.addEventListener('change', (e) => { _rf.status = e.target.value; render(); });
    let t;
    $('rg-q')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { _rf.q = e.target.value; render(); const a = $('rg-q'); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } }, 250);
    });
    $('rg-add')?.addEventListener('click', () => regForm(null));
    $('rg-bulk')?.addEventListener('click', bulkForm);
    document.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', () => regForm(D.register.find((e) => String(e.id) === b.getAttribute('data-reg')))));
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  function userPicker(id, label, selected, hint) {
    return `<div class="br-card">
      <h3>${esc(label)}</h3>
      <div style="font-size:12px;color:#64748b;margin-bottom:8px;">${esc(hint)}</div>
      <input id="${id}-q" placeholder="Filter people…" style="${H.CONTROL}margin-bottom:6px;"/>
      <div id="${id}" style="max-height:260px;overflow:auto;border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;">
        ${D.users.map((u) => `<label data-row="${esc((u.name + ' ' + u.department).toLowerCase())}" style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0;cursor:pointer;">
          <input type="checkbox" value="${esc(u.id)}"${selected.includes(u.id) ? ' checked' : ''}/> ${esc(u.name)}
          <span style="color:#94a3b8;font-size:11px;">${esc(u.department)}</span></label>`).join('')}
      </div></div>`;
  }

  function settingsTab() {
    const s = D.settings;
    return `
      ${!s.csSet ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        No CS chosen yet — until one is, the Admins do the CS steps. New requests are mailed to the extra email IDs below (or the Admins when there are none).</div>` : ''}
      <div class="br-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${userPicker('bs-cs', 'Company Secretary (CS)', s.cs, 'Gets every new request, drafts the resolution, asks for details and uploads the signed copy.')}
        ${userPicker('bs-dir', 'Directors (approvers)', s.directors, 'Each gets the draft by mail with Approve / Request Changes / Reject, and can decide here.')}
        ${userPicker('bs-keep', 'Register keepers', s.keepers, `Can see and fill the Register (numbered resolutions per financial year)${s.keepersSet ? '' : ' — until saved: the logins on the extra email list'}. CS, Directors and Admins always can.`)}
        <div class="br-card">
          <h3>Extra email IDs</h3>
          <textarea id="bs-mail" rows="3" placeholder="cs@laltd.in" style="${H.CONTROL}resize:vertical;">${esc(s.extraEmails.join('\n'))}</textarea>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:4px;">One per line — get every new request (the requester is copied) and the signed copy.</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <span style="font-size:11.5px;color:#64748b;align-self:center;margin-right:auto;">Everyone can request a resolution and follow their own. Seeing all of them: CS, Directors, Admins and anyone given “Board Resolution (admin)” in Users → Access.</span>
        <button class="btn-primary btn-sm" id="bs-save">Save Settings</button>
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-br-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-br-tab'); render(); }));
    $('br-new')?.addEventListener('click', requestForm);
    if (_tab === 'register') bindRegister();
    let t;
    $('br-q')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        _f.q = e.target.value; render();
        const again = $('br-q'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    });
    $('br-status')?.addEventListener('change', (e) => { _f.status = e.target.value; render(); });
    $('br-cat')?.addEventListener('change', (e) => { _f.category = e.target.value; render(); });
    $('br-export')?.addEventListener('click', exportList);
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => view(b.getAttribute('data-view'))));

    ['bs-cs', 'bs-dir', 'bs-keep'].forEach((id) => $(`${id}-q`)?.addEventListener('input', (e) => {
      const n = e.target.value.trim().toLowerCase();
      document.querySelectorAll(`#${id} [data-row]`).forEach((row) => { row.style.display = !n || row.getAttribute('data-row').includes(n) ? 'flex' : 'none'; });
    }));
    const picked = (id) => [...document.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);
    $('bs-save')?.addEventListener('click', async (e) => {
      const btn = e.target;
      try {
        const body = { directors: picked('bs-dir'), keepers: picked('bs-keep'), extraEmails: H.val('bs-mail').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) };
        // The CS is optional — without one, new requests go to the extra
        // email IDs (or the Admins when there are none).
        if (picked('bs-cs').length) body.cs = picked('bs-cs');
        if (!body.directors.length) throw new Error('Tick at least one Director');
        btn.disabled = true;
        await H.post('/api/board-resolution/settings', body);
        H.toast('Settings saved');
        await refresh();
      } catch (err) { btn.disabled = false; H.fail(err); }
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Board Resolution…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load Board Resolution', e.message); }
    },
  };
})();
