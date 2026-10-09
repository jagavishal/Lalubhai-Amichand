/* =====================================================================
   AMC Management
   ---------------------------------------------------------------------
   Annual maintenance contracts, their renewals and expiry reminders, the
   equipment and vendors behind them, and the service requests raised
   against them. Server side: backend/amc.js (/api/amc/*).

   One page, four audiences, decided by the server's AMC role:
     Admin       everything, plus Settings (reminders, mail lists, roles,
                 backup) and deletes
     Manager     contracts, renewals, masters, assignment, reports, logs
     Maintenance the requests assigned to them (and unassigned ones to pick
                 up), read-only contracts/equipment/vendors
     Employee    raise a request, follow their own
   The tabs below are only what that role can use; the API enforces the
   same rules on every call.

   Built on window.HR (hr-common.js) for the header, tabs, tiles, modals
   and form fields, so it looks and behaves like the HR pages.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages.amc = (() => {
  const H = window.HR;
  const esc = H.esc;

  let D = null;              // /api/amc/data
  let _dash = null;          // /api/amc/dashboard
  let _tab = 'dashboard';
  let _depts = [];
  const _filters = {
    contracts: { q: '', status: 'All', dept: 'All', vendor: 'All', type: 'All' },
    requests: { q: '', status: 'Open items', priority: 'All', mine: false },
    assets: { q: '', status: 'All', dept: 'All' },
    vendors: { q: '', active: 'Active' },
  };
  const _sort = {
    contracts: { key: 'expiry_date', dir: 1 },
    requests: { key: 'created_at', dir: -1 },
    assets: { key: 'name', dir: 1 },
    vendors: { key: 'name', dir: 1 },
  };
  let _report = { type: 'active', fy: '', from: '', to: '', days: '', result: null };
  let _logs = { kind: 'notifications', rows: null, filter: 'All' };

  const VARIANT = {
    Active: 'success', 'Expiring Soon': 'warning', Expired: 'danger', 'Not Started': 'info', Discontinued: 'neutral',
    'Not Due': 'neutral', Pending: 'warning', 'In Progress': 'info', Renewed: 'success', 'Not Renewing': 'neutral',
    Open: 'warning', Assigned: 'purple', 'On Hold': 'neutral', Resolved: 'success', Closed: 'neutral',
    Low: 'neutral', Medium: 'info', High: 'warning', Critical: 'danger',
    Inactive: 'neutral', Scrapped: 'neutral',
    Sent: 'success', Failed: 'danger', Skipped: 'warning', Sending: 'info',
  };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');
  const DONE = new Set(['Resolved', 'Closed']);
  const money = (n) => '₹ ' + H.inr(n, { zero: '0.00' });
  const can = (k) => !!D?.can?.[k];

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function load() {
    const [data, dash, depts] = await Promise.all([
      H.api('/api/amc/data'),
      H.api('/api/amc/dashboard'),
      Utils.getDepartments().catch(() => []),
    ]);
    D = data;
    _dash = dash;
    _depts = (depts || []).map((d) => (typeof d === 'string' ? d : d.name)).filter(Boolean);
    if (!tabsFor().some((t) => t.key === _tab)) _tab = 'dashboard';
  }

  async function refresh() {
    try { await load(); render(); } catch (e) { H.fail(e); }
  }

  const vendorById = (id) => D.vendors.find((v) => v.id === id);
  const assetById = (id) => D.assets.find((a) => a.id === id);
  const contractById = (id) => D.contracts.find((c) => c.id === id);

  function tabsFor() {
    const open = D.requests.filter((r) => !DONE.has(r.status)).length;
    const t = [{ key: 'dashboard', label: 'Dashboard' }];
    if (can('work')) t.push({ key: 'contracts', label: 'Contracts', count: D.contracts.length });
    t.push({ key: 'requests', label: 'Service Requests', count: open });
    if (can('work')) t.push({ key: 'assets', label: 'Equipment', count: D.assets.length });
    if (can('work')) t.push({ key: 'vendors', label: 'Vendors', count: D.vendors.length });
    if (can('reports')) t.push({ key: 'reports', label: 'Reports' });
    if (can('manage')) t.push({ key: 'logs', label: 'Logs' });
    if (can('settings')) t.push({ key: 'settings', label: 'Settings' });
    return t;
  }

  /* ── Sortable table ───────────────────────────────────────────────────
     H.table with clickable headers. `cols`: { label, key, align, m } — a
     column with a key sorts on row[key] of the source objects. */
  function sortRows(list, which) {
    const { key, dir } = _sort[which];
    return list.slice().sort((a, b) => {
      let x = a[key], y = b[key];
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'en', { numeric: true }) * dir;
    });
  }

  function sortTable(which, cols, list, rowFn, { empty = 'Nothing to show' } = {}) {
    const rows = sortRows(list, which);
    const s = _sort[which];
    const mCls = (c) => (c.m ? ` class="m-card-${c.m}"` : '');
    const head = cols.map((c) => {
      const on = c.key && s.key === c.key;
      const arrow = on ? (s.dir > 0 ? ' ▲' : ' ▼') : '';
      return `<th style="${H.TH}${c.align === 'right' ? 'text-align:right;' : ''}${c.key ? 'cursor:pointer;user-select:none;' : ''}"
        ${c.key ? `data-sort="${which}:${esc(c.key)}" title="Sort by ${esc(c.label)}"` : ''}>${esc(c.label)}${arrow}</th>`;
    }).join('');
    const body = rows.length
      ? rows.map((o) => `<tr onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
          ${rowFn(o).map((cell, i) => `<td${mCls(cols[i])} style="${H.TD}${cols[i].align === 'right' ? 'text-align:right;white-space:nowrap;' : ''}">${cell == null || cell === '' ? '—' : cell}</td>`).join('')}
        </tr>`).join('')
      : `<tr><td colspan="${cols.length}" style="padding:44px;text-align:center;color:#94a3b8;font-size:13px;">${esc(empty)}</td></tr>`;
    return `<div class="hr-tbl hr-tbl-cards" style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <div class="hr-tbl-scroll" style="overflow:auto;">
        <table class="m-cards" style="width:100%;border-collapse:collapse;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </div></div>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${rows.length} record${rows.length === 1 ? '' : 's'}</div>`;
  }

  // Search box + selects in one filter row.
  function filterBar(prefix, f, selects, placeholder) {
    return `<div class="amc-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
      <input id="${prefix}-q" value="${esc(f.q)}" placeholder="${esc(placeholder)}" style="${H.CONTROL}max-width:260px;" />
      ${selects.map((s) => `<select id="${prefix}-f-${s.key}" style="${H.CONTROL}max-width:190px;">
        ${s.options.map((o) => { const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(v)}"${String(f[s.key]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}
      </select>`).join('')}
      ${prefix === 'sr' ? `<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#475569;cursor:pointer;">
        <input type="checkbox" id="sr-f-mine" ${f.mine ? 'checked' : ''}/> Assigned to me</label>` : ''}
      <button class="btn-secondary btn-sm" id="${prefix}-clear">Clear</button>
    </div>`;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const actions = [
      `<button id="amc-raise" class="btn-primary btn-sm">+ Raise Service Request</button>`,
      can('manage') ? `<button id="amc-add-contract" class="btn-secondary btn-sm">+ New AMC</button>` : '',
    ].join('');
    const body = {
      dashboard: dashboardTab, contracts: contractsTab, requests: requestsTab, assets: assetsTab,
      vendors: vendorsTab, reports: reportsTab, logs: logsTab, settings: settingsTab,
    }[_tab]();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        @media (max-width: 767px) {
          .amc-filt { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px !important; }
          .amc-filt > input, .amc-filt > select { max-width:none !important; min-height:40px; }
          .amc-filt > input[type="text"], .amc-filt > input:not([type]) { grid-column:1 / -1; }
          .amc-two { grid-template-columns:1fr !important; }
          .hr-tbl-cards .m-card-actions .btn-sm { min-height:36px; flex:1 1 auto; justify-content:center; }
        }
        .amc-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px; }
        .amc-card h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:0 0 10px; }
        .amc-link { color:var(--color-primary);cursor:pointer;font-weight:600;background:none;border:none;padding:0;font:inherit;text-align:left; }
        .amc-link:hover { text-decoration:underline; }
        .amc-od { color:#dc2626;font-weight:700; }
      </style>
      ${H.header('AMC Management', 'Maintenance contracts, renewals and service requests', actions)}
      ${H.tabs('amc', tabsFor(), _tab)}
      ${body}
    </div>`;
    bind();
  }

  /* ── Dashboard ────────────────────────────────────────────────────── */

  function dashboardTab() {
    const c = _dash.counts;
    const tiles = [];
    if (can('work')) {
      tiles.push({ label: 'Active AMCs', value: c.active });
      tiles.push({ label: `Upcoming Renewals (${_dash.window}d)`, value: c.upcoming, color: c.upcoming ? '#d97706' : undefined });
      tiles.push({ label: 'Expired Contracts', value: c.expired, color: c.expired ? '#dc2626' : undefined });
      tiles.push({ label: 'Pending Renewals', value: c.pending, color: c.pending ? '#d97706' : undefined });
    }
    if (_dash.money) {
      tiles.push({ label: 'Active AMC Value', value: '₹ ' + H.inr0(_dash.money.activeValue), hint: 'current terms of active contracts' });
      tiles.push({ label: `AMC Spend ${_dash.fy}`, value: '₹ ' + H.inr0(_dash.money.fySpend), hint: 'terms starting this FY' });
    }
    const srTiles = [
      { label: 'Open Service Requests', value: c.openRequests },
      { label: 'Overdue Requests', value: c.overdueRequests, color: c.overdueRequests ? '#dc2626' : undefined },
      { label: 'Open High / Critical', value: c.criticalOpen, color: c.criticalOpen ? '#d97706' : undefined },
    ];

    const contractList = (list, emptyMsg) => list.length ? list.map((x) => `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
          <div style="min-width:0;"><button class="amc-link" data-view-contract="${esc(x.id)}">${esc(x.contract_name)}</button>
            <div style="font-size:11px;color:#94a3b8;">${esc(x.id)} · ${esc(x.vendor_name)}${x.amount != null ? ' · ' + money(x.amount) : ''}</div></div>
          <div style="text-align:right;white-space:nowrap;">
            <div class="${x.days_left < 0 ? 'amc-od' : ''}">${x.days_left < 0 ? `${-x.days_left}d ago` : x.days_left === 0 ? 'Today' : `in ${x.days_left}d`}</div>
            <div style="font-size:11px;color:#94a3b8;">${H.fmtDate(x.expiry_date)}</div>
            ${can('manage') ? `<button class="btn-secondary btn-xs" style="margin-top:3px;" data-renew="${esc(x.id)}">Renew</button>` : ''}
          </div>
        </div>`).join('') : `<div style="font-size:12.5px;color:#94a3b8;padding:10px 0;">${esc(emptyMsg)}</div>`;

    const srList = (list, emptyMsg) => list.length ? list.map((s) => `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
          <div style="min-width:0;"><button class="amc-link" data-view-sr="${esc(s.id)}">${esc(s.id)}</button> ${pill(s.priority)}
            <div style="color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px;">${esc(s.issue)}</div>
            <div style="font-size:11px;color:#94a3b8;">${esc(s.asset_name || s.contract_name || '')}${s.assigned_user_name ? ' · ' + esc(s.assigned_user_name) : ''}</div></div>
          <div style="text-align:right;white-space:nowrap;">${pill(s.status)}
            ${s.expected_date ? `<div style="font-size:11px;" class="${s.overdue ? 'amc-od' : ''}">due ${H.fmtDate(s.expected_date)}</div>` : ''}</div>
        </div>`).join('') : `<div style="font-size:12.5px;color:#94a3b8;padding:10px 0;">${esc(emptyMsg)}</div>`;

    const maxDept = Math.max(1, ...((_dash.money?.byDepartment || []).map((d) => d.amount)));
    const deptBars = (_dash.money?.byDepartment || []).slice(0, 8).map((d) => `
      <div style="margin:7px 0;font-size:12px;">
        <div style="display:flex;justify-content:space-between;gap:8px;"><span style="color:#334155;">${esc(d.department)}</span><span style="color:#64748b;">₹ ${H.inr0(d.amount)}</span></div>
        <div style="height:7px;background:#f1f5f9;border-radius:4px;margin-top:3px;"><div style="height:7px;border-radius:4px;background:var(--color-primary);width:${Math.max(2, (d.amount / maxDept) * 100)}%;"></div></div>
      </div>`).join('');
    const totalSr = _dash.byStatus.reduce((n, s) => n + s.count, 0);

    const missing = D.settings ? [!D.settings.reminderTo.length && 'expiry reminders', !D.settings.srTo.length && 'service requests'].filter(Boolean) : [];
    return `
      ${missing.length ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        No email ID is set for ${esc(missing.join(' and '))} — those mails are not being sent. <button class="amc-link" data-goto="settings">Add them in Settings</button>.</div>` : ''}
      ${tiles.length ? H.stats(tiles) : ''}
      ${H.stats(srTiles)}
      <div class="amc-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        ${can('work') ? `<div class="amc-card"><h3>Upcoming Renewals</h3>${contractList(_dash.upcoming, `Nothing expires in the next ${_dash.window} days`)}</div>
        <div class="amc-card"><h3>Expired — Not Renewed</h3>${contractList(_dash.expired, 'No expired contracts')}</div>` : ''}
        <div class="amc-card"><h3>Overdue Service Requests</h3>${srList(_dash.overdue, 'Nothing is overdue')}</div>
        <div class="amc-card"><h3>Recent Service Requests</h3>${srList(_dash.recent, 'No requests yet')}</div>
        ${_dash.money ? `<div class="amc-card"><h3>Active AMC Value by Department</h3>${deptBars || '<div style="font-size:12.5px;color:#94a3b8;">No active contracts</div>'}</div>` : ''}
        <div class="amc-card"><h3>Requests by Status</h3>
          ${_dash.byStatus.map((s) => `<div style="display:flex;align-items:center;gap:10px;margin:6px 0;font-size:12px;">
            <span style="width:88px;">${pill(s.status)}</span>
            <div style="flex:1;height:7px;background:#f1f5f9;border-radius:4px;"><div style="height:7px;border-radius:4px;background:#64748b;width:${totalSr ? (s.count / totalSr) * 100 : 0}%;"></div></div>
            <span style="width:28px;text-align:right;color:#475569;">${s.count}</span></div>`).join('')}
        </div>
      </div>`;
  }

  /* ── Contracts ────────────────────────────────────────────────────── */

  function filteredContracts() {
    const f = _filters.contracts;
    const n = f.q.trim().toLowerCase();
    return D.contracts.filter((c) => {
      if (f.status !== 'All' && c.status !== f.status && c.renewal_state !== f.status) return false;
      if (f.dept !== 'All' && c.department !== f.dept) return false;
      if (f.vendor !== 'All' && c.vendor_id !== f.vendor) return false;
      if (f.type !== 'All' && c.amc_type !== f.type) return false;
      if (n && ![c.id, c.contract_name, c.vendor_name, c.department, c.location, ...(c.asset_names || [])].join(' ').toLowerCase().includes(n)) return false;
      return true;
    });
  }

  function contractsTab() {
    const f = _filters.contracts;
    const depts = ['All', ...new Set(D.contracts.map((c) => c.department).filter(Boolean))].sort((a, b) => (a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)));
    const list = filteredContracts();
    const cols = [
      { label: 'AMC ID', key: 'id' }, { label: 'Contract', key: 'contract_name', m: 'title' }, { label: 'Vendor', key: 'vendor_name' },
      { label: 'Equipment' }, { label: 'Department', key: 'department' }, { label: 'Type', key: 'amc_type' },
      { label: 'Expiry', key: 'expiry_date' }, ...(can('money') ? [{ label: 'Amount', key: 'amount', align: 'right' }] : []),
      { label: 'Status', key: 'status' }, { label: 'Renewal', key: 'renewal_state' }, { label: '', m: 'actions' },
    ];
    return `
      ${filterBar('ct', f, [
        { key: 'status', options: ['All', 'Active', 'Expiring Soon', 'Expired', 'Not Started', 'Discontinued', 'Pending', 'In Progress', 'Renewed', 'Not Renewing'].map((s) => ({ value: s, label: s === 'All' ? 'All Statuses' : s })) },
        { key: 'dept', options: depts.map((d) => ({ value: d, label: d === 'All' ? 'All Departments' : d })) },
        { key: 'vendor', options: [{ value: 'All', label: 'All Vendors' }, ...D.vendors.map((v) => ({ value: v.id, label: v.name }))] },
        { key: 'type', options: [{ value: 'All', label: 'All Types' }, ...D.lists.AMC_TYPES] },
      ], 'Search AMC id, name, vendor, equipment…')}
      ${can('manage') || can('reports') ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin:-4px 0 10px;">
        <button class="btn-secondary btn-sm" id="ct-export-csv">Export CSV</button><button class="btn-secondary btn-sm" id="ct-export-xlsx">Export Excel</button></div>` : ''}
      ${sortTable('contracts', cols, list, (c) => [
        `<b>${esc(c.id)}</b>`,
        `<button class="amc-link" data-view-contract="${esc(c.id)}">${esc(c.contract_name)}</button>${c.location ? `<div style="font-size:11px;color:#94a3b8;">${esc(c.location)}</div>` : ''}`,
        esc(c.vendor_name),
        esc((c.asset_names || []).join(', ')),
        esc(c.department),
        esc(c.amc_type),
        `${H.fmtDate(c.expiry_date)}<div style="font-size:11px;" class="${c.days_left < 0 ? 'amc-od' : ''}">${c.days_left < 0 ? `${-c.days_left}d ago` : `${c.days_left}d left`}</div>`,
        ...(can('money') ? [money(c.amount)] : []),
        pill(c.status), pill(c.renewal_state),
        `<div style="display:flex;gap:5px;flex-wrap:wrap;"><button class="btn-secondary btn-sm" data-view-contract="${esc(c.id)}">View</button>
          ${can('manage') ? `<button class="btn-secondary btn-sm" data-edit-contract="${esc(c.id)}">Edit</button>
          ${c.renewal_status !== 'Discontinued' ? `<button class="btn-secondary btn-sm" data-renew="${esc(c.id)}">Renew</button>` : ''}` : ''}</div>`,
      ], { empty: D.contracts.length ? 'No contracts match these filters' : 'No AMC contracts yet — add the first one with “+ New AMC”' })}`;
  }

  function contractExportRows() {
    const cols = ['AMC ID', 'Contract', 'Vendor', 'Equipment', 'Department', 'Location', 'AMC Type', 'Start Date', 'Expiry Date', 'Days Left',
      ...(can('money') ? ['Amount'] : []), 'Renewal Frequency', 'Status', 'Renewal Status', 'Remarks'];
    const rows = sortRows(filteredContracts(), 'contracts').map((c) => [c.id, c.contract_name, c.vendor_name, (c.asset_names || []).join(', '),
      c.department, c.location, c.amc_type, c.start_date, c.expiry_date, c.days_left, ...(can('money') ? [c.amount] : []),
      c.renewal_frequency, c.status, c.renewal_state, c.remarks || '']);
    return { cols, rows };
  }

  /* ── Service requests ─────────────────────────────────────────────── */

  function filteredRequests() {
    const f = _filters.requests;
    const n = f.q.trim().toLowerCase();
    return D.requests.filter((s) => {
      if (f.status === 'Open items' && DONE.has(s.status)) return false;
      if (f.status === 'Overdue' && !s.overdue) return false;
      if (!['All', 'Open items', 'Overdue'].includes(f.status) && s.status !== f.status) return false;
      if (f.priority !== 'All' && s.priority !== f.priority) return false;
      if (f.mine && s.assigned_user_id !== D.me.id) return false;
      if (n && ![s.id, s.issue, s.asset_name, s.contract_name, s.vendor_name, s.raised_by_name, s.assigned_user_name, s.department, s.location].join(' ').toLowerCase().includes(n)) return false;
      return true;
    });
  }

  const PRIORITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  function requestsTab() {
    const f = _filters.requests;
    const list = filteredRequests().map((s) => ({ ...s, _prio: PRIORITY_RANK[s.priority] }));
    const cols = [
      { label: 'Request', key: 'id' }, { label: 'Date', key: 'request_date' }, { label: 'Priority', key: '_prio' },
      { label: 'Issue', key: 'issue', m: 'title' }, { label: 'Equipment / AMC', key: 'asset_name' },
      { label: 'Raised By', key: 'raised_by_name' }, { label: 'Assigned To', key: 'assigned_user_name' },
      { label: 'Expected', key: 'expected_date' }, { label: 'Status', key: 'status' }, { label: '', m: 'actions' },
    ];
    return `
      ${filterBar('sr', f, [
        { key: 'status', options: ['Open items', 'Overdue', 'All', ...D.lists.SR_STATUSES].map((s) => ({ value: s, label: s === 'All' ? 'All Statuses' : s })) },
        { key: 'priority', options: [{ value: 'All', label: 'All Priorities' }, ...D.lists.PRIORITIES] },
      ], 'Search id, issue, equipment, person…')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin:-4px 0 10px;">
        <button class="btn-secondary btn-sm" id="sr-export-csv">Export CSV</button><button class="btn-secondary btn-sm" id="sr-export-xlsx">Export Excel</button></div>
      ${sortTable('requests', cols, list, (s) => [
        `<button class="amc-link" data-view-sr="${esc(s.id)}">${esc(s.id)}</button>`,
        H.fmtDate(s.request_date), pill(s.priority),
        `<div style="max-width:320px;">${esc(s.issue.length > 140 ? s.issue.slice(0, 140) + '…' : s.issue)}</div>`,
        `${esc(s.asset_name || '')}${s.contract_id ? `<div style="font-size:11px;color:#94a3b8;">${esc(s.contract_id)}${s.vendor_name ? ' · ' + esc(s.vendor_name) : ''}</div>` : ''}`,
        `${esc(s.raised_by_name)}${s.department ? `<div style="font-size:11px;color:#94a3b8;">${esc(s.department)}</div>` : ''}`,
        esc([s.assigned_user_name, s.assigned_vendor_name].filter(Boolean).join(' / ')),
        s.expected_date ? `<span class="${s.overdue ? 'amc-od' : ''}">${H.fmtDate(s.expected_date)}${s.overdue ? ' ⚠' : ''}</span>` : '',
        pill(s.status),
        `<button class="btn-secondary btn-sm" data-view-sr="${esc(s.id)}">Open</button>`,
      ], { empty: D.requests.length ? 'No requests match these filters' : 'No service requests yet' })}`;
  }

  function requestExportRows() {
    const cols = ['Request ID', 'Request Date', 'Priority', 'Status', 'Issue', 'Equipment', 'AMC Contract', 'Vendor', 'Department', 'Location',
      'Raised By', 'Assigned To', 'Assigned Vendor', 'Expected Resolution', 'Actual Resolution', 'Overdue', 'Resolution'];
    const rows = sortRows(filteredRequests(), 'requests').map((s) => [s.id, s.request_date, s.priority, s.status, s.issue, s.asset_name, s.contract_id,
      s.vendor_name, s.department, s.location, s.raised_by_name, s.assigned_user_name, s.assigned_vendor_name, s.expected_date || '',
      s.actual_date || '', s.overdue ? 'Yes' : '', s.resolution]);
    return { cols, rows };
  }

  /* ── Equipment ────────────────────────────────────────────────────── */

  function filteredAssets() {
    const f = _filters.assets;
    const n = f.q.trim().toLowerCase();
    return D.assets.filter((a) => {
      if (f.status !== 'All' && a.status !== f.status) return false;
      if (f.dept !== 'All' && a.department !== f.dept) return false;
      if (n && ![a.id, a.name, a.category, a.make_model, a.serial_no, a.location, a.department].join(' ').toLowerCase().includes(n)) return false;
      return true;
    }).map((a) => {
      const covering = a.contract_ids.map(contractById).filter((c) => c && (c.status === 'Active' || c.status === 'Expiring Soon'));
      const srs = D.requests.filter((s) => s.asset_id === a.id);
      return { ...a, _cover: covering.map((c) => c.id).join(', '), _covered: covering.length ? 1 : 0, _open: srs.filter((s) => !DONE.has(s.status)).length, _srs: srs.length };
    });
  }

  function assetsTab() {
    const f = _filters.assets;
    const depts = ['All', ...new Set(D.assets.map((a) => a.department).filter(Boolean))];
    return `
      ${filterBar('as', f, [
        { key: 'status', options: ['All', ...D.lists.ASSET_STATUSES].map((s) => ({ value: s, label: s === 'All' ? 'All Statuses' : s })) },
        { key: 'dept', options: depts.map((d) => ({ value: d, label: d === 'All' ? 'All Departments' : d })) },
      ], 'Search equipment, serial, location…')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin:-4px 0 10px;">
        <button class="btn-secondary btn-sm" id="as-export-csv">Export CSV</button>
        ${can('manage') ? '<button class="btn-primary btn-sm" id="as-add">+ Add Equipment</button>' : ''}</div>
      ${sortTable('assets', [
        { label: 'ID', key: 'id' }, { label: 'Equipment', key: 'name', m: 'title' }, { label: 'Category', key: 'category' },
        { label: 'Serial No', key: 'serial_no' }, { label: 'Department', key: 'department' }, { label: 'Location', key: 'location' },
        { label: 'AMC Cover', key: '_covered' }, { label: 'Requests', key: '_srs', align: 'right' }, { label: 'Status', key: 'status' }, { label: '', m: 'actions' },
      ], filteredAssets(), (a) => [
        `<b>${esc(a.id)}</b>`,
        `<button class="amc-link" data-view-asset="${esc(a.id)}">${esc(a.name)}</button>${a.make_model ? `<div style="font-size:11px;color:#94a3b8;">${esc(a.make_model)}</div>` : ''}`,
        esc(a.category), esc(a.serial_no), esc(a.department), esc(a.location),
        a._covered ? H.pill(a._cover, 'success') : H.pill('Not covered', 'warning'),
        `${a._srs}${a._open ? ` <span style="font-size:11px;color:#d97706;">(${a._open} open)</span>` : ''}`,
        pill(a.status),
        `<div style="display:flex;gap:5px;"><button class="btn-secondary btn-sm" data-view-asset="${esc(a.id)}">History</button>
          ${can('manage') ? `<button class="btn-secondary btn-sm" data-edit-asset="${esc(a.id)}">Edit</button>` : ''}
          ${can('del') ? `<button class="btn-secondary btn-sm" data-del-asset="${esc(a.id)}" style="color:#dc2626;">Delete</button>` : ''}</div>`,
      ], { empty: D.assets.length ? 'No equipment matches these filters' : 'No equipment yet — add what your AMCs cover' })}`;
  }

  /* ── Vendors ──────────────────────────────────────────────────────── */

  function vendorStats(v) {
    const contracts = D.contracts.filter((c) => c.vendor_id === v.id && c.renewal_status !== 'Discontinued');
    const srs = D.requests.filter((s) => s.vendor_id === v.id);
    const resolved = srs.filter((s) => DONE.has(s.status) && s.actual_date);
    const withExp = resolved.filter((s) => s.expected_date);
    const onTime = withExp.filter((s) => s.actual_date <= s.expected_date).length;
    const days = resolved.reduce((n, s) => n + Math.max(0, (new Date(s.actual_date) - new Date(s.request_date)) / 864e5), 0);
    return {
      _active: contracts.filter((c) => c.status === 'Active' || c.status === 'Expiring Soon').length,
      _value: contracts.filter((c) => c.status === 'Active' || c.status === 'Expiring Soon').reduce((n, c) => n + (c.amount || 0), 0),
      _srs: srs.length, _open: srs.filter((s) => !DONE.has(s.status)).length,
      _avg: resolved.length ? Math.round((days / resolved.length) * 10) / 10 : null,
      _ontime: withExp.length ? Math.round((onTime / withExp.length) * 100) : null,
    };
  }

  function vendorsTab() {
    const f = _filters.vendors;
    const n = f.q.trim().toLowerCase();
    const list = D.vendors.filter((v) => {
      if (f.active === 'Active' && !v.active) return false;
      if (f.active === 'Inactive' && v.active) return false;
      if (n && ![v.id, v.name, v.contact_person, v.phone, v.email, v.services, v.gstin].join(' ').toLowerCase().includes(n)) return false;
      return true;
    }).map((v) => ({ ...v, ...vendorStats(v) }));
    return `
      ${filterBar('vd', f, [{ key: 'active', options: ['Active', 'Inactive', 'All'].map((s) => ({ value: s, label: s === 'All' ? 'All Vendors' : s })) }],
        'Search vendor, contact, service…')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin:-4px 0 10px;">
        <button class="btn-secondary btn-sm" id="vd-export-csv">Export CSV</button>
        ${can('manage') ? '<button class="btn-primary btn-sm" id="vd-add">+ Add Vendor</button>' : ''}</div>
      ${sortTable('vendors', [
        { label: 'ID', key: 'id' }, { label: 'Vendor', key: 'name', m: 'title' }, { label: 'Contact', key: 'contact_person' },
        { label: 'Services', key: 'services' }, { label: 'Active AMCs', key: '_active', align: 'right' },
        ...(can('money') ? [{ label: 'Active Value', key: '_value', align: 'right' }] : []),
        { label: 'Requests', key: '_srs', align: 'right' }, { label: 'Avg. Days', key: '_avg', align: 'right' }, { label: 'On-time', key: '_ontime', align: 'right' },
        { label: '', m: 'actions' },
      ], list, (v) => [
        `<b>${esc(v.id)}</b>`,
        `<button class="amc-link" data-view-vendor="${esc(v.id)}">${esc(v.name)}</button>${v.active ? '' : ' ' + H.pill('Inactive', 'neutral')}`,
        `${esc(v.contact_person)}<div style="font-size:11px;color:#94a3b8;">${esc([v.phone, v.email].filter(Boolean).join(' · '))}</div>`,
        esc(v.services), v._active, ...(can('money') ? [money(v._value)] : []),
        `${v._srs}${v._open ? ` <span style="font-size:11px;color:#d97706;">(${v._open} open)</span>` : ''}`,
        v._avg == null ? '' : v._avg, v._ontime == null ? '' : v._ontime + '%',
        `<div style="display:flex;gap:5px;"><button class="btn-secondary btn-sm" data-view-vendor="${esc(v.id)}">View</button>
          ${can('manage') ? `<button class="btn-secondary btn-sm" data-edit-vendor="${esc(v.id)}">Edit</button>` : ''}
          ${can('del') ? `<button class="btn-secondary btn-sm" data-del-vendor="${esc(v.id)}" style="color:#dc2626;">Delete</button>` : ''}</div>`,
      ], { empty: D.vendors.length ? 'No vendors match these filters' : 'No vendors yet — add the companies you hold AMCs with' })}`;
  }

  /* ── Reports ──────────────────────────────────────────────────────── */

  const REPORTS = [
    { key: 'active', label: 'Active AMCs' },
    { key: 'upcoming', label: 'Upcoming Renewals / Expiring', days: true },
    { key: 'expired', label: 'Expired AMCs' },
    { key: 'vendor-summary', label: 'Vendor-wise AMC Summary' },
    { key: 'department-expenses', label: 'Department-wise AMC Expenses', fy: true },
    { key: 'cost-monthly', label: 'Monthly AMC Cost', fy: true },
    { key: 'cost-yearly', label: 'Yearly AMC Cost' },
    { key: 'renewals', label: 'Renewal History', range: true },
    { key: 'sr-status', label: 'Service Request Status', range: true },
    { key: 'sr-pending', label: 'Pending Service Requests', range: true },
    { key: 'vendor-performance', label: 'Vendor-wise Service Performance', range: true },
  ];

  function fyOptions() {
    const d = new Date();
    const cur = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const out = [];
    for (let y = cur + 1; y >= cur - 6; y--) out.push({ value: y, label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` });
    return { cur, out };
  }

  function reportsTab() {
    const meta = REPORTS.find((r) => r.key === _report.type) || REPORTS[0];
    const fy = fyOptions();
    const res = _report.result;
    let table = `<div style="font-size:12.5px;color:#94a3b8;padding:24px 0;">Pick a report and press Run.</div>`;
    if (res) {
      const fmtCell = (v, i) => (res.money || []).includes(i) && typeof v === 'number' ? money(v) : (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? H.fmtDate(v) : esc(v));
      const totals = res.totals ? [res.columns.map((_, i) => (i === 0 ? '<b>Total</b>' : res.totals[i] != null ? `<b>${fmtCell(res.totals[i], i)}</b>` : ''))] : [];
      const chart = res.chart ? (() => {
        const max = Math.max(1, ...res.rows.map((r) => r[res.chart.value]));
        return `<div class="amc-card" style="margin-bottom:12px;"><div style="display:flex;align-items:flex-end;gap:6px;height:150px;">
          ${res.rows.map((r) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;" title="${esc(r[res.chart.label])}: ₹ ${H.inr0(r[res.chart.value])}">
            <div style="font-size:10px;color:#64748b;margin-bottom:2px;white-space:nowrap;">${r[res.chart.value] ? H.inr0(r[res.chart.value] / 1000) + 'k' : ''}</div>
            <div style="width:100%;max-width:42px;background:var(--color-primary);border-radius:4px 4px 0 0;height:${(r[res.chart.value] / max) * 120}px;min-height:${r[res.chart.value] ? 2 : 0}px;"></div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${esc(String(r[res.chart.label]).replace(/^FY /, ''))}</div></div>`).join('')}
        </div></div>`;
      })() : '';
      table = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 10px;">
          <div><div style="font-size:15px;font-weight:700;color:#0f172a;">${esc(res.title)}</div>
            ${res.note ? `<div style="font-size:11.5px;color:#94a3b8;">${esc(res.note)}</div>` : ''}</div>
          <div style="display:flex;gap:8px;"><button class="btn-secondary btn-sm" id="rp-csv">Export CSV</button><button class="btn-secondary btn-sm" id="rp-xlsx">Export Excel</button></div>
        </div>
        ${chart}
        ${H.table(res.columns.map((c, i) => ({ label: c, align: (res.money || []).includes(i) || typeof res.rows[0]?.[i] === 'number' ? 'right' : undefined })),
          [...res.rows.map((r) => r.map(fmtCell)), ...totals], { empty: 'No records for this selection', maxHeight: '60vh' })}
        ${res.detail ? `<div style="font-size:13px;font-weight:700;color:#0f172a;margin:16px 0 8px;">Requests in this period</div>
          ${H.table(res.detail.columns, res.detail.rows.map((r) => r.map((v) => fmtCell(v, -1))), { empty: 'No requests', maxHeight: '50vh' })}` : ''}`;
    }
    return `
      <div class="amc-card" style="margin-bottom:12px;">
        ${H.grid(
          H.select('rp-type', 'Report', _report.type, REPORTS.map((r) => ({ value: r.key, label: r.label })), { span: meta.fy || meta.days ? 1 : meta.range ? 1 : 2 })
          + (meta.fy ? H.select('rp-fy', 'Financial Year', _report.fy || fy.cur, fy.out) : '')
          + (meta.days ? H.field('rp-days', 'Expiring within (days)', _report.days || D.window, { type: 'number' }) : '')
          + (meta.range ? H.field('rp-from', 'From (request / renewal date)', _report.from, { type: 'date' }) + H.field('rp-to', 'To', _report.to, { type: 'date' }) : ''),
          meta.range ? 3 : 2)}
        <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-primary btn-sm" id="rp-run">Run Report</button></div>
      </div>
      ${table}`;
  }

  async function runReport() {
    const meta = REPORTS.find((r) => r.key === _report.type);
    const p = new URLSearchParams();
    if (meta.fy) p.set('fy', _report.fy || fyOptions().cur);
    if (meta.days && _report.days) p.set('days', _report.days);
    if (meta.range) { if (_report.from) p.set('from', _report.from); if (_report.to) p.set('to', _report.to); }
    if (meta.range && _report.from && _report.to && _report.from > _report.to) return H.toast('“From” must be before “To”', 'error');
    try {
      _report.result = await H.api(`/api/amc/reports/${_report.type}?${p}`);
      render();
    } catch (e) { H.fail(e); }
  }

  /* ── Logs ─────────────────────────────────────────────────────────── */

  function logsTab() {
    const isN = _logs.kind === 'notifications';
    const rows = _logs.rows;
    const kindSel = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
      <select id="lg-kind" style="${H.CONTROL}max-width:220px;">
        <option value="notifications"${isN ? ' selected' : ''}>Email notifications</option>
        <option value="activity"${!isN ? ' selected' : ''}>Activity log</option></select>
      ${isN ? `<select id="lg-filter" style="${H.CONTROL}max-width:180px;">${['All', 'Sent', 'Failed', 'Skipped', 'Sending'].map((s) =>
        `<option${_logs.filter === s ? ' selected' : ''}>${s}</option>`).join('')}</select>` : ''}
      <button class="btn-secondary btn-sm" id="lg-reload">Reload</button>
      <button class="btn-secondary btn-sm" id="lg-csv">Export CSV</button>
      <span style="font-size:11.5px;color:#94a3b8;">Latest 500 entries</span></div>`;
    if (!rows) return kindSel + H.spinner('Loading log…');
    const KIND = { reminder: 'Expiry reminder', sr_new: 'New request', sr_assigned: 'Assigned', sr_overdue: 'Overdue request', sr_resolved: 'Resolved' };
    if (isN) {
      const list = rows.filter((r) => _logs.filter === 'All' || r.status === _logs.filter);
      return kindSel + H.table(['When', 'Type', 'Ref', 'Subject', 'Recipients', 'Status', 'Attempts'], list.map((r) => [
        `${H.fmtDate(r.created_at)} ${H.fmtTime(r.sent_at || r.created_at)}`,
        esc(KIND[r.kind] || r.kind) + (r.offset_days != null && r.kind === 'reminder' ? ` <span style="color:#94a3b8;">(${r.offset_days}d)</span>` : ''),
        esc(r.ref_id), esc(r.subject), `<div style="max-width:260px;font-size:11.5px;word-break:break-word;">${esc(r.recipients)}</div>`,
        `${pill(r.status)}${r.error ? `<div style="font-size:11px;color:#dc2626;max-width:220px;">${esc(r.error)}</div>` : ''}`, r.attempts,
      ]), { empty: 'No notifications yet', cards: true });
    }
    return kindSel + H.table(['When', 'User', 'Record', 'Action', 'Detail'], rows.map((r) => [
      `${H.fmtDate(r.created_at)} ${H.fmtTime(r.created_at)}`, esc(r.user_name), `${esc(r.entity)} ${esc(r.entity_id)}`, esc(r.action),
      `<div style="max-width:420px;font-size:11.5px;word-break:break-word;">${esc(r.detail)}</div>`,
    ]), { empty: 'No activity yet', cards: true });
  }

  async function loadLogs() {
    try {
      _logs.rows = await H.api(_logs.kind === 'notifications' ? '/api/amc/notifications' : '/api/amc/activity');
    } catch (e) { _logs.rows = []; H.fail(e); }
    if (_tab === 'logs') render();
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  // One address per line (commas also work). These lists are the ONLY
  // people the module mails — nobody is added automatically.
  function emailBox(id, label, list, hint) {
    return `<div style="grid-column:span 2;">
      <label style="${H.LABEL}">${esc(label)}</label>
      <textarea id="${id}" rows="4" placeholder="maintenance@laltd.in&#10;admin@laltd.in" style="${H.CONTROL}resize:vertical;font-family:inherit;">${esc(list.join('\n'))}</textarea>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:4px;">${esc(hint)}</div>
    </div>`;
  }

  function settingsTab() {
    const s = D.settings;
    return `
      <div class="amc-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="amc-card">
          <h3>Who gets the emails</h3>
          <div style="font-size:12px;color:#64748b;margin-bottom:12px;">Write the email IDs below — mail goes only to these addresses. One per line.</div>
          ${H.grid(
            emailBox('st-rem', 'AMC expiry reminders', s.reminderTo, 'Gets the reminder before every contract expires (days set on the right).')
            + emailBox('st-sr', 'Service requests', s.srTo, 'Gets a mail when a request is raised, assigned, resolved, or becomes overdue.'),
          )}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap;">
            <button class="btn-secondary btn-sm" id="st-test">Send test email to these IDs</button>
            <button class="btn-primary btn-sm" id="st-save">Save Settings</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="amc-card">
            <h3>Reminder schedule</h3>
            ${H.grid(
              H.field('st-days', 'Remind this many days before expiry', s.reminderDays.join(', '), { span: 2, hint: '0 = on the expiry date itself. Default: 30, 15, 7, 0' })
              + H.select('st-hour', 'Send from (IST hour)', s.reminderHour, Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` })))
              + H.field('st-window', '“Upcoming renewal” window (days)', s.upcomingWindow, { type: 'number' })
              + `<div style="grid-column:span 2;"><label style="display:flex;gap:8px;align-items:center;font-size:12.5px;cursor:pointer;">
                  <input type="checkbox" id="st-overdue"${s.overdueMail ? ' checked' : ''}/> Email overdue service requests (once per expected date)</label></div>`,
            )}
            <div style="font-size:11.5px;color:#94a3b8;margin-top:10px;">Saved with the “Save Settings” button.</div>
          </div>
          <div class="amc-card">
            <h3>Tools</h3>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
              <button class="btn-secondary btn-sm" id="st-run">Send due reminders now</button>
              <div style="font-size:11.5px;color:#94a3b8;margin-top:-4px;">Runs the same check the server does every 30 minutes. Safe to repeat — a reminder already sent is never sent twice.</div>
              <button class="btn-secondary btn-sm" id="st-backup">Download backup (JSON)</button>
              <div style="font-size:11.5px;color:#94a3b8;margin-top:-4px;">Every AMC table in one file. Attachments stay on the server under uploads/amc/.</div>
              <div style="font-size:11.5px;color:#64748b;margin-top:6px;">Access to this page is given from Users → Access → “AMC Management”.</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function readEmails(id) {
    const emails = H.val(id).split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const badOne = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (badOne) throw new Error(`"${badOne}" is not a valid email address`);
    return emails;
  }

  /* ── Files ────────────────────────────────────────────────────────── */

  const fileInput = (id, label = 'Attachments') => `<div style="grid-column:span 2;">
    <label style="${H.LABEL}">${esc(label)}</label>
    <input id="${id}" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx,image/*" style="${H.CONTROL}padding:6px;"/>
    <div style="font-size:11px;color:#94a3b8;margin-top:4px;">PDF, images, Excel or Word · up to 5 files, 4 MB each, 7 MB together</div></div>`;

  async function readFiles(id) {
    const files = [...(document.getElementById(id)?.files || [])];
    if (files.length > 5) throw new Error('At most 5 files at a time');
    let total = 0;
    for (const f of files) {
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

  const docList = (kind, id, docs, { removable = false } = {}) => docs.length ? docs.map((d, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
      <a href="/api/amc/${kind}/${encodeURIComponent(id)}/documents/${i}" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;word-break:break-all;">📎 ${esc(d.name)}</a>
      <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">${Math.max(1, Math.round(d.size / 1024))} KB${d.by ? ' · ' + esc(d.by) : ''}
        ${removable ? `<button class="btn-secondary btn-xs" data-doc-del="${i}" style="color:#dc2626;margin-left:6px;">Remove</button>` : ''}</span>
    </div>`).join('') : '<div style="font-size:12.5px;color:#94a3b8;">No documents</div>';

  const sub = (t) => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:16px 0 8px;">${esc(t)}</div>`;

  /* ── Contract modals ──────────────────────────────────────────────── */

  function deptOptions(cur) {
    const list = [...new Set([..._depts, cur].filter(Boolean))];
    return [{ value: '', label: '— Select —' }, ...list.map((d) => ({ value: d, label: d }))];
  }

  function assetPicker(id, selected) {
    return `<div style="grid-column:span 2;">
      <label style="${H.LABEL}">Equipment covered</label>
      <input id="${id}-q" placeholder="Filter equipment…" style="${H.CONTROL}margin-bottom:6px;"/>
      <div id="${id}" style="max-height:170px;overflow:auto;border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;">
        ${D.assets.length ? D.assets.filter((a) => a.status !== 'Scrapped' || selected.includes(a.id)).map((a) => `
          <label data-asset-row="${esc((a.name + ' ' + a.id + ' ' + a.location + ' ' + a.department).toLowerCase())}" style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0;cursor:pointer;">
            <input type="checkbox" value="${esc(a.id)}"${selected.includes(a.id) ? ' checked' : ''}/> ${esc(a.name)}
            <span style="color:#94a3b8;font-size:11px;">${esc(a.id)}${a.location ? ' · ' + esc(a.location) : ''}</span></label>`).join('')
          : '<div style="font-size:12px;color:#94a3b8;">No equipment yet — add it from the Equipment tab (optional).</div>'}
      </div></div>`;
  }

  function contractForm(c) {
    const editing = !!c;
    c = c || { amc_type: 'Comprehensive', renewal_frequency: 'Yearly', renewal_status: 'Not Due', asset_ids: [] };
    if (!D.vendors.some((v) => v.active)) {
      H.toast('Add a vendor first (Vendors tab)', 'error');
      _tab = 'vendors'; render();
      return;
    }
    const vendorOpts = D.vendors.filter((v) => v.active || v.id === c.vendor_id).map((v) => ({ value: v.id, label: v.name }));
    H.openModal({
      id: 'amc-cform', variant: 'drawer', width: 680,
      title: editing ? `Edit ${c.id}` : 'New AMC Contract',
      subtitle: editing ? c.contract_name : 'The AMC id is generated on save',
      bodyHTML: H.grid(
        H.field('cf-name', 'Contract Name', c.contract_name, { required: true, span: 2, placeholder: 'e.g. DG Set 125 kVA — Comprehensive AMC' })
        + H.select('cf-vendor', 'Vendor', c.vendor_id, vendorOpts, { required: true, placeholder: '— Select vendor —' })
        + H.select('cf-type', 'AMC Type', c.amc_type, D.lists.AMC_TYPES, { required: true })
        + H.select('cf-dept', 'Department', c.department || '', deptOptions(c.department))
        + H.field('cf-loc', 'Location', c.location, { placeholder: 'Plant / building / floor' })
        + H.field('cf-start', 'Start Date', c.start_date, { type: 'date', required: true })
        + H.select('cf-freq', 'Renewal Frequency', c.renewal_frequency, D.lists.FREQUENCIES, { required: true })
        + H.field('cf-expiry', 'Expiry Date', c.expiry_date, { type: 'date', required: true, hint: 'Filled from start date + frequency; change it if the contract says otherwise' })
        + H.field('cf-amount', 'Contract Amount (₹)', c.amount || '', { type: 'number', step: '0.01', required: true })
        + H.select('cf-rstatus', 'Renewal Status', c.renewal_status, D.lists.RENEWAL_STATUSES, { hint: 'Not Renewing / Discontinued stop the reminders' })
        + assetPicker('cf-assets', c.asset_ids || [])
        + H.textarea('cf-remarks', 'Remarks', c.remarks || '')
        + (editing ? '' : fileInput('cf-docs', 'Contract Document(s)')),
      ),
      confirmText: editing ? 'Save Changes' : 'Create AMC',
      onOpen: () => {
        const fill = () => {
          const s = H.val('cf-start'); const exp = document.getElementById('cf-expiry');
          if (!s || (exp.value && exp.dataset.auto !== '1')) return;
          const months = { Monthly: 1, Quarterly: 3, 'Half-Yearly': 6, Yearly: 12, '2 Years': 24, '3 Years': 36 }[H.val('cf-freq')] || 12;
          const d = new Date(s + 'T00:00:00'); const day = d.getDate();
          d.setDate(1); d.setMonth(d.getMonth() + months);
          d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
          d.setDate(d.getDate() - 1);
          exp.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          exp.dataset.auto = '1';
        };
        document.getElementById('cf-expiry')?.addEventListener('input', (e) => { e.target.dataset.auto = ''; });
        document.getElementById('cf-start')?.addEventListener('change', fill);
        document.getElementById('cf-freq')?.addEventListener('change', fill);
        bindPickerFilter('cf-assets');
      },
      onConfirm: async () => {
        const body = {
          contract_name: H.val('cf-name').trim(), vendor_id: H.val('cf-vendor'), amc_type: H.val('cf-type'),
          department: H.val('cf-dept'), location: H.val('cf-loc'), start_date: H.val('cf-start'), expiry_date: H.val('cf-expiry'),
          renewal_frequency: H.val('cf-freq'), amount: H.val('cf-amount'), renewal_status: H.val('cf-rstatus'),
          owner_user_id: c.owner_user_id || '', remarks: H.val('cf-remarks'),
          asset_ids: [...document.querySelectorAll('#cf-assets input:checked')].map((i) => i.value),
        };
        if (!body.contract_name) throw new Error('Contract name is required');
        if (!body.vendor_id) throw new Error('Choose a vendor');
        if (!body.start_date || !body.expiry_date) throw new Error('Start and expiry dates are required');
        if (body.expiry_date <= body.start_date) throw new Error('Expiry date must be after the start date');
        if (!(Number(body.amount) > 0)) throw new Error('Enter the contract amount');
        if (!editing) body.documents = await readFiles('cf-docs');
        const r = editing ? await H.patch(`/api/amc/contracts/${encodeURIComponent(c.id)}`, body) : await H.post('/api/amc/contracts', body);
        H.closeModal('amc-cform');
        H.toast(editing ? 'Contract updated' : `AMC ${r.id} created`);
        await refresh();
      },
    });
  }

  function bindPickerFilter(id) {
    document.getElementById(`${id}-q`)?.addEventListener('input', (e) => {
      const n = e.target.value.trim().toLowerCase();
      document.querySelectorAll(`#${id} [data-asset-row]`).forEach((row) => {
        row.style.display = !n || row.getAttribute('data-asset-row').includes(n) ? 'flex' : 'none';
      });
    });
  }

  async function renewModal(id) {
    let next;
    try { next = await H.api(`/api/amc/contracts/${encodeURIComponent(id)}/next-term`); } catch (e) { return H.fail(e); }
    const c = contractById(id);
    const vendorOpts = D.vendors.filter((v) => v.active || v.id === c.vendor_id).map((v) => ({ value: v.id, label: v.name }));
    H.openModal({
      id: 'amc-renew', width: 620,
      title: `Renew ${c.id}`,
      subtitle: `${c.contract_name} · current term ${H.fmtDate(c.start_date)} – ${H.fmtDate(c.expiry_date)} · ${money(c.amount)}`,
      bodyHTML: H.grid(
        H.field('rn-start', 'New Start Date', next.start_date, { type: 'date', required: true })
        + H.field('rn-expiry', 'New Expiry Date', next.expiry_date, { type: 'date', required: true })
        + H.field('rn-amount', 'New Contract Amount (₹)', next.amount || '', { type: 'number', step: '0.01', required: true })
        + `<div style="display:flex;align-items:flex-end;"><div id="rn-change" style="font-size:12.5px;color:#64748b;padding-bottom:9px;"></div></div>`
        + H.select('rn-vendor', 'Vendor', c.vendor_id, vendorOpts)
        + H.select('rn-type', 'AMC Type', c.amc_type, D.lists.AMC_TYPES)
        + H.select('rn-freq', 'Renewal Frequency', c.renewal_frequency, D.lists.FREQUENCIES)
        + '<div></div>'
        + H.textarea('rn-remarks', 'Remarks', '', { placeholder: 'e.g. 8% increase, added quarterly visits' })
        + fileInput('rn-docs', 'Renewed Contract Document(s)'),
      ),
      confirmText: 'Renew Contract',
      onOpen: () => {
        const show = () => {
          const n = Number(H.val('rn-amount')) || 0;
          const o = c.amount || 0;
          const el = document.getElementById('rn-change');
          if (!el) return;
          if (!n || !o) { el.textContent = ''; return; }
          const pct = ((n - o) / o) * 100;
          el.innerHTML = `Previous ${money(o)} → <b style="color:${pct > 0 ? '#dc2626' : '#16a34a'};">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</b>`;
        };
        document.getElementById('rn-amount')?.addEventListener('input', show);
        show();
      },
      onConfirm: async () => {
        const body = {
          start_date: H.val('rn-start'), expiry_date: H.val('rn-expiry'), amount: H.val('rn-amount'),
          vendor_id: H.val('rn-vendor'), amc_type: H.val('rn-type'), renewal_frequency: H.val('rn-freq'),
          remarks: H.val('rn-remarks'),
        };
        if (!body.start_date || !body.expiry_date) throw new Error('Both dates are required');
        if (body.expiry_date <= body.start_date) throw new Error('Expiry must be after the start date');
        if (!(Number(body.amount) > 0)) throw new Error('Enter the renewed amount');
        body.documents = await readFiles('rn-docs');
        await H.post(`/api/amc/contracts/${encodeURIComponent(id)}/renew`, body);
        H.closeModal('amc-renew');
        H.closeModal('amc-cview');
        H.toast(`${id} renewed until ${H.fmtDate(body.expiry_date)}`);
        await refresh();
      },
    });
  }

  async function contractView(id) {
    let d;
    try { d = await H.api(`/api/amc/contracts/${encodeURIComponent(id)}`); } catch (e) { return H.fail(e); }
    const c = d.contract;
    const v = d.vendor || {};
    const NK = { reminder: 'Reminder', sr_new: 'New request', sr_assigned: 'Assigned', sr_overdue: 'Overdue', sr_resolved: 'Resolved' };
    H.openModal({
      id: 'amc-cview', variant: 'drawer', width: 720, hideConfirm: true, cancelText: 'Close',
      title: c.contract_name, subtitle: `${c.id} · ${c.amc_type}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${pill(c.status)} ${pill(c.renewal_state)}
          <span style="font-size:12px;color:${c.days_left < 0 ? '#dc2626' : '#64748b'};align-self:center;">${c.days_left < 0 ? `expired ${-c.days_left} days ago` : `${c.days_left} days to expiry`}</span></div>
        ${can('manage') ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          <button class="btn-secondary btn-sm" id="cv-edit">Edit</button>
          ${c.renewal_status !== 'Discontinued' ? '<button class="btn-primary btn-sm" id="cv-renew">Renew</button>' : ''}
          <button class="btn-secondary btn-sm" id="cv-sr">+ Service Request</button>
          ${can('del') ? '<button class="btn-secondary btn-sm" id="cv-del" style="color:#dc2626;">Delete</button>' : ''}</div>` : ''}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Vendor', c.vendor_name)}${H.readout('Vendor Contact', [v.contact_person, v.phone].filter(Boolean).join(' · '))}
          ${H.readout('Vendor Email', v.email)}${H.readout('Department', c.department)}
          ${H.readout('Location', c.location)}
          ${H.readout('Start Date', H.fmtDate(c.start_date))}${H.readout('Expiry Date', H.fmtDate(c.expiry_date))}
          ${c.amount != null ? H.readout('Contract Amount', money(c.amount)) : ''}${H.readout('Renewal Frequency', c.renewal_frequency)}
          ${H.readout('Created', `${H.fmtDate(c.created_at)}${c.created_by ? ' · ' + c.created_by : ''}`)}
        </div>
        ${c.remarks ? `<div style="font-size:12.5px;color:#475569;margin-top:10px;white-space:pre-wrap;">${esc(c.remarks)}</div>` : ''}
        ${sub('Equipment')}
        ${d.assets.length ? d.assets.map((a) => `<div style="font-size:12.5px;padding:4px 0;">• <b>${esc(a.name)}</b> <span style="color:#94a3b8;">${esc(a.id)}${a.serial_no ? ' · S/N ' + esc(a.serial_no) : ''}${a.location ? ' · ' + esc(a.location) : ''}</span></div>`).join('') : '<div style="font-size:12.5px;color:#94a3b8;">No equipment linked</div>'}
        ${c.documents ? sub('Contract Documents') + docList('contracts', c.id, c.documents, { removable: can('manage') })
          + (can('manage') ? `<div style="display:flex;gap:8px;align-items:center;margin-top:8px;"><input id="cv-files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx" style="font-size:12px;flex:1;"/>
            <button class="btn-secondary btn-sm" id="cv-upload">Upload</button></div>` : '') : ''}
        ${can('money') ? sub('Renewal History') + (d.renewals.length ? H.table(['Renewed', 'Previous Term', 'Prev. Amount', 'New Term', 'New Amount', 'Change'],
          d.renewals.map((r) => [
            `${H.fmtDate(r.renewed_at)}<div style="font-size:11px;color:#94a3b8;">${esc(r.renewed_by)}</div>`,
            `${H.fmtDate(r.old_start)} – ${H.fmtDate(r.old_expiry)}${r.old_vendor_name && r.old_vendor_name !== c.vendor_name ? `<div style="font-size:11px;color:#94a3b8;">${esc(r.old_vendor_name)}</div>` : ''}`,
            money(r.old_amount), `${H.fmtDate(r.new_start)} – ${H.fmtDate(r.new_expiry)}`, money(r.new_amount),
            r.old_amount ? `${((r.new_amount - r.old_amount) / r.old_amount * 100).toFixed(1)}%${r.remarks ? `<div style="font-size:11px;color:#94a3b8;">${esc(r.remarks)}</div>` : ''}` : '',
          ])) : '<div style="font-size:12.5px;color:#94a3b8;">Not renewed yet</div>') : ''}
        ${sub(`Service Requests (${d.requests.length})`)}
        ${d.requests.length ? d.requests.map((s) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
          <div><button class="amc-link" data-cv-sr="${esc(s.id)}">${esc(s.id)}</button> ${esc(s.issue.slice(0, 80))}</div><div>${pill(s.status)}</div></div>`).join('') : '<div style="font-size:12.5px;color:#94a3b8;">None</div>'}
        ${d.notifications.length ? sub('Reminder & Notification Log') + d.notifications.map((n) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px dotted #e2e8f0;font-size:12px;">
          <span>${esc(NK[n.kind] || n.kind)}${n.offset_days != null && n.kind === 'reminder' ? ` (${n.offset_days} days)` : ''} · ${H.fmtDate(n.sent_at || n.created_at)}</span>
          <span>${pill(n.status)}</span></div>`).join('') : ''}
        ${d.activity.length ? sub('Activity') + d.activity.map((a) => `<div style="padding:5px 0;border-bottom:1px dotted #e2e8f0;font-size:12px;">
          <b>${esc(a.action)}</b> · ${esc(a.user_name)} · <span style="color:#94a3b8;">${H.fmtDate(a.created_at)} ${H.fmtTime(a.created_at)}</span>
          ${a.detail ? `<div style="color:#64748b;font-size:11.5px;word-break:break-word;">${esc(a.detail)}</div>` : ''}</div>`).join('') : ''}`,
      onOpen: () => {
        document.getElementById('cv-edit')?.addEventListener('click', () => { H.closeModal('amc-cview'); contractForm(contractById(c.id)); });
        document.getElementById('cv-renew')?.addEventListener('click', () => renewModal(c.id));
        document.getElementById('cv-sr')?.addEventListener('click', () => { H.closeModal('amc-cview'); requestForm(null, { contract_id: c.id }); });
        document.getElementById('cv-del')?.addEventListener('click', async () => {
          const ok = await Utils.showConfirm(`Delete ${c.id} (${c.contract_name}) and its renewal history? Usually you want Renewal Status → Discontinued instead.`, { title: 'Delete contract', confirmText: 'Delete', danger: true });
          if (!ok) return;
          try { await H.del(`/api/amc/contracts/${encodeURIComponent(c.id)}`); H.closeModal('amc-cview'); H.toast('Contract deleted'); await refresh(); } catch (e) { H.fail(e); }
        });
        document.getElementById('cv-upload')?.addEventListener('click', async () => {
          try {
            const documents = await readFiles('cv-files');
            if (!documents.length) return H.toast('Choose a file first', 'error');
            await H.post(`/api/amc/contracts/${encodeURIComponent(c.id)}/documents`, { documents });
            H.toast('Uploaded'); await contractView(c.id);
          } catch (e) { H.fail(e); }
        });
        document.querySelectorAll('#amc-cview [data-doc-del]').forEach((b) => b.addEventListener('click', async () => {
          const ok = await Utils.showConfirm('Remove this document?', { title: 'Remove document', confirmText: 'Remove', danger: true });
          if (!ok) return;
          try { await H.del(`/api/amc/contracts/${encodeURIComponent(c.id)}/documents/${b.getAttribute('data-doc-del')}`); H.toast('Removed'); await contractView(c.id); } catch (e) { H.fail(e); }
        }));
        document.querySelectorAll('#amc-cview [data-cv-sr]').forEach((b) => b.addEventListener('click', () => requestView(b.getAttribute('data-cv-sr'))));
      },
    });
  }

  /* ── Service request modals ───────────────────────────────────────── */

  function requestForm(s, preset = {}) {
    const editing = !!s;
    s = s || { priority: 'Medium', ...preset };
    const assetOpts = [{ value: '', label: '— Select equipment —' },
      ...D.assets.filter((a) => a.status === 'Active' || a.id === s.asset_id).map((a) => ({ value: a.id, label: `${a.name} — ${a.location || a.department || a.id}` }))];
    const contractOpts = [{ value: '', label: '— Auto (from equipment) —' },
      ...D.contracts.filter((c) => c.status !== 'Discontinued' || c.id === s.contract_id).map((c) => ({ value: c.id, label: `${c.id} · ${c.contract_name}` }))];
    H.openModal({
      id: 'amc-sform', width: 620,
      title: editing ? `Edit ${s.id}` : 'Raise Service Request',
      subtitle: editing ? '' : 'The maintenance team is emailed as soon as you submit',
      bodyHTML: H.grid(
        H.select('sf-asset', 'Equipment', s.asset_id || '', assetOpts, { span: 2 })
        + H.select('sf-contract', 'AMC Contract', s.contract_id || '', contractOpts, { span: 2, hint: 'Leave on Auto to link the contract currently covering the equipment' })
        + H.select('sf-priority', 'Priority', s.priority, D.lists.PRIORITIES, { required: true })
        + (editing ? '<div></div>' : H.field('sf-date', 'Request Date', H.todayISO(), { type: 'date', hint: can('assign') ? 'Back-date only for a call logged late' : '' }))
        + H.select('sf-dept', 'Department', s.department || (editing ? '' : D.me.department || ''), deptOptions(s.department || D.me.department))
        + H.field('sf-loc', 'Location', s.location || '', { placeholder: 'Filled from the equipment if blank' })
        + H.textarea('sf-issue', 'Issue Description', s.issue || '', { rows: 4, placeholder: 'What is wrong, since when, any error code…' })
        + (editing ? '' : fileInput('sf-docs', 'Photos / Attachments')),
      ),
      confirmText: editing ? 'Save' : 'Submit Request',
      onOpen: () => {
        if (!can('assign')) { const dt = document.getElementById('sf-date'); if (dt) dt.readOnly = true; }
      },
      onConfirm: async () => {
        const body = {
          asset_id: H.val('sf-asset'), contract_id: H.val('sf-contract'), priority: H.val('sf-priority'),
          department: H.val('sf-dept'), location: H.val('sf-loc'), issue: H.val('sf-issue').trim(),
        };
        if (!body.asset_id && !body.contract_id) throw new Error('Choose the equipment or the AMC contract');
        if (body.issue.length < 5) throw new Error('Describe the issue');
        if (!editing) {
          body.request_date = H.val('sf-date');
          if (body.request_date > H.todayISO()) throw new Error('Request date cannot be in the future');
          body.documents = await readFiles('sf-docs');
        }
        const r = editing ? await H.patch(`/api/amc/requests/${encodeURIComponent(s.id)}`, body) : await H.post('/api/amc/requests', body);
        H.closeModal('amc-sform');
        H.toast(editing ? 'Request updated' : `Request ${r.id} raised`);
        await refresh();
        if (editing) requestView(s.id);
      },
    });
  }

  // Mirrors srRights() in backend/amc.js.
  function srRights(s) {
    const mine = s.raised_by_id === D.me.id;
    const toMe = s.assigned_user_id === D.me.id;
    return {
      edit: can('assign') || (mine && s.status === 'Open'),
      work: can('assign') || (D.role === 'maintenance' && (toMe || !s.assigned_user_id)),
      note: can('assign') || mine || toMe || D.role === 'maintenance',
      close: can('assign') || mine,
    };
  }

  async function requestView(id) {
    let d;
    try { d = await H.api(`/api/amc/requests/${encodeURIComponent(id)}`); } catch (e) { return H.fail(e); }
    const s = d.request;
    const r = srRights(s);
    const done = DONE.has(s.status);
    const moves = [];
    if (!done && r.work) {
      if (s.status !== 'In Progress') moves.push(['In Progress', 'Start Work']);
      if (s.status !== 'On Hold') moves.push(['On Hold', 'Put On Hold']);
      moves.push(['Resolved', 'Mark Resolved']);
    }
    if (s.status === 'Resolved' && r.close) moves.push(['Closed', 'Close Request']);
    if (!done && can('assign') && s.status !== 'Closed') moves.push(['Closed', 'Close Without Resolving']);
    if (done && r.close) moves.push(['In Progress', 'Reopen']);
    const NK = { status: '#0150AA', assign: '#7c3aed', note: '#475569', edit: '#94a3b8' };
    H.openModal({
      id: 'amc-sview', variant: 'drawer', width: 680, hideConfirm: true, cancelText: 'Close',
      title: `${s.id} · ${s.priority}`, subtitle: `Raised by ${s.raised_by_name} on ${H.fmtDate(s.request_date)}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${pill(s.status)} ${pill(s.priority)} ${s.overdue ? H.pill('Overdue', 'danger') : ''}</div>
        <div style="font-size:13.5px;color:#0f172a;white-space:pre-wrap;margin-bottom:12px;">${esc(s.issue)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          ${can('assign') && !done ? `<button class="btn-primary btn-sm" id="sv-assign">${s.assigned_user_id || s.assigned_vendor_id ? 'Reassign' : 'Assign'}</button>` : ''}
          ${moves.map(([st, label]) => `<button class="btn-secondary btn-sm" data-sv-move="${esc(st)}">${esc(label)}</button>`).join('')}
          ${r.edit ? '<button class="btn-secondary btn-sm" id="sv-edit">Edit</button>' : ''}
          ${can('del') ? '<button class="btn-secondary btn-sm" id="sv-del" style="color:#dc2626;">Delete</button>' : ''}
        </div>
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Equipment', s.asset_name)}${H.readout('AMC Contract', s.contract_id ? `${s.contract_id} · ${s.contract_name}` : '')}
          ${H.readout('Vendor', s.vendor_name)}${H.readout('Vendor Contact', d.vendor ? [d.vendor.contact_person, d.vendor.phone].filter(Boolean).join(' · ') : '')}
          ${H.readout('Department', s.department)}${H.readout('Location', s.location)}
          ${H.readout('Assigned To', s.assigned_user_name)}${H.readout('Assigned Vendor', s.assigned_vendor_name)}
          ${H.readout('Expected Resolution', s.expected_date ? H.fmtDate(s.expected_date) : '')}${H.readout('Actual Resolution', s.actual_date ? H.fmtDate(s.actual_date) : '')}
        </div>
        ${s.resolution ? sub('Resolution') + `<div style="font-size:12.5px;color:#166534;background:#f0fdf4;border-radius:8px;padding:10px;white-space:pre-wrap;">${esc(s.resolution)}</div>` : ''}
        ${sub('Attachments')}${docList('requests', s.id, s.documents)}
        ${sub('Timeline & Service Notes')}
        <div>${d.notes.map((n) => `<div style="border-left:3px solid ${NK[n.kind] || '#cbd5e1'};padding:4px 0 4px 10px;margin:6px 0;">
          <div style="font-size:12.5px;color:#1e293b;white-space:pre-wrap;">${esc(n.note)}</div>
          <div style="font-size:11px;color:#94a3b8;">${esc(n.by)} · ${H.fmtDate(n.at)} ${H.fmtTime(n.at)}</div></div>`).join('')}</div>
        ${r.note ? `<div style="margin-top:12px;">${H.grid(H.textarea('sv-note', 'Add a note', '', { rows: 2, placeholder: 'Visit details, parts used, vendor feedback…' }) + fileInput('sv-files', 'Attach files'))}
          <div style="display:flex;justify-content:flex-end;margin-top:8px;"><button class="btn-secondary btn-sm" id="sv-add-note">Add Note</button></div></div>` : ''}`,
      onOpen: () => {
        document.getElementById('sv-assign')?.addEventListener('click', () => assignModal(s));
        document.getElementById('sv-edit')?.addEventListener('click', () => { H.closeModal('amc-sview'); requestForm(s); });
        document.getElementById('sv-del')?.addEventListener('click', async () => {
          const ok = await Utils.showConfirm(`Delete ${s.id} and its notes? This cannot be undone.`, { title: 'Delete request', confirmText: 'Delete', danger: true });
          if (!ok) return;
          try { await H.del(`/api/amc/requests/${encodeURIComponent(s.id)}`); H.closeModal('amc-sview'); H.toast('Request deleted'); await refresh(); } catch (e) { H.fail(e); }
        });
        document.querySelectorAll('#amc-sview [data-sv-move]').forEach((b) => b.addEventListener('click', () => statusModal(s, b.getAttribute('data-sv-move'))));
        document.getElementById('sv-add-note')?.addEventListener('click', async (e) => {
          const btn = e.target;
          try {
            const note = H.val('sv-note').trim();
            const documents = await readFiles('sv-files');
            if (!note && !documents.length) return H.toast('Write a note or attach a file', 'error');
            btn.disabled = true;
            await H.post(`/api/amc/requests/${encodeURIComponent(s.id)}/notes`, { note, documents });
            H.toast('Note added');
            await requestView(s.id);
            refresh();
          } catch (err) { btn.disabled = false; H.fail(err); }
        });
      },
    });
  }

  function assignModal(s) {
    const c = s.contract_id ? contractById(s.contract_id) : null;
    const v0 = s.assigned_vendor_id || c?.vendor_id || '';
    const suggested = { Critical: 1, High: 2, Medium: 4, Low: 7 }[s.priority] || 3;
    const exp = s.expected_date || (() => { const d = new Date(); d.setDate(d.getDate() + suggested); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    H.openModal({
      id: 'amc-assign', width: 540, title: `Assign ${s.id}`, subtitle: s.issue.slice(0, 90),
      bodyHTML: H.grid(
        H.select('as-user', 'Assigned Person', s.assigned_user_id || '', [{ value: '', label: '— None —' },
          ...D.users.map((u) => ({ value: u.id, label: u.department ? `${u.name} (${u.department})` : u.name }))], { span: 2 })
        + H.select('as-vendor', 'Vendor', v0, [{ value: '', label: '— None —' }, ...D.vendors.filter((v) => v.active || v.id === v0).map((v) => ({ value: v.id, label: v.name }))])
        + H.field('as-exp', 'Expected Resolution', exp, { type: 'date', required: true, hint: `Suggested for ${s.priority} priority` })
        + `<div style="grid-column:span 2;"><label style="display:flex;gap:8px;align-items:center;font-size:12.5px;cursor:pointer;">
            <input type="checkbox" id="as-mailv"/> Also email the vendor (to its address in the vendor master)</label></div>`
        + H.textarea('as-note', 'Note to assignee', ''),
      ),
      confirmText: 'Assign',
      onConfirm: async () => {
        const body = { assigned_user_id: H.val('as-user'), assigned_vendor_id: H.val('as-vendor'), expected_date: H.val('as-exp'),
          notify_vendor: document.getElementById('as-mailv')?.checked, note: H.val('as-note') };
        if (!body.assigned_user_id && !body.assigned_vendor_id) throw new Error('Choose a person, a vendor, or both');
        if (!body.expected_date) throw new Error('Set the expected resolution date');
        if (body.notify_vendor && body.assigned_vendor_id && !vendorById(body.assigned_vendor_id)?.email) throw new Error('That vendor has no email address in the vendor master');
        await H.post(`/api/amc/requests/${encodeURIComponent(s.id)}/assign`, body);
        H.closeModal('amc-assign');
        H.toast('Assigned');
        await refresh();
        requestView(s.id);
      },
    });
  }

  function statusModal(s, status) {
    const needsResolution = status === 'Resolved' || (status === 'Closed' && !s.actual_date);
    H.openModal({
      id: 'amc-status', width: 520, title: `${s.id}: ${s.status} → ${status}`,
      bodyHTML: H.grid(
        (needsResolution ? H.textarea('st-res', 'Resolution Details', s.resolution || '', { rows: 3, placeholder: 'What was done, parts replaced, root cause…' })
          + H.field('st-act', 'Actual Resolution Date', H.todayISO(), { type: 'date', required: true }) + '<div></div>' : '')
        + H.textarea('st-note', 'Note (optional)', '', { rows: 2 }),
      ),
      confirmText: 'Update Status',
      onConfirm: async () => {
        const body = { status, note: H.val('st-note') };
        if (needsResolution) {
          body.resolution = H.val('st-res').trim();
          body.actual_date = H.val('st-act');
          if (body.resolution.length < 3) throw new Error('Describe the resolution');
          if (body.actual_date > H.todayISO()) throw new Error('Resolution date cannot be in the future');
        }
        await H.post(`/api/amc/requests/${encodeURIComponent(s.id)}/status`, body);
        H.closeModal('amc-status');
        H.toast(`${s.id} is now ${status}`);
        await refresh();
        requestView(s.id);
      },
    });
  }

  /* ── Vendor & equipment modals ────────────────────────────────────── */

  function vendorForm(v) {
    const editing = !!v;
    v = v || { active: true };
    H.openModal({
      id: 'amc-vform', width: 620, title: editing ? `Edit ${v.id}` : 'Add Vendor',
      bodyHTML: H.grid(
        H.field('vf-name', 'Vendor Name', v.name, { required: true, span: 2 })
        + H.field('vf-person', 'Contact Person', v.contact_person)
        + H.field('vf-phone', 'Phone', v.phone)
        + H.field('vf-email', 'Email', v.email, { hint: 'Used only if you choose to email the vendor on an assignment' })
        + H.field('vf-gstin', 'GSTIN', v.gstin)
        + H.field('vf-services', 'Services', v.services, { span: 2, placeholder: 'e.g. DG sets, AC & chillers, fire systems' })
        + H.textarea('vf-address', 'Address', v.address || '', { rows: 2 })
        + H.textarea('vf-notes', 'Notes', v.notes || '', { rows: 2 })
        + (editing ? H.select('vf-active', 'Status', v.active ? '1' : '0', [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]) : ''),
      ),
      confirmText: editing ? 'Save' : 'Add Vendor',
      onConfirm: async () => {
        const body = { name: H.val('vf-name').trim(), contact_person: H.val('vf-person'), phone: H.val('vf-phone'), email: H.val('vf-email').trim(),
          gstin: H.val('vf-gstin').trim(), services: H.val('vf-services'), address: H.val('vf-address'), notes: H.val('vf-notes'),
          active: editing ? H.val('vf-active') === '1' : true };
        if (!body.name) throw new Error('Vendor name is required');
        if (body.email && !body.email.split(/[,;\s]+/).filter(Boolean).every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) throw new Error('Email is not a valid address');
        if (body.gstin && !/^[0-9A-Za-z]{15}$/.test(body.gstin)) throw new Error('GSTIN must be 15 letters/digits');
        if (editing) await H.patch(`/api/amc/vendors/${encodeURIComponent(v.id)}`, body); else await H.post('/api/amc/vendors', body);
        H.closeModal('amc-vform');
        H.toast(editing ? 'Vendor updated' : 'Vendor added');
        await refresh();
      },
    });
  }

  function vendorView(id) {
    const v = { ...vendorById(id), ...vendorStats(vendorById(id)) };
    const contracts = D.contracts.filter((c) => c.vendor_id === id);
    const srs = D.requests.filter((s) => s.vendor_id === id);
    H.openModal({
      id: 'amc-vview', variant: 'drawer', width: 640, hideConfirm: true, cancelText: 'Close', title: v.name, subtitle: v.id,
      bodyHTML: `
        ${H.stats([{ label: 'Active AMCs', value: v._active }, { label: 'Requests', value: v._srs }, { label: 'Open', value: v._open },
          { label: 'Avg. days', value: v._avg == null ? '—' : v._avg }, { label: 'On-time', value: v._ontime == null ? '—' : v._ontime + '%' }])}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Contact Person', v.contact_person)}${H.readout('Phone', v.phone)}${H.readout('Email', v.email)}${H.readout('GSTIN', v.gstin)}
          ${H.readout('Services', v.services)}${H.readout('Status', v.active ? 'Active' : 'Inactive')}</div>
        ${v.address ? `<div style="font-size:12.5px;color:#475569;margin-top:8px;white-space:pre-wrap;">${esc(v.address)}</div>` : ''}
        ${sub('Contracts')}${contracts.length ? contracts.map((c) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
          <div><b>${esc(c.id)}</b> ${esc(c.contract_name)}<div style="font-size:11px;color:#94a3b8;">until ${H.fmtDate(c.expiry_date)}${c.amount != null ? ' · ' + money(c.amount) : ''}</div></div><div>${pill(c.status)}</div></div>`).join('') : '<div style="font-size:12.5px;color:#94a3b8;">None</div>'}
        ${sub('Service History')}${srs.length ? srs.map((s) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
          <div><b>${esc(s.id)}</b> ${esc(s.issue.slice(0, 70))}<div style="font-size:11px;color:#94a3b8;">${H.fmtDate(s.request_date)}${s.actual_date ? ' → ' + H.fmtDate(s.actual_date) : ''}</div></div><div>${pill(s.status)}</div></div>`).join('') : '<div style="font-size:12.5px;color:#94a3b8;">None</div>'}`,
    });
  }

  function assetForm(a) {
    const editing = !!a;
    a = a || { status: 'Active' };
    H.openModal({
      id: 'amc-aform', width: 620, title: editing ? `Edit ${a.id}` : 'Add Equipment',
      bodyHTML: H.grid(
        H.field('af-name', 'Equipment / Asset Name', a.name, { required: true, span: 2, placeholder: 'e.g. DG Set 125 kVA' })
        + H.field('af-cat', 'Category', a.category, { placeholder: 'Power / HVAC / Lift / IT…' })
        + H.field('af-model', 'Make / Model', a.make_model)
        + H.field('af-serial', 'Serial No', a.serial_no)
        + H.field('af-pdate', 'Purchase / Install Date', a.purchase_date, { type: 'date' })
        + H.select('af-dept', 'Department', a.department || '', deptOptions(a.department))
        + H.field('af-loc', 'Location', a.location)
        + H.select('af-status', 'Status', a.status, D.lists.ASSET_STATUSES)
        + '<div></div>'
        + H.textarea('af-notes', 'Notes', a.notes || ''),
      ),
      confirmText: editing ? 'Save' : 'Add Equipment',
      onConfirm: async () => {
        const body = { name: H.val('af-name').trim(), category: H.val('af-cat'), make_model: H.val('af-model'), serial_no: H.val('af-serial'),
          purchase_date: H.val('af-pdate'), department: H.val('af-dept'), location: H.val('af-loc'), status: H.val('af-status'), notes: H.val('af-notes') };
        if (!body.name) throw new Error('Equipment name is required');
        if (body.purchase_date && body.purchase_date > H.todayISO()) throw new Error('Purchase date cannot be in the future');
        if (editing) await H.patch(`/api/amc/assets/${encodeURIComponent(a.id)}`, body); else await H.post('/api/amc/assets', body);
        H.closeModal('amc-aform');
        H.toast(editing ? 'Equipment updated' : 'Equipment added');
        await refresh();
      },
    });
  }

  async function assetView(id) {
    let d;
    try { d = await H.api(`/api/amc/assets/${encodeURIComponent(id)}`); } catch (e) { return H.fail(e); }
    const a = d.asset;
    H.openModal({
      id: 'amc-aview', variant: 'drawer', width: 640, hideConfirm: true, cancelText: 'Close', title: a.name, subtitle: a.id,
      bodyHTML: `
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Category', a.category)}${H.readout('Make / Model', a.make_model)}${H.readout('Serial No', a.serial_no)}
          ${H.readout('Department', a.department)}${H.readout('Location', a.location)}${H.readout('Status', a.status)}
          ${H.readout('Purchase Date', a.purchase_date ? H.fmtDate(a.purchase_date) : '')}</div>
        ${a.notes ? `<div style="font-size:12.5px;color:#475569;margin-top:8px;white-space:pre-wrap;">${esc(a.notes)}</div>` : ''}
        ${sub('AMC Contracts')}${d.contracts.length ? d.contracts.map((c) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
          <div><b>${esc(c.id)}</b> ${esc(c.contract_name)}<div style="font-size:11px;color:#94a3b8;">${esc(c.vendor_name)} · ${H.fmtDate(c.start_date)} – ${H.fmtDate(c.expiry_date)}</div></div><div>${pill(c.status)}</div></div>`).join('') : '<div style="font-size:12.5px;color:#94a3b8;">Not covered by any AMC</div>'}
        ${sub(`Service History (${d.requests.length})`)}${d.requests.length ? H.table(['Request', 'Date', 'Issue', 'Status', 'Resolved'], d.requests.map((s) => [
          `<b>${esc(s.id)}</b>`, H.fmtDate(s.request_date), esc(s.issue.slice(0, 80)), pill(s.status), s.actual_date ? H.fmtDate(s.actual_date) : '',
        ])) : '<div style="font-size:12.5px;color:#94a3b8;">No service requests yet</div>'}`,
    });
  }

  /* ── Export helpers ───────────────────────────────────────────────── */

  async function exportXlsx(filename, cols, rows, sheet = 'Report') {
    const XLSX = await Utils.loadXlsx();
    if (!XLSX) { H.toast('Excel library could not load — exporting CSV instead', 'error'); return H.downloadCsv(filename.replace(/\.xlsx$/, '.csv'), cols, rows); }
    const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
    ws['!cols'] = cols.map((c, i) => ({ wch: Math.min(48, Math.max(String(c).length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
    XLSX.writeFile(wb, filename);
  }

  const stamp = () => H.todayISO();

  function reportExportRows() {
    const r = _report.result;
    const rows = r.rows.map((x) => x.slice());
    if (r.totals) rows.push(r.columns.map((_, i) => (i === 0 ? 'Total' : r.totals[i] ?? '')));
    return { cols: r.columns, rows };
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bindSearch(id, which, key = 'q') {
    const el = document.getElementById(id);
    if (!el) return;
    let t;
    el.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        _filters[which][key] = el.value;
        render();
        const again = document.getElementById(id);
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    });
  }

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-amc-tab]').forEach((b) => b.addEventListener('click', () => {
      _tab = b.getAttribute('data-amc-tab');
      if (_tab === 'logs' && !_logs.rows) loadLogs();
      render();
    }));
    document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-goto'); render(); }));
    $('amc-raise')?.addEventListener('click', () => {
      if (!D.assets.length && !D.contracts.length) return H.toast('No equipment or contracts are set up yet — ask the maintenance manager', 'error');
      requestForm(null);
    });
    $('amc-add-contract')?.addEventListener('click', () => contractForm(null));

    document.querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const [which, key] = th.getAttribute('data-sort').split(':');
      const s = _sort[which];
      if (s.key === key) s.dir = -s.dir; else { s.key = key; s.dir = 1; }
      render();
    }));

    // Filters
    const filt = { ct: 'contracts', sr: 'requests', as: 'assets', vd: 'vendors' };
    for (const [p, which] of Object.entries(filt)) {
      bindSearch(`${p}-q`, which);
      Object.keys(_filters[which]).forEach((k) => {
        if (k === 'q' || k === 'mine') return;
        $(`${p}-f-${k}`)?.addEventListener('change', (e) => { _filters[which][k] = e.target.value; render(); });
      });
      $(`${p}-clear`)?.addEventListener('click', () => {
        const blank = { contracts: { q: '', status: 'All', dept: 'All', vendor: 'All', type: 'All' }, requests: { q: '', status: 'All', priority: 'All', mine: false },
          assets: { q: '', status: 'All', dept: 'All' }, vendors: { q: '', active: 'All' } }[which];
        _filters[which] = blank;
        render();
      });
    }
    $('sr-f-mine')?.addEventListener('change', (e) => { _filters.requests.mine = e.target.checked; render(); });

    // Row actions
    document.querySelectorAll('[data-view-contract]').forEach((b) => b.addEventListener('click', () => contractView(b.getAttribute('data-view-contract'))));
    document.querySelectorAll('[data-edit-contract]').forEach((b) => b.addEventListener('click', () => contractForm(contractById(b.getAttribute('data-edit-contract')))));
    document.querySelectorAll('[data-renew]').forEach((b) => b.addEventListener('click', () => renewModal(b.getAttribute('data-renew'))));
    document.querySelectorAll('[data-view-sr]').forEach((b) => b.addEventListener('click', () => requestView(b.getAttribute('data-view-sr'))));
    document.querySelectorAll('[data-view-asset]').forEach((b) => b.addEventListener('click', () => assetView(b.getAttribute('data-view-asset'))));
    document.querySelectorAll('[data-edit-asset]').forEach((b) => b.addEventListener('click', () => assetForm(assetById(b.getAttribute('data-edit-asset')))));
    document.querySelectorAll('[data-view-vendor]').forEach((b) => b.addEventListener('click', () => vendorView(b.getAttribute('data-view-vendor'))));
    document.querySelectorAll('[data-edit-vendor]').forEach((b) => b.addEventListener('click', () => vendorForm(vendorById(b.getAttribute('data-edit-vendor')))));
    $('as-add')?.addEventListener('click', () => assetForm(null));
    $('vd-add')?.addEventListener('click', () => vendorForm(null));
    const delHandler = (attr, what, url) => document.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute(attr);
      const ok = await Utils.showConfirm(`Delete ${what} ${id}? Only records with no history can be deleted — otherwise mark it Inactive.`, { title: `Delete ${what}`, confirmText: 'Delete', danger: true });
      if (!ok) return;
      try { await H.del(`${url}/${encodeURIComponent(id)}`); H.toast(`${what[0].toUpperCase() + what.slice(1)} deleted`); await refresh(); } catch (e) { H.fail(e); }
    }));
    delHandler('data-del-asset', 'equipment', '/api/amc/assets');
    delHandler('data-del-vendor', 'vendor', '/api/amc/vendors');

    // Exports
    $('ct-export-csv')?.addEventListener('click', () => { const { cols, rows } = contractExportRows(); H.downloadCsv(`amc-contracts-${stamp()}.csv`, cols, rows); });
    $('ct-export-xlsx')?.addEventListener('click', () => { const { cols, rows } = contractExportRows(); exportXlsx(`amc-contracts-${stamp()}.xlsx`, cols, rows, 'AMC Contracts'); });
    $('sr-export-csv')?.addEventListener('click', () => { const { cols, rows } = requestExportRows(); H.downloadCsv(`amc-service-requests-${stamp()}.csv`, cols, rows); });
    $('sr-export-xlsx')?.addEventListener('click', () => { const { cols, rows } = requestExportRows(); exportXlsx(`amc-service-requests-${stamp()}.xlsx`, cols, rows, 'Service Requests'); });
    $('as-export-csv')?.addEventListener('click', () => H.downloadCsv(`amc-equipment-${stamp()}.csv`,
      ['ID', 'Name', 'Category', 'Make/Model', 'Serial No', 'Department', 'Location', 'Purchase Date', 'Status', 'AMC Cover', 'Requests'],
      sortRows(filteredAssets(), 'assets').map((a) => [a.id, a.name, a.category, a.make_model, a.serial_no, a.department, a.location, a.purchase_date || '', a.status, a._cover, a._srs])));
    $('vd-export-csv')?.addEventListener('click', () => H.downloadCsv(`amc-vendors-${stamp()}.csv`,
      ['ID', 'Vendor', 'Contact Person', 'Phone', 'Email', 'GSTIN', 'Services', 'Status', 'Address'],
      D.vendors.map((v) => [v.id, v.name, v.contact_person, v.phone, v.email, v.gstin, v.services, v.active ? 'Active' : 'Inactive', v.address])));

    // Reports
    $('rp-type')?.addEventListener('change', (e) => { _report.type = e.target.value; _report.result = null; render(); });
    $('rp-fy')?.addEventListener('change', (e) => { _report.fy = e.target.value; });
    $('rp-days')?.addEventListener('change', (e) => { _report.days = e.target.value; });
    $('rp-from')?.addEventListener('change', (e) => { _report.from = e.target.value; });
    $('rp-to')?.addEventListener('change', (e) => { _report.to = e.target.value; });
    $('rp-run')?.addEventListener('click', runReport);
    $('rp-csv')?.addEventListener('click', () => { const { cols, rows } = reportExportRows(); H.downloadCsv(`amc-${_report.type}-${stamp()}.csv`, cols, rows); });
    $('rp-xlsx')?.addEventListener('click', () => {
      const { cols, rows } = reportExportRows();
      exportXlsx(`amc-${_report.type}-${stamp()}.xlsx`, cols, rows, _report.result.title);
    });

    // Logs
    $('lg-kind')?.addEventListener('change', (e) => { _logs.kind = e.target.value; _logs.rows = null; render(); loadLogs(); });
    $('lg-filter')?.addEventListener('change', (e) => { _logs.filter = e.target.value; render(); });
    $('lg-reload')?.addEventListener('click', () => { _logs.rows = null; render(); loadLogs(); });
    $('lg-csv')?.addEventListener('click', () => {
      const rows = _logs.rows || [];
      if (_logs.kind === 'notifications') {
        H.downloadCsv(`amc-notifications-${stamp()}.csv`, ['Created', 'Sent', 'Type', 'Ref', 'Offset (days)', 'Subject', 'Recipients', 'Status', 'Error', 'Attempts', 'Triggered By'],
          rows.map((r) => [r.created_at, r.sent_at || '', r.kind, r.ref_id, r.offset_days ?? '', r.subject, r.recipients, r.status, r.error, r.attempts, r.triggered_by]));
      } else {
        H.downloadCsv(`amc-activity-${stamp()}.csv`, ['When', 'User', 'Entity', 'ID', 'Action', 'Detail'],
          rows.map((r) => [r.created_at, r.user_name, r.entity, r.entity_id, r.action, r.detail]));
      }
    });

    // Settings
    $('st-save')?.addEventListener('click', async (e) => {
      const btn = e.target;
      try {
        const body = {
          reminderDays: H.val('st-days'), reminderHour: Number(H.val('st-hour')), upcomingWindow: Number(H.val('st-window')),
          overdueMail: $('st-overdue').checked, reminderTo: readEmails('st-rem'), srTo: readEmails('st-sr'),
        };
        btn.disabled = true;
        D.settings = await H.post('/api/amc/settings', body);
        H.toast('Settings saved');
        await refresh();
      } catch (err) { btn.disabled = false; H.fail(err); }
    });
    $('st-run')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      try {
        const r = await H.post('/api/amc/run-reminders');
        const f = (x) => `${x.sent} sent, ${x.failed} failed, ${x.skipped} without recipients, ${x.duplicate} already sent`;
        H.toast(`Reminders: ${f(r.reminders)} · Overdue: ${f(r.overdue)}`, r.reminders.failed || r.overdue.failed ? 'error' : 'success');
        _logs.rows = null;
      } catch (err) { H.fail(err); }
      btn.disabled = false;
    });
    $('st-test')?.addEventListener('click', async () => {
      try {
        const to = [...new Set([...readEmails('st-rem'), ...readEmails('st-sr')])];
        if (!to.length) return H.toast('Write at least one email ID first', 'error');
        const r = await H.post('/api/amc/test-mail', { to });
        H.toast(`Test mail sent to ${r.to}`);
      } catch (e) { H.fail(e); }
    });
    $('st-backup')?.addEventListener('click', () => { window.location.href = '/api/amc/backup'; });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening AMC Management…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load AMC Management', e.message); }
    },
  };
})();
