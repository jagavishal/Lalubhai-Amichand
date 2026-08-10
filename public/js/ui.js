window.UI = (function () {

  /* ── Avatar ──────────────────────────────────────────────────────── */
  // 'auto' palette/hash copied verbatim from the original dashboard.js avatarHTML()
  // so existing avatars don't visibly shuffle color after adoption.
  const AUTO_PALETTE = [
    { bg: 'background:linear-gradient(135deg,#f43f5e,#db2777)', text: '#fff' },
    { bg: 'background:linear-gradient(135deg,#f59e0b,#ea580c)', text: '#fff' },
    { bg: 'background:linear-gradient(135deg,#10b981,#0d9488)', text: '#fff' },
    { bg: 'background:linear-gradient(135deg,#0A63C9,#0150AA)', text: '#fff' },
    { bg: 'background:linear-gradient(135deg,#8b5cf6,#7c3aed)', text: '#fff' },
  ];

  function avatar(name, opts = {}) {
    const { size = 28, variant = 'auto', shape = 'circle', id = '', className = '' } = opts;
    name = name || '';
    const initials = name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || '·';
    let bg, textColor;
    if (variant === 'brand') {
      bg = 'background:linear-gradient(135deg,var(--color-primary),var(--color-primary-dark))';
      textColor = 'var(--color-primary-text)';
    } else {
      const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const swatch = AUTO_PALETTE[hash % AUTO_PALETTE.length];
      bg = swatch.bg;
      textColor = swatch.text;
    }
    const fontSize = Math.max(9, Math.round(size * 0.36));
    const radius = shape === 'square' ? 'var(--radius-md)' : '50%';
    return `<div${id ? ` id="${id}"` : ''} class="ui-avatar ${className}" style="${bg};width:${size}px;height:${size}px;border-radius:${radius};display:inline-flex;align-items:center;justify-content:center;color:${textColor};font-size:${fontSize}px;font-weight:700;flex-shrink:0;letter-spacing:.02em;">${initials}</div>`;
  }

  /* ── Pill (status/label) ────────────────────────────────────────── */
  function pill(text, opts = {}) {
    const { variant = 'neutral', size = 'md', icon = '', id = '', className = '' } = opts;
    const sizeClass = size === 'sm' ? ' pill-sm' : '';
    return `<span${id ? ` id="${id}"` : ''} class="pill pill-${variant}${sizeClass} ${className}">${icon}${text}</span>`;
  }

  /* ── Badge (numeric/dot counter) ─────────────────────────────────── */
  function badge(count, opts = {}) {
    const { variant = 'primary', max = 99, dot = false, id = '' } = opts;
    const variantClass = variant === 'primary' ? '' : ` badge-${variant}`;
    if (dot) return `<span${id ? ` id="${id}"` : ''} class="badge badge-dot${variantClass}"></span>`;
    const n = Number(count) || 0;
    if (n <= 0) return '';
    const label = n > max ? `${max}+` : String(n);
    return `<span${id ? ` id="${id}"` : ''} class="badge${variantClass}">${label}</span>`;
  }

  /* ── Modal shell ─────────────────────────────────────────────────── */
  const X_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function modal(opts = {}) {
    const {
      id, title, subtitle = '', icon = '', width = 480,
      bodyHTML = '', footerHTML = '', closeButtonId = '', hiddenByDefault = true,
    } = opts;
    return `
      <div id="${id}" class="modal-overlay" style="${hiddenByDefault ? 'display:none;' : ''}">
        <div class="modal-box" style="max-width:${width}px;">
          <div class="modal-header">
            ${icon ? `<div class="modal-header-icon">${icon}</div>` : ''}
            <div style="flex:1;min-width:0;">
              <div class="modal-title">${title}</div>
              ${subtitle ? `<div class="modal-subtitle">${subtitle}</div>` : ''}
            </div>
            ${closeButtonId ? `<button id="${closeButtonId}" class="icon-btn" type="button" aria-label="Close">${X_ICON}</button>` : ''}
          </div>
          <div class="modal-body">${bodyHTML}</div>
          ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
        </div>
      </div>`;
  }

  function showModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
  function hideModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

  /* ── Stat tile ───────────────────────────────────────────────────── */
  function statTile(opts = {}) {
    const { id = '', label, value, icon = '', color = 'brand', sub = '', onClickAttr = '' } = opts;
    const colorClass = { brand: 'indigo', success: 'green', warning: 'amber', danger: 'red', info: 'indigo', neutral: '' }[color] || '';
    return `
      <div${id ? ` id="${id}"` : ''} class="card stat-card ${colorClass}" style="padding:20px;${onClickAttr ? 'cursor:pointer;' : ''}"${onClickAttr}>
        <div style="display:flex;align-items:center;gap:8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:4px;">${icon}${label}</div>
        <div style="font-size:2.5rem;font-weight:800;color:var(--text-primary);">${value}</div>
        ${sub ? `<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:4px;">${sub}</div>` : ''}
      </div>`;
  }

  /* ── Lightbox (click a photo → full-size preview) ────────────────── */
  // Any <img data-zoom> anywhere in the app opens here. The delegated click
  // runs in the capture phase so a zoomable photo sitting inside a clickable
  // row/card doesn't also trigger that row's handler.
  let _lbEl = null;

  function _buildLightbox() {
    const el = document.createElement('div');
    el.id = 'ui-lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <button type="button" class="ui-lightbox-close" aria-label="Close">${X_ICON}</button>
      <img class="ui-lightbox-img" alt="" />
      <div class="ui-lightbox-caption"></div>`;
    el.addEventListener('click', e => {
      // Backdrop / close button closes; clicking the image itself does not.
      if (!e.target.closest('.ui-lightbox-img')) hideLightbox();
    });
    document.body.appendChild(el);
    return el;
  }

  function lightbox(src, alt = '') {
    if (!src) return;
    if (!_lbEl || !document.body.contains(_lbEl)) _lbEl = _buildLightbox();
    const img = _lbEl.querySelector('.ui-lightbox-img');
    const cap = _lbEl.querySelector('.ui-lightbox-caption');
    img.style.width = '';
    img.onload = () => {
      // Stored avatars are small (200×200) — upscale so "full image" actually
      // fills the viewport instead of rendering as a thumbnail on a black sheet.
      const target = Math.min(560, window.innerWidth * 0.9, window.innerHeight * 0.8);
      if (img.naturalWidth && img.naturalWidth < target) {
        img.style.width = Math.round(target) + 'px';
      }
    };
    img.src = src;
    img.alt = alt || '';
    cap.textContent = alt || '';
    cap.style.display = alt ? '' : 'none';
    _lbEl.classList.add('open');
    document.body.style.overflow = 'hidden';
    _lbEl.querySelector('.ui-lightbox-close')?.focus();
  }

  function hideLightbox() {
    if (!_lbEl) return;
    _lbEl.classList.remove('open');
    _lbEl.querySelector('.ui-lightbox-img').removeAttribute('src');
    document.body.style.overflow = '';
  }

  document.addEventListener('click', e => {
    const img = e.target instanceof Element ? e.target.closest('img[data-zoom]') : null;
    if (!img || !img.getAttribute('src')) return;
    e.preventDefault();
    e.stopPropagation();
    lightbox(img.getAttribute('src'), img.dataset.zoomCaption || img.getAttribute('alt') || '');
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _lbEl?.classList.contains('open')) hideLightbox();
  });

  /* ── Empty state ─────────────────────────────────────────────────── */
  const DEFAULT_INBOX_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>';

  function emptyState(opts = {}) {
    const { icon = DEFAULT_INBOX_ICON, title, message = '', actionLabel = '', actionOnClickAttr = '' } = opts;
    return `
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${title}</div>
        ${message ? `<div style="font-size:12px;color:var(--text-muted);">${message}</div>` : ''}
        ${actionLabel ? `<button class="btn-secondary btn-sm"${actionOnClickAttr}>${actionLabel}</button>` : ''}
      </div>`;
  }

  return { avatar, pill, badge, modal, showModal, hideModal, statTile, emptyState, lightbox, hideLightbox };
})();
