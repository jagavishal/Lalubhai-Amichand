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
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch {} applyTheme(); }

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

  /* ── Navratri scene (bottom of the dashboard) ────────────────────── */
  // Drawn in SVG so it needs no image files. It sits in the page flow at the
  // end of the dashboard — never fixed over the content.
  const SKIN = '#f3c08d', SKIN_D = '#d99a62', GOLD = '#f5b301', GOLD_D = '#b7791f';

  // The nine forms, one per day — what each one holds, wears and rides, so
  // the picture changes with the day the way the puja does.
  const NAVADURGA = [
    { saree: '#e11d48', items: ['trishul', 'lotus'], moon: true, vahana: 'bull' },                        // Shailputri
    { saree: '#f8fafc', items: ['mala', 'kamandal'], ascetic: true, vahana: 'none' },                   // Brahmacharini
    { saree: '#f59e0b', items: ['trishul', 'sword', 'mace', 'bow', 'lotus', 'bell', 'chakra', 'conch', 'arrow', 'kamandal'], moon: true, vahana: 'tiger' }, // Chandraghanta
    { saree: '#f97316', items: ['kamandal', 'bow', 'arrow', 'lotus', 'kalash', 'chakra', 'mace', 'mala'], vahana: 'lion' },     // Kushmanda
    { saree: '#eab308', items: ['lotus', 'bless', 'lotus', 'abhaya'], baby: true, vahana: 'lion' },       // Skandamata
    { saree: '#dc2626', items: ['sword', 'bless', 'lotus', 'abhaya'], vahana: 'lion' },                  // Katyayani
    { saree: '#7f1d1d', items: ['sword', 'bless', 'hook', 'abhaya'], skin: '#4a3f4f', skinD: '#3a3140', wild: true, vahana: 'donkey' }, // Kalaratri
    { saree: '#f8fafc', items: ['trishul', 'bless', 'damaru', 'abhaya'], skin: '#fde3cc', skinD: '#ebc7a5', vahana: 'bull' }, // Mahagauri
    { saree: '#be123c', items: ['chakra', 'conch', 'mace', 'lotus'], vahana: 'lotus' },                 // Siddhidatri
  ];
  const ARM_POS = { 1: [[40, 112]], 2: [[34, 72], [40, 150]], 4: [[34, 62], [22, 100], [26, 140], [44, 172]],
                    5: [[38, 52], [24, 82], [18, 114], [26, 146], [46, 176]] };

  function ITEM(item, x, y) {
    return {
      trishul: `<path d="M${x} ${y + 30} V${y - 26} M${x - 9} ${y - 18} Q${x - 9} ${y - 6} ${x} ${y - 8} Q${x + 9} ${y - 6} ${x + 9} ${y - 18} M${x} ${y - 26} l-3 6 h6z" stroke="${GOLD_D}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
      chakra:  `<circle cx="${x}" cy="${y - 14}" r="10" fill="#fde68a" stroke="${GOLD_D}" stroke-width="2"/>${[0, 45, 90, 135].map(a => `<path d="M${x - 10} ${y - 14} H${x + 10}" stroke="${GOLD_D}" stroke-width="1.4" transform="rotate(${a} ${x} ${y - 14})"/>`).join('')}`,
      conch:   `<path d="M${x - 8} ${y - 6} Q${x - 4} ${y - 26} ${x + 9} ${y - 18} Q${x + 4} ${y - 10} ${x + 8} ${y - 4} Q${x} ${y} ${x - 8} ${y - 6}Z" fill="#fff" stroke="#cbd5e1" stroke-width="1.4"/>`,
      lotus:   [-28, 0, 28].map(a => `<ellipse cx="${x}" cy="${y - 14}" rx="5" ry="11" fill="#f9a8d4" stroke="#db2777" stroke-width="1" transform="rotate(${a} ${x} ${y - 6})"/>`).join(''),
      sword:   `<path d="M${x} ${y + 6} L${x - 3} ${y - 34} L${x} ${y - 42} L${x + 3} ${y - 34}Z" fill="#e2e8f0" stroke="#94a3b8"/><path d="M${x - 7} ${y - 2} H${x + 7}" stroke="${GOLD_D}" stroke-width="3" stroke-linecap="round"/>`,
      bow:     `<path d="M${x - 2} ${y - 34} Q${x + 18} ${y - 6} ${x - 2} ${y + 22}" stroke="#92400e" stroke-width="3" fill="none"/><path d="M${x - 2} ${y - 34} V${y + 22}" stroke="#fcd34d" stroke-width="1"/>`,
      arrow:   `<path d="M${x} ${y + 14} V${y - 30}" stroke="#78350f" stroke-width="2.2"/><path d="M${x} ${y - 36} l-4 8 h8z" fill="#94a3b8"/><path d="M${x} ${y + 14} l-4 5 M${x} ${y + 14} l4 5" stroke="#dc2626" stroke-width="2"/>`,
      mace:    `<path d="M${x} ${y + 10} V${y - 18}" stroke="${GOLD_D}" stroke-width="3"/><circle cx="${x}" cy="${y - 24}" r="8" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1.5"/>`,
      bell:    `<path d="M${x - 8} ${y - 6} Q${x - 8} ${y - 24} ${x} ${y - 24} Q${x + 8} ${y - 24} ${x + 8} ${y - 6}Z" fill="${GOLD}" stroke="${GOLD_D}"/><circle cx="${x}" cy="${y - 3}" r="2.4" fill="${GOLD_D}"/>`,
      mala:    Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return `<circle cx="${(x + Math.cos(a) * 9).toFixed(1)}" cy="${(y - 12 + Math.sin(a) * 11).toFixed(1)}" r="2.2" fill="#92400e"/>`; }).join(''),
      kamandal:`<path d="M${x - 9} ${y - 18} Q${x - 11} ${y - 2} ${x} ${y - 2} Q${x + 11} ${y - 2} ${x + 9} ${y - 18}Z" fill="${GOLD}" stroke="${GOLD_D}"/><path d="M${x + 8} ${y - 14} q8 -2 9 -10" stroke="${GOLD_D}" stroke-width="2" fill="none"/><path d="M${x - 9} ${y - 18} Q${x} ${y - 28} ${x + 9} ${y - 18}" stroke="${GOLD_D}" stroke-width="1.6" fill="none"/>`,
      kalash:  `<path d="M${x - 9} ${y - 16} Q${x - 12} ${y - 2} ${x} ${y - 2} Q${x + 12} ${y - 2} ${x + 9} ${y - 16}Z" fill="#c2410c" stroke="${GOLD}" stroke-width="1.5"/><circle cx="${x}" cy="${y - 22}" r="6" fill="#92400e"/><path d="M${x - 10} ${y - 18} q4 -6 8 -2 M${x + 10} ${y - 18} q-4 -6 -8 -2" stroke="#16a34a" stroke-width="2.4" fill="none"/>`,
      hook:    `<path d="M${x} ${y + 12} V${y - 26} q0 -8 -8 -6" stroke="#64748b" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M${x} ${y - 26} l4 -8" stroke="#64748b" stroke-width="2.8" stroke-linecap="round"/>`,
      damaru:  `<path d="M${x - 8} ${y - 26} H${x + 8} L${x - 8} ${y - 4} H${x + 8}Z" fill="#b45309" stroke="#78350f" stroke-width="1.4"/><path d="M${x + 8} ${y - 15} q6 2 6 8" stroke="#78350f" stroke-width="1.2" fill="none"/>`,
      bless:   `<path d="M${x - 5} ${y - 4} V${y - 16} M${x - 1} ${y - 5} V${y - 19} M${x + 3} ${y - 5} V${y - 18} M${x + 7} ${y - 3} V${y - 13}" stroke="${'$SKIN'}" stroke-width="3.4" stroke-linecap="round"/><circle cx="${x + 1}" cy="${y - 7}" r="2" fill="#dc2626"/>`,
      abhaya:  `<path d="M${x - 5} ${y - 4} V${y - 16} M${x - 1} ${y - 5} V${y - 19} M${x + 3} ${y - 5} V${y - 18} M${x + 7} ${y - 3} V${y - 13}" stroke="${'$SKIN'}" stroke-width="3.4" stroke-linecap="round"/>`,
    }[item] || '';
  }

  const VAHANA = {
    lion: `<g transform="translate(22 206)"><circle r="22" fill="#b45309" stroke="#92400e" stroke-width="3" stroke-dasharray="4 3"/><circle r="14" fill="#f59e0b"/>
      <circle cx="-5" cy="-3" r="2" fill="#1f1410"/><circle cx="5" cy="-3" r="2" fill="#1f1410"/><path d="M-3 3 h6 l-3 3z" fill="#7c2d12"/><path d="M-5 8 q5 4 10 0" stroke="#7c2d12" stroke-width="1.4" fill="none"/></g>`,
    tiger: `<g transform="translate(22 208)"><circle cx="-13" cy="-14" r="6" fill="#f97316"/><circle cx="13" cy="-14" r="6" fill="#f97316"/><circle r="18" fill="#f97316"/>
      <path d="M-6 -17 l2 7 M0 -18 v7 M6 -17 l-2 7 M-17 -2 h7 M17 -2 h-7 M-16 5 h6 M16 5 h-6" stroke="#1f1410" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cy="7" rx="9" ry="7" fill="#fff"/><circle cx="-6" cy="-4" r="2" fill="#1f1410"/><circle cx="6" cy="-4" r="2" fill="#1f1410"/><path d="M-3 3 h6 l-3 3z" fill="#be185d"/></g>`,
    bull: `<g transform="translate(22 208)"><path d="M-12 -14 Q-24 -18 -22 -30 M12 -14 Q24 -18 22 -30" stroke="#d6d3d1" stroke-width="4" fill="none" stroke-linecap="round"/>
      <ellipse cx="-17" cy="-8" rx="7" ry="4" fill="#e7e5e4"/><ellipse cx="17" cy="-8" rx="7" ry="4" fill="#e7e5e4"/><ellipse rx="14" ry="19" fill="#fafaf9" stroke="#d6d3d1" stroke-width="1.5"/>
      <circle cx="-5" cy="-5" r="2" fill="#1f1410"/><circle cx="5" cy="-5" r="2" fill="#1f1410"/><ellipse cy="10" rx="10" ry="6" fill="#fbcfe8"/><circle cy="-13" r="3" fill="#dc2626"/></g>`,
    donkey: `<g transform="translate(22 208)"><ellipse cx="-8" cy="-24" rx="4" ry="12" fill="#9ca3af" transform="rotate(-14 -8 -24)"/><ellipse cx="8" cy="-24" rx="4" ry="12" fill="#9ca3af" transform="rotate(14 8 -24)"/>
      <ellipse rx="13" ry="19" fill="#9ca3af"/><ellipse cy="10" rx="9" ry="7" fill="#e5e7eb"/><circle cx="-5" cy="-5" r="2" fill="#1f1410"/><circle cx="5" cy="-5" r="2" fill="#1f1410"/></g>`,
    lotus: `<g>${[-50, -30, -10, 10, 30, 50].map(dx => `<ellipse cx="${110 + dx}" cy="224" rx="12" ry="7" fill="#f9a8d4" stroke="#db2777" stroke-width="1"/>`).join('')}</g>`,
    none: '',
  };

  // day: 0..8. portrait = head-and-shoulders crop for the banner / login orb.
  function DURGA(day, portrait) {
    const g = NAVADURGA[Math.max(0, Math.min(8, day))];
    const skin = g.skin || SKIN, skinD = g.skinD || SKIN_D;
    const white = g.saree === '#f8fafc';
    const border = white ? '#f59e0b' : GOLD;
    const rays = Array.from({ length: 24 }, (_, i) =>
      `<path d="M110 92 L106 6 L114 6Z" fill="${i % 2 ? '#fde68a' : '#fdba74'}" transform="rotate(${i * 15} 110 92)"/>`).join('');
    const half = Math.ceil(g.items.length / 2);
    const left = ARM_POS[half] || ARM_POS[4];
    const arms = g.items.map((item, i) => {
      const side = i < half ? 0 : 1, k = side ? i - half : i;
      const pos = (side ? ARM_POS[g.items.length - half] : left) || left;
      let [x, y] = pos[k];
      if (side) x = 220 - x;
      const sx = side ? 128 : 92, sy = 146;
      return `<path d="M${sx} ${sy} Q${(sx + x) / 2} ${(sy + y) / 2 + 12} ${x} ${y}" stroke="${skin}" stroke-width="9" fill="none" stroke-linecap="round"/>
        <path d="M${x - 5} ${y + 7} q5 4 10 0" stroke="${GOLD}" stroke-width="3" fill="none"/>
        <circle cx="${x}" cy="${y}" r="6" fill="${skin}"/>${ITEM(item, x, y).replace(/\$SKIN/g, skin)}`;
    }).join('');
    const hair = g.wild
      ? `<path d="M70 70 L60 60 L74 58 L70 40 L86 50 L92 30 L102 46 L110 26 L118 46 L128 30 L134 50 L150 40 L146 58 L160 60 L150 70 Q156 120 152 152 L68 152 Q64 120 70 70Z" fill="#111"/>`
      : `<path d="M78 66 Q72 120 70 150 L150 150 Q148 120 142 66Z" fill="#1f1410"/>`;
    const crown = g.ascetic
      ? `<ellipse cx="110" cy="58" rx="14" ry="11" fill="#1f1410"/><path d="M98 60 Q110 52 122 60" stroke="#92400e" stroke-width="2.4" stroke-dasharray="1 3" stroke-linecap="round" fill="none"/>`
      : `<path d="M82 74 L85 40 L96 56 L110 22 L124 56 L135 40 L138 74 Q110 64 82 74Z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1.5"/>
         <circle cx="110" cy="46" r="5" fill="#dc2626" stroke="#fff" stroke-width="1.2"/><circle cx="96" cy="62" r="3" fill="#16a34a"/><circle cx="124" cy="62" r="3" fill="#16a34a"/>
         <path d="M82 74 Q110 64 138 74" stroke="#dc2626" stroke-width="2.4" fill="none"/>`;
    const moon = g.moon ? `<path d="M100 ${g.ascetic ? 44 : 16} q10 10 20 0 q-10 5 -20 0Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>` : '';
    const baby = g.baby ? `<g><path d="M96 230 Q96 196 110 194 Q124 196 124 230Z" fill="#f59e0b"/><circle cx="110" cy="186" r="10" fill="${SKIN}"/>
      <path d="M102 180 L104 170 L110 176 L116 170 L118 180Z" fill="${GOLD}"/><circle cx="106" cy="186" r="1.3" fill="#1f1410"/><circle cx="114" cy="186" r="1.3" fill="#1f1410"/>
      <path d="M107 190 q3 2 6 0" stroke="#be123c" stroke-width="1.2" fill="none"/></g>` : '';
    const eyeFill = g.wild ? '#fff' : '#fff';
    const vb = portrait ? '68 30 84 84' : '0 0 220 230';
    return `<svg class="${portrait ? 'fx-portrait' : 'fx-durga'}" width="${portrait ? 54 : 220}" height="${portrait ? 54 : 230}" viewBox="${vb}" aria-label="Maa ${GODDESS[day]}">
      <defs><radialGradient id="fxHalo${day}${portrait ? 'p' : ''}"><stop offset="0" stop-color="#fff7d6"/><stop offset=".6" stop-color="#fde68a"/><stop offset="1" stop-color="#fb923c"/></radialGradient></defs>
      ${portrait ? '' : `<g class="fx-rays">${rays}</g>`}
      <circle cx="110" cy="92" r="58" fill="url(#fxHalo${day}${portrait ? 'p' : ''})"/>
      <circle cx="110" cy="92" r="58" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="2 5"/>
      ${portrait ? '' : arms}
      ${hair}
      <path d="M68 150 Q110 132 152 150 L170 230 H50Z" fill="${g.saree}" ${white ? 'stroke="#e5e7eb"' : ''}/>
      <path d="M68 150 Q110 132 152 150 L150 158 Q110 142 70 158Z" fill="${border}"/>
      <path d="M58 214 H162 L166 230 H54Z" fill="${border}"/>
      ${[66, 82, 98, 114, 130, 146].map(x => `<circle cx="${x + 6}" cy="222" r="2.2" fill="${white ? '#dc2626' : '#b91c1c'}"/>`).join('')}
      <path d="M120 146 L156 230 H140 L110 150Z" fill="${white ? '#f59e0b' : '#000'}" opacity="${white ? '.35' : '.18'}"/>
      <path d="M124 146 L160 228" stroke="${border}" stroke-width="4"/>
      <rect x="102" y="118" width="16" height="20" fill="${skinD}"/>
      ${g.ascetic
        ? `<path d="M92 140 Q110 166 128 140" stroke="#92400e" stroke-width="3" fill="none" stroke-dasharray="1 4" stroke-linecap="round"/>`
        : `<path d="M90 140 Q110 162 130 140" stroke="${GOLD}" stroke-width="4" fill="none"/>
           <path d="M94 142 Q110 172 126 142" stroke="#f97316" stroke-width="5" fill="none" stroke-dasharray="1 6" stroke-linecap="round"/>
           <circle cx="110" cy="160" r="5" fill="#dc2626" stroke="${GOLD}" stroke-width="2"/>`}
      <ellipse cx="110" cy="98" rx="24" ry="28" fill="${skin}"/>
      <path d="M86 92 Q88 66 110 64 Q132 66 134 92 Q126 76 110 76 Q94 76 86 92Z" fill="${g.wild ? '#111' : '#1f1410'}"/>
      ${crown}${moon}
      <ellipse cx="110" cy="84" rx="2" ry="4.5" fill="#dc2626"/>
      <path d="M94 88 Q100 84 106 88 M114 88 Q120 84 126 88" stroke="#1f1410" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M93 96 Q100 90 107 96 Q100 100 93 96Z M113 96 Q120 90 127 96 Q120 100 113 96Z" fill="${eyeFill}" stroke="#1f1410" stroke-width="1.8"/>
      <circle cx="100" cy="95.5" r="2.6" fill="#1f1410"/><circle cx="120" cy="95.5" r="2.6" fill="#1f1410"/>
      <path d="M92 95 l-3 -2 M128 95 l3 -2" stroke="#1f1410" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M110 99 L108 108 Q110 110 112 108" stroke="${skinD}" stroke-width="1.6" fill="none"/>
      ${g.ascetic ? '' : `<circle cx="105" cy="109" r="3.6" fill="none" stroke="${GOLD}" stroke-width="1.6"/>`}
      <path d="M103 115 Q110 120 117 115 Q110 117 103 115Z" fill="#be123c" stroke="#be123c" stroke-width="1.6" stroke-linejoin="round"/>
      ${g.ascetic
        ? `<circle cx="86" cy="106" r="2.6" fill="#92400e"/><circle cx="134" cy="106" r="2.6" fill="#92400e"/>`
        : `<circle cx="86" cy="106" r="3.4" fill="${GOLD}"/><path d="M86 109 l-3 8 h6z" fill="${GOLD}"/>
           <circle cx="134" cy="106" r="3.4" fill="${GOLD}"/><path d="M134 109 l-3 8 h6z" fill="${GOLD}"/>`}
      ${portrait ? '' : baby + VAHANA[g.vahana]}
    </svg>`;
  }

  // One dancer. girl: chaniya choli; boy: kediyu + pagdi. Arms swing on
  // alternating beats so the pair's sticks meet in the middle.
  function DANCER(girl, c1, c2, beat) {
    const head = girl
      ? `<circle cx="40" cy="40" r="12" fill="${SKIN}"/><path d="M28 40 Q28 25 40 25 Q52 25 52 40 Q48 31 40 31 Q32 31 28 40Z" fill="#1f1410"/>
         <circle cx="52" cy="30" r="6" fill="#1f1410"/><circle cx="40" cy="34" r="1.4" fill="#dc2626"/>
         <circle cx="36" cy="40" r="1.3" fill="#1f1410"/><circle cx="44" cy="40" r="1.3" fill="#1f1410"/>
         <path d="M36 45 q4 3 8 0" stroke="#be123c" stroke-width="1.4" fill="none"/><circle cx="29" cy="45" r="1.8" fill="${GOLD}"/>`
      : `<circle cx="40" cy="40" r="12" fill="${SKIN}"/><path d="M27 36 Q28 22 40 22 Q53 22 53 36 Q40 30 27 36Z" fill="${c2}"/>
         <path d="M52 30 Q62 36 58 50" stroke="${c2}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="40" cy="27" r="2" fill="${GOLD}"/>
         <circle cx="36" cy="40" r="1.3" fill="#1f1410"/><circle cx="44" cy="40" r="1.3" fill="#1f1410"/>
         <path d="M34 44 q3 2 6 0 q3 2 6 0" stroke="#1f1410" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M37 47 q3 2.5 6 0" stroke="#be123c" stroke-width="1.3" fill="none"/>`;
    const body = girl
      ? `<path d="M30 54 H50 L52 78 H28Z" fill="${c2}"/><path d="M30 54 L52 78" stroke="${GOLD}" stroke-width="3"/>
         <path class="fx-skirt" d="M27 76 H53 L72 150 Q40 160 8 150Z" fill="${c1}"/>
         <path d="M14 136 Q40 144 66 136 L70 148 Q40 158 10 148Z" fill="${GOLD}"/>
         ${[[24, 100], [40, 96], [56, 100], [20, 120], [34, 118], [48, 118], [62, 120]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#fff" opacity=".85"/>`).join('')}
         <path d="M30 152 v8 M50 152 v8" stroke="${SKIN_D}" stroke-width="4" stroke-linecap="round"/>`
      : `<path class="fx-skirt" d="M29 54 H51 L64 106 H16Z" fill="${c1}"/>
         <path d="M18 98 H62 L64 106 H16Z" fill="${GOLD}"/><path d="M40 56 V96" stroke="${GOLD}" stroke-width="2" stroke-dasharray="3 3"/>
         <path d="M30 106 L28 152 H37 L40 110 L43 152 H52 L50 106Z" fill="#f8fafc" stroke="#e2e8f0"/>
         <path d="M26 154 h12 M42 154 h12" stroke="#92400e" stroke-width="4" stroke-linecap="round"/>`;
    const stick = (x, y, col) => `<path d="M${x} ${y} l14 -20" stroke="${col}" stroke-width="4" stroke-linecap="round"/>
      <path d="M${x + 4} ${y - 6} l3 -4 M${x + 9} ${y - 13} l3 -4" stroke="${GOLD}" stroke-width="4"/>`;
    return `<svg class="fx-dancer" width="100" height="205" viewBox="0 0 80 164" aria-hidden="true">
      <g class="fx-bounce" style="animation-delay:${beat}s">
        <g class="fx-arm-l" style="animation-delay:${beat}s"><path d="M31 58 Q18 50 16 34" stroke="${SKIN}" stroke-width="5" fill="none" stroke-linecap="round"/>${stick(14, 36, girl ? '#7e22ce' : '#be123c')}</g>
        <g class="fx-arm-r" style="animation-delay:${beat}s"><path d="M49 58 Q62 50 64 34" stroke="${SKIN}" stroke-width="5" fill="none" stroke-linecap="round"/><g transform="translate(128 0) scale(-1 1)">${stick(64, 36, girl ? '#16a34a' : '#f59e0b')}</g></g>
        ${body}${head}
      </g>
    </svg>`;
  }

  // Fixed to the screen's bottom corners on desktop. They fade almost out
  // whenever the mouse comes near, so nothing under them is ever out of
  // reach (clicks pass through — pointer-events: none).
  function mountCorners(wrap, day) {
    document.querySelectorAll('.fx-corner').forEach(n => n.remove());
    const left = document.createElement('div');
    left.className = 'fx-corner left';
    left.innerHTML = `<div class="fx-pill">🪔 शुभ नवरात्रि</div>
      <div class="fx-couple">${DANCER(true, '#16a34a', '#db2777', 0)}${DANCER(false, '#111827', '#dc2626', 0.4)}</div>`;
    const right = document.createElement('div');
    right.className = 'fx-corner right';
    right.innerHTML = DURGA(day);
    document.body.append(left, right);
    wrap.classList.add('fx-pad');

    let raf = 0, mx = -1e4, my = -1e4;
    const near = () => {
      raf = 0;
      for (const el of [left, right]) {
        const b = el.getBoundingClientRect();
        el.classList.toggle('peek', mx > b.left - 30 && mx < b.right + 30 && my > b.top - 30 && my < b.bottom + 30);
      }
    };
    const onMove = e => { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(near); };
    document.addEventListener('mousemove', onMove, { passive: true });
    // Body-level, so take them down ourselves once the dashboard is gone.
    const watch = setInterval(() => {
      if (wrap.isConnected && left.isConnected) return;
      clearInterval(watch);
      document.removeEventListener('mousemove', onMove);
      left.remove(); right.remove();
    }, 700);
  }

  function sceneHTML(day) {
    const pair = (a, b, flip) => `<div class="fx-pair${flip ? ' flip' : ''}">${DANCER(true, a, b, 0)}${DANCER(false, b, a, 0.4)}</div>`;
    return `<div class="fx-scene" aria-label="Navratri — Maa Durga and garba">
      ${pair('#db2777', '#f59e0b')}
      <div class="fx-center">${DURGA(day)}<div class="fx-jai">जय माँ ${GODDESS_HI[day]}</div></div>
      ${pair('#7e22ce', '#16a34a', true)}
    </div>`;
  }

  const SCENE_CSS = `
      .fx-scene { position: relative; display: flex; align-items: flex-end; justify-content: center; gap: clamp(12px, 5vw, 80px);
        margin-top: 24px; padding: 18px 16px 0; border-radius: 16px; overflow: hidden;
        background: linear-gradient(180deg, transparent 0%, var(--color-primary-light, rgba(249,115,22,.1)) 100%);
        border-bottom: 6px solid var(--color-primary, #c2410c); }
      .fx-scene::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 10px; opacity: .5;
        background: radial-gradient(circle, var(--color-primary, #c2410c) 2px, transparent 2.5px) 0 0 / 14px 10px repeat-x; }
      .fx-pair { display: flex; align-items: flex-end; gap: 0; margin-bottom: 4px; }
      .fx-pair.flip { transform: scaleX(-1); }
      .fx-center { display: flex; flex-direction: column; align-items: center; }
      .fx-jai { font-size: 15px; font-weight: 700; color: var(--color-primary, #c2410c); margin: 2px 0 10px; letter-spacing: .5px; }
      .fx-rays { transform-origin: 110px 92px; animation: fxSpin 30s linear infinite; }
      @keyframes fxSpin { to { transform: rotate(360deg) } }
      .fx-durga { filter: drop-shadow(0 6px 14px rgba(0,0,0,.12)); }
      .fx-bounce { transform-origin: 40px 150px; animation: fxBounce .9s ease-in-out infinite alternate; }
      @keyframes fxBounce { from { transform: translateY(0) rotate(-3deg) } to { transform: translateY(-5px) rotate(3deg) } }
      .fx-arm-l { transform-origin: 31px 58px; animation: fxArmL .9s ease-in-out infinite alternate; }
      .fx-arm-r { transform-origin: 49px 58px; animation: fxArmR .9s ease-in-out infinite alternate; }
      @keyframes fxArmL { from { transform: rotate(-14deg) } to { transform: rotate(18deg) } }
      @keyframes fxArmR { from { transform: rotate(14deg) } to { transform: rotate(-18deg) } }
      .fx-skirt { transform-origin: 40px 60px; animation: fxSkirt .9s ease-in-out infinite alternate; }
      @keyframes fxSkirt { from { transform: skewX(-4deg) } to { transform: skewX(4deg) } }
      .fx-corner { position: fixed; bottom: 0; z-index: 30; pointer-events: none; transition: opacity .25s;
        filter: drop-shadow(0 8px 14px rgba(0,0,0,.18)); }
      .fx-corner.left { left: calc(var(--sidebar-w, 52px) + 18px); display: flex; flex-direction: column; align-items: center; }
      .fx-corner.right { right: 18px; }
      .fx-corner.right .fx-durga { width: 190px; height: 199px; display: block; }
      .fx-corner.peek { opacity: .1; }
      .fx-couple { display: flex; align-items: flex-end; margin-left: -10px; }
      .fx-couple .fx-dancer { width: 92px; height: 189px; margin: 0 -8px; }
      .fx-pill { font-size: 17px; font-weight: 800; color: #fff; padding: 6px 16px; border-radius: 999px; margin-bottom: 2px;
        background: linear-gradient(90deg, #dc2626, #db2777); border: 3px solid #fbbf24; box-shadow: 0 4px 12px rgba(220,38,38,.35);
        animation: fxPill 2.4s ease-in-out infinite; }
      @keyframes fxPill { 50% { transform: translateY(-3px) } }
      @media (min-width: 768px) { .fx-scene { display: none; } .fx-pad { padding-bottom: 210px; } }
      @media (max-width: 767px) {
        .fx-corner { display: none; }
        .fx-pair.flip { display: none; }
        .fx-durga { width: 160px; height: 168px; }
        .fx-dancer { width: 64px; height: 131px; }
      }
      @media (prefers-reduced-motion: reduce) { .fx-rays, .fx-bounce, .fx-arm-l, .fx-arm-r, .fx-skirt { animation: none; } }`;

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
      .fest-banner { --fa: var(--fest-p, #be123c); --fa-soft: #fff1f2; --fa-edge: linear-gradient(90deg, #be123c, #f97316, #f59e0b);
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
        background: var(--fa-soft); display: grid; place-items: center; overflow: hidden; }
      .fest-icon .fx-portrait { width: 54px; height: 54px; }
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

      .fest-tb { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center;
        gap: 9px; white-space: nowrap; pointer-events: none; padding: 5px 16px; border-radius: 999px;
        background: var(--color-primary-light, rgba(190,18,60,.08)); }
      .fest-tb i { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface, #fff), 0 0 0 3px var(--color-primary); }
      .fest-tb b { font-size: 16px; font-weight: 700; color: var(--color-primary); }
      .fest-tb span { font-size: 12.5px; font-weight: 500; color: var(--text-secondary, #475569); }
      @media (max-width: 1100px) { .fest-tb span { display: none; } }
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
    s.textContent += SCENE_CSS;
    document.head.appendChild(s);
  }

  /* ── particles ───────────────────────────────────────────────────── */
  // Navratri: petals drifting down. Dussehra: embers rising.
  // panel = true: canvas fills `host` (position:relative) and particles use
  // its whole height; otherwise a fixed full-window canvas, top band only.
  function startParticles(host, kind, panel) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas');
    c.className = 'fest-canvas';
    if (panel) Object.assign(c.style, { position: 'absolute', width: '100%', height: '100%', zIndex: 0 });
    host.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W, H;
    function size() {
      W = panel ? host.clientWidth : innerWidth; H = panel ? host.clientHeight : innerHeight;
      c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    addEventListener('resize', size);

    const COLS = kind === 'navratri' ? ['#f97316', '#fbbf24', '#e11d48', '#ec4899', '#facc15'] : ['#fbbf24', '#f97316', '#ef4444', '#fde047'];
    const N = panel ? 22 : W < 768 ? 6 : 14;
    const BAND = panel ? H : 300; // px from the top — on the dashboard petals/embers never drift over the tables
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
      let title, sub, meta = '';
      if (f.day === 0) {
        title = '<b>Navratri begins tomorrow</b>';
        sub = `Ghatasthapana, ${new Date(f.row.start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })} · Maa ${GODDESS[0]}`;
      } else {
        const col = navratriColour(f.row.start, f.day - 1);
        title = `<b>माँ ${GODDESS_HI[f.day - 1]}</b>${f.day === 8 ? '<span>·</span>Durga Ashtami' : f.day === 9 ? '<span>·</span>Maha Navami' : ''}`;
        sub = `Maa ${GODDESS[f.day - 1]} · ${GODDESS_GIFT[f.day - 1]}`;
        // One dot per day in that day's colour — the row doubles as the progress bar.
        const dots = Array.from({ length: 9 }, (_, i) => {
          const c = navratriColour(f.row.start, i);
          return `<i title="${c}" class="${i + 1 < f.day ? 'past' : i + 1 === f.day ? 'today' : ''}" style="background:${HEX[c]}"></i>`;
        }).join('');
        meta = `<div class="fest-meta"><div class="fest-days">${dots}</div><span>Today's colour · <b style="color:var(--text-primary)">${col}</b></span></div>`;
      }
      return `<div class="fest-banner navratri">
        <div class="fest-icon">${DURGA(Math.max(0, f.day - 1), true)}</div>
        <div class="fest-body">
          <div class="fest-title">${title}</div>
          <div class="fest-sub">${sub}</div>${meta}
        </div>
        <div class="fest-right">${ctrl}</div>
      </div>`;
    }

    return `<div class="fest-banner dussehra">
      <div class="fest-icon">${BOW}</div>
      <div class="fest-body">
        <div class="fest-title"><b>असत्य पर सत्य की विजय</b></div>
        <div class="fest-sub">May good always win over evil — Happy Dussehra from Lalubhai Amichand.</div>
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
    document.querySelectorAll('.fx-corner').forEach(n => n.remove());
    wrap.classList.remove('fx-pad');
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
    if (f.kind === 'navratri') { add(sceneHTML(Math.max(0, f.day - 1))); mountCorners(wrap, Math.max(0, f.day - 1)); }
    const fx = add('');
    startParticles(fx, f.kind);
    wireRavan(top, fx);
  }

  /* ── app-wide colour of the day ──────────────────────────────────── */
  // Every page reads its colours from the tokens in style.css, so retinting
  // the app is just overriding those tokens. p = button/link colour (white
  // text must stay readable on it — hence gold for White/Yellow days), bg =
  // light page tint, side = dark sidebar, acc = sidebar highlight.
  const DAY_THEME = {
    'Orange':        { p: '#c2410c', d: '#9a3412', rgb: '194,65,12',  bg: '#fff6ef', side: '#2a1206', acc: '#fdba74' },
    'White':         { p: '#a16207', d: '#854d0e', rgb: '161,98,7',   bg: '#fbfaf6', side: '#1c1917', acc: '#fde68a' },
    'Red':           { p: '#dc2626', d: '#b91c1c', rgb: '220,38,38',  bg: '#fdf4f4', side: '#2b0a0a', acc: '#fca5a5' },
    'Royal Blue':    { p: '#1d4ed8', d: '#1e40af', rgb: '29,78,216',  bg: '#f2f6fe', side: '#0b1640', acc: '#93c5fd' },
    'Yellow':        { p: '#a16207', d: '#854d0e', rgb: '161,98,7',   bg: '#fefbe8', side: '#2a2005', acc: '#fde047' },
    'Green':         { p: '#15803d', d: '#166534', rgb: '21,128,61',  bg: '#f2fbf4', side: '#062413', acc: '#86efac' },
    'Grey':          { p: '#4b5563', d: '#374151', rgb: '75,85,99',   bg: '#f3f4f6', side: '#1f2328', acc: '#d1d5db' },
    'Peacock Green': { p: '#0f766e', d: '#115e59', rgb: '15,118,110', bg: '#eff9f8', side: '#04221f', acc: '#5eead4' },
    'Purple':        { p: '#7e22ce', d: '#6b21a8', rgb: '126,34,206', bg: '#f8f3fd', side: '#1e0a33', acc: '#d8b4fe' },
    'Dussehra':      { p: '#b91c1c', d: '#991b1b', rgb: '185,28,28',  bg: '#fff6ec', side: '#2a0d06', acc: '#fdba74' },
  };

  function dayTheme(f) {
    if (!f) return null;
    if (f.kind === 'dussehra') return { name: 'Dussehra', ...DAY_THEME.Dussehra };
    // The eve already wears Day 1's colour, so the build-up is visible.
    const name = navratriColour(f.row.start, Math.max(0, f.day - 1));
    return { name, ...DAY_THEME[name] };
  }

  // Centred greeting in the topbar, on every page. Topbar.render() calls
  // this after it paints; applyTheme() calls it when the switch changes.
  function decorateTopbar() {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    bar.querySelector('.fest-tb')?.remove();
    const f = current();
    if (!f || mode() === 'off') return;
    injectCSS();
    const nav = f.kind === 'navratri';
    const hex = nav ? HEX[navratriColour(f.row.start, Math.max(0, f.day - 1))] : '#f59e0b';
    const g = document.createElement('div');
    g.className = 'fest-tb';
    g.innerHTML = nav
      ? `<i style="background:${hex}"></i><b>शुभ नवरात्रि</b><span>${f.day ? `Maa ${GODDESS[f.day - 1]}` : 'kal se shuru'}</span>`
      : `<i style="background:${hex}"></i><b>शुभ विजयादशमी</b><span>Happy Dussehra</span>`;
    bar.appendChild(g);
  }

  function applyTheme() {
    decorateTopbar();
    const f = current();
    const t = mode() === 'off' ? null : dayTheme(f);
    let s = document.getElementById('fest-theme');
    if (!t) { s?.remove(); delete document.documentElement.dataset.fest; return; }
    if (!s) { s = document.createElement('style'); s.id = 'fest-theme'; document.head.appendChild(s); }
    document.documentElement.dataset.fest = f.kind;
    s.textContent = `
      html[data-fest] {
        --color-primary: ${t.p}; --color-primary-dark: ${t.d}; --color-primary-strong: ${t.p};
        --color-primary-light: rgba(${t.rgb},.10); --color-primary-ring: rgba(${t.rgb},.22);
        --shadow-glow: 0 10px 32px rgba(${t.rgb},.30);
        --sidebar-bg: ${t.side}; --sidebar-border: color-mix(in srgb, ${t.side}, #fff 10%);
        --sidebar-accent: ${t.acc}; --sidebar-active-bg: rgba(${t.rgb},.28);
        --fest-p: ${t.p}; --fest-rgb: ${t.rgb};
      }
      html[data-fest]:not([data-theme="dark"]) { --app-bg: ${t.bg}; }
      html[data-fest] #topbar-title { color: var(--color-primary) !important; }
      html[data-fest]:not([data-theme="dark"]) #topbar { background: color-mix(in srgb, #fff 90%, ${t.p}); }
      html[data-fest] .fest-banner.navratri { --fa-edge: linear-gradient(90deg, ${t.p}, color-mix(in srgb, ${t.p}, #fff 45%), ${t.p}); }
      html[data-fest][data-theme="dark"] { --color-primary: ${t.acc}; --color-primary-strong: ${t.acc}; --color-primary-text: #111; }`;
  }

  /* ── login page ──────────────────────────────────────────────────── */
  const GODDESS_HI = ['शैलपुत्री', 'ब्रह्मचारिणी', 'चंद्रघंटा', 'कूष्मांडा', 'स्कंदमाता', 'कात्यायनी', 'कालरात्रि', 'महागौरी', 'सिद्धिदात्री'];
  const GODDESS_GIFT = ['strength & stability', 'devotion & discipline', 'courage & peace', 'energy & creativity',
                        'care & compassion', 'determination', 'fearlessness', 'purity & calm', 'fulfilment & wisdom'];
  const QUIPS = {
    navratri: ['Garba raat ko, approvals abhi. &#x1F483;', 'Aaj ka rang pehna? Ab login bhi kar lijiye. &#x1F457;',
               'Maa ka aashirwad &mdash; aur zero overdue tasks. &#x1F64F;', 'Dandiya shaam ko, pending tasks pehle. &#x1F3B6;'],
    dussehra: ['Aaj pending tasks ka Ravan Dahan. &#x1F3F9;', 'Burai pe achchai ki jeet &mdash; overdue pe Done ki. &#x2705;',
               'Jalebi-fafda baad mein, login pehle. &#x1F36F;', 'Das sir wale kaam bhi ek-ek karke ho jaate hain. &#x1F4CB;'],
  };

  function loginCSS() {
    if (document.getElementById('fest-login-css')) return;
    const s = document.createElement('style');
    s.id = 'fest-login-css';
    s.textContent = `
      #login-page .fest-lg-toran { position: absolute; left: 0; right: 0; top: 0; height: 26px; z-index: 2; opacity: .95;
        background-repeat: repeat-x; background-size: 36px 26px; pointer-events: none; }
      #login-page .fest-lg-card { position: relative; display: flex; align-items: center; gap: 18px; max-width: 440px;
        padding: 18px 20px; margin: 6px 0 26px; border-radius: 18px; background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.13); backdrop-filter: blur(6px); animation: lgFadeUp .6s cubic-bezier(.16,1,.3,1) .25s both; }
      #login-page .fest-lg-orb { flex-shrink: 0; width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center;
        background: radial-gradient(circle at 35% 30%, #fff 0%, var(--fest-day) 55%); box-shadow: 0 0 0 4px rgba(255,255,255,.08), 0 0 44px var(--fest-day);
        animation: festOrb 3.2s ease-in-out infinite; }
      @keyframes festOrb { 50% { box-shadow: 0 0 0 4px rgba(255,255,255,.08), 0 0 64px var(--fest-day) } }
      #login-page .fest-lg-orb { overflow: hidden; }
      #login-page .fest-lg-orb .fx-portrait { width: 76px; height: 76px; }
      #login-page .fx-mini { display: flex; align-items: flex-end; gap: 4px; margin: -18px 0 0; }
      #login-page .fx-mini .fx-dancer { width: 52px; height: 107px; }
      @media (max-height: 760px) { #login-page .fx-mini { display: none; } }
      #login-page .fest-lg-kicker { font-size: 10.5px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #B8D3F2; }
      #login-page .fest-lg-name { font-size: 24px; font-weight: 700; color: #fff; margin: 3px 0 2px; line-height: 1.2; }
      #login-page .fest-lg-sub { font-size: 13px; color: #A9C4E4; }
      #login-page .fest-lg-meta { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 12px; color: #cfe0f5; }
      #login-page .fest-lg-meta .fest-days i { box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
      #login-page .fest-lg-meta .fest-days i.today { box-shadow: 0 0 0 2px #0A2647, 0 0 0 3.5px #fff; }
      #login-page .fest-lg-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600;
        color: var(--color-primary); background: var(--color-primary-light); border-radius: 999px; padding: 4px 11px 4px 6px; margin-bottom: 12px; }
      #login-page .fest-lg-chip i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
      #login-page .fest-lg-toran-m { display: none; }
      @media (max-width: 1023px) {
        #login-page .fest-lg-toran-m { display: block; }
        #login-page .lg-panel { background:
          radial-gradient(ellipse at 20% -10%, color-mix(in srgb, var(--fest-day) 30%, transparent) 0%, transparent 60%),
          radial-gradient(ellipse at 90% 105%, color-mix(in srgb, var(--fest-day) 18%, transparent) 0%, transparent 55%),
          var(--surface) !important; }
      }
      @media (prefers-reduced-motion: reduce) { #login-page .fest-lg-orb { animation: none; } }`;
    document.head.appendChild(s);
  }

  // Called by Pages.login.render() right after it paints. Swaps the mock-
  // dashboard animation for today's goddess card, tints the glow blobs in the
  // day's colour, and puts a small greeting chip on the sign-in card (the
  // only part phones see).
  function decorateLogin(el) {
    const f = current();
    if (!f || !el || mode() === 'off') return;
    injectCSS(); loginCSS();
    const nav = f.kind === 'navratri';
    const colour = nav && f.day > 0 ? navratriColour(f.row.start, f.day - 1) : null;
    const dayHex = colour ? HEX[colour] : nav ? '#f97316' : '#f59e0b';
    el.style.setProperty('--fest-day', dayHex);

    const brand = el.querySelector('.lg-brand');
    const t = dayTheme(f);
    if (brand && t) brand.style.background = `linear-gradient(150deg, ${t.side} 0%, color-mix(in srgb, ${t.side}, ${t.p} 40%) 52%, ${t.p} 100%)`;
    if (brand) {
      const tor = document.createElement('span');
      tor.className = 'fest-lg-toran';
      tor.style.backgroundImage = TORAN(nav ? '#fb7185' : '#f59e0b');
      brand.appendChild(tor);
      const b1 = brand.querySelector('.lg-blob-1'), b3 = brand.querySelector('.lg-blob-3'), b2 = brand.querySelector('.lg-blob-2');
      if (b1) b1.style.background = dayHex + '8c';
      if (b3) b3.style.background = dayHex + '4d';
      if (b2) b2.style.background = nav ? 'rgba(236,72,153,.34)' : 'rgba(234,88,12,.40)';
    }

    let kicker, name, sub, meta = '';
    if (nav && f.day === 0) {
      kicker = 'Navratri · begins tomorrow';
      name = 'शुभ नवरात्रि';
      sub = `Ghatasthapana, ${new Date(f.row.start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`;
    } else if (nav) {
      const i = f.day - 1;
      kicker = `Navratri${f.day === 8 ? ' · Ashtami' : f.day === 9 ? ' · Navami' : ''}`;
      name = `माँ ${GODDESS_HI[i]}`;
      sub = `Maa ${GODDESS[i]} · ${GODDESS_GIFT[i]}`;
      const dots = Array.from({ length: 9 }, (_, k) => {
        const c = navratriColour(f.row.start, k);
        return `<i class="${k < i ? 'past' : k === i ? 'today' : ''}" style="background:${HEX[c]}"></i>`;
      }).join('');
      meta = `<div class="fest-lg-meta"><div class="fest-days">${dots}</div><span>Aaj ka rang · <b>${colour}</b></span></div>`;
    } else {
      kicker = 'Vijayadashami';
      name = 'शुभ दशहरा';
      sub = 'असत्य पर सत्य की विजय — Happy Dussehra';
    }

    const stage = el.querySelector('.lg-stage');
    if (stage) {
      const card = document.createElement('div');
      card.className = 'fest-lg-card';
      card.innerHTML = `<div class="fest-lg-orb">${nav ? DURGA(Math.max(0, f.day - 1), true) : BOW}</div>
        <div><div class="fest-lg-kicker">${kicker}</div><div class="fest-lg-name">${name}</div>
        <div class="fest-lg-sub">${sub}</div>${meta}</div>`;
      stage.replaceWith(card);
    }

    if (brand) startParticles(brand, f.kind, true);
    const panel = el.querySelector('.lg-panel');
    if (panel) {
      const tor = document.createElement('span');
      tor.className = 'fest-lg-toran fest-lg-toran-m';
      tor.style.backgroundImage = TORAN(nav ? '#fb7185' : '#f59e0b');
      panel.appendChild(tor);
    }

    const greet = el.querySelector('.lg-greeting .lg-dot');
    if (greet) { greet.style.background = dayHex; greet.style.boxShadow = `0 0 0 3px ${dayHex}55`; }

    const quipEl = el.querySelector('.lg-quip');
    if (nav && quipEl) {
      const line = document.createElement('div');
      line.className = 'fx-mini';
      line.setAttribute('aria-hidden', 'true');
      line.innerHTML = DANCER(true, '#db2777', '#f59e0b', 0) + DANCER(false, '#f59e0b', '#db2777', 0.4)
        + DANCER(true, '#7e22ce', '#16a34a', 0.2) + DANCER(false, '#16a34a', '#7e22ce', 0.6);
      quipEl.after(line);
    }
    const quips = el.querySelectorAll('.lg-quip span');
    QUIPS[f.kind].forEach((q, i) => { if (quips[i]) quips[i].innerHTML = q; });

    const h1 = el.querySelector('.login-card h1');
    if (h1) {
      const chip = document.createElement('div');
      chip.className = 'fest-lg-chip';
      chip.innerHTML = nav
        ? `<i style="background:${dayHex}"></i>शुभ नवरात्रि${f.day > 0 ? ` · ${colour}` : ''}`
        : `<i style="background:${dayHex}"></i>शुभ दशहरा · Happy Dussehra`;
      h1.parentNode.insertBefore(chip, h1);
    }
  }

  applyTheme();

  return { mount, current, decorateLogin, decorateTopbar, applyTheme };
})();
