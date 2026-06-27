window.Utils = {

  /* ── API fetch with timeout ─────────────────────────────────────── */
  async apiFetch(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        ...opts,
      });
      clearTimeout(timer);
      if (res.status === 401) { window.location.hash = '#login'; return null; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('Request timed out');
      throw e;
    }
  },

  /* ── Toast notification ─────────────────────────────────────────── */
  showToast(msg, type = 'success') {
    // Stack management — remove old ones after 2
    const existing = document.querySelectorAll('.utils-toast');
    if (existing.length >= 3) existing[0].remove();

    const cfg = {
      success: { bg: '#f0fdf4', border: '#86efac', text: '#15803d', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>` },
      error:   { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>` },
      warning: { bg: '#fffbeb', border: '#fcd34d', text: '#b45309', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` },
      info:    { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>` },
    };
    const c = cfg[type] || cfg.success;

    const toast = document.createElement('div');
    toast.className = 'utils-toast';
    toast.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'z-index:9999',
      'display:flex',
      'align-items:flex-start',
      'gap:10px',
      'padding:13px 16px',
      'border-radius:12px',
      `background:${c.bg}`,
      `border:1.5px solid ${c.border}`,
      'box-shadow:0 8px 32px rgba(0,0,0,.12)',
      'font-size:13px',
      'font-weight:500',
      `color:${c.text}`,
      'max-width:320px',
      'min-width:220px',
      'transform:translateX(calc(100% + 32px))',
      'transition:transform .32s cubic-bezier(.16,1,.3,1),opacity .32s',
      'opacity:0',
      'cursor:default',
      'user-select:none',
    ].join(';');

    toast.innerHTML = `
      <span style="flex-shrink:0;margin-top:1px;">${c.icon}</span>
      <span style="flex:1;line-height:1.45;">${String(msg).replace(/</g,'&lt;')}</span>
      <button onclick="this.parentElement.remove()" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:${c.text};opacity:.5;padding:0 0 0 4px;line-height:1;font-size:16px;margin-top:-1px;" title="Dismiss">&times;</button>`;

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity   = '1';
      });
    });
    const hide = () => {
      toast.style.transform = 'translateX(calc(100% + 32px))';
      toast.style.opacity   = '0';
      setTimeout(() => toast.remove(), 340);
    };
    setTimeout(hide, 3200);
  },

  /* ── Confirm dialog (replaces native confirm()) ─────────────────── */
  showConfirm(msg, {
    title       = 'Confirm Action',
    confirmText = 'Confirm',
    cancelText  = 'Cancel',
    danger      = false,
  } = {}) {
    return new Promise((resolve) => {
      const existing = document.getElementById('utils-confirm-overlay');
      if (existing) existing.remove();

      const iconHtml = danger
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C4714A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

      const iconBg  = danger ? '#fef2f2' : '#fff8f5';
      const btnBg   = danger ? '#dc2626' : '#C4714A';
      const btnHover= danger ? '#b91c1c' : '#b5603a';

      const overlay = document.createElement('div');
      overlay.id = 'utils-confirm-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:grid;place-items:center;padding:16px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';

      overlay.innerHTML = `
        <div id="utils-confirm-box" style="background:#fff;border-radius:18px;width:100%;max-width:380px;box-shadow:0 24px 64px rgba(0,0,0,.2);overflow:hidden;animation:pop-in 220ms cubic-bezier(.16,1,.3,1);">
          <div style="padding:24px 24px 20px;display:flex;gap:14px;align-items:flex-start;">
            <div style="width:42px;height:42px;border-radius:12px;background:${iconBg};display:grid;place-items:center;flex-shrink:0;">${iconHtml}</div>
            <div style="flex:1;min-width:0;padding-top:2px;">
              <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:5px;">${String(title).replace(/</g,'&lt;')}</div>
              <div style="font-size:13px;color:#64748b;line-height:1.5;">${String(msg).replace(/</g,'&lt;')}</div>
            </div>
          </div>
          <div style="padding:0 24px 20px;display:flex;justify-content:flex-end;gap:10px;">
            <button id="utils-confirm-cancel" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background='#fff'">${String(cancelText).replace(/</g,'&lt;')}</button>
            <button id="utils-confirm-ok" style="padding:9px 22px;border-radius:9px;border:none;background:${btnBg};color:#fff;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s;" onmouseenter="this.style.background='${btnHover}'" onmouseleave="this.style.background='${btnBg}'">${String(confirmText).replace(/</g,'&lt;')}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity .2s';
        setTimeout(() => overlay.remove(), 210);
        resolve(result);
      };

      document.getElementById('utils-confirm-ok').addEventListener('click',     () => cleanup(true));
      document.getElementById('utils-confirm-cancel').addEventListener('click',  () => cleanup(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', esc); }
        if (e.key === 'Enter')  { cleanup(true);  document.removeEventListener('keydown', esc); }
      });
    });
  },

  /* ── Page-level loader ──────────────────────────────────────────── */
  showLoader(msg = 'Loading…') {
    const existing = document.getElementById('utils-page-loader');
    if (existing) { existing.querySelector('#utils-loader-msg').textContent = msg; return; }
    const el = document.createElement('div');
    el.id = 'utils-page-loader';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.75);z-index:9990;display:grid;place-items:center;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;">
        <div style="width:44px;height:44px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:#C4714A;animation:spin .7s linear infinite;"></div>
        <div id="utils-loader-msg" style="font-size:13px;font-weight:500;color:#64748b;">${String(msg).replace(/</g,'&lt;')}</div>
      </div>`;
    document.body.appendChild(el);
  },

  hideLoader() {
    const el = document.getElementById('utils-page-loader');
    if (!el) return;
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  },

  /* ── Inline skeleton block ──────────────────────────────────────── */
  skeleton(rows = 4) {
    const row = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;"><div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;flex-shrink:0;"></div><div style="flex:1;"><div style="height:11px;border-radius:4px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;margin-bottom:6px;width:60%;"></div><div style="height:10px;border-radius:4px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;width:40%;"></div></div></div>';
    return `<style>@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}</style>
      <div style="padding:20px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;">${row.repeat(rows)}</div>`;
  },

  /* ── Date helpers ───────────────────────────────────────────────── */
  formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatDateTime(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  /* ── Legacy (kept for backward compat) ─────────────────────────── */
  confirm(msg) { return window.confirm(msg); },
};
