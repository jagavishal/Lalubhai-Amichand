window.Pages = window.Pages || {};

window.Pages.dashboard = (function () {

  /* ── helpers ─────────────────────────────────────────────────────── */
  function fmt(iso) {
    if (!iso) return '—';
    return new Date(iso)
      .toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .replace(/\//g, '-');
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function fmtDateInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toISOString().split('T')[0];
  }

  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function isAdmin(user) {
    if (!user) return false;
    const roles = Array.isArray(user.roles) ? user.roles : (user.roles || '').split(',').map(r => r.trim());
    return roles.includes('Admin') || roles.includes('HOD');
  }

  function avatarHTML(name) {
    return window.UI.avatar(name || '', { size: 22 });
  }

  function typePillHTML(type) {
    const variantMap = { Delegation: 'info', FMS: 'purple', Checklist: 'success' };
    return window.UI.pill(type, { variant: variantMap[type] || 'neutral', size: 'sm' });
  }

  function priorityHTML(type, priority) {
    if (type === 'Checklist') return '<span style="color:var(--text-muted);font-size:12px;">—</span>';
    if (!priority || priority === 'Low') return '<span style="color:var(--text-muted);font-size:12px;">Low</span>';
    return window.UI.pill(priority, { variant: priority === 'High' ? 'danger' : 'warning', size: 'sm' });
  }

  /* ── performance computation ─────────────────────────────────────── */
  function computePerf(delegations, users) {
    const from = new Date(); from.setDate(from.getDate() - 30);
    const stats = {};
    (users || []).forEach(u => { stats[u.name] = { name: u.name, completed: 0, total: 0, pending: 0 }; });
    (delegations || []).forEach(d => {
      const date = new Date(d.createdAt || d.created_at);
      if (date >= from && stats[d.doer]) {
        stats[d.doer].total++;
        if (d.status === 'done') stats[d.doer].completed++;
        else stats[d.doer].pending++;
      }
    });
    const arr = Object.values(stats).filter(s => s.total > 0);
    arr.sort((a, b) => b.completed - a.completed);
    return {
      top5:       arr.slice(0, 5),
      bottom5:    [...arr].sort((a, b) => b.pending   - a.pending).slice(0, 5),
      mostActive: [...arr].sort((a, b) => b.total     - a.total  ).slice(0, 5),
    };
  }

  function barListHTML(title, items, valueKey, tone, icon) {
    const colors = {
      emerald: { bar: 'linear-gradient(90deg,#34d399,#059669)', icon: 'linear-gradient(135deg,#34d399,#059669)', text: '#065f46' },
      red:     { bar: 'linear-gradient(90deg,#f87171,#dc2626)', icon: 'linear-gradient(135deg,#f87171,#dc2626)', text: '#991b1b' },
      blue:    { bar: 'linear-gradient(90deg,#C4714A,#D4895A)', icon: 'linear-gradient(135deg,#C4714A,#D4895A)', text: '#7c2d12' },
    };
    const c = colors[tone] || colors.blue;
    const max = Math.max(...items.map(i => i[valueKey] || 0), 1);
    const rows = items.length === 0
      ? '<div style="color:#94a3b8;font-size:12px;padding:1.5rem;text-align:center;">No data in this range</div>'
      : items.map((i, idx) => `
          <li style="display:flex;align-items:center;gap:10px;font-size:12px;margin-bottom:8px;">
            <div style="width:20px;height:20px;border-radius:6px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:#64748b;flex-shrink:0;">${idx + 1}</div>
            <div style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:#334155;" title="${i.name}">${i.name}</div>
            <div style="flex:1;background:#e2e8f0;border-radius:9999px;height:8px;overflow:hidden;">
              <div style="height:100%;border-radius:9999px;background:${c.bar};width:${Math.round((i[valueKey] / max) * 100)}%;transition:width .4s;"></div>
            </div>
            <div style="width:24px;text-align:right;font-weight:700;color:${c.text};font-variant-numeric:tabular-nums;">${i[valueKey]}</div>
          </li>`).join('');
    return `
      <div class="card" style="padding:1rem;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <div style="width:28px;height:28px;border-radius:8px;background:${c.icon};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;">${icon}</div>
          <h3 style="font-size:13px;font-weight:600;color:#1e293b;margin:0;">${title}</h3>
        </div>
        <ul style="margin:0;padding:0;list-style:none;">${rows}</ul>
      </div>`;
  }

  /* ── modal helpers ───────────────────────────────────────────────── */
  function showModal(id) { document.getElementById(id) && (document.getElementById(id).style.display = 'flex'); }
  function hideModal(id) { document.getElementById(id) && (document.getElementById(id).style.display = 'none'); }

  /* ── state ───────────────────────────────────────────────────────── */
  let _state = {
    data: null,
    users: [],
    holidays: [],
    delegations: [],
    subTab: 'All',
    userFilter: 'All',
    reviseTask: null,
    reviseSaving: false,
    reviseNote: '',
    reviseDate: '',
    sortCol: null,   // 'type' | 'description' | 'doer' | 'priority' | 'date'
    sortDir: 'asc',
  };

  /* ── column sort (click a header, like Google Sheets) ──────────────── */
  const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
  const DASH_SORT_ACCESSORS = {
    type:        t => (t.type || '').toLowerCase(),
    description: t => (t.description || '').toLowerCase(),
    doer:        t => (t.doer || '').toLowerCase(),
    priority:    t => PRIORITY_RANK[t.priority] ?? 99,
    date:        t => t.date ? new Date(t.date).getTime() : -Infinity,
  };

  function sortDashTasks(tasks) {
    const { sortCol, sortDir } = _state;
    if (!sortCol || !DASH_SORT_ACCESSORS[sortCol]) return tasks;
    const accessor = DASH_SORT_ACCESSORS[sortCol];
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...tasks].sort((a, b) => {
      const av = accessor(a), bv = accessor(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function dashSortIndicator(col) {
    if (_state.sortCol !== col) return '';
    return _state.sortDir === 'asc'
      ? ' <span style="font-size:9px;">&#9650;</span>'
      : ' <span style="font-size:9px;">&#9660;</span>';
  }

  /* ── render helpers for tasks table ─────────────────────────────── */
  function getFiltered() {
    const { data, subTab, userFilter } = _state;
    if (!data) return [];
    const STATUS_RANK = { revise: 0, pending: 1, done: 2 };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return data.pendingTasks
      .filter(t => {
        if (subTab === 'Completed') {
          if (t.status !== 'done') return false;
        } else if (subTab === 'Shifted') {
          if (t.status !== 'revise' && t.status !== 'revise_requested') return false;
        } else if (subTab === 'Upcoming') {
          if (t.type !== 'Delegation' || t.status === 'done') return false;
          const due = new Date(t.date); due.setHours(0, 0, 0, 0);
          if (!(due > today)) return false;
        } else {
          if (t.status === 'done') return false;
          if (subTab !== 'All' && t.type !== subTab) return false;
        }
        return userFilter === 'All' || (t.doer || '').trim().toLowerCase() === userFilter.trim().toLowerCase();
      })
      .slice()
      .sort((a, b) => (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2));
  }

  /* ── full render ─────────────────────────────────────────────────── */
  async function render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    try {
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;padding:3rem;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;color:#94a3b8;">
          <svg style="animation:spin .8s linear infinite;" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          <span style="font-size:13px;">Loading dashboard…</span>
        </div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

    const user = window.currentUser;
    const admin = isAdmin(user);

    /* parallel fetches */
    const [dashData, usersData, holidaysData, delegationsData] = await Promise.all([
      Utils.apiFetch('/api/dashboard'),
      Utils.apiFetch('/api/users'),
      Utils.apiFetch('/api/holidays'),
      admin ? Utils.apiFetch('/api/delegations') : Promise.resolve([]),
    ]);

    if (!dashData) return;

    _state.data        = dashData;
    _state.users       = usersData || [];
    _state.holidays    = holidaysData || [];
    _state.delegations = delegationsData || [];
    _state.subTab      = 'All';
    _state.userFilter  = 'All';

    _renderShell(el, admin);
    } catch(err) {
      el.innerHTML = `<div style="padding:2rem;color:#dc2626;font-size:14px;">❌ Dashboard error: ${err.message}</div>`;
      console.error('Dashboard render error:', err);
    }
  }

  function _renderShell(el, admin) {
    const { data, users, holidays } = _state;
    const allDoers = [...new Set((users || []).map(u => u.name))].sort();

    const perf = admin ? computePerf(_state.delegations, users) : null;

    el.innerHTML = `
      <style>
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        #db-wrap { animation: fadeIn .25s ease both; }
        .db-stat-card { border: 2px solid transparent; transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
        .db-stat-card[data-filter]:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,.08); }
        .db-stat-card[data-filter]:active { transform: translateY(0); }
        .db-stat-card[data-filter].active { border-color: var(--color-primary); box-shadow: 0 4px 14px rgba(196,113,74,.16); }
        .db-th-sort:hover { color: var(--color-primary) !important; }
        /* Mobile responsive */
        @media (max-width: 767px) {
          #db-topbar { flex-direction: column; gap: 10px; }
          #db-title-row { display: flex !important; align-items: center; justify-content: space-between; width: 100%; }
          #db-btn-row { display: flex !important; width: 100%; gap: 8px; }
          #db-btn-row button { flex: 1; font-size: 11.5px !important; padding: 8px 6px !important; }
          #db-emp-picker { width: 100% !important; }
          #db-emp-trigger { width: 100% !important; min-width: unset !important; }
          #db-stat-cards { display: flex !important; overflow-x: auto; gap: 10px; padding-bottom: 4px; scroll-snap-type: x mandatory; }
          #db-stat-cards .db-stat-card { min-width: 130px !important; flex-shrink: 0; scroll-snap-align: start; }
          #db-main-grid { grid-template-columns: 1fr !important; }
          #db-perf-grid  { grid-template-columns: 1fr !important; }
          #db-stat-cards::-webkit-scrollbar { height: 3px; }
          #db-stat-cards::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 2px; }
        }
        /* Modal shell, .input, .label, and .btn-* now come from the shared style.css design system (no local duplicates). */
        .pill-act { display:inline-flex;align-items:center;padding:2px 8px;font-size:10.5px;font-weight:600;border-radius:9999px;cursor:pointer;border:none;transition:background .12s; }
        .pill-done { background:var(--color-success-bg);color:var(--color-success-text); } .pill-done:hover { background:var(--color-success-border); }
        .pill-revise { background:var(--color-danger-bg);color:var(--color-danger-text); } .pill-revise:hover { background:var(--color-danger-border); }
        .pill-grant { background:var(--color-success-bg);color:var(--color-success-text); } .pill-grant:hover { background:var(--color-success-border); }
        .pill-deny  { background:var(--color-neutral-bg);color:var(--color-neutral-text); } .pill-deny:hover  { background:var(--border-base); }
        .pill-pending-wait { background:var(--color-warning-bg);color:var(--color-warning-text);display:inline-flex;align-items:center;padding:2px 8px;font-size:10.5px;font-weight:600;border-radius:9999px; }
      </style>

      <div id="db-wrap">
        <!-- Top bar: emp picker LEFT | buttons RIGHT -->
        <div id="db-topbar" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:20px;">

          <!-- LEFT: employee picker (admin) or title (non-admin) -->
          ${admin ? `
          <div id="db-emp-picker" style="position:relative;">
            <button id="db-emp-trigger" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1.5px solid #e2e8f0;background:#fff;font-size:13px;font-weight:500;color:#374151;cursor:pointer;min-width:200px;justify-content:space-between;">
              <span style="display:flex;align-items:center;gap:7px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span id="db-emp-label" style="font-weight:600;">All Employees</span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div id="db-emp-dropdown" style="display:none;position:absolute;left:0;top:calc(100% + 4px);width:280px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:200;overflow:hidden;">
              <div style="padding:8px;">
                <input id="db-emp-search" type="text" placeholder="Search employee..." style="width:100%;padding:6px 10px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12px;outline:none;box-sizing:border-box;" />
              </div>
              <div id="db-emp-list" style="max-height:260px;overflow-y:auto;padding:4px 0;">
                <div data-emp-val="All" data-emp-label="All Employees" class="db-emp-opt" style="padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:600;color:#374151;background:#f0f9ff;">All Employees</div>
                ${(users || []).sort((a,b)=>a.name.localeCompare(b.name)).map(u => {
                  const dept = (u.department||'').length > 16 ? (u.department||'').slice(0,16)+'…' : (u.department||'');
                  return `<div data-emp-val="${u.name}" data-emp-label="${u.name}${u.department ? ' · '+u.department : ''}" class="db-emp-opt" style="padding:8px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span style="font-size:12.5px;font-weight:600;color:#0f172a;">${u.name}</span>
                    ${dept ? `<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">${dept}</span>` : ''}
                  </div>`;
                }).join('')}
              </div>
            </div>
          </div>` : `<h2 style="font-size:17px;font-weight:700;color:#0f172a;margin:0;">Dashboard</h2>`}

          <!-- RIGHT: action buttons -->
          <div id="db-btn-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${admin ? `
            <button id="db-btn-holidays" style="display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;background:#f59e0b;color:#fff;border:none;cursor:pointer;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              Holidays
            </button>` : ''}
            <button id="db-btn-checklist" style="padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;background:#059669;color:#fff;border:none;cursor:pointer;">
              Checklist
            </button>
            <button id="db-btn-delegate" style="padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:700;background:#C4714A;color:#fff;border:none;cursor:pointer;">
              Delegate
            </button>
            <button id="db-btn-help-ticket" style="display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;background:#0ea5e9;color:#fff;border:none;cursor:pointer;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Help Ticket
            </button>
            <button id="db-btn-announcement" style="display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:600;background:#8b5cf6;color:#fff;border:none;cursor:pointer;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              Announcement
            </button>
            ${admin ? `<button id="db-btn-transfer" style="display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:8px;font-size:12.5px;font-weight:700;background:#7c3aed;color:#fff;border:none;cursor:pointer;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              Transfer
            </button>` : ''}
          </div>

          <!-- Mobile title row (hidden on desktop) -->
          <div id="db-title-row" style="display:none;width:100%;align-items:center;justify-content:space-between;">
            <h2 style="font-size:18px;font-weight:800;color:#0f172a;margin:0;">Dashboard</h2>
            ${admin ? `<div id="db-emp-picker-mobile"></div>` : ''}
          </div>
        </div>

        <!-- Stat cards -->
        <div id="db-stat-cards" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1rem;margin-bottom:20px;">
          <div class="card db-stat-card active" data-filter="All" title="Show all pending tasks" style="padding:20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Pending</div>
            <div id="db-stat-pending" style="font-size:2.5rem;font-weight:800;color:var(--color-danger);">${data.pending || data.pendingTasks.length}</div>
            <div id="db-stat-revised" style="font-size:11px;font-weight:600;color:var(--color-warning);margin-top:4px;${data.revised > 0 ? '' : 'display:none;'}">+ ${data.revised} shifted</div>
          </div>
          <div class="card db-stat-card" data-filter="Shifted" title="Show shifted tasks" style="padding:20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Shifted</div>
            <div id="db-stat-revised-count" style="font-size:2.5rem;font-weight:800;color:var(--color-warning);">${data.revised || 0}</div>
          </div>
          <div class="card db-stat-card" data-filter="Completed" title="Show completed tasks" style="padding:20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Completed</div>
            <div id="db-stat-completed" style="font-size:2.5rem;font-weight:800;color:var(--color-success);">${data.completed}</div>
          </div>
          <div class="card db-stat-card" data-filter="Upcoming" title="Show upcoming tasks" style="padding:20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Upcoming</div>
            <div id="db-stat-upcoming" style="font-size:2.5rem;font-weight:800;color:var(--color-purple);">${data.upcoming || 0}</div>
          </div>
          <div class="card db-stat-card" style="padding:20px;display:none;" id="db-stat-total-card">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Total</div>
            <div id="db-stat-total" style="font-size:2.5rem;font-weight:800;color:var(--color-primary);">${admin ? data.total : data.pendingTasks.length}</div>
          </div>
        </div>

        <!-- Tasks + Pie -->
        <div id="db-main-grid" style="display:grid;grid-template-columns:1fr 280px;gap:1rem;margin-bottom:20px;">

          <!-- Tasks card -->
          <div class="card" style="overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px 20px;border-bottom:1px solid #f1f5f9;">
              <div>
                <h2 style="font-size:13.5px;font-weight:700;color:#0f172a;margin:0;">All Pending Tasks</h2>
                <p id="db-tasks-count" style="font-size:11.5px;color:#64748b;margin:2px 0 0;"></p>
              </div>
              <div style="display:flex;align-items:center;gap:4px;background:#f1f5f9;border-radius:8px;padding:3px;">
                ${['All','Delegation','Checklist','FMS','Upcoming'].map(t =>
                  `<button class="db-tab-btn" data-tab="${t}" style="padding:5px 11px;border-radius:6px;font-size:11.5px;font-weight:600;border:none;cursor:pointer;transition:all .12s;">${t}</button>`
                ).join('')}
              </div>
            </div>
            <div style="overflow-x:auto;max-height:420px;overflow-y:auto;">
              <table id="db-tasks-table" style="width:100%;border-collapse:collapse;font-size:12.5px;"></table>
            </div>
          </div>

          <!-- Pie chart card -->
          <div class="card" style="padding:1rem;display:flex;flex-direction:column;">
            <div>
              <h3 style="font-size:13px;font-weight:700;color:#0f172a;margin:0;">Task Overview</h3>
              <p style="font-size:11.5px;color:#64748b;margin:3px 0 0;">Overall distribution</p>
            </div>
            <div id="db-pie-container" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:12px;">
              ${renderPieSVG(data.completed, data.pending || data.pendingTasks.length, data.revised, data.upcoming || 0)}
            </div>
          </div>
        </div>

        <!-- Performance — admin only -->
        ${admin && perf ? `
        <div class="card" style="padding:1.25rem;margin-bottom:20px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:1rem;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:1.1rem;">📋</span>
              <div>
                <h2 style="font-size:13.5px;font-weight:700;color:#0f172a;margin:0;">Performance &amp; Activity</h2>
                <p style="font-size:11.5px;color:#64748b;margin:2px 0 0;">Team leaderboard</p>
              </div>
            </div>
            <span style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;display:inline-flex;align-items:center;padding:2px 10px;font-size:10.5px;font-weight:600;border-radius:9999px;">Last 30 days</span>
          </div>
          <div id="db-perf-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
            ${barListHTML('🏆 Top 5 Performers',   perf.top5,       'completed', 'emerald', '★')}
            ${barListHTML('📉 Bottom 5 Performers', perf.bottom5,    'pending',   'red',     '!')}
            ${barListHTML('⚡ Top 5 Most Active',   perf.mostActive, 'total',     'blue',    '⚡')}
          </div>
        </div>` : ''}
      </div>

      <!-- ── Add Delegate Modal ── -->
      <div id="modal-delegate" class="modal-overlay" style="display:none;">
        <div class="modal-box" style="max-width:520px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2 style="font-size:15px;font-weight:700;margin:0;flex:1;">+ Delegate Task</h2>
            <button id="modal-delegate-close" style="width:28px;height:28px;border-radius:50%;background:var(--border-light);border:none;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
            <!-- Row 1: Doer | Due Date -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label class="label">DOER (ASSIGN TO)</label>
                <select id="del-doer" class="input">
                  <option value="">Select Doer</option>
                  ${(users || []).map(u => `<option value="${u.id}" data-name="${u.name}">${u.name}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="label">DUE DATE</label>
                <input type="date" id="del-due" class="input" value="${todayISO()}" />
              </div>
            </div>
            <!-- Doer-defined due date checkbox -->
            <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
              <input type="checkbox" id="del-doer-date" style="width:14px;height:14px;accent-color:#C4714A;cursor:pointer;" />
              <label for="del-doer-date" style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;cursor:pointer;">Doer-Defined Due Date</label>
            </div>
            <!-- Row 2: Priority | Approval Required -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label class="label">PRIORITY</label>
                <select id="del-priority" class="input">
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div>
                <label class="label">APPROVAL REQUIRED</label>
                <select id="del-approval" class="input">
                  <option value="No Approval">No Approval</option>
                  <option value="Approval Required">Approval Required</option>
                </select>
              </div>
            </div>
            <!-- Description -->
            <div>
              <label class="label">DESCRIPTION</label>
              <textarea id="del-desc" rows="3" class="input" style="resize:vertical;" placeholder="Enter task description..."></textarea>
            </div>
            <!-- URL -->
            <div>
              <label class="label">URL <span style="font-size:10px;color:#94a3b8;font-weight:400;text-transform:none;">(OPTIONAL)</span></label>
              <input type="url" id="del-url" class="input" placeholder="https://docs.google.com/..." />
            </div>
            <!-- Remarks -->
            <div>
              <label class="label">REMARKS</label>
              <textarea id="del-remarks" rows="2" class="input" style="resize:vertical;" placeholder="Any remarks..."></textarea>
            </div>
            <p id="del-error" style="color:#dc2626;font-size:12px;display:none;margin:0;"></p>
          </div>
          <!-- Footer buttons -->
          <div class="modal-footer" style="justify-content:space-between;">
            <button id="modal-delegate-cancel" class="btn-secondary">Close</button>
            <button id="modal-delegate-submit" class="btn-primary">Assign</button>
          </div>
          <!-- Bulk CSV upload -->
          <div style="border-top:1px solid #f1f5f9;padding:12px 20px 16px;background:#fafafa;">
            <p style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;text-align:center;margin:0 0 10px;">OR BULK UPLOAD CSV</p>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <input type="file" id="del-csv-file" accept=".csv" style="font-size:12px;flex:1;min-width:0;" />
              <button id="del-csv-upload" style="padding:6px 14px;border-radius:7px;background:#10b981;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;white-space:nowrap;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Upload CSV
              </button>
              <a href="/api/samples/delegation" download style="padding:6px 14px;border-radius:7px;background:#fff;color:#374151;border:1.5px solid #e2e8f0;cursor:pointer;font-size:12px;font-weight:700;text-decoration:none;display:flex;align-items:center;gap:5px;white-space:nowrap;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                Sample
              </a>
            </div>
            <p style="font-size:10.5px;color:#94a3b8;margin:8px 0 0;">Format: doer_email, approver_email, due_date, priority, approval, description, remarks, client_name</p>
          </div>
        </div>
      </div>

      <!-- ── Add Checklist Master Modal ── -->
      <div id="modal-checklist" class="modal-overlay" style="display:none;">
        <div class="modal-box" style="max-width:520px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2 style="font-size:15px;font-weight:700;margin:0;flex:1;">+ Add Checklist Task</h2>
            <button id="modal-checklist-close" style="width:28px;height:28px;border-radius:50%;background:var(--border-light);border:none;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
            <!-- Select Employee -->
            <div>
              <label class="label">SELECT EMPLOYEE</label>
              <select id="chk-assigned" class="input">
                <option value="">Select Employee</option>
                ${(users || []).map(u => `<option value="${u.id}" data-email="${u.email}" data-name="${u.name}">${u.name}</option>`).join('')}
              </select>
            </div>
            <!-- Frequency -->
            <div>
              <label class="label">FREQUENCY</label>
              <select id="chk-frequency" class="input">
                <option value="daily">Daily (365 tasks/year)</option>
                <option value="alternative_week">Alternative Week (26 tasks/year)</option>
                <option value="weekly">Weekly (52 tasks/year)</option>
                <option value="monthly">Monthly (12 tasks/year)</option>
                <option value="quarterly">Quarterly (4 tasks/year)</option>
                <option value="yearly">Yearly (1 task/year)</option>
              </select>
            </div>
            <!-- Due Date | End Date -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label class="label">DUE DATE</label>
                <input type="date" id="chk-start" class="input" value="${todayISO()}" />
              </div>
              <div>
                <label class="label">END DATE <span style="font-size:10px;color:#94a3b8;font-weight:400;text-transform:none;">(OPTIONAL)</span></label>
                <input type="date" id="chk-end" class="input" />
              </div>
            </div>
            <!-- Task Name / Description -->
            <div>
              <label class="label">TASK NAME / DESCRIPTION</label>
              <input type="text" id="chk-task" class="input" placeholder="Enter task name..." />
            </div>
            <!-- Remarks -->
            <div>
              <label class="label">REMARKS</label>
              <input type="text" id="chk-remarks" class="input" placeholder="Any remarks..." />
            </div>
            <p id="chk-error" style="color:#dc2626;font-size:12px;display:none;margin:0;"></p>
          </div>
          <!-- Footer buttons -->
          <div class="modal-footer" style="justify-content:space-between;">
            <button id="modal-checklist-cancel" class="btn-secondary">Close</button>
            <button id="modal-checklist-submit" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 18px;border-radius:8px;font-size:12.5px;font-weight:600;background:#2563eb;color:#fff;border:none;cursor:pointer;">
              Generate Tasks
            </button>
          </div>
          <!-- Bulk CSV upload -->
          <div style="border-top:1px solid #f1f5f9;padding:12px 20px 16px;background:#fafafa;">
            <p style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;text-align:center;margin:0 0 10px;">OR BULK UPLOAD CSV</p>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <input type="file" id="chk-csv-file" accept=".csv" style="font-size:12px;flex:1;min-width:0;" />
              <button id="chk-csv-upload" style="padding:6px 14px;border-radius:7px;background:#10b981;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;white-space:nowrap;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Upload CSV
              </button>
              <a href="/api/samples/checklist-bulk" download style="padding:6px 14px;border-radius:7px;background:#fff;color:#374151;border:1.5px solid #e2e8f0;cursor:pointer;font-size:12px;font-weight:700;text-decoration:none;display:flex;align-items:center;gap:5px;white-space:nowrap;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                Sample
              </a>
            </div>
            <p style="font-size:10.5px;color:#94a3b8;margin:8px 0 0;">Format: user_email, frequency (daily/weekly/monthly/yearly/quarterly/alternative_week), start_date, description, remarks — tasks auto-generate!</p>
          </div>
        </div>
      </div>

      <!-- ── Holidays Modal ── -->
      <div id="modal-holidays" class="modal-overlay" style="display:none;">
        <div class="modal-box" style="max-width:520px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            <h2 style="font-size:15px;font-weight:700;margin:0;flex:1;padding-left:8px;">Holidays</h2>
            <button id="modal-holidays-close" style="width:28px;height:28px;border-radius:50%;background:var(--border-light);border:none;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body" style="max-height:65vh;overflow-y:auto;">
            <!-- Add holiday form -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label class="label">DATE</label>
                <input type="date" id="hol-date" class="input" />
              </div>
              <div>
                <label class="label">HOLIDAY NAME</label>
                <input type="text" id="hol-name" class="input" placeholder="e.g. Diwali" />
              </div>
            </div>
            <button id="hol-add-btn" style="width:100%;padding:9px;border-radius:8px;font-size:13px;font-weight:700;background:#2563eb;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
              + Add Holiday
            </button>
            <p id="hol-error" style="color:#dc2626;font-size:12px;display:none;margin:0;"></p>
            <!-- Bulk CSV section -->
            <div style="border:1.5px dashed #f59e0b;border-radius:10px;background:#fffbeb;padding:14px 16px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#f59e0b"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span style="font-size:13px;font-weight:700;color:#92400e;">Bulk Upload (CSV)</span>
              </div>
              <p style="font-size:11.5px;color:#92400e;margin:0 0 10px;">Format: date,name per line — date as YYYY-MM-DD or DD-MM-YYYY</p>
              <a href="/api/samples/holiday" download style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:7px;background:#fff;color:#374151;border:1.5px solid #e2e8f0;font-size:12px;font-weight:700;text-decoration:none;margin-bottom:10px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                Sample
              </a>
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="file" id="hol-csv-file" accept=".csv" style="font-size:12px;flex:1;min-width:0;" />
                <button id="hol-csv-upload" style="padding:6px 16px;border-radius:7px;background:#10b981;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px;white-space:nowrap;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Upload CSV
                </button>
              </div>
            </div>
            <!-- Holiday list -->
            <div>
              <p style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2563eb;margin:0 0 8px;">HOLIDAY LIST</p>
              <div id="hol-list"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button id="modal-holidays-done" class="btn-secondary" style="width:100%;justify-content:center;">Close</button>
          </div>
        </div>
      </div>

      <!-- ── Shift Modal ── -->
      <div id="modal-revise" class="modal-overlay" style="display:none;">
        <div class="modal-box" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div id="revise-modal-icon" style="width:36px;height:36px;border-radius:10px;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M3 8a9 9 0 1 0 2.6-5.6L3 8"/></svg>
            </div>
            <div style="flex:1;">
              <h2 style="font-size:14px;font-weight:700;margin:0;">Shift Task</h2>
              <p style="font-size:11.5px;color:#64748b;margin:2px 0 0;">Mark this task as shifted with an optional new date</p>
            </div>
            <button id="modal-revise-close" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:4px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div id="revise-task-info" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12.5px;"></div>
            <div id="revise-date-wrap">
              <label class="label">Shift until <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
              <input type="date" id="revise-date-input" class="input" />
            </div>
            <div id="revise-note-wrap">
              <label class="label">Note <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
              <textarea id="revise-note-input" rows="3" class="input" style="resize:none;" placeholder="Why is this being shifted?"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button id="modal-revise-cancel" class="btn-secondary">Cancel</button>
            <button id="modal-revise-confirm" class="db-btn-warn">Confirm Shift</button>
          </div>
        </div>
      </div>

      <!-- ── Transfer Modal ── -->
      <div id="modal-transfer" class="modal-overlay" style="display:none;">
        <div class="modal-box" style="max-width:460px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            <h2 style="font-size:15px;font-weight:700;margin:0;flex:1;padding-left:8px;">Transfer Tasks</h2>
            <button id="modal-transfer-close" style="width:28px;height:28px;border-radius:50%;background:var(--border-light);border:none;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div>
              <label class="label">FROM (Current Doer)</label>
              <select id="tr-from" class="input">
                <option value="">— Select Employee —</option>
                ${(users || []).map(u => `<option value="${u.id}" data-name="${u.name}">${u.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="label">TO (New Doer)</label>
              <select id="tr-to" class="input">
                <option value="">— Select Employee —</option>
                ${(users || []).map(u => `<option value="${u.id}" data-name="${u.name}">${u.name}</option>`).join('')}
              </select>
            </div>
            <div style="background:#f8fafc;border-radius:8px;padding:10px 12px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;color:#374151;">
                <input type="checkbox" id="tr-all" style="width:14px;height:14px;accent-color:#7c3aed;" />
                Transfer ALL pending tasks (not just selected employee's)
              </label>
            </div>
            <p id="tr-error" style="color:#dc2626;font-size:12px;display:none;margin:0;"></p>
          </div>
          <div class="modal-footer" style="justify-content:space-between;">
            <button id="modal-transfer-cancel" class="btn-secondary">Close</button>
            <button id="modal-transfer-submit" style="display:inline-flex;align-items:center;gap:6px;padding:7px 18px;border-radius:8px;font-size:12.5px;font-weight:700;background:#7c3aed;color:#fff;border:none;cursor:pointer;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              Transfer
            </button>
          </div>
        </div>
      </div>
    `;

    _updateTasksTable(admin);
    _attachEvents(el, admin);

    /* Mobile: show title row, hide desktop topbar row */
    function _applyMobileLayout() {
      const isMobile = window.innerWidth < 768;
      const titleRow = el.querySelector('#db-title-row');
      const btnRow   = el.querySelector('#db-btn-row');
      const topbar   = el.querySelector('#db-topbar');
      if (isMobile) {
        if (titleRow) titleRow.style.display = 'flex';
        /* move emp picker into mobile title row */
        if (admin) {
          const mobilePicker = el.querySelector('#db-emp-picker-mobile');
          const picker       = el.querySelector('#db-emp-picker');
          if (mobilePicker && picker && !mobilePicker.hasChildNodes()) mobilePicker.appendChild(picker);
        }
      } else {
        if (titleRow) titleRow.style.display = 'none';
      }
    }
    _applyMobileLayout();
    window.addEventListener('resize', _applyMobileLayout);
  }

  /* ── pie chart svg ───────────────────────────────────────────────── */
  function renderPieSVG(completed, pending, revised, upcoming) {
    const size = 200;
    const cx = size / 2, cy = size / 2, r = size / 2 - 6;
    const allSlices = [
      { value: completed,        color: '#10b981', label: 'Completed' },
      { value: pending - (upcoming||0), color: '#ef4444', label: 'Pending'   },
      { value: revised,          color: '#f59e0b', label: 'Shifted'   },
      { value: upcoming || 0,    color: '#7c3aed', label: 'Upcoming'  },
    ];
    const slices = allSlices.filter(s => s.value > 0);
    const total = slices.reduce((a, s) => a + s.value, 0);

    let paths = '';
    if (total === 0) {
      paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#e2e8f0"/>`;
    } else if (slices.length === 1) {
      paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${slices[0].color}" stroke="#fff" stroke-width="2"/>`;
    } else {
      let angle = -Math.PI / 2;
      slices.forEach(s => {
        const sweep = (s.value / total) * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        angle += sweep;
        const x2 = cx + r * Math.cos(angle);
        const y2 = cy + r * Math.sin(angle);
        const largeArc = sweep > Math.PI ? 1 : 0;
        paths += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
      });
    }

    const legend = allSlices.map(s => `
      <div style="display:flex;align-items:center;gap:5px;font-size:11.5px;color:#475569;">
        <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0;"></span>
        <span>${s.label}</span>
      </div>`).join('');

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 16px;margin-top:12px;">${legend}</div>`;
  }

  /* ── tasks table update ──────────────────────────────────────────── */
  function _updateTasksTable(admin) {
    const filtered = getFiltered();
    const table = document.getElementById('db-tasks-table');
    const countEl = document.getElementById('db-tasks-count');
    if (!table) return;

    const countLabel = _state.subTab === 'Completed' ? 'completed' : _state.subTab === 'Shifted' ? 'shifted' : 'awaiting action';
    if (countEl) countEl.textContent = `${filtered.length} ${countLabel}`;

    /* update tab button styles */
    document.querySelectorAll('.db-tab-btn').forEach(btn => {
      const active = btn.dataset.tab === _state.subTab;
      btn.style.background = active ? '#fff' : 'transparent';
      btn.style.color       = active ? '#0f172a' : '#64748b';
      btn.style.boxShadow   = active ? '0 1px 4px rgba(0,0,0,.08)' : 'none';
    });

    /* update stat card active state */
    document.querySelectorAll('.db-stat-card[data-filter]').forEach(card => {
      card.classList.toggle('active', card.dataset.filter === _state.subTab);
    });

    if (filtered.length === 0) {
      table.innerHTML = `
        <tbody><tr><td colspan="6" style="padding:3rem;text-align:center;">
          <div style="width:44px;height:44px;border-radius:14px;background:#ecfdf5;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
          </div>
          <div style="font-size:13px;font-weight:600;color:#334155;">${_state.subTab === 'Completed' || _state.subTab === 'Shifted' ? 'Nothing here' : 'All caught up!'}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:3px;">${_state.subTab === 'Completed' ? 'No completed tasks yet.' : _state.subTab === 'Shifted' ? 'No shifted tasks.' : 'No pending tasks.'}</div>
        </td></tr></tbody>`;
      return;
    }

    const thStyle = 'text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#64748b;background:rgba(248,250,252,.97);position:sticky;top:0;';
    const tdStyle = 'padding:10px 12px;font-size:12.5px;color:#475569;border-top:1px solid #f1f5f9;';

    const rows = sortDashTasks(filtered).map(t => {
      const dateStyle = t.overdue ? 'color:#dc2626;font-weight:700;' : 'color:#475569;';
      const urlLink = t.url ? `<a href="${t.url}" target="_blank" rel="noopener noreferrer" title="${t.url}" style="color:#C4714A;flex-shrink:0;display:inline-flex;margin-left:4px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : '';
      const transferred = t.transferredFrom ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 6px;border-radius:5px;background:#fffbeb;color:#b45309;border:1px solid #fde68a;font-weight:600;" title="${t.transferredBy ? 'Transferred by ' + t.transferredBy : ''}">🔄 from ${t.transferredFrom}</span>` : '';

      let actionHTML;
      if (t.status === 'done') {
        actionHTML = `<span style="color:#059669;font-weight:600;font-size:11.5px;">✓ Completed</span>
          <button class="pill-act pill-deny" data-action="reopen" data-id="${t.id}">Reopen</button>`;
      } else {
        actionHTML = `<button class="pill-act pill-done" data-action="done" data-id="${t.id}">Done</button>`;
        if (t.type === 'Delegation') {
          actionHTML += ` <button class="pill-act pill-revise" data-action="shift" data-id="${t.id}">Shift</button>`;
        }
      }

      return `<tr style="transition:background .1s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td style="${tdStyle}">${typePillHTML(t.type)}</td>
        <td style="${tdStyle}max-width:260px;">
          <div style="display:flex;align-items:flex-start;gap:4px;">
            <span style="font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;" title="${t.description}">${t.description}</span>
            ${urlLink}
          </div>
          ${t.type === 'Checklist' && (t.frequency || t.department) ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${[t.frequency ? t.frequency.charAt(0).toUpperCase() + t.frequency.slice(1) : '', t.department].filter(Boolean).join(' · ')}</div>` : ''}
          ${transferred}
        </td>
        <td style="${tdStyle}">
          <div style="display:flex;align-items:center;gap:6px;">
            ${avatarHTML(t.doer)}
            <span style="color:#334155;">${t.doer || '—'}</span>
          </div>
        </td>
        <td style="${tdStyle}">${priorityHTML(t.type, t.priority)}</td>
        <td style="${tdStyle}white-space:nowrap;font-size:12px;${dateStyle}">${fmt(t.date)}</td>
        <td style="${tdStyle}">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${actionHTML}
          </div>
        </td>
      </tr>`;
    }).join('');

    const sortTh = (col, label) =>
      `<th class="db-th-sort" data-sort="${col}" style="${thStyle}cursor:pointer;user-select:none;" title="Sort by ${label}">${label}${dashSortIndicator(col)}</th>`;

    table.innerHTML = `
      <thead>
        <tr>
          ${sortTh('type', 'Type')}
          ${sortTh('description', 'Description')}
          ${sortTh('doer', 'Doer')}
          ${sortTh('priority', 'Priority')}
          ${sortTh('date', 'Date')}
          <th style="${thStyle}">Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>`;

    /* sortable column headers */
    table.querySelectorAll('.db-th-sort').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (_state.sortCol === col) { _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc'; }
        else { _state.sortCol = col; _state.sortDir = 'asc'; }
        _updateTasksTable(admin);
      });
    });

    /* attach action button events */
    table.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const task = _state.data.pendingTasks.find(t => t.id === id);
        if (!task) return;
        const action = btn.dataset.action;
        if (action === 'done')   markDone(task, admin);
        if (action === 'shift')  openShiftModal(task, admin);
        if (action === 'reopen') reopenTask(task, admin);
      });
    });
  }

  /* ── holidays list render ────────────────────────────────────────── */
  function _renderHolidayList() {
    const listEl = document.getElementById('hol-list');
    if (!listEl) return;
    const holidays = (_state.holidays || []).slice().sort((a, b) => a.date > b.date ? 1 : -1);
    if (holidays.length === 0) {
      listEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;text-align:center;padding:1rem;">No holidays added yet.</div>';
      return;
    }
    listEl.innerHTML = holidays.map(h => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:13px;font-weight:700;color:#0f172a;">${fmt(h.date)}</span>
        <span style="font-size:13px;color:#475569;flex:1;padding:0 12px;">— ${h.name}</span>
        <button data-hol-del="${h.id}" style="padding:3px 10px;border-radius:6px;background:#fff0f0;color:#ef4444;border:1px solid #fecaca;font-size:11.5px;font-weight:600;cursor:pointer;">Remove</button>
      </div>`).join('');

    listEl.querySelectorAll('[data-hol-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.holDel;
        if (!await Utils.showConfirm('Remove this holiday from the list?', { title: 'Delete Holiday', confirmText: 'Delete', danger: true })) return;
        await Utils.apiFetch(`/api/holidays?id=${id}`, { method: 'DELETE' });
        _state.holidays = _state.holidays.filter(h => h.id !== id);
        _renderHolidayList();
      });
    });
  }

  /* ── shift modal open ───────────────────────────────────────────── */
  function openShiftModal(task, admin) {
    _state.reviseTask = { ...task, _mode: 'shift' };
    _state.reviseNote = '';
    _state.reviseDate = '';

    const infoEl = document.getElementById('revise-task-info');
    if (infoEl) {
      infoEl.innerHTML = `
        <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${task.description}</div>
        <div style="font-size:12px;color:#64748b;">Doer: <b style="color:#334155;">${task.doer}</b></div>`;
    }

    const dateInput = document.getElementById('revise-date-input');
    const noteInput = document.getElementById('revise-note-input');
    if (dateInput) { dateInput.min = todayISO(); dateInput.value = ''; }
    if (noteInput) { noteInput.value = ''; }

    showModal('modal-revise');
  }

  /* ── event attachments ───────────────────────────────────────────── */
  /* ── Help Ticket quick modal ─────────────────────────────────────── */
  async function _openHelpTicketModal() {
    const existing = document.getElementById('db-ht-modal');
    if (existing) existing.remove();
    const userName = window.currentUser?.name || '';
    const today = new Date().toISOString().slice(0,10);
    let userOpts = `<option value="${userName}">${userName}</option>`;
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const users = await res.json();
        userOpts = users
          .filter(u => u.active !== false)
          .sort((a, b) => (a.name||'').localeCompare(b.name||''))
          .map(u => `<option value="${u.name||''}" ${u.name===userName?'selected':''}>${u.name||u.email}</option>`)
          .join('');
      }
    } catch {}
    const html = `
      <div id="db-ht-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:440px;overflow:hidden;" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:10px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;color:#0f172a;">Raise Help Ticket</div>
                <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">Submit your issue to the admin team</div>
              </div>
            </div>
            <button id="db-ht-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Ticket For</label>
                <select id="db-ht-name" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;">
                  ${userOpts}
                </select>
              </div>
              <div>
                <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Filed By</label>
                <input id="db-ht-filed-by" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;outline:none;box-sizing:border-box;background:#f8fafc;" value="${userName}" placeholder="Filed by" readonly />
              </div>
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Issue <span style="color:#ef4444">*</span></label>
              <textarea id="db-ht-issue" rows="3" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;resize:none;box-sizing:border-box;" placeholder="Describe your issue clearly..."></textarea>
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Date <span style="color:#ef4444">*</span></label>
              <input id="db-ht-date" type="date" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;" value="${today}" />
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Priority</label>
              <select id="db-ht-priority" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;">
                <option value="Medium" selected>Medium</option>
                <option value="High">High</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div id="db-ht-err" style="display:none;font-size:12px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:7px;padding:8px 12px;"></div>
          </div>
          <div style="padding:16px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="db-ht-cancel" class="btn-secondary">Cancel</button>
            <button id="db-ht-submit" class="btn-primary">Submit Ticket</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const closeModal = () => { document.getElementById('db-ht-modal')?.remove(); };
    document.getElementById('db-ht-modal').addEventListener('click', closeModal);
    document.getElementById('db-ht-close').addEventListener('click', closeModal);
    document.getElementById('db-ht-cancel').addEventListener('click', closeModal);
    document.getElementById('db-ht-issue')?.focus();

    document.getElementById('db-ht-submit').addEventListener('click', async () => {
      const name     = document.getElementById('db-ht-name')?.value.trim();
      const issue    = document.getElementById('db-ht-issue')?.value.trim();
      const date     = document.getElementById('db-ht-date')?.value;
      const priority = document.getElementById('db-ht-priority')?.value;
      const errEl    = document.getElementById('db-ht-err');
      const btn      = document.getElementById('db-ht-submit');

      if (!issue) { errEl.textContent = 'Please describe your issue.'; errEl.style.display = 'block'; return; }
      if (!date)  { errEl.textContent = 'Please select a date.';       errEl.style.display = 'block'; return; }
      errEl.style.display = 'none';

      btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        const filedBy = document.getElementById('db-ht-filed-by')?.value.trim();
        await Utils.apiFetch('/api/help-tickets', {
          method: 'POST',
          body: JSON.stringify({ name, filedBy, subject: issue, date, priority }),
        });
        closeModal();
        Utils.showToast('Help ticket submitted!', 'success');
      } catch (e) {
        errEl.textContent = e.message || 'Failed to submit ticket.';
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Submit Ticket';
      }
    });
  }

  /* ── Announcement quick modal ────────────────────────────────────── */
  function _openAnnouncementModal(admin) {
    if (!admin) { Utils.showToast('Only Admin/HOD can post announcements', 'error'); return; }
    const existing = document.getElementById('db-ann-modal');
    if (existing) existing.remove();
    const html = `
      <div id="db-ann-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:440px;overflow:hidden;" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:10px;background:#ede9fe;color:#7c3aed;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;color:#0f172a;">Post Announcement</div>
                <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">Visible to all employees</div>
              </div>
            </div>
            <button id="db-ann-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Title <span style="color:#ef4444">*</span></label>
              <input id="db-ann-title" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;" placeholder="Announcement title" />
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Message <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
              <textarea id="db-ann-message" rows="4" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;resize:none;box-sizing:border-box;" placeholder="Write the announcement details..."></textarea>
            </div>
            <div id="db-ann-err" style="display:none;font-size:12px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:7px;padding:8px 12px;"></div>
          </div>
          <div style="padding:16px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="db-ann-cancel" class="btn-secondary">Cancel</button>
            <button id="db-ann-submit" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;background:#8b5cf6;color:#fff;border:none;cursor:pointer;">Post Announcement</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const closeModal = () => { document.getElementById('db-ann-modal')?.remove(); };
    document.getElementById('db-ann-modal').addEventListener('click', closeModal);
    document.getElementById('db-ann-close').addEventListener('click', closeModal);
    document.getElementById('db-ann-cancel').addEventListener('click', closeModal);
    document.getElementById('db-ann-title')?.focus();

    document.getElementById('db-ann-submit').addEventListener('click', async () => {
      const title   = document.getElementById('db-ann-title')?.value.trim();
      const message = document.getElementById('db-ann-message')?.value.trim();
      const errEl   = document.getElementById('db-ann-err');
      const btn     = document.getElementById('db-ann-submit');

      if (!title) { errEl.textContent = 'Title is required.'; errEl.style.display = 'block'; return; }
      errEl.style.display = 'none';

      btn.disabled = true; btn.textContent = 'Posting…';
      try {
        await Utils.apiFetch('/api/announcements', {
          method: 'POST',
          body: JSON.stringify({ title, message }),
        });
        closeModal();
        Utils.showToast('Announcement posted!', 'success');
      } catch (e) {
        errEl.textContent = e.message || 'Failed to post announcement.';
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Post Announcement';
      }
    });
  }

  function _attachEvents(el, admin) {

    /* ── tab buttons ── */
    el.querySelectorAll('.db-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _state.subTab = btn.dataset.tab;
        _updateTasksTable(admin);
      });
    });

    /* ── stat cards (click to filter the tasks table) ── */
    el.querySelectorAll('.db-stat-card[data-filter]').forEach(card => {
      card.addEventListener('click', () => {
        _state.subTab = card.dataset.filter;
        _updateTasksTable(admin);
        document.getElementById('db-tasks-table')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    /* ── user filter ── */
    /* ── custom employee picker ── */
    const empTrigger  = el.querySelector('#db-emp-trigger');
    const empDropdown = el.querySelector('#db-emp-dropdown');
    const empSearch   = el.querySelector('#db-emp-search');
    const empLabel    = el.querySelector('#db-emp-label');
    const empList     = el.querySelector('#db-emp-list');

    async function setEmpFilter(val, label) {
      _state.userFilter = val;
      if (empLabel) empLabel.textContent = label.length > 28 ? label.slice(0,28)+'…' : label;
      if (empDropdown) empDropdown.style.display = 'none';
      /* highlight selected */
      if (empList) empList.querySelectorAll('.db-emp-opt').forEach(o => {
        o.style.background = o.dataset.empVal === val ? '#f0f9ff' : '';
        o.style.fontWeight = o.dataset.empVal === val ? '700' : '';
      });
      /* re-fetch from server with doer filter */
      try {
        const url = val === 'All' ? '/api/dashboard' : `/api/dashboard?doer=${encodeURIComponent(val)}`;
        const newData = await Utils.apiFetch(url);
        if (newData) {
          _state.data = newData;
          /* update stat cards */
          const statTotal     = el.querySelector('#db-stat-total');
          const statCompleted = el.querySelector('#db-stat-completed');
          const statPending   = el.querySelector('#db-stat-pending');
          const statUpcoming  = el.querySelector('#db-stat-upcoming');
          const statRevised   = el.querySelector('#db-stat-revised');
          if (statTotal)     statTotal.textContent     = newData.total;
          if (statCompleted) statCompleted.textContent = newData.completed;
          if (statPending)   statPending.textContent   = newData.pending || newData.pendingTasks.length;
          if (statUpcoming)  statUpcoming.textContent  = newData.upcoming || 0;
          if (statRevised) {
            statRevised.textContent = newData.revised > 0 ? `+ ${newData.revised} shifted` : '';
            statRevised.style.display = newData.revised > 0 ? '' : 'none';
          }
          /* update pie chart */
          const pieEl = el.querySelector('#db-pie-container');
          if (pieEl) pieEl.innerHTML = renderPieSVG(newData.completed, newData.pending || newData.pendingTasks.length, newData.revised, newData.upcoming || 0);
        }
      } catch(e) { /* fallback to client filter */ }
      _updateTasksTable(admin);
    }

    if (empTrigger) {
      empTrigger.addEventListener('click', e => {
        e.stopPropagation();
        const open = empDropdown.style.display === 'block';
        empDropdown.style.display = open ? 'none' : 'block';
        if (!open && empSearch) { empSearch.value = ''; empSearch.focus(); _filterEmpList(''); }
      });
    }

    function _filterEmpList(q) {
      if (!empList) return;
      empList.querySelectorAll('.db-emp-opt').forEach(o => {
        const label = (o.dataset.empLabel || o.textContent).toLowerCase();
        o.style.display = (!q || label.includes(q.toLowerCase())) ? '' : 'none';
      });
    }

    if (empSearch) empSearch.addEventListener('input', () => _filterEmpList(empSearch.value));

    if (empList) {
      empList.addEventListener('click', e => {
        const opt = e.target.closest('.db-emp-opt');
        if (!opt) return;
        setEmpFilter(opt.dataset.empVal, opt.dataset.empLabel || opt.textContent.trim());
      });
    }

    /* close on outside click */
    document.addEventListener('click', function _outsideClose(e) {
      const picker = el.querySelector('#db-emp-picker');
      if (picker && !picker.contains(e.target)) {
        if (empDropdown) empDropdown.style.display = 'none';
      }
    });

    /* hover style for options */
    if (empList) {
      empList.addEventListener('mouseover', e => { const o = e.target.closest('.db-emp-opt'); if (o && o.dataset.empVal !== _state.userFilter) o.style.background = '#f8fafc'; });
      empList.addEventListener('mouseout',  e => { const o = e.target.closest('.db-emp-opt'); if (o && o.dataset.empVal !== _state.userFilter) o.style.background = ''; });
    }

    /* ── delegate modal ── */
    function resetDelegateForm() {
      ['#del-doer','#del-due','#del-priority','#del-approval','#del-desc','#del-url','#del-remarks'].forEach(id => {
        const f = el.querySelector(id);
        if (!f) return;
        if (f.tagName === 'SELECT') f.selectedIndex = 0;
        else f.value = id === '#del-due' ? todayISO() : '';
      });
      const chk = el.querySelector('#del-doer-date');
      if (chk) chk.checked = false;
      const err = el.querySelector('#del-error');
      if (err) { err.textContent = ''; err.style.display = 'none'; }
    }
    const btnDelegate = el.querySelector('#db-btn-delegate');
    if (btnDelegate) btnDelegate.addEventListener('click', () => { resetDelegateForm(); showModal('modal-delegate'); });
    el.querySelector('#modal-delegate-close')?.addEventListener('click', () => hideModal('modal-delegate'));
    el.querySelector('#modal-delegate-cancel')?.addEventListener('click', () => hideModal('modal-delegate'));
    el.querySelector('#modal-delegate')?.addEventListener('click', () => hideModal('modal-delegate'));
    el.querySelector('#modal-delegate-submit')?.addEventListener('click', async () => {
      const desc      = el.querySelector('#del-desc')?.value.trim();
      const doerSel   = el.querySelector('#del-doer');
      const doerId    = doerSel?.value;
      const doerName  = doerSel?.selectedOptions[0]?.dataset.name || '';
      const dueDate   = el.querySelector('#del-due')?.value;
      const priority  = el.querySelector('#del-priority')?.value || 'Low';
      const approval  = el.querySelector('#del-approval')?.value || 'No Approval';
      const url       = el.querySelector('#del-url')?.value.trim();
      const remarks   = el.querySelector('#del-remarks')?.value.trim();
      const errEl     = el.querySelector('#del-error');

      if (!doerId)  { if (errEl) { errEl.textContent = 'Please select a doer.'; errEl.style.display = 'block'; } return; }
      if (!dueDate) { if (errEl) { errEl.textContent = 'Due date is required.';  errEl.style.display = 'block'; } return; }
      if (errEl) errEl.style.display = 'none';

      const submitBtn = el.querySelector('#modal-delegate-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Assigning…'; }

      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'POST',
          body: JSON.stringify({
            description: desc || '',
            doerId, doerName,
            delegatedBy: window.currentUser?.id,
            dueDate, priority, approval,
            url: url || '',
            remarks: remarks || '',
          }),
        });
        hideModal('modal-delegate');
        resetDelegateForm();
        Utils.showToast('Task delegated successfully!');
        await _refresh(admin);
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed to add task.'; errEl.style.display = 'block'; }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Assign'; }
      }
    });

    /* CSV bulk upload */
    el.querySelector('#del-csv-upload')?.addEventListener('click', async () => {
      const fileInput = el.querySelector('#del-csv-file');
      const file = fileInput?.files?.[0];
      if (!file) { Utils.showToast('Please choose a CSV file first.', 'error'); return; }
      const text = (await file.text()).replace(/^﻿/, '');
      const lines = text.trim().split('\n').filter(Boolean);
      const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
      const rows = lines.slice(1);
      let ok = 0, fail = 0;
      for (const row of rows) {
        const cols = parseCsvLine(row).map(c => c.trim());
        const obj = {};
        headers.forEach((h, i) => obj[h] = cols[i] || '');
        try {
          const allUsers = _state.users || [];
          const doerEmail = (obj['doer_email'] || '').toLowerCase();
          const doer = allUsers.find(u => (u.email || '').toLowerCase() === doerEmail);
          if (!doer) { fail++; continue; }
          await Utils.apiFetch('/api/delegations', {
            method: 'POST',
            body: JSON.stringify({
              description: obj['description'] || '',
              doerId: doer.id, doerName: doer.name,
              delegatedBy: window.currentUser?.id,
              dueDate: obj['due_date'] || todayISO(),
              priority: obj['priority'] || 'Low',
              approval: obj['approval'] === 'yes' ? 'Approval Required' : 'No Approval',
              client: obj['client_name'] || '',
              remarks: obj['remarks'] || '',
              url: '',
            }),
          });
          ok++;
        } catch { fail++; }
      }
      hideModal('modal-delegate');
      Utils.showToast(`${ok} tasks uploaded${fail ? `, ${fail} failed` : ''}`, fail ? 'warning' : 'success');
      await _refresh(admin);
    });

    /* ── checklist modal ── */
    function resetChecklistForm() {
      ['#chk-assigned','#chk-frequency','#chk-start','#chk-end','#chk-task','#chk-remarks'].forEach(id => {
        const f = el.querySelector(id);
        if (!f) return;
        if (f.tagName === 'SELECT') f.selectedIndex = 0;
        else f.value = id === '#chk-start' ? todayISO() : '';
      });
      const err = el.querySelector('#chk-error');
      if (err) { err.textContent = ''; err.style.display = 'none'; }
      const csvFile = el.querySelector('#chk-csv-file');
      if (csvFile) csvFile.value = '';
    }
    const btnChecklist = el.querySelector('#db-btn-checklist');
    if (btnChecklist) btnChecklist.addEventListener('click', () => { resetChecklistForm(); showModal('modal-checklist'); });

    const btnHelpTicket = el.querySelector('#db-btn-help-ticket');
    if (btnHelpTicket) btnHelpTicket.addEventListener('click', () => _openHelpTicketModal());

    const btnAnnouncement = el.querySelector('#db-btn-announcement');
    if (btnAnnouncement) btnAnnouncement.addEventListener('click', () => _openAnnouncementModal(admin));
    el.querySelector('#modal-checklist-close')?.addEventListener('click', () => hideModal('modal-checklist'));
    el.querySelector('#modal-checklist-cancel')?.addEventListener('click', () => hideModal('modal-checklist'));
    el.querySelector('#modal-checklist')?.addEventListener('click', () => hideModal('modal-checklist'));
    el.querySelector('#modal-checklist-submit')?.addEventListener('click', async () => {
      const task       = el.querySelector('#chk-task')?.value.trim();
      const userSel    = el.querySelector('#chk-assigned');
      const userId     = userSel?.value;
      const userName   = userSel?.selectedOptions[0]?.dataset.name || '';
      const frequency  = el.querySelector('#chk-frequency')?.value || 'daily';
      const startDate  = el.querySelector('#chk-start')?.value || todayISO();
      const endDate    = el.querySelector('#chk-end')?.value || '';
      const remarks    = el.querySelector('#chk-remarks')?.value.trim() || '';
      const errEl      = el.querySelector('#chk-error');

      if (!task)   { if (errEl) { errEl.textContent = 'Task name is required.'; errEl.style.display = 'block'; } return; }
      if (!userId) { if (errEl) { errEl.textContent = 'Please select an employee.'; errEl.style.display = 'block'; } return; }
      if (errEl) errEl.style.display = 'none';

      const submitBtn = el.querySelector('#modal-checklist-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Generating…'; }

      try {
        await Utils.apiFetch('/api/masters', {
          method: 'POST',
          body: JSON.stringify({ task, assignedTo: userName, frequency, startDate, endDate: endDate || null, remarks }),
        });
        hideModal('modal-checklist');
        Utils.showToast('Checklist tasks generated!');
        await _refresh(admin);
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed to generate tasks.'; errEl.style.display = 'block'; }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Generate Tasks'; }
      }
    });

    /* checklist CSV bulk upload */
    el.querySelector('#chk-csv-upload')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      const fileInput = el.querySelector('#chk-csv-file');
      const file = fileInput?.files?.[0];
      if (!file) { Utils.showToast('Please choose a CSV file first.', 'error'); return; }
      btn.disabled = true;
      const btnOrigHtml = btn.innerHTML;
      btn.textContent = 'Uploading…';
      const HEADER_ALIASES = {
        email: 'user_email', 'user email': 'user_email',
        task: 'description', 'task name': 'description', 'task name / description': 'description', 'task/description': 'description',
        'next due date': 'start_date', 'due date': 'start_date', 'start date': 'start_date',
      };
      const FREQUENCY_ALIASES = { y: 'yearly', m: 'monthly', q: 'quarterly', w: 'weekly', d: 'daily', aw: 'alternative_week' };
      const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
      function parseFlexibleDate(s) {
        if (!s) return null;
        s = s.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        let m = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/);
        if (m) {
          const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
          if (mon) {
            const year = m[3].length === 2 ? '20' + m[3] : m[3];
            return `${year}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
          }
        }
        m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return null;
      }
      const text = (await file.text()).replace(/^﻿/, '');
      const lines = text.trim().split('\n').filter(Boolean);
      const headers = parseCsvLine(lines[0]).map(h => { const k = h.trim().toLowerCase(); return HEADER_ALIASES[k] || k; });
      const rows = lines.slice(1);
      let ok = 0, fail = 0;
      const failures = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cols = parseCsvLine(row).map(c => c.trim());
        const obj = {};
        headers.forEach((h, idx) => obj[h] = cols[idx] || '');
        const rowLabel = `Row ${i + 2} (${obj['user_email'] || 'no email'})`;
        try {
          const allUsers = _state.users || [];
          const userEmail = (obj['user_email'] || '').toLowerCase();
          const user = allUsers.find(u => (u.email || '').toLowerCase() === userEmail);
          if (!user) { fail++; failures.push(`${rowLabel}: email not found in Users list`); continue; }
          if (!obj['description']) { fail++; failures.push(`${rowLabel}: description/task is empty`); continue; }
          const freqRaw = (obj['frequency'] || 'daily').trim().toLowerCase();
          await Utils.apiFetch('/api/masters', {
            method: 'POST',
            body: JSON.stringify({
              task: obj['description'],
              assignedTo: user.name,
              frequency: FREQUENCY_ALIASES[freqRaw] || freqRaw,
              startDate: parseFlexibleDate(obj['start_date']),
              remarks: obj['remarks'] || '',
              department: obj['department'] || '',
            }),
          });
          ok++;
        } catch (e) { fail++; failures.push(`${rowLabel}: ${e.message || 'server error'}`); }
      }
      btn.disabled = false;
      btn.innerHTML = btnOrigHtml;
      hideModal('modal-checklist');
      Utils.showToast(`${ok} checklist(s) created${fail ? `, ${fail} failed` : ''}`, fail ? 'warning' : 'success');
      if (failures.length) {
        console.warn('Checklist CSV upload failures:\n' + failures.join('\n'));
        alert(`${failures.length} row(s) failed to upload:\n\n${failures.join('\n')}`);
      }
      await _refresh(admin);
    });

    /* ── holidays modal ── */
    const btnHolidays = el.querySelector('#db-btn-holidays');
    if (btnHolidays) {
      btnHolidays.addEventListener('click', () => {
        _renderHolidayList();
        showModal('modal-holidays');
      });
    }
    el.querySelector('#modal-holidays-close')?.addEventListener('click', () => hideModal('modal-holidays'));
    el.querySelector('#modal-holidays-done')?.addEventListener('click',  () => hideModal('modal-holidays'));
    el.querySelector('#modal-holidays')?.addEventListener('click',       () => hideModal('modal-holidays'));
    el.querySelector('#hol-add-btn')?.addEventListener('click', async () => {
      const date   = el.querySelector('#hol-date')?.value;
      const name   = el.querySelector('#hol-name')?.value.trim();
      const errEl  = el.querySelector('#hol-error');

      if (!date || !name) { if (errEl) { errEl.textContent = 'Date and name are required.'; errEl.style.display = 'block'; } return; }
      if (errEl) errEl.style.display = 'none';

      const addBtn = el.querySelector('#hol-add-btn');
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = '…'; }

      try {
        const result = await Utils.apiFetch('/api/holidays', {
          method: 'POST',
          body: JSON.stringify({ date, name }),
        });
        if (result?.id) _state.holidays.push({ id: result.id, date, name, type: 'Holiday' });
        if (el.querySelector('#hol-date'))  el.querySelector('#hol-date').value  = '';
        if (el.querySelector('#hol-name'))  el.querySelector('#hol-name').value  = '';
        _renderHolidayList();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed to add holiday.'; errEl.style.display = 'block'; }
      } finally {
        if (addBtn) { addBtn.disabled = false; addBtn.innerHTML = '+ Add Holiday'; }
      }
    });

    /* holiday CSV bulk upload */
    el.querySelector('#hol-csv-upload')?.addEventListener('click', async () => {
      const fileInput = el.querySelector('#hol-csv-file');
      const file = fileInput?.files?.[0];
      if (!file) { Utils.showToast('Please choose a CSV file first.', 'error'); return; }
      const text = (await file.text()).replace(/^﻿/, '');
      const lines = text.trim().split('\n').filter(Boolean);
      const dataLines = lines[0].toLowerCase().includes('date') ? lines.slice(1) : lines;
      let ok = 0, fail = 0;
      for (const line of dataLines) {
        const [rawDate, ...nameParts] = line.split(',');
        const name = nameParts.join(',').trim();
        if (!rawDate || !name) { fail++; continue; }
        let date = rawDate.trim();
        if (/^\d{2}-\d{2}-\d{4}$/.test(date)) {
          const [d, m, y] = date.split('-');
          date = `${y}-${m}-${d}`;
        }
        try {
          const result = await Utils.apiFetch('/api/holidays', { method: 'POST', body: JSON.stringify({ date, name }) });
          if (result?.id) _state.holidays.push({ id: result.id, date, name, type: 'Holiday' });
          ok++;
        } catch { fail++; }
      }
      if (fileInput) fileInput.value = '';
      _renderHolidayList();
      Utils.showToast(`${ok} holiday(s) added${fail ? `, ${fail} failed` : ''}`, fail ? 'warning' : 'success');
    });

    /* ── revise modal close ── */
    el.querySelector('#modal-revise-close')?.addEventListener('click',  () => hideModal('modal-revise'));
    el.querySelector('#modal-revise-cancel')?.addEventListener('click', () => hideModal('modal-revise'));
    el.querySelector('#modal-revise')?.addEventListener('click',        () => hideModal('modal-revise'));

    el.querySelector('#modal-revise-confirm')?.addEventListener('click', async () => {
      const task = _state.reviseTask;
      if (!task) { hideModal('modal-revise'); return; }
      const dateVal = document.getElementById('revise-date-input')?.value;
      const noteVal = document.getElementById('revise-note-input')?.value.trim();

      const confirmBtn = document.getElementById('modal-revise-confirm');
      if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving…'; }

      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'PATCH',
          body: JSON.stringify({
            id: task.id,
            status: 'revise',
            remarks: noteVal || undefined,
            ...(dateVal ? { dueDate: dateVal } : {}),
          }),
        });
        hideModal('modal-revise');
        _state.reviseTask = null;
        Utils.showToast('Task shifted.');
        await _refresh(admin);
      } catch (err) {
        Utils.showToast(err.message || 'Failed to update task', 'error');
      } finally {
        if (confirmBtn) { confirmBtn.disabled = false; }
      }
    });

    /* ── transfer modal ── */
    const btnTransfer = el.querySelector('#db-btn-transfer');
    if (btnTransfer) btnTransfer.addEventListener('click', () => {
      const trFrom = el.querySelector('#tr-from');
      const trTo   = el.querySelector('#tr-to');
      const trAll  = el.querySelector('#tr-all');
      if (trFrom) trFrom.selectedIndex = 0;
      if (trTo)   trTo.selectedIndex   = 0;
      if (trAll)  trAll.checked        = false;
      const err = el.querySelector('#tr-error');
      if (err) { err.textContent = ''; err.style.display = 'none'; }
      showModal('modal-transfer');
    });
    el.querySelector('#modal-transfer-close')?.addEventListener('click',  () => hideModal('modal-transfer'));
    el.querySelector('#modal-transfer-cancel')?.addEventListener('click', () => hideModal('modal-transfer'));
    el.querySelector('#modal-transfer')?.addEventListener('click',        () => hideModal('modal-transfer'));

    el.querySelector('#modal-transfer-submit')?.addEventListener('click', async () => {
      const fromSel  = el.querySelector('#tr-from');
      const toSel    = el.querySelector('#tr-to');
      const transferAll = el.querySelector('#tr-all')?.checked;
      const fromId   = fromSel?.value;
      const fromName = fromSel?.selectedOptions[0]?.dataset.name || '';
      const toId     = toSel?.value;
      const toName   = toSel?.selectedOptions[0]?.dataset.name || '';
      const errEl    = el.querySelector('#tr-error');

      if (!toId) { if (errEl) { errEl.textContent = 'Please select the "To" employee.'; errEl.style.display = 'block'; } return; }
      if (!transferAll && !fromId) { if (errEl) { errEl.textContent = 'Please select the "From" employee or check Transfer All.'; errEl.style.display = 'block'; } return; }
      if (errEl) errEl.style.display = 'none';

      const submitBtn = el.querySelector('#modal-transfer-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Transferring…'; }

      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'transfer',
            fromDoer: fromName,
            toDoer: toName,
            toDoerId: toId,
            transferAll: transferAll || false,
          }),
        });
        hideModal('modal-transfer');
        Utils.showToast('Tasks transferred successfully!');
        await _refresh(admin);
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Transfer failed.'; errEl.style.display = 'block'; }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Transfer'; }
      }
    });
  }

  /* ── actions ─────────────────────────────────────────────────────── */
  async function markDone(task, admin) {
    try {
      if (task.type === 'Delegation') {
        await Utils.apiFetch('/api/delegations', {
          method: 'PATCH',
          body: JSON.stringify({ id: task.id, status: 'done' }),
        });
      } else if (task.type === 'Checklist') {
        await Utils.apiFetch('/api/checklist-completions', {
          method: 'POST',
          body: JSON.stringify({ masterId: task.id, doer: window.currentUser?.name }),
        });
      } else if (task.type === 'FMS') {
        const parts = task.id.split('-');
        const stepIndex = parseInt(parts.pop());
        const fmsId = parts.join('-');
        await Utils.apiFetch('/api/fms/step', {
          method: 'POST',
          body: JSON.stringify({ fmsId, stepIndex }),
        });
      }
      Utils.showToast('Task marked as done!');
      await _refresh(admin);
    } catch (err) {
      Utils.showToast(err.message || 'Failed to mark done.', 'error');
    }
  }

  async function reopenTask(task, admin) {
    if (!await Utils.showConfirm('This will move the task back to pending.', { title: 'Reopen Task', confirmText: 'Reopen' })) return;
    try {
      if (task.type === 'Delegation') {
        await Utils.apiFetch('/api/delegations', {
          method: 'PATCH',
          body: JSON.stringify({ id: task.id, status: 'pending' }),
        });
      } else if (task.type === 'Checklist') {
        await Utils.apiFetch('/api/checklist-completions?masterId=' + encodeURIComponent(task.id), { method: 'DELETE' });
      }
      Utils.showToast('Task reopened.');
      await _refresh(admin);
    } catch (err) {
      Utils.showToast(err.message || 'Failed to reopen task.', 'error');
    }
  }

  async function denyRevise(task, admin) {
    if (!await Utils.showConfirm('This will send the task back to pending status.', { title: 'Deny Revise Request', confirmText: 'Deny', danger: true })) return;
    try {
      await Utils.apiFetch('/api/delegations', {
        method: 'PATCH',
        body: JSON.stringify({ id: task.id, status: 'pending', _denyRevise: true }),
      });
      Utils.showToast('Revise request denied.');
      await _refresh(admin);
    } catch (err) {
      Utils.showToast(err.message || 'Failed.', 'error');
    }
  }

  /* ── refresh (re-fetch data, update table) ───────────────────────── */
  async function _refresh(admin) {
    const [dashData, delegationsData] = await Promise.all([
      Utils.apiFetch('/api/dashboard'),
      admin ? Utils.apiFetch('/api/delegations') : Promise.resolve(_state.delegations),
    ]);
    if (!dashData) return;
    _state.data = dashData;
    _state.delegations = delegationsData || _state.delegations;

    /* update stat cards */
    const wrap = document.getElementById('db-wrap');
    if (!wrap) return;

    const statPending   = wrap.querySelector('#db-stat-pending');
    const statCompleted = wrap.querySelector('#db-stat-completed');
    const statTotal     = wrap.querySelector('#db-stat-total');
    const statUpcoming  = wrap.querySelector('#db-stat-upcoming');
    const statRevised   = wrap.querySelector('#db-stat-revised');
    const statRevisedC  = wrap.querySelector('#db-stat-revised-count');
    if (statPending)   statPending.textContent   = dashData.pending || dashData.pendingTasks.length;
    if (statCompleted) statCompleted.textContent = dashData.completed;
    if (statTotal)     statTotal.textContent     = admin ? dashData.total : dashData.pendingTasks.length;
    if (statUpcoming)  statUpcoming.textContent  = dashData.upcoming || 0;
    if (statRevisedC)  statRevisedC.textContent  = dashData.revised || 0;
    if (statRevised) {
      statRevised.textContent = dashData.revised > 0 ? `+ ${dashData.revised} revised` : '';
      statRevised.style.display = dashData.revised > 0 ? '' : 'none';
    }
    const pieEl = wrap.querySelector('#db-pie-container');
    if (pieEl) pieEl.innerHTML = renderPieSVG(dashData.completed, dashData.pending || dashData.pendingTasks.length, dashData.revised, dashData.upcoming || 0);

    _updateTasksTable(admin);
  }

  return { render };
})();
