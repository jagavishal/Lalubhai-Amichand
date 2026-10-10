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

  const DIYA = `<svg class="fest-diya" width="52" height="46" viewBox="0 0 34 30" aria-hidden="true">
    <path class="fest-flame" d="M17 2 C21 8 21 12 17 15 C13 12 13 8 17 2Z" fill="#fbbf24"/>
    <path d="M17 7 C19 10 19 12 17 14 C15 12 15 10 17 7Z" fill="#fff7d6"/>
    <path d="M2 17 H32 C30 25 24 28 17 28 C10 28 4 25 2 17Z" fill="#c2410c"/>
    <path d="M5 19 H29" stroke="#fdba74" stroke-width="1.4" stroke-dasharray="2 2"/>
  </svg>`;

  // Crossed dandiya sticks with ribbon bands.
  const DANDIYA = `<svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
    <g class="fest-sway">
      <g transform="rotate(-35 60 60)">
        <rect x="55" y="6" width="10" height="108" rx="5" fill="#be123c"/>
        ${[16, 36, 56, 76, 96].map((y, i) => `<rect x="55" y="${y}" width="10" height="7" fill="${['#facc15', '#16a34a', '#2563eb', '#facc15', '#16a34a'][i]}"/>`).join('')}
        <circle cx="60" cy="6" r="5" fill="#f59e0b"/><circle cx="60" cy="114" r="5" fill="#f59e0b"/>
      </g>
      <g transform="rotate(35 60 60)">
        <rect x="55" y="6" width="10" height="108" rx="5" fill="#7e22ce"/>
        ${[16, 36, 56, 76, 96].map((y, i) => `<rect x="55" y="${y}" width="10" height="7" fill="${['#f97316', '#facc15', '#ec4899', '#f97316', '#facc15'][i]}"/>`).join('')}
        <circle cx="60" cy="6" r="5" fill="#f59e0b"/><circle cx="60" cy="114" r="5" fill="#f59e0b"/>
      </g>
    </g>
  </svg>`;

  // Garba deepak — the perforated pot danced around.
  const GARBO = `<svg width="96" height="120" viewBox="0 0 96 120" aria-hidden="true">
    <path class="fest-flame" d="M48 4 C55 15 55 22 48 28 C41 22 41 15 48 4Z" fill="#fbbf24"/>
    <path d="M48 12 C51 17 51 21 48 25 C45 21 45 17 48 12Z" fill="#fff7d6"/>
    <rect x="38" y="28" width="20" height="8" rx="2" fill="#b45309"/>
    <path d="M30 36 H66 C86 48 90 72 80 92 C72 108 24 108 16 92 C6 72 10 48 30 36Z" fill="#ea580c"/>
    <path d="M16 70 H80" stroke="#facc15" stroke-width="4"/>
    ${[[30, 52], [48, 50], [66, 52], [24, 84], [40, 86], [56, 86], [72, 84], [32, 98], [48, 99], [64, 98]]
      .map(([x, y]) => `<circle class="fest-hole" cx="${x}" cy="${y}" r="3.2" fill="#fde68a"/>`).join('')}
  </svg>`;

  const BOW = `<svg width="52" height="52" viewBox="0 0 46 46" aria-hidden="true">
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
    return `<svg class="fest-ravan-svg" width="150" height="190" viewBox="0 0 120 190" aria-hidden="true">
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
      .fest-toran { height: 34px; margin: -6px -4px 10px; background-repeat: repeat-x; background-size: 48px 34px;
        animation: festSwing 4s ease-in-out infinite; transform-origin: top center; }
      @keyframes festSwing { 0%,100% { transform: skewX(0) } 50% { transform: skewX(1.2deg) } }

      .fest-banner { position: relative; overflow: hidden; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
        padding: 14px 18px; border-radius: 16px; margin-bottom: 18px; color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.12); }
      .fest-banner > svg:not(.fest-mandala) { flex-shrink: 0; position: relative; z-index: 1; }
      .fest-banner.navratri { background: linear-gradient(115deg, #be123c 0%, #db2777 38%, #f97316 78%, #f59e0b 100%); }
      .fest-banner.dussehra { background: linear-gradient(115deg, #7c2d12 0%, #b91c1c 40%, #ea580c 80%, #f59e0b 100%); }
      .fest-banner::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .18;
        background-image: radial-gradient(circle at 10px 10px, #fff 1.6px, transparent 2px); background-size: 22px 22px; }
      .fest-banner .fest-mandala { position: absolute; right: -40px; top: 50%; width: 190px; height: 190px; transform: translateY(-50%);
        opacity: .16; animation: festSpin 40s linear infinite; pointer-events: none; }
      @keyframes festSpin { to { transform: translateY(-50%) rotate(360deg) } }
      .fest-title { font-size: 22px; font-weight: 800; letter-spacing: .3px; line-height: 1.2; text-shadow: 0 2px 6px rgba(0,0,0,.2); }
      .fest-sub { font-size: 13px; opacity: .95; margin-top: 3px; }
      .fest-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 4px; border-radius: 999px;
        background: rgba(255,255,255,.2); font-size: 12px; font-weight: 600; margin-top: 7px; }
      .fest-chip i { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; display: inline-block; }
      .fest-days { display: flex; gap: 4px; margin-top: 8px; }
      .fest-days span { width: 18px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.3); }
      .fest-days span.on { background: #fff; }
      .fest-ctrl { margin-left: auto; position: relative; z-index: 1; display: inline-flex; background: rgba(0,0,0,.18);
        border-radius: 999px; padding: 3px; gap: 2px; align-self: flex-start; }
      .fest-ctrl button { border: 0; background: transparent; color: #fff; font-size: 11.5px; font-weight: 600; padding: 4px 11px;
        border-radius: 999px; cursor: pointer; }
      .fest-ctrl button.on { background: #fff; color: #be123c; }
      .fest-banner.dussehra .fest-ctrl button.on { color: #b91c1c; }
      .fest-off { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted, #64748b);
        background: none; border: 1px dashed currentColor; border-radius: 999px; padding: 3px 12px; cursor: pointer; margin-bottom: 14px; }

      .fest-diya .fest-flame, .fest-corner .fest-flame { transform-origin: 50% 100%; animation: festFlicker .5s ease-in-out infinite alternate; }
      @keyframes festFlicker { from { transform: scale(1, 1) } to { transform: scale(.88, 1.12) } }
      .fest-hole { animation: festGlow 1.4s ease-in-out infinite alternate; }
      .fest-hole:nth-child(3n) { animation-delay: .5s } .fest-hole:nth-child(3n+1) { animation-delay: .9s }
      @keyframes festGlow { from { opacity: .45 } to { opacity: 1 } }
      .fest-sway { transform-origin: 60px 60px; animation: festSway 1.6s ease-in-out infinite alternate; }
      @keyframes festSway { from { transform: rotate(-6deg) } to { transform: rotate(6deg) } }

      .fest-corner { position: fixed; bottom: 12px; z-index: 30; pointer-events: none; filter: drop-shadow(0 6px 10px rgba(0,0,0,.18)); }
      .fest-corner.left { left: calc(var(--sidebar-w, 72px) + 12px); }
      .fest-corner.right { right: 18px; }
      .fest-corner.clickable { pointer-events: auto; cursor: pointer; }
      .fest-tag { position: absolute; left: 50%; transform: translateX(-50%); top: -26px; white-space: nowrap; font-size: 11.5px;
        font-weight: 700; color: #fff; background: #b91c1c; padding: 3px 10px; border-radius: 999px; box-shadow: 0 3px 8px rgba(0,0,0,.2); }

      .fest-fire { opacity: 0; transition: opacity .4s; }
      .fest-fire path { transform-box: fill-box; transform-origin: 50% 100%; animation: festFlicker .35s ease-in-out infinite alternate; }
      .fest-ravan.burning .fest-fire { opacity: .95; }
      .fest-ravan.burning .fest-ravan-svg { animation: festShake .2s linear infinite; }
      .fest-ravan.burnt { opacity: 0; transform: translateY(30px) scale(.9); transition: opacity 1s, transform 1s; }
      @keyframes festShake { 0%,100% { transform: translateX(0) } 50% { transform: translateX(1.5px) } }
      .fest-arrow { position: fixed; z-index: 31; pointer-events: none; font-size: 0; width: 60px; height: 4px; background: #78350f; }
      .fest-arrow::after { content: ''; position: absolute; right: -10px; top: -5px; border-left: 12px solid #b91c1c;
        border-top: 7px solid transparent; border-bottom: 7px solid transparent; }
      .fest-victory { position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%) scale(.6); z-index: 40; pointer-events: none;
        font-size: 34px; font-weight: 900; color: #fff; background: linear-gradient(115deg, #b91c1c, #f59e0b); padding: 14px 30px;
        border-radius: 18px; box-shadow: 0 16px 40px rgba(0,0,0,.3); opacity: 0; transition: opacity .35s, transform .35s; text-align: center; }
      .fest-victory small { display: block; font-size: 14px; font-weight: 600; opacity: .95; }
      .fest-victory.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }

      .fest-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 25; }

      @media (max-width: 767px) {
        .fest-corner, .fest-banner .fest-mandala { display: none; }
        .fest-title { font-size: 18px; }
        .fest-ctrl { margin-left: 0; }
        .fest-toran { margin-top: -2px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .fest-toran, .fest-banner .fest-mandala, .fest-sway, .fest-flame, .fest-hole { animation: none !important; }
      }`;
    document.head.appendChild(s);
  }

  const MANDALA = `<svg class="fest-mandala" viewBox="0 0 100 100" aria-hidden="true">
    ${Array.from({ length: 12 }, (_, i) => `<ellipse cx="50" cy="22" rx="7" ry="20" fill="none" stroke="#fff" stroke-width="1.6" transform="rotate(${i * 30} 50 50)"/>`).join('')}
    <circle cx="50" cy="50" r="12" fill="none" stroke="#fff" stroke-width="2"/><circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 4"/>
  </svg>`;

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
    const N = W < 768 ? 12 : 26;
    const ps = Array.from({ length: N }, () => spawn(true));
    function spawn(initial) {
      const up = kind === 'dussehra';
      return {
        x: Math.random() * W,
        y: initial ? Math.random() * H : (up ? H + 10 : -10),
        r: up ? 1.2 + Math.random() * 2 : 3 + Math.random() * 3.5,
        vy: up ? -(0.4 + Math.random() * 0.9) : 0.35 + Math.random() * 0.7,
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
          if (p.y > H + 20 || p.y < -20 || p.x < -20 || p.x > W + 20) { ps[i] = spawn(false); continue; }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col;
          if (kind === 'navratri') {
            ctx.globalAlpha = 0.75;
            ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.globalAlpha = Math.max(0, Math.min(1, p.y / H)) * 0.9;
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
      let sub, chip = '';
      if (f.day === 0) {
        sub = `Navratri begins tomorrow — Ghatasthapana, ${new Date(f.row.start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`;
      } else {
        const col = navratriColour(f.row.start, f.day - 1);
        sub = `Day ${f.day} of 9 · Maa ${GODDESS[f.day - 1]}${f.day === 8 ? ' · Durga Ashtami' : f.day === 9 ? ' · Maha Navami' : ''}`;
        chip = `<div class="fest-chip"><i style="background:${HEX[col]}"></i>Today's colour: ${col}</div>
          <div class="fest-days" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<span class="${i < f.day ? 'on' : ''}"></span>`).join('')}</div>`;
      }
      return `<div class="fest-banner navratri">
        ${MANDALA}${DIYA}
        <div style="position:relative;z-index:1;">
          <div class="fest-title">शुभ नवरात्रि · Happy Navratri</div>
          <div class="fest-sub">${sub}</div>${chip}
        </div>${ctrl}
      </div>`;
    }

    return `<div class="fest-banner dussehra">
      ${MANDALA}${BOW}
      <div style="position:relative;z-index:1;">
        <div class="fest-title">शुभ विजयादशमी · Happy Dussehra</div>
        <div class="fest-sub">असत्य पर सत्य की विजय — may good always win over evil.${m === 'full' && !f.after ? ' Click Ravan to light him up!' : ''}</div>
      </div>${ctrl}
    </div>`;
  }

  /* ── Ravan dahan ─────────────────────────────────────────────────── */
  function wireRavan(host) {
    const rav = host.querySelector('.fest-ravan');
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
    const fx = add(f.kind === 'navratri'
      ? `<div class="fest-corner left">${GARBO}</div><div class="fest-corner right">${DANDIYA}</div>`
      : (f.after ? '' : `<div class="fest-corner right clickable fest-ravan" title="Ravan Dahan — click to shoot the arrow"><span class="fest-tag">🏹 Ravan Dahan</span>${RAVAN()}</div>`));
    startParticles(fx, f.kind);
    wireRavan(fx);
  }

  return { mount, current };
})();
