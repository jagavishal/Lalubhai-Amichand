window.Router = {
  navigate(page) { window.location.hash = '#'+page; },
  init() {
    window.addEventListener('hashchange', ()=>this._render());
    this._render();
  },
  _render() {
    const page = (window.location.hash||'').replace('#','') || 'dashboard';
    if (!window.currentUser && page!=='login') { this.navigate('login'); return; }
    if (window.currentUser && page==='login') { this.navigate('dashboard'); return; }
    document.querySelectorAll('[data-route]').forEach(el => el.classList.toggle('nav-active', el.dataset.route===page));
    const mod = window.Pages?.[page];
    if (mod?.render) mod.render();
  }
};
