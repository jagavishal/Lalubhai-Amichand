window.Pages = window.Pages || {};

// ── CEO Dashboard (route: company-overview) ─────────────────────────────────
// Admin-only rollup of what leadership asked for: tasks the admins have
// handed out and where they stand, meetings on the calendar, urgent-payment
// requests, who is on leave today, and the MIS chart. PO/PR are deliberately
// not here ("PO, PR CEO ke liye jaruri nahi hai"). Data: GET
// /api/company-overview (server.js) + GET /api/mis for the chart, so the chart
// always matches the MIS Report page.
window.Pages['company-overview'] = (() => {
  const esc = Utils.esc;
  const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  let _data = null;
  let _error = '';
  let _mis = null;          // { rows, error }
  let _misPeriod = 'month'; // 'week' | 'month'
  let _showAllTasks = false;

  function _isoOffset(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function _misRange(today) {
    if (_misPeriod === 'week') {
      const dow = new Date(today + 'T00:00:00Z').getUTCDay(); // 0 = Sun
      return { start: _isoOffset(today, -((dow + 6) % 7)), end: today }; // Monday → today
    }
    return { start: today.slice(0, 8) + '01', end: today };
  }

  async function _load() {
    _error = '';
    try {
      _data = await Utils.apiFetch('/api/company-overview');
    } catch (e) { _error = e.message || 'Failed to load'; }
    _render();
    if (_data) _loadMis();
  }

  async function _loadMis() {
    _mis = null; _render();
    const { start, end } = _misRange(_data.today);
    try {
      const res = await Utils.apiFetch('/api/mis?start=' + start + '&end=' + end + '&type=' + encodeURIComponent('Delegation MIS'));
      _mis = { rows: (res && res.rows) || [] };
    } catch (e) { _mis = { rows: [], error: e.message || 'Failed to load MIS' }; }
    _render();
  }

  /* ── building blocks ─────────────────────────────────────────────────── */
  const CARD = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;min-width:0;';
  const H2 = (t, right) => `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">${t}</div>${right || ''}</div>`;
  const empty = (t) => `<div style="font-size:12.5px;color:#94a3b8;padding:10px 0;">${esc(t)}</div>`;

  function _kpi(label, value, sub, tone, href) {
    const inner = `<div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">${esc(label)}</div>
      <div style="font-size:26px;font-weight:800;color:${tone || '#0f172a'};margin-top:6px;letter-spacing:-.02em;">${value}</div>
      ${sub ? `<div style="font-size:11.5px;color:#64748b;margin-top:2px;">${sub}</div>` : ''}`;
    return href
      ? `<a href="${href}" style="${CARD}text-decoration:none;display:block;">${inner}</a>`
      : `<div style="${CARD}">${inner}</div>`;
  }

  function _tasksCard(t) {
    const rows = _showAllTasks ? t.byAssignee : t.byAssignee.slice(0, 10);
    const TH = 'padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;text-align:right;white-space:nowrap;';
    const TD = 'padding:8px;font-size:12.5px;text-align:right;border-top:1px solid #f1f5f9;';
    const body = rows.length ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="${TH}text-align:left;">Assigned To</th><th style="${TH}">Total</th><th style="${TH}">Pending</th><th style="${TH}">Overdue</th><th style="${TH}">Done</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td style="${TD}text-align:left;"><div style="font-weight:600;color:#0f172a;">${esc(r.name)}</div>
            <div style="font-size:10.5px;color:#94a3b8;">by ${esc(r.givenBy.join(', ') || '—')}</div></td>
          <td style="${TD}">${r.total}</td>
          <td style="${TD}color:${r.pending ? '#b45309' : '#cbd5e1'};font-weight:600;">${r.pending}</td>
          <td style="${TD}color:${r.overdue ? '#b91c1c' : '#cbd5e1'};font-weight:700;">${r.overdue}</td>
          <td style="${TD}color:${r.done ? '#15803d' : '#cbd5e1'};">${r.done}</td>
        </tr>`).join('')}</tbody></table></div>
        ${t.byAssignee.length > 10 ? `<button id="co-tasks-toggle" style="margin-top:8px;border:none;background:transparent;color:var(--color-primary);font-size:12px;font-weight:600;cursor:pointer;padding:0;">${_showAllTasks ? 'Show top 10' : 'Show all ' + t.byAssignee.length}</button>` : ''}`
      : empty('No tasks have been assigned by an admin yet.');
    return `<div style="${CARD}">${H2('Tasks Given by Admins', '<a href="#all-tasks" style="font-size:11.5px;color:var(--color-primary);text-decoration:none;font-weight:600;">All Tasks →</a>')}${body}</div>`;
  }

  function _meetingsCard(m, today) {
    const body = m.upcoming.length ? m.upcoming.map(x => `<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid #f1f5f9;">
        <div style="width:52px;flex-shrink:0;text-align:center;">
          <div style="font-size:11px;font-weight:700;color:${x.date === today ? 'var(--color-primary)' : '#475569'};">${x.date === today ? 'Today' : esc(fmtDate(x.date))}</div>
          <div style="font-size:10.5px;color:#94a3b8;">${esc(x.startTime || '')}</div>
        </div>
        <div style="min-width:0;">
          <div style="font-size:12.5px;font-weight:600;color:#0f172a;">${esc(x.title)}</div>
          <div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc([x.organizer ? 'by ' + x.organizer : '', x.location].filter(Boolean).join(' · ') || '—')}</div>
        </div>
      </div>`).join('') : empty('No meetings scheduled in the next 7 days.');
    return `<div style="${CARD}">${H2('Meetings — Next 7 Days', '<a href="#scheduler" style="font-size:11.5px;color:var(--color-primary);text-decoration:none;font-weight:600;">Scheduler →</a>')}${body}</div>`;
  }

  function _leaveCard(l) {
    const body = l.onLeaveToday.length ? l.onLeaveToday.map(x => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #f1f5f9;font-size:12.5px;">
        <span style="font-weight:600;color:#0f172a;">${esc(x.name)}</span>
        <span style="color:#64748b;white-space:nowrap;">${esc(x.type)}${x.halfDay ? ' · half day' : ''}${x.to && x.to !== x.from ? ' · till ' + esc(fmtDate(x.to)) : ''}</span>
      </div>`).join('') : empty('Nobody is on leave today.');
    const pend = l.pendingRequests ? `<a href="#hr-leave" style="font-size:11.5px;color:#b45309;text-decoration:none;font-weight:600;">${l.pendingRequests} pending →</a>` : '';
    return `<div style="${CARD}">${H2('On Leave Today', pend)}${body}</div>`;
  }

  function _paymentsCard(p) {
    const pill = (s) => {
      const map = { pending: ['Pending', '#fef3c7', '#b45309'], Approved: ['Approved', '#dcfce7', '#15803d'], Rejected: ['Rejected', '#fee2e2', '#b91c1c'] };
      const [label, bg, fg] = map[s] || [s, '#f1f5f9', '#64748b'];
      return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:${bg};color:${fg};font-size:10.5px;font-weight:600;">${esc(label)}</span>`;
    };
    const stats = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;">
        ${[['Pending', p.pendingCount, inr(p.pendingAmount), '#b45309'],
           ['Approved (month)', p.approvedMonthCount, inr(p.approvedMonthAmount), '#15803d'],
           ['Rejected (month)', p.rejectedMonthCount, '', '#b91c1c']].map(([l, c, a, tone]) => `
          <div style="background:#f8fafc;border-radius:9px;padding:9px 10px;">
            <div style="font-size:18px;font-weight:800;color:${c ? tone : '#cbd5e1'};">${c}</div>
            <div style="font-size:10.5px;color:#64748b;">${esc(l)}</div>
            ${a ? `<div style="font-size:11.5px;font-weight:600;color:#334155;margin-top:1px;">${a}</div>` : ''}
          </div>`).join('')}
      </div>`;
    const list = p.recent.length ? p.recent.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #f1f5f9;">
        <div style="min-width:0;">
          <div style="font-size:12.5px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.payee)}</div>
          <div style="font-size:10.5px;color:#94a3b8;">${esc(r.requestedBy || '—')}${r.department ? ' · ' + esc(r.department) : ''} · ${esc(fmtDate(r.createdAt))}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;"><div style="font-size:12.5px;font-weight:700;color:#0f172a;">${inr(r.amount)}</div>${pill(r.status)}</div>
      </div>`).join('') : empty('No urgent payment requests yet.');
    return `<div style="${CARD}">${H2('Urgent Payments', '<a href="#approvals" style="font-size:11.5px;color:var(--color-primary);text-decoration:none;font-weight:600;">Approvals →</a>')}${stats}${list}</div>`;
  }

  function _misCard() {
    const toggle = `<div style="display:flex;gap:4px;">${[['week', 'This Week'], ['month', 'This Month']].map(([k, l]) =>
      `<button data-mis-period="${k}" style="padding:3px 10px;border-radius:7px;font-size:11.5px;font-weight:600;cursor:pointer;border:1px solid ${_misPeriod === k ? 'var(--color-primary)' : '#e2e8f0'};background:${_misPeriod === k ? 'var(--color-primary)' : '#fff'};color:${_misPeriod === k ? 'var(--color-primary-text,#fff)' : '#475569'};">${l}</button>`).join('')}</div>`;
    let body;
    if (!_mis) body = empty('Loading MIS…');
    else if (_mis.error) body = empty('Could not load MIS: ' + _mis.error);
    else if (!_mis.rows.length) body = empty('No tasks were due in this period.');
    else {
      const rows = _mis.rows.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      body = `<div style="display:flex;gap:14px;font-size:10.5px;color:#64748b;margin-bottom:10px;">
          <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#16a34a;margin-right:4px;"></span>Completed</span>
          <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#f59e0b;margin-right:4px;"></span>Pending</span>
          <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#dc2626;margin-right:4px;"></span>of which delayed</span>
          <span style="margin-left:auto;">Score = completed% − ½ × delayed%</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">${rows.map(r => {
          const total = r.total || 0;
          const pct = (n) => total ? (n / total * 100) : 0;
          const onTimePending = Math.max(0, (r.pending || 0) - (r.delayed || 0));
          const score = r.score ?? 0;
          const tone = score >= 80 ? '#15803d' : score >= 50 ? '#b45309' : '#b91c1c';
          return `<div style="display:grid;grid-template-columns:minmax(90px,160px) 1fr 52px;gap:10px;align-items:center;">
            <div style="font-size:12px;font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.name)}">${esc(r.name)}</div>
            <div title="${r.completed} completed · ${onTimePending} pending · ${r.delayed || 0} delayed of ${total}" style="display:flex;height:14px;border-radius:4px;overflow:hidden;background:#f1f5f9;">
              <div style="width:${pct(r.completed)}%;background:#16a34a;"></div>
              <div style="width:${pct(onTimePending)}%;background:#f59e0b;"></div>
              <div style="width:${pct(r.delayed || 0)}%;background:#dc2626;"></div>
            </div>
            <div style="font-size:12px;font-weight:700;color:${tone};text-align:right;">${score}%</div>
          </div>`;
        }).join('')}</div>`;
    }
    return `<div style="${CARD}">${H2('MIS — Task Performance', toggle)}${body}
      <div style="margin-top:10px;"><a href="#mis" style="font-size:11.5px;color:var(--color-primary);text-decoration:none;font-weight:600;">Full MIS Report →</a></div></div>`;
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  function _render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    let body;
    if (_error) {
      body = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;color:#b91c1c;font-size:12.5px;">
        Could not load: ${esc(_error)}. <button id="co-retry" style="border:none;background:transparent;color:#b91c1c;text-decoration:underline;cursor:pointer;font-weight:600;">Retry</button></div>`;
    } else if (!_data) {
      body = `<div style="padding:60px 0;text-align:center;color:#94a3b8;font-size:13px;">Loading…</div>`;
    } else {
      const d = _data, t = d.tasks.totals;
      body = `<div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;">
          ${_kpi('Open Tasks', t.pending, t.total + ' given by admins in total', t.pending ? '#b45309' : '#15803d', '#all-tasks')}
          ${_kpi('Overdue', t.overdue, 'past due date, not done', t.overdue ? '#b91c1c' : '#15803d')}
          ${_kpi('Meetings Today', d.meetings.today, d.meetings.next7Days + ' in the next 7 days', null, '#scheduler')}
          ${_kpi('Payments Pending', d.payments.pendingCount, inr(d.payments.pendingAmount), d.payments.pendingCount ? '#b45309' : null, '#approvals')}
          ${_kpi('On Leave Today', d.leave.onLeaveToday.length, d.leave.pendingRequests + ' leave request' + (d.leave.pendingRequests === 1 ? '' : 's') + ' pending', null, '#hr-leave')}
        </div>
        <div class="co-grid">
          ${_tasksCard(d.tasks)}
          <div style="display:flex;flex-direction:column;gap:14px;min-width:0;">${_meetingsCard(d.meetings, d.today)}${_leaveCard(d.leave)}</div>
        </div>
        <div class="co-grid">
          ${_misCard()}
          ${_paymentsCard(d.payments)}
        </div>
        <div style="font-size:11px;color:#cbd5e1;text-align:right;">Updated ${new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · refreshes every couple of minutes</div>
      </div>`;
    }

    el.innerHTML = `<style>
        .co-grid { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr); gap:14px; align-items:start; }
        @media (max-width:900px) { .co-grid { grid-template-columns:minmax(0,1fr); } }
      </style>
      <div style="max-width:1200px;margin:0 auto;padding:4px 0 40px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div>
            <h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">CEO Dashboard</h1>
            <p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Tasks, meetings, payments, leave and team performance at a glance.</p>
          </div>
          <button id="co-refresh" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>
        </div>
        ${body}
      </div>`;

    document.getElementById('co-refresh')?.addEventListener('click', _load);
    document.getElementById('co-retry')?.addEventListener('click', _load);
    document.getElementById('co-tasks-toggle')?.addEventListener('click', () => { _showAllTasks = !_showAllTasks; _render(); });
    el.querySelectorAll('[data-mis-period]').forEach(b => b.addEventListener('click', () => {
      if (_misPeriod === b.dataset.misPeriod) return;
      _misPeriod = b.dataset.misPeriod;
      _loadMis();
    }));
  }

  function render() {
    _render();
    _load();
  }

  return { render };
})();
