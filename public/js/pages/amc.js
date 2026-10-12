/* =====================================================================
   Service Management System (route 'amc' — it was AMC Management)
   ---------------------------------------------------------------------
   Service requests and their approval → Accounts → paid workflow. Server
   side and the full flow: backend/amc.js (/api/amc/*).

   Everyone can raise a request (here or from the dashboard button, which
   calls Pages.amc.openRaise) and follow their own. The approver chosen on
   a request approves / rejects / comments on it here; Accounts records the
   payment; Service Management admins also see everything, keep the vendor
   master and the Settings (management team, Accounts team).

   Built on window.HR (hr-common.js) for the header, tabs, tiles, modals
   and form fields, so it looks and behaves like the HR pages.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages.amc = (() => {
  const H = window.HR;
  const esc = H.esc;

  let D = null;              // /api/amc/data
  let _tab = 'action';
  const _f = { q: '', status: 'All' };

  const VARIANT = {
    'Pending Approval': 'warning', 'Query Raised': 'purple', Rejected: 'danger',
    Approved: 'info', 'With Accounts': 'warning', Paid: 'success',
    Low: 'neutral', Medium: 'info', High: 'warning', Urgent: 'danger',
  };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');
  const money = (n) => '₹ ' + H.inr(n, { zero: '0.00' });
  const isAdmin = () => !!D?.me?.admin;
  const needsMe = (s) => s.can.decide || s.can.update || s.can.send || s.can.pay;
  const NEW_DEPT = '__new__';

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function load() {
    D = await H.api('/api/amc/data');
    if (!tabsFor().some((t) => t.key === _tab)) _tab = 'action';
  }

  async function refresh() {
    try { await load(); render(); } catch (e) { H.fail(e); }
  }

  const vendorById = (id) => D.vendors.find((v) => v.id === id);

  function tabsFor() {
    const mineId = D.me.id;
    const t = [
      { key: 'action', label: 'Needs My Action', count: D.requests.filter(needsMe).length },
      { key: 'mine', label: 'Raised by Me', count: D.requests.filter((s) => s.raised_by_id === mineId).length },
    ];
    if (D.requests.some((s) => s.raised_by_id !== mineId)) t.push({ key: 'all', label: isAdmin() ? 'All Requests' : 'All I Can See', count: D.requests.length });
    if (isAdmin()) t.push({ key: 'vendors', label: 'Vendors', count: D.vendors.length }, { key: 'settings', label: 'Settings' });
    return t;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const body = { action: requestsTab, mine: requestsTab, all: requestsTab, vendors: vendorsTab, settings: settingsTab }[_tab]();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        @media (max-width: 767px) {
          .sms-filt { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px !important; }
          .sms-filt > input, .sms-filt > select { max-width:none !important; min-height:40px; }
          .sms-filt > input { grid-column:1 / -1; }
          .sms-two { grid-template-columns:1fr !important; }
        }
        .sms-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px; }
        .sms-card h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:0 0 10px; }
        .sms-link { color:var(--color-primary);cursor:pointer;font-weight:600;background:none;border:none;padding:0;font:inherit;text-align:left; }
        .sms-link:hover { text-decoration:underline; }
      </style>
      ${H.header('Service Management System', 'Service requests — approval, vendor, Accounts and payment',
        '<button id="sms-raise" class="btn-primary btn-sm">+ Raise Service Request</button>')}
      ${H.tabs('sms', tabsFor(), _tab)}
      ${body}
    </div>`;
    bind();
  }

  /* ── Requests ─────────────────────────────────────────────────────── */

  function actionLabel(s) {
    if (s.can.decide) return 'Approve / Reject';
    if (s.can.update) return 'Update';
    if (s.can.send) return 'Send to Accounts';
    if (s.can.pay) return 'Mark Paid';
    return 'Open';
  }

  function requestsTab() {
    const n = _f.q.trim().toLowerCase();
    const base = _tab === 'action' ? D.requests.filter(needsMe)
      : _tab === 'mine' ? D.requests.filter((s) => s.raised_by_id === D.me.id) : D.requests;
    const list = base.filter((s) => {
      if (_f.status !== 'All' && s.status !== _f.status) return false;
      if (n && ![s.id, s.service_type, s.department, s.raised_by_name, s.approver_name, s.vendor_name, s.remarks].join(' ').toLowerCase().includes(n)) return false;
      return true;
    });
    const count = (st) => base.filter((s) => s.status === st).length;
    const tiles = D.lists.STATUSES.map((st) => ({ label: st, value: count(st), color: st === 'Rejected' && count(st) ? '#dc2626' : undefined }));
    const empty = _tab === 'action' ? 'Nothing is waiting on you' : _tab === 'mine' ? 'You have not raised a service request yet' : 'No service requests yet';
    return `
      ${H.stats(tiles)}
      <div class="sms-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <input id="sms-q" value="${esc(_f.q)}" placeholder="Search id, service, department, person, vendor…" style="${H.CONTROL}max-width:300px;" />
        <select id="sms-status" style="${H.CONTROL}max-width:200px;">
          ${['All', ...D.lists.STATUSES].map((s) => `<option value="${esc(s)}"${_f.status === s ? ' selected' : ''}>${esc(s === 'All' ? 'All Statuses' : s)}</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" id="sms-export">Export CSV</button>
      </div>
      ${H.table([
        'Request', 'Raised On', { label: 'Type of Service', m: 'title' }, 'Department', 'Priority', 'Payment Date',
        'Raised By', 'Approver', 'Vendor', 'Status', { label: '', m: 'actions' },
      ], list.map((s) => [
        `<button class="sms-link" data-view="${esc(s.id)}">${esc(s.id)}</button>`,
        H.fmtDate(s.created_at),
        `${esc(s.service_type)}<div style="font-size:11px;color:#94a3b8;">${esc(s.frequency)}</div>`,
        esc(s.department), pill(s.priority), H.fmtDate(s.payment_date),
        esc(s.raised_by_name), esc(s.approver_name), esc(s.vendor_name), pill(s.status),
        `<button class="${needsMe(s) ? 'btn-primary' : 'btn-secondary'} btn-sm" data-view="${esc(s.id)}">${esc(actionLabel(s))}</button>`,
      ]), { empty, cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${list.length} request${list.length === 1 ? '' : 's'}</div>`;
  }

  function exportRequests() {
    const cols = ['Request ID', 'Raised On', 'Type of Service', 'Frequency', 'Department', 'Priority', 'Payment Date', 'Raised By',
      'Approver', 'Vendor', 'Status', 'Paid On', 'Amount Paid', 'Mode', 'Reference', 'Remarks'];
    const rows = D.requests.map((s) => [s.id, (s.created_at || '').slice(0, 10), s.service_type, s.frequency, s.department, s.priority,
      s.payment_date || '', s.raised_by_name, s.approver_name, s.vendor_name, s.status, s.paid_date || '', s.paid_amount ?? '',
      s.paid_mode, s.paid_reference, s.remarks]);
    H.downloadCsv(`service-requests-${H.todayISO()}.csv`, cols, rows);
  }

  /* ── Files ────────────────────────────────────────────────────────── */

  const fileInput = (id, label, { pdfOnly = false, required = false } = {}) => `<div style="grid-column:span 2;">
    <label style="${H.LABEL}">${esc(label)}${required ? ' <span style="color:#ef4444">*</span>' : ''}</label>
    <input id="${id}" type="file" multiple accept="${pdfOnly ? '.pdf,application/pdf' : '.pdf,.jpg,.jpeg,.png,.webp,image/*'}" style="${H.CONTROL}padding:6px;"/>
    <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${pdfOnly ? 'PDF' : 'PDF or image'} · up to 5 files, 4 MB each, 7 MB together</div></div>`;

  async function readFiles(id, { pdfOnly = false } = {}) {
    const files = [...(document.getElementById(id)?.files || [])];
    if (files.length > 5) throw new Error('At most 5 files at a time');
    let total = 0;
    for (const f of files) {
      if (pdfOnly && !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') throw new Error(`"${f.name}" is not a PDF`);
      if (f.size > 4 * 1024 * 1024) throw new Error(`"${f.name}" is over 4 MB`);
      total += f.size;
    }
    if (total > 7 * 1024 * 1024) throw new Error('Files together must be under 7 MB');
    return Promise.all(files.map((f) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, dataUrl: r.result });
      r.onerror = () => rej(new Error(`Could not read "${f.name}"`));
      r.readAsDataURL(f);
    })));
  }

  const docList = (id, docs) => docs.length ? docs.map((d, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
      <a href="/api/amc/requests/${encodeURIComponent(id)}/documents/${i}" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;word-break:break-all;">📎 ${esc(d.name)}</a>
      <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">${d.kind === 'payment' ? 'Payment proof' : 'Quotation'} · ${Math.max(1, Math.round(d.size / 1024))} KB</span>
    </div>`).join('') : '<div style="font-size:12.5px;color:#94a3b8;">No documents</div>';

  const sub = (t) => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:16px 0 8px;">${esc(t)}</div>`;

  /* ── Raise / update form ──────────────────────────────────────────── */

  // `meta` = { lists, departments, approvers } — D on this page, or
  // /api/amc/meta when opened from the dashboard.
  function requestForm(meta, s, { onDone } = {}) {
    const editing = !!s;
    s = s || { priority: 'Medium', frequency: 'One Time' };
    if (!meta.approvers.length) {
      return H.toast('No management team is set up yet — ask the Service Management admin to add approvers in Settings', 'error');
    }
    const deptOpts = [...meta.departments.map((d) => ({ value: d, label: d })), { value: NEW_DEPT, label: '+ Add new department…' }];
    H.openModal({
      id: 'sms-form', width: 620,
      title: editing ? `Update ${s.id}` : 'Raise Service Request',
      subtitle: editing ? 'Answer the approver’s comment — it goes back to them for approval' : 'The approver you choose is emailed as soon as you submit',
      bodyHTML: H.grid(
        H.select('sf-type', 'Type of Service', s.service_type || '', meta.lists.SERVICE_TYPES, { required: true, placeholder: '— Select —' })
        + H.select('sf-freq', 'Frequency of Service', s.frequency, meta.lists.FREQUENCIES, { required: true })
        + H.select('sf-dept', 'Department', s.department || '', deptOpts, { required: true, placeholder: '— Select —' })
        + H.select('sf-prio', 'Priority', s.priority, meta.lists.PRIORITIES, { required: true })
        + `<div id="sf-dept-new-wrap" style="grid-column:span 2;display:none;">${H.field('sf-dept-new', 'New Department Name', '', { required: true, placeholder: 'e.g. Naroda Godown' })}</div>`
        + H.field('sf-paydate', 'Payment Date', s.payment_date || '', { type: 'date', required: true })
        + H.select('sf-approver', 'Approver (Management)', s.approver_id || '', meta.approvers.map((u) => ({ value: u.id, label: u.department ? `${u.name} (${u.department})` : u.name })),
          { required: true, placeholder: '— Select approver —' })
        + H.textarea('sf-remarks', 'Remarks', s.remarks || '', { rows: 2, placeholder: 'Optional — anything the approver should know' })
        + fileInput('sf-docs', editing ? 'Add a newer Quotation PDF (optional)' : 'Quotation PDF', { pdfOnly: true, required: !editing })
        + (editing ? H.textarea('sf-reply', 'Reply to the approver’s comment *', '', { rows: 3, placeholder: 'What you changed / your answer' }) : ''),
      ),
      confirmText: editing ? 'Update & Send for Approval' : 'Submit Request',
      onOpen: () => {
        const sel = document.getElementById('sf-dept');
        const wrap = document.getElementById('sf-dept-new-wrap');
        sel?.addEventListener('change', () => {
          wrap.style.display = sel.value === NEW_DEPT ? 'block' : 'none';
          if (sel.value === NEW_DEPT) document.getElementById('sf-dept-new')?.focus();
        });
      },
      onConfirm: async () => {
        let department = H.val('sf-dept');
        if (department === NEW_DEPT) department = H.val('sf-dept-new').trim();
        const body = {
          service_type: H.val('sf-type'), frequency: H.val('sf-freq'), department, priority: H.val('sf-prio'),
          payment_date: H.val('sf-paydate'), approver_id: H.val('sf-approver'), remarks: H.val('sf-remarks').trim(),
        };
        if (!body.service_type) throw new Error('Choose the type of service');
        if (!body.department) throw new Error(H.val('sf-dept') === NEW_DEPT ? 'Write the new department name' : 'Choose the department');
        if (!body.payment_date) throw new Error('Pick the payment date');
        if (!body.approver_id) throw new Error('Choose the approver');
        body.documents = await readFiles('sf-docs', { pdfOnly: true });
        if (!editing && !body.documents.length) throw new Error('Attach the quotation PDF');
        if (editing) {
          body.reply = H.val('sf-reply').trim();
          if (!body.reply) throw new Error('Write a reply to the approver’s comment');
          await H.patch(`/api/amc/requests/${encodeURIComponent(s.id)}`, body);
        }
        const r = editing ? null : await H.post('/api/amc/requests', body);
        H.closeModal('sms-form');
        H.toast(editing ? `${s.id} sent back for approval` : `Service request ${r.id} raised — the approver has been emailed`);
        if (onDone) await onDone(editing ? s.id : r.id);
      },
    });
  }

  /* ── Request drawer ───────────────────────────────────────────────── */

  const ACTION_COLOUR = { Raised: '#0150AA', Updated: '#0150AA', Comment: '#7c3aed', Approved: '#16a34a', Rejected: '#dc2626', 'Sent to Accounts': '#d97706', Paid: '#16a34a' };

  async function requestView(id) {
    let d;
    try { d = await H.api(`/api/amc/requests/${encodeURIComponent(id)}`); } catch (e) { return H.fail(e); }
    const s = d.request;
    const v = d.vendor;
    const c = s.can;
    const activeVendors = D.vendors.filter((x) => x.active || x.id === s.vendor_id);

    let actionHtml = '';
    if (c.decide) {
      actionHtml = `<div class="sms-card" style="border-color:#fde68a;background:#fffbeb;margin-bottom:14px;">
        <h3>Your decision</h3>
        ${H.textarea('sv-note', 'Comment / reason', '', { rows: 3, placeholder: 'Needed for Comment and Reject; optional for Approve' })}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn-primary btn-sm" data-decide="approve">Approve</button>
          <button class="btn-secondary btn-sm" data-decide="comment">Comment — send back to ${esc(s.raised_by_name)}</button>
          <button class="btn-secondary btn-sm" data-decide="reject" style="color:#dc2626;">Reject</button>
        </div></div>`;
    } else if (c.update) {
      actionHtml = `<div class="sms-card" style="border-color:#ddd6fe;background:#f5f3ff;margin-bottom:14px;">
        <h3>The approver has commented</h3>
        <div style="font-size:12.5px;color:#475569;margin-bottom:10px;">Read the comment in the timeline below, update the request and send it back.</div>
        <button class="btn-primary btn-sm" id="sv-update">Update & Send for Approval</button></div>`;
    } else if (c.send) {
      actionHtml = `<div class="sms-card" style="border-color:#bfdbfe;background:#eff6ff;margin-bottom:14px;">
        <h3>Approved — choose the vendor and send to Accounts</h3>
        <div style="display:flex;gap:16px;font-size:12.5px;margin-bottom:10px;">
          <label style="cursor:pointer;"><input type="radio" name="sv-vmode" value="old" ${activeVendors.length ? 'checked' : 'disabled'}/> Existing vendor</label>
          <label style="cursor:pointer;"><input type="radio" name="sv-vmode" value="new" ${activeVendors.length ? '' : 'checked'}/> New vendor</label>
        </div>
        <div id="sv-vold" style="${activeVendors.length ? '' : 'display:none;'}">
          ${H.grid(H.select('sv-vendor', 'Vendor', '', activeVendors.map((x) => ({ value: x.id, label: x.name })), { span: 2, placeholder: '— Select vendor —' }))}
        </div>
        <div id="sv-vnew" style="${activeVendors.length ? 'display:none;' : ''}">
          ${H.grid(
            H.field('nv-name', 'Vendor Name', '', { required: true, span: 2 })
            + H.field('nv-person', 'Contact Person', '') + H.field('nv-phone', 'Phone', '')
            + H.field('nv-email', 'Email', '') + H.field('nv-gstin', 'GSTIN', '')
            + H.field('nv-pan', 'PAN', '') + H.field('nv-holder', 'Account Holder Name', '')
            + H.field('nv-bank', 'Bank Name', '') + H.field('nv-acno', 'Account No.', '')
            + H.field('nv-ifsc', 'IFSC', '') + '<div></div>'
            + H.textarea('nv-address', 'Address', '', { rows: 2 }),
          )}
        </div>
        <div style="margin-top:10px;">${H.grid(H.textarea('sv-snote', 'Note to Accounts (optional)', '', { rows: 2 }))}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary btn-sm" id="sv-send">Send to Accounts</button></div>
      </div>`;
    } else if (c.pay) {
      actionHtml = `<div class="sms-card" style="border-color:#bbf7d0;background:#f0fdf4;margin-bottom:14px;">
        <h3>Record the payment</h3>
        ${H.grid(
          H.field('pv-date', 'Paid On', H.todayISO(), { type: 'date', required: true })
          + H.field('pv-amount', 'Amount Paid (₹)', '', { type: 'number', step: '0.01', required: true })
          + H.select('pv-mode', 'Mode', '', D.lists.PAY_MODES, { required: true, placeholder: '— Select —' })
          + H.field('pv-ref', 'Reference / UTR / Cheque No.', '')
          + H.textarea('pv-note', 'Note (optional)', '', { rows: 2 })
          + fileInput('pv-docs', 'Payment proof (optional)'),
        )}
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary btn-sm" id="sv-pay">Mark Paid</button></div>
      </div>`;
    }

    H.openModal({
      id: 'sms-view', variant: 'drawer', width: 680, hideConfirm: true, cancelText: 'Close',
      title: `${s.id} · ${s.service_type}`, subtitle: `Raised by ${s.raised_by_name} on ${H.fmtDate(s.created_at)}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${pill(s.status)} ${pill(s.priority)}</div>
        ${actionHtml}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Type of Service', s.service_type)}${H.readout('Frequency', s.frequency)}
          ${H.readout('Department', s.department)}${H.readout('Priority', s.priority)}
          ${H.readout('Payment Date', H.fmtDate(s.payment_date))}${H.readout('Approver', s.approver_name)}
          ${H.readout('Vendor', s.vendor_name)}${H.readout('Status', s.status)}
        </div>
        ${s.remarks ? `<div style="font-size:12.5px;color:#475569;margin-top:10px;white-space:pre-wrap;">${esc(s.remarks)}</div>` : ''}
        ${v && v.account_no !== undefined ? sub('Vendor details') + `<div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Contact', [v.contact_person, v.phone].filter(Boolean).join(' · '))}${H.readout('Email', v.email)}
          ${H.readout('GSTIN', v.gstin)}${H.readout('PAN', v.pan)}
          ${H.readout('Account Holder', v.account_holder)}${H.readout('Bank', v.bank_name)}
          ${H.readout('Account No.', v.account_no)}${H.readout('IFSC', v.ifsc)}</div>` : ''}
        ${s.status === 'Paid' ? sub('Payment') + `<div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Paid On', H.fmtDate(s.paid_date))}${H.readout('Amount', s.paid_amount != null ? money(s.paid_amount) : '')}
          ${H.readout('Mode', s.paid_mode)}${H.readout('Reference', s.paid_reference)}${H.readout('Paid By', s.paid_by)}</div>` : ''}
        ${sub('Documents')}${docList(s.id, s.documents)}
        ${sub('Timeline')}
        <div>${d.log.map((n) => `<div style="border-left:3px solid ${ACTION_COLOUR[n.action] || '#cbd5e1'};padding:4px 0 4px 10px;margin:6px 0;">
          <div style="font-size:12.5px;color:#1e293b;"><b>${esc(n.action)}</b> · ${esc(n.by)}</div>
          ${n.note ? `<div style="font-size:12.5px;color:#475569;white-space:pre-wrap;">${esc(n.note)}</div>` : ''}
          <div style="font-size:11px;color:#94a3b8;">${H.fmtDate(n.at)} ${H.fmtTime(n.at)}</div></div>`).join('')}</div>
        ${c.del ? `<div style="margin-top:18px;"><button class="btn-secondary btn-sm" id="sv-del" style="color:#dc2626;">Delete request</button></div>` : ''}`,
      onOpen: () => bindView(s),
    });
  }

  function bindView(s) {
    const $ = (id) => document.getElementById(id);
    const after = async (msg) => { H.closeModal('sms-view'); H.toast(msg); await refresh(); };
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { btn.disabled = false; H.fail(e); } };

    document.querySelectorAll('#sms-view [data-decide]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      const action = b.getAttribute('data-decide');
      const note = H.val('sv-note').trim();
      if (action !== 'approve' && !note) throw new Error(action === 'reject' ? 'Write the reason for rejecting' : 'Write your comment');
      if (action === 'reject' && !(await Utils.showConfirm(`Reject ${s.id}? This is final.`, { title: 'Reject request', confirmText: 'Reject', danger: true }))) { b.disabled = false; return; }
      await H.post(`/api/amc/requests/${encodeURIComponent(s.id)}/decision`, { action, note });
      await after({ approve: `${s.id} approved — ${s.raised_by_name} has been emailed`, reject: `${s.id} rejected`, comment: `Comment sent to ${s.raised_by_name}` }[action]);
    })));

    $('sv-update')?.addEventListener('click', () => {
      H.closeModal('sms-view');
      requestForm(D, s, { onDone: async () => { await refresh(); } });
    });

    document.querySelectorAll('#sms-view input[name="sv-vmode"]').forEach((r) => r.addEventListener('change', () => {
      const isNew = document.querySelector('#sms-view input[name="sv-vmode"]:checked')?.value === 'new';
      $('sv-vold').style.display = isNew ? 'none' : '';
      $('sv-vnew').style.display = isNew ? '' : 'none';
    }));
    $('sv-send')?.addEventListener('click', (e) => busy(e.target, async () => {
      const isNew = document.querySelector('#sms-view input[name="sv-vmode"]:checked')?.value === 'new';
      const body = { note: H.val('sv-snote').trim() };
      if (isNew) {
        body.new_vendor = {
          name: H.val('nv-name').trim(), contact_person: H.val('nv-person'), phone: H.val('nv-phone'), email: H.val('nv-email').trim(),
          gstin: H.val('nv-gstin').trim(), pan: H.val('nv-pan').trim(), account_holder: H.val('nv-holder'), bank_name: H.val('nv-bank'),
          account_no: H.val('nv-acno').trim(), ifsc: H.val('nv-ifsc').trim(), address: H.val('nv-address'),
        };
        if (!body.new_vendor.name) throw new Error('Write the vendor name');
      } else {
        body.vendor_id = H.val('sv-vendor');
        if (!body.vendor_id) throw new Error('Choose the vendor (or switch to New vendor)');
      }
      await H.post(`/api/amc/requests/${encodeURIComponent(s.id)}/send-to-accounts`, body);
      await after(`${s.id} sent to Accounts with the quotation`);
    }));

    $('sv-pay')?.addEventListener('click', (e) => busy(e.target, async () => {
      const body = { paid_date: H.val('pv-date'), amount: H.val('pv-amount'), mode: H.val('pv-mode'), reference: H.val('pv-ref').trim(), note: H.val('pv-note').trim() };
      if (!body.paid_date) throw new Error('Pick the payment date');
      if (body.paid_date > H.todayISO()) throw new Error('Payment date cannot be in the future');
      if (!(Number(body.amount) > 0)) throw new Error('Enter the amount paid');
      if (!body.mode) throw new Error('Choose the payment mode');
      body.documents = await readFiles('pv-docs');
      await H.post(`/api/amc/requests/${encodeURIComponent(s.id)}/paid`, body);
      await after(`${s.id} marked paid — the approver and ${s.raised_by_name} have been emailed`);
    }));

    $('sv-del')?.addEventListener('click', async () => {
      const ok = await Utils.showConfirm(`Delete ${s.id}, its timeline and documents? This cannot be undone.`, { title: 'Delete request', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try { await H.del(`/api/amc/requests/${encodeURIComponent(s.id)}`); await after('Request deleted'); } catch (e) { H.fail(e); }
    });
  }

  /* ── Vendors (admin) ──────────────────────────────────────────────── */

  function vendorsTab() {
    return `
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:10px;">
        <button class="btn-primary btn-sm" id="vd-add">+ Add Vendor</button></div>
      ${H.table([
        'ID', { label: 'Vendor', m: 'title' }, 'Contact', 'GSTIN / PAN', 'Bank', 'Status', { label: '', m: 'actions' },
      ], D.vendors.map((v) => [
        `<b>${esc(v.id)}</b>`, esc(v.name),
        `${esc(v.contact_person)}<div style="font-size:11px;color:#94a3b8;">${esc([v.phone, v.email].filter(Boolean).join(' · '))}</div>`,
        esc([v.gstin, v.pan].filter(Boolean).join(' / ')),
        `${esc(v.bank_name)}<div style="font-size:11px;color:#94a3b8;">${esc([v.account_no, v.ifsc].filter(Boolean).join(' · '))}</div>`,
        v.active ? H.pill('Active', 'success') : H.pill('Inactive', 'neutral'),
        `<div style="display:flex;gap:5px;"><button class="btn-secondary btn-sm" data-edit-vendor="${esc(v.id)}">Edit</button>
          <button class="btn-secondary btn-sm" data-del-vendor="${esc(v.id)}" style="color:#dc2626;">Delete</button></div>`,
      ]), { empty: 'No vendors yet — they are added when a request is sent to Accounts, or here', cards: true })}`;
  }

  function vendorForm(v) {
    const editing = !!v;
    v = v || { active: true };
    H.openModal({
      id: 'sms-vform', width: 620, title: editing ? `Edit ${v.id}` : 'Add Vendor',
      bodyHTML: H.grid(
        H.field('vf-name', 'Vendor Name', v.name, { required: true, span: 2 })
        + H.field('vf-person', 'Contact Person', v.contact_person) + H.field('vf-phone', 'Phone', v.phone)
        + H.field('vf-email', 'Email', v.email) + H.field('vf-gstin', 'GSTIN', v.gstin)
        + H.field('vf-pan', 'PAN', v.pan) + H.field('vf-holder', 'Account Holder Name', v.account_holder)
        + H.field('vf-bank', 'Bank Name', v.bank_name) + H.field('vf-acno', 'Account No.', v.account_no)
        + H.field('vf-ifsc', 'IFSC', v.ifsc)
        + (editing ? H.select('vf-active', 'Status', v.active ? '1' : '0', [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]) : '<div></div>')
        + H.textarea('vf-address', 'Address', v.address || '', { rows: 2 }),
      ),
      confirmText: editing ? 'Save' : 'Add Vendor',
      onConfirm: async () => {
        const body = {
          name: H.val('vf-name').trim(), contact_person: H.val('vf-person'), phone: H.val('vf-phone'), email: H.val('vf-email').trim(),
          gstin: H.val('vf-gstin').trim(), pan: H.val('vf-pan').trim(), account_holder: H.val('vf-holder'), bank_name: H.val('vf-bank'),
          account_no: H.val('vf-acno').trim(), ifsc: H.val('vf-ifsc').trim(), address: H.val('vf-address'),
          services: v.services || '', notes: v.notes || '', active: editing ? H.val('vf-active') === '1' : true,
        };
        if (!body.name) throw new Error('Vendor name is required');
        if (editing) await H.patch(`/api/amc/vendors/${encodeURIComponent(v.id)}`, body); else await H.post('/api/amc/vendors', body);
        H.closeModal('sms-vform');
        H.toast(editing ? 'Vendor updated' : 'Vendor added');
        await refresh();
      },
    });
  }

  /* ── Settings (admin) ─────────────────────────────────────────────── */

  function userPicker(id, label, selected, hint) {
    return `<div class="sms-card">
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
      ${!s.approversSet || !s.accountsSet ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        Not saved yet — showing the defaults (${!s.approversSet ? 'management team = Admins' : ''}${!s.approversSet && !s.accountsSet ? ', ' : ''}${!s.accountsSet ? 'Accounts = Accounts department' : ''}). Tick the right people and press Save.</div>` : ''}
      <div class="sms-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${userPicker('st-appr', 'Management team (approvers)', s.approvers, 'The people a requester can choose as approver.')}
        ${userPicker('st-acc', 'Accounts team', s.accounts, 'Get the “payment required” mail with the quotation and can mark requests paid.')}
        <div class="sms-card">
          <h3>Extra Accounts email IDs</h3>
          <textarea id="st-accmail" rows="3" placeholder="accounts@laltd.in" style="${H.CONTROL}resize:vertical;">${esc(s.accountsEmails.join('\n'))}</textarea>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:4px;">One per line — also get the “payment required” mail.</div>
        </div>
        <div class="sms-card">
          <h3>Departments</h3>
          <textarea id="st-depts" rows="6" style="${H.CONTROL}resize:vertical;">${esc(D.departments.join('\n'))}</textarea>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:4px;">One per line. Requesters can also add one from the form.</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <span style="font-size:11.5px;color:#64748b;align-self:center;margin-right:auto;">Admin access to this page is given from Users → Access → “Service Management”.</span>
        <button class="btn-secondary btn-sm" id="st-test">Send test mail to Accounts</button>
        <button class="btn-primary btn-sm" id="st-save">Save Settings</button>
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-sms-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-sms-tab'); render(); }));
    $('sms-raise')?.addEventListener('click', () => requestForm(D, null, { onDone: async (id) => { await refresh(); requestView(id); } }));

    let t;
    $('sms-q')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        _f.q = e.target.value; render();
        const again = $('sms-q'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    });
    $('sms-status')?.addEventListener('change', (e) => { _f.status = e.target.value; render(); });
    $('sms-export')?.addEventListener('click', exportRequests);
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => requestView(b.getAttribute('data-view'))));

    $('vd-add')?.addEventListener('click', () => vendorForm(null));
    document.querySelectorAll('[data-edit-vendor]').forEach((b) => b.addEventListener('click', () => vendorForm(vendorById(b.getAttribute('data-edit-vendor')))));
    document.querySelectorAll('[data-del-vendor]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-del-vendor');
      if (!(await Utils.showConfirm(`Delete vendor ${id}? A vendor used by a request cannot be deleted — mark it Inactive instead.`, { title: 'Delete vendor', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(`/api/amc/vendors/${encodeURIComponent(id)}`); H.toast('Vendor deleted'); await refresh(); } catch (e) { H.fail(e); }
    }));

    ['st-appr', 'st-acc'].forEach((id) => $(`${id}-q`)?.addEventListener('input', (e) => {
      const n = e.target.value.trim().toLowerCase();
      document.querySelectorAll(`#${id} [data-row]`).forEach((row) => { row.style.display = !n || row.getAttribute('data-row').includes(n) ? 'flex' : 'none'; });
    }));
    const picked = (id) => [...document.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);
    const lines = (id) => H.val(id).split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    $('st-save')?.addEventListener('click', async (e) => {
      const btn = e.target;
      try {
        const body = { approvers: picked('st-appr'), accounts: picked('st-acc'), accountsEmails: lines('st-accmail'), departments: lines('st-depts') };
        if (!body.approvers.length) throw new Error('Tick at least one person for the management team');
        btn.disabled = true;
        await H.post('/api/amc/settings', body);
        H.toast('Settings saved');
        await refresh();
      } catch (err) { btn.disabled = false; H.fail(err); }
    });
    $('st-test')?.addEventListener('click', async () => {
      try { const r = await H.post('/api/amc/test-mail'); H.toast(`Test mail sent to ${r.to}`); } catch (e) { H.fail(e); }
    });
  }

  // The dashboard's "Service Request" button: the same form, without
  // opening this page first.
  async function openRaise() {
    let meta;
    try { meta = await H.api('/api/amc/meta'); } catch (e) { return H.fail(e); }
    requestForm(meta, null, {
      onDone: async () => { if (D && (location.hash || '').replace('#', '') === 'amc') await refresh(); },
    });
  }

  return {
    openRaise,
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Service Management…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load Service Management', e.message); }
    },
  };
})();
