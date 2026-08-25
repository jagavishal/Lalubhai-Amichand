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
    leave:        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="M8 15h2M14 15h2"/></svg>',
    reports:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2v4H8zM13 11h2v6h-2z"/></svg>',
    clientmaster: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/></svg>',
    consignee:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a3 3 0 0 0 2.5-1.4 3 3 0 0 1 5 0 3 3 0 0 0 5 0 3 3 0 0 1 5 0A3 3 0 0 0 22 20"/><path d="M4 18 2.6 12.6A1 1 0 0 1 3.6 11.4h16.8a1 1 0 0 1 1 1.2L20 18"/><path d="M12 11.4V4"/><path d="M8 7h8"/></svg>',
    prcreation:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6M9 15h6"/></svg>',
    pocreation:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14l2 2 4-4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>',
    grncreation:  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    popending:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    picreation:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    payment:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="12" cy="15" r="1.5" fill="currentColor"/></svg>',
    compliance:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    signout:        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    helpticket:     '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    announcements:  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
    inward:       '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    outward:      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
    // One icon per IMS book, so the four entries stay tellable apart when the
    // sidebar is collapsed to icons only: box (Stores), layers (Alu & SS
    // sheet/coil stock), bolt-and-nut (Accessories), handshake-ish arrows
    // (Trading job-work).
    ims:          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    imsalu:       '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.09-9.17 4.16a2 2 0 0 1-1.66 0L2 12.09"/><path d="m22 16.92-9.17 4.17a2 2 0 0 1-1.66 0L2 16.92"/></svg>',
    imsaccess:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/></svg>',
    imstrading:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h13l-3-3"/><path d="M21 16H8l3 3"/></svg>',
    developer:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    // HR module — the Leave entry reuses the existing calendar icon, so these
    // three only cover what the sidebar did not already have a mark for:
    // an ID card (Employee Master), a clock-in (Attendance), a rupee note
    // (Payroll) and a person-with-chart (HR Reports).
    policies:     '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h8M9 11h6"/></svg>',
    orgchart:     '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="5" rx="1.2"/><rect x="2" y="17" width="6" height="5" rx="1.2"/><rect x="16" y="17" width="6" height="5" rx="1.2"/><path d="M12 7v4M5 17v-2h14v2M12 11v4"/></svg>',
    hremployees:  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="10" r="2.2"/><path d="M5.5 16a3.6 3.6 0 0 1 7 0"/><path d="M15 9h4M15 13h4"/></svg>',
    hrattendance: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg>',
    hrpayroll:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M9 10h6M9 13h4M11 10v6"/><path d="m13.5 13 2.5 3"/></svg>',
    hrreports:    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="5" width="3" height="13" rx="1"/></svg>',
    // Section open/close arrow — drawn pointing right and rotated 90° when the
    // section is open, so one icon covers both states.
    chevron:      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
  },

  /* ── Section open/closed state ─────────────────────────────────────────
     Each category can be folded away by its arrow, so only the section being
     worked in has to be on screen. The choice is remembered per browser; on a
     first visit only the section holding the current page is open. ─────── */
  _SECTIONS_KEY: 'sb-open-sections',
  _openSections: null,

  _loadOpenSections(activeRoute) {
    try {
      const raw = localStorage.getItem(this._SECTIONS_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) return new Set(arr);
    } catch {}
    const sec = this._sections.find(s => s.items.some(i => i.route === activeRoute));
    return new Set([(sec || this._sections[0]).title]);
  },

  toggleSection(title) {
    if (!this._openSections) this._openSections = new Set();
    const open = !this._openSections.has(title);
    if (open) this._openSections.add(title);
    else      this._openSections.delete(title);
    try { localStorage.setItem(this._SECTIONS_KEY, JSON.stringify([...this._openSections])); } catch {}

    const items = document.querySelector(`#sidebar [data-section-items="${title}"]`);
    const arrow = document.querySelector(`#sidebar [data-section-arrow="${title}"]`);
    const head  = document.querySelector(`#sidebar [data-section-head="${title}"]`);
    if (items) items.style.display = open ? 'flex' : 'none';
    if (arrow) arrow.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
    if (head)  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  },

  // Nav sections — the whole ERP grouped into the company's own five
  // categories: Basic (everyone's day-to-day), the two operating departments
  // (Export / Trading), Admin Section and Accounts. A section whose items are
  // all hidden by permissions renders nothing at all (see _buildHTML), so a
  // user only ever sees the departments they actually work in.
  // route = hash fragment used by Router (href without leading slash)
  _sections: [
    { title: 'Basic', items: [
      { route: 'dashboard',     label: 'Dashboard',      icon: 'dashboard',     alwaysShow: true },
      { route: 'all-tasks',     label: 'All Tasks',      icon: 'tasks' },
      { route: 'approvals',     label: 'Approvals',      icon: 'approve',       badge: true },
      // No entry for 'leave-tracker': the HR module's Leave Management page
      // replaced it and does everything it did (plus balances, half days, leave
      // types and the holiday calendar), so keeping both meant two menu entries
      // for one job. The old route still resolves and redirects there, so
      // bookmarks keep working — see hr-leave.js.
      { route: 'announcements', label: 'Announcements',  icon: 'announcements' },
      { route: 'help-ticket',   label: 'Help Ticket',    icon: 'helpticket' },
      { route: 'profile',       label: 'Profile',        icon: 'profile' },
    ]},
    { title: 'Export Department', items: [
      { route: 'proforma-invoice', label: 'Proforma Invoice', icon: 'picreation' },
      { route: 'consignee-master', label: 'Consignee Master', icon: 'consignee' },
      { route: 'pr-creation',    label: 'PR Creation',    icon: 'prcreation' },
      { route: 'po-creation',    label: 'PO Creation',    icon: 'pocreation' },
      { route: 'grn-creation',   label: 'GRN Creation',   icon: 'grncreation' },
      // No entry for 'po-pending': it lives inside the FMS page's "Stores
      // Approval FMS Report" tab (see fms.js). The route still resolves on its
      // own so older links to #po-pending keep working.
      // One entry per IMS stock book -- each route is its own page with its
      // own Inward/Outward/Report tabs, hard-scoped to that book's category
      // (see IMS_BOOKS in ims.js; routes must match it exactly). The first
      // three books are the export unit's own stock; the Trading book belongs
      // to the Trading department below.
      { route: 'ims-stores',      label: 'IMS Stores',      icon: 'ims' },
      { route: 'ims-alu',         label: 'IMS Alu & SS',    icon: 'imsalu' },
      { route: 'ims-accessories', label: 'IMS Accessories', icon: 'imsaccess' },
    ]},
    { title: 'Trading Department', items: [
      { route: 'ims-trading',     label: 'IMS Trading',     icon: 'imstrading' },
    ]},
    { title: 'Admin Section', items: [
      { route: 'users',         label: 'Users',        icon: 'users',        adminOnly: true },
      { route: 'fms',           label: 'FMS',          icon: 'fms',          flag: 'fms' },
      { route: 'mis',           label: 'MIS Report',   icon: 'mis' },
      // No entry for 'developer': it is a maintenance console (reset, restore,
      // export) rather than day-to-day work, so it stays off the menu. The
      // route still resolves, so #developer reaches it when it is needed --
      // and every /api/developer route already refuses to answer without the
      // DEVELOPER_SECRET query param (see checkSecret in server.js), so the
      // page can do nothing on its own.
    ]},
    // The HR module. 'hr-attendance' and 'hr-payroll' are deliberately not
    // adminOnly: both open on the person's own view (their punch card, their
    // payslips) and show the company-wide tabs only to Admin/HOD, so an
    // ordinary employee still has somewhere to check in and collect a slip.
    { title: 'HR Section', items: [
      { route: 'hr-employees',  label: 'Employee Master', icon: 'hremployees', adminOnly: true },
      // Not adminOnly: knowing who to ask, and who signs off your leave, is
      // exactly the thing an ordinary employee needs this page for. alwaysShow
      // because every user permissioned before this page existed has an explicit
      // pages list that cannot mention it — without this the page would be
      // invisible to everyone but the users who have no permission record at all.
      { route: 'hr-org-chart',  label: 'Company Tree',    icon: 'orgchart', alwaysShow: true },
      { route: 'hr-attendance', label: 'Attendance',      icon: 'hrattendance' },
      { route: 'hr-leave',      label: 'Leave Management', icon: 'leave' },
      { route: 'hr-payroll',    label: 'Payroll',         icon: 'hrpayroll' },
      { route: 'hr-reports',    label: 'HR Reports',      icon: 'hrreports',  adminOnly: true },
      // alwaysShow for the same reason as Company Tree: users permissioned
      // before this page existed have an explicit pages list that cannot
      // mention it, and the policy book is for everyone by definition.
      { route: 'hr-policies',   label: 'HR Policies',     icon: 'policies', alwaysShow: true },
    ]},
    { title: 'Accounts', items: [
      { route: 'client-master',  label: 'Vendor Master',  icon: 'clientmaster' },
    ]},
  ],

  // The owner account counts as an Admin here, so the adminOnly entries (Users,
  // Employee Master, HR Reports) are on its menu whether or not somebody
  // remembered to also give it the Admin role. It outranks Admin everywhere
  // else — it is the only account that can delete a record or reopen a
  // finalised payroll — so it should never be shown less. Mirrors
  // isAdminUser() in server.js, which decides the same thing for the routes.
  _isAdmin(user) {
    if (user?.isSuperAdmin) return true;
    const roles = user?.roles || [];
    return roles.includes('Admin') || roles.includes('HOD');
  },

  async _fetchPendingCount() {
    try {
      const res = await fetch('/api/approvals/pending-count');
      if (!res.ok) return 0;
      const { count } = await res.json();
      return count || 0;
    } catch { return 0; }
  },

  /* May this user open this route at all?

     The sidebar has always decided what to SHOW; nothing decided what could be
     OPENED, so a restricted user only had to type the page name into the URL.
     This is the single answer to that question, used both to build the menu
     below and by the router before it renders anything. Unknown routes are
     allowed through so the page modules stay free to add routes that have no
     menu entry (and an unknown one just renders nothing).

     The two exceptions are the sidebar's own, unchanged: the owner is never
     restricted, and an account with no saved permissions record still sees
     everything. */
  canAccess(route, user) {
    const u = user || window.currentUser;
    if (!u) return false;
    if (u.isSuperAdmin) return true;

    const roles = u.roles || [];
    const isAdmin = Array.isArray(roles)
      ? roles.includes('Admin') || roles.includes('HOD')
      : String(roles).includes('Admin') || String(roles).includes('HOD');

    let item = null;
    for (const sec of this._sections) {
      const found = sec.items.find(i => i.route === route);
      if (found) { item = found; break; }
    }
    if (!item) return true;

    const permissions = u.permissions || null;
    // An explicit page grant from Users → Access outranks adminOnly: HR staff
    // who are not Admins can be handed Employee Master without being handed
    // everything else an Admin sees. Absence of a grant keeps it hidden.
    const granted = !!(permissions && permissions.pages && permissions.pages.includes(route));
    if (item.adminOnly && !isAdmin && !granted) return false;
    if (item.flag && !((u.featureFlags || {})[item.flag])) return false;
    if (item.alwaysShow || (item.adminOnly && granted)) return true;
    if (!permissions || !permissions.pages) return true;
    const routeAliases = route.startsWith('ims')
      ? [route, 'ims', 'inward', 'outward']
      : route === 'hr-leave'
      ? ['hr-leave', 'leave-tracker']
      : [route];
    return routeAliases.some(r => permissions.pages.includes(r));
  },

  _buildNavItem(item, isAdmin, pendingCount, activeRoute, permissions, featureFlags) {
    // Same grant-outranks-adminOnly rule as canAccess above — the menu and the
    // router must never disagree about who can open a page.
    const grantedAdminPage = !!(permissions && permissions.pages && permissions.pages.includes(item.route));
    if (item.adminOnly && !isAdmin && !grantedAdminPage) return '';
    if (item.flag && !(featureFlags || {})[item.flag]) return '';
    // 'inward'/'outward' were their own toggleable pages once, and 'ims' was
    // the single combined page before the per-book split (see users.js). A
    // user permissioned before either change only has those old keys saved,
    // so honor any of them as access to every IMS book rather than letting
    // the grant silently disappear.
    // 'hr-leave' replaced the retired 'leave-tracker' page. Anybody who was
    // permissioned for the old one is permissioned for its replacement —
    // otherwise retiring the page would silently take leave away from every
    // user who has an explicit permission record.
    const routeAliases = item.route.startsWith('ims')
      ? [item.route, 'ims', 'inward', 'outward']
      : item.route === 'hr-leave'
      ? ['hr-leave', 'leave-tracker']
      : [item.route];
    if (!item.alwaysShow && permissions && permissions.pages && !routeAliases.some(r => permissions.pages.includes(r))) return '';

    const active = activeRoute === item.route;
    const icon   = this._icons[item.icon] || '';
    const badge  = item.badge && pendingCount > 0
      ? `<span style="position:absolute;top:-5px;right:-5px;box-shadow:0 0 0 2px var(--sidebar-bg);border-radius:9999px;line-height:0;">${window.UI.badge(pendingCount, { variant: 'primary' })}</span>`
      : '';

    const activeBg   = active ? 'var(--sidebar-active-bg)' : 'transparent';
    const activeBar  = active
      ? `<span style="position:absolute;left:0;top:5px;bottom:5px;width:2px;border-radius:0 2px 2px 0;background:var(--sidebar-accent-bar);"></span>`
      : '';
    const iconColor  = active ? 'var(--sidebar-accent)' : 'var(--sidebar-icon-muted)';
    const textColor  = active ? 'var(--sidebar-text)' : 'var(--sidebar-text-muted)';
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
         onmouseenter="if(this.dataset.active!=='1'){this.style.background='rgba(255,255,255,0.06)';this.style.color='var(--sidebar-text)';}"
         onmouseleave="if(this.dataset.active!=='1'){this.style.background='transparent';this.style.color='var(--sidebar-text-muted)';}"
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
    const roles      = (user?.roles || ['User']).join(' · ');
    /* What this person is allowed to see.
       ---------------------------------------------------------------------
       Admins used to be handed `null` here, which means "unrestricted" — so
       whatever an Admin was given in Users → Access was collected, saved, and
       then ignored by the menu. Their saved record is now honoured like
       everybody else's, which is the whole point of that screen.

       Two deliberate exceptions:

       - The owner is never restricted. It is the account that fixes a
         permissions mistake, and it must not be able to lock itself out of
         the screen it would fix it from.

       - An account with no saved record at all still sees everything. That is
         every Admin who has never been through Users → Access, so nothing
         changes for them until somebody actually sets their access — this is
         a switch that only takes effect once it is used. */
    const permissions = user?.isSuperAdmin ? null : (user?.permissions || null);
    const featureFlags = user?.featureFlags || {};

    if (!this._openSections) this._openSections = this._loadOpenSections(activeRoute);

    const sectionsHTML = this._sections.map(sec => {
      const itemsHTML = sec.items
        .map(item => this._buildNavItem(item, isAdmin, pendingCount, activeRoute, permissions, featureFlags))
        .join('');
      if (!itemsHTML.trim()) return '';
      const open = this._openSections.has(sec.title);
      return `
        <div style="margin-bottom:6px;">
          <button
            class="sb-label"
            data-section-head="${sec.title}"
            aria-expanded="${open ? 'true' : 'false'}"
            onclick="window.Sidebar.toggleSection('${sec.title}')"
            title="${sec.title}"
            style="
              display:flex;align-items:center;justify-content:space-between;gap:6px;
              width:100%;padding:10px 12px 3px;
              background:transparent;border:none;cursor:pointer;font-family:inherit;
              opacity:0;transition:opacity .22s;
            "
          >
            <span style="font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--sidebar-section-label);">${sec.title}</span>
            <span data-section-arrow="${sec.title}"
                  style="display:flex;flex-shrink:0;color:var(--sidebar-section-label);transform:rotate(${open ? 90 : 0}deg);transition:transform .18s;">
              ${this._icons.chevron}
            </span>
          </button>
          <div data-section-items="${sec.title}"
               style="padding:0 6px;display:${open ? 'flex' : 'none'};flex-direction:column;gap:2px;">
            ${itemsHTML}
          </div>
        </div>`;
    }).join('');

    return `
      <style>
        #sidebar { transition: width 0.22s cubic-bezier(0.4,0,0.2,1); }
        #sidebar:hover { width: var(--sidebar-w-expanded, 228px) !important; }
        /* The rail is position:fixed, so widening it alone would just lay it
           over the page. Push #shell-body (its next sibling) by the same
           amount so the content stays fully visible instead of being covered.
           The mobile rules use !important and win, which is right — the rail
           is display:none there. */
        #sidebar:hover ~ #shell-body {
          margin-left: var(--sidebar-w-expanded, 228px);
          width: calc(100vw - var(--sidebar-w-expanded, 228px));
        }
        #sidebar:hover .sb-label    { opacity: 1 !important; }
        #sidebar:hover .sb-brand-name { opacity: 1 !important; }
        #sidebar:hover .sb-user-info  { opacity: 1 !important; }
        #sidebar:hover .sb-signout    { opacity: 1 !important; }
        #sidebar nav::-webkit-scrollbar { width: 0; }
      </style>

      <!-- Brand -->
      <div style="height:52px;padding:0 10px;display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid var(--sidebar-border);">
        <img src="/logo.png" alt="Logo" width="30" height="30" style="flex-shrink:0;border-radius:7px;object-fit:contain;background:#fff;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
        <svg width="30" height="30" viewBox="0 0 28 28" fill="none" style="flex-shrink:0;display:none;">
          <rect width="28" height="28" rx="7" fill="#DF0419"/>
          <path d="M7 20V10l7-4 7 4v10" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M11 20v-5h6v5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="sb-brand-name" style="opacity:0;transition:opacity 0.22s;white-space:nowrap;overflow:hidden;min-width:0;">
          <div style="font-size:13px;font-weight:600;letter-spacing:-0.02em;color:var(--sidebar-text);white-space:nowrap;">Lallubhai Amichand</div>
        </div>
      </div>

      <!-- Nav -->
      <nav style="flex:1;overflow-y:auto;overflow-x:hidden;padding:6px 0;">
        ${sectionsHTML}
      </nav>

      <!-- User card -->
      <div style="padding:6px 6px 10px;border-top:1px solid var(--sidebar-border);flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;padding:6px;border-radius:7px;transition:background .14s;cursor:default;" onmouseenter="this.style.background='rgba(255,255,255,0.05)';" onmouseleave="this.style.background='transparent';">
          ${window.UI.avatar(user?.name, { variant: 'brand', size: 30, shape: 'square' })}
          <div class="sb-user-info" style="opacity:0;transition:opacity 0.22s;min-width:0;flex:1;overflow:hidden;">
            <div style="font-size:12px;font-weight:600;color:var(--sidebar-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user?.name || 'User'}</div>
            <div style="font-size:10px;color:var(--sidebar-signout-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${roles}</div>
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
              color:var(--sidebar-signout-muted);
              transition:color 0.14s,background 0.14s,opacity 0.22s;
            "
            onmouseenter="this.style.color='#f87171';this.style.background='rgba(220,38,38,0.12)';"
            onmouseleave="this.style.color='var(--sidebar-signout-muted)';this.style.background='transparent';"
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
      el.style.background   = isActive ? 'var(--sidebar-active-bg)' : 'transparent';
      el.style.fontWeight   = isActive ? '600' : '500';
      el.style.color        = isActive ? 'var(--sidebar-text)' : 'var(--sidebar-text-muted)';
      el.dataset.active     = isActive ? '1' : '';
      const iconSpan = el.querySelector('span');
      if (iconSpan) iconSpan.style.color = isActive ? 'var(--sidebar-accent)' : 'var(--sidebar-icon-muted)';
      let bar = el.querySelector('.sb-active-bar');
      if (isActive && !bar) {
        bar = document.createElement('span');
        bar.className = 'sb-active-bar';
        bar.style.cssText = 'position:absolute;left:0;top:5px;bottom:5px;width:2px;border-radius:0 2px 2px 0;background:var(--sidebar-accent-bar);';
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
      height:100vh;width:var(--sidebar-w, 52px);
      background:var(--sidebar-bg);
      border-right:1px solid var(--sidebar-border);
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
