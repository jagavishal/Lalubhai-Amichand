/* Sidebar component — vanilla JS equivalent of Sidebar.jsx */
window.Sidebar = {
  _pendingCount: 0,
  _user: null,

  // SVG icon strings (same paths as Sidebar.jsx Icon map)
  _icons: {
    dashboard:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    tasks:        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>',
    approve:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    users:        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    mis:          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/></svg>',
    masters:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v16"/></svg>',
    fms:          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    profile:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    dailytask:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
    leave:        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="M8 15h2M14 15h2"/></svg>',
    meetings:     '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    reports:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2v4H8zM13 11h2v6h-2z"/></svg>',
    clientmaster: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/></svg>',
    payment:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="12" cy="15" r="1.5" fill="currentColor"/></svg>',
    race:         '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4"/><path d="M4 4h13l-2 4 2 4H4"/></svg>',
    compliance:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    signout:        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    helpticket:     '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    announcements:  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
  },

  // Nav sections — matches SECTIONS in Sidebar.jsx
  // route = hash fragment used by Router (href without leading slash)
  _sections: [
    { title: 'Workspace', items: [
      { route: 'dashboard',     label: 'Dashboard',      icon: 'dashboard' },
      { route: 'all-tasks',     label: 'All Tasks',      icon: 'tasks' },
      { route: 'approvals',     label: 'Approvals',      icon: 'approve',       badge: true },
      { route: 'announcements', label: 'Announcements',  icon: 'announcements', alwaysShow: true },
      { route: 'help-ticket',   label: 'Help Ticket',    icon: 'helpticket',    alwaysShow: true },
    ]},
    { title: 'Operations', items: [
      { route: 'mis',           label: 'MIS Report',    icon: 'mis',          adminOnly: true },
      { route: 'client-master', label: 'Vendor Master', icon: 'clientmaster', adminOnly: true },
    ]},
    { title: 'Administration', items: [
      { route: 'users',         label: 'Users',        icon: 'users',        adminOnly: true },
      { route: 'profile',       label: 'Profile',      icon: 'profile' },
    ]},
  ],

  _isAdmin(user) {
    const roles = user?.roles || [];
    return roles.includes('Admin') || roles.includes('HOD');
  },

  _initials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  },

  async _fetchPendingCount() {
    try {
      const res = await fetch('/api/approvals/pending-count');
      if (!res.ok) return 0;
      const { count } = await res.json();
      return count || 0;
    } catch { return 0; }
  },

  _buildNavItem(item, isAdmin, pendingCount, activeRoute, permissions) {
    if (item.adminOnly && !isAdmin) return '';
    if (!item.alwaysShow && permissions && permissions.pages && !permissions.pages.includes(item.route)) return '';

    const active = activeRoute === item.route;
    const icon   = this._icons[item.icon] || '';
    const badge  = item.badge && pendingCount > 0
      ? `<span style="position:absolute;top:-5px;right:-5px;min-width:14px;height:14px;padding:0 3px;border-radius:9999px;font-size:9px;font-weight:700;color:#fff;background:var(--color-primary);box-shadow:0 0 0 2px #101013;display:flex;align-items:center;justify-content:center;line-height:1;">${pendingCount}</span>`
      : '';

    const activeBg   = active ? 'var(--color-primary-light)' : 'transparent';
    const activeBar  = active
      ? `<span style="position:absolute;left:0;top:5px;bottom:5px;width:2px;border-radius:0 2px 2px 0;background:var(--color-primary);"></span>`
      : '';
    const iconColor  = active ? 'var(--color-primary)' : '#71717a';
    const textColor  = active ? '#e4e4e7' : '#a1a1aa';
    const fontWeight = active ? '600' : '500';

    return `
      <a data-route="${item.route}"
         href="#${item.route}"
         onclick="Router.navigate('${item.route}');return false;"
         title="${item.label}"
         style="
           display:flex;align-items:center;gap:10px;
           height:34px;padding:0 8px;
           border-radius:7px;
           font-size:12.5px;font-weight:${fontWeight};
           color:${textColor};text-decoration:none;
           background:${activeBg};
           position:relative;
           transition:background 0.14s,color 0.14s;
           white-space:nowrap;
         "
         onmouseenter="if(this.dataset.active!=='1'){this.style.background='rgba(255,255,255,0.06)';this.style.color='#e4e4e7';}"
         onmouseleave="if(this.dataset.active!=='1'){this.style.background='transparent';this.style.color='#a1a1aa';}"
         ${active ? 'data-active="1"' : ''}
      >
        ${activeBar}
        <span style="position:relative;flex-shrink:0;color:${iconColor};">
          ${icon}
          ${badge}
        </span>
        <span class="sb-label" style="opacity:0;transition:opacity 0.22s;white-space:nowrap;overflow:hidden;">
          ${item.label}
        </span>
      </a>`;
  },

  _buildHTML(user, pendingCount) {
    const isAdmin    = this._isAdmin(user);
    const activeRoute = (window.location.hash || '').replace('#', '') || 'dashboard';
    const initials   = this._initials(user?.name);
    const roles      = (user?.roles || ['User']).join(' · ');
    const permissions = isAdmin ? null : (user?.permissions || null);

    const sectionsHTML = this._sections.map(sec => {
      const itemsHTML = sec.items
        .map(item => this._buildNavItem(item, isAdmin, pendingCount, activeRoute, permissions))
        .join('');
      if (!itemsHTML.trim()) return '';
      return `
        <div style="margin-bottom:6px;">
          <div class="sb-label" style="padding:10px 14px 3px;opacity:0;transition:opacity .22s;">
            <span style="font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#3f3f46;">${sec.title}</span>
          </div>
          <div style="padding:0 6px;display:flex;flex-direction:column;gap:2px;">
            ${itemsHTML}
          </div>
        </div>`;
    }).join('');

    return `
      <style>
        #sidebar { transition: width 0.22s cubic-bezier(0.4,0,0.2,1); }
        #sidebar:hover { width: 228px !important; }
        #sidebar:hover .sb-label    { opacity: 1 !important; }
        #sidebar:hover .sb-brand-name { opacity: 1 !important; }
        #sidebar:hover .sb-user-info  { opacity: 1 !important; }
        #sidebar:hover .sb-signout    { opacity: 1 !important; }
        #sidebar nav::-webkit-scrollbar { width: 0; }
      </style>

      <!-- Brand -->
      <div style="height:52px;padding:0 10px;display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid #1c1c22;">
        <img src="/logo.png" alt="Logo" width="30" height="30" style="flex-shrink:0;border-radius:7px;object-fit:contain;background:#fff;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
        <svg width="30" height="30" viewBox="0 0 28 28" fill="none" style="flex-shrink:0;display:none;">
          <rect width="28" height="28" rx="7" fill="#C4714A"/>
          <path d="M7 20V10l7-4 7 4v10" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M11 20v-5h6v5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="sb-brand-name" style="opacity:0;transition:opacity 0.22s;white-space:nowrap;overflow:hidden;min-width:0;">
          <div style="font-size:13px;font-weight:600;letter-spacing:-0.02em;color:#e4e4e7;white-space:nowrap;">Lallubhai Amichand</div>
        </div>
      </div>

      <!-- Nav -->
      <nav style="flex:1;overflow-y:auto;overflow-x:hidden;padding:6px 0;">
        ${sectionsHTML}
      </nav>

      <!-- User card -->
      <div style="padding:6px 6px 10px;border-top:1px solid #1c1c22;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;padding:6px;border-radius:7px;transition:background .14s;cursor:default;" onmouseenter="this.style.background='rgba(255,255,255,0.05)';" onmouseleave="this.style.background='transparent';">
          <div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#6d28d9,#5e6ad2);display:grid;place-items:center;color:#fff;font-weight:700;font-size:11px;flex-shrink:0;letter-spacing:.02em;">
            ${initials}
          </div>
          <div class="sb-user-info" style="opacity:0;transition:opacity 0.22s;min-width:0;flex:1;overflow:hidden;">
            <div style="font-size:12px;font-weight:600;color:#e4e4e7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user?.name || 'User'}</div>
            <div style="font-size:10px;color:#52525b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${roles}</div>
          </div>
          <button
            class="sb-signout"
            onclick="window.Sidebar._logout()"
            title="Sign out"
            style="
              opacity:0;
              flex-shrink:0;
              padding:5px;border-radius:6px;
              background:transparent;border:none;cursor:pointer;
              color:#52525b;
              transition:color 0.14s,background 0.14s,opacity 0.22s;
            "
            onmouseenter="this.style.color='#f87171';this.style.background='rgba(220,38,38,0.12)';"
            onmouseleave="this.style.color='#52525b';this.style.background='transparent';"
          >
            ${this._icons.signout}
          </button>
        </div>
      </div>
    `;
  },

  async _logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    location.reload();
  },

  // Highlight the active nav link when the hash changes
  _syncActive() {
    const activeRoute = (window.location.hash || '').replace('#', '') || 'dashboard';
    document.querySelectorAll('#sidebar [data-route]').forEach(el => {
      const isActive = el.dataset.route === activeRoute;
      el.style.background   = isActive ? 'var(--color-primary-light)' : 'transparent';
      el.style.fontWeight   = isActive ? '600' : '500';
      el.style.color        = isActive ? '#e4e4e7' : '#a1a1aa';
      el.dataset.active     = isActive ? '1' : '';
      const iconSpan = el.querySelector('span');
      if (iconSpan) iconSpan.style.color = isActive ? 'var(--color-primary)' : '#71717a';
      let bar = el.querySelector('.sb-active-bar');
      if (isActive && !bar) {
        bar = document.createElement('span');
        bar.className = 'sb-active-bar';
        bar.style.cssText = 'position:absolute;left:0;top:5px;bottom:5px;width:2px;border-radius:0 2px 2px 0;background:var(--color-primary);';
        el.prepend(bar);
      } else if (!isActive && bar) {
        bar.remove();
      }
    });
  },

  _syncBottomNav() {
    const activeRoute = (window.location.hash || '').replace('#', '') || 'dashboard';
    document.querySelectorAll('#bottom-nav [data-route]').forEach(el => {
      el.classList.toggle('active', el.dataset.route === activeRoute);
    });
  },

  _renderBottomNav(user, pendingCount) {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    const isAdmin = this._isAdmin(user);
    const activeRoute = (window.location.hash || '').replace('#', '') || 'dashboard';

    const items = [
      { route: 'dashboard', label: 'Dashboard', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>' },
      { route: 'all-tasks', label: 'Tasks',     icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>' },
      { route: 'approvals', label: 'Approvals', badge: pendingCount, icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>' },
      ...(isAdmin ? [{ route: 'users', label: 'Users', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' }] : []),
      ...(isAdmin ? [{ route: 'mis', label: 'MIS', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/></svg>' }] : []),
      { route: 'profile', label: 'Profile', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
    ];

    nav.innerHTML = items.map(item => {
      const active = activeRoute === item.route;
      const badge = item.badge > 0 ? `<span class="bn-badge">${item.badge}</span>` : '';
      return `<a class="bn-item${active ? ' active' : ''}" data-route="${item.route}" href="#${item.route}" onclick="Router.navigate('${item.route}');return false;">
        ${badge}
        ${item.icon}
        <span>${item.label}</span>
      </a>`;
    }).join('');
  },

  async render(user) {
    this._user = user;
    const el = document.getElementById('sidebar');
    if (!el) return;

    // Apply sidebar shell styles
    el.style.cssText = `
      position:fixed;left:0;top:0;
      height:100vh;width:52px;
      background:#101013;
      border-right:1px solid #1c1c22;
      box-shadow:1px 0 0 rgba(255,255,255,0.04);
      display:flex;flex-direction:column;
      z-index:40;overflow:hidden;
      transition:width 0.22s cubic-bezier(0.4,0,0.2,1);
    `;

    const isAdmin = this._isAdmin(user);
    let pendingCount = 0;
    if (isAdmin) pendingCount = await this._fetchPendingCount();
    this._pendingCount = pendingCount;

    el.innerHTML = this._buildHTML(user, pendingCount);
    this._renderBottomNav(user, pendingCount);

    // Keep active state in sync with hash navigation
    window.addEventListener('hashchange', () => { this._syncActive(); this._syncBottomNav(); });
  },
};
