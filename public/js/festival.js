/* Festival theme for the dashboard — Navratri and Dussehra are separate looks.
   Dashboard calls Festival.mount(wrapEl) after it paints; everything lives
   inside #main-content, so navigating away wipes it (the particle loop stops
   itself once its canvas is detached). Off-season mount() is a no-op.

   Dates come from the calendar below — add next year's row each September.
   Preview any look off-season with ?fest=navratri or ?fest=dussehra in the URL,
   or a specific day with ?fest=YYYY-MM-DD. */
window.Festival = (function () {
  const MODE_KEY = 'erp-fest-mode'; // full | lite | off

  // start = Ghatasthapana (Navratri day 1), dussehra = Vijayadashami.
  const CALENDAR = [
    { start: '2026-10-11', dussehra: '2026-10-20' },
    { start: '2027-09-30', dussehra: '2027-10-09' }, // verify against the panchang before Sep 2027
  ];

  const GODDESS = ['Shailputri', 'Brahmacharini', 'Chandraghanta', 'Kushmanda', 'Skandamata',
                   'Katyayani', 'Kalaratri', 'Mahagauri', 'Siddhidatri'];
  // Day-1 colour follows the weekday it falls on, the next six follow this
  // cycle, and days 8–9 are always peacock green and purple.
  const CYCLE = ['White', 'Red', 'Royal Blue', 'Yellow', 'Green', 'Grey', 'Orange'];
  const WEEKDAY_START = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }; // Sun→Orange, Mon→White …
  const HEX = { White: '#f8fafc', Red: '#dc2626', 'Royal Blue': '#1d4ed8', Yellow: '#facc15', Green: '#16a34a',
                Grey: '#9ca3af', Orange: '#f97316', 'Peacock Green': '#0d9488', Purple: '#7e22ce' };

  /* ── dates ───────────────────────────────────────────────────────── */
  function istISO(d) {
    return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dayDiff(a, b) { return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5); }

  function navratriColour(startISO, dayIdx) {
    if (dayIdx === 7) return 'Peacock Green';
    if (dayIdx === 8) return 'Purple';
    const first = WEEKDAY_START[new Date(startISO + 'T00:00:00Z').getUTCDay()];
    return CYCLE[(first + dayIdx) % 7];
  }

  // → { kind:'navratri', day:0..9 (0 = eve), row } | { kind:'dussehra', row } | null
  function current() {
    const params = new URLSearchParams(location.search);
    const preview = params.get('fest');
    // ?fest=2026-10-15 pretends today is that date, to check any day's look.
    const today = /^\d{4}-\d{2}-\d{2}$/.test(preview || '') ? preview : istISO(new Date());
    for (const row of CALENDAR) {
      if (preview === 'navratri') return { kind: 'navratri', day: Math.max(1, Math.min(9, dayDiff(today, row.start) + 1)), row };
      if (preview === 'dussehra') return { kind: 'dussehra', row };
      const n = dayDiff(today, row.start);
      if (n >= -1 && n <= 8) return { kind: 'navratri', day: n + 1, row };
      if (today === row.dussehra || today === addDays(row.dussehra, 1)) return { kind: 'dussehra', row, after: today !== row.dussehra };
    }
    return null;
  }

  function mode() {
    try { return localStorage.getItem(MODE_KEY) || 'full'; } catch { return 'full'; }
  }
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch {} }

  /* ── art ─────────────────────────────────────────────────────────── */
  // One toran tile: string sag, marigold, mango leaf. Repeated across.
  const TORAN = (accent) => `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='34' viewBox='0 0 48 34'>
      <path d='M0 3 Q24 9 48 3' stroke='${accent}' stroke-width='2' fill='none'/>
      <path d='M12 6 C7 14 9 24 12 30 C15 24 17 14 12 6Z' fill='#15803d'/>
      <path d='M12 8 L12 28' stroke='#4ade80' stroke-width='.8'/>
      <circle cx='36' cy='13' r='6.5' fill='#f97316'/><circle cx='36' cy='13' r='4.2' fill='#fb923c'/>
      <circle cx='36' cy='13' r='2' fill='#fbbf24'/>
      <circle cx='36' cy='23' r='4.5' fill='#facc15'/><circle cx='36' cy='23' r='2' fill='#fde047'/>
    </svg>`)}")`;


  // Crossed dandiya sticks with ribbon bands.

  // Garba deepak — the perforated pot danced around.
  const GARBO = `<svg width="30" height="38" viewBox="0 0 96 120" aria-hidden="true">
    <path class="fest-flame" d="M48 4 C55 15 55 22 48 28 C41 22 41 15 48 4Z" fill="#fbbf24"/>
    <path d="M48 12 C51 17 51 21 48 25 C45 21 45 17 48 12Z" fill="#fff7d6"/>
    <rect x="38" y="28" width="20" height="8" rx="2" fill="#b45309"/>
    <path d="M30 36 H66 C86 48 90 72 80 92 C72 108 24 108 16 92 C6 72 10 48 30 36Z" fill="#ea580c"/>
    <path d="M16 70 H80" stroke="#facc15" stroke-width="4"/>
    ${[[30, 52], [48, 50], [66, 52], [24, 84], [40, 86], [56, 86], [72, 84], [32, 98], [48, 99], [64, 98]]
      .map(([x, y]) => `<circle class="fest-hole" cx="${x}" cy="${y}" r="3.2" fill="#fde68a"/>`).join('')}
  </svg>`;

  const BOW = `<svg width="32" height="32" viewBox="0 0 46 46" aria-hidden="true">
    <path d="M10 4 C34 10 36 36 10 42" stroke="#92400e" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M10 4 L10 42" stroke="#fcd34d" stroke-width="1.2"/>
    <path d="M6 23 H42" stroke="#78350f" stroke-width="2.2"/><path d="M42 23 l-7 -4 v8z" fill="#b91c1c"/>
    <path d="M6 23 l-3 -3 M6 23 l-3 3" stroke="#b91c1c" stroke-width="2"/>
  </svg>`;

  // Ravan effigy: ten heads (one big, nine small), crown, body on a stand.
  function RAVAN() {
    const small = [-4, -3, -2, -1, 1, 2, 3, 4].map(i => {
      const x = 60 + i * 12.5, y = 32 + Math.abs(i) * 2.2;
      return `<g><rect x="${x - 6}" y="${y - 12}" width="12" height="8" fill="#facc15"/><circle cx="${x}" cy="${y}" r="7" fill="#d97706"/>
        <circle cx="${x - 2.3}" cy="${y - 1}" r="1.2" fill="#111"/><circle cx="${x + 2.3}" cy="${y - 1}" r="1.2" fill="#111"/>
        <path d="M${x - 3} ${y + 3} q3 2 6 0" stroke="#7f1d1d" stroke-width="1.2" fill="none"/></g>`;
    }).join('');
    return `<svg class="fest-ravan-svg" width="26" height="42" viewBox="0 0 120 190" aria-hidden="true">
      ${small}
      <path d="M48 14 L52 2 L56 10 L60 0 L64 10 L68 2 L72 14Z" fill="#facc15" stroke="#b45309"/>
      <circle cx="60" cy="30" r="13" fill="#ea580c"/>
      <path d="M52 25 l5 2 M68 25 l-5 2" stroke="#111" stroke-width="2"/>
      <circle cx="55" cy="29" r="2" fill="#111"/><circle cx="65" cy="29" r="2" fill="#111"/>
      <path d="M53 37 q7 -4 14 0" stroke="#111" stroke-width="2" fill="none"/>
      <path d="M50 40 q10 6 20 0" stroke="#111" stroke-width="2.2" fill="none"/>
      <path d="M40 46 H80 L86 120 H34Z" fill="#b91c1c"/>
      <path d="M40 46 H80 L78 60 H42Z" fill="#facc15"/>
      ${[56, 70, 84, 98, 112].map(y => `<path d="M36 ${y} H84" stroke="#fde047" stroke-width="2" stroke-dasharray="4 3"/>`).join('')}
      <path d="M40 50 L22 88 L28 90 L44 60Z M80 50 L98 88 L92 90 L76 60Z" fill="#991b1b"/>
      <path d="M95 86 L103 40" stroke="#94a3b8" stroke-width="3"/><path d="M103 40 l-4 8 h8z" fill="#cbd5e1"/>
      <path d="M44 120 L40 176 H50 L56 120Z M64 120 L70 176 H80 L76 120Z" fill="#7f1d1d"/>
      <rect x="26" y="176" width="68" height="8" rx="2" fill="#78350f"/>
      <g class="fest-fire">
        ${[[40, 150], [60, 110], [80, 150], [50, 70], [70, 70], [60, 30]].map(([x, y], i) =>
          `<path style="animation-delay:${i * 0.12}s" d="M${x} ${y - 26} C${x + 14} ${y - 8} ${x + 10} ${y + 8} ${x} ${y + 10} C${x - 10} ${y + 8} ${x - 14} ${y - 8} ${x} ${y - 26}Z" fill="${i % 2 ? '#f97316' : '#fbbf24'}"/>`).join('')}
      </g>
    </svg>`;
  }

  /* ── styles (injected once) ──────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('fest-css')) return;
    const s = document.createElement('style');
    s.id = 'fest-css';
    s.textContent = `
      .fest-toran { height: 24px; margin: -8px 0 12px; background-repeat: repeat-x; background-size: 34px 24px; opacity: .9;
        animation: festSwing 5s ease-in-out infinite; transform-origin: top center; }
      @keyframes festSwing { 0%,100% { transform: skewX(0) } 50% { transform: skewX(.8deg) } }

      /* Card in the page's own surface colour; the festival shows in a thin
         gradient edge, a soft glow and the accent text — not a loud fill. */
      .fest-banner { --fa: #be123c; --fa-soft: #fff1f2; --fa-edge: linear-gradient(90deg, #be123c, #f97316, #f59e0b);
        position: relative; overflow: hidden; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
        padding: 14px 18px; margin-bottom: 18px; border-radius: 14px; background: var(--surface, #fff);
        border: 1px solid rgba(190,18,60,.14); box-shadow: 0 1px 3px rgba(15,23,42,.05); }
      .fest-banner.dussehra { --fa: #b91c1c; --fa-soft: #fff7ed; --fa-edge: linear-gradient(90deg, #7f1d1d, #dc2626, #f59e0b);
        border-color: rgba(185,28,28,.16); }
      .fest-banner::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--fa-edge); }
      .fest-banner::after { content: ''; position: absolute; left: -60px; top: -80px; width: 260px; height: 220px; pointer-events: none;
        background: radial-gradient(closest-side, rgba(249,115,22,.07), transparent); }
      html[data-theme="dark"] .fest-banner { --fa: #fb7185; --fa-soft: rgba(251,113,133,.10); border-color: rgba(251,113,133,.18); }
      html[data-theme="dark"] .fest-banner.dussehra { --fa: #fb923c; --fa-soft: rgba(251,146,60,.10); }

      .fest-icon { position: relative; z-index: 1; flex-shrink: 0; width: 54px; height: 54px; border-radius: 50%;
        background: var(--fa-soft); display: grid; place-items: center; }
      .fest-body { position: relative; z-index: 1; flex: 1; min-width: 0; }
      .fest-title { font-size: 17px; font-weight: 700; line-height: 1.3; color: var(--text-primary, #0f172a); }
      .fest-title b { color: var(--fa); font-weight: 700; }
      .fest-title span { color: var(--text-muted, #94a3b8); font-weight: 400; margin: 0 6px; }
      .fest-sub { font-size: 13px; color: var(--text-secondary, #475569); margin-top: 2px; }
      .fest-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 12px; color: var(--text-secondary, #475569); }
      .fest-days { display: flex; gap: 5px; }
      .fest-days i { width: 10px; height: 10px; border-radius: 50%; display: block; opacity: .28;
        box-shadow: inset 0 0 0 1px rgba(15,23,42,.15); }
      .fest-days i.past { opacity: .9; }
      .fest-days i.today { opacity: 1; box-shadow: 0 0 0 2px var(--surface, #fff), 0 0 0 3.5px var(--fa); }

      .fest-right { margin-left: auto; position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; }
      .fest-ctrl { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px;
        background: var(--surface-alt, #f8fafc); border: 1px solid var(--border, #e2e8f0); }
      .fest-ctrl button { border: 0; background: transparent; color: var(--text-muted, #64748b); font-size: 11.5px; font-weight: 600;
        padding: 4px 11px; border-radius: 999px; cursor: pointer; }
      .fest-ctrl button.on { background: var(--surface, #fff); color: var(--fa); box-shadow: 0 1px 3px rgba(15,23,42,.12); }
      .fest-off { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted, #64748b);
        background: none; border: 1px dashed currentColor; border-radius: 999px; padding: 3px 12px; cursor: pointer; margin-bottom: 14px; }

      .fest-ravan { display: flex; align-items: center; gap: 8px; cursor: pointer; border: 1px solid rgba(185,28,28,.2);
        background: var(--fa-soft); border-radius: 12px; padding: 3px 12px 3px 8px; color: var(--fa); font-size: 12px; font-weight: 600; }
      .fest-ravan:hover { border-color: var(--fa); }

      .fest-flame { transform-origin: 50% 100%; animation: festFlicker .5s ease-in-out infinite alternate; }
      @keyframes festFlicker { from { transform: scale(1, 1) } to { transform: scale(.88, 1.12) } }
      .fest-hole { animation: festGlow 1.4s ease-in-out infinite alternate; }
      .fest-hole:nth-child(3n) { animation-delay: .5s } .fest-hole:nth-child(3n+1) { animation-delay: .9s }
      @keyframes festGlow { from { opacity: .45 } to { opacity: 1 } }

      .fest-fire { opacity: 0; transition: opacity .4s; }
      .fest-fire path { transform-box: fill-box; transform-origin: 50% 100%; animation: festFlicker .35s ease-in-out infinite alternate; }
      .fest-ravan.burning .fest-fire { opacity: .95; }
      .fest-ravan.burning .fest-ravan-svg { animation: festShake .2s linear infinite; }
      .fest-ravan.burnt { opacity: 0; transition: opacity 1s; pointer-events: none; }
      @keyframes festShake { 0%,100% { transform: translateX(0) } 50% { transform: translateX(1.5px) } }
      .fest-arrow { position: fixed; z-index: 31; pointer-events: none; width: 60px; height: 3px; background: #78350f; }
      .fest-arrow::after { content: ''; position: absolute; right: -10px; top: -5px; border-left: 12px solid #b91c1c;
        border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
      .fest-victory { position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%) scale(.9); z-index: 40; pointer-events: none;
        font-size: 28px; font-weight: 800; color: #b91c1c; background: var(--surface, #fff); padding: 16px 32px; border-radius: 16px;
        border-top: 4px solid #f59e0b; box-shadow: 0 20px 50px rgba(15,23,42,.18); opacity: 0; transition: opacity .3s, transform .3s; text-align: center; }
      .fest-victory small { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary, #475569); margin-top: 2px; }
      .fest-victory.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }

      .fest-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 25; }

      @media (max-width: 767px) {
        .fest-right { margin-left: 0; width: 100%; justify-content: space-between; }
        .fest-title span { display: none; }
        .fest-title b { display: block; }
        .fest-icon { width: 46px; height: 46px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .fest-toran, .fest-flame, .fest-hole { animation: none !important; }
      }`;
    document.head.appendChild(s);
  }

  /* ── particles ───────────────────────────────────────────────────── */
  // Navratri: petals drifting down. Dussehra: embers rising.
  function startParticles(host, kind) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas');
    c.className = 'fest-canvas';
    host.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W, H;
    function size() { W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    addEventListener('resize', size);

    const COLS = kind === 'navratri' ? ['#f97316', '#fbbf24', '#e11d48', '#ec4899', '#facc15'] : ['#fbbf24', '#f97316', '#ef4444', '#fde047'];
    const N = W < 768 ? 6 : 14;
    const BAND = 300; // px from the top — petals/embers never drift over the tables
    const ps = Array.from({ length: N }, () => spawn(true));
    function spawn(initial) {
      const up = kind === 'dussehra';
      return {
        x: Math.random() * W,
        y: initial ? Math.random() * BAND : (up ? BAND : -10),
        r: up ? 1 + Math.random() * 1.6 : 2.5 + Math.random() * 2.5,
        vy: up ? -(0.25 + Math.random() * 0.4) : 0.25 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.4,
        a: Math.random() * Math.PI * 2, va: (Math.random() - 0.5) * 0.04,
        col: COLS[(Math.random() * COLS.length) | 0], life: 0,
      };
    }
    function frame() {
      if (!c.isConnected) { removeEventListener('resize', size); return; }
      if (!document.hidden) {
        ctx.clearRect(0, 0, W, H);
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          p.life++; p.a += p.va;
          p.x += p.vx + Math.sin(p.life / 40 + i) * 0.35; p.y += p.vy;
          if (p.y > BAND || p.y < -20 || p.x < -20 || p.x > W + 20) { ps[i] = spawn(false); continue; }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col;
          if (kind === 'navratri') {
            ctx.globalAlpha = 0.7 * Math.max(0, 1 - p.y / BAND);
            ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.globalAlpha = 0.85 * Math.max(0, Math.min(1, p.y / BAND));
            ctx.shadowColor = p.col; ctx.shadowBlur = 8;
            ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Short burst of sparks at (x, y) — used when Ravan goes up.
  function fireworks(host, x, y) {
    const c = document.createElement('canvas');
    c.className = 'fest-canvas'; c.style.zIndex = 35;
    host.appendChild(c);
    const ctx = c.getContext('2d');
    c.width = innerWidth; c.height = innerHeight;
    const cols = ['#fbbf24', '#f97316', '#ef4444', '#fde047', '#fff'];
    const sparks = [];
    for (let b = 0; b < 3; b++) {
      const bx = x + (b - 1) * 90, by = y - 60 - b * 40;
      for (let i = 0; i < 40; i++) {
        const ang = (i / 40) * Math.PI * 2, sp = 2 + Math.random() * 3;
        sparks.push({ x: bx, y: by, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 60 + Math.random() * 30, delay: b * 14, col: cols[i % cols.length] });
      }
    }
    let t = 0;
    (function frame() {
      t++;
      ctx.clearRect(0, 0, c.width, c.height);
      let alive = 0;
      for (const s of sparks) {
        if (t < s.delay || s.life <= 0) { if (s.life > 0) alive++; continue; }
        s.x += s.vx; s.y += s.vy; s.vy += 0.05; s.vx *= 0.98; s.life--; alive++;
        ctx.globalAlpha = Math.min(1, s.life / 40); ctx.fillStyle = s.col;
        ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fill();
      }
      if (alive && c.isConnected) requestAnimationFrame(frame); else c.remove();
    })();
  }

  /* ── banner ──────────────────────────────────────────────────────── */
  function bannerHTML(f) {
    const m = mode();
    const ctrl = `<div class="fest-ctrl" role="group" aria-label="Festival theme">
      ${['full', 'lite', 'off'].map(k => `<button type="button" data-fest-mode="${k}" class="${m === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
    </div>`;

    if (f.kind === 'navratri') {
      let sub, meta = '';
      if (f.day === 0) {
        sub = `Navratri begins tomorrow · Ghatasthapana, ${new Date(f.row.start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`;
      } else {
        const col = navratriColour(f.row.start, f.day - 1);
        sub = `Day ${f.day} of 9 · Maa ${GODDESS[f.day - 1]}${f.day === 8 ? ' · Durga Ashtami' : f.day === 9 ? ' · Maha Navami' : ''}`;
        // One dot per day in that day's colour — the row doubles as the progress bar.
        const dots = Array.from({ length: 9 }, (_, i) => {
          const c = navratriColour(f.row.start, i);
          return `<i title="Day ${i + 1} · ${c}" class="${i + 1 < f.day ? 'past' : i + 1 === f.day ? 'today' : ''}" style="background:${HEX[c]}"></i>`;
        }).join('');
        meta = `<div class="fest-meta"><div class="fest-days">${dots}</div><span>Today's colour · <b style="color:var(--text-primary)">${col}</b></span></div>`;
      }
      return `<div class="fest-banner navratri">
        <div class="fest-icon">${GARBO}</div>
        <div class="fest-body">
          <div class="fest-title"><b>शुभ नवरात्रि</b><span>·</span>Happy Navratri</div>
          <div class="fest-sub">${sub}</div>${meta}
        </div>
        <div class="fest-right">${ctrl}</div>
      </div>`;
    }

    return `<div class="fest-banner dussehra">
      <div class="fest-icon">${BOW}</div>
      <div class="fest-body">
        <div class="fest-title"><b>शुभ विजयादशमी</b><span>·</span>Happy Dussehra</div>
        <div class="fest-sub">असत्य पर सत्य की विजय — may good always win over evil.</div>
      </div>
      <div class="fest-right">${m === 'full' && !f.after
        ? `<button type="button" class="fest-ravan" title="Shoot the arrow">${RAVAN()}Ravan Dahan</button>`
        : ''}${ctrl}</div>
    </div>`;
  }

  /* ── Ravan dahan ─────────────────────────────────────────────────── */
  function wireRavan(banner, host) {
    const rav = banner.querySelector('.fest-ravan');
    if (!rav) return;
    rav.addEventListener('click', () => {
      if (rav.classList.contains('burning')) return;
      const r = rav.getBoundingClientRect();
      const tx = r.left + r.width / 2, ty = r.top + r.height * 0.35;
      const arrow = document.createElement('div');
      arrow.className = 'fest-arrow';
      const sx = innerWidth * 0.35, sy = innerHeight * 0.75;
      const ang = Math.atan2(ty - sy, tx - sx);
      Object.assign(arrow.style, { left: sx + 'px', top: sy + 'px', transform: `rotate(${ang}rad)` });
      host.appendChild(arrow);
      arrow.animate([{ left: sx + 'px', top: sy + 'px' }, { left: (tx - 60) + 'px', top: ty + 'px' }], { duration: 550, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => {
          arrow.remove();
          rav.classList.add('burning');
          fireworks(host, tx, ty);
          const v = document.createElement('div');
          v.className = 'fest-victory';
          v.innerHTML = 'जय श्री राम 🏹<small>Happy Dussehra from Lalubhai Amichand</small>';
          host.appendChild(v);
          requestAnimationFrame(() => v.classList.add('show'));
          setTimeout(() => v.classList.remove('show'), 2600);
          setTimeout(() => { v.remove(); rav.classList.add('burnt'); }, 3200);
        });
    });
  }

  /* ── mount ───────────────────────────────────────────────────────── */
  function mount(wrap) {
    const f = current();
    if (!f || !wrap) return;
    injectCSS();
    paint(wrap, f);
  }

  function paint(wrap, f) {
    wrap.querySelectorAll(':scope > .fest-el').forEach(n => n.remove());
    const m = mode();
    const add = (html, where) => {
      const t = document.createElement('div');
      t.className = 'fest-el';
      t.innerHTML = html;
      where === 'top' ? wrap.prepend(t) : wrap.appendChild(t);
      return t;
    };

    if (m === 'off') {
      const t = add(`<button type="button" class="fest-off">🪔 ${f.kind === 'navratri' ? 'Navratri' : 'Dussehra'} theme is off — turn on</button>`, 'top');
      t.querySelector('button').onclick = () => { setMode('full'); paint(wrap, f); };
      return;
    }

    const accent = f.kind === 'navratri' ? '#e11d48' : '#b45309';
    const top = add(`<div class="fest-toran"></div>${bannerHTML(f)}`, 'top');
    top.querySelector('.fest-toran').style.backgroundImage = TORAN(accent);
    top.querySelectorAll('[data-fest-mode]').forEach(b => b.onclick = () => { setMode(b.dataset.festMode); paint(wrap, f); });

    if (m !== 'full') return;
    const fx = add('');
    startParticles(fx, f.kind);
    wireRavan(top, fx);
  }

  return { mount, current };
})();
