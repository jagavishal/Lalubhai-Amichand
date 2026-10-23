/* =====================================================================
   Quotation & Payment Approval (route 'quotation-approval', Admin Section)
   ---------------------------------------------------------------------
   Admin submits 3 vendor quotations → a Director approves one (here or
   from the mail) → Admin forwards it to Accounts → Accounts records the
   payments (advance / part / full) until the balance is nil. Server side
   and the full flow: backend/quotation-approval.js.

   Built on window.HR (hr-common.js) for the header, tabs, tiles, modals
   and form fields, like Service Management.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['quotation-approval'] = (() => {
  const H = window.HR;
  const esc = H.esc;

  let D = null;              // /api/quotation-approval/data
  let _tab = 'action';
  const _f = { q: '', status: 'All', urgency: 'All' };

  const VARIANT = {
    'Pending Director Approval': 'warning', Rejected: 'danger', 'Approved – Pending Forwarding': 'info',
    'Pending Payment': 'warning', 'Advance Paid': 'purple', 'Part Paid': 'purple', 'Payment Completed': 'success',
    Urgent: 'danger', Medium: 'info',
  };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');
  const money = (n) => (n == null ? '—' : '₹ ' + H.inr(n, { zero: '0.00' }));
  const payType = (t) => `${t} Payment`;
  const needsMe = (s) => s.can.decide || s.can.forward || s.can.pay;
  const low = (s) => Math.min(...s.quotes.map((x) => x.total));
  const docHref = (id, n) => `/api/quotation-approval/requests/${encodeURIComponent(id)}/documents/${n}`;

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function load() {
    D = await H.api('/api/quotation-approval/data');
    if (!tabsFor().some((t) => t.key === _tab)) _tab = 'action';
  }
  async function refresh() {
    try { await load(); render(); } catch (e) { H.fail(e); }
  }

  function tabsFor() {
    const t = [
      { key: 'action', label: 'Needs My Action', count: D.requests.filter(needsMe).length },
      { key: 'all', label: 'All Quotations', count: D.requests.length },
    ];
    if (D.me.settings) t.push({ key: 'settings', label: 'Settings' });
    return t;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const body = _tab === 'settings' ? settingsTab() : requestsTab();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        @media (max-width: 767px) {
          .qa-filt { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px !important; }
          .qa-filt > input, .qa-filt > select { max-width:none !important; min-height:40px; }
          .qa-filt > input { grid-column:1 / -1; }
          .qa-three, .qa-two { grid-template-columns:1fr !important; }
          .qa-sched-row { grid-template-columns:1fr 1fr !important; }
          .qa-sched-row > input:nth-child(3) { grid-column:1 / -1; }
        }
        .qa-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px; }
        .qa-card h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:0 0 10px; }
        .qa-link { color:var(--color-primary);cursor:pointer;font-weight:600;background:none;border:none;padding:0;font:inherit;text-align:left; }
        .qa-link:hover { text-decoration:underline; }
        .qa-quote { border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#fff;position:relative; }
        .qa-quote.on { border-color:#16a34a;background:#f0fdf4; }
        .qa-quote.pick { cursor:pointer; }
        .qa-quote.pick:hover { border-color:var(--color-primary); }
        .qa-quote .qa-amt { display:flex;justify-content:space-between;font-size:12.5px;color:#475569;padding:2px 0; }
        .qa-quote .qa-total { display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#0f172a;border-top:1px dashed #e2e8f0;margin-top:6px;padding-top:6px; }
        .qa-tag { font-size:10px;font-weight:800;letter-spacing:.05em;padding:2px 7px;border-radius:999px; }
        .qa-sched-row { display:grid;grid-template-columns:150px 150px 1fr 32px;gap:6px;margin-bottom:6px; }
      </style>
      ${H.header('Quotation & Payment Approval', '3 quotations → Director approves one → Accounts pays',
        D.me.admin ? '<button id="qa-new" class="btn-primary btn-sm">+ Submit Quotations</button>' : '')}
      ${H.tabs('qa', tabsFor(), _tab)}
      ${body}
    </div>`;
    bind();
  }

  /* ── Requests list ────────────────────────────────────────────────── */

  function actionLabel(s) {
    if (s.can.decide) return 'Compare & Approve';
    if (s.can.forward) return 'Forward to Accounts';
    if (s.can.pay) return 'Record Payment';
    return 'Open';
  }

  function requestsTab() {
    const n = _f.q.trim().toLowerCase();
    const base = _tab === 'action' ? D.requests.filter(needsMe) : D.requests;
    const list = base.filter((s) => {
      if (_f.status !== 'All' && s.status !== _f.status) return false;
      if (_f.urgency !== 'All' && s.urgency !== _f.urgency) return false;
      if (n && ![s.id, s.title, s.department, s.submitted_by_name, s.approved_vendor, ...s.quotes.map((x) => x.vendor)].join(' ').toLowerCase().includes(n)) return false;
      return true;
    });
    const all = D.requests;
    const count = (st) => all.filter((s) => st.includes(s.status)).length;
    const due = all.filter((s) => s.balance != null && ['Pending Payment', 'Advance Paid', 'Part Paid'].includes(s.status)).reduce((a, s) => a + s.balance, 0);
    const tiles = [
      { label: 'Pending Director', value: count(['Pending Director Approval']), color: '#d97706' },
      { label: 'To Forward', value: count(['Approved – Pending Forwarding']) },
      { label: 'Pending Payment', value: count(['Pending Payment', 'Advance Paid', 'Part Paid']), color: '#d97706' },
      { label: 'Balance Due', value: money(due) },
      { label: 'Completed', value: count(['Payment Completed']), color: '#16a34a' },
      { label: 'Rejected', value: count(['Rejected']), color: count(['Rejected']) ? '#dc2626' : undefined },
    ];
    const empty = _tab === 'action' ? 'Nothing is waiting on you' : 'No quotations submitted yet';
    return `
      ${H.stats(tiles)}
      <div class="qa-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <input id="qa-q" value="${esc(_f.q)}" placeholder="Search id, purchase, vendor, person…" style="${H.CONTROL}max-width:300px;" />
        <select id="qa-status" style="${H.CONTROL}max-width:230px;">
          ${['All', ...D.lists.STATUSES].map((s) => `<option value="${esc(s)}"${_f.status === s ? ' selected' : ''}>${esc(s === 'All' ? 'All Statuses' : s)}</option>`).join('')}
        </select>
        <select id="qa-urg" style="${H.CONTROL}max-width:150px;">
          ${['All', ...D.lists.URGENCIES].map((s) => `<option value="${esc(s)}"${_f.urgency === s ? ' selected' : ''}>${esc(s === 'All' ? 'All Urgency' : s)}</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" id="qa-export">Export CSV</button>
      </div>
      ${H.table([
        'Request', 'Date', { label: 'Purchase / Work', m: 'title' }, 'Urgency', 'Vendor', { label: 'Amount', align: 'right' },
        'Payment', { label: 'Balance', align: 'right' }, 'Status', { label: '', m: 'actions' },
      ], list.map((s) => {
        const l1 = s.quotes.find((x) => x.total === low(s));
        return [
          `<button class="qa-link" data-view="${esc(s.id)}">${esc(s.id)}</button>`,
          H.fmtDate(s.created_at),
          `${esc(s.title)}<div style="font-size:11px;color:#94a3b8;">${esc([s.department, s.submitted_by_name].filter(Boolean).join(' · '))}</div>`,
          pill(s.urgency),
          s.approved_vendor
            ? `<b>${esc(s.approved_vendor)}</b>`
            : `${esc(l1?.vendor || '')} <span style="font-size:10.5px;color:#16a34a;font-weight:700;">L1</span><div style="font-size:11px;color:#94a3b8;">of ${s.quotes.length} quotes</div>`,
          money(s.approved_amount ?? l1?.total),
          esc(payType(s.payment_type)),
          s.balance == null ? '—' : money(s.balance),
          pill(s.status),
          `<button class="${needsMe(s) ? 'btn-primary' : 'btn-secondary'} btn-sm" data-view="${esc(s.id)}">${esc(actionLabel(s))}</button>`,
        ];
      }), { empty, cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${list.length} request${list.length === 1 ? '' : 's'}</div>`;
  }

  function exportRequests() {
    const cols = ['Request ID', 'Date', 'Purchase / Work', 'Department', 'Urgency', 'Payment Type',
      ...[1, 2, 3].flatMap((i) => [`Vendor ${i}`, `Amount ${i}`, `GST ${i}`, `Total ${i}`]),
      'Status', 'Approved Vendor', 'Approved Amount', 'Approved By', 'Approved On', 'Director Remarks', 'Forwarded By', 'Forwarded On', 'Paid', 'Balance', 'Submitted By'];
    const rows = D.requests.map((s) => [s.id, (s.created_at || '').slice(0, 10), s.title, s.department, s.urgency, payType(s.payment_type),
      ...[0, 1, 2].flatMap((i) => { const x = s.quotes[i] || {}; return [x.vendor || '', x.amount ?? '', x.gst ?? '', x.total ?? '']; }),
      s.status, s.approved_vendor, s.approved_amount ?? '', s.decided_by_name, (s.decided_at || '').slice(0, 10), s.director_remarks,
      s.forwarded_by, (s.forwarded_at || '').slice(0, 10), s.paid_total, s.balance ?? '', s.submitted_by_name]);
    H.downloadCsv(`quotation-approvals-${H.todayISO()}.csv`, cols, rows);
  }

  /* ── Files ────────────────────────────────────────────────────────── */

  const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx,application/pdf,image/*';
  async function readFiles(input, label, max = 3) {
    const files = [...(input?.files || [])];
    if (files.length > max) throw new Error(`${label}: at most ${max} files`);
    for (const f of files) if (f.size > 4 * 1024 * 1024) throw new Error(`${label}: "${f.name}" is over 4 MB`);
    return Promise.all(files.map((f) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, dataUrl: r.result, size: f.size });
      r.onerror = () => rej(new Error(`Could not read "${f.name}"`));
      r.readAsDataURL(f);
    })));
  }

  const sub = (t) => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:18px 0 8px;">${esc(t)}</div>`;

  /* ── Payment terms editor (submit + forward) ──────────────────────── */

  function termsHtml(p, s) {
    s = s || { payment_type: 'Full', advance_amount: null, schedule: [] };
    return `<div class="qa-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${H.select(`${p}-ptype`, 'Payment Type', s.payment_type, D.lists.PAY_TYPES.map((t) => ({ value: t, label: payType(t) })), { required: true })}
        <div id="${p}-adv-wrap" style="${s.payment_type === 'Full' ? 'display:none;' : ''}">${H.field(`${p}-adv`, 'Advance Amount (₹)', s.advance_amount ?? '', { type: 'number', step: '0.01', required: true })}</div>
      </div>
      <div id="${p}-sched-wrap" style="margin-top:10px;${s.payment_type === 'Full' ? 'display:none;' : ''}">
        <label style="${H.LABEL}">Payment Schedule — balance after the advance <span id="${p}-sched-req" style="color:#ef4444;${s.payment_type === 'Part' ? '' : 'display:none;'}">*</span></label>
        <div id="${p}-sched">${(s.schedule.length ? s.schedule : [{}]).map((x) => schedRow(x)).join('')}</div>
        <button type="button" class="btn-secondary btn-sm" id="${p}-sched-add">+ Add instalment</button>
      </div>`;
  }
  const schedRow = (x = {}) => `<div class="qa-sched-row">
      <input type="date" value="${esc(x.date || '')}" style="${H.CONTROL}" aria-label="Date" />
      <input type="number" step="0.01" value="${esc(x.amount ?? '')}" placeholder="Amount ₹" style="${H.CONTROL}" aria-label="Amount" />
      <input value="${esc(x.note || '')}" placeholder="Note (e.g. on delivery)" style="${H.CONTROL}" aria-label="Note" />
      <button type="button" class="btn-secondary btn-sm" data-sched-del title="Remove" style="padding:0;">×</button>
    </div>`;
  function bindTerms(p) {
    const sel = document.getElementById(`${p}-ptype`);
    const sync = () => {
      const full = sel.value === 'Full';
      document.getElementById(`${p}-adv-wrap`).style.display = full ? 'none' : '';
      document.getElementById(`${p}-sched-wrap`).style.display = full ? 'none' : '';
      document.getElementById(`${p}-sched-req`).style.display = sel.value === 'Part' ? '' : 'none';
    };
    sel?.addEventListener('change', sync);
    const box = document.getElementById(`${p}-sched`);
    document.getElementById(`${p}-sched-add`)?.addEventListener('click', () => box.insertAdjacentHTML('beforeend', schedRow()));
    box?.addEventListener('click', (e) => { if (e.target.closest('[data-sched-del]')) e.target.closest('.qa-sched-row').remove(); });
  }
  function readTerms(p) {
    const payment_type = H.val(`${p}-ptype`);
    const out = { payment_type };
    if (payment_type !== 'Full') {
      out.advance_amount = H.val(`${p}-adv`);
      if (!(Number(out.advance_amount) > 0)) throw new Error('Enter the advance amount');
      out.schedule = [...document.querySelectorAll(`#${p}-sched .qa-sched-row`)].map((r) => {
        const [d, a, n] = r.querySelectorAll('input');
        return { date: d.value, amount: a.value, note: n.value.trim() };
      }).filter((x) => x.date || x.amount);
      if (out.schedule.some((x) => !x.date || !(Number(x.amount) > 0))) throw new Error('Each schedule line needs a date and an amount');
      if (payment_type === 'Part' && !out.schedule.length) throw new Error('Add the payment schedule for the balance');
    }
    return out;
  }

  /* ── Submit form ──────────────────────────────────────────────────── */

  function submitForm() {
    const quoteCard = (i) => `<div class="qa-quote">
        <div style="font-size:12px;font-weight:800;color:var(--color-primary);margin-bottom:8px;">QUOTATION ${i + 1}</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div><label style="${H.LABEL}">Vendor Name <span style="color:#ef4444">*</span></label>
            <input id="qf-v${i}" list="qa-vendors" style="${H.CONTROL}" autocomplete="off" /></div>
          <div><label style="${H.LABEL}">Quotation Amount (₹) <span style="color:#ef4444">*</span></label>
            <input id="qf-a${i}" type="number" step="0.01" style="${H.CONTROL}" data-calc="${i}" placeholder="Before GST" /></div>
          <div><label style="${H.LABEL}">GST (₹)</label>
            <div style="display:flex;gap:6px;">
              <input id="qf-g${i}" type="number" step="0.01" style="${H.CONTROL}" data-calc="${i}" />
              <select id="qf-gp${i}" style="${H.CONTROL}width:88px;flex:0 0 88px;" data-calc="${i}" title="Fill GST from a rate">
                <option value="">Rate</option>${[0, 5, 12, 18, 28].map((r) => `<option value="${r}">${r}%</option>`).join('')}
              </select>
            </div></div>
          <div class="qa-total" style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;border-top:1px dashed #e2e8f0;padding-top:6px;">
            <span>Total</span><span id="qf-t${i}">₹ 0.00</span></div>
          <div><label style="${H.LABEL}">Attachment(s) <span style="color:#ef4444">*</span></label>
            <input id="qf-f${i}" type="file" multiple accept="${ACCEPT}" style="${H.CONTROL}padding:6px;" />
            <div style="font-size:10.5px;color:#94a3b8;margin-top:3px;">PDF / image / Excel / Word · up to 3 files, 4 MB each</div></div>
          <div><label style="${H.LABEL}">Notes</label>
            <input id="qf-n${i}" style="${H.CONTROL}" placeholder="Delivery, warranty, terms…" /></div>
        </div>
      </div>`;
    H.openModal({
      id: 'qa-form', width: 980, title: 'Submit Quotations for Approval',
      subtitle: `The Director${D.directors.length > 1 ? 's' : ''} (${D.directors.join(', ') || 'not set'}) will be emailed with all ${D.lists.QUOTES} quotations`,
      bodyHTML: `
        ${H.grid(
          H.field('qf-title', 'Purchase / Work', '', { required: true, span: 2, placeholder: 'e.g. CCTV cameras for Vatva factory' })
          + H.field('qf-dept', 'Department / Location', '', { placeholder: 'Optional' })
          + H.select('qf-urg', 'Urgency', 'Medium', D.lists.URGENCIES, { required: true }),
        )}
        <datalist id="qa-vendors">${D.vendors.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
        ${sub(`Vendor quotations (${D.lists.QUOTES})`)}
        <div class="qa-three" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">
          ${[0, 1, 2].map(quoteCard).join('')}
        </div>
        ${sub('Payment terms')}
        ${termsHtml('qf')}
        <div style="margin-top:12px;">${H.grid(H.textarea('qf-remarks', 'Remarks for the Director', '', { rows: 2, placeholder: 'Optional — your recommendation, why it is needed…' }))}</div>`,
      confirmText: 'Submit for Approval',
      onOpen: () => {
        bindTerms('qf');
        const calc = (i) => {
          const a = Number(H.val(`qf-a${i}`)) || 0;
          const rate = H.val(`qf-gp${i}`);
          if (rate !== '' && document.activeElement?.id !== `qf-g${i}`) document.getElementById(`qf-g${i}`).value = (Math.round(a * Number(rate)) / 100).toFixed(2);
          const g = Number(H.val(`qf-g${i}`)) || 0;
          document.getElementById(`qf-t${i}`).textContent = money(a + g);
        };
        document.querySelectorAll('#qa-form [data-calc]').forEach((el) => {
          const i = el.getAttribute('data-calc');
          el.addEventListener('input', () => { if (el.id === `qf-g${i}`) document.getElementById(`qf-gp${i}`).value = ''; calc(i); });
          el.addEventListener('change', () => calc(i));
        });
        document.getElementById('qf-title')?.focus();
      },
      onConfirm: async () => {
        const body = { title: H.val('qf-title').trim(), department: H.val('qf-dept').trim(), urgency: H.val('qf-urg'), remarks: H.val('qf-remarks').trim() };
        if (!body.title) throw new Error('Write what the purchase / work is for');
        body.quotes = [];
        let total = 0;
        for (const i of [0, 1, 2]) {
          const label = `Quotation ${i + 1}`;
          const x = { vendor: H.val(`qf-v${i}`).trim(), amount: H.val(`qf-a${i}`), gst: H.val(`qf-g${i}`) || 0, notes: H.val(`qf-n${i}`).trim() };
          if (!x.vendor) throw new Error(`${label}: vendor name is required`);
          if (!(Number(x.amount) > 0)) throw new Error(`${label}: enter the quotation amount`);
          x.documents = await readFiles(document.getElementById(`qf-f${i}`), label);
          if (!x.documents.length) throw new Error(`${label}: attach the quotation`);
          total += x.documents.reduce((a, d) => a + d.size, 0);
          x.documents = x.documents.map(({ name, dataUrl }) => ({ name, dataUrl }));
          body.quotes.push(x);
        }
        if (total > 8 * 1024 * 1024) throw new Error('Attachments together must be under 8 MB');
        if (new Set(body.quotes.map((x) => x.vendor.toLowerCase())).size !== 3) throw new Error('The three quotations must be from three different vendors');
        Object.assign(body, readTerms('qf'));
        const r = await H.post('/api/quotation-approval/requests', body);
        H.closeModal('qa-form');
        H.toast(`${r.id} submitted — the Director has been emailed`);
        await refresh();
        view(r.id);
      },
    });
  }

  /* ── Request drawer ───────────────────────────────────────────────── */

  const ACTION_COLOUR = { Submitted: '#0150AA', Approved: '#16a34a', Rejected: '#dc2626', 'Forwarded to Accounts': '#d97706', Payment: '#7c3aed', 'Payment Completed': '#16a34a' };

  function quotesHtml(s, pick) {
    const l1 = low(s);
    return `<div class="qa-three" style="display:grid;grid-template-columns:repeat(${s.quotes.length},minmax(0,1fr));gap:10px;">
      ${s.quotes.map((x, i) => `<div class="qa-quote${s.approved_index === i ? ' on' : ''}${pick ? ' pick' : ''}" ${pick ? `data-pick="${i}"` : ''}>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:6px;">
          <div style="font-weight:700;color:#0f172a;font-size:13.5px;word-break:break-word;">
            ${pick ? `<input type="radio" name="qv-pick" value="${i}" style="margin:0 6px 0 0;vertical-align:-2px;">` : ''}${esc(x.vendor)}</div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${x.total === l1 ? '<span class="qa-tag" style="background:#dcfce7;color:#15803d;">L1</span>' : ''}
            ${s.approved_index === i ? '<span class="qa-tag" style="background:#16a34a;color:#fff;">APPROVED</span>' : ''}
          </div>
        </div>
        <div class="qa-amt"><span>Amount</span><span>${money(x.amount)}</span></div>
        <div class="qa-amt"><span>GST</span><span>${money(x.gst)}</span></div>
        <div class="qa-total"><span>Total</span><span>${money(x.total)}</span></div>
        ${x.total !== l1 ? `<div style="font-size:11px;color:#dc2626;margin-top:2px;text-align:right;">+${money(x.total - l1)} vs L1</div>` : ''}
        ${x.notes ? `<div style="font-size:11.5px;color:#64748b;margin-top:6px;">${esc(x.notes)}</div>` : ''}
        <div style="margin-top:8px;">${x.docs.map((d) => `<a href="${docHref(s.id, d.n)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"
          style="display:block;font-size:12px;color:var(--color-primary);font-weight:600;word-break:break-all;padding:2px 0;">📎 ${esc(d.name)}</a>`).join('')}</div>
      </div>`).join('')}
    </div>`;
  }

  async function view(id) {
    let d;
    try { d = await H.api(`/api/quotation-approval/requests/${encodeURIComponent(id)}`); } catch (e) { return H.fail(e); }
    const s = d.request;
    const c = s.can;
    let actionHtml = '';
    if (c.decide) {
      actionHtml = `<div class="qa-card" style="border-color:#fde68a;background:#fffbeb;margin-bottom:14px;">
        <h3>Your decision — pick one quotation below</h3>
        ${H.textarea('qv-remarks', 'Remarks', '', { rows: 2, placeholder: 'Optional for approval; required to reject' })}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn-primary btn-sm" id="qv-approve">Approve selected vendor</button>
          <button class="btn-secondary btn-sm" id="qv-reject" style="color:#dc2626;">Reject all</button>
        </div></div>`;
    } else if (c.forward) {
      actionHtml = `<div class="qa-card" style="border-color:#bfdbfe;background:#eff6ff;margin-bottom:14px;">
        <h3>Approved — review and forward to Accounts</h3>
        ${termsHtml('fw', s)}
        <div style="margin-top:10px;">${H.grid(H.textarea('fw-note', 'Note to Accounts (optional)', '', { rows: 2 }))}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary btn-sm" id="qv-forward">Forward to Accounts</button></div>
      </div>`;
    } else if (c.pay) {
      const nextSched = s.paid_total === 0 && s.advance_amount ? s.advance_amount : (s.schedule.find((x) => x.amount <= s.balance)?.amount ?? s.balance);
      actionHtml = `<div class="qa-card" style="border-color:#bbf7d0;background:#f0fdf4;margin-bottom:14px;">
        <h3>Record a payment</h3>
        <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12.5px;margin-bottom:10px;">
          <span>Approved <b>${money(s.approved_amount)}</b></span><span>Paid <b>${money(s.paid_total)}</b></span>
          <span>Balance <b style="color:#dc2626;">${money(s.balance)}</b></span></div>
        ${H.grid(
          H.field('pv-date', 'Payment Date', H.todayISO(), { type: 'date', required: true })
          + H.field('pv-amount', 'Amount Paid (₹)', Math.min(nextSched, s.balance) || '', { type: 'number', step: '0.01', required: true })
          + H.select('pv-mode', 'Mode', 'NEFT / RTGS', D.lists.PAY_MODES, { required: true })
          + H.field('pv-ref', 'Transaction / Reference No.', '')
          + H.textarea('pv-note', 'Note (optional)', '', { rows: 2 })
          + `<div style="grid-column:span 2;"><label style="${H.LABEL}">Payment proof (optional)</label>
              <input id="pv-docs" type="file" multiple accept="${ACCEPT}" style="${H.CONTROL}padding:6px;" /></div>`,
        )}
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary btn-sm" id="qv-pay">Record Payment</button></div>
      </div>`;
    }

    const payProofs = (key) => s.payment_docs.filter((x) => x.pay === key)
      .map((x) => `<a href="${docHref(s.id, x.n)}" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">📎 ${esc(x.name)}</a>`).join('<br>');

    H.openModal({
      id: 'qa-view', variant: 'drawer', width: 860, hideConfirm: true, cancelText: 'Close',
      title: `${s.id} · ${s.title}`, subtitle: `Submitted by ${s.submitted_by_name} on ${H.fmtDate(s.created_at)}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${pill(s.status)} ${pill(s.urgency)} ${H.pill(payType(s.payment_type), 'neutral')}</div>
        ${actionHtml}
        ${sub('Quotation comparison')}
        ${quotesHtml(s, c.decide)}
        ${s.decided_by_name ? sub(s.status === 'Rejected' ? 'Rejection' : 'Director approval') + `<div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${s.approved_vendor ? H.readout('Approved Vendor', s.approved_vendor) + H.readout('Approved Amount', money(s.approved_amount)) : ''}
          ${H.readout(s.status === 'Rejected' ? 'Rejected By' : 'Approved By', s.decided_by_name)}${H.readout('Date & Time', s.decided_at ? `${H.fmtDate(s.decided_at)} ${H.fmtTime(s.decided_at)}` : '')}
        </div>${s.director_remarks ? `<div style="font-size:12.5px;color:#475569;margin-top:8px;white-space:pre-wrap;"><b>Remarks:</b> ${esc(s.director_remarks)}</div>` : ''}` : ''}
        ${sub('Request & payment terms')}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Department', s.department)}${H.readout('Urgency', s.urgency)}
          ${H.readout('Payment Type', payType(s.payment_type))}${H.readout('Advance', s.payment_type !== 'Full' ? money(s.advance_amount) : '')}
          ${H.readout('Forwarded By', s.forwarded_by)}${H.readout('Forwarded On', s.forwarded_at ? `${H.fmtDate(s.forwarded_at)} ${H.fmtTime(s.forwarded_at)}` : '')}
        </div>
        ${s.schedule.length ? `<div style="font-size:12.5px;color:#475569;margin-top:8px;"><b>Schedule:</b> ${s.schedule.map((x) => `${H.fmtDate(x.date)} — ${money(x.amount)}${x.note ? ` (${esc(x.note)})` : ''}`).join(' · ')}</div>` : ''}
        ${s.remarks ? `<div style="font-size:12.5px;color:#475569;margin-top:8px;white-space:pre-wrap;"><b>Remarks:</b> ${esc(s.remarks)}</div>` : ''}
        ${s.forward_note ? `<div style="font-size:12.5px;color:#475569;margin-top:6px;white-space:pre-wrap;"><b>Note to Accounts:</b> ${esc(s.forward_note)}</div>` : ''}
        ${s.approved_amount != null ? sub('Payments') + `
          <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12.5px;margin-bottom:8px;">
            <span>Approved <b>${money(s.approved_amount)}</b></span><span>Paid <b>${money(s.paid_total)}</b></span><span>Balance <b>${money(s.balance)}</b></span></div>
          ${H.table(['Date', { label: 'Amount', align: 'right' }, 'Mode', 'Reference', 'By', 'Proof'],
            d.payments.map((p) => [H.fmtDate(p.paid_date), money(p.amount), esc(p.mode), esc(p.reference) + (p.note ? `<div style="font-size:11px;color:#94a3b8;">${esc(p.note)}</div>` : ''), esc(p.by), payProofs(p.key) || '—']),
            { empty: 'No payment recorded yet', cards: true })}` : ''}
        ${sub('History')}
        <div>${d.log.map((n) => `<div style="border-left:3px solid ${ACTION_COLOUR[n.action] || '#cbd5e1'};padding:4px 0 4px 10px;margin:6px 0;">
          <div style="font-size:12.5px;color:#1e293b;"><b>${esc(n.action)}</b> · ${esc(n.by)}</div>
          ${n.note ? `<div style="font-size:12.5px;color:#475569;white-space:pre-wrap;">${esc(n.note)}</div>` : ''}
          <div style="font-size:11px;color:#94a3b8;">${H.fmtDate(n.at)} ${H.fmtTime(n.at)}</div></div>`).join('')}</div>
        ${c.del ? `<div style="margin-top:18px;"><button class="btn-secondary btn-sm" id="qv-del" style="color:#dc2626;">Delete request</button></div>` : ''}`,
      onOpen: () => bindView(s),
    });
  }

  function bindView(s) {
    const $ = (id) => document.getElementById(id);
    const after = async (msg) => { H.closeModal('qa-view'); H.toast(msg); await refresh(); };
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { btn.disabled = false; H.fail(e); } };

    // Clicking a quotation card selects it.
    document.querySelectorAll('#qa-view [data-pick]').forEach((card) => card.addEventListener('click', () => {
      card.querySelector('input[type=radio]').checked = true;
      document.querySelectorAll('#qa-view [data-pick]').forEach((x) => x.classList.toggle('on', x === card));
    }));
    $('qv-approve')?.addEventListener('click', (e) => busy(e.target, async () => {
      const picked = document.querySelector('#qa-view input[name="qv-pick"]:checked');
      if (!picked) throw new Error('Select the quotation you are approving');
      const x = s.quotes[Number(picked.value)];
      if (!(await Utils.showConfirm(`Approve ${x.vendor} at ${money(x.total)}?`, { title: 'Approve quotation', confirmText: 'Approve' }))) { e.target.disabled = false; return; }
      await H.post(`/api/quotation-approval/requests/${encodeURIComponent(s.id)}/decision`, { choice: Number(picked.value), remarks: H.val('qv-remarks').trim() });
      await after(`${x.vendor} approved — ${s.submitted_by_name} has been emailed`);
    }));
    $('qv-reject')?.addEventListener('click', (e) => busy(e.target, async () => {
      const remarks = H.val('qv-remarks').trim();
      if (!remarks) throw new Error('Write the reason for rejecting in Remarks');
      if (!(await Utils.showConfirm(`Reject all quotations for ${s.id}? This is final.`, { title: 'Reject', confirmText: 'Reject', danger: true }))) { e.target.disabled = false; return; }
      await H.post(`/api/quotation-approval/requests/${encodeURIComponent(s.id)}/decision`, { choice: 'reject', remarks });
      await after(`${s.id} rejected`);
    }));

    if ($('fw-ptype')) bindTerms('fw');
    $('qv-forward')?.addEventListener('click', (e) => busy(e.target, async () => {
      const body = { ...readTerms('fw'), note: H.val('fw-note').trim() };
      await H.post(`/api/quotation-approval/requests/${encodeURIComponent(s.id)}/forward`, body);
      await after(`${s.id} forwarded to Accounts`);
    }));

    $('qv-pay')?.addEventListener('click', (e) => busy(e.target, async () => {
      const body = { paid_date: H.val('pv-date'), amount: H.val('pv-amount'), mode: H.val('pv-mode'), reference: H.val('pv-ref').trim(), note: H.val('pv-note').trim() };
      if (!body.paid_date) throw new Error('Pick the payment date');
      if (!(Number(body.amount) > 0)) throw new Error('Enter the amount paid');
      if (Number(body.amount) > s.balance + 0.005) throw new Error(`That is more than the balance of ${money(s.balance)}`);
      body.documents = (await readFiles($('pv-docs'), 'Payment proof')).map(({ name, dataUrl }) => ({ name, dataUrl }));
      const r = await H.post(`/api/quotation-approval/requests/${encodeURIComponent(s.id)}/payments`, body);
      await after(r.status === 'Payment Completed' ? `${s.id} fully paid` : `Payment recorded — balance ${money(r.balance)}`);
    }));

    $('qv-del')?.addEventListener('click', async () => {
      if (!(await Utils.showConfirm(`Delete ${s.id}, its history and attachments? This cannot be undone.`, { title: 'Delete request', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(`/api/quotation-approval/requests/${encodeURIComponent(s.id)}`); await after('Request deleted'); } catch (err) { H.fail(err); }
    });
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  function userPicker(id, label, selected, hint) {
    return `<div class="qa-card">
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
      ${!s.directorsSet || !s.accountsSet ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        Not saved yet — showing the defaults. Tick the right people and press Save.</div>` : ''}
      ${s.noPage.length ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        <b>${esc(s.noPage.join(', '))}</b> ${s.noPage.length === 1 ? 'gets' : 'get'} the mails but cannot open this page from the menu.
        Give them “Quotation Approval” from Users → Access if they should (Directors can still approve from the mail).</div>` : ''}
      <div class="qa-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${userPicker('st-dir', 'Directors (approvers)', s.directors, 'Each gets the quotations by mail with an Approve button per vendor, and can approve here.')}
        ${userPicker('st-acc', 'Accounts team', s.accounts, 'Get the “payment required” mail and record payments here.')}
        <div class="qa-card">
          <h3>Extra Accounts email IDs</h3>
          <textarea id="st-accmail" rows="3" placeholder="accounts@laltd.in" style="${H.CONTROL}resize:vertical;">${esc(s.accountsEmails.join('\n'))}</textarea>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:4px;">One per line — also get the “payment required” mail.</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <span style="font-size:11.5px;color:#64748b;align-self:center;margin-right:auto;">Who can submit and forward: Admin/HOD, plus anyone given “Quotation Approval” in Users → Access.</span>
        <button class="btn-primary btn-sm" id="st-save">Save Settings</button>
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-qa-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-qa-tab'); render(); }));
    $('qa-new')?.addEventListener('click', submitForm);
    let t;
    $('qa-q')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        _f.q = e.target.value; render();
        const again = $('qa-q'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    });
    $('qa-status')?.addEventListener('change', (e) => { _f.status = e.target.value; render(); });
    $('qa-urg')?.addEventListener('change', (e) => { _f.urgency = e.target.value; render(); });
    $('qa-export')?.addEventListener('click', exportRequests);
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => view(b.getAttribute('data-view'))));

    ['st-dir', 'st-acc'].forEach((id) => $(`${id}-q`)?.addEventListener('input', (e) => {
      const n = e.target.value.trim().toLowerCase();
      document.querySelectorAll(`#${id} [data-row]`).forEach((row) => { row.style.display = !n || row.getAttribute('data-row').includes(n) ? 'flex' : 'none'; });
    }));
    const picked = (id) => [...document.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);
    $('st-save')?.addEventListener('click', async (e) => {
      const btn = e.target;
      try {
        const body = { directors: picked('st-dir'), accounts: picked('st-acc'), accountsEmails: H.val('st-accmail').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) };
        if (!body.directors.length) throw new Error('Tick at least one Director');
        btn.disabled = true;
        await H.post('/api/quotation-approval/settings', body);
        H.toast('Settings saved');
        await refresh();
      } catch (err) { btn.disabled = false; H.fail(err); }
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Quotation Approval…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load Quotation Approval', e.message); }
    },
  };
})();
