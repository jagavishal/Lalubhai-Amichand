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
  // Ravan effigy, putla style: ten crowned heads, gold armour, striped
  // skirt, sword and shield, on a bamboo stand. .fest-fire is the burn layer.
  let _rid = 0;
  function RAVAN() {
    const id = 'rv' + (++_rid);
    const head = (x, y, r, main) => {
      const s = r / 18; // everything below is drawn for r = 18, scaled
      return `<g transform="translate(${x} ${y}) scale(${s})">
        <path d="M-15 -14 L-13 -34 L-6 -24 L0 -40 L6 -24 L13 -34 L15 -14Z" fill="url(#${id}g)" stroke="#92400e" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cy="-28" r="3.4" fill="#dc2626" stroke="#fde68a"/>
        <circle r="18" fill="url(#${id}f)" stroke="#9a3412" stroke-width="1.6"/>
        <path d="M-16 -14 Q0 -22 16 -14" stroke="${GOLD}" stroke-width="3.4" fill="none"/>
        <path d="M-12 -6 L-3 -2 M12 -6 L3 -2" stroke="#111" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="-6.5" cy="1" rx="4.2" ry="3" fill="#fff"/><ellipse cx="6.5" cy="1" rx="4.2" ry="3" fill="#fff"/>
        <circle cx="-6" cy="1.4" r="2" fill="#111"/><circle cx="6" cy="1.4" r="2" fill="#111"/>
        <path d="M0 -10 V-3" stroke="#dc2626" stroke-width="2.4"/>
        <path d="M0 9 C-6 4 -12 6 -15 12 C-12 9 -7 9 -2 12 M0 9 C6 4 12 6 15 12 C12 9 7 9 2 12" fill="#111" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M-5 13 Q0 16.5 5 13" stroke="#7f1d1d" stroke-width="1.8" fill="none"/>
        ${main ? '<circle cx="-18" cy="4" r="3" fill="#facc15"/><circle cx="18" cy="4" r="3" fill="#facc15"/>' : ''}
      </g>`;
    };
    const side = [4, 3, 2, 1].map(i => head(80 - i * 16.5, 50 + i * 2.6, 13 - i * 0.6) + head(80 + i * 16.5, 50 + i * 2.6, 13 - i * 0.6)).join('');
    return `<svg class="fest-ravan-svg" width="28" height="42" viewBox="0 0 160 240" aria-label="Ravan">
      <defs>
        <radialGradient id="${id}f" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fdba74"/><stop offset=".6" stop-color="#f97316"/><stop offset="1" stop-color="#c2410c"/></radialGradient>
        <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fef3c7"/><stop offset=".45" stop-color="#f5b301"/><stop offset="1" stop-color="#b7791f"/></linearGradient>
        <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#eab308"/><stop offset="1" stop-color="#a16207"/></linearGradient>
      </defs>
      <path d="M62 196 L56 232 M98 196 L104 232" stroke="#a16207" stroke-width="4"/>
      <path d="M58 214 H102" stroke="#a16207" stroke-width="3"/>
      <rect x="34" y="230" width="92" height="9" rx="3" fill="#78350f"/>
      <path d="M66 180 L62 226 H72 L76 182Z M94 180 L98 226 H88 L84 182Z" fill="#7f1d1d"/>
      <path d="M60 218 h14 M86 218 h14" stroke="${GOLD}" stroke-width="3"/>
      <path d="M50 136 H110 L124 196 H36Z" fill="#dc2626"/>
      ${[0, 1, 2, 3, 4, 5, 6].map(i => `<path d="M${46 + i * 11} 138 L${40 + i * 13.5} 196" stroke="${i % 2 ? '#facc15' : '#16a34a'}" stroke-width="4"/>`).join('')}
      <path d="M36 190 H124 L126 198 H34Z" fill="${GOLD}"/>
      <path d="M48 86 Q80 74 112 86 L110 140 H50Z" fill="url(#${id}a)" stroke="#a16207" stroke-width="1.4"/>
      <path d="M56 100 Q80 92 104 100 M58 116 Q80 108 102 116" stroke="#a16207" stroke-width="2" fill="none"/>
      <circle cx="80" cy="112" r="10" fill="#dc2626" stroke="${GOLD}" stroke-width="3"/><circle cx="80" cy="112" r="4" fill="#fde68a"/>
      <rect x="48" y="130" width="64" height="9" rx="2" fill="#15803d"/>
      ${[54, 64, 74, 86, 96, 106].map(x => `<circle cx="${x}" cy="134.5" r="2" fill="${GOLD}"/>`).join('')}
      <path d="M48 88 Q34 96 26 132" stroke="#7f1d1d" stroke-width="11" fill="none" stroke-linecap="round"/>
      <path d="M112 88 Q126 96 134 128" stroke="#7f1d1d" stroke-width="11" fill="none" stroke-linecap="round"/>
      <ellipse cx="46" cy="90" rx="11" ry="8" fill="#dc2626" stroke="${GOLD}" stroke-width="2"/><ellipse cx="114" cy="90" rx="11" ry="8" fill="#dc2626" stroke="${GOLD}" stroke-width="2"/>
      <path d="M22 134 L18 70" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/><path d="M18 70 l-3 -10 l6 2z" fill="#e2e8f0"/>
      <path d="M12 134 H32" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/><circle cx="26" cy="134" r="5" fill="#f3c08d"/>
      <circle cx="138" cy="132" r="17" fill="url(#${id}g)" stroke="#dc2626" stroke-width="4"/><circle cx="138" cy="132" r="6" fill="#dc2626"/>
      ${[0, 72, 144, 216, 288].map(a => `<circle cx="138" cy="120" r="2" fill="#dc2626" transform="rotate(${a} 138 132)"/>`).join('')}
      <path d="M60 84 Q80 98 100 84" stroke="${GOLD}" stroke-width="5" fill="none"/>
      ${side}
      ${head(80, 22, 10)}
      ${head(80, 50, 19, true)}
      <g class="fest-fire">
        ${[[50, 190], [80, 150], [110, 190], [62, 110], [98, 110], [80, 60], [40, 70], [120, 70]].map(([x, y], i) =>
          `<path style="animation-delay:${i * 0.11}s" d="M${x} ${y - 30} C${x + 16} ${y - 10} ${x + 12} ${y + 9} ${x} ${y + 12} C${x - 12} ${y + 9} ${x - 16} ${y - 10} ${x} ${y - 30}Z" fill="${i % 2 ? '#f97316' : '#fbbf24'}"/>
           <path style="animation-delay:${i * 0.11 + 0.05}s" d="M${x} ${y - 14} C${x + 7} ${y - 4} ${x + 6} ${y + 6} ${x} ${y + 8} C${x - 6} ${y + 6} ${x - 7} ${y - 4} ${x} ${y - 14}Z" fill="#fff7d6"/>`).join('')}
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

  // Hex blend, for shading the day's saree colour without hand-picking nine shades.
  function mix(a, b, t) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const x = p(a), y = p(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  let _gid = 0; // gradient ids must be unique per <svg> on the page

  // day: 0..8. portrait = face crop for the banner / topbar / login orb.
  function DURGA(day, portrait) {
    const g = NAVADURGA[Math.max(0, Math.min(8, day))];
    const id = 'dg' + (++_gid);
    const skin = g.skin || SKIN, skinD = g.skinD || SKIN_D, hairC = g.wild ? '#0b0b0b' : '#1a1110';
    const white = g.saree === '#f8fafc';
    const sareeTop = white ? '#ffffff' : mix(g.saree, '#ffffff', 0.12), sareeBot = white ? '#e7e5e4' : mix(g.saree, '#000000', 0.28);

    const rays = Array.from({ length: 24 }, (_, i) =>
      `<path d="M110 92 L106 8 L114 8Z" fill="${i % 2 ? '#fde68a' : '#fdba74'}" transform="rotate(${i * 15} 110 92)"/>`).join('');
    const petals = Array.from({ length: 16 }, (_, i) =>
      `<ellipse cx="110" cy="30" rx="6" ry="11" fill="#fbbf24" stroke="#d97706" stroke-width="1" transform="rotate(${i * 22.5} 110 92)"/>`).join('');

    const half = Math.ceil(g.items.length / 2);
    const arms = g.items.map((item, i) => {
      const side = i < half ? 0 : 1, k = side ? i - half : i;
      const pos = (side ? ARM_POS[g.items.length - half] : ARM_POS[half]) || ARM_POS[4];
      let [x, y] = pos[k];
      if (side) x = 220 - x;
      const sx = side ? 128 : 92, sy = 148, mx = (sx + x) / 2, my = (sy + y) / 2 + 12;
      return `<path d="M${sx} ${sy} Q${mx} ${my} ${x} ${y}" stroke="${skinD}" stroke-width="11" fill="none" stroke-linecap="round"/>
        <path d="M${sx} ${sy} Q${mx} ${my} ${x} ${y}" stroke="${skin}" stroke-width="8" fill="none" stroke-linecap="round"/>
        <circle cx="${mx}" cy="${my - 6}" r="4.5" fill="none" stroke="${GOLD}" stroke-width="2.6"/>
        <path d="M${x - 6} ${y + 7} q6 5 12 0 M${x - 6} ${y + 10} q6 5 12 0" stroke="${GOLD}" stroke-width="2.2" fill="none"/>
        <circle cx="${x}" cy="${y}" r="6.5" fill="${skin}" stroke="${skinD}" stroke-width="1"/><circle cx="${x}" cy="${y}" r="2" fill="#dc2626" opacity=".7"/>
        ${ITEM(item, x, y).replace(/\$SKIN/g, skin)}`;
    }).join('');

    const hairBack = g.wild
      ? `<path d="M74 70 L58 62 L72 56 L62 40 L82 46 L86 26 L100 42 L110 22 L120 42 L134 26 L138 46 L158 40 L148 56 L162 62 L146 70 Q160 120 158 160 L62 160 Q60 120 74 70Z" fill="${hairC}"/>`
      : `<path d="M80 64 Q64 112 62 160 Q86 170 110 168 Q134 170 158 160 Q156 112 140 64Z" fill="${hairC}"/>
         <path d="M76 90 Q70 120 70 150 M144 90 Q150 120 150 150" stroke="#3a2a22" stroke-width="2" fill="none" opacity=".7"/>`;

    const crown = g.ascetic
      ? `<ellipse cx="110" cy="58" rx="15" ry="12" fill="${hairC}"/><path d="M96 60 Q110 50 124 60" stroke="#92400e" stroke-width="3" stroke-dasharray="1 3.4" stroke-linecap="round" fill="none"/>
         <path d="M110 66 V76" stroke="#dc2626" stroke-width="2"/>`
      : `<path d="M80 74 L81 48 L92 58 L97 36 L106 50 L110 18 L114 50 L123 36 L128 58 L139 48 L140 74 Q110 63 80 74Z" fill="url(#${id}g)" stroke="${GOLD_D}" stroke-width="1.4" stroke-linejoin="round"/>
         <path d="M82 70 Q110 60 138 70" stroke="#dc2626" stroke-width="3" fill="none"/>
         <path d="M82 66 Q110 56 138 66" stroke="#fff7d6" stroke-width="1.2" fill="none" stroke-dasharray="2 3"/>
         <circle cx="110" cy="44" r="5.5" fill="#dc2626" stroke="#fff7d6" stroke-width="1.5"/><circle cx="108.4" cy="42.4" r="1.6" fill="#fff" opacity=".9"/>
         <circle cx="97" cy="54" r="3.2" fill="#16a34a" stroke="#fff7d6"/><circle cx="123" cy="54" r="3.2" fill="#16a34a" stroke="#fff7d6"/>
         <circle cx="88" cy="63" r="2.4" fill="#dc2626"/><circle cx="132" cy="63" r="2.4" fill="#dc2626"/>
         ${[86, 92, 98, 104, 110, 116, 122, 128, 134].map(x => `<circle cx="${x}" cy="${75 - 6 * (1 - Math.abs(x - 110) / 24)}" r="1.7" fill="#fff" stroke="#e5e7eb" stroke-width=".5"/>`).join('')}`;
    const moon = g.moon ? `<path d="M99 ${g.ascetic ? 44 : 14} q11 11 22 0 q-11 6 -22 0Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/>` : '';
    const baby = g.baby ? `<g><path d="M95 230 Q95 194 110 192 Q125 194 125 230Z" fill="#f59e0b" stroke="#b45309"/><circle cx="110" cy="184" r="11" fill="${SKIN}" stroke="${SKIN_D}"/>
      <path d="M101 177 L103 166 L110 173 L117 166 L119 177Z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width=".8"/><circle cx="106" cy="184" r="1.5" fill="#1f1410"/><circle cx="114" cy="184" r="1.5" fill="#1f1410"/>
      <ellipse cx="103" cy="188" rx="2.5" ry="1.5" fill="#fb7185" opacity=".5"/><ellipse cx="117" cy="188" rx="2.5" ry="1.5" fill="#fb7185" opacity=".5"/>
      <path d="M107 189 q3 2.4 6 0" stroke="#be123c" stroke-width="1.3" fill="none"/></g>` : '';
    // eye: almond, iris with highlight, winged liner, lashes
    const eye = (cx, dir) => `<path d="M${cx - 8} 98 Q${cx} 89 ${cx + 8} 98 Q${cx} 104 ${cx - 8} 98Z" fill="#fff"/>
      <circle cx="${cx + dir * 0.6}" cy="97.6" r="4.3" fill="#3b2314"/><circle cx="${cx + dir * 0.6}" cy="97.6" r="2.2" fill="#000"/><circle cx="${cx + dir * 0.6 + 1.4}" cy="96" r="1.3" fill="#fff"/>
      <path d="M${cx - 9} 97.5 Q${cx} 88 ${cx + 9} 97.5 l${dir * 3.5} -2.6" stroke="#111" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M${cx - 8} 98 Q${cx} 104 ${cx + 8} 98" stroke="#111" stroke-width=".9" fill="none"/>`;
    const vb = portrait ? '68 30 84 84' : '0 0 220 230';
    return `<svg class="${portrait ? 'fx-portrait' : 'fx-durga'}" width="${portrait ? 54 : 220}" height="${portrait ? 54 : 230}" viewBox="${vb}" aria-label="Maa ${GODDESS[day]}">
      <defs>
        <radialGradient id="${id}h"><stop offset="0" stop-color="#fffbeb"/><stop offset=".55" stop-color="#fde68a"/><stop offset="1" stop-color="#fb923c"/></radialGradient>
        <radialGradient id="${id}s" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="${mix(skin, '#ffffff', 0.3)}"/><stop offset=".6" stop-color="${skin}"/><stop offset="1" stop-color="${skinD}"/></radialGradient>
        <linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sareeTop}"/><stop offset="1" stop-color="${sareeBot}"/></linearGradient>
        <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fef3c7"/><stop offset=".45" stop-color="#f5b301"/><stop offset="1" stop-color="#b7791f"/></linearGradient>
      </defs>
      ${portrait ? '' : `<g class="fx-rays">${rays}</g>${petals}`}
      <circle cx="110" cy="92" r="58" fill="url(#${id}h)"/>
      <circle cx="110" cy="92" r="54" fill="none" stroke="#fff7d6" stroke-width="1.6" stroke-dasharray="1 5" stroke-linecap="round"/>
      ${portrait ? '' : arms}
      ${hairBack}
      <path d="M64 154 Q110 136 156 154 L172 230 H48Z" fill="url(#${id}r)" ${white ? 'stroke="#e5e7eb"' : ''}/>
      <path d="M64 154 Q110 136 156 154 L154 162 Q110 146 66 162Z" fill="url(#${id}g)"/>
      <path d="M52 212 H168 L172 230 H48Z" fill="url(#${id}g)"/>
      ${[58, 70, 82, 94, 106, 118, 130, 142, 154].map(x => `<path d="M${x} 221 l4 -5 l4 5 l-4 5z" fill="${white ? '#dc2626' : mix(g.saree, '#000000', 0.2)}"/>`).join('')}
      <path d="M118 148 Q150 172 162 230 H140 Q130 182 104 152Z" fill="${mix(white ? '#f59e0b' : g.saree, '#000000', white ? 0 : 0.18)}" opacity="${white ? '.35' : '1'}"/>
      <path d="M118 148 Q150 172 162 230" stroke="url(#${id}g)" stroke-width="5" fill="none"/>
      ${[0.2, 0.4, 0.6, 0.8].map(k => `<circle cx="${128 + 30 * k}" cy="${160 + 64 * k}" r="2" fill="#fff7d6" opacity=".8"/>`).join('')}
      <path d="M100 118 Q100 136 96 146 L124 146 Q120 136 120 118Z" fill="${skinD}"/>
      ${g.ascetic
        ? `<path d="M90 142 Q110 172 130 142" stroke="#92400e" stroke-width="3.4" fill="none" stroke-dasharray="1 4.2" stroke-linecap="round"/>`
        : `<path d="M92 138 Q110 152 128 138" stroke="url(#${id}g)" stroke-width="6" fill="none"/>
           ${[96, 102, 110, 118, 124].map(x => `<circle cx="${x}" cy="${144 + 4 * (1 - Math.abs(x - 110) / 16)}" r="2" fill="#dc2626"/>`).join('')}
           <path d="M88 142 Q110 178 132 142" stroke="${GOLD}" stroke-width="2.6" fill="none"/>
           <path d="M110 166 l-6 6 l6 8 l6 -8z" fill="#dc2626" stroke="${GOLD}" stroke-width="2"/>`}
      <ellipse cx="84" cy="100" rx="4" ry="6" fill="${skinD}"/><ellipse cx="136" cy="100" rx="4" ry="6" fill="${skinD}"/>
      <ellipse cx="110" cy="99" rx="26" ry="29" fill="url(#${id}s)"/>
      <path d="M84 96 Q84 66 110 62 Q136 66 136 96 Q132 76 112 74 L110 66 L108 74 Q88 76 84 96Z" fill="${hairC}"/>
      <path d="M110 64 V73" stroke="#dc2626" stroke-width="2.2"/>
      ${crown}${moon}
      <path d="M110 77 V82" stroke="${GOLD}" stroke-width="1"/><ellipse cx="110" cy="85.5" rx="2.4" ry="4.8" fill="#dc2626" stroke="${GOLD}" stroke-width="1"/>
      <path d="M92 89 Q100 83.5 107 88 M113 88 Q120 83.5 128 89" stroke="#1a1110" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      ${eye(100, -1)}${eye(120, 1)}
      <ellipse cx="94" cy="110" rx="6" ry="3.4" fill="#fb7185" opacity=".38"/><ellipse cx="126" cy="110" rx="6" ry="3.4" fill="#fb7185" opacity=".38"/>
      <path d="M110 100 Q108 108 107 110 Q110 112 113 110" stroke="${skinD}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M102 117.5 Q106 114.5 110 116.5 Q114 114.5 118 117.5 Q110 124 102 117.5Z" fill="#be123c"/>
      <path d="M106 119.5 q4 1.6 8 0" stroke="#fda4af" stroke-width="1" fill="none" opacity=".8"/>
      ${g.ascetic
        ? `<circle cx="84" cy="108" r="2.8" fill="#92400e"/><circle cx="136" cy="108" r="2.8" fill="#92400e"/>`
        : `<circle cx="104" cy="111" r="4.6" fill="none" stroke="${GOLD}" stroke-width="1.6"/><circle cx="100.2" cy="112.6" r="1.4" fill="#fff"/>
           <path d="M104 106.5 Q92 100 86 104" stroke="${GOLD}" stroke-width=".9" fill="none"/>
           ${[84, 136].map(x => `<path d="M${x - 5} 110 Q${x} 102 ${x + 5} 110Z" fill="url(#${id}g)"/>${[-4, -1.3, 1.3, 4].map(d => `<circle cx="${x + d}" cy="112.5" r="1.1" fill="#fff"/>`).join('')}`).join('')}`}
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
    peekAndWatch(wrap, [left, right]);
  }

  // Corner art lives on <body> (the dashboard wrapper is transformed, which
  // would pin position:fixed to it), so it fades near the mouse and takes
  // itself down once the dashboard is gone. onGone runs at teardown.
  function peekAndWatch(wrap, els, onGone) {
    wrap.classList.add('fx-pad');
    let raf = 0, mx = -1e4, my = -1e4;
    const near = () => {
      raf = 0;
      for (const el of els) {
        const b = el.getBoundingClientRect();
        el.classList.toggle('peek', mx > b.left - 30 && mx < b.right + 30 && my > b.top - 30 && my < b.bottom + 30);
      }
    };
    const onMove = e => { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(near); };
    document.addEventListener('mousemove', onMove, { passive: true });
    const watch = setInterval(() => {
      if (wrap.isConnected && els[0].isConnected) return;
      clearInterval(watch);
      document.removeEventListener('mousemove', onMove);
      els.forEach(el => el.remove());
      onGone?.();
    }, 700);
  }

  /* ── Dussehra: Shri Ram shoots, Ravan burns ──────────────────────── */
  const RAM_BLUE = '#5b8def', RAM_BLUE_D = '#3f6fcf';
  const RAM = `<svg class="fx-ram" width="180" height="220" viewBox="0 0 180 220" aria-label="Shri Ram">
    <circle cx="66" cy="48" r="34" fill="#fde68a" opacity=".6"/>
    <g transform="rotate(-18 40 100)">
      <rect x="30" y="72" width="15" height="58" rx="4" fill="#92400e" stroke="#78350f"/>
      <path d="M32 74 l-3 -16 M37 74 v-18 M42 74 l3 -16" stroke="#78350f" stroke-width="2"/>
      <path d="M26 56 l3 -8 l3 8z M34 54 l3 -8 l3 8z M42 56 l3 -8 l3 8z" fill="#dc2626"/>
    </g>
    <path d="M48 128 H92 L104 196 H83 L72 152 L61 196 H38Z" fill="#facc15"/>
    <path d="M40 188 H62 M82 188 H103" stroke="#dc2626" stroke-width="4"/>
    <ellipse cx="50" cy="201" rx="13" ry="5" fill="${RAM_BLUE_D}"/><ellipse cx="95" cy="201" rx="13" ry="5" fill="${RAM_BLUE_D}"/>
    <path d="M50 80 Q70 72 90 80 L94 130 H46Z" fill="${RAM_BLUE}"/>
    <path d="M52 80 L92 126" stroke="#f97316" stroke-width="7"/>
    <path d="M58 82 L86 126" stroke="#fff" stroke-width="1.2" opacity=".8"/>
    <rect x="44" y="124" width="52" height="8" rx="2" fill="#dc2626"/>
    ${[50, 60, 70, 80, 90].map(x => `<circle cx="${x}" cy="128" r="1.6" fill="${GOLD}"/>`).join('')}
    <path d="M58 82 Q70 96 82 82" stroke="${GOLD}" stroke-width="3" fill="none"/>
    <path d="M55 82 Q70 106 85 82" stroke="#fde68a" stroke-width="3" fill="none" stroke-dasharray="1 4" stroke-linecap="round"/>
    <path d="M54 86 Q42 78 76 70" stroke="${RAM_BLUE}" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M47 80 l6 4" stroke="${GOLD}" stroke-width="3"/>
    <path d="M50 46 Q48 74 56 86 L80 86 Q86 70 82 46Z" fill="#111"/>
    <rect x="61" y="62" width="12" height="16" fill="${RAM_BLUE_D}"/>
    <circle cx="67" cy="52" r="15" fill="${RAM_BLUE}"/>
    <path d="M52 40 L54 16 L61 27 L67 6 L73 27 L80 16 L82 40 Q67 34 52 40Z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="1.2"/>
    <circle cx="67" cy="24" r="3.4" fill="#dc2626" stroke="#fff" stroke-width="1"/>
    <path d="M64 38 v7 q3 3 6 0 v-7" stroke="#fff" stroke-width="1.6" fill="none"/><path d="M67 39 v7" stroke="#dc2626" stroke-width="1.4"/>
    <path d="M68 50 Q73 46 78 50 Q73 53 68 50Z" fill="#fff" stroke="#111" stroke-width="1.4"/><circle cx="75" cy="50" r="1.8" fill="#111"/>
    <path d="M58 50 Q62 47 65 50" stroke="#111" stroke-width="1.4" fill="none"/>
    <path d="M70 59 q4 3 8 0" stroke="#7f1d1d" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="55" cy="58" r="2.8" fill="${GOLD}"/>
    <path d="M86 86 Q112 80 140 76" stroke="${RAM_BLUE}" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M104 78 l2 8" stroke="${GOLD}" stroke-width="3"/>
    <path d="M136 14 Q182 76 136 138" stroke="#92400e" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M136 14 Q182 76 136 138" stroke="#fcd34d" stroke-width="1.4" fill="none" stroke-dasharray="3 6"/>
    <path class="fx-str-drawn" d="M136 14 L76 70 L136 138" stroke="#e5e7eb" stroke-width="1.4" fill="none"/>
    <path class="fx-str-loose" d="M136 14 L136 138" stroke="#e5e7eb" stroke-width="1.4" fill="none"/>
    <g class="fx-ram-arrow">
      <path d="M76 70 L168 72" stroke="#78350f" stroke-width="3"/>
      <path d="M176 72 l-10 -5 v10z" fill="#94a3b8"/>
      <path d="M76 70 l-6 -5 M76 70 l-6 5 M82 70 l-6 -5 M82 70 l-6 5" stroke="#dc2626" stroke-width="2"/>
    </g>
    <circle cx="140" cy="76" r="6" fill="${RAM_BLUE}"/><circle cx="76" cy="70" r="6" fill="${RAM_BLUE}"/>
  </svg>`;

  function mountDussehra(wrap) {
    document.querySelectorAll('.fx-corner').forEach(n => n.remove());
    const left = document.createElement('div');
    left.className = 'fx-corner left';
    left.innerHTML = `<div class="fx-pill dussehra">🏹 जय श्री राम</div>${RAM}`;
    const right = document.createElement('div');
    right.className = 'fx-corner right fx-ravan';
    right.innerHTML = RAVAN();
    document.body.append(left, right);

    let busy = false, timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    function shoot(popup) {
      if (busy || !right.isConnected) return;
      busy = true;
      const a = left.querySelector('.fx-ram-arrow').getBoundingClientRect();
      const t = right.querySelector('svg').getBoundingClientRect();
      const sx = a.left, sy = a.top + a.height / 2;
      const tx = t.left + t.width * 0.5 - 90, ty = t.top + t.height * 0.4;
      left.classList.add('loosed');
      const arrow = document.createElement('div');
      arrow.className = 'fest-arrow';
      Object.assign(arrow.style, { left: '0px', top: '0px' });
      document.body.appendChild(arrow);
      // Arc over the page: height grows with distance, angle follows the path.
      const H = Math.min(260, (tx - sx) * 0.25);
      const frames = Array.from({ length: 13 }, (_, i) => {
        const k = i / 12;
        const x = sx + (tx - sx) * k, y = sy + (ty - sy) * k - H * 4 * k * (1 - k);
        const ang = Math.atan2((ty - sy) - H * 4 * (1 - 2 * k), tx - sx);
        return { transform: `translate(${x}px, ${y}px) rotate(${ang}rad)` };
      });
      arrow.animate(frames, { duration: 1100, easing: 'linear', fill: 'forwards' }).finished.then(() => {
        arrow.remove();
        right.classList.add('burning');
        fireworks(document.body, tx + 90, ty);
        if (popup) {
          const v = document.createElement('div');
          v.className = 'fest-victory';
          v.innerHTML = 'जय श्री राम 🏹<small>Happy Dussehra from Lalubhai Amichand</small>';
          document.body.appendChild(v);
          requestAnimationFrame(() => v.classList.add('show'));
          later(() => v.classList.remove('show'), 2600);
          later(() => v.remove(), 3000);
        }
      });
      later(() => left.classList.remove('loosed'), 1600);   // Ram nocks the next arrow
      later(() => right.classList.add('burnt'), 4200);      // effigy burns down…
      later(() => { right.classList.remove('burning', 'burnt'); busy = false; }, 8000); // …and a new one stands
    }
    window.Festival._shoot = shoot;
    later(() => shoot(true), 2200);                          // once on arrival, with the greeting
    const loop = setInterval(() => shoot(false), 25000);     // then quietly every 25 s
    peekAndWatch(wrap, [left, right], () => { clearInterval(loop); timers.forEach(clearTimeout); window.Festival._shoot = null; });
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
      .fx-corner .fx-durga, .fx-corner .fest-ravan-svg, .fx-corner .fx-ram, .fx-couple .fx-dancer, .fx-scene .fx-durga, .fx-scene .fx-dancer {
        filter: drop-shadow(2.5px 0 0 #fff) drop-shadow(-2.5px 0 0 #fff) drop-shadow(0 2.5px 0 #fff) drop-shadow(0 -2.5px 0 #fff)
                drop-shadow(0 6px 8px rgba(0,0,0,.22)); }
      .fx-pill.dussehra { background: linear-gradient(90deg, #b45309, #dc2626); }
      .fx-ram .fx-str-loose, .fx-corner.loosed .fx-str-drawn, .fx-corner.loosed .fx-ram-arrow { display: none; }
      .fx-corner.loosed .fx-str-loose { display: inline; }
      .fx-ravan .fest-ravan-svg { width: 160px; height: 240px; display: block; }
      .fx-ravan.burning .fest-fire { opacity: .95; }
      .fx-ravan.burning .fest-ravan-svg { animation: festShake .2s linear infinite; }
      .fx-ravan.burnt { opacity: 0; transition: opacity 1.2s; }
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
        gap: 9px; white-space: nowrap; padding: 4px 5px 4px 4px; border-radius: 999px;
        background: var(--color-primary-light, rgba(190,18,60,.08)); }
      .fest-tb i { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface, #fff), 0 0 0 3px var(--color-primary); }
      .fest-tb b { font-size: 16px; font-weight: 700; color: var(--color-primary); }
      .fest-tb span { font-size: 12.5px; font-weight: 500; color: var(--text-secondary, #475569); }
      .fest-tb-art { width: 32px; height: 32px; border-radius: 50%; overflow: hidden; display: grid; place-items: center;
        background: var(--surface, #fff); flex-shrink: 0; }
      .fest-tb-art svg { width: 32px; height: 32px; }
      .fest-tb .fest-tb-col { display: inline-flex; align-items: center; gap: 5px; }
      .fest-tb .fest-tb-col i { width: 9px; height: 9px; }
      .fest-tb .fest-ctrl { padding: 2px; margin-left: 4px; }
      .fest-tb .fest-ctrl button { padding: 3px 9px; font-size: 11px; }
      .fest-tb .fest-ctrl button.on { color: var(--color-primary); }
      .fest-tb-ravan, .fest-tb-on { border: 1px solid var(--color-primary); background: var(--surface, #fff); color: var(--color-primary);
        font-size: 11.5px; font-weight: 700; border-radius: 999px; padding: 3px 10px; cursor: pointer; }
      .fest-tb-on { border-style: dashed; font-weight: 600; }
      @media (max-width: 1450px) { .fest-tb .fest-tb-col { display: none; } }
      @media (max-width: 1300px) { .fest-tb .fest-tb-mid { display: none; } }
      /* The date beside it is also on the dashboard; give the pill the room. */
      @media (max-width: 1600px) { #topbar:has(.fest-tb) #topbar-title + div + div { display: none !important; } }
      /* Desktop has the topbar pill, so the dashboard banner is phones-only. */
      @media (min-width: 768px) { .fest-banner, .fest-off { display: none !important; } }
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
      .fest-arrow { position: fixed; z-index: 31; pointer-events: none; width: 90px; height: 4px; background: #78350f; border-radius: 2px; }
      .fest-arrow::after { content: ''; position: absolute; right: -10px; top: -5px; border-left: 16px solid #b91c1c;
        border-top: 8px solid transparent; border-bottom: 8px solid transparent; top: -6px; right: -14px; }
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
      // Desktop: Ram ji in the corner does the shooting.
      const corner = document.querySelector('.fx-ravan');
      if (corner && getComputedStyle(corner).display !== 'none' && window.Festival._shoot) { window.Festival._shoot(true); return; }
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
    _wrap = wrap;
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
      t.querySelector('button').onclick = () => setModeAndRepaint('full');
      return;
    }

    const accent = f.kind === 'navratri' ? '#e11d48' : '#b45309';
    const top = add(`<div class="fest-toran"></div>${bannerHTML(f)}`, 'top');
    top.querySelector('.fest-toran').style.backgroundImage = TORAN(accent);
    top.querySelectorAll('[data-fest-mode]').forEach(b => b.onclick = () => setModeAndRepaint(b.dataset.festMode));

    if (m !== 'full') return;
    if (f.kind === 'navratri') { add(sceneHTML(Math.max(0, f.day - 1))); mountCorners(wrap, Math.max(0, f.day - 1)); }
    if (f.kind === 'dussehra' && !f.after) mountDussehra(wrap);
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
    if (!f) return;
    injectCSS();
    const m = mode(), nav = f.kind === 'navratri';
    const g = document.createElement('div');
    g.className = 'fest-tb';
    if (m === 'off') {
      g.innerHTML = `<button type="button" class="fest-tb-on">🪔 ${nav ? 'Navratri' : 'Dussehra'} theme · turn on</button>`;
      g.querySelector('button').onclick = () => setModeAndRepaint('full');
      bar.appendChild(g);
      return;
    }
    const day = Math.max(0, f.day - 1);
    let text;
    if (nav && f.day === 0) {
      text = `<b>शुभ नवरात्रि</b><span>कल से शुरू · Ghatasthapana ${new Date(f.row.start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>`;
    } else if (nav) {
      const col = navratriColour(f.row.start, day);
      text = `<b>शुभ नवरात्रि</b><span class="fest-tb-mid">माँ ${GODDESS_HI[day]}${f.day === 8 ? ' · Ashtami' : f.day === 9 ? ' · Navami' : ''}</span>
        <span class="fest-tb-col"><i style="background:${HEX[col]}"></i>${col}</span>`;
    } else {
      text = `<b>शुभ विजयादशमी</b><span class="fest-tb-mid">असत्य पर सत्य की विजय</span>`;
    }
    const ravan = !nav && m === 'full' && !f.after ? `<button type="button" class="fest-tb-ravan" title="Ravan Dahan">🏹 Ravan Dahan</button>` : '';
    g.innerHTML = `<span class="fest-tb-art">${nav ? DURGA(day, true) : BOW}</span>${text}${ravan}
      <span class="fest-ctrl" role="group" aria-label="Festival theme">${['full', 'lite', 'off'].map(k =>
        `<button type="button" data-fest-mode="${k}" class="${m === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</span>`;
    g.querySelectorAll('[data-fest-mode]').forEach(btn => btn.onclick = () => setModeAndRepaint(btn.dataset.festMode));
    g.querySelector('.fest-tb-ravan')?.addEventListener('click', () => window.Festival._shoot?.(true));
    bar.appendChild(g);
  }

  // The switch lives in the topbar now, so it has to repaint the dashboard too.
  let _wrap = null;
  function setModeAndRepaint(m) {
    setMode(m);
    const f = current();
    if (f && _wrap?.isConnected) paint(_wrap, f);
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

  return { mount, current, decorateLogin, decorateTopbar, applyTheme, _shoot: null };
})();
