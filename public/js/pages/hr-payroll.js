/* =====================================================================
   Payroll
   ---------------------------------------------------------------------
   A month is a run; a run holds one frozen payslip per employee.

   The working order is: pick the month → look at the preview (computed
   live, nothing written) → finish marking attendance → Generate → check
   the register → Finalise. Only a finalised month can be handed out, and
   only the owner can reopen one, because by then the money has moved.

   Everything on screen comes from the stored payslip rows, so the
   register, the slip and the bank sheet cannot disagree with each other.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-payroll'] = (() => {
  const H = window.HR;

  const now = new Date();
  // Payroll is run for a month once it has ended, so the page opens on the
  // previous month — the one people are actually about to pay.
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  let _tab = 'run';
  let _month = start.getMonth() + 1;
  let _year = start.getFullYear();
  let _run = null;          // { run, slips, preview }
  let _runs = [];
  let _mine = [];
  let _masters = { earnings: [], deductions: [] };
  let _busy = false;

  async function loadMasters() {
    if (!_masters.earnings.length) _masters = await H.api('/api/hr/masters');
  }
  const loadRun = async () => { _run = await H.api(`/api/hr/payroll/run?month=${_month}&year=${_year}`); };
  const loadRuns = async () => { _runs = await H.api('/api/hr/payroll') || []; };
  const loadMine = async () => { _mine = await H.api('/api/hr/my-payslips') || []; };

  const totals = (slips) => (slips || []).reduce((t, s) => ({
    gross: t.gross + H.num(s.total_gross),
    ded: t.ded + H.num(s.total_deductions),
    lop: t.lop + H.num(s.leave_deduction),
    net: t.net + H.num(s.net_salary),
  }), { gross: 0, ded: 0, lop: 0, net: 0 });

  /* ── Shell ────────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const admin = H.isAdmin();
    const TABS = admin
      ? [{ key: 'run', label: 'Run Payroll' }, { key: 'history', label: 'History', count: _runs.length },
         { key: 'mine', label: 'My Payslips', count: _mine.length }]
      : [{ key: 'mine', label: 'My Payslips', count: _mine.length }];

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Payroll', admin
          ? 'Generate the month, check the register, then finalise'
          : 'Your salary slips')}
        ${H.tabs('hrp', TABS, _tab)}
        <div id="hrp-body">${body(admin)}</div>
      </div>`;

    document.querySelectorAll('[data-hrp-tab]').forEach((b) => b.addEventListener('click', async () => {
      _tab = b.dataset.hrpTab;
      const box = document.getElementById('hrp-body');
      if (box) box.innerHTML = H.spinner();
      try {
        if (_tab === 'history' && !_runs.length) await loadRuns();
        if (_tab === 'mine' && !_mine.length) await loadMine();
      } catch (e) { H.fail(e); }
      render();
    }));
    bindBody();
  }

  function body(admin) {
    if (_tab === 'mine' || !admin) return mineView();
    if (_tab === 'history') return historyView();
    return runView();
  }

  /* ── Run a month ──────────────────────────────────────────────────── */

  function runView() {
    if (!_run) return H.spinner();
    const preview = _run.preview;
    const run = _run.run;
    const finalised = run?.status === 'finalised';
    const slips = _run.slips || [];
    const t = totals(slips);
    const missing = slips.filter((s) => /No salary structure/i.test(s.note || '')).length;

    const stateBanner = preview
      ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:11px;padding:13px 15px;margin-bottom:14px;
           font-size:12.5px;color:#1d4ed8;line-height:1.6;">
           <b>Preview only — nothing has been saved.</b> These are the figures a run would produce right now, from the
           salary structures in force and the attendance and leave marked so far. Finish marking the month, then Generate.
         </div>`
      : (finalised
        ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:11px;padding:13px 15px;margin-bottom:14px;
             font-size:12.5px;color:#15803d;">
             <b>Finalised${run.finalised_at ? ' on ' + H.fmtDate(run.finalised_at) : ''}.</b> The figures are locked and the
             slips are available to staff. Only the owner account can reopen this month.
           </div>`
        : `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:11px;padding:13px 15px;margin-bottom:14px;
             font-size:12.5px;color:#92400e;">
             <b>Draft.</b> Figures can still be edited or regenerated. Staff cannot see their slips until this month is finalised.
           </div>`);

    const buttons = `
      ${!finalised ? `<button id="hrp-generate" class="btn-primary btn-sm" ${_busy ? 'disabled' : ''}>
        ${_busy ? 'Working…' : (preview ? 'Generate Payroll' : 'Regenerate')}</button>` : ''}
      ${!preview && !finalised ? '<button id="hrp-finalise" class="btn-success btn-sm">Finalise Month</button>' : ''}
      ${finalised && H.isOwner() ? '<button id="hrp-reopen" class="btn-secondary btn-sm">Reopen</button>' : ''}
      ${!preview ? '<button id="hrp-bank" class="btn-secondary btn-sm">Bank Sheet</button>' : ''}
      <button id="hrp-export" class="btn-secondary btn-sm">Export CSV</button>`;

    const E = _masters.earnings || [];
    const D = _masters.deductions || [];
    const rows = slips.map((s) => [
      `<div style="font-weight:600;color:#0f172a;">${H.esc(s.employee_name)}</div>
       <div style="font-size:10.5px;color:#94a3b8;">${H.esc(s.employee_id)}${s.department ? ' · ' + H.esc(s.department) : ''}</div>
       ${s.note ? `<div style="font-size:10px;color:#b45309;margin-top:2px;">${H.esc(s.note)}</div>` : ''}`,
      ...E.map((x) => H.inr(s[x.key])),
      `<b>${H.inr(s.total_gross)}</b>`,
      ...D.map((x) => H.inr(s[x.key])),
      H.inr(s.total_deductions),
      H.num(s.lop_days) ? `<span style="color:#b91c1c;">${H.num(s.lop_days)}</span>` : '—',
      H.inr(s.leave_deduction),
      `<b style="color:#15803d;">${H.inr(s.net_salary)}</b>`,
      preview ? '<span style="color:#cbd5e1;">—</span>' : `
        <div style="display:flex;gap:5px;white-space:nowrap;">
          ${!finalised ? `<button class="btn-ghost btn-xs hrp-edit" data-id="${H.esc(s.id)}">Edit</button>` : ''}
          <a href="/api/hr/payslip/${encodeURIComponent(s.id)}/print" target="_blank" rel="noopener"
             class="btn-ghost btn-xs" style="text-decoration:none;">Slip</a>
        </div>`,
    ]);

    const cols = ['Employee', ...E.map((x) => ({ label: x.label, align: 'right' })), { label: 'Gross', align: 'right' },
      ...D.map((x) => ({ label: x.label, align: 'right' })), { label: 'Deductions', align: 'right' },
      { label: 'LOP Days', align: 'right' }, { label: 'LOP Amt', align: 'right' },
      { label: 'Net Salary', align: 'right' }, { label: '', nowrap: true }];

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:14px;
           display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px;align-items:end;">
        ${H.monthYearPicker('hrp', _month, _year)}
        <div style="grid-column:span 2;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">${buttons}</div>
      </div>
      ${stateBanner}
      ${missing ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:11px 14px;
         margin-bottom:14px;font-size:12.5px;color:#b91c1c;">
         ${missing} employee${missing === 1 ? ' has' : 's have'} no salary structure on record and will be paid zero.
         Add a structure from Employee Master → the employee → Salary.</div>` : ''}
      ${H.stats([
        { label: 'Employees', value: slips.length },
        { label: 'Total Gross', value: '₹ ' + H.inr0(t.gross) },
        { label: 'Deductions', value: '₹ ' + H.inr0(t.ded), color: '#b91c1c' },
        { label: 'Loss of Pay', value: '₹ ' + H.inr0(t.lop), color: '#b45309' },
        { label: 'Net Payable', value: '₹ ' + H.inr0(t.net), color: '#15803d' },
      ])}
      ${H.table(cols, rows, {
        empty: 'No employees on the rolls for this month',
        maxHeight: '58vh',
      })}`;
  }

  /* ── History ──────────────────────────────────────────────────────── */

  function historyView() {
    const rows = _runs.map((r) => [
      `<b>${H.esc(r.monthName)} ${r.year}</b>`,
      H.statusPill(r.status),
      H.num(r.employees),
      H.inr(r.gross), H.inr(r.net),
      H.fmtDate(r.generated_at),
      H.esc(r.generated_by || '—'),
      `<button class="btn-ghost btn-xs hrp-open" data-m="${r.month}" data-y="${r.year}">Open</button>`,
    ]);
    return H.table(['Period', 'Status', { label: 'Employees', align: 'right' }, { label: 'Gross', align: 'right' },
      { label: 'Net Paid', align: 'right' }, 'Generated', 'By', { label: '', nowrap: true }], rows,
      { empty: 'No payroll has been run yet' });
  }

  /* ── An employee's own slips ──────────────────────────────────────── */

  function mineView() {
    const rows = _mine.map((s) => [
      `<b>${H.MONTHS[s.month - 1]} ${s.year}</b>`,
      H.esc(s.id),
      H.inr(s.total_gross), H.inr(s.total_deductions),
      H.num(s.lop_days) || '—',
      `<b style="color:#15803d;">${H.inr(s.net_salary)}</b>`,
      `<a href="/api/hr/payslip/${encodeURIComponent(s.id)}/print" target="_blank" rel="noopener"
          class="btn-secondary btn-xs" style="text-decoration:none;">View / Save PDF</a>`,
    ]);
    return `
      ${H.table(['Period', 'Slip No', { label: 'Gross', align: 'right' }, { label: 'Deductions', align: 'right' },
        { label: 'LOP Days', align: 'right' }, { label: 'Net Paid', align: 'right' }, { label: '', nowrap: true }], rows,
        { empty: 'No finalised payslips yet' })}
      <div style="font-size:12px;color:#94a3b8;margin-top:11px;">
        Slips appear here once the month has been finalised by HR.
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bindBody() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    const reload = async () => {
      const box = document.getElementById('hrp-body');
      if (box) box.innerHTML = H.spinner();
      try { await loadRun(); } catch (e) { H.fail(e); }
      render();
    };

    on('hrp-month', 'change', (e) => { _month = Number(e.target.value); reload(); });
    on('hrp-year', 'change', (e) => { _year = Number(e.target.value); reload(); });
    on('hrp-generate', 'click', generate);
    on('hrp-finalise', 'click', finalise);
    on('hrp-reopen', 'click', reopen);
    on('hrp-bank', 'click', bankSheet);
    on('hrp-export', 'click', exportRegister);

    document.querySelectorAll('.hrp-edit').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.id)));
    document.querySelectorAll('.hrp-open').forEach((b) => b.addEventListener('click', async () => {
      _month = Number(b.dataset.m);
      _year = Number(b.dataset.y);
      _tab = 'run';
      const box = document.getElementById('hrp-body');
      if (box) box.innerHTML = H.spinner();
      try { await loadRun(); } catch (e) { H.fail(e); }
      render();
    }));
  }

  async function generate() {
    const label = `${H.MONTHS[_month - 1]} ${_year}`;
    const regenerating = !_run?.preview;
    const ok = await Utils.showConfirm(
      regenerating
        ? `${label} will be rebuilt from scratch: existing draft payslips are discarded and recomputed from the current salary structures, attendance and leave. Any figure edited by hand on a slip will be lost.`
        : `Payroll for ${label} will be generated from the salary structures in force, plus the attendance and leave marked for that month. It stays a draft until you finalise it.`,
      { title: regenerating ? 'Regenerate Payroll' : 'Generate Payroll', confirmText: regenerating ? 'Regenerate' : 'Generate' });
    if (!ok) return;
    _busy = true;
    render();
    try {
      const r = await H.post('/api/hr/payroll/generate', { month: _month, year: _year });
      H.toast(`${label}: ${r.employees} payslips, ₹ ${H.inr0(r.net)} net`);
      _runs = [];
      await loadRun();
    } catch (e) { H.fail(e); }
    _busy = false;
    render();
  }

  async function finalise() {
    const t = totals(_run.slips);
    const ok = await Utils.showConfirm(
      `${H.MONTHS[_month - 1]} ${_year} will be locked at ₹ ${H.inr0(t.net)} net across ${_run.slips.length} employees. `
      + `The figures can no longer be edited or regenerated, and every employee will be able to see their own slip. `
      + `Only the owner account can reopen the month afterwards.`,
      { title: 'Finalise Payroll', confirmText: 'Finalise' });
    if (!ok) return;
    try {
      await H.post('/api/hr/payroll/finalise', { month: _month, year: _year });
      H.toast('Month finalised');
      _runs = [];
      await loadRun();
      render();
    } catch (e) { H.fail(e); }
  }

  async function reopen() {
    const ok = await Utils.showConfirm(
      `Reopening puts ${H.MONTHS[_month - 1]} ${_year} back into draft. Staff lose sight of their slips for this month `
      + `until it is finalised again. Salaries for this month have most likely already been paid — reopen only to correct `
      + `something that is genuinely wrong.`,
      { title: 'Reopen Finalised Month', confirmText: 'Reopen', danger: true });
    if (!ok) return;
    try {
      await H.post('/api/hr/payroll/reopen', { month: _month, year: _year });
      H.toast('Month reopened as draft');
      _runs = [];
      await loadRun();
      render();
    } catch (e) { H.fail(e); }
  }

  // One slip, corrected by hand — an arrear, a one-off bonus, a loan
  // instalment. Totals are recomputed server-side from the parts.
  function openEdit(id) {
    const s = (_run.slips || []).find((x) => x.id === id);
    if (!s) return;
    const E = _masters.earnings || [];
    const D = _masters.deductions || [];
    const body = H.grid(`
      ${H.sectionTitle('Earnings')}
      ${E.map((x) => H.field('hrpe-' + x.key, x.label, H.num(s[x.key]), { type: 'number', step: '0.01' })).join('')}
      ${H.sectionTitle('Deductions')}
      ${D.map((x) => H.field('hrpe-' + x.key, x.label, H.num(s[x.key]), { type: 'number', step: '0.01' })).join('')}
      ${H.sectionTitle('Attendance')}
      ${H.field('hrpe-lop_days', 'Loss of Pay Days', H.num(s.lop_days), { type: 'number', step: '0.5',
        hint: `Out of ${H.num(s.month_days)} days in the month` })}
      ${H.field('hrpe-note', 'Note on the slip', s.note || '')}
      <div style="grid-column:1/-1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;
           text-align:right;font-size:12.5px;color:#475569;">
        Gross <b id="hrpe-gross" style="color:#0f172a;"></b> &nbsp;·&nbsp;
        Deductions <b id="hrpe-ded" style="color:#b91c1c;"></b> &nbsp;·&nbsp;
        LOP <b id="hrpe-lop" style="color:#b45309;"></b> &nbsp;·&nbsp;
        Net <b id="hrpe-net" style="color:#15803d;"></b>
      </div>`);

    H.openModal({
      id: 'hrpe', title: `Edit Payslip ${s.id}`, subtitle: `${s.employee_name} · ${H.MONTHS[s.month - 1]} ${s.year}`,
      width: 620, bodyHTML: body, confirmText: 'Save Payslip',
      onOpen: () => {
        const recalc = () => {
          const g = E.reduce((t, x) => t + H.num(H.val('hrpe-' + x.key)), 0);
          const d = D.reduce((t, x) => t + H.num(H.val('hrpe-' + x.key)), 0);
          const mdays = H.num(s.month_days) || 30;
          const lopDays = Math.min(H.num(H.val('hrpe-lop_days')), mdays);
          const lop = (g / mdays) * lopDays;
          document.getElementById('hrpe-gross').textContent = '₹ ' + H.inr0(g);
          document.getElementById('hrpe-ded').textContent = '₹ ' + H.inr0(d);
          document.getElementById('hrpe-lop').textContent = '₹ ' + H.inr0(lop);
          document.getElementById('hrpe-net').textContent = '₹ ' + H.inr0(g - d - lop);
        };
        [...E, ...D].forEach((x) => document.getElementById('hrpe-' + x.key)?.addEventListener('input', recalc));
        document.getElementById('hrpe-lop_days')?.addEventListener('input', recalc);
        recalc();
      },
      onConfirm: async () => {
        const payload = { id, lop_days: H.num(H.val('hrpe-lop_days')), note: H.val('hrpe-note') };
        [...E, ...D].forEach((x) => { payload[x.key] = H.num(H.val('hrpe-' + x.key)); });
        await H.patch('/api/hr/payslip', payload);
        H.closeModal('hrpe');
        H.toast('Payslip updated');
        await loadRun();
        render();
      },
    });
  }

  // The bank's upload file: who to pay, where, how much — and nothing else,
  // because this one leaves the building.
  async function bankSheet() {
    try {
      const r = await H.api(`/api/hr/payroll/bank-sheet?month=${_month}&year=${_year}`);
      if (!r.rows?.length) { H.toast('No payable salaries for this month', 'warning'); return; }
      H.downloadCsv(`Bank Payment ${r.monthName} ${r.year}.csv`,
        ['Employee Code', 'Beneficiary Name', 'Bank', 'Account No', 'IFSC', 'Amount'],
        r.rows.map((x) => [x.employee_id, x.employee_name, x.bank_name || '', x.account_no || '', x.ifsc || '',
          H.num(x.net_salary).toFixed(2)]));
      const noBank = r.rows.filter((x) => !x.account_no).length;
      H.toast(noBank
        ? `Bank sheet downloaded — ${noBank} employee(s) have no account number on file`
        : 'Bank sheet downloaded', noBank ? 'warning' : 'success');
    } catch (e) { H.fail(e); }
  }

  function exportRegister() {
    const E = _masters.earnings || [];
    const D = _masters.deductions || [];
    H.downloadCsv(`Salary Register ${H.MONTHS[_month - 1]} ${_year}.csv`,
      ['Slip No', 'Employee Code', 'Employee', 'Designation', 'Department', 'Branch',
        ...E.map((x) => x.label), 'Total Gross', ...D.map((x) => x.label), 'Total Deductions',
        'Month Days', 'Paid Days', 'LOP Days', 'LOP Amount', 'Net Salary'],
      (_run.slips || []).map((s) => [s.id, s.employee_id, s.employee_name, s.designation || '',
        s.department || '', s.branch || '',
        ...E.map((x) => H.num(s[x.key]).toFixed(2)), H.num(s.total_gross).toFixed(2),
        ...D.map((x) => H.num(s[x.key]).toFixed(2)), H.num(s.total_deductions).toFixed(2),
        H.num(s.month_days), H.num(s.paid_days), H.num(s.lop_days),
        H.num(s.leave_deduction).toFixed(2), H.num(s.net_salary).toFixed(2)]));
    H.toast('Salary register exported');
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Loading payroll…');
      const admin = H.isAdmin();
      _tab = admin ? 'run' : 'mine';
      _run = null;
      _runs = [];
      _mine = [];
      try {
        await loadMasters();
        if (admin) await loadRun(); else await loadMine();
        render();
      } catch (e) {
        if (el) el.innerHTML = H.empty('Could not load payroll', e.message);
      }
    },
  };
})();
