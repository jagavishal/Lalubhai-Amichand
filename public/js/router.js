const _SPIN = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid var(--border-light);border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:var(--text-muted);font-weight:500;letter-spacing:.01em;">Loading…</div></div></div>';

window.Router = {
  navigate(page) { window.location.hash = '#' + page; },

  init() {
    window.addEventListener('hashchange', () => this._render());
    this._render();
  },

  /* Per-page AbortSignal.
     ---------------------------------------------------------------------
     Pages have no unmount hook, and several of them attach listeners to
     `document`/`window` from their render() (the "close this dropdown on an
     outside click" pattern). Every navigation back to such a page added
     another copy, each holding its old, detached DOM alive — after a morning of
     clicking around, a single click on the document ran dozens of dead handlers.
     Passing this signal to addEventListener ties the listener to the page:
     the router aborts it the moment another page is rendered. */
  _pageAbort: null,
  pageSignal() {
    if (!this._pageAbort) this._pageAbort = new AbortController();
    return this._pageAbort.signal;
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

    // Drop everything the previous page hung on document/window.
    if (this._pageAbort) this._pageAbort.abort();
    this._pageAbort = new AbortController();

    // Paint spinner immediately; setTimeout(0) yields so the browser
    // renders it before the page module's render() runs its own innerHTML.
    const mc = document.getElementById('main-content');
    if (mc) mc.innerHTML = _SPIN;

    const mod = window.Pages?.[page];
    if (mod?.render) setTimeout(() => mod.render(), 0);
  },
};
