window.Theme = (function () {
  const KEY = 'erp-mode';

  const SUN_ICON  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  const MOON_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>';

  function current() { return document.documentElement.dataset.theme || 'light'; }

  function _updateToggleIcon() {
    const btn = document.getElementById('tb-theme-btn');
    if (!btn) return;
    const icon = btn.querySelector('.tb-theme-icon');
    if (icon) icon.innerHTML = current() === 'dark' ? SUN_ICON : MOON_ICON;
  }

  function apply(mode) {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem(KEY, mode);
    _updateToggleIcon();
  }

  function toggle() { apply(current() === 'dark' ? 'light' : 'dark'); }

  function init() {
    let m = localStorage.getItem(KEY);
    if (!m) m = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    apply(m);
  }

  return { init, apply, toggle, current, SUN_ICON, MOON_ICON };
})();
