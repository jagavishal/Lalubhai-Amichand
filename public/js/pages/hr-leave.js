/* =====================================================================
   Leave Management
   ---------------------------------------------------------------------
   The HRMS view of leave: typed (PL / CL / SL / EL / LWP), balanced, and
   approved against those balances. It writes to the same table as the
   older Leave Tracker page, so both screens show one truth — this one just
   knows about entitlements, half days and the holiday calendar.

   The balance only ever moves on approval, and moves back if an approval
   is reversed; the page never does that arithmetic itself.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-leave'] = (() => {
  const H = window.HR;

  const now = new Date();
  let _tab = 'requests';
  let _year = now.getFullYear();
  let _statusFilter = 'All';
  let _leaves = [];
  let _balances = null;
  let _holidays = [];
  let _types = [];
  let _masters = { employees: [], branches: [] };

  const STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];

  async function loadMasters() {
    if (!_masters.employees.length) _masters = await H.api('/api/hr/masters');
    _types = _masters.leaveTypes || [];
  }
  const loadRequests = async () => {
    const p = new URLSearchParams({ year: _year });
    if (_statusFilter !== 'All') p.set('status', _statusFilter);
    _leaves = await H.api('/api/hr/leaves?' + p.toString()) || [];
  };
  const loadBalances = async () => { _balances = await H.api(`/api/hr/leave-balances?year=${_year}`); };
  const loadHolidays = async () => { _holidays = await H.api(`/api/hr/holidays?year=${_year}`) || []; };

  /* ── Shell ────────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const admin = H.isAdmin();
    const pending = _leaves.filter((l) => /pending/i.test(l.status)).length;

    const TABS = [{ key: 'requests', label: 'Requests', count: _leaves.length }];
    if (admin) TABS.push({ key: 'balances', label: 'Balances' });
    TABS.push({ key: 'holidays', label: 'Holiday Calendar', count: _holidays.length });
    if (admin) TABS.push({ key: 'types', label: 'Leave Types', count: _types.length });

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Leave Management',
          admin ? 'Requests, approvals, balances and the holiday calendar' : 'Apply for leave and track your balance',
          `<button id="hrl-apply" class="btn-primary btn-sm">+ Apply for Leave</button>`)}
        ${admin && pending ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:11px 14px;
           margin-bottom:14px;font-size:12.5px;color:#92400e;">
           ${pending} leave request${pending === 1 ? '' : 's'} waiting on a decision.</div>` : ''}
        ${H.tabs('hrl', TABS, _tab)}
        <div id="hrl-body">${body(admin)}</div>
      </div>`;

    document.querySelectorAll('[data-hrl-tab]').forEach((b) => b.addEventListener('click', async () => {
      _tab = b.dataset.hrlTab;
      const box = document.getElementById('hrl-body');
      if (box) box.innerHTML = H.spinner();
      try {
        if (_tab === 'balances' && !_balances) await loadBalances();
        if (_tab === 'holidays' && !_holidays.length) await loadHolidays();
      } catch (e) { H.fail(e); }
      render();
    }));
    bindBody();
  }

  function body(admin) {
    if (_tab === 'requests') return requestsView(admin);
    if (_tab === 'balances') return balancesView();
    if (_tab === 'holidays') return holidaysView(admin);
    return typesView();
  }

  /* ── Requests ─────────────────────────────────────────────────────── */

  /* An employee's own entitlements, as a strip of cards above their requests.
     The company-wide grid on the Balances tab is an HR tool and stays behind
     requireAdmin; this is the one number every employee actually wants —
     how much leave they have left — and it is their own row, which the server
     scopes for them. */
  function myBalanceStrip() {
    const row = (_balances?.rows || [])[0];
    if (!row) return '';
    const types = _balances.types || [];
    return `<div style="margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
           color:var(--color-primary);margin-bottom:9px;">My Leave Balance — ${_balances.year}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;">
        ${types.map((t) => {
          const c = row.cells[t.code] || { opening: 0, accrued: 0, used: 0, balance: 0 };
          const entitled = H.num(c.opening) + H.num(c.accrued);
          const left = H.num(c.balance);
          // An unpaid type has no entitlement to run down, so showing it a
          // "balance" would be misleading — it reports what has been taken.
          const unpaid = !H.num(t.paid);
          const tone = unpaid ? '#64748b' : (left > 0 ? '#15803d' : '#b91c1c');
          return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:11px;padding:12px 14px;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
              <span style="font-size:12px;font-weight:700;color:#0f172a;">${H.esc(t.code)}</span>
              <span style="font-size:10px;color:#94a3b8;">${H.esc(t.name)}</span>
            </div>
            <div style="font-size:22px;font-weight:700;color:${tone};margin-top:4px;letter-spacing:-.02em;">
              ${unpaid ? H.num(c.used) : left}</div>
            <div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">
              ${unpaid ? 'days taken' : `left of ${entitled} · ${H.num(c.used)} used`}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function requestsView(admin) {
    const rows = _leaves.map((l) => {
      const pending = /pending/i.test(l.status);
      const actions = admin
        ? `<div style="display:flex;gap:5px;white-space:nowrap;">
             ${pending ? `<button class="btn-success btn-xs hrl-ok" data-id="${H.esc(l.id)}">Approve</button>
                          <button class="btn-danger btn-xs hrl-no" data-id="${H.esc(l.id)}">Reject</button>`
                       : `<button class="btn-ghost btn-xs hrl-reopen" data-id="${H.esc(l.id)}">Change</button>`}
           </div>`
        : '';
      return [
        `<div style="font-weight:600;color:#0f172a;">${H.esc(l.employee_name || l.user_name || '—')}</div>
         <div style="font-size:10.5px;color:#94a3b8;">${H.esc(l.employee_id || '—')}${l.department ? ' · ' + H.esc(l.department) : ''}</div>`,
        `<b>${H.esc(l.leave_type || '—')}</b>`,
        `${H.fmtDate(l.from_date)}<div style="font-size:10.5px;color:#94a3b8;">to ${H.fmtDate(l.to_date)}</div>`,
        `${H.num(l.total_days)}${l.half_day && l.half_day !== 'full' ? `<div style="font-size:10px;color:#b45309;">${H.esc(l.half_day)} half</div>` : ''}`,
        `<div style="max-width:220px;">${H.esc(l.reason || '—')}</div>`,
        H.statusPill(l.status),
        l.balance_after == null ? '—' : H.num(l.balance_after),
        actions,
      ];
    });

    // An employee's own list does not need a column repeating their own name,
    // and has nothing to approve — so it drops the first and last columns.
    const cols = ['Employee', 'Type', 'Period', { label: 'Days', align: 'right' }, 'Reason', 'Status',
      { label: 'Balance After', align: 'right' }];
    if (admin) cols.push({ label: 'Action', nowrap: true });
    const shownCols = admin ? cols : cols.slice(1);
    const shownRows = rows.map((r) => (admin ? r : r.slice(1, 7)));

    return `
      ${admin ? '' : myBalanceStrip()}
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:14px;
           display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px;align-items:end;">
        ${H.select('hrl-f-status', 'Status', _statusFilter, ['All', ...STATUSES])}
        ${H.select('hrl-f-year', 'Year', _year, yearList())}
        <div><button id="hrl-export" class="btn-secondary btn-sm" style="width:100%;">Export CSV</button></div>
      </div>
      ${H.table(shownCols, shownRows,
        { empty: admin ? 'No leave requests for these filters' : 'You have not applied for any leave in this period' })}`;
  }

  const yearList = () => {
    const y = new Date().getFullYear();
    const out = [];
    for (let i = y + 1; i >= 2020; i--) out.push(i);
    return out;
  };

  /* ── Balances ─────────────────────────────────────────────────────── */

  function balancesView() {
    if (!_balances) return H.spinner();
    const types = _balances.types || [];
    const rows = (_balances.rows || []).map((r) => [
      `<div style="font-weight:600;color:#0f172a;">${H.esc(r.name)}</div>
       <div style="font-size:10.5px;color:#94a3b8;">${H.esc(r.id)} · ${H.esc(r.department || '—')}</div>`,
      ...types.flatMap((t) => {
        const c = r.cells[t.code] || { accrued: 0, used: 0, balance: 0 };
        const low = c.balance <= 0;
        return [
          `<span style="color:#64748b;">${H.num(c.opening) + H.num(c.accrued)}</span>`,
          `<span style="color:#b45309;">${H.num(c.used)}</span>`,
          `<b style="color:${low ? '#b91c1c' : '#15803d'};">${H.num(c.balance)}</b>`,
        ];
      }),
      `<button class="btn-ghost btn-xs hrl-editbal" data-id="${H.esc(r.id)}" data-name="${H.esc(r.name)}">Adjust</button>`,
    ]);

    const cols = ['Employee', ...types.flatMap((t) => [
      { label: `${t.code} Entitled`, align: 'right' },
      { label: `${t.code} Used`, align: 'right' },
      { label: `${t.code} Left`, align: 'right' },
    ]), { label: '', nowrap: true }];

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:14px;
           display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px;align-items:end;">
        ${H.select('hrl-b-year', 'Year', _year, yearList())}
        <div><button id="hrl-carry" class="btn-secondary btn-sm" style="width:100%;">Carry Forward from ${_year - 1}</button></div>
        <div><button id="hrl-bal-export" class="btn-secondary btn-sm" style="width:100%;">Export CSV</button></div>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:11px;">
        Entitled is the year's quota plus anything carried forward. Balance moves only when a request is approved.
      </div>
      ${H.table(cols, rows, { empty: 'No active employees', maxHeight: '62vh' })}`;
  }

  /* ── Holiday calendar ─────────────────────────────────────────────── */

  function holidaysView(admin) {
    const byMonth = {};
    for (const h of _holidays) {
      const m = Number(String(h.date).slice(5, 7)) - 1;
      (byMonth[m] ||= []).push(h);
    }
    const today = H.todayISO();
    const cards = H.MONTHS.map((name, i) => {
      const list = byMonth[i] || [];
      if (!list.length) return '';
      return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:9px;">
          ${H.esc(name)} ${_year}</div>
        ${list.map((h) => {
          const past = h.date < today;
          return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px dotted #e2e8f0;opacity:${past ? '.55' : '1'};">
            <div style="width:38px;text-align:center;flex-shrink:0;">
              <div style="font-size:15px;font-weight:700;color:#0f172a;line-height:1;">${String(h.date).slice(8)}</div>
              <div style="font-size:9px;color:#94a3b8;font-weight:600;">${['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(h.date + 'T00:00:00Z').getUTCDay()]}</div>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:#0f172a;">${H.esc(h.name)}</div>
              <div style="font-size:10.5px;color:#94a3b8;">${H.esc(h.type || 'Public')}${h.branch && h.branch !== 'All' ? ' · ' + H.esc(h.branch) : ''}</div>
            </div>
            ${admin ? `<button class="btn-ghost btn-xs hrl-hol-del" data-id="${H.esc(h.id)}" style="color:#b91c1c;">Remove</button>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    }).filter(Boolean).join('');

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:14px;
           display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px;align-items:end;">
        ${H.select('hrl-h-year', 'Year', _year, yearList())}
        ${admin ? '<div><button id="hrl-hol-add" class="btn-primary btn-sm" style="width:100%;">+ Add Holiday</button></div>' : ''}
      </div>
      ${cards
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:13px;">${cards}</div>`
        : H.empty(`No holidays listed for ${_year}`, 'Add the year’s calendar so leave counting and the muster roll know which days are off.')}`;
  }

  /* ── Leave types ──────────────────────────────────────────────────── */

  function typesView() {
    const rows = _types.map((t) => [
      `<b>${H.esc(t.code)}</b>`,
      H.esc(t.name),
      H.num(t.annual_quota),
      H.num(t.paid) ? H.pill('Paid', 'success') : H.pill('Unpaid', 'danger'),
      H.num(t.carry_forward) ? `Yes, up to ${H.num(t.max_carry) || '∞'}` : 'Lapses',
      `<button class="btn-ghost btn-xs hrl-type-edit" data-code="${H.esc(t.code)}">Edit</button>`,
    ]);
    return `
      <div style="margin-bottom:13px;"><button id="hrl-type-add" class="btn-primary btn-sm">+ Add Leave Type</button></div>
      ${H.table(['Code', 'Name', { label: 'Annual Quota', align: 'right' }, 'Pay', 'Carry Forward', { label: '', nowrap: true }], rows)}
      <div style="font-size:12px;color:#94a3b8;margin-top:11px;line-height:1.55;">
        An unpaid type is what payroll treats as loss of pay — LWP exists for exactly that. Changing a quota
        affects balances created from now on; existing balances are adjusted from the Balances tab.
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bindBody() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    const reload = async (fn) => {
      const box = document.getElementById('hrl-body');
      if (box) box.innerHTML = H.spinner();
      try { await fn(); } catch (e) { H.fail(e); }
      render();
    };

    on('hrl-apply', 'click', openApply);
    on('hrl-f-status', 'change', (e) => { _statusFilter = e.target.value; reload(loadRequests); });
    // An employee's balance strip sits on the Requests tab, so changing the
    // year has to refetch it here too — not only on the admin Balances tab.
    on('hrl-f-year', 'change', (e) => {
      _year = Number(e.target.value);
      _balances = null;
      _holidays = [];
      reload(async () => {
        await loadRequests();
        if (!H.isAdmin()) await loadBalances();
      });
    });
    on('hrl-b-year', 'change', (e) => { _year = Number(e.target.value); reload(loadBalances); });
    on('hrl-h-year', 'change', (e) => { _year = Number(e.target.value); reload(loadHolidays); });
    on('hrl-export', 'click', exportRequests);
    on('hrl-bal-export', 'click', exportBalances);
    on('hrl-carry', 'click', carryForward);
    on('hrl-hol-add', 'click', openHoliday);
    on('hrl-type-add', 'click', () => openType(null));

    document.querySelectorAll('.hrl-ok').forEach((b) => b.addEventListener('click', () => decide(b.dataset.id, 'Approved')));
    document.querySelectorAll('.hrl-no').forEach((b) => b.addEventListener('click', () => decide(b.dataset.id, 'Rejected')));
    document.querySelectorAll('.hrl-reopen').forEach((b) => b.addEventListener('click', () => openDecision(b.dataset.id)));
    document.querySelectorAll('.hrl-editbal').forEach((b) => b.addEventListener('click', () => openBalance(b.dataset.id, b.dataset.name)));
    document.querySelectorAll('.hrl-type-edit').forEach((b) => b.addEventListener('click', () => openType(_types.find((t) => t.code === b.dataset.code))));
    document.querySelectorAll('.hrl-hol-del').forEach((b) => b.addEventListener('click', async () => {
      if (!await Utils.showConfirm('Remove this holiday from the calendar?', { title: 'Remove Holiday', confirmText: 'Remove', danger: true })) return;
      try { await H.del('/api/hr/holidays?id=' + encodeURIComponent(b.dataset.id)); await loadHolidays(); render(); }
      catch (e) { H.fail(e); }
    }));
  }

  async function decide(id, status) {
    try {
      const r = await H.patch('/api/hr/leaves', { id, status });
      H.toast(status === 'Approved'
        ? `Approved${r.balanceAfter != null ? ` — ${r.balanceAfter} day(s) left` : ''}`
        : 'Request rejected');
      await loadRequests();
      _balances = null;
      render();
    } catch (e) { H.fail(e); }
  }

  // Changing an already-decided request. Worth a dialog rather than a
  // straight button, because reversing an approval hands the days back.
  function openDecision(id) {
    const l = _leaves.find((x) => x.id === id);
    const body = H.grid(`
      ${H.select('hrld-status', 'Status', l?.status || 'Approved', STATUSES)}
      ${H.field('hrld-comments', 'Comment', l?.approver_comments || '', { span: 2 })}
      <div style="grid-column:1/-1;font-size:12px;color:#64748b;line-height:1.55;background:#f8fafc;
           border:1px solid #e2e8f0;border-radius:9px;padding:10px 12px;">
        Moving away from Approved returns the ${H.num(l?.total_days)} day(s) to the employee's balance;
        moving back to Approved books them again.
      </div>`);
    H.openModal({
      id: 'hrld', title: 'Change Decision', subtitle: `${l?.employee_name || ''} · ${l?.leave_type || ''}`,
      width: 480, bodyHTML: body, confirmText: 'Save',
      onConfirm: async () => {
        await H.patch('/api/hr/leaves', { id, status: H.val('hrld-status'), comments: H.val('hrld-comments') });
        H.closeModal('hrld');
        H.toast('Decision updated');
        await loadRequests();
        _balances = null;
        render();
      },
    });
  }

  // onDone fires after a request is submitted, so a caller outside this
  // page (the Dashboard strip) can refresh what it shows.
  /* Balances for the Apply form, cached per employee for as long as the page
     is open. The form is the moment somebody actually needs this number —
     deciding whether to take three days is exactly when "how many have I got"
     matters — so it is on screen there rather than a tab away. */
  const _balCache = {};
  async function balancesFor(employeeId) {
    const key = employeeId || 'me';
    if (_balCache[key]) return _balCache[key];
    const url = `/api/hr/leave-balances?year=${new Date().getFullYear()}`
      + (employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : '');
    const data = await H.api(url).catch(() => null);
    // The server scopes a non-admin to themselves and ignores the id, so the
    // single row that comes back is the right one either way.
    const row = (data && data.rows || [])[0] || null;
    _balCache[key] = row;
    return row;
  }

  function openApply(onDone) {
    const admin = H.isAdmin();
    const emps = (_masters.employees || []).filter((e) => e.status === 'Active')
      .map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }));
    // A non-admin applies for themselves; the server takes the employee from
    // the session, so the picker is only shown to HR applying on someone's behalf.
    const body = H.grid(`
      ${admin ? H.select('hrla-emp', 'Employee', '', emps, { placeholder: 'Select employee…', required: true, span: 2 }) : ''}
      ${H.select('hrla-type', 'Leave Type', 'CL', _types.map((t) => ({ value: t.code, label: `${t.code} — ${t.name}` })), { required: true })}
      ${H.select('hrla-half', 'Duration', 'full',
        [{ value: 'full', label: 'Full day(s)' }, { value: 'first', label: 'Half day — first half' }, { value: 'second', label: 'Half day — second half' }])}
      ${H.field('hrla-from', 'From', H.todayISO(), { type: 'date', required: true })}
      ${H.field('hrla-to', 'To', H.todayISO(), { type: 'date', required: true })}
      ${H.textarea('hrla-reason', 'Reason', '', { rows: 3 })}
      <div id="hrla-bal" style="grid-column:1/-1;"></div>
      <div id="hrla-hint" style="grid-column:1/-1;font-size:12px;color:#64748b;"></div>
    `);
    H.openModal({
      id: 'hrla', title: 'Apply for Leave', subtitle: 'The balance moves only once this is approved',
      width: 540, bodyHTML: body, confirmText: 'Submit Request',
      onOpen: () => {
        const half = document.getElementById('hrla-half');
        const from = document.getElementById('hrla-from');
        const to = document.getElementById('hrla-to');
        const hint = document.getElementById('hrla-hint');
        const type = document.getElementById('hrla-type');
        const empSel = document.getElementById('hrla-emp');
        const balBox = document.getElementById('hrla-bal');

        const requestedDays = () => {
          const isHalf = half.value !== 'full';
          if (isHalf) return 0.5;
          return Math.max(0, Math.round((new Date(to.value) - new Date(from.value)) / 864e5) + 1);
        };

        /* Every type's balance, with the one being applied for picked out and
           the effect of this request spelled out under it. Showing all of them
           matters: somebody out of CL can see at a glance that they still have
           PL, which is the actual decision being made here. */
        async function paintBalances() {
          if (!balBox) return;
          const row = await balancesFor(admin ? (empSel && empSel.value) : null);
          if (!row) { balBox.innerHTML = ''; return; }
          const code = type ? type.value : '';
          const days = requestedDays();
          const chips = _types.map((t) => {
            const c = row.cells[t.code] || { opening: 0, accrued: 0, used: 0, balance: 0 };
            const unpaid = !H.num(t.paid);
            const left = H.num(c.balance);
            const on = t.code === code;
            const tone = unpaid ? '#64748b' : (left > 0 ? '#15803d' : '#b91c1c');
            return `<div style="flex:1;min-width:78px;text-align:center;padding:7px 6px;border-radius:9px;
                 border:1.5px solid ${on ? 'var(--color-primary)' : '#e2e8f0'};
                 background:${on ? 'var(--color-primary-light)' : '#fff'};">
              <div style="font-size:16px;font-weight:700;color:${tone};line-height:1.1;">
                ${unpaid ? H.num(c.used) : left}</div>
              <div style="font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#94a3b8;margin-top:2px;">
                ${H.esc(t.code)}</div>
            </div>`;
          }).join('');

          let after = '';
          if (code && days) {
            const c = row.cells[code] || { balance: 0 };
            const t = _types.find((x) => x.code === code);
            if (t && !H.num(t.paid)) {
              after = `<div style="font-size:11.5px;color:#64748b;margin-top:7px;">
                ${H.esc(code)} is unpaid — these ${days} day(s) become loss of pay in that month's payroll.</div>`;
            } else {
              const left = H.num(c.balance);
              const remaining = H.num(left - days);
              after = remaining < 0
                ? `<div style="font-size:11.5px;color:#b45309;margin-top:7px;">
                    Only ${left} ${H.esc(code)} left — ${H.num(days - left)} of these ${days} day(s) will be loss of pay.
                    You can still apply.</div>`
                : `<div style="font-size:11.5px;color:#64748b;margin-top:7px;">
                    ${left} ${H.esc(code)} available — ${remaining} would remain after this request.</div>`;
            }
          }
          balBox.innerHTML = `
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
                 color:#94a3b8;margin-bottom:6px;">Leave Balance ${row.name ? '\u00b7 ' + H.esc(row.name) : ''}</div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;">${chips}</div>${after}`;
        }

        const sync = () => {
          // A half day is a single date by definition, so the To field follows
          // From and locks rather than silently producing a nonsense span.
          const isHalf = half.value !== 'full';
          if (isHalf) { to.value = from.value; to.readOnly = true; to.style.background = '#f8fafc'; }
          else { to.readOnly = false; to.style.background = '#fff'; }
          if (to.value < from.value) to.value = from.value;
          const days = requestedDays();
          hint.textContent = days ? `${days} day${days === 1 ? '' : 's'} will be requested.` : '';
          paintBalances();
        };
        [half, from, to, type, empSel].forEach((x) => x && x.addEventListener('change', sync));
        sync();
      },
      onConfirm: async () => {
        const payload = {
          employeeId: admin ? H.val('hrla-emp') : undefined,
          leave_type: H.val('hrla-type'), half_day: H.val('hrla-half'),
          from_date: H.val('hrla-from'), to_date: H.val('hrla-to'), reason: H.val('hrla-reason'),
        };
        if (admin && !payload.employeeId) { H.toast('Pick an employee', 'error'); throw new Error('validation'); }
        const r = await H.post('/api/hr/leaves', payload);
        // The next open must not show a stale balance.
        Object.keys(_balCache).forEach((k) => delete _balCache[k]);
        H.closeModal('hrla');
        H.toast(r.warning || `Leave requested — ${r.days} day(s)`, r.warning ? 'warning' : 'success');
        if (typeof onDone === 'function') { onDone(); return; }
        await loadRequests();
        render();
      },
    });
  }

  function openBalance(employeeId, name) {
    const row = (_balances.rows || []).find((r) => r.id === employeeId);
    const body = H.grid(
      (_balances.types || []).map((t) => {
        const c = row?.cells[t.code] || { opening: 0, accrued: 0, used: 0 };
        return `<div style="grid-column:1/-1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
             color:var(--color-primary);padding-top:8px;border-top:1px solid #f1f5f9;">${H.esc(t.code)} — ${H.esc(t.name)}</div>
          ${H.field(`hrlb-${t.code}-opening`, 'Carried Forward', H.num(c.opening), { type: 'number', step: '0.5' })}
          ${H.field(`hrlb-${t.code}-accrued`, 'This Year', H.num(c.accrued), { type: 'number', step: '0.5' })}
          ${H.field(`hrlb-${t.code}-used`, 'Used', H.num(c.used), { type: 'number', step: '0.5' })}`;
      }).join(''), 3);

    H.openModal({
      id: 'hrlb', title: 'Adjust Leave Balance', subtitle: `${name} · ${employeeId} · ${_year}`,
      width: 560, bodyHTML: body, confirmText: 'Save Balances',
      onConfirm: async () => {
        await H.post('/api/hr/leave-balances', {
          year: _year,
          rows: (_balances.types || []).map((t) => ({
            employeeId, code: t.code,
            opening: H.num(H.val(`hrlb-${t.code}-opening`)),
            accrued: H.num(H.val(`hrlb-${t.code}-accrued`)),
            used: H.num(H.val(`hrlb-${t.code}-used`)),
          })),
        });
        H.closeModal('hrlb');
        H.toast('Balances updated');
        await loadBalances();
        render();
      },
    });
  }

  async function carryForward() {
    const ok = await Utils.showConfirm(
      `This closes ${_year - 1} and opens ${_year}: whatever each employee had left of a carry-forward type is `
      + `brought over as their opening balance (capped at that type's limit), and this year's quota is set fresh. `
      + `Types that lapse are simply reset. Running it again recomputes the same thing.`,
      { title: `Carry Forward ${_year - 1} → ${_year}`, confirmText: 'Carry Forward' });
    if (!ok) return;
    try {
      const r = await H.post('/api/hr/leave-balances/carry-forward', { fromYear: _year - 1 });
      H.toast(`Carried forward into ${r.toYear}`);
      await loadBalances();
      render();
    } catch (e) { H.fail(e); }
  }

  function openHoliday() {
    const body = H.grid(`
      ${H.field('hrlh-date', 'Date', '', { type: 'date', required: true })}
      ${H.select('hrlh-type', 'Type', 'Public', ['Public', 'Company', 'Restricted', 'NonHoliday'])}
      ${H.field('hrlh-name', 'Occasion', '', { required: true, span: 2 })}
      ${H.select('hrlh-branch', 'Applies To Branch', 'All', ['All', ...(_masters.branches || [])])}
      ${H.field('hrlh-notes', 'Note', '')}
    `);
    H.openModal({
      id: 'hrlh', title: 'Add Holiday', subtitle: `Added to the ${_year} calendar`, width: 520, bodyHTML: body,
      onConfirm: async () => {
        if (!H.val('hrlh-date') || !H.val('hrlh-name').trim()) {
          H.toast('Date and occasion are required', 'error');
          throw new Error('validation');
        }
        await H.post('/api/hr/holidays', {
          date: H.val('hrlh-date'), name: H.val('hrlh-name'), type: H.val('hrlh-type'),
          branch: H.val('hrlh-branch'), notes: H.val('hrlh-notes'),
        });
        H.closeModal('hrlh');
        H.toast('Holiday added');
        await loadHolidays();
        render();
      },
    });
  }

  function openType(t) {
    const isNew = !t;
    const body = H.grid(`
      ${H.field('hrlt-code', 'Code', t?.code || '', { required: true, readonly: !isNew, placeholder: 'e.g. ML' })}
      ${H.field('hrlt-name', 'Name', t?.name || '', { required: true })}
      ${H.field('hrlt-annual_quota', 'Annual Quota (days)', H.num(t?.annual_quota), { type: 'number', step: '0.5' })}
      ${H.select('hrlt-paid', 'Pay', H.num(t?.paid ?? 1) ? 'Paid' : 'Unpaid', ['Paid', 'Unpaid'],
        { hint: 'Unpaid types become loss of pay in payroll' })}
      ${H.select('hrlt-carry_forward', 'Carry Forward', H.num(t?.carry_forward) ? 'Yes' : 'No', ['Yes', 'No'])}
      ${H.field('hrlt-max_carry', 'Max Carried Days', H.num(t?.max_carry), { type: 'number', step: '0.5' })}
      ${H.field('hrlt-sort_order', 'Sort Order', H.num(t?.sort_order), { type: 'number' })}
    `);
    H.openModal({
      id: 'hrlt', title: isNew ? 'Add Leave Type' : `Edit ${t.code}`, width: 520, bodyHTML: body,
      onConfirm: async () => {
        const code = H.val('hrlt-code').trim().toUpperCase();
        if (!code) { H.toast('Code is required', 'error'); throw new Error('validation'); }
        await H.post('/api/hr/leave-types', {
          code, name: H.val('hrlt-name') || code,
          annual_quota: H.num(H.val('hrlt-annual_quota')),
          paid: H.val('hrlt-paid') === 'Paid',
          carry_forward: H.val('hrlt-carry_forward') === 'Yes',
          max_carry: H.num(H.val('hrlt-max_carry')),
          sort_order: H.num(H.val('hrlt-sort_order')),
        });
        H.closeModal('hrlt');
        H.toast('Leave type saved');
        _masters = { employees: [], branches: [] };
        await loadMasters();
        render();
      },
    });
  }

  function exportRequests() {
    H.downloadCsv(`Leave Requests ${_year}.csv`,
      ['Leave ID', 'Employee Code', 'Employee', 'Type', 'From', 'To', 'Days', 'Half Day', 'Reason', 'Status', 'Balance After'],
      _leaves.map((l) => [l.id, l.employee_id || '', l.employee_name || l.user_name || '', l.leave_type || '',
        l.from_date || '', l.to_date || '', H.num(l.total_days), l.half_day || 'full',
        l.reason || '', l.status || '', l.balance_after ?? '']));
    H.toast('Leave requests exported');
  }

  function exportBalances() {
    if (!_balances) return;
    const types = _balances.types || [];
    H.downloadCsv(`Leave Balances ${_year}.csv`,
      ['Code', 'Employee', 'Department', ...types.flatMap((t) => [`${t.code} Entitled`, `${t.code} Used`, `${t.code} Left`])],
      (_balances.rows || []).map((r) => [r.id, r.name, r.department || '',
        ...types.flatMap((t) => {
          const c = r.cells[t.code] || {};
          return [H.num(c.opening) + H.num(c.accrued), H.num(c.used), H.num(c.balance)];
        })]));
    H.toast('Balances exported');
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Loading leave…');
      _tab = 'requests';
      _balances = null;
      _holidays = [];
      try {
        await loadMasters();
        await loadRequests();
        // An employee sees their own entitlements above their requests, so the
        // balances come along on the first load rather than behind a tab they
        // do not get. For an Admin this is the company-wide grid and stays on
        // its own tab, fetched only when they open it.
        if (!H.isAdmin()) await loadBalances();
        render();
      } catch (e) {
        if (el) el.innerHTML = H.empty('Could not load leave', e.message);
      }
    },

    /* Open the Apply-for-Leave form from anywhere — the Dashboard puts it on
       a button so an employee never has to find this page to book a day off.
       Loads its own reference data first, because the caller has usually
       never opened Leave Management at all. onDone lets the caller refresh
       whatever it is showing (a balance strip, say) once a request is in. */
    async applyLeave(onDone) {
      try {
        await loadMasters();
        openApply(onDone);
      } catch (e) { H.fail(e); }
    },
  };
})();

/* The retired Leave Tracker's route.
   ---------------------------------------------------------------------
   Leave Management replaced that page and does everything it did, so it is
   gone from the menu — but #leave-tracker is in people's bookmarks and in
   older emails. Rather than leave a second, lesser leave page alive to
   drift out of step, the old route resolves to a redirect. */
window.Pages['leave-tracker'] = {
  render() { window.Router.navigate('hr-leave'); },
};
