/* =====================================================================
   Attendance
   ---------------------------------------------------------------------
   Three views of the same one-row-per-employee-per-day record:

     My Attendance — the punch card. Check in and out from a phone, with
       the location captured the way the old Apps Script did.
     Muster Roll   — the month as a grid, one column per day. Leave,
       holidays and week-offs are filled in by the server on read, so HR
       only ever marks the exceptions.
     Mark Day      — the whole team for one date, marked in a single pass.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-attendance'] = (() => {
  const H = window.HR;

  const now = new Date();
  let _tab = 'me';
  let _me = null;
  let _muster = null;
  let _masters = { employees: [], attendanceStatuses: [], branches: [] };
  let _month = now.getMonth() + 1;
  let _year = now.getFullYear();
  let _branch = 'All';
  let _markDate = H.todayISO();
  let _marks = {};      // employeeId → status, for the Mark Day sheet
  let _punching = false;

  // Falls back to a neutral chip for any status the server adds later.
  const styleOf = (s) => (_masters.attendanceStatuses || []).find((x) => x.key === s)
    || { key: s, label: s || '', short: (s || '').slice(0, 2), bg: '#f8fafc', fg: '#94a3b8' };

  async function loadMasters() {
    if (!_masters.employees.length) _masters = await H.api('/api/hr/masters');
  }
  const loadMe = async () => { _me = await H.api('/api/hr/attendance/me'); };
  const loadMuster = async () => {
    const p = new URLSearchParams({ month: _month, year: _year });
    if (_branch !== 'All') p.set('branch', _branch);
    _muster = await H.api('/api/hr/attendance?' + p.toString());
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const admin = H.isAdmin();
    const TABS = [{ key: 'me', label: 'My Attendance' }];
    if (admin) TABS.push({ key: 'muster', label: 'Muster Roll' }, { key: 'mark', label: 'Mark a Day' });

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Attendance', 'Daily punches, the monthly muster roll, and corrections')}
        ${TABS.length > 1 ? H.tabs('hra', TABS, _tab) : ''}
        <div id="hra-body">${body(admin)}</div>
      </div>`;

    document.querySelectorAll('[data-hra-tab]').forEach((b) => b.addEventListener('click', async () => {
      _tab = b.dataset.hraTab;
      const box = document.getElementById('hra-body');
      if (box) box.innerHTML = H.spinner();
      try {
        if (_tab === 'muster' && !_muster) await loadMuster();
        if (_tab === 'me' && !_me) await loadMe();
      } catch (e) { H.fail(e); }
      render();
    }));
    bindBody();
  }

  function body(admin) {
    if (_tab === 'me') return myCard();
    if (!admin) return '';
    if (_tab === 'muster') return musterView();
    return markView();
  }

  /* ── My attendance ────────────────────────────────────────────────── */

  function myCard() {
    if (!_me) return H.spinner();
    if (!_me.employee) {
      return H.empty('No employee record is linked to your login',
        'Attendance is kept against the employee master, not the login list. Ask HR to open Employee Master → Link Logins, or to set your employee record’s email to match your login.');
    }
    const t = _me.today;
    const inAt = t?.check_in ? H.fmtTime(t.check_in) : null;
    const outAt = t?.check_out ? H.fmtTime(t.check_out) : null;
    const s = _me.settings || {};

    const button = !inAt
      ? `<button id="hra-punch-in" class="btn-primary btn-lg" ${_punching ? 'disabled' : ''}>${_punching ? 'Checking in…' : 'Check In'}</button>`
      : (!outAt
        ? `<button id="hra-punch-out" class="btn-success btn-lg" ${_punching ? 'disabled' : ''}>${_punching ? 'Checking out…' : 'Check Out'}</button>`
        : `<div style="font-size:13px;color:#15803d;font-weight:600;">Day complete — ${H.num(t.working_hours)} hours</div>`);

    const rows = (_me.month || []).map((a) => [
      H.fmtDate(a.att_date), H.fmtTime(a.check_in), H.fmtTime(a.check_out),
      H.num(a.working_hours) || '—',
      a.late_mark ? H.pill('Late', 'warning') : '—',
      H.statusPill(a.status),
    ]);

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;margin-bottom:16px;
           display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        ${UI.avatar(_me.employee.name, { size: 54, shape: 'square' })}
        <div style="flex:1;min-width:180px;">
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${H.esc(_me.employee.name)}</div>
          <div style="font-size:12.5px;color:#64748b;">${H.esc(_me.employee.designation || '')} · ${H.esc(_me.employee.id)}</div>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:5px;">
            Shift ${H.esc(s.hr_shift_start || '09:00')} – ${H.esc(s.hr_shift_end || '18:00')},
            ${H.esc(s.hr_grace_minutes || '15')} min grace
          </div>
        </div>
        <div style="display:flex;gap:22px;align-items:center;">
          <div style="text-align:center;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">In</div>
            <div style="font-size:16px;font-weight:700;color:${inAt ? '#0f172a' : '#cbd5e1'};margin-top:2px;">${inAt || '—'}</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">Out</div>
            <div style="font-size:16px;font-weight:700;color:${outAt ? '#0f172a' : '#cbd5e1'};margin-top:2px;">${outAt || '—'}</div>
          </div>
          ${button}
        </div>
      </div>
      ${t?.late_mark ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;
           margin-bottom:14px;font-size:12.5px;color:#92400e;">Today is marked late — you checked in after
           ${H.esc(s.hr_shift_start || '09:00')} plus the ${H.esc(s.hr_grace_minutes || '15')} minute grace.</div>` : ''}
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:9px;">
        This Month</div>
      ${H.table(['Date', 'Check In', 'Check Out', { label: 'Hours', align: 'right' }, 'Late', 'Status'], rows,
        { empty: 'No punches recorded this month yet' })}`;
  }

  /* Location is a courtesy, never a gate: if the browser refuses or the
     device has no fix, the punch still goes through without coordinates
     rather than leaving someone unable to mark their own attendance. */
  function coords() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      const done = (v) => resolve(v);
      const timer = setTimeout(() => done({}), 6000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); done({ lat: String(pos.coords.latitude), lon: String(pos.coords.longitude) }); },
        () => { clearTimeout(timer); done({}); },
        { enableHighAccuracy: true, timeout: 5500, maximumAge: 60000 },
      );
    });
  }

  async function punch(type) {
    _punching = true;
    render();
    try {
      const c = await coords();
      const r = await H.post('/api/hr/attendance/punch', { type, ...c });
      H.toast(type === 'in'
        ? (r.late ? 'Checked in — marked late' : 'Checked in')
        : `Checked out — ${r.workingHours} hours`);
      await loadMe();
    } catch (e) {
      H.fail(e);
    } finally {
      _punching = false;
      render();
    }
  }

  /* ── Muster roll ──────────────────────────────────────────────────── */

  function musterView() {
    if (!_muster) return H.spinner();
    const days = _muster.days || [];
    const legend = (_masters.attendanceStatuses || []).map((s) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#64748b;margin-right:13px;">
         <span style="width:17px;height:17px;border-radius:5px;background:${s.bg};color:${s.fg};font-size:9px;
           font-weight:800;display:inline-flex;align-items:center;justify-content:center;">${H.esc(s.short)}</span>${H.esc(s.label)}</span>`).join('');

    const totals = (_muster.rows || []).reduce((t, r) => {
      t.present += r.tally.Present + r.tally.Remote;
      t.absent += r.tally.Absent;
      t.leave += r.tally.Leave;
      t.late += r.tally.late;
      return t;
    }, { present: 0, absent: 0, leave: 0, late: 0 });

    const dayHead = days.map((d) => {
      const dt = new Date(d + 'T00:00:00Z');
      const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dt.getUTCDay()];
      const weekend = dt.getUTCDay() === 0;
      return `<th style="${H.TH}padding:5px 0;text-align:center;min-width:27px;${weekend ? 'background:#f1f5f9;' : ''}">
        <div style="font-size:11px;color:#334155;">${dt.getUTCDate()}</div>
        <div style="font-size:9px;color:#94a3b8;font-weight:600;">${dow}</div></th>`;
    }).join('');

    const rows = (_muster.rows || []).map((r) => `
      <tr>
        <td style="${H.TD}position:sticky;left:0;background:#fff;z-index:2;white-space:nowrap;min-width:190px;
             box-shadow:1px 0 0 #e2e8f0;">
          <div style="font-weight:600;color:#0f172a;">${H.esc(r.name)}</div>
          <div style="font-size:10.5px;color:#94a3b8;">${H.esc(r.id)} · ${H.esc(r.department || '—')}</div>
        </td>
        ${r.cells.map((c) => {
          if (!c.status) return `<td style="${H.TD}padding:3px 1px;text-align:center;background:#fcfcfd;"></td>`;
          const s = styleOf(c.status);
          const title = [c.date, s.label, c.leaveType ? `(${c.leaveType})` : '', c.name || '',
            c.in ? 'in ' + H.fmtTime(c.in) : '', c.late ? 'late' : ''].filter(Boolean).join(' · ');
          return `<td style="${H.TD}padding:3px 1px;text-align:center;">
            <button class="hra-cell" data-emp="${H.esc(r.id)}" data-date="${H.esc(c.date)}" data-status="${H.esc(c.status)}"
              title="${H.esc(title)}"
              style="width:23px;height:23px;border-radius:5px;border:none;cursor:pointer;font-size:9px;font-weight:800;
                background:${s.bg};color:${s.fg};${c.late ? 'box-shadow:inset 0 -2.5px 0 #f59e0b;' : ''}">
              ${H.esc(s.short)}</button></td>`;
        }).join('')}
        <td style="${H.TD}text-align:center;font-weight:700;color:#15803d;">${r.tally.Present + r.tally.Remote}</td>
        <td style="${H.TD}text-align:center;font-weight:700;color:#b91c1c;">${r.tally.Absent}</td>
        <td style="${H.TD}text-align:center;color:#5b21b6;">${r.tally.Leave}</td>
        <td style="${H.TD}text-align:center;color:#b45309;">${r.tally.late}</td>
      </tr>`).join('');

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:14px;
           display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:11px;align-items:end;">
        ${H.monthYearPicker('hra', _month, _year)}
        ${H.select('hra-branch', 'Branch', _branch, ['All', ...(_masters.branches || [])])}
        <div><button id="hra-export" class="btn-secondary btn-sm" style="width:100%;">Export CSV</button></div>
      </div>
      ${H.stats([
        { label: 'Employees', value: (_muster.rows || []).length },
        { label: 'Present Days', value: totals.present, color: '#16a34a' },
        { label: 'Absent Days', value: totals.absent, color: '#dc2626' },
        { label: 'Leave Days', value: totals.leave, color: '#7c3aed' },
        { label: 'Late Marks', value: totals.late, color: '#d97706' },
      ])}
      <div style="margin-bottom:11px;">${legend}
        <span style="font-size:11.5px;color:#94a3b8;">· click any cell to correct it</span></div>
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
        <div style="overflow:auto;max-height:65vh;">
          <table style="border-collapse:collapse;">
            <thead><tr>
              <th style="${H.TH}position:sticky;left:0;z-index:3;min-width:190px;box-shadow:1px 0 0 #e2e8f0;">Employee</th>
              ${dayHead}
              <th style="${H.TH}text-align:center;">P</th>
              <th style="${H.TH}text-align:center;">A</th>
              <th style="${H.TH}text-align:center;">L</th>
              <th style="${H.TH}text-align:center;">Late</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="${days.length + 5}" style="padding:44px;text-align:center;color:#94a3b8;">No employees for this month</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ── Mark a whole day ─────────────────────────────────────────────── */

  function markView() {
    const emps = (_masters.employees || []).filter((e) => e.status === 'Active');
    const opts = (_masters.attendanceStatuses || []).map((s) => s.key);
    const rows = emps.map((e) => [
      `<span style="font-weight:600;color:#0f172a;">${H.esc(e.name)}</span>
       <span style="color:#94a3b8;font-size:11px;">${H.esc(e.id)}</span>`,
      H.esc(e.department || '—'),
      H.esc(e.branch || '—'),
      `<select class="hra-mark" data-emp="${H.esc(e.id)}" style="${H.CONTROL}padding:5px 9px;font-size:12px;">
         <option value="">— leave as is —</option>
         ${opts.map((o) => `<option value="${H.esc(o)}"${_marks[e.id] === o ? ' selected' : ''}>${H.esc(styleOf(o).label)}</option>`).join('')}
       </select>`,
    ]);
    const picked = Object.values(_marks).filter(Boolean).length;

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:14px;
           display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px;align-items:end;">
        ${H.field('hra-mark-date', 'Date', _markDate, { type: 'date' })}
        <div><button id="hra-mark-all-present" class="btn-secondary btn-sm" style="width:100%;">Mark everyone Present</button></div>
        <div><button id="hra-mark-clear" class="btn-ghost btn-sm" style="width:100%;">Clear</button></div>
        <div><button id="hra-mark-save" class="btn-primary btn-sm" style="width:100%;" ${picked ? '' : 'disabled'}>
          Save ${picked || ''} ${picked === 1 ? 'entry' : 'entries'}</button></div>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:11px;">
        Only the rows you set are written — anything left as “leave as is” keeps whatever the muster roll already shows for that day.
      </div>
      ${H.table(['Employee', 'Department', 'Branch', { label: 'Status for ' + H.fmtDate(_markDate) }], rows,
        { empty: 'No active employees', maxHeight: '60vh' })}`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bindBody() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

    on('hra-punch-in', 'click', () => punch('in'));
    on('hra-punch-out', 'click', () => punch('out'));

    const reloadMuster = async () => {
      const box = document.getElementById('hra-body');
      if (box) box.innerHTML = H.spinner();
      try { await loadMuster(); } catch (e) { H.fail(e); }
      render();
    };
    on('hra-month', 'change', (e) => { _month = Number(e.target.value); reloadMuster(); });
    on('hra-year', 'change', (e) => { _year = Number(e.target.value); reloadMuster(); });
    on('hra-branch', 'change', (e) => { _branch = e.target.value; reloadMuster(); });
    on('hra-export', 'click', exportMuster);

    document.querySelectorAll('.hra-cell').forEach((b) => b.addEventListener('click', () => openCell(b.dataset)));

    on('hra-mark-date', 'change', (e) => { _markDate = e.target.value; render(); });
    on('hra-mark-all-present', 'click', () => {
      (_masters.employees || []).filter((x) => x.status === 'Active').forEach((x) => { _marks[x.id] = 'Present'; });
      render();
    });
    on('hra-mark-clear', 'click', () => { _marks = {}; render(); });
    on('hra-mark-save', 'click', saveMarks);
    document.querySelectorAll('.hra-mark').forEach((sel) => sel.addEventListener('change', () => {
      _marks[sel.dataset.emp] = sel.value;
      const btn = document.getElementById('hra-mark-save');
      const n = Object.values(_marks).filter(Boolean).length;
      if (btn) { btn.disabled = !n; btn.textContent = `Save ${n || ''} ${n === 1 ? 'entry' : 'entries'}`; }
    }));
  }

  async function saveMarks() {
    const marks = Object.entries(_marks).filter(([, v]) => v)
      .map(([employeeId, status]) => ({ employeeId, date: _markDate, status }));
    if (!marks.length) return;
    try {
      const r = await H.post('/api/hr/attendance', { marks });
      H.toast(`Saved ${r.saved} entr${r.saved === 1 ? 'y' : 'ies'} for ${H.fmtDate(_markDate)}`);
      _marks = {};
      _muster = null;
      render();
    } catch (e) { H.fail(e); }
  }

  // One cell of the muster roll. Editing a day that the server filled in
  // (a holiday, a week-off) writes a real attendance row for it — which is
  // exactly what an overtime Sunday needs.
  function openCell(data) {
    const emp = (_masters.employees || []).find((e) => e.id === data.emp);
    const opts = (_masters.attendanceStatuses || []).map((s) => ({ value: s.key, label: s.label }));
    const body = H.grid(`
      ${H.select('hrac-status', 'Status', data.status, opts)}
      ${H.field('hrac-notes', 'Note', '', { placeholder: 'Optional' })}
      ${H.field('hrac-in', 'Check In', '', { type: 'time' })}
      ${H.field('hrac-out', 'Check Out', '', { type: 'time' })}
    `);
    H.openModal({
      id: 'hrac', title: H.fmtDate(data.date), subtitle: `${emp?.name || data.emp} · ${data.emp}`,
      width: 460, bodyHTML: body, confirmText: 'Save Day',
      onOpen: () => {
        // A "Clear" alongside Save, so a wrongly marked day can go back to
        // being computed from leave and the calendar rather than overridden.
        document.getElementById('hrac-cancel')?.insertAdjacentHTML('beforebegin',
          '<button id="hrac-clear" class="btn-ghost" style="color:#b91c1c;margin-right:auto;">Clear this day</button>');
        document.getElementById('hrac-clear')?.addEventListener('click', async () => {
          try {
            await H.del(`/api/hr/attendance?employeeId=${encodeURIComponent(data.emp)}&date=${encodeURIComponent(data.date)}`);
            H.closeModal('hrac');
            H.toast('Day cleared');
            await loadMuster();
            render();
          } catch (e) { H.fail(e); }
        });
      },
      onConfirm: async () => {
        await H.post('/api/hr/attendance', {
          employeeId: data.emp, date: data.date, status: H.val('hrac-status'),
          check_in: H.val('hrac-in'), check_out: H.val('hrac-out'), notes: H.val('hrac-notes'),
        });
        H.closeModal('hrac');
        H.toast('Attendance updated');
        await loadMuster();
        render();
      },
    });
  }

  function exportMuster() {
    if (!_muster) return;
    const cols = ['Code', 'Name', 'Department', ...(_muster.days || []).map((d) => d.slice(8)),
      'Present', 'Absent', 'Leave', 'Late'];
    const rows = (_muster.rows || []).map((r) => [
      r.id, r.name, r.department || '',
      ...r.cells.map((c) => (c.status ? styleOf(c.status).short : '')),
      r.tally.Present + r.tally.Remote, r.tally.Absent, r.tally.Leave, r.tally.late,
    ]);
    H.downloadCsv(`Muster Roll ${H.MONTHS[_month - 1]} ${_year}.csv`, cols, rows);
    H.toast('Muster roll exported');
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Loading attendance…');
      _tab = 'me';
      _muster = null;
      _marks = {};
      try {
        await loadMasters();
        await loadMe();
        render();
      } catch (e) {
        if (el) el.innerHTML = H.empty('Could not load attendance', e.message);
      }
    },
  };
})();
