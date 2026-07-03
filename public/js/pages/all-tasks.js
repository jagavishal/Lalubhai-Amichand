window.Pages['all-tasks'] = (function () {
  /* ─── state ─────────────────────────────────────────────────────────────── */
  let _users    = [];
  let _grouped  = [];          // [{ doer, tasks:[] }]
  let _tab      = 'Delegation';
  let _statusTab = 'All';
  let _expanded  = {};          // { [doer]: true }
  let _search    = '';
  let _employeeFilter = 'All';
  let _fromDate  = '';
  let _toDate    = '';

  /* ─── helpers ───────────────────────────────────────────────────────────── */
  const isAdmin = () => {
    const roles = window.currentUser?.roles;
    if (!roles) return false;
    if (Array.isArray(roles)) return roles.includes('Admin') || roles.includes('HOD');
    return String(roles).includes('Admin') || String(roles).includes('HOD');
  };

  const hasFeature = (feat) => {
    if (isAdmin()) return true;
    const perms = window.currentUser?.permissions;
    if (!perms || !perms.features) return true;
    const pageFeats = perms.features['all-tasks'];
    if (!pageFeats) return false;
    return pageFeats.includes(feat);
  };

  const currentUserName = () => window.currentUser?.name || '';
  const currentUserId   = () => window.currentUser?.id   || '';

  const fmt = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getUserName = (id) => _users.find(u => u.id === id)?.name || id || '—';

  const STATUS_RANK = { revise: 0, revise_requested: 1, pending: 2, done: 3 };

  const TAB_TYPE = {
    'Delegation':     'delegation',
    'Checklist':      'Checklist',
    'Delegate by Me': 'delegation',
  };

  function getBaseGroups(tab) {
    return (isAdmin() || tab === 'Delegate by Me')
      ? _grouped
      : _grouped.filter(g => g.doer === currentUserName());
  }

  function tabCount(tabName) {
    const all = getBaseGroups(tabName).flatMap(g => g.tasks);
    if (tabName === 'Delegate by Me') {
      return all.filter(t =>
        (t.type || 'delegation').toLowerCase() === 'delegation' &&
        t.delegatedBy === currentUserId()
      ).length;
    }
    const wantType = TAB_TYPE[tabName];
    return wantType
      ? all.filter(t => (t.type || 'delegation').toLowerCase() === wantType.toLowerCase()).length
      : all.length;
  }

  function filterTasks(tasks) {
    let arr = tasks.slice();

    if (_tab === 'Delegate by Me') {
      arr = arr.filter(t =>
        (t.type || 'delegation').toLowerCase() === 'delegation' &&
        t.delegatedBy === currentUserId()
      );
    } else {
      const wantType = TAB_TYPE[_tab];
      if (wantType) arr = arr.filter(t => (t.type || 'delegation').toLowerCase() === wantType.toLowerCase());
    }

    if (_statusTab === 'Pending')   arr = arr.filter(t => t.status === 'pending' || t.status === 'revise');
    if (_statusTab === 'Completed') arr = arr.filter(t => t.status === 'done');

    if (_fromDate) arr = arr.filter(t => t.dueDate && new Date(t.dueDate) >= new Date(_fromDate));
    if (_toDate)   arr = arr.filter(t => t.dueDate && new Date(t.dueDate) <= new Date(_toDate));

    if (_search) {
      const s = _search.toLowerCase();
      arr = arr.filter(t =>
        (t.description || '').toLowerCase().includes(s) ||
        (t.client || '').toLowerCase().includes(s)
      );
    }

    arr.sort((a, b) => (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2));
    return arr;
  }

  function getVisibleGroups() {
    return getBaseGroups(_tab)
      .filter(g => _employeeFilter === 'All' || g.doer === _employeeFilter)
      .map(g => ({ ...g, tasks: filterTasks(g.tasks) }))
      .filter(g => g.tasks.length > 0);
  }

  /* ─── data fetch ────────────────────────────────────────────────────────── */
  async function fetchData() {
    const [delegations, masters, users] = await Promise.all([
      Utils.apiFetch('/api/delegations'),
      Utils.apiFetch('/api/masters'),
      Utils.apiFetch('/api/users'),
    ]);
    if (!delegations || !masters || !users) return false;

    _users = users;

    // Build grouped structure: merge delegations + checklist masters
    const allTasks = [
      ...delegations.map(d => ({ ...d, type: d.type || 'delegation' })),
      ...masters.map(m => ({
        id:          m.id,
        description: m.task,
        doer:        m.assignedTo || '',
        doerId:      null,
        delegatedBy: null,
        dueDate:     null,
        client:      '',
        status:      'pending',
        type:        'Checklist',
        priority:    'Low',
        remarks:     '',
        url:         '',
        createdAt:   m.createdAt || m.created_at || '',
      })),
    ];

    // Group by doer
    const map = {};
    for (const t of allTasks) {
      const doer = t.doer || '(Unassigned)';
      if (!map[doer]) map[doer] = [];
      map[doer].push(t);
    }
    _grouped = Object.entries(map).map(([doer, tasks]) => ({ doer, tasks }));
    return true;
  }

  /* ─── API actions ───────────────────────────────────────────────────────── */
  async function updateStatus(id, status) {
    try {
      await Utils.apiFetch('/api/delegations', {
        method: 'PATCH',
        body: JSON.stringify({ id, status }),
      });
      await reload();
    } catch (e) {
      Utils.showToast(e.message, 'error');
    }
  }

  async function markChecklistDone(masterId) {
    try {
      await Utils.apiFetch('/api/checklist-completions', {
        method: 'POST',
        body: JSON.stringify({ masterId }),
      });
      // Remove from list locally (checklist done = not shown again until reset)
      await reload();
    } catch (e) {
      Utils.showToast(e.message, 'error');
    }
  }

  async function deleteTask(id, type) {
    if (!await Utils.showConfirm('This will permanently remove the task.', { title: 'Delete Task', confirmText: 'Delete', danger: true })) return;
    try {
      if (type === 'Checklist') {
        await Utils.apiFetch('/api/masters?id=' + id, { method: 'DELETE' });
      } else {
        await Utils.apiFetch('/api/delegations?id=' + id, { method: 'DELETE' });
      }
      Utils.showToast('Task deleted');
      await reload();
    } catch (e) {
      Utils.showToast(e.message, 'error');
    }
  }

  async function reload() {
    const ok = await fetchData();
    if (ok) renderContent();
  }

  /* ─── avatar ────────────────────────────────────────────────────────────── */
  function avatarHTML(name = '') {
    const ini = name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || '·';
    const palette = [
      'linear-gradient(135deg,#f87171,#db2777)',
      'linear-gradient(135deg,#fbbf24,#ea580c)',
      'linear-gradient(135deg,#34d399,#0d9488)',
      'linear-gradient(135deg,#60a5fa,#6366f1)',
      'linear-gradient(135deg,#a78bfa,#9333ea)',
    ];
    const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const grad = palette[hash % palette.length];
    return `<div style="width:32px;height:32px;border-radius:50%;background:${grad};color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700;flex-shrink:0">${esc(ini)}</div>`;
  }

  /* ─── escape ────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ─── status pill ───────────────────────────────────────────────────────── */
  function statusPill(status) {
    const map = {
      done:             { bg: '#d1fae5', color: '#065f46', label: 'Done' },
      revise:           { bg: '#fef3c7', color: '#92400e', label: 'Shifted' },
      revise_requested: { bg: '#ffedd5', color: '#9a3412', label: 'Shifted' },
      pending:          { bg: '#fee2e2', color: '#991b1b', label: 'Pending' },
    };
    const s = map[status] || map.pending;
    return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${s.bg};color:${s.color}">${s.label}</span>`;
  }

  /* ─── render task row ───────────────────────────────────────────────────── */
  function taskRowHTML(t, serial) {
    const canEdit   = t.type !== 'Checklist';
    const canRevise = t.type !== 'Checklist' && t.status !== 'done' && t.status !== 'revise' && t.status !== 'revise_requested';
    const canDone   = t.status !== 'done';

    const editBtn = (canEdit && hasFeature('edit'))
      ? `<button class="at-action-btn at-btn-amber" title="Edit" onclick="window._atEditTask('${esc(t.id)}')">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
         </button>`
      : '';

    const delBtn = hasFeature('delete')
      ? `<button class="at-action-btn at-btn-red" title="Delete" onclick="window._atDeleteTask('${esc(t.id)}','${esc(t.type)}')">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
         </button>`
      : '';

    const doneBtn = canDone
      ? (t.type === 'Checklist'
          ? `<button class="at-pill-btn at-pill-green" onclick="window._atChecklistDone('${esc(t.id)}')">Done</button>`
          : `<button class="at-pill-btn at-pill-green" onclick="window._atMarkDone('${esc(t.id)}')">Done</button>`)
      : '';

    const reviseBtn = (canRevise && t.type !== 'Checklist')
      ? `<button class="at-pill-btn at-pill-amber" onclick="window._atMarkRevise('${esc(t.id)}')">Shifted</button>`
      : '';

    const urlLink = t.url
      ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" style="flex-shrink:0;color:#6366f1;margin-top:2px">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
         </a>`
      : '';

    const transferredBadge = t.transferredFrom
      ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;margin-top:2px">
           &#x1F504; from ${esc(t.transferredFrom)}
         </span>`
      : '';

    return `
      <tr class="at-table-row" data-id="${esc(t.id)}">
        <td class="at-td" style="font-size:11px;color:#94a3b8;font-family:monospace;padding-right:4px">${serial}</td>
        <td class="at-td">
          <div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap">
            ${editBtn}${delBtn}${doneBtn}${reviseBtn}
          </div>
        </td>
        <td class="at-td" style="max-width:280px">
          <div style="display:flex;align-items:flex-start;gap:4px">
            <span style="font-weight:500;color:#1e293b">${esc(t.description)}</span>
            ${urlLink}
          </div>
          ${transferredBadge}
        </td>
        <td class="at-td" style="color:#475569;white-space:nowrap">${esc(t.doer || '—')}</td>
        <td class="at-td" style="color:#64748b;white-space:nowrap">${esc(getUserName(t.delegatedBy))}</td>
        <td class="at-td" style="color:#64748b;white-space:nowrap;font-size:12px">${fmt(t.dueDate)}</td>
        <td class="at-td" style="color:#94a3b8;max-width:160px;font-size:12px">${esc(t.remarks || '—')}</td>
        <td class="at-td">${statusPill(t.status)}</td>
      </tr>`;
  }

  /* ─── render group row ──────────────────────────────────────────────────── */
  function groupHTML(g, groupIdx, startSerial) {
    const pending   = g.tasks.filter(t => t.status === 'pending').length;
    const completed = g.tasks.filter(t => t.status === 'done').length;
    const revised   = g.tasks.filter(t => t.status === 'revise').length;
    const open      = !!_expanded[g.doer];
    const endSerial = startSerial + g.tasks.length - 1;

    const pills = [
      completed > 0 ? `<span class="at-pill" style="background:#d1fae5;color:#065f46">${completed} done</span>`     : '',
      pending   > 0 ? `<span class="at-pill" style="background:#fee2e2;color:#991b1b">${pending} pending</span>`   : '',
      revised   > 0 ? `<span class="at-pill" style="background:#fef3c7;color:#92400e">${revised} shifted</span>` : '',
    ].join('');

    const tableHTML = open ? `
      <div style="border-top:1px solid #f1f5f9;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f8fafc">
              <th class="at-th">#</th>
              <th class="at-th">Action</th>
              <th class="at-th">Description</th>
              <th class="at-th">Doer</th>
              <th class="at-th">Assignee</th>
              <th class="at-th">Due Date</th>
              <th class="at-th">Remarks</th>
              <th class="at-th">Status</th>
            </tr>
          </thead>
          <tbody>
            ${g.tasks.map((t, i) => taskRowHTML(t, startSerial + i)).join('')}
          </tbody>
        </table>
      </div>` : '';

    return `
      <li style="border-bottom:1px solid #f1f5f9">
        <button class="at-group-btn" onclick="window._atToggleGroup('${esc(g.doer)}')"
          style="width:100%;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;background:none;border:none;cursor:pointer;text-align:left;transition:background 0.15s"
          onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='none'">
          <span style="display:flex;align-items:center;gap:12px">
            <span style="color:#94a3b8;transition:transform 0.2s;transform:rotate(${open ? 90 : 0}deg);display:inline-flex">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </span>
            <span style="font-size:12px;font-family:monospace;color:#94a3b8;min-width:20px;text-align:right">${groupIdx + 1}.</span>
            ${avatarHTML(g.doer)}
            <span style="font-weight:500;color:#1e293b;font-size:14px">${esc(g.doer)}</span>
            <span style="font-size:12px;color:#94a3b8">(${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'} · #${startSerial}–#${endSerial})</span>
          </span>
          <div style="display:flex;gap:6px;align-items:center">${pills}</div>
        </button>
        ${tableHTML}
      </li>`;
  }

  /* ─── main content render ───────────────────────────────────────────────── */
  function renderContent() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const visGroups = getVisibleGroups();
    const totalTasks = visGroups.reduce((s, g) => s + g.tasks.length, 0);

    const admin = isAdmin();

    /* top action buttons */
    const actionBtns = admin
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
           ${hasFeature('transfer') ? `<button id="at-transfer-btn" class="at-btn at-btn-secondary">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 3 4 4-4 4"/><path d="M21 7H4"/><path d="m7 21-4-4 4-4"/><path d="M3 17h17"/></svg>
             Transfer
           </button>` : ''}
           <button id="at-checklist-btn" class="at-btn" style="background:#10b981;color:#fff;border-color:#10b981">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
             Checklist
           </button>
           ${hasFeature('delegate') ? `<button id="at-delegate-btn" class="at-btn at-btn-primary">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
             Delegate Task
           </button>` : ''}
         </div>`
      : `<button id="at-my-transfer-btn" class="at-btn at-btn-secondary">
           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 3 4 4-4 4"/><path d="M21 7H4"/><path d="m7 21-4-4 4-4"/><path d="M3 17h17"/></svg>
           Transfer My Tasks
         </button>`;

    /* tab buttons */
    const tabBtns = ['Delegation', 'Checklist', 'Delegate by Me'].map(t => {
      const cnt   = tabCount(t);
      const active = t === _tab;
      return `<button class="at-seg-btn${active ? ' at-seg-active' : ''}" data-tab="${esc(t)}">
        ${esc(t)}
        <span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:999px;font-size:10px;font-weight:700;padding:0 3px;background:${active ? 'rgba(255,255,255,0.3)' : '#e2e8f0'};color:${active ? 'inherit' : '#475569'}">${cnt}</span>
      </button>`;
    }).join('');

    /* employee filter (admin only) */
    const empFilter = admin
      ? `<select id="at-emp-filter" style="height:32px;padding:0 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff">
           <option value="All">All Employees</option>
           ${_users.map(u => `<option value="${esc(u.name)}"${_employeeFilter === u.name ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
         </select>`
      : '';

    /* clear filters btn */
    const clearBtn = (_fromDate || _toDate || _employeeFilter !== 'All')
      ? `<button id="at-clear-filters" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:500;color:#64748b;background:#f1f5f9;border:none;cursor:pointer">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
           Clear
         </button>`
      : '';

    /* status tabs */
    const statusBtns = ['All', 'Pending', 'Completed'].map(t =>
      `<button class="at-seg-btn${_statusTab === t ? ' at-seg-active' : ''}" data-stab="${esc(t)}">${esc(t)}</button>`
    ).join('');

    /* groups list */
    let serial = 1;
    const groupsHTML = visGroups.length === 0
      ? `<div style="padding:56px;text-align:center">
           <div style="width:56px;height:56px;border-radius:12px;background:#f1f5f9;display:grid;place-items:center;margin:0 auto 12px">
             <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
           </div>
           <div style="font-size:14px;font-weight:500;color:#475569">No tasks match the filters</div>
           <div style="font-size:12px;color:#94a3b8;margin-top:4px">Try clearing search or changing the tab.</div>
         </div>`
      : `<ul style="list-style:none;margin:0;padding:0">
           ${visGroups.map((g, i) => {
             const s = serial;
             serial += g.tasks.length;
             return groupHTML(g, i, s);
           }).join('')}
         </ul>`;

    el.innerHTML = `
      <style>
        .at-btn { display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid transparent;cursor:pointer;transition:opacity 0.15s }
        .at-btn:hover { opacity:0.85 }
        .at-btn-primary  { background:#6366f1;color:#fff;border-color:#6366f1 }
        .at-btn-secondary { background:#fff;color:#374151;border-color:#e2e8f0 }
        .at-seg { display:inline-flex;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden }
        .at-seg-btn { padding:6px 14px;font-size:13px;font-weight:500;background:#fff;color:#64748b;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background 0.15s }
        .at-seg-btn:not(:last-child) { border-right:1px solid #e2e8f0 }
        .at-seg-active { background:#6366f1;color:#fff }
        .at-pill { display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600 }
        .at-pill-btn { display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;border:none;cursor:pointer;transition:opacity 0.15s }
        .at-pill-btn:hover { opacity:0.8 }
        .at-pill-green { background:#d1fae5;color:#065f46 }
        .at-pill-amber { background:#fef3c7;color:#92400e }
        .at-action-btn { width:28px;height:28px;border-radius:6px;display:grid;place-items:center;border:none;cursor:pointer;background:transparent;transition:background 0.15s }
        .at-btn-amber { color:#f59e0b } .at-btn-amber:hover { background:#fef3c7 }
        .at-btn-red   { color:#ef4444 } .at-btn-red:hover   { background:#fee2e2 }
        .at-th { padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#64748b;white-space:nowrap;border-bottom:1px solid #f1f5f9 }
        .at-td { padding:10px 12px;vertical-align:middle;border-bottom:1px solid #f8fafc }
        .at-table-row:hover { background:#fafafa }
        .at-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden }
        .at-input { height:34px;padding:0 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;outline:none }
        .at-input:focus { border-color:#6366f1 }
      </style>

      <div style="display:flex;flex-direction:column;gap:20px">

        <!-- Top actions -->
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
          ${actionBtns}
        </div>

        <!-- Filter bar -->
        <div class="at-card" style="padding:12px 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="at-seg" id="at-tab-seg">${tabBtns}</div>
          <div style="width:1px;height:24px;background:#e2e8f0;margin:0 4px"></div>
          ${empFilter}
          <input type="date" id="at-from-date" value="${_fromDate}" class="at-input" style="width:auto" />
          <span style="font-size:12px;color:#94a3b8">to</span>
          <input type="date" id="at-to-date" value="${_toDate}" class="at-input" style="width:auto" />
          ${clearBtn}
          <div style="flex:1"></div>
          <div style="position:relative">
            <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="at-search" type="text" placeholder="Search description, client…" value="${esc(_search)}"
              class="at-input" style="padding-left:34px;width:220px" />
          </div>
        </div>

        <!-- Status tabs + summary + expand controls -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div class="at-seg" id="at-status-seg">${statusBtns}</div>
          <div style="font-size:13px;color:#475569">
            <b style="color:#1e293b">${visGroups.length}</b> doer${visGroups.length === 1 ? '' : 's'} ·
            <b style="color:#1e293b">${totalTasks}</b> task${totalTasks === 1 ? '' : 's'}
          </div>
          <div style="display:flex;gap:4px">
            <button id="at-expand-all"   style="padding:4px 10px;border-radius:6px;font-size:12px;background:none;border:1px solid #e2e8f0;cursor:pointer;color:#475569">Expand all</button>
            <button id="at-collapse-all" style="padding:4px 10px;border-radius:6px;font-size:12px;background:none;border:1px solid #e2e8f0;cursor:pointer;color:#475569">Collapse all</button>
          </div>
        </div>

        <!-- Groups -->
        <div class="at-card">${groupsHTML}</div>

      </div>`;

    bindEvents();
  }

  /* ─── event binding ─────────────────────────────────────────────────────── */
  function bindEvents() {
    /* tab buttons */
    document.querySelectorAll('#at-tab-seg .at-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _tab = btn.dataset.tab;
        renderContent();
      });
    });

    /* status tabs */
    document.querySelectorAll('#at-status-seg .at-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _statusTab = btn.dataset.stab;
        renderContent();
      });
    });

    /* employee filter */
    const empSel = document.getElementById('at-emp-filter');
    if (empSel) empSel.addEventListener('change', () => { _employeeFilter = empSel.value; renderContent(); });

    /* date filters */
    const fromInput = document.getElementById('at-from-date');
    if (fromInput) fromInput.addEventListener('change', () => { _fromDate = fromInput.value; renderContent(); });
    const toInput = document.getElementById('at-to-date');
    if (toInput) toInput.addEventListener('change', () => { _toDate = toInput.value; renderContent(); });

    /* clear filters */
    const clearBtn = document.getElementById('at-clear-filters');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      _fromDate = ''; _toDate = ''; _employeeFilter = 'All';
      renderContent();
    });

    /* search */
    const searchInput = document.getElementById('at-search');
    if (searchInput) {
      let debounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { _search = searchInput.value; renderContent(); }, 200);
      });
    }

    /* expand / collapse all */
    const visGroups = getVisibleGroups();
    document.getElementById('at-expand-all')?.addEventListener('click', () => {
      visGroups.forEach(g => { _expanded[g.doer] = true; });
      renderContent();
    });
    document.getElementById('at-collapse-all')?.addEventListener('click', () => {
      _expanded = {};
      renderContent();
    });

    /* action buttons */
    document.getElementById('at-delegate-btn')?.addEventListener('click', () => openDelegateModal());
    document.getElementById('at-checklist-btn')?.addEventListener('click', () => openChecklistModal());
    document.getElementById('at-transfer-btn')?.addEventListener('click', () => openTransferModal());
    document.getElementById('at-my-transfer-btn')?.addEventListener('click', () => openMyTransferModal());
  }

  /* ─── global task action callbacks (called from inline onclick) ─────────── */
  window._atToggleGroup = (doer) => {
    _expanded[doer] = !_expanded[doer];
    renderContent();
  };
  window._atMarkDone = (id) => updateStatus(id, 'done');
  window._atMarkRevise = (id) => updateStatus(id, 'revise');
  window._atChecklistDone = (id) => markChecklistDone(id);
  window._atDeleteTask = (id, type) => deleteTask(id, type);
  window._atEditTask = (id) => {
    const task = _grouped.flatMap(g => g.tasks).find(t => t.id === id);
    if (task) openEditModal(task);
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     MODALS
  ═══════════════════════════════════════════════════════════════════════════ */

  function modalOverlay(id, contentHTML) {
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
    div.innerHTML = `<div style="background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.2);width:100%;max-width:520px;overflow:hidden;display:flex;flex-direction:column;max-height:90vh">${contentHTML}</div>`;
    div.addEventListener('click', e => { if (e.target === div) div.remove(); });
    document.body.appendChild(div);
    return div;
  }

  function modalHeader(title, onClose) {
    return `<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
      <h2 style="font-size:15px;font-weight:600;color:#0f172a;margin:0">${esc(title)}</h2>
      <button onclick="${onClose}" style="width:32px;height:32px;border-radius:8px;border:none;background:none;cursor:pointer;display:grid;place-items:center;color:#94a3b8" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }

  /* ─── Delegate Task Modal ───────────────────────────────────────────────── */
  function openDelegateModal() {
    const userOpts = _users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const div = modalOverlay('at-delegate-modal', `
      ${modalHeader('Delegate Task', "document.getElementById('at-delegate-modal').remove()")}
      <div style="padding:20px 24px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px">
        <div>
          <label class="at-label">Description *</label>
          <textarea id="atd-desc" rows="3" class="at-input" style="width:100%;height:auto;padding:8px 10px;resize:none"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="at-label">Doer *</label>
            <select id="atd-doer" class="at-input" style="width:100%"><option value="">— Select —</option>${userOpts}</select>
          </div>
          <div>
            <label class="at-label">Due Date *</label>
            <input type="date" id="atd-due" class="at-input" style="width:100%" />
          </div>
        </div>
        <div>
          <label class="at-label">Priority</label>
          <select id="atd-priority" class="at-input" style="width:100%"><option>Low</option><option>Medium</option><option>High</option></select>
        </div>
        <div>
          <label class="at-label">URL <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
          <input id="atd-url" class="at-input" style="width:100%" placeholder="https://…" />
        </div>
        <div>
          <label class="at-label">Remarks</label>
          <textarea id="atd-remarks" rows="2" class="at-input" style="width:100%;height:auto;padding:8px 10px;resize:none" placeholder="Any remarks…"></textarea>
        </div>
        <p id="atd-err" style="color:#ef4444;font-size:12px;margin:0"></p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('at-delegate-modal').remove()" class="at-btn at-btn-secondary">Cancel</button>
        <button id="atd-save" class="at-btn at-btn-primary">Delegate</button>
      </div>
    `);

    document.getElementById('atd-save').addEventListener('click', async () => {
      const desc     = document.getElementById('atd-desc').value.trim();
      const doerId   = document.getElementById('atd-doer').value;
      const dueDate  = document.getElementById('atd-due').value;
      const priority = document.getElementById('atd-priority').value;
      const url      = document.getElementById('atd-url').value.trim();
      const remarks  = document.getElementById('atd-remarks').value.trim();
      const errEl    = document.getElementById('atd-err');

      if (!desc)    { errEl.textContent = 'Description is required.'; return; }
      if (!doerId)  { errEl.textContent = 'Please select a doer.'; return; }
      if (!dueDate) { errEl.textContent = 'Due date is required.'; return; }

      const btn = document.getElementById('atd-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'POST',
          body: JSON.stringify({ description: desc, doerId, dueDate, priority, url, remarks, delegatedBy: currentUserId() }),
        });
        div.remove();
        Utils.showToast('Task delegated successfully');
        await reload();
      } catch (e) {
        errEl.textContent = e.message;
        btn.disabled = false; btn.textContent = 'Delegate';
      }
    });
  }

  /* ─── Checklist Modal ───────────────────────────────────────────────────── */
  function openChecklistModal() {
    const userOpts = _users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const div = modalOverlay('at-checklist-modal', `
      ${modalHeader('Add Checklist Task', "document.getElementById('at-checklist-modal').remove()")}
      <div style="padding:20px 24px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px">
        <div>
          <label class="at-label">Task *</label>
          <textarea id="atc-task" rows="3" class="at-input" style="width:100%;height:auto;padding:8px 10px;resize:none"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="at-label">Assigned To</label>
            <select id="atc-assigned" class="at-input" style="width:100%"><option value="">— Select —</option>${userOpts}</select>
          </div>
          <div>
            <label class="at-label">Frequency</label>
            <select id="atc-freq" class="at-input" style="width:100%"><option>Daily</option><option>Weekly</option><option>Monthly</option></select>
          </div>
        </div>
        <p id="atc-err" style="color:#ef4444;font-size:12px;margin:0"></p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('at-checklist-modal').remove()" class="at-btn at-btn-secondary">Cancel</button>
        <button id="atc-save" class="at-btn" style="background:#10b981;color:#fff;border-color:#10b981">Add Checklist</button>
      </div>
    `);

    document.getElementById('atc-save').addEventListener('click', async () => {
      const task     = document.getElementById('atc-task').value.trim();
      const assignedSel = document.getElementById('atc-assigned');
      const assignedId  = assignedSel.value;
      const assignedTo  = assignedId ? (_users.find(u => u.id === assignedId)?.name || '') : '';
      const frequency   = document.getElementById('atc-freq').value;
      const errEl       = document.getElementById('atc-err');

      if (!task) { errEl.textContent = 'Task is required.'; return; }

      const btn = document.getElementById('atc-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Utils.apiFetch('/api/masters', {
          method: 'POST',
          body: JSON.stringify({ task, assignedTo, frequency }),
        });
        div.remove();
        Utils.showToast('Checklist task added');
        await reload();
      } catch (e) {
        errEl.textContent = e.message;
        btn.disabled = false; btn.textContent = 'Add Checklist';
      }
    });
  }

  /* ─── Edit Task Modal ───────────────────────────────────────────────────── */
  function openEditModal(task) {
    const userOpts = _users.map(u =>
      `<option value="${esc(u.id)}"${u.id === task.doerId ? ' selected' : ''}>${esc(u.name)}</option>`
    ).join('');

    const div = modalOverlay('at-edit-modal', `
      ${modalHeader('Edit Task', "document.getElementById('at-edit-modal').remove()")}
      <div style="padding:20px 24px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px">
        <div>
          <label class="at-label">Description *</label>
          <textarea id="ate-desc" rows="3" class="at-input" style="width:100%;height:auto;padding:8px 10px;resize:none">${esc(task.description || '')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="at-label">Doer</label>
            <select id="ate-doer" class="at-input" style="width:100%"><option value="">— Select —</option>${userOpts}</select>
          </div>
          <div>
            <label class="at-label">Due Date</label>
            <input type="date" id="ate-due" value="${esc((task.dueDate || '').split('T')[0])}" class="at-input" style="width:100%" />
          </div>
        </div>
        <div>
          <label class="at-label">Priority</label>
          <select id="ate-priority" class="at-input" style="width:100%">
            <option${task.priority === 'Low'    ? ' selected' : ''}>Low</option>
            <option${task.priority === 'Medium' ? ' selected' : ''}>Medium</option>
            <option${task.priority === 'High'   ? ' selected' : ''}>High</option>
          </select>
        </div>
        <div>
          <label class="at-label">URL <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
          <input id="ate-url" value="${esc(task.url || '')}" class="at-input" style="width:100%" placeholder="https://…" />
        </div>
        <div>
          <label class="at-label">Remarks</label>
          <textarea id="ate-remarks" rows="2" class="at-input" style="width:100%;height:auto;padding:8px 10px;resize:none" placeholder="Any remarks…">${esc(task.remarks || '')}</textarea>
        </div>
        <p id="ate-err" style="color:#ef4444;font-size:12px;margin:0"></p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('at-edit-modal').remove()" class="at-btn at-btn-secondary">Cancel</button>
        <button id="ate-save" class="at-btn at-btn-primary">Save Changes</button>
      </div>
    `);

    document.getElementById('ate-save').addEventListener('click', async () => {
      const desc     = document.getElementById('ate-desc').value.trim();
      const doerId   = document.getElementById('ate-doer').value;
      const dueDate  = document.getElementById('ate-due').value;
      const priority = document.getElementById('ate-priority').value;
      const url      = document.getElementById('ate-url').value.trim();
      const remarks  = document.getElementById('ate-remarks').value.trim();
      const errEl    = document.getElementById('ate-err');

      if (!desc) { errEl.textContent = 'Description is required.'; return; }

      const selectedUser = doerId ? _users.find(u => u.id === doerId) : null;
      const btn = document.getElementById('ate-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'PATCH',
          body: JSON.stringify({
            id: task.id,
            description: desc,
            dueDate:  dueDate  || undefined,
            priority, url, remarks,
            ...(selectedUser ? { doer: selectedUser.name, doerId: selectedUser.id } : {}),
          }),
        });
        div.remove();
        Utils.showToast('Task updated');
        await reload();
      } catch (e) {
        errEl.textContent = e.message;
        btn.disabled = false; btn.textContent = 'Save Changes';
      }
    });
  }

  /* ─── Transfer Modal (admin) ────────────────────────────────────────────── */
  function openTransferModal() {
    const div = modalOverlay('at-transfer-modal', `
      ${modalHeader('Transfer Tasks', "document.getElementById('at-transfer-modal').remove()")}
      <div style="padding:16px 24px;display:grid;grid-template-columns:1fr 1fr;gap:12px;border-bottom:1px solid #f1f5f9;flex-shrink:0">
        <div>
          <label class="at-label">From (whose tasks)</label>
          <select id="att-from" class="at-input" style="width:100%">
            <option value="">— Select employee —</option>
            ${_users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="at-label">Transfer To</label>
          <select id="att-to" class="at-input" style="width:100%" disabled>
            <option value="">— Select employee —</option>
          </select>
        </div>
      </div>
      <div id="att-tasklist" style="flex:1;overflow-y:auto">
        <div style="padding:32px;text-align:center;font-size:13px;color:#94a3b8">Select an employee to see their tasks</div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f1f5f9;flex-shrink:0">
        <p id="att-msg" style="color:#ef4444;font-size:12px;margin:0 0 8px"></p>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button onclick="document.getElementById('at-transfer-modal').remove()" class="at-btn at-btn-secondary">Cancel</button>
          <button id="att-submit" class="at-btn at-btn-primary" disabled>Transfer</button>
        </div>
      </div>
    `);

    let selectedIds = new Set();

    function renderTaskList(fromUserId) {
      const fromUser = _users.find(u => u.id === fromUserId);
      if (!fromUser) return;
      const group = _grouped.find(g => g.doer === fromUser.name);
      const tasks = (group?.tasks || []).filter(t => t.type !== 'Checklist' && t.status !== 'done');

      const toSel = document.getElementById('att-to');
      toSel.disabled = false;
      toSel.innerHTML = '<option value="">— Select employee —</option>' +
        _users.filter(u => u.id !== fromUserId).map(u =>
          `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');

      selectedIds = new Set(tasks.map(t => t.id));
      updateSubmitBtn();

      const listEl = document.getElementById('att-tasklist');
      if (tasks.length === 0) {
        listEl.innerHTML = '<div style="padding:32px;text-align:center;font-size:13px;color:#94a3b8">No pending tasks for this employee</div>';
        return;
      }

      listEl.innerHTML = `
        <div style="padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f1f5f9;background:#f8fafc">
          <input type="checkbox" id="att-all-chk" checked style="width:16px;height:16px;cursor:pointer;accent-color:#6366f1" />
          <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">
            Select All (${tasks.length} tasks)
          </span>
          <span id="att-sel-count" style="margin-left:auto;font-size:12px;font-weight:700;color:#6366f1">${tasks.length} selected</span>
        </div>
        ${tasks.map(t => `
          <label style="display:flex;align-items:flex-start;gap:12px;padding:10px 16px;border-bottom:1px solid #f8fafc;cursor:pointer" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <input type="checkbox" class="att-task-chk" data-id="${esc(t.id)}" checked style="width:16px;height:16px;margin-top:2px;flex-shrink:0;cursor:pointer;accent-color:#6366f1" />
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.description)}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
                ${t.dueDate ? `<span style="font-size:10.5px;color:#94a3b8">${new Date(t.dueDate).toLocaleDateString('en-IN')}</span>` : ''}
                <span style="font-size:10px;padding:1px 6px;border-radius:999px;font-weight:500;background:${t.status === 'revise' ? '#fef3c7' : '#f1f5f9'};color:${t.status === 'revise' ? '#92400e' : '#64748b'}">${t.status}</span>
              </div>
            </div>
          </label>`).join('')}`;

      document.getElementById('att-all-chk').addEventListener('change', function () {
        const checked = this.checked;
        document.querySelectorAll('.att-task-chk').forEach(chk => {
          chk.checked = checked;
          checked ? selectedIds.add(chk.dataset.id) : selectedIds.delete(chk.dataset.id);
        });
        updateSubmitBtn();
        updateSelCount();
      });

      document.querySelectorAll('.att-task-chk').forEach(chk => {
        chk.addEventListener('change', function () {
          this.checked ? selectedIds.add(this.dataset.id) : selectedIds.delete(this.dataset.id);
          updateSubmitBtn();
          updateSelCount();
          const allChk = document.getElementById('att-all-chk');
          if (allChk) allChk.checked = selectedIds.size === tasks.length;
        });
      });
    }

    function updateSelCount() {
      const el = document.getElementById('att-sel-count');
      if (el) el.textContent = `${selectedIds.size} selected`;
    }

    function updateSubmitBtn() {
      const btn = document.getElementById('att-submit');
      if (!btn) return;
      btn.disabled = selectedIds.size === 0;
      btn.textContent = selectedIds.size > 0 ? `Transfer (${selectedIds.size})` : 'Transfer';
    }

    document.getElementById('att-from').addEventListener('change', function () {
      renderTaskList(this.value);
    });

    document.getElementById('att-submit').addEventListener('click', async () => {
      const fromId = document.getElementById('att-from').value;
      const toId   = document.getElementById('att-to').value;
      const msgEl  = document.getElementById('att-msg');

      if (!fromId || !toId) { msgEl.textContent = 'Please select both users'; return; }
      if (fromId === toId)  { msgEl.textContent = 'From and To cannot be the same'; return; }
      if (selectedIds.size === 0) { msgEl.textContent = 'Select at least one task'; return; }

      const fromUser = _users.find(u => u.id === fromId);
      const toUser   = _users.find(u => u.id === toId);
      const btn = document.getElementById('att-submit');
      btn.disabled = true; btn.textContent = 'Transferring…';
      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'transfer',
            fromDoer: fromUser?.name, toDoer: toUser?.name, toDoerId: toUser?.id,
            taskIds: [...selectedIds],
          }),
        });
        div.remove();
        Utils.showToast('Tasks transferred successfully');
        await reload();
      } catch (e) {
        msgEl.textContent = e.message;
        btn.disabled = false;
        updateSubmitBtn();
      }
    });
  }

  /* ─── My Transfer Modal (non-admin) ─────────────────────────────────────── */
  function openMyTransferModal() {
    const myName  = currentUserName();
    const group   = _grouped.find(g => g.doer === myName);
    const myTasks = (group?.tasks || []).filter(t => t.type !== 'Checklist' && t.status !== 'done');

    let selectedIds = new Set(myTasks.map(t => t.id));

    const taskListHTML = myTasks.length === 0
      ? '<div style="padding:32px;text-align:center;font-size:13px;color:#94a3b8">No pending tasks to transfer</div>'
      : `
        <div style="padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f1f5f9;background:#f8fafc">
          <input type="checkbox" id="atmt-all-chk" checked style="width:16px;height:16px;cursor:pointer;accent-color:#6366f1" />
          <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">
            Select All (${myTasks.length})
          </span>
          <span id="atmt-sel-count" style="margin-left:auto;font-size:12px;font-weight:700;color:#6366f1">${myTasks.length} selected</span>
        </div>
        ${myTasks.map(t => `
          <label style="display:flex;align-items:flex-start;gap:12px;padding:10px 16px;border-bottom:1px solid #f8fafc;cursor:pointer" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <input type="checkbox" class="atmt-task-chk" data-id="${esc(t.id)}" checked style="width:16px;height:16px;margin-top:2px;flex-shrink:0;cursor:pointer;accent-color:#6366f1" />
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.description)}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
                ${t.dueDate ? `<span style="font-size:10.5px;color:#94a3b8">${new Date(t.dueDate).toLocaleDateString('en-IN')}</span>` : ''}
                <span style="font-size:10px;padding:1px 6px;border-radius:999px;font-weight:500;background:${t.status === 'revise' ? '#fef3c7' : '#f1f5f9'};color:${t.status === 'revise' ? '#92400e' : '#64748b'}">${t.status}</span>
              </div>
            </div>
          </label>`).join('')}`;

    const div = modalOverlay('at-my-transfer-modal', `
      ${modalHeader('Transfer My Tasks', "document.getElementById('at-my-transfer-modal').remove()")}
      <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9;flex-shrink:0">
        <label class="at-label">Transfer To</label>
        <select id="atmt-to" class="at-input" style="width:100%">
          <option value="">— Select employee —</option>
          ${_users.filter(u => u.name !== myName).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select>
      </div>
      <div id="atmt-tasklist" style="flex:1;overflow-y:auto">${taskListHTML}</div>
      <div style="padding:16px 24px;border-top:1px solid #f1f5f9;flex-shrink:0">
        <p id="atmt-msg" style="color:#ef4444;font-size:12px;margin:0 0 8px"></p>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button onclick="document.getElementById('at-my-transfer-modal').remove()" class="at-btn at-btn-secondary">Cancel</button>
          <button id="atmt-submit" class="at-btn at-btn-primary">${myTasks.length > 0 ? `Transfer (${myTasks.length})` : 'Transfer'}</button>
        </div>
      </div>
    `);

    function updateSelCount() {
      const el = document.getElementById('atmt-sel-count');
      if (el) el.textContent = `${selectedIds.size} selected`;
    }
    function updateSubmitBtn() {
      const btn = document.getElementById('atmt-submit');
      if (btn) {
        btn.disabled = selectedIds.size === 0;
        btn.textContent = selectedIds.size > 0 ? `Transfer (${selectedIds.size})` : 'Transfer';
      }
    }

    document.getElementById('atmt-all-chk')?.addEventListener('change', function () {
      document.querySelectorAll('.atmt-task-chk').forEach(chk => {
        chk.checked = this.checked;
        this.checked ? selectedIds.add(chk.dataset.id) : selectedIds.delete(chk.dataset.id);
      });
      updateSelCount(); updateSubmitBtn();
    });

    document.querySelectorAll('.atmt-task-chk').forEach(chk => {
      chk.addEventListener('change', function () {
        this.checked ? selectedIds.add(this.dataset.id) : selectedIds.delete(this.dataset.id);
        updateSelCount(); updateSubmitBtn();
        const allChk = document.getElementById('atmt-all-chk');
        if (allChk) allChk.checked = selectedIds.size === myTasks.length;
      });
    });

    document.getElementById('atmt-submit').addEventListener('click', async () => {
      const toId  = document.getElementById('atmt-to').value;
      const msgEl = document.getElementById('atmt-msg');

      if (!toId)              { msgEl.textContent = 'Please select a person to transfer to.'; return; }
      if (selectedIds.size === 0) { msgEl.textContent = 'Select at least one task.'; return; }

      const toUser = _users.find(u => u.id === toId);
      const btn = document.getElementById('atmt-submit');
      btn.disabled = true; btn.textContent = 'Transferring…';
      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'transfer',
            fromDoer: myName, toDoer: toUser?.name, toDoerId: toUser?.id,
            taskIds: [...selectedIds],
          }),
        });
        div.remove();
        Utils.showToast('Tasks transferred successfully');
        await reload();
      } catch (e) {
        msgEl.textContent = e.message;
        btn.disabled = false; updateSubmitBtn();
      }
    });
  }

  /* ─── public render ─────────────────────────────────────────────────────── */
  return {
    async render() {
      const el = document.getElementById('main-content');
      if (!el) return;

      // Loading skeleton
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div>';

      // Add label style globally (once)
      if (!document.getElementById('at-label-style')) {
        const s = document.createElement('style');
        s.id = 'at-label-style';
        s.textContent = '.at-label { display:block;font-size:12px;font-weight:500;color:#374151;margin-bottom:4px }';
        document.head.appendChild(s);
      }

      const ok = await fetchData();
      if (!ok) {
        el.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444;font-size:14px">Failed to load tasks.</div>';
        return;
      }
      renderContent();
    },
  };
})();
