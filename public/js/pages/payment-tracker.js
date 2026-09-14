/* =====================================================================
   Payment Tracker (Retail)
   ---------------------------------------------------------------------
   Every payment the retail side makes is entered here — date, who was
   paid, how much, how, the reference and what for. An entry at or below
   the approval limit is simply Recorded. One above it is saved as Pending
   and mailed to the approver (Saloni Anchan by default) with Approve /
   Reject buttons; it can also be decided right here by an Admin/HOD or a
   named approver. The limit and the approver list are set on this page by
   an Admin. Server side: /api/payment-tracker in server.js.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['payment-tracker'] = (() => {
  const H = window.HR;

  let _data = null;        // { rows, limit, approvers, modes, canApprove, canEditSettings }
  let _status = 'All';
  let _search = '';
  let _month = '';          // 'YYYY-MM' or '' for every month

  const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const VARIANT = { Recorded: 'neutral', Pending: 'warning', Approved: 'success', Rejected: 'danger' };

  async function load() { _data = await H.api('/api/payment-tracker'); }

  /* ── Filters ──────────────────────────────────────────────────────── */
  function visibleRows() {
    const s = _search.trim().toLowerCase();
    return (_data?.rows || []).filter((r) => {
      if (_status !== 'All' && r.status !== _status) return false;
      if (_month && String(r.entry_date || '').slice(0, 7) !== _month) return false;
      if (s && ![r.id, r.party, r.reference_no, r.purpose, r.entered_by, r.payment_mode].some((v) => String(v || '').toLowerCase().includes(s))) return false;
      return true;
    });
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  function render() {
    const el = document.getElementById('main-content');
    if (!el || !_data) return;
    const rows = visibleRows();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const all = _data.rows || [];
    const monthRows = all.filter((r) => String(r.entry_date || '').slice(0, 7) === thisMonth && r.status !== 'Rejected');
    const pending = all.filter((r) => r.status === 'Pending');
    const sum = (list) => list.reduce((n, r) => n + Number(r.amount || 0), 0);

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Payment Tracker', 'Every retail payment in one book — anything above the limit waits for approval',
          `<button id="pt-new" class="btn-primary btn-sm">+ New Payment</button>`)}
        ${H.stats([
          { label: 'Paid this month', value: rupees(sum(monthRows)), hint: `${monthRows.length} entr${monthRows.length === 1 ? 'y' : 'ies'}` },
          { label: 'Waiting for approval', value: pending.length, color: pending.length ? '#d97706' : undefined, hint: pending.length ? rupees(sum(pending)) : 'nothing pending' },
          { label: 'Approval limit', value: rupees(_data.limit), hint: 'above this, the approver is asked', color: '#0f172a' },
          { label: 'Approver', value: (_data.approvers || []).join(', ') || '—', color: '#0f172a' },
        ])}
        ${_data.canEditSettings ? settingsCard() : ''}
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <select id="pt-status" style="${H.CONTROL}width:auto;">
            ${['All', 'Pending', 'Recorded', 'Approved', 'Rejected'].map((s) => `<option value="${s}" ${_status === s ? 'selected' : ''}>${s === 'All' ? 'All statuses' : s}</option>`).join('')}
          </select>
          <input type="month" id="pt-month" value="${H.esc(_month)}" style="${H.CONTROL}width:auto;" />
          <input type="search" id="pt-search" placeholder="Search party, reference, purpose…" value="${H.esc(_search)}" style="${H.CONTROL}flex:1;min-width:200px;" />
          <span style="font-size:12px;color:#94a3b8;">${rows.length} of ${all.length}</span>
          <button id="pt-csv" class="btn-secondary" style="font-size:12px;">Export CSV</button>
        </div>
        ${rows.length ? H.table(
          ['Date', 'No.', 'Paid To', 'Amount', 'Mode', 'Reference', 'Purpose', 'Entered By', 'Status', ''],
          rows.map((r) => [
            H.esc(H.fmtDate(r.entry_date)),
            `<span style="font-family:ui-monospace,monospace;font-size:12px;">${H.esc(r.id)}</span>`,
            `<b style="color:#0f172a;">${H.esc(r.party)}</b>`,
            `<span style="white-space:nowrap;font-weight:${r.amount > _data.limit ? '700' : '500'};">${rupees(r.amount)}</span>`,
            H.esc(r.payment_mode),
            H.esc(r.reference_no || '—'),
            `<span style="display:inline-block;max-width:260px;white-space:normal;">${H.esc(r.purpose || '—')}</span>`,
            H.esc(r.entered_by),
            statusCell(r),
            actionCell(r),
          ]),
          { maxHeight: '560px' },
        ) : H.empty('No payments here', all.length ? 'Nothing matches these filters.' : 'Press "+ New Payment" to enter the first one.')}
      </div>`;
    bind();
  }

  function statusCell(r) {
    const pill = H.pill(r.status, VARIANT[r.status] || 'neutral');
    const who = r.status === 'Approved' || r.status === 'Rejected'
      ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px;">by ${H.esc(r.decided_by)}${r.decided_at ? ' · ' + H.esc(H.fmtDate(r.decided_at)) : ''}${r.decision_note ? '<br>' + H.esc(r.decision_note) : ''}</div>`
      : r.status === 'Pending' ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px;">above ${rupees(r.approval_limit)}</div>` : '';
    return pill + who;
  }

  function actionCell(r) {
    if (r.status !== 'Pending' || !_data.canApprove) return '';
    return `<div style="display:flex;gap:5px;white-space:nowrap;">
      <button class="btn-success btn-xs pt-ok" data-id="${H.esc(r.id)}">Approve</button>
      <button class="btn-danger btn-xs pt-no" data-id="${H.esc(r.id)}">Reject</button>
    </div>`;
  }

  function settingsCard() {
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:700;color:#0f172a;">Approval rule</div>
        <div style="font-size:11.5px;color:#94a3b8;">Admin only — a payment above the limit is mailed to the approver(s) and waits as Pending.</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:end;">
        ${H.field('pt-limit', 'Approval limit (₹)', _data.limit, { type: 'number', step: '1', hint: 'Entries above this need approval' })}
        ${H.field('pt-approvers', 'Approver(s)', (_data.approvers || []).join(', '), { placeholder: 'Saloni Anchan', hint: 'ERP user names or email addresses, comma separated' })}
        <div><button id="pt-save-settings" class="btn-secondary" style="width:100%;">Save rule</button></div>
      </div>
    </div>`;
  }

  /* ── Modals ───────────────────────────────────────────────────────── */
  function openNew() {
    const modes = _data.modes || ['Cash', 'UPI', 'NEFT / RTGS', 'Cheque', 'Card', 'Other'];
    H.openModal({
      id: 'ptn', title: 'New Payment', subtitle: `Above ${rupees(_data.limit)} it goes to ${(_data.approvers || []).join(', ') || 'the approver'} for approval`,
      width: 600, confirmText: 'Save payment',
      bodyHTML: H.grid(
        H.field('ptn-date', 'Date', Utils.todayISO(), { type: 'date', required: true })
        + H.field('ptn-amount', 'Amount (₹)', '', { type: 'number', step: '0.01', required: true, placeholder: '0.00' })
        + H.field('ptn-party', 'Paid To', '', { required: true, placeholder: 'Party / person paid', span: 2 })
        + H.select('ptn-mode', 'Payment Mode', modes[0], modes)
        + H.field('ptn-ref', 'Reference No.', '', { placeholder: 'UPI ref / cheque no. / bill no.' })
        + H.textarea('ptn-purpose', 'Purpose', '', { rows: 2, span: 2, placeholder: 'What this payment was for' })
        + H.textarea('ptn-remarks', 'Remarks', '', { rows: 2, span: 2 }),
        2,
      ),
      onConfirm: async () => {
        const amount = Number(H.val('ptn-amount'));
        if (!H.val('ptn-party').trim()) throw new Error('Paid To is required');
        if (!(amount > 0)) throw new Error('Enter a valid amount');
        const saved = await H.post('/api/payment-tracker', {
          entry_date: H.val('ptn-date'), party: H.val('ptn-party').trim(), amount,
          payment_mode: H.val('ptn-mode'), reference_no: H.val('ptn-ref').trim(),
          purpose: H.val('ptn-purpose').trim(), remarks: H.val('ptn-remarks').trim(),
        });
        H.closeModal('ptn');
        H.toast(saved.status === 'Pending'
          ? `${saved.id} saved — above the limit, so ${(_data.approvers || []).join(', ') || 'the approver'} has been emailed for approval`
          : `${saved.id} recorded`, saved.status === 'Pending' ? 'warning' : 'success');
        await load(); render();
        window.Sidebar?.refreshBadge?.();
      },
    });
  }

  function openDecide(id, decision) {
    const r = (_data.rows || []).find((x) => x.id === id);
    if (!r) return;
    const good = decision === 'Approved';
    H.openModal({
      id: 'ptd', title: `${good ? 'Approve' : 'Reject'} ${r.id}?`, subtitle: `${rupees(r.amount)} to ${r.party} — entered by ${r.entered_by}`,
      width: 480, confirmText: good ? 'Approve' : 'Reject',
      bodyHTML: H.textarea('ptd-note', 'Note (optional)', '', { rows: 3, placeholder: good ? 'Any condition on this approval' : 'Why it is being rejected' }),
      onConfirm: async () => {
        await H.patch('/api/payment-tracker', { id, status: decision, note: H.val('ptd-note').trim() });
        H.closeModal('ptd');
        H.toast(`${id} ${decision.toLowerCase()} — ${r.entered_by} has been emailed`, good ? 'success' : 'warning');
        await load(); render();
        window.Sidebar?.refreshBadge?.();
      },
    });
  }

  /* ── Events ───────────────────────────────────────────────────────── */
  function bind() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    on('pt-new', 'click', openNew);
    on('pt-status', 'change', (e) => { _status = e.target.value; render(); });
    on('pt-month', 'change', (e) => { _month = e.target.value; render(); });
    on('pt-search', 'input', (e) => { _search = e.target.value; render(); document.getElementById('pt-search')?.focus(); });
    on('pt-csv', 'click', () => {
      const rows = visibleRows().map((r) => [r.entry_date, r.id, r.party, r.amount, r.payment_mode, r.reference_no, r.purpose, r.remarks, r.entered_by, r.status, r.decided_by, r.decision_note]);
      H.downloadCsv('payment-tracker.csv', ['Date', 'No', 'Paid To', 'Amount', 'Mode', 'Reference', 'Purpose', 'Remarks', 'Entered By', 'Status', 'Decided By', 'Note'], rows);
    });
    on('pt-save-settings', 'click', async () => {
      try {
        const r = await Utils.apiFetch('/api/payment-tracker/settings', { method: 'PUT', body: JSON.stringify({ limit: H.val('pt-limit'), approvers: H.val('pt-approvers') }) });
        H.toast(`Rule saved — above ${rupees(r.limit)} goes to ${r.approvers.join(', ')}`);
        await load(); render();
      } catch (e) { H.fail(e); }
    });
    document.querySelectorAll('.pt-ok').forEach((b) => b.addEventListener('click', () => openDecide(b.dataset.id, 'Approved')));
    document.querySelectorAll('.pt-no').forEach((b) => b.addEventListener('click', () => openDecide(b.dataset.id, 'Rejected')));
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening the payment book…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load the Payment Tracker', e.message); }
    },
  };
})();
