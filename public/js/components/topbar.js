/* Topbar component — vanilla JS equivalent of Topbar.jsx */
window.Topbar = {
  // Map hash-fragment routes to display titles (mirrors Topbar.jsx TITLES)
  _titles: {
    'dashboard':    'Dashboard',
    'all-tasks':    'All Tasks',
    'approvals':    'Approvals',
    'users':        'Users',
    'mis':          'MIS Report',
    'masters':      'Checklists',
    'fms':          'FMS Master',
    'profile':      'Profile',
    'leave-tracker':'Leave Tracker',
    'daily-reports':'Daily Reports',
    'meetings':     'Meetings',
    'client-master':'Vendor Master',
    'daily-task':   'Daily Task',
    'race-tracker': 'Race Tracker',
    'compliance':   'Compliance',
  },

  _calendarIcon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;color:#cbd5e1;flex-shrink:0;">
    <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
  </svg>`,

  _getTitle() {
    const route = (window.location.hash || '').replace('#', '') || 'dashboard';
    return this._titles[route] || '';
  },

  _formatDate() {
    return new Date().toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  },

  _roleBadge(roles) {
    if (!roles || !roles.length) return '<span style="color:#94a3b8;">Member</span>';
    const role = roles.includes('Admin') ? 'Admin'
               : roles.includes('HOD')   ? 'HOD'
               : roles[0];
    const isElevated = role === 'Admin' || role === 'HOD';
    return `<span style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${isElevated ? '#C4714A' : '#94a3b8'};">${role}</span>`;
  },

  _buildHTML(user) {
    const title  = this._getTitle();
    const today  = this._formatDate();
    const roles  = user?.roles || [];
    const name   = user?.name || 'User';
    const initials = (name).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    return `
      <div style="padding:0 28px;height:56px;display:flex;align-items:center;gap:14px;">

        <!-- Page title -->
        <h1 style="
          font-size:16px;font-weight:700;letter-spacing:-0.025em;
          color:#0f172a;margin:0;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;
        " id="topbar-title">${title}</h1>

        <div style="flex:1;min-width:0;"></div>

        <!-- Date -->
        <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:#94a3b8;white-space:nowrap;flex-shrink:0;">
          ${this._calendarIcon}
          <span>${today}</span>
        </div>

        <!-- Divider -->
        <div style="width:1px;height:20px;background:#e8edf3;flex-shrink:0;margin:0 2px;"></div>

        <!-- Avatar + name + role -->
        <div style="display:flex;align-items:center;gap:9px;flex-shrink:0;">
          <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#C4714A,#d4894f);display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0;">${initials}</div>
          <div style="line-height:1.25;">
            <div style="font-size:13px;font-weight:600;color:#1e293b;white-space:nowrap;">${name}</div>
            <div style="font-size:10px;color:#94a3b8;white-space:nowrap;">${this._roleBadge(roles)}</div>
          </div>
        </div>

        <!-- Divider -->
        <div style="width:1px;height:20px;background:#e8edf3;flex-shrink:0;margin:0 2px;"></div>

        <!-- Sign out -->
        <button
          onclick="window.Topbar._logout()"
          title="Sign out"
          style="
            display:flex;align-items:center;gap:5px;
            padding:6px 12px;border-radius:8px;
            background:transparent;border:1.5px solid #e8edf3;
            font-size:12px;font-weight:600;color:#64748b;
            cursor:pointer;flex-shrink:0;
            transition:all 0.15s;
          "
          onmouseenter="this.style.background='#fff1f2';this.style.color='#e11d48';this.style.borderColor='#fecdd3';"
          onmouseleave="this.style.background='transparent';this.style.color='#64748b';this.style.borderColor='#e8edf3';"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>
          </svg>
          Sign out
        </button>

      </div>
    `;
  },

  async _logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    location.reload();
  },

  // Update the page-title span on hash navigation without re-rendering everything
  _syncTitle() {
    const titleEl = document.getElementById('topbar-title');
    if (titleEl) titleEl.textContent = this._getTitle();
  },

  render(user) {
    this._user = user;
    const el = document.getElementById('topbar');
    if (!el) return;
    el.innerHTML = this._buildHTML(user);
    window.addEventListener('hashchange', () => this._syncTitle());
  },
};
