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
    'meetings':     'Meetings',
    'client-master':'',
    'pr-po-grn':'PR / PO / GRN',
    'daily-task':   'Daily Task',
    'race-tracker': 'Race Tracker',
    'compliance':   'Compliance',
  },

  _calendarIcon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;color:var(--border-strong);flex-shrink:0;">
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
    if (!roles || !roles.length) return window.UI.pill('Member', { variant: 'neutral', size: 'sm' });
    const role = roles.includes('Admin') ? 'Admin'
               : roles.includes('HOD')   ? 'HOD'
               : roles[0];
    const isElevated = role === 'Admin' || role === 'HOD';
    return window.UI.pill(role, { variant: isElevated ? 'brand' : 'neutral', size: 'sm' });
  },

  _buildHTML(user) {
    const title  = this._getTitle();
    const today  = this._formatDate();
    const roles  = user?.roles || [];
    const name   = user?.name || 'User';
    const themeIcon = window.Theme?.current() === 'dark' ? window.Theme.SUN_ICON : window.Theme.MOON_ICON;

    return `
      <div style="padding:0 28px;height:56px;display:flex;align-items:center;gap:14px;">

        <!-- Page title -->
        <h1 style="
          font-size:var(--text-md);font-weight:700;letter-spacing:-0.025em;
          color:var(--text-primary);margin:0;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;
        " id="topbar-title">${title}</h1>

        <div style="flex:1;min-width:0;"></div>

        <!-- Date -->
        <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;">
          ${this._calendarIcon}
          <span>${today}</span>
        </div>

        <!-- Light/Dark toggle -->
        <button id="tb-theme-btn" onclick="window.Theme.toggle()" title="Toggle light/dark mode"
          style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:transparent;border:1.5px solid var(--border-base);cursor:pointer;transition:all .15s;flex-shrink:0;color:var(--text-secondary);"
          onmouseenter="this.style.background='var(--surface-alt)';this.style.borderColor='var(--border-strong)';"
          onmouseleave="this.style.background='transparent';this.style.borderColor='var(--border-base)';">
          <span class="tb-theme-icon" style="display:flex;">${themeIcon}</span>
        </button>

        <!-- Divider -->
        <div style="width:1px;height:20px;background:var(--border-base);flex-shrink:0;margin:0 2px;"></div>

        <!-- Avatar + name + role -->
        <div style="display:flex;align-items:center;gap:9px;flex-shrink:0;">
          ${window.UI.avatar(name, { variant: 'brand', size: 30 })}
          <div style="line-height:1.25;">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;">${name}</div>
            <div style="font-size:10px;white-space:nowrap;">${this._roleBadge(roles)}</div>
          </div>
        </div>

        <!-- Divider -->
        <div style="width:1px;height:20px;background:var(--border-base);flex-shrink:0;margin:0 2px;"></div>

        <!-- Sign out -->
        <button
          onclick="window.Topbar._logout()"
          title="Sign out"
          style="
            display:flex;align-items:center;gap:5px;
            padding:6px 12px;border-radius:8px;
            background:transparent;border:1.5px solid var(--border-base);
            font-size:12px;font-weight:600;color:var(--text-secondary);
            cursor:pointer;flex-shrink:0;
            transition:all 0.15s;
          "
          onmouseenter="this.style.background='var(--color-danger-bg)';this.style.color='var(--color-danger)';this.style.borderColor='var(--color-danger-border)';"
          onmouseleave="this.style.background='transparent';this.style.color='var(--text-secondary)';this.style.borderColor='var(--border-base)';"
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
