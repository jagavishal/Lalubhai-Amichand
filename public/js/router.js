const _SPIN = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;letter-spacing:.01em;">Loading…</div></div></div>';

window.Router = {
  navigate(page) { window.location.hash = '#' + page; },

  init() {
    window.addEventListener('hashchange', () => this._render());
    this._render();
  },

  _render() {
    const page = (window.location.hash || '').replace('#', '') || 'dashboard';
    if (!window.currentUser && page !== 'login') { this.navigate('login'); return; }
    if (window.currentUser && page === 'login')  { this.navigate('dashboard'); return; }

    /* Page access was enforced only by leaving links out of the sidebar, which
       is decoration — anybody could type #users or #hr-payroll and the module
       rendered. Sidebar.canAccess is the same rule the menu is built from, so
       the two cannot drift. (The API is the real gate; this stops a restricted
       user from landing on a screen that would then fail request by request.) */
    if (page !== 'dashboard' && window.Sidebar?.canAccess && !window.Sidebar.canAccess(page)) {
      window.Utils?.showToast?.('You do not have access to that page', 'error');
      this.navigate('dashboard');
      return;
    }

    document.querySelectorAll('[data-route]').forEach(el =>
      el.classList.toggle('nav-active', el.dataset.route === page));

    // Paint spinner immediately; setTimeout(0) yields so the browser
    // renders it before the page module's render() runs its own innerHTML.
    const mc = document.getElementById('main-content');
    if (mc) mc.innerHTML = _SPIN;

    const mod = window.Pages?.[page];
    if (mod?.render) setTimeout(() => mod.render(), 0);
  },
};
