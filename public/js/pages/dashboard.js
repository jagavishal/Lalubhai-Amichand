window.Pages = window.Pages || {};

window.Pages.dashboard = (function () {

  /* ── helpers ─────────────────────────────────────────────────────── */
  const esc = Utils.esc;

  function fmt(iso) {
    if (!iso) return '—';
    return new Date(iso)
      .toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .replace(/\//g, '-');
  }

  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function isAdmin(user) {
    if (!user) return false;
    const roles = Array.isArray(user.roles) ? user.roles : (user.roles || '').split(',').map(r => r.trim());
    return roles.includes('Admin') || roles.includes('HOD');
  }

  // HOD (but not true Admin) — sees their own tasks by default, with an "All (My
  // Team)" option in the employee picker to see their whole department. Mirrors
  // isHODUser() in server.js — keep the two in sync.
  function isHOD(user) {
    if (!user) return false;
    const roles = Array.isArray(user.roles) ? user.roles : (user.roles || '').split(',').map(r => r.trim());
    return roles.includes('HOD') && !roles.includes('Admin');
  }

  function avatarHTML(name) {
    return window.UI.avatar(name || '', { size: 22 });
  }

  // Type breakdown for the "Total Tasks" tile ("61 del · 3 chk") — computed
  // client-side off the same pendingTasks list the table already has, so it
  // never needs its own round trip and always agrees with what's on screen.
  function taskTypeBreakdown(tasks) {
    const counts = { Delegation: 0, Checklist: 0 };
    (tasks || []).forEach(t => { if (counts[t.type] != null) counts[t.type]++; });
    return counts;
  }

  function typePillHTML(type) {
    // PI: a Draft Proforma Invoice waiting for its price — listed for anyone
    // who can price, straight off the PI log (see /api/dashboard).
    const variantMap = { Delegation: 'info', FMS: 'purple', Checklist: 'success', PI: 'warning' };
    return window.UI.pill(type, { variant: variantMap[type] || 'neutral', size: 'sm' });
  }

  function priorityHTML(type, priority) {
    if (type === 'Checklist') return '<span style="color:var(--text-muted);font-size:12px;">—</span>';
    if (!priority || priority === 'Low') return '<span style="color:var(--text-muted);font-size:12px;">Low</span>';
    return window.UI.pill(priority, { variant: priority === 'High' ? 'danger' : 'warning', size: 'sm' });
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
    upcomingDays: 15, // Upcoming tab window: 15 or 30 (server sends 30 days of checklists)
  };

  /* ── column sort (click a header, like Google Sheets) ──────────────── */
  const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
  const DASH_SORT_ACCESSORS = {
    type:        t => (t.type || '').toLowerCase(),
    description: t => (t.description || '').toLowerCase(),
    doer:        t => (t.doer || '').toLowerCase(),
    frequency:   t => (t.frequency || '').toLowerCase(),
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
  // Upcoming = future delegations (already in pendingTasks) plus checklist
  // occurrences the server lists separately, since those aren't due yet and
  // so never enter pendingTasks. Soonest first. Shared by the Upcoming tab
  // and the Upcoming stat card so the two always agree.
  function upcomingList(days) {
    const { data, userFilter } = _state;
    if (!data) return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcomingEnd = new Date(today); upcomingEnd.setDate(upcomingEnd.getDate() + days);
    const upcomingChecklists = (data.upcomingTasks || []).filter(t => {
      const due = new Date(t.date); due.setHours(0, 0, 0, 0);
      return due <= upcomingEnd;
    });
    return (data.pendingTasks || [])
      .filter(t => {
        if (t.type !== 'Delegation' || t.status === 'done') return false;
        const due = new Date(t.date); due.setHours(0, 0, 0, 0);
        return due > today && due <= upcomingEnd;
      })
      .concat(upcomingChecklists)
      .filter(t => userFilter === 'All' || (t.doer || '').trim().toLowerCase() === userFilter.trim().toLowerCase())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // "Upcoming" stat card: the next 15 days as the number, 30 days beneath
  // ("doer want to see 15-30 days upcoming tasks on dashboard").
  function _paintUpcomingStat() {
    const n15 = upcomingList(15).length, n30 = upcomingList(30).length;
    const num = document.getElementById('db-stat-upcoming');
    const sub = document.getElementById('db-stat-upcoming-sub');
    if (num) num.textContent = n15;
    if (sub) sub.textContent = `next 15 days · ${n30} in 30`;
  }

  function getFiltered() {
    const { data, subTab, userFilter } = _state;
    if (!data) return [];
    const STATUS_RANK = { revise: 0, pending: 1, done: 2 };
    if (subTab === 'Upcoming') return upcomingList(_state.upcomingDays);
    return data.pendingTasks
      .filter(t => {
        if (subTab === 'Completed') {
          if (t.status !== 'done') return false;
        } else if (subTab === 'Shifted') {
          if (t.status !== 'revise' && t.status !== 'revise_requested') return false;
        } else {
          if (t.status === 'done') return false;
          if (subTab !== 'All' && t.type !== subTab) return false;
        }
        return userFilter === 'All' || (t.doer || '').trim().toLowerCase() === userFilter.trim().toLowerCase();
      })
      .slice()
      .sort((a, b) => (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2));
  }


  /* Apply Leave lives on the Dashboard because booking a day off is one of
     the few HR things everybody does, and it should not need a trip into the
     HR section. It opens the very same form Leave Management uses rather than
     a second copy — see applyLeave() in hr-leave.js — so the half-day rule and
     the balance warning can never drift between the two ways in.

     Everything else about a person's HR record (punch times, balances,
     salary, payslips) lives on their Profile, not here. */
  /* Today's absentees, from the leave register. Its own fetch rather than a
     rider on /api/dashboard — the strip is decoration, and a slow or failing
     HR module must never hold up or break the task board. */
  async function _paintOnLeave() {
    const box = document.getElementById('db-onleave');
    if (!box) return;
    const data = await Utils.apiFetch('/api/hr/on-leave-today').catch(() => null);
    // The endpoint used to return a bare array; accept both shapes so a
    // half-deployed pair of files never blanks the strip.
    const leave = Array.isArray(data) ? data : (data?.leave || []);
    const absent = Array.isArray(data) ? [] : (data?.absent || []);
    if (!leave.length && !absent.length) return;
    const esc = Utils.esc;
    box.style.display = '';
    box.innerHTML = `
      <div class="card" style="padding:12px 16px;border-left:3px solid #7c3aed;display:flex;flex-direction:column;gap:8px;">
        ${leave.length ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#7c3aed;white-space:nowrap;">
            On Leave Today · ${leave.length}
          </span>
          ${leave.map((r) => `
            <span style="display:inline-flex;align-items:baseline;gap:6px;background:#f5f3ff;border:1px solid #ede9fe;
                  border-radius:99px;padding:4px 12px;font-size:12.5px;">
              <b style="color:#0f172a;">${esc(r.name)}</b>
              <span style="color:#7c3aed;font-size:11px;font-weight:600;">${esc(r.type)}${r.half ? ' · half day' : ''}</span>
              ${r.backup
                ? `<span style="color:#475569;font-size:11.5px;">→ covered by <b>${esc(r.backup)}</b></span>`
                : ''}
            </span>`).join('')}
        </div>` : ''}
        ${absent.length ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#dc2626;white-space:nowrap;">
            Absent Today · ${absent.length}
          </span>
          ${absent.map((n) => `
            <span style="display:inline-flex;align-items:baseline;gap:6px;background:#fef2f2;border:1px solid #fee2e2;
                  border-radius:99px;padding:4px 12px;font-size:12.5px;">
              <b style="color:#0f172a;">${esc(n)}</b>
              <span style="color:#dc2626;font-size:11px;font-weight:600;">no leave</span>
            </span>`).join('')}
        </div>` : ''}
      </div>`;
  }

  function _openLeaveModal() {
    const page = window.Pages && window.Pages['hr-leave'];
    if (page && typeof page.applyLeave === 'function') page.applyLeave();
    else window.Router.navigate('hr-leave');
  }

  /* The Meetings tile + panel are the signed-in user's own agenda (GET
     /api/scheduler already scopes to organizer-or-attendee — see server.js),
     independent of whichever employee an admin has picked in the dashboard's
     doer filter. Its own fetch, same reasoning as _paintOnLeave(): decoration
     that must never hold up or break the task board. */
  async function _paintMeetings() {
    const valueEl = document.getElementById('db-stat-meetings');
    const subEl   = document.getElementById('db-stat-meetings-sub');
    const bodyEl  = document.getElementById('db-meetings-body');
    if (!valueEl && !bodyEl) return;
    const from = todayISO();
    const toDate = new Date(); toDate.setDate(toDate.getDate() + 6);
    const to = toDate.toISOString().split('T')[0];
    const data = await Utils.apiFetch(`/api/scheduler?from=${from}&to=${to}`).catch(() => null);
    const meetings = (data && data.meetings) || [];
    const todayCount = meetings.filter(m => m.date === from).length;

    if (valueEl) valueEl.textContent = meetings.length;
    if (subEl) subEl.textContent = todayCount ? `${todayCount} today` : (meetings.length ? 'this week' : 'none scheduled');
    if (!bodyEl) return;

    if (!meetings.length) {
      bodyEl.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:20px 12px;color:var(--text-muted);">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>
          <div style="font-size:12.5px;">No meetings in the next 7 days</div>
          <a href="#scheduler" class="btn-secondary btn-sm" style="margin-top:4px;">Schedule a meeting</a>
        </div>`;
      return;
    }
    bodyEl.innerHTML = meetings.slice(0, 8).map(m => `
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
        <div style="width:56px;flex-shrink:0;font-size:11px;font-weight:700;color:#334155;line-height:1.4;">
          ${fmt(m.date)}${m.startTime ? `<br><span style="font-weight:500;color:#94a3b8;">${esc(m.startTime)}</span>` : ''}
        </div>
        <div style="min-width:0;">
          <div style="font-size:12.5px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.title)}</div>
          ${m.location ? `<div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.location)}</div>` : ''}
        </div>
      </div>`).join('');
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
    const hod = isHOD(user);

    /* parallel fetches */
    const [dashData, usersData, holidaysData, delegationsData] = await Promise.all([
      Utils.apiFetch('/api/dashboard'),
      // Only /api/dashboard is essential — a hiccup on the dropdown/holiday/
      // delegation lists shouldn't blank the whole page.
      Utils.apiFetch('/api/users?lite=1').catch(() => []),
      Utils.apiFetch('/api/holidays').catch(() => []),
      admin ? Utils.apiFetch('/api/delegations').catch(() => []) : Promise.resolve([]),
    ]);

    if (!dashData) return;

    _state.data        = dashData;
    _state.users       = usersData || [];
    _state.holidays    = holidaysData || [];
    _state.delegations = delegationsData || [];
    _state.subTab      = 'All';
    _state.userFilter  = 'All';

    _renderShell(el, admin, hod);
    window.Festival?.mount(document.getElementById('db-wrap'));
    _paintOnLeave();
    _paintMeetings();
    } catch(err) {
      el.innerHTML = `<div style="padding:2rem;color:#dc2626;font-size:14px;">❌ Dashboard error: ${err.message}</div>`;
      console.error('Dashboard render error:', err);
    }
  }

  function _renderShell(el, admin, hod) {
    const { data, users, holidays } = _state;
    const allDoers = [...new Set((users || []).map(u => u.name))].sort();
    const me = window.currentUser;
    // Department is free text, so compare trimmed + lowercased — same rule as
    // normDept() in server.js, otherwise a teammate whose department differs
    // only in case/whitespace silently drops out of the HOD's picker.
    const normDept = d => String(d || '').trim().toLowerCase();
    const myDept = normDept((users || []).find(u => u.id === me?.id)?.department ?? me?.department);
    // HOD's picker only ever lists their own department's team, never the whole company.
    const teamUsers = hod ? (users || []).filter(u => normDept(u.department) === myDept && u.name !== me?.name) : [];

    const empOptionRow = u => {
      const dept = (u.department||'').length > 16 ? (u.department||'').slice(0,16)+'…' : (u.department||'');
      return `<div data-emp-val="${u.name}" data-emp-label="${u.name}${u.department ? ' · '+u.department : ''}" class="db-emp-opt" style="padding:8px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-size:12.5px;font-weight:600;color:#0f172a;">${u.name}</span>
        ${dept ? `<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">${dept}</span>` : ''}
      </div>`;
    };

    el.innerHTML = `
      <style>
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        #db-wrap { animation: fadeIn .25s ease both; }
        .db-stat-card { border: 2px solid transparent; transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
        .db-stat-card[data-filter]:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,.08); }
        .db-stat-card[data-filter]:active { transform: translateY(0); }
        .db-stat-card[data-filter].active { border-color: var(--color-primary); box-shadow: 0 4px 14px rgba(1,80,170,.18); }
        .db-th-sort:hover { color: var(--color-primary) !important; }
        /* Mobile responsive */
        @media (max-width: 767px) {
          #db-topbar { flex-direction: column; align-items: stretch !important; gap: 12px !important; margin-bottom: 14px !important; }
          #db-title-row { display: flex !important; align-items: center; justify-content: space-between; gap: 10px; width: 100%; order: -1; }
          #db-title-row h2 { font-size: 20px !important; color: var(--text-primary) !important; }
          #db-emp-picker-mobile { min-width: 0; flex: 0 1 auto; }
          /* Quick actions: a tidy 4-up grid of icon tiles */
          #db-btn-row { display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: 1fr; width: 100%; gap: 8px !important; }
          #db-btn-row button { flex-direction: column; justify-content: center; align-items: center; gap: 4px !important;
            min-height: 56px; padding: 8px 2px !important; font-size: 10.5px !important; line-height: 1.2; text-align: center; letter-spacing: -.01em;
            border-radius: 12px !important; white-space: normal; display: inline-flex !important; }
          #db-btn-row button svg { width: 16px; height: 16px; }
          #db-emp-picker { width: auto !important; max-width: 100%; }
          #db-emp-trigger { width: 100% !important; min-width: unset !important; min-height: 38px; }
          #db-emp-dropdown { left: auto !important; right: 0; width: min(280px, calc(100vw - 24px)) !important; }
          /* Stat tiles: 2-up grid — six tiles, three even rows */
          #db-stat-cards { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; margin-bottom: 14px !important; }
          #db-stat-cards .db-stat-card { padding: 14px 14px !important; min-width: 0; border-radius: 14px; }
          #db-stat-cards .db-stat-card > div:nth-child(2) { font-size: 1.75rem !important; line-height: 1.15; }
          #db-main-grid { grid-template-columns: 1fr !important; gap: 12px !important; margin-bottom: 12px !important; }
          /* Recent Activity: header stacks, tabs scroll sideways, rows become cards */
          .db-act-head { padding: 12px 14px !important; }
          .db-act-tabs { width: 100%; overflow-x: auto; scrollbar-width: none; }
          .db-act-tabs::-webkit-scrollbar { display: none; }
          .db-act-tabs .db-tab-btn { flex: 1 0 auto; white-space: nowrap; padding: 8px 12px !important; }
          .db-act-scroll { max-height: none !important; overflow: visible !important; }
          #db-tasks-table tr td .db-desc { -webkit-line-clamp: unset; display: block; overflow: visible; }
          #db-tasks-table td.db-c-type { order: -2; }
          #db-tasks-table td[colspan] { padding: 2.5rem 1rem !important; text-align: center !important; }
          #db-tasks-table td.m-card-actions .pill-act { min-height: 36px; padding: 0 16px; }
          /* Inline modals open as bottom sheets with single-column forms */
          #db-ht-modal, #db-up-modal, #db-ann-modal { align-items: flex-end !important; padding: 0 !important; }
          #db-ht-modal > div, #db-up-modal > div, #db-ann-modal > div { max-width: 100% !important; border-radius: 18px 18px 0 0 !important; max-height: 92vh !important; }
          #db-ht-modal > div, #db-ann-modal > div { overflow-y: auto !important; }
          #db-ht-modal > div > div:last-child > button, #db-up-modal > div > div:last-child > button,
          #db-ann-modal > div > div:last-child > button { flex: 1 1 0; justify-content: center; min-height: 42px; }
          #db-ht-modal [style*="grid-template-columns:1fr 1fr"], #db-up-modal [style*="grid-template-columns:1fr 1fr"],
          #db-ann-modal [style*="grid-template-columns:1fr 1fr"], #db-wrap ~ .modal-overlay [style*="grid-template-columns:1fr 1fr"] { grid-template-columns: 1fr !important; }
        }
        /* Modal shell, .input, .label, and .btn-* now come from the shared style.css design system (no local duplicates). */
        .db-card-title { font-size:var(--text-md);font-weight:700;color:var(--text-primary);margin:0; }
        .db-card-sub { font-size:var(--text-sm);color:var(--text-secondary);margin:3px 0 0; }
        .db-qa svg { flex-shrink:0; }
        #db-tasks-table .db-desc { font-weight:600;color:var(--text-primary);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:normal;line-height:1.4;overflow-wrap:anywhere; }
        /* Row actions: 32px tall so they're a comfortable click/tap target */
        .pill-act { display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0 12px;font-size:12px;font-weight:600;border-radius:9999px;cursor:pointer;border:none;transition:background .12s;font-family:inherit; }
        .pill-act:focus-visible { outline:2px solid var(--color-primary);outline-offset:2px; }
        .pill-done { background:var(--color-success-bg);color:var(--color-success-text); } .pill-done:hover { background:var(--color-success-border); }
        .pill-revise { background:var(--color-danger-bg);color:var(--color-danger-text); } .pill-revise:hover { background:var(--color-danger-border); }
        .pill-grant { background:var(--color-success-bg);color:var(--color-success-text); } .pill-grant:hover { background:var(--color-success-border); }
        .pill-deny  { background:var(--color-neutral-bg);color:var(--color-neutral-text); } .pill-deny:hover  { background:var(--border-base); }
        .pill-pending-wait { background:var(--color-warning-bg);color:var(--color-warning-text);display:inline-flex;align-items:center;padding:0 12px;min-height:32px;font-size:12px;font-weight:600;border-radius:9999px; }
        @media (max-width:1200px) and (min-width:768px) { #db-stat-cards { grid-template-columns:repeat(3,1fr) !important; } }
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
                <span id="db-emp-label" style="font-weight:600;">${hod ? 'My Tasks' : 'All Employees'}</span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div id="db-emp-dropdown" style="display:none;position:absolute;left:0;top:calc(100% + 4px);width:280px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:200;overflow:hidden;">
              <div style="padding:8px;">
                <input id="db-emp-search" type="text" placeholder="Search employee..." style="width:100%;padding:6px 10px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12px;outline:none;box-sizing:border-box;" />
              </div>
              <div id="db-emp-list" style="max-height:260px;overflow-y:auto;padding:4px 0;">
                ${hod ? `
                <div data-emp-val="${me?.name||''}" data-emp-label="My Tasks" class="db-emp-opt" style="padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:700;color:#374151;background:#f0f9ff;">My Tasks</div>
                <div data-emp-val="All" data-emp-label="All (My Team)" class="db-emp-opt" style="padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:600;color:#374151;">All (My Team)</div>
                ${teamUsers.sort((a,b)=>a.name.localeCompare(b.name)).map(empOptionRow).join('')}
                ` : `
                <div data-emp-val="All" data-emp-label="All Employees" class="db-emp-opt" style="padding:8px 14px;cursor:pointer;font-size:12.5px;font-weight:600;color:#374151;background:#f0f9ff;">All Employees</div>
                ${(users || []).sort((a,b)=>a.name.localeCompare(b.name)).map(empOptionRow).join('')}
                `}
              </div>
            </div>
          </div>` : `<h2 style="font-size:17px;font-weight:700;color:#0f172a;margin:0;">Dashboard</h2>`}

          <!-- RIGHT: action buttons -->
          <div id="db-btn-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <!-- Shown to everyone: which days the company is closed is something
                 all staff need, and it was behind an admin-only button. What the
                 modal contains still depends on who opened it. -->
            <button id="db-btn-holidays" class="btn-secondary db-qa">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              ${admin ? 'Holidays' : 'Holiday List'}
            </button>
            <button id="db-btn-checklist" class="btn-secondary db-qa">
              Checklist
            </button>
            <button id="db-btn-delegate" class="btn-primary db-qa">
              Delegate
            </button>
            <button id="db-btn-help-ticket" class="btn-secondary db-qa">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Help Ticket
            </button>
            <button id="db-btn-urgent-payment" class="btn-danger db-qa">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 8h12M6 13l6 8M6 13h4a4 4 0 0 0 0-8"/></svg>
              Urgent Payment
            </button>
            <button id="db-btn-announcement" class="btn-secondary db-qa">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              Announcement
            </button>
            <button id="db-btn-leave" class="btn-secondary db-qa">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg>
              Apply Leave
            </button>
            ${admin ? `<button id="db-btn-transfer" class="btn-secondary db-qa">
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
        <!-- Who is away today, and who covers for them. Filled by _paintOnLeave()
             after the shell renders; stays empty (and invisible) when nobody is out. -->
        <div id="db-onleave" style="display:none;margin-bottom:16px;"></div>

        <div id="db-stat-cards" style="display:grid;grid-template-columns:repeat(6,1fr);gap:1rem;margin-bottom:20px;">
          <div class="card db-stat-card" style="padding:18px 20px;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Total Tasks</div>
            <div id="db-stat-total" style="font-size:2.2rem;font-weight:800;color:var(--color-primary);">${admin ? data.total : data.pendingTasks.length}</div>
            <div id="db-stat-total-sub" style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:4px;">${(() => { const b = taskTypeBreakdown(data.pendingTasks); return `${b.Delegation} del · ${b.Checklist} chk`; })()}</div>
          </div>
          <div class="card db-stat-card active" data-filter="All" title="Show pending tasks" style="padding:18px 20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Pending</div>
            <div id="db-stat-pending" style="font-size:2.2rem;font-weight:800;color:var(--color-danger);">${data.pending}</div>
            <div id="db-stat-revised" style="font-size:11px;font-weight:600;color:var(--color-warning);margin-top:4px;${data.revised > 0 ? '' : 'display:none;'}">+ ${data.revised} shifted</div>
            <div id="db-stat-pending-sub" style="font-size:11px;font-weight:600;color:var(--color-success);margin-top:4px;${data.revised > 0 ? 'display:none;' : ''}">${data.pending > 0 ? 'Awaiting action' : 'On track'}</div>
          </div>
          <div class="card db-stat-card" data-filter="Completed" title="Show completed tasks" style="padding:18px 20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Completed</div>
            <div id="db-stat-completed" style="font-size:2.2rem;font-weight:800;color:var(--color-success);">${data.completed}</div>
            <div style="height:5px;border-radius:3px;background:var(--border-base);margin-top:8px;overflow:hidden;">
              <div id="db-stat-completed-bar" style="height:100%;border-radius:3px;background:var(--color-success);width:${data.total ? Math.round(data.completed / data.total * 100) : 0}%;"></div>
            </div>
            <div id="db-stat-completed-sub" style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:4px;">${data.total ? Math.round(data.completed / data.total * 100) : 0}% done</div>
          </div>
          <div class="card db-stat-card" data-filter="Shifted" title="Show shifted tasks" style="padding:18px 20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Revised</div>
            <div id="db-stat-revised-count" style="font-size:2.2rem;font-weight:800;color:var(--color-warning);">${data.revised || 0}</div>
            <div id="db-stat-revised-sub" style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:4px;">${(data.revised || 0) > 0 ? 'Needs rework' : 'None pending'}</div>
          </div>
          <div class="card db-stat-card" data-filter="Upcoming" role="button" tabindex="0" title="Show tasks due in the next 15 / 30 days" style="padding:18px 20px;cursor:pointer;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Upcoming</div>
            <div id="db-stat-upcoming" style="font-size:2.2rem;font-weight:800;color:var(--color-purple);">–</div>
            <div id="db-stat-upcoming-sub" style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:4px;">next 15 days</div>
          </div>
          <a href="#scheduler" class="card db-stat-card" title="Open Scheduler" style="padding:18px 20px;cursor:pointer;display:block;text-decoration:none;color:inherit;">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">Meetings</div>
            <div id="db-stat-meetings" style="font-size:2.2rem;font-weight:800;color:var(--color-purple);">–</div>
            <div id="db-stat-meetings-sub" style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:4px;">next 7 days</div>
          </a>
        </div>

        <!-- Task Status + Meetings -->
        <div id="db-main-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">

          <!-- Task status donut card -->
          <div class="card" style="padding:1.1rem;display:flex;flex-direction:column;">
            <div>
              <h2 class="db-card-title">Task Status</h2>
              <p class="db-card-sub">Completed, pending &amp; revised</p>
            </div>
            <div id="db-pie-container" style="flex:1;display:flex;align-items:center;justify-content:center;padding-top:10px;">
              ${renderPieSVG(data.completed, data.pending, data.revised, data.upcoming || 0)}
            </div>
          </div>

          <!-- Meetings card -->
          <div class="card" style="padding:1.1rem;display:flex;flex-direction:column;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div>
                <h2 class="db-card-title">Meetings</h2>
                <p class="db-card-sub">Next 7 days</p>
              </div>
              <a href="#scheduler" style="font-size:11.5px;font-weight:600;color:var(--color-primary);text-decoration:none;white-space:nowrap;">Scheduler →</a>
            </div>
            <div id="db-meetings-body" style="margin-top:6px;flex:1;display:flex;flex-direction:column;">
              <div style="text-align:center;padding:28px 12px;color:#94a3b8;font-size:12.5px;">Loading…</div>
            </div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="card" style="overflow:hidden;margin-bottom:20px;">
          <div class="db-act-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px 20px;border-bottom:1px solid #f1f5f9;">
            <div>
              <h2 class="db-card-title">Recent Activity</h2>
              <p id="db-tasks-count" class="db-card-sub"></p>
            </div>
            <div class="db-act-tabs" style="display:flex;align-items:center;gap:4px;background:#f1f5f9;border-radius:8px;padding:3px;">
              ${['All','Delegation','Checklist', ...(window.currentUser?.featureFlags?.fms ? ['FMS'] : []), 'Upcoming'].map(t =>
                `<button class="db-tab-btn" data-tab="${t}" style="padding:5px 11px;border-radius:6px;font-size:11.5px;font-weight:600;border:none;cursor:pointer;transition:all .12s;">${t}</button>`
              ).join('')}
            </div>
            <!-- Upcoming window — only shown on the Upcoming tab -->
            <div id="db-upcoming-range" style="display:none;align-items:center;gap:4px;background:#f5f3ff;border-radius:8px;padding:3px;">
              ${[15, 30].map(d =>
                `<button class="db-upc-btn" data-days="${d}" style="padding:5px 11px;border-radius:6px;font-size:11.5px;font-weight:600;border:none;cursor:pointer;transition:all .12s;">Next ${d} days</button>`
              ).join('')}
            </div>
          </div>
          <div class="db-act-scroll" style="overflow-x:auto;max-height:420px;overflow-y:auto;">
            <table id="db-tasks-table" class="m-cards" style="width:100%;border-collapse:collapse;font-size:12.5px;"></table>
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
            ${admin ? `
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
              <div style="grid-column:1/-1;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;color:#374151;">
                  <input type="checkbox" id="hol-unpaid" style="width:15px;height:15px;accent-color:#d9737a;cursor:pointer;" />
                  Unpaid leave (UL) — shown in red on the list
                </label>
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
            </div>` : `
            <p style="font-size:12.5px;color:#64748b;margin:0;line-height:1.5;">
              The days the company is closed. Leave taken on these days is not counted against your balance.
            </p>`}
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
    // Scoped to this page render — otherwise every visit to the dashboard
    // stacked another resize handler pointing at the previous, detached DOM.
    window.addEventListener('resize', _applyMobileLayout, { signal: window.Router.pageSignal() });
  }

  /* ── task status donut ───────────────────────────────────────────── */
  function renderPieSVG(completed, pending, revised, upcoming) {
    const segs = [
      { value: completed,               color: '#10b981', label: 'Completed' },
      { value: pending - (upcoming||0), color: '#ef4444', label: 'Pending'   },
      { value: revised,                 color: '#f59e0b', label: 'Revised'   },
      { value: upcoming || 0,           color: '#7c3aed', label: 'Upcoming'  },
    ];
    const total = segs.reduce((a, s) => a + s.value, 0);
    const size = 150, cx = size / 2, cy = size / 2, r = 58, sw = 17, C = 2 * Math.PI * r;
    const visible = segs.filter(s => s.value > 0);
    const gap = visible.length > 1 ? 3 : 0;

    let arcs;
    if (total === 0) {
      arcs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${sw}"/>`;
    } else {
      let off = 0;
      arcs = visible.map(s => {
        const len = (s.value / total) * C;
        const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}"
          stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"/>`;
        off += len;
        return circle;
      }).join('');
    }

    const pct = total ? Math.round(completed / total * 100) : 0;
    const rows = segs.map(s => `
      <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:#475569;padding:4px 0;">
        <span style="width:9px;height:9px;border-radius:3px;background:${s.color};flex-shrink:0;"></span>
        <span style="flex:1;">${s.label}</span>
        <b style="color:#0f172a;">${s.value}</b>
        <span style="color:#94a3b8;font-size:11px;width:34px;text-align:right;">${total ? Math.round(s.value / total * 100) : 0}%</span>
      </div>`).join('');

    return `
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center;width:100%;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0;">
          ${arcs}
          <text x="${cx}" y="${cy - 4}" text-anchor="middle" style="font-size:22px;font-weight:800;fill:#0f172a;">${pct}%</text>
          <text x="${cx}" y="${cy + 15}" text-anchor="middle" style="font-size:10px;fill:#94a3b8;">completed</text>
        </svg>
        <div style="flex:1;min-width:160px;">
          ${rows}
          <div style="border-top:1px solid #f1f5f9;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-size:12.5px;">
            <span style="color:#64748b;font-weight:600;">Total</span><b style="color:#0f172a;">${total}</b>
          </div>
        </div>
      </div>`;
  }

  /* ── tasks table update ──────────────────────────────────────────── */
  function _updateTasksTable(admin) {
    _paintUpcomingStat();
    const filtered = getFiltered();
    const table = document.getElementById('db-tasks-table');
    const countEl = document.getElementById('db-tasks-count');
    if (!table) return;

    const isUpcoming = _state.subTab === 'Upcoming';
    const countLabel = _state.subTab === 'Completed' ? 'completed' : _state.subTab === 'Shifted' ? 'shifted'
      : isUpcoming ? `due in the next ${_state.upcomingDays} days` : 'awaiting action';
    if (countEl) countEl.textContent = `${filtered.length} ${countLabel}`;

    const range = document.getElementById('db-upcoming-range');
    if (range) {
      range.style.display = isUpcoming ? 'flex' : 'none';
      range.querySelectorAll('.db-upc-btn').forEach(btn => {
        const active = Number(btn.dataset.days) === _state.upcomingDays;
        btn.style.background = active ? '#7c3aed' : 'transparent';
        btn.style.color      = active ? '#fff' : '#6d28d9';
      });
    }

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
        <tbody><tr><td colspan="7" style="padding:3rem;text-align:center;">
          <div style="width:44px;height:44px;border-radius:14px;background:#ecfdf5;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
          </div>
          <div style="font-size:13px;font-weight:600;color:#334155;">${_state.subTab === 'Completed' || _state.subTab === 'Shifted' || isUpcoming ? 'Nothing here' : 'All caught up!'}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:3px;">${_state.subTab === 'Completed' ? 'No completed tasks yet.' : _state.subTab === 'Shifted' ? 'No shifted tasks.' : isUpcoming ? `No tasks due in the next ${_state.upcomingDays} days.` : 'No pending tasks.'}</div>
        </td></tr></tbody>`;
      return;
    }

    const thStyle = 'text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#64748b;background:rgba(248,250,252,.97);position:sticky;top:0;';
    const tdStyle = 'padding:10px 12px;font-size:12.5px;color:#475569;border-top:1px solid #f1f5f9;';

    const rows = sortDashTasks(filtered).map(t => {
      const dateStyle = t.overdue ? 'color:#dc2626;font-weight:700;' : 'color:#475569;';
      const urlLink = t.url ? `<a href="${esc(Utils.safeUrl(t.url))}" target="_blank" rel="noopener noreferrer" title="${esc(t.url)}" style="color:var(--color-primary-strong);flex-shrink:0;display:inline-flex;margin-left:4px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : '';
      const transferred = t.transferredFrom ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 6px;border-radius:var(--radius-sm);background:var(--color-warning-bg);color:var(--color-warning-text);border:1px solid var(--color-warning-border, #fde68a);font-weight:600;" title="${t.transferredBy ? 'Transferred by ' + esc(t.transferredBy) : ''}">🔄 from ${esc(t.transferredFrom)}</span>` : '';

      let actionHTML;
      if (t.upcoming) {
        // A checklist occurrence that isn't due yet — it can't be marked done
        // ahead of its date, so just say how far off it is.
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const due = new Date(t.date); due.setHours(0, 0, 0, 0);
        const days = Math.round((due - today) / 86400000);
        actionHTML = `<span style="color:#7c3aed;font-weight:600;font-size:11.5px;white-space:nowrap;">In ${days} day${days === 1 ? '' : 's'}</span>`;
      } else if (t.status === 'done') {
        actionHTML = `<span style="color:#059669;font-weight:600;font-size:11.5px;">✓ Completed</span>
          <button class="pill-act pill-deny" data-action="reopen" data-id="${t.id}">Reopen</button>`;
      } else if (t.type === 'PI') {
        // Done here IS pricing it: the button opens that PI's Add Price
        // screen, and saving the price is what clears the task.
        actionHTML = `<button class="pill-act pill-done" data-action="done" data-id="${t.id}">Add Price</button>`;
      } else {
        actionHTML = `<button class="pill-act pill-done" data-action="done" data-id="${t.id}">Done</button>`;
        if (t.type === 'Delegation') {
          actionHTML += ` <button class="pill-act pill-revise" data-action="shift" data-id="${t.id}">Shift</button>`;
        }
      }

      return `<tr style="transition:background .1s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td class="db-c-type" data-label="" style="${tdStyle}">${typePillHTML(t.type)}</td>
        <td class="m-card-title" style="${tdStyle}min-width:240px;max-width:380px;">
          <div style="display:flex;align-items:flex-start;gap:4px;">
            <span class="db-desc" title="${esc(t.description)}">${esc(t.description)}</span>
            ${urlLink}
          </div>
          ${t.type === 'Checklist' && t.department ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${esc(t.department)}</div>` : ''}
          ${(t.type === 'FMS' || t.type === 'PI') && Array.isArray(t.details) && t.details.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${t.details.map(d => `<span style="font-size:11px;background:var(--surface-alt);border:1px solid var(--border-base);color:var(--color-neutral-text);border-radius:var(--radius-sm);padding:1px 6px;white-space:nowrap;"><b>${esc(d.header)}:</b> ${esc(d.value) || '—'}</span>`).join('')}</div>` : ''}
          ${transferred}
        </td>
        <td data-label="Doer" style="${tdStyle}">
          <div style="display:flex;align-items:center;gap:6px;">
            ${avatarHTML(t.doer)}
            <span style="color:#334155;">${esc(t.doer) || '—'}</span>
          </div>
        </td>
        <td data-label="Frequency" style="${tdStyle}">${t.frequency ? t.frequency.charAt(0).toUpperCase() + t.frequency.slice(1) : '—'}</td>
        <td data-label="Priority" style="${tdStyle}">${priorityHTML(t.type, t.priority)}</td>
        <td data-label="Date" style="${tdStyle}white-space:nowrap;font-size:12px;${dateStyle}">${fmt(t.date)}</td>
        <td class="m-card-actions" style="${tdStyle}">
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
          ${sortTh('frequency', 'Frequency')}
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
    // Remove is Admin/HOD only — the route refuses anyone else anyway, so
    // showing the button to staff would only produce a red toast.
    const canEdit = isAdmin(window.currentUser);
    const escH = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const dayName = (iso) => {
      const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { weekday: 'long' });
    };
    // The company's own holiday sheet shades the unpaid ones red and explains
    // the colour underneath, so the ERP does the same rather than inventing a
    // second visual language for a list people already know by sight.
    const isUnpaid = (h) => /unpaid|\bUL\b/i.test(String(h.type || '') + ' ' + String(h.notes || ''));

    const th = 'padding:7px 10px;font-size:11px;font-weight:700;color:#7c2d12;background:#f5d9a0;'
      + 'border:1px solid #e7c884;text-align:center;white-space:nowrap;';
    const td = 'padding:7px 10px;font-size:12.5px;border:1px solid #eadfc6;text-align:center;';

    listEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="${th}">Sr.no</th>
            <th style="${th}">Date</th>
            <th style="${th}">Day</th>
            <th style="${th}width:100%;">Holidays</th>
            ${canEdit ? `<th style="${th}"></th>` : ''}
          </tr></thead>
          <tbody>
            ${holidays.map((h, i) => {
              const unpaid = isUnpaid(h);
              // No dimming of days already gone: this is the year's calendar as
              // the company publishes it, and the printed sheet does not fade
              // half of it out. Colour here means paid or unpaid, nothing else.
              const bg = unpaid ? '#d9737a' : '#fdf3dc';
              const fg = unpaid ? '#ffffff' : '#374151';
              return `<tr style="background:${bg};color:${fg};">
                <td style="${td}font-weight:700;">${i + 1}</td>
                <td style="${td}white-space:nowrap;">${fmt(h.date)}</td>
                <td style="${td}white-space:nowrap;">${escH(dayName(h.date))}</td>
                <td style="${td}text-align:left;">${escH(h.name)}</td>
                ${canEdit ? `<td style="${td}">
                  <button data-hol-del="${escH(h.id)}" title="Remove"
                    style="padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.85);color:#b91c1c;border:1px solid #fecaca;font-size:11px;font-weight:600;cursor:pointer;">Remove</button>
                </td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${holidays.some(isUnpaid) ? `
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
        <span style="width:26px;height:16px;border-radius:4px;background:#d9737a;border:1px solid #c95f66;flex-shrink:0;"></span>
        <span style="font-size:11.5px;color:#64748b;">This colour represents Unpaid Leaves (UL)</span>
      </div>` : ''}`;

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
        <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${esc(task.description)}</div>
        <div style="font-size:12px;color:#64748b;">Doer: <b style="color:#334155;">${esc(task.doer)}</b></div>`;
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
    const today = Utils.todayISO();
    let userOpts = `<option value="${userName}">${userName}</option>`;
    try {
      const res = await fetch('/api/users?lite=1');
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

  /* ── Urgent Payment request modal ──────────────────────────────────
     Replaces the Google Form the office used for urgent payments. Saved to
     /api/urgent-payments; the server mails the approvers, the accounts desk
     and the requester, and the request shows under Approvals → Urgent
     Payment for an Admin/HOD to approve or reject. */
  function _openUrgentPaymentModal() {
    const existing = document.getElementById('db-up-modal');
    if (existing) existing.remove();
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const me = window.currentUser || {};
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const inp = 'width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;';
    const ro  = 'width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;outline:none;box-sizing:border-box;background:#f8fafc;';
    const req = '<span style="color:#ef4444">*</span>';
    // Every label in the three languages the office reads — the Google Form
    // this replaced was trilingual, and the people filling it are not all
    // comfortable in English alone.
    const lbl = (en, hi, gu, required) => `<label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;line-height:1.5;">
        ${en} ${required ? req : ''}<span style="display:block;font-weight:500;text-transform:none;letter-spacing:0;color:#94a3b8;font-size:11px;">${hi} · ${gu}</span></label>`;
    const modes = [
      ['NEFT / RTGS', 'NEFT / RTGS'], ['IMPS / UPI', 'IMPS / UPI'], ['Cheque', 'Cheque · चेक · ચેક'],
      ['Cash', 'Cash · नकद · રોકડ'], ['Other', 'Other · अन्य · અન્ય'],
    ];
    const MAX_FILES = 5, MAX_FILE = 4 * 1024 * 1024, MAX_TOTAL = 7 * 1024 * 1024;
    let files = [];
    const html = `
      <div id="db-up-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:540px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;flex-shrink:0;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:10px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 8h12M6 13l6 8M6 13h4a4 4 0 0 0 0-8"/></svg>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;color:#0f172a;">Urgent Payment Request</div>
                <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">तत्काल भुगतान अनुरोध · તાત્કાલિક ચુકવણી વિનંતી</div>
              </div>
            </div>
            <button id="db-up-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                ${lbl('Requested By', 'अनुरोधकर्ता', 'વિનંતી કરનાર')}
                <input id="db-up-by" style="${ro}" value="${esc(me.name || me.email || '')}" readonly />
              </div>
              <div>
                ${lbl('Department', 'विभाग', 'વિભાગ')}
                <input id="db-up-dept" style="${inp}" value="${esc(me.department || '')}" placeholder="Department" />
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                ${lbl('Request Date', 'अनुरोध की तारीख', 'વિનંતીની તારીખ', true)}
                <input id="db-up-date" type="date" style="${inp}" value="${today}" />
              </div>
              <div>
                ${lbl('Payment Required By', 'भुगतान कब तक चाहिए', 'ચુકવણી ક્યાં સુધી જોઈએ', true)}
                <input id="db-up-required" type="date" style="${inp}" value="${today}" min="${today}" />
              </div>
            </div>
            <div>
              ${lbl('Pay To (Party / Vendor Name)', 'किसे भुगतान करना है (पार्टी / विक्रेता)', 'કોને ચુકવણી કરવાની છે (પાર્ટી / વિક્રેતા)', true)}
              <input id="db-up-payee" style="${inp}" placeholder="Who is to be paid" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                ${lbl('Amount (₹)', 'राशि', 'રકમ', true)}
                <input id="db-up-amount" type="number" min="1" step="0.01" style="${inp}" placeholder="0.00" />
              </div>
              <div>
                ${lbl('Payment Mode', 'भुगतान का तरीका', 'ચુકવણીની રીત')}
                <select id="db-up-mode" style="${inp}">
                  ${modes.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div>
              ${lbl('Purpose of Payment', 'भुगतान का उद्देश्य', 'ચુકવણીનો હેતુ', true)}
              <textarea id="db-up-purpose" rows="3" style="${inp}resize:none;font-family:inherit;" placeholder="Why is this payment urgent? What is it for?"></textarea>
            </div>
            <div>
              ${lbl('Bill / Invoice / Reference No.', 'बिल / इनवॉइस / संदर्भ नंबर', 'બિલ / ઇન્વોઇસ / સંદર્ભ નંબર')}
              <input id="db-up-ref" style="${inp}" placeholder="Optional" />
            </div>
            <div>
              ${lbl('Bank Details of Payee', 'प्राप्तकर्ता के बैंक विवरण', 'લાભાર્થીની બેંક વિગતો')}
              <textarea id="db-up-bank" rows="2" style="${inp}resize:none;font-family:inherit;" placeholder="Account name, A/c no., IFSC, bank — or UPI id (optional)"></textarea>
            </div>
            <div>
              ${lbl('Supporting Documents', 'सहायक दस्तावेज़ (बिल, कोटेशन)', 'સહાયક દસ્તાવેજો (બિલ, ક્વોટેશન)')}
              <input id="db-up-files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx" style="display:none" />
              <button type="button" id="db-up-files-btn" style="display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:8px;border:1.5px dashed #cbd5e1;background:#f8fafc;color:#475569;font-size:12.5px;font-weight:600;cursor:pointer;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                Attach files · फ़ाइल जोड़ें · ફાઇલ જોડો
              </button>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">PDF, images, Excel or Word · up to 5 files, 4 MB each</div>
              <div id="db-up-files-list" style="display:flex;flex-direction:column;gap:4px;margin-top:6px;"></div>
            </div>
            <div>
              ${lbl('Remarks', 'टिप्पणी', 'નોંધ')}
              <input id="db-up-remarks" style="${inp}" placeholder="Optional" />
            </div>
            <div id="db-up-err" style="display:none;font-size:12px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:7px;padding:8px 12px;"></div>
          </div>
          <div style="padding:16px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
            <button id="db-up-cancel" class="btn-secondary">Cancel</button>
            <button id="db-up-submit" class="btn-primary" style="background:#dc2626;border-color:#dc2626;">Submit · भेजें · મોકલો</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const closeModal = () => { document.getElementById('db-up-modal')?.remove(); };
    document.getElementById('db-up-modal').addEventListener('click', closeModal);
    document.getElementById('db-up-close').addEventListener('click', closeModal);
    document.getElementById('db-up-cancel').addEventListener('click', closeModal);
    document.getElementById('db-up-payee')?.focus();

    const errEl = document.getElementById('db-up-err');
    const fail  = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };
    const fmtSize = (n) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const renderFiles = () => {
      const box = document.getElementById('db-up-files-list');
      if (!box) return;
      box.innerHTML = files.map((f, i) => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#334155;background:#f1f5f9;border-radius:6px;padding:4px 8px;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
          <span style="color:#94a3b8;flex-shrink:0;">${fmtSize(f.size)}</span>
          <button type="button" data-rm="${i}" style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:0 2px;font-size:14px;line-height:1;" title="Remove">&times;</button>
        </div>`).join('');
      box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { files.splice(+b.dataset.rm, 1); renderFiles(); }));
    };
    const fileInput = document.getElementById('db-up-files');
    document.getElementById('db-up-files-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      errEl.style.display = 'none';
      for (const f of Array.from(fileInput.files || [])) {
        if (files.length >= MAX_FILES) { fail(`At most ${MAX_FILES} files.`); break; }
        if (f.size > MAX_FILE) { fail(`"${f.name}" is over 4 MB.`); continue; }
        if (files.reduce((n, x) => n + x.size, 0) + f.size > MAX_TOTAL) { fail('All files together must be under 7 MB.'); break; }
        if (!files.some(x => x.name === f.name && x.size === f.size)) files.push(f);
      }
      fileInput.value = '';
      renderFiles();
    });
    const readAsDataUrl = (f) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read ' + f.name));
      r.readAsDataURL(f);
    });

    document.getElementById('db-up-submit').addEventListener('click', async () => {
      const v = (id) => (document.getElementById(id)?.value ?? '').trim();
      const btn   = document.getElementById('db-up-submit');
      const body = {
        request_date: v('db-up-date'),
        required_by:  v('db-up-required'),
        department:   v('db-up-dept'),
        payee:        v('db-up-payee'),
        amount:       v('db-up-amount'),
        payment_mode: v('db-up-mode'),
        purpose:      v('db-up-purpose'),
        reference_no: v('db-up-ref'),
        bank_details: v('db-up-bank'),
        remarks:      v('db-up-remarks'),
      };
      if (!body.payee)                      return fail('Please enter who is to be paid. · किसे भुगतान करना है, लिखें।');
      if (!(Number(body.amount) > 0))       return fail('Please enter a valid amount. · सही राशि लिखें।');
      if (!body.purpose)                    return fail('Please describe the purpose of the payment. · भुगतान का उद्देश्य लिखें।');
      if (!body.required_by)                return fail('Please pick the date the payment is required by. · तारीख चुनें।');
      errEl.style.display = 'none';

      btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        body.documents = [];
        for (const f of files) body.documents.push({ name: f.name, dataUrl: await readAsDataUrl(f) });
        const r = await Utils.apiFetch('/api/urgent-payments', { method: 'POST', body: JSON.stringify(body) });
        closeModal();
        Utils.showToast(`Urgent payment request ${r?.id || ''} submitted — approvers and Accounts have been mailed`, 'success');
        if (r?.documentsFailed) Utils.showToast('The request was saved but its documents could not be stored — please mail them to Accounts.', 'error');
        if (window.Sidebar?.refreshBadge) { try { window.Sidebar.refreshBadge(); } catch {} }
      } catch (e) {
        fail(e.message || 'Failed to submit the request.');
        btn.disabled = false; btn.textContent = 'Submit · भेजें · મોકલો';
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
    el.querySelectorAll('.db-upc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _state.upcomingDays = Number(btn.dataset.days) || 15;
        _updateTasksTable(admin);
      });
    });

    /* ── stat cards (click to filter the tasks table) ── */
    el.querySelectorAll('.db-stat-card[data-filter]').forEach(card => {
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
      });
      card.addEventListener('click', () => {
        _state.subTab = card.dataset.filter;
        if (card.dataset.filter === 'Upcoming') _state.upcomingDays = 15;
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
      // Stat cards below are only updated once the fetch for the NEW employee succeeds
      // (see the `if (newData)` block). If it fails, _state.userFilter/label must not be
      // left pointing at the new employee while the stat cards still show the PREVIOUS
      // employee's numbers — that mismatch (stale stat count, correctly-empty task list)
      // is exactly what looks like "pending count doesn't match the list".
      const prevFilter = _state.userFilter;
      const prevLabel  = empLabel?.textContent;
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
        // Always pass ?doer explicitly (even for "All") — the server tells apart a
        // bare request (role-based default: everyone for Admin, personal for HOD)
        // from an explicit "All" pick (everyone for Admin, whole team for HOD).
        const url = `/api/dashboard?doer=${encodeURIComponent(val)}`;
        const newData = await Utils.apiFetch(url);
        if (!newData) throw new Error('No data returned');
        _state.data = newData;
        /* update stat cards */
        const statTotal     = el.querySelector('#db-stat-total');
        const statCompleted = el.querySelector('#db-stat-completed');
        const statPending   = el.querySelector('#db-stat-pending');
        const statUpcoming  = el.querySelector('#db-stat-upcoming');
        const statRevised   = el.querySelector('#db-stat-revised');
        const statRevisedC  = el.querySelector('#db-stat-revised-count');
        if (statTotal)     statTotal.textContent     = newData.total;
        if (statCompleted) statCompleted.textContent = newData.completed;
        if (statPending)   statPending.textContent   = newData.pending;
        _paintUpcomingStat();
        if (statRevisedC)  statRevisedC.textContent  = newData.revised || 0;
        if (statRevised) {
          statRevised.textContent = newData.revised > 0 ? `+ ${newData.revised} shifted` : '';
          statRevised.style.display = newData.revised > 0 ? '' : 'none';
        }
        /* update tile sub-labels */
        const b = taskTypeBreakdown(newData.pendingTasks);
        const statTotalSub     = el.querySelector('#db-stat-total-sub');
        const statPendingSub   = el.querySelector('#db-stat-pending-sub');
        const statCompletedBar = el.querySelector('#db-stat-completed-bar');
        const statCompletedSub = el.querySelector('#db-stat-completed-sub');
        const statRevisedSub   = el.querySelector('#db-stat-revised-sub');
        const pct = newData.total ? Math.round(newData.completed / newData.total * 100) : 0;
        if (statTotalSub)     statTotalSub.textContent = `${b.Delegation} del · ${b.Checklist} chk`;
        if (statPendingSub)   { statPendingSub.textContent = newData.pending > 0 ? 'Awaiting action' : 'On track'; statPendingSub.style.display = newData.revised > 0 ? 'none' : ''; }
        if (statCompletedBar) statCompletedBar.style.width = `${pct}%`;
        if (statCompletedSub) statCompletedSub.textContent = `${pct}% done`;
        if (statRevisedSub)   statRevisedSub.textContent = (newData.revised || 0) > 0 ? 'Needs rework' : 'None pending';
        /* update pie chart */
        const pieEl = el.querySelector('#db-pie-container');
        if (pieEl) pieEl.innerHTML = renderPieSVG(newData.completed, newData.pending, newData.revised, newData.upcoming || 0);
      } catch(e) {
        /* revert so stat cards and the task list stay consistent with each other */
        _state.userFilter = prevFilter;
        if (empLabel && prevLabel !== undefined) empLabel.textContent = prevLabel;
        Utils.showToast('Failed to load tasks for this employee — please try again', 'error');
      }
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
    }, { signal: window.Router.pageSignal() });

    /* hover style for options */
    if (empList) {
      empList.addEventListener('mouseover', e => { const o = e.target.closest('.db-emp-opt'); if (o && o.dataset.empVal !== _state.userFilter) o.style.background = '#f8fafc'; });
      empList.addEventListener('mouseout',  e => { const o = e.target.closest('.db-emp-opt'); if (o && o.dataset.empVal !== _state.userFilter) o.style.background = ''; });
    }

    /* ── delegate / checklist forms — shared with All Tasks (js/components/task-forms.js) ── */
    el.querySelector('#db-btn-delegate')?.addEventListener('click', () =>
      window.TaskForms.openDelegate({ users: _state.users, onSaved: () => _refresh(admin) }));
    el.querySelector('#db-btn-checklist')?.addEventListener('click', () =>
      window.TaskForms.openChecklist({ users: _state.users, onSaved: () => _refresh(admin) }));

    const btnHelpTicket = el.querySelector('#db-btn-help-ticket');
    if (btnHelpTicket) btnHelpTicket.addEventListener('click', () => _openHelpTicketModal());

    const btnUrgentPayment = el.querySelector('#db-btn-urgent-payment');
    if (btnUrgentPayment) btnUrgentPayment.addEventListener('click', () => _openUrgentPaymentModal());

    const btnAnnouncement = el.querySelector('#db-btn-announcement');
    if (btnAnnouncement) btnAnnouncement.addEventListener('click', () => _openAnnouncementModal(admin));

    const btnLeave = el.querySelector('#db-btn-leave');
    if (btnLeave) btnLeave.addEventListener('click', () => _openLeaveModal());

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
        // 'Unpaid' is what the list reads to colour a row red, and what the
        // company's own sheet calls UL.
        const unpaid = !!el.querySelector('#hol-unpaid')?.checked;
        const type = unpaid ? 'Unpaid' : 'Holiday';
        const result = await Utils.apiFetch('/api/holidays', {
          method: 'POST',
          body: JSON.stringify({ date, name, type }),
        });
        if (result?.id) _state.holidays.push({ id: result.id, date, name, type });
        if (el.querySelector('#hol-date'))  el.querySelector('#hol-date').value  = '';
        if (el.querySelector('#hol-name'))  el.querySelector('#hol-name').value  = '';
        if (el.querySelector('#hol-unpaid')) el.querySelector('#hol-unpaid').checked = false;
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
      if (task.type === 'PI') {
        // The work is on the Proforma Invoice page: open that PI's Add Price
        // screen and come back here once the price is saved. Anything that
        // would strand the user there (already priced, no permission) is
        // reported instead.
        const pi = window.Pages?.['proforma-invoice'];
        if (!pi?.openPriceFor) { Utils.showToast('The Proforma Invoice page is not loaded', 'error'); return; }
        const result = await pi.openPriceFor(task.piNo, { returnTo: 'dashboard' });
        if (!result.ok) Utils.showToast(result.reason || 'Could not open the Add Price screen', 'error');
        return;
      }
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
        // FMS needs delay-reason/extra-field input, so it opens the shared modal
        // instead of completing in place — the modal's own save flow refreshes
        // the dashboard, so skip the generic toast+refresh below.
        const detail = await Utils.apiFetch(`/api/fms-tasks/${task.fmsId}`);
        const step = (detail?.steps || []).find(s => s.id === task.stepId);
        if (!step) { Utils.showToast('Step not found', 'error'); return; }
        window.FmsDoneModal.open({
          fmsId: task.fmsId, step,
          row: { rowNumber: task.rowNumber, planValue: task.planValue, data: task.details },
          onSaved: () => _refresh(admin),
        });
        return;
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
    if (statPending)   statPending.textContent   = dashData.pending;
    if (statCompleted) statCompleted.textContent = dashData.completed;
    if (statTotal)     statTotal.textContent     = admin ? dashData.total : dashData.pendingTasks.length;
    _paintUpcomingStat();
    if (statRevisedC)  statRevisedC.textContent  = dashData.revised || 0;
    if (statRevised) {
      statRevised.textContent = dashData.revised > 0 ? `+ ${dashData.revised} revised` : '';
      statRevised.style.display = dashData.revised > 0 ? '' : 'none';
    }
    const b = taskTypeBreakdown(dashData.pendingTasks);
    const statTotalSub     = wrap.querySelector('#db-stat-total-sub');
    const statPendingSub   = wrap.querySelector('#db-stat-pending-sub');
    const statCompletedBar = wrap.querySelector('#db-stat-completed-bar');
    const statCompletedSub = wrap.querySelector('#db-stat-completed-sub');
    const statRevisedSub   = wrap.querySelector('#db-stat-revised-sub');
    const pct = dashData.total ? Math.round(dashData.completed / dashData.total * 100) : 0;
    if (statTotalSub)     statTotalSub.textContent = `${b.Delegation} del · ${b.Checklist} chk`;
    if (statPendingSub)   { statPendingSub.textContent = dashData.pending > 0 ? 'Awaiting action' : 'On track'; statPendingSub.style.display = dashData.revised > 0 ? 'none' : ''; }
    if (statCompletedBar) statCompletedBar.style.width = `${pct}%`;
    if (statCompletedSub) statCompletedSub.textContent = `${pct}% done`;
    if (statRevisedSub)   statRevisedSub.textContent = (dashData.revised || 0) > 0 ? 'Needs rework' : 'None pending';
    const pieEl = wrap.querySelector('#db-pie-container');
    if (pieEl) pieEl.innerHTML = renderPieSVG(dashData.completed, dashData.pending, dashData.revised, dashData.upcoming || 0);

    _paintMeetings();
    _updateTasksTable(admin);
  }

  return { render };
})();
