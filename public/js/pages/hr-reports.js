/* =====================================================================
   HR MIS
   ---------------------------------------------------------------------
   Every report the server can produce comes back in one shape —
   { title, summary, columns, rows } — so this page renders any of them
   without knowing which it asked for, and a new report is a line in the
   REPORTS list rather than a new page.

   The Overview is the exception: it is a dashboard rather than a table,
   so it gets its own renderer.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-reports'] = (() => {
  const H = window.HR;

  const now = new Date();
  let _type = 'summary';
  let _month = now.getMonth() + 1;
  let _year = now.getFullYear();
  let _data = null;
  let _loading = false;

  // needs: which pickers each report cares about, so the filter bar only
  // ever shows controls that change the answer.
  const REPORTS = [
    { key: 'summary',         label: 'Overview',              needs: [],               hint: 'Headcount, spread and what is pending right now' },
    { key: 'headcount',       label: 'Headcount Register',    needs: [],               hint: 'Everyone on the rolls with tenure and status' },
    { key: 'attrition',       label: 'Joiners & Leavers',     needs: ['year'],         hint: 'Who joined, who left, and the attrition rate' },
    { key: 'attendance',      label: 'Attendance Summary',    needs: ['month', 'year'], hint: 'Present, absent, half days and late marks' },
    { key: 'leave',           label: 'Leave Register',        needs: ['year'],         hint: 'Entitlement, taken and balance by leave type' },
    { key: 'salary-register', label: 'Salary Register',       needs: ['month', 'year'], hint: 'Every head of every payslip for the month' },
    { key: 'statutory',       label: 'Statutory Deductions',  needs: ['month', 'year'], hint: 'PF, ESIC, professional tax and TDS' },
    { key: 'celebrations',    label: 'Birthdays & Anniversaries', needs: ['month'],    hint: 'Whose month it is' },
  ];
  const current = () => REPORTS.find((r) => r.key === _type) || REPORTS[0];

  async function load() {
    _loading = true;
    const p = new URLSearchParams({ type: _type, month: _month, year: _year });
    _data = await H.api('/api/hr/reports?' + p.toString());
    _loading = false;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const needs = current().needs;

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('HR Reports', 'Headcount, attrition, attendance, leave and payroll — as at today',
          '<button id="hrr-export" class="btn-secondary btn-sm">Export CSV</button>')}
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:16px;
             display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px;align-items:end;">
          ${H.select('hrr-type', 'Report', _type, REPORTS.map((r) => ({ value: r.key, label: r.label })),
            { hint: current().hint })}
          ${needs.includes('month') ? H.select('hrr-month', 'Month', _month, H.MONTHS.map((m, i) => ({ value: i + 1, label: m }))) : ''}
          ${needs.includes('year') || needs.includes('month') ? H.select('hrr-year', 'Year', _year, H.yearList()) : ''}
        </div>
        <div id="hrr-body">${_loading ? H.spinner('Building the report…') : reportBody()}</div>
      </div>`;
    bind();
  }


  function reportBody() {
    if (!_data) return H.spinner();
    if (_type === 'summary') return overview();

    const cols = (_data.columns || []).map((c, i) => (i < 3 ? c : { label: c, align: 'right' }));
    return `
      <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:12px;">${H.esc(_data.title || '')}</div>
      ${H.stats(_data.summary || {})}
      ${_data.chart ? monthChart(_data.chart) : ''}
      ${H.table(cols, (_data.rows || []).map((r) => r.map((c) => H.esc(c))),
        { empty: 'Nothing to report for this period', maxHeight: '62vh' })}`;
  }

  /* A joiners-vs-leavers bar per month. Two flat bars scaled to the busiest
     month — enough to see the shape of a year without a charting library. */
  function monthChart(rows) {
    const max = Math.max(1, ...rows.map((r) => Math.max(r.joined, r.left)));
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:16px;">
      <div style="display:flex;gap:16px;font-size:11.5px;color:#64748b;margin-bottom:12px;">
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:3px;background:#16a34a;"></span>Joined</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:3px;background:#dc2626;"></span>Left</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:6px;align-items:end;height:130px;">
        ${rows.map((r) => `
          <div style="display:flex;flex-direction:column;justify-content:flex-end;height:100%;gap:2px;" title="${H.esc(r.name)}: ${r.joined} joined, ${r.left} left">
            <div style="display:flex;gap:2px;align-items:flex-end;height:100%;">
              <div style="flex:1;height:${(r.joined / max) * 100}%;background:#16a34a;border-radius:3px 3px 0 0;min-height:${r.joined ? '3px' : '0'};"></div>
              <div style="flex:1;height:${(r.left / max) * 100}%;background:#dc2626;border-radius:3px 3px 0 0;min-height:${r.left ? '3px' : '0'};"></div>
            </div>
          </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:6px;margin-top:6px;">
        ${rows.map((r) => `<div style="text-align:center;font-size:9.5px;color:#94a3b8;font-weight:600;">${H.esc(r.name.slice(0, 3))}</div>`).join('')}
      </div>
    </div>`;
  }

  /* ── Overview dashboard ───────────────────────────────────────────── */

  function overview() {
    const d = _data;
    const breakdown = (title, list, color) => {
      if (!list?.length) return '';
      const max = Math.max(1, ...list.map((x) => x.count));
      return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:12px;">${H.esc(title)}</div>
        ${list.map((x) => `
          <div style="margin-bottom:9px;">
            <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#334155;margin-bottom:3px;">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:10px;">${H.esc(x.name)}</span>
              <b>${x.count}</b>
            </div>
            <div style="height:6px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
              <div style="height:100%;width:${(x.count / max) * 100}%;background:${color};border-radius:99px;"></div>
            </div>
          </div>`).join('')}
      </div>`;
    };

    /* Attendance is usually marked at the end of the day, so for most of the
       working day the count list is empty — but the leave register already
       knows who is out. Showing both means the card answers "who is missing
       today" from first thing in the morning instead of only after marking. */
    const today = d.todayAttendance || [];
    const onLeave = d.todayLeave || [];
    const todayCard = `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:12px;">Attendance Today</div>
      ${today.length
        ? today.map((x) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
            <span>${H.statusPill(x.name)}</span><b style="color:#0f172a;">${x.count}</b></div>`).join('')
        : '<div style="font-size:12.5px;color:#94a3b8;padding:10px 0;">Nobody has been marked yet today.</div>'}
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;
           text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:14px 0 9px;
           padding-top:13px;border-top:1px solid #e2e8f0;">
        <span>On Leave Today</span><span style="color:#94a3b8;">${onLeave.length || ''}</span>
      </div>
      ${onLeave.length
        ? onLeave.map((x) => `<div style="padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
            <div style="display:flex;justify-content:space-between;gap:10px;">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;">${H.esc(x.name)}</span>
              <span style="white-space:nowrap;color:#64748b;font-size:11.5px;">${H.esc(x.type)}${x.half ? ' · Half day' : ''}</span>
            </div>
            ${x.backup ? `<div style="font-size:11px;color:#7c3aed;">covered by ${H.esc(x.backup)}</div>` : ''}
          </div>`).join('')
        : '<div style="font-size:12.5px;color:#94a3b8;padding:2px 0 6px;">Everyone is in — no approved leave today.</div>'}
    </div>`;

    return `
      <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:12px;">${H.esc(d.title || 'HR Overview')}</div>
      ${H.stats(d.summary || {})}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:13px;">
        ${breakdown('By Department', d.byDepartment, 'var(--color-primary)')}
        ${breakdown('By Branch', d.byBranch, '#7c3aed')}
        ${breakdown('By Gender', d.byGender, '#0891b2')}
        ${todayCard}
        ${breakdown('Top Designations', d.byDesignation, '#0f766e')}
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const reload = async () => {
      _loading = true;
      render();
      try { await load(); } catch (e) { H.fail(e); _loading = false; }
      render();
    };
    document.getElementById('hrr-type')?.addEventListener('change', (e) => { _type = e.target.value; _data = null; reload(); });
    document.getElementById('hrr-month')?.addEventListener('change', (e) => { _month = Number(e.target.value); reload(); });
    document.getElementById('hrr-year')?.addEventListener('change', (e) => { _year = Number(e.target.value); reload(); });
    document.getElementById('hrr-export')?.addEventListener('click', exportReport);
  }

  function exportReport() {
    if (!_data) return;
    if (_type === 'summary') {
      // The overview has no table; export what it actually shows instead of
      // refusing outright.
      const rows = [
        ...Object.entries(_data.summary || {}).map(([k, v]) => ['Summary', k, v]),
        ...(_data.byDepartment || []).map((x) => ['Department', x.name, x.count]),
        ...(_data.byBranch || []).map((x) => ['Branch', x.name, x.count]),
        ...(_data.byGender || []).map((x) => ['Gender', x.name, x.count]),
        ...(_data.byDesignation || []).map((x) => ['Designation', x.name, x.count]),
        ...(_data.todayAttendance || []).map((x) => ['Attendance Today', x.name, x.count]),
        ...(_data.todayLeave || []).map((x) => ['On Leave Today', x.name, x.type + (x.half ? ' (half day)' : '')]),
      ];
      H.downloadCsv('HR Overview.csv', ['Group', 'Item', 'Value'], rows);
    } else {
      H.downloadCsv(`${_data.title || 'HR Report'}.csv`, _data.columns || [], _data.rows || []);
    }
    H.toast('Report exported');
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Loading reports…');
      _type = 'summary';
      _data = null;
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load reports', e.message); }
    },
  };
})();
