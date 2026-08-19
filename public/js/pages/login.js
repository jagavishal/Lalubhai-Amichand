window.Pages = window.Pages || {};

window.Pages.login = {
  render() {
    const el = document.getElementById('login-page');
    if (!el) return;

    // Greeting + date for the brand panel — makes the landing screen feel live.
    const now      = new Date();
    const hr       = now.getHours();
    const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const dateStr  = now.toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    // One line at a time under the animation, rotating — keeps the panel warm
    // without turning it back into a wall of feature copy.
    const QUIPS = [
      'Chai thandi ho rahi hai &mdash; login kar lijiye. &#x2615;',
      'Stock apne aap toh count hoga nahi. &#x1F4E6;',
      'Approvals aaj bhi pending hain. Hamesha ki tarah. &#x1F4DD;',
      'Boss ne dashboard khol liya hai. &#x1F440;',
    ];
    const QUIP_CYCLE = 14; // seconds for the full rotation — shared with the CSS below

    const quipsHtml = QUIPS.map((q, i) => `
      <span style="animation-delay:${(i * QUIP_CYCLE / QUIPS.length).toFixed(2)}s;">${q}</span>
    `).join('');

    el.innerHTML = `
      <style>
        /* ── Animations ─────────────────────────────────────────────── */
        @keyframes lgFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          33%      { transform: translateY(-10px) rotate(-2deg); }
          66%      { transform: translateY(-5px)  rotate(2deg); }
        }
        @keyframes lgDrift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(40px, -30px) scale(1.12); }
          66%      { transform: translate(-30px, 25px) scale(0.92); }
        }
        @keyframes lgFadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes lgFadeRight {
          from { opacity: 0; transform: translateX(-18px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes lgSpin  { to { transform: rotate(360deg); } }
        @keyframes lgSheen { 0% { left: -60%; } 60%, 100% { left: 130%; } }
        @keyframes lgFadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* ── Scene animations ───────────────────────────────────────── */
        /* The mock dashboard breathes so the panel is never dead still. */
        @keyframes lgBob      { 0%, 100% { transform: translateY(0); }
                                50%      { transform: translateY(-7px); } }
        /* Title placeholder in the mock's title bar loads forever, as they do. */
        @keyframes lgShimmer  { from { background-position-x: 100%; }
                                to   { background-position-x: -120%; } }
        /* Chart bars keep re-reporting. */
        @keyframes lgBarGrow  { 0%, 100% { transform: scaleY(.35); }
                                50%      { transform: scaleY(1); } }
        /* Trend line redraws itself, then holds. */
        @keyframes lgDraw     { 0%       { stroke-dashoffset: 260; }
                                55%, 100%{ stroke-dashoffset: 0; } }
        /* Each vertex pops in behind the line as it passes. */
        @keyframes lgPop      { 0%, 22%  { transform: scale(0); opacity: 0; }
                                34%      { transform: scale(1.6); opacity: 1; }
                                44%, 100%{ transform: scale(1);   opacity: 1; } }
        /* Status pills drift up and out, one after another. */
        @keyframes lgChip     { 0%       { opacity: 0; transform: translateY(12px) scale(.92); }
                                14%, 68% { opacity: 1; transform: translateY(0) scale(1); }
                                100%     { opacity: 0; transform: translateY(-12px) scale(.96); } }
        /* Conveyor tread. */
        @keyframes lgBelt     { from { background-position-x: 0; }
                                to   { background-position-x: -26px; } }
        /* A crate rides the belt from off-screen left to off-screen right. */
        @keyframes lgRide     { from { transform: translateX(0); }
                                to   { transform: translateX(520px); } }
        /* …and gets stamped cleared right about the middle of the run. */
        @keyframes lgStamp    { 0%, 44% { transform: scale(0) rotate(-20deg); opacity: 0; }
                                51%     { transform: scale(1.45) rotate(8deg); opacity: 1; }
                                58%, 88%{ transform: scale(1) rotate(0deg);    opacity: 1; }
                                100%    { transform: scale(1) rotate(0deg);    opacity: 0; } }
        /* Steam off the mug that somehow got onto the conveyor. */
        @keyframes lgSteam    { 0%   { opacity: 0; transform: translateY(0) scaleX(1); }
                                25%  { opacity: .7; }
                                100% { opacity: 0; transform: translateY(-15px) scaleX(1.7); } }
        /* One-liner in, one-liner out. */
        @keyframes lgQuip     { 0%      { opacity: 0; transform: translateY(7px); }
                                4%, 22% { opacity: 1; transform: translateY(0); }
                                26%,100%{ opacity: 0; transform: translateY(-7px); } }

        /* ── Layout ─────────────────────────────────────────────────── */
        #login-page .lg-wrap {
          width: 100%;
          min-height: 100vh;
          display: flex;
          background: var(--surface);
        }

        /* ── Brand side (always dark — reads as part of the logo palette,
              same idea as the sidebar rail) ──────────────────────────── */
        #login-page .lg-brand {
          position: relative;
          overflow: hidden;
          flex: 1 1 54%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 44px 52px;
          box-sizing: border-box;
          color: #e6edf6;
          background: linear-gradient(150deg, #06162B 0%, #0A2647 46%, #0150AA 100%);
        }
        /* Soft colour blobs drifting behind the content */
        #login-page .lg-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(70px);
          pointer-events: none;
        }
        #login-page .lg-blob-1 {
          width: 340px; height: 340px; top: -80px; left: -60px;
          background: rgba(59,138,224,.55);
          animation: lgDrift 18s ease-in-out infinite;
        }
        #login-page .lg-blob-2 {
          width: 300px; height: 300px; bottom: -70px; right: -40px;
          background: rgba(223,4,25,.34);
          animation: lgDrift 22s ease-in-out infinite reverse;
        }
        #login-page .lg-blob-3 {
          width: 260px; height: 260px; top: 42%; left: 46%;
          background: rgba(107,176,245,.24);
          animation: lgDrift 26s ease-in-out infinite;
        }
        /* Faint grid so the panel is never a flat wash of colour */
        #login-page .lg-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
          background-size: 46px 46px;
          mask-image: radial-gradient(ellipse at 30% 40%, #000 10%, transparent 72%);
          -webkit-mask-image: radial-gradient(ellipse at 30% 40%, #000 10%, transparent 72%);
          pointer-events: none;
        }
        /* Content sits above the blobs/grid. Named one by one rather than with a
           universal child selector — that would tie on specificity with the
           .lg-blob / .lg-grid rules above and drop them back into the flow. */
        #login-page .lg-brand > .lg-brand-top,
        #login-page .lg-brand > .lg-brand-mid,
        #login-page .lg-brand > .lg-brand-foot { position: relative; z-index: 1; }

        #login-page .lg-brand-top   { display: flex; align-items: center; gap: 14px;
                                      animation: lgFadeRight .6s cubic-bezier(.16,1,.3,1) both; }
        #login-page .lg-brand-logo  { width: 54px; height: 54px; border-radius: 15px;
                                      object-fit: contain; background: #fff; padding: 6px;
                                      box-sizing: border-box;
                                      box-shadow: 0 10px 30px rgba(0,0,0,.35);
                                      animation: lgFloat 5s ease-in-out infinite; }
        #login-page .lg-brand-name  { font-size: 17px; font-weight: 700; letter-spacing: .01em; }
        #login-page .lg-brand-sub   { font-size: 11px; font-weight: 600; letter-spacing: .22em;
                                      text-transform: uppercase; color: #8FB6E4; margin-top: 3px; }

        #login-page .lg-brand-mid   { max-width: 460px; }
        #login-page .lg-greeting    { display: inline-flex; align-items: center; gap: 8px;
                                      font-size: 11.5px; font-weight: 600; letter-spacing: .04em;
                                      color: #B8D3F2; background: rgba(255,255,255,.08);
                                      border: 1px solid rgba(255,255,255,.14);
                                      padding: 6px 12px; border-radius: 999px; margin-bottom: 18px;
                                      animation: lgFadeUp .6s cubic-bezier(.16,1,.3,1) .1s both; }
        #login-page .lg-dot         { width: 6px; height: 6px; border-radius: 50%;
                                      background: #4ADE80; box-shadow: 0 0 0 3px rgba(74,222,128,.22); }
        #login-page .lg-headline    { font-size: 34px; line-height: 1.18; font-weight: 700;
                                      margin: 0 0 12px; letter-spacing: -.01em;
                                      animation: lgFadeUp .6s cubic-bezier(.16,1,.3,1) .18s both; }
        #login-page .lg-headline em { font-style: normal;
                                      background: linear-gradient(90deg, #6BB0F5, #FF6B78);
                                      -webkit-background-clip: text; background-clip: text;
                                      -webkit-text-fill-color: transparent; }
        /* ── Animated scene ─────────────────────────────────────────────
              A mini dashboard that keeps re-reporting itself, a column of
              status pills, and a conveyor clearing stock underneath. Carries
              the panel on its own, so there is no feature copy to read. */
        #login-page .lg-stage       { max-width: 460px; margin: 26px 0 18px;
                                      animation: lgFadeIn .7s ease-out .32s both; }
        #login-page .lg-stage-top   { display: flex; align-items: center; gap: 16px; }

        #login-page .lg-mock        { flex: 1 1 262px; max-width: 278px; border-radius: 14px;
                                      overflow: hidden; background: rgba(8,26,50,.72);
                                      border: 1px solid rgba(143,196,250,.20);
                                      box-shadow: 0 22px 48px rgba(0,0,0,.40);
                                      animation: lgBob 6.5s ease-in-out infinite; }
        #login-page .lg-mock-bar    { display: flex; align-items: center; gap: 5px;
                                      padding: 10px 12px; background: rgba(255,255,255,.05);
                                      border-bottom: 1px solid rgba(143,196,250,.14); }
        #login-page .lg-mock-bar i  { width: 7px; height: 7px; border-radius: 50%; flex: none; }
        #login-page .lg-mock-bar i:nth-child(1) { background: #FF6B78; }
        #login-page .lg-mock-bar i:nth-child(2) { background: #F5C24B; }
        #login-page .lg-mock-bar i:nth-child(3) { background: #4ADE80; }
        #login-page .lg-mock-bar b  { flex: 1; height: 6px; margin-left: 6px; border-radius: 3px;
                                      background: linear-gradient(90deg, rgba(143,196,250,.10),
                                        rgba(143,196,250,.45) 45%, rgba(143,196,250,.10));
                                      background-size: 220% 100%;
                                      animation: lgShimmer 2.6s linear infinite; }

        #login-page .lg-trend       { display: block; width: 100%; height: 62px; }
        #login-page .lg-trend-line  { fill: none; stroke: #6BB0F5; stroke-width: 2.4;
                                      stroke-linecap: round; stroke-linejoin: round;
                                      stroke-dasharray: 260;
                                      filter: drop-shadow(0 0 6px rgba(107,176,245,.55));
                                      animation: lgDraw 5.6s ease-in-out infinite; }
        #login-page .lg-trend circle{ fill: #FF6B78; opacity: 0;
                                      transform-box: fill-box; transform-origin: center;
                                      animation: lgPop 5.6s ease-in-out infinite; }
        #login-page .lg-trend circle:nth-of-type(1) { animation-delay: .35s; }
        #login-page .lg-trend circle:nth-of-type(2) { animation-delay: .70s; }
        #login-page .lg-trend circle:nth-of-type(3) { animation-delay: 1.05s; }
        #login-page .lg-trend circle:nth-of-type(4) { animation-delay: 1.40s; }
        #login-page .lg-trend circle:nth-of-type(5) { animation-delay: 1.75s; }

        #login-page .lg-bars        { display: flex; align-items: flex-end; gap: 6px;
                                      height: 46px; padding: 0 12px 12px; }
        #login-page .lg-bars i      { flex: 1; height: 100%; border-radius: 4px 4px 2px 2px;
                                      transform: scaleY(.55); transform-origin: bottom;
                                      background: linear-gradient(180deg, #6BB0F5, #0150AA);
                                      animation: lgBarGrow 3.4s ease-in-out infinite; }
        #login-page .lg-bars i:nth-child(1) { animation-delay: 0s; }
        #login-page .lg-bars i:nth-child(2) { animation-delay: .16s; }
        #login-page .lg-bars i:nth-child(3) { animation-delay: .32s; }
        #login-page .lg-bars i:nth-child(4) { animation-delay: .48s; }
        #login-page .lg-bars i:nth-child(5) { animation-delay: .64s; }
        #login-page .lg-bars i:nth-child(6) { animation-delay: .80s; }
        #login-page .lg-bars i:nth-child(7) { animation-delay: .96s; }

        #login-page .lg-chips       { display: flex; flex-direction: column; gap: 9px; }
        #login-page .lg-chip        { display: inline-flex; align-items: center; gap: 8px;
                                      padding: 7px 12px; border-radius: 999px; white-space: nowrap;
                                      font-size: 11.5px; font-weight: 600; color: #E6EDF6;
                                      background: rgba(255,255,255,.09);
                                      border: 1px solid rgba(255,255,255,.15);
                                      box-shadow: 0 10px 24px rgba(0,0,0,.28);
                                      opacity: 0; animation: lgChip 5.4s ease-in-out infinite; }
        #login-page .lg-chip i      { width: 7px; height: 7px; border-radius: 50%; flex: none; }
        #login-page .lg-chip:nth-child(1) { animation-delay: .5s; }
        #login-page .lg-chip:nth-child(2) { animation-delay: 2.3s; }
        #login-page .lg-chip:nth-child(3) { animation-delay: 4.1s; }

        #login-page .lg-belt        { position: relative; height: 58px; margin-top: 20px;
                                      overflow: hidden; }
        #login-page .lg-belt-line   { position: absolute; left: 0; right: 0; bottom: 10px;
                                      height: 3px; border-radius: 3px;
                                      background: repeating-linear-gradient(90deg,
                                        rgba(143,196,250,.50) 0 13px, transparent 13px 26px);
                                      /* Fade both ends so the belt reads as running past
                                         the panel rather than stopping mid-air. */
                                      mask-image: linear-gradient(90deg, transparent, #000 12%, #000 82%, transparent);
                                      -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 82%, transparent);
                                      animation: lgBelt .85s linear infinite; }
        #login-page .lg-crate       { position: absolute; bottom: 13px; left: -52px;
                                      width: 36px; height: 32px; border-radius: 6px;
                                      background: linear-gradient(155deg, #D0975A, #A96F35 55%, #8A5828);
                                      border: 1px solid rgba(0,0,0,.28);
                                      box-shadow: 0 7px 16px rgba(0,0,0,.38);
                                      animation: lgRide 7.8s linear infinite; }
        #login-page .lg-crate::after{ content: ''; position: absolute; left: 50%; top: 0; bottom: 0;
                                      width: 5px; margin-left: -2.5px;
                                      background: rgba(255,255,255,.22); }
        #login-page .lg-crate-2     { animation-delay: 2.6s; }
        #login-page .lg-crate-3     { animation-delay: 5.2s; }
        #login-page .lg-tick        { position: absolute; top: -12px; right: -10px;
                                      width: 21px; height: 21px; border-radius: 50%;
                                      display: flex; align-items: center; justify-content: center;
                                      background: #22C55E; color: #06280F;
                                      font-size: 12px; font-weight: 800; font-style: normal;
                                      box-shadow: 0 5px 14px rgba(34,197,94,.55);
                                      opacity: 0; animation: lgStamp 7.8s ease-in-out infinite; }
        #login-page .lg-crate-2 .lg-tick { animation-delay: 2.6s; }
        #login-page .lg-crate-3 .lg-tick { animation-delay: 5.2s; }

        /* The third "crate" is a mug — the one item on the belt nobody logged. */
        #login-page .lg-mug         { width: 30px; height: 30px; border-radius: 5px 5px 11px 11px;
                                      background: linear-gradient(160deg, #FFFFFF, #D6E2F0);
                                      border: 1px solid rgba(255,255,255,.55); }
        #login-page .lg-mug::before { content: ''; position: absolute; left: 4px; right: 4px; top: 4px;
                                      height: 6px; border-radius: 3px; background: #5A3A22; }
        #login-page .lg-mug::after  { content: ''; position: absolute;
                                      left: auto; right: -9px; top: 8px; bottom: auto;
                                      width: 11px; height: 13px; margin: 0; background: none;
                                      border: 2.5px solid #E4ECF6; border-left: none;
                                      border-radius: 0 8px 8px 0; }
        #login-page .lg-mug .lg-tick{ left: -11px; right: auto; }
        #login-page .lg-steam       { position: absolute; bottom: 31px; width: 3px; height: 11px;
                                      border-radius: 3px; background: rgba(255,255,255,.6);
                                      filter: blur(1.5px); opacity: 0;
                                      animation: lgSteam 2.4s ease-in-out infinite; }
        #login-page .lg-steam:nth-of-type(1) { left: 5px;  animation-delay: 0s; }
        #login-page .lg-steam:nth-of-type(2) { left: 12px; animation-delay: .45s; }
        #login-page .lg-steam:nth-of-type(3) { left: 19px; animation-delay: .90s; }

        #login-page .lg-quip        { position: relative; height: 22px; margin: 0 0 30px;
                                      font-size: 13px; color: #A9C4E4; }
        #login-page .lg-quip span   { position: absolute; left: 0; top: 0; white-space: nowrap;
                                      opacity: 0;
                                      animation: lgQuip ${QUIP_CYCLE}s ease-in-out infinite; }
        #login-page .lg-quip span:first-child { opacity: 1; }

        #login-page .lg-brand-foot  { display: flex; align-items: center; gap: 10px;
                                      font-size: 11px; color: #7E97B5;
                                      animation: lgFadeUp .6s cubic-bezier(.16,1,.3,1) .5s both; }
        #login-page .lg-brand-foot .lg-rule { flex: 1; height: 1px;
                                      background: linear-gradient(90deg, rgba(255,255,255,.16), transparent); }

        /* ── Form side ──────────────────────────────────────────────── */
        #login-page .lg-panel {
          position: relative;
          flex: 1 1 46%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          box-sizing: border-box;
          background: var(--surface);
        }
        #login-page .lg-theme-btn {
          position: absolute; top: 20px; right: 20px;
          width: 34px; height: 34px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          background: var(--surface-alt); color: var(--text-secondary);
          border: 1px solid var(--border-base); cursor: pointer;
          transition: color .15s, border-color .15s, transform .15s;
        }
        #login-page .lg-theme-btn:hover { color: var(--color-primary-strong);
                                          border-color: var(--color-primary); transform: translateY(-1px); }

        #login-page .login-card { width: 100%; max-width: 24rem;
                                  animation: lgFadeUp .55s cubic-bezier(.16,1,.3,1) .12s both; }
        #login-page .lg-mobile-brand { display: none; }

        #login-page .lg-field { animation: lgFadeUp .5s cubic-bezier(.16,1,.3,1) both; }
        #login-page .lg-field:nth-of-type(1) { animation-delay: .20s; }
        #login-page .lg-field:nth-of-type(2) { animation-delay: .26s; }
        #login-page .lg-field:nth-of-type(3) { animation-delay: .32s; }

        #login-page .login-input { transition: border-color .15s, box-shadow .15s, background .15s; outline: none; }
        #login-page .login-input:focus {
          border-color: var(--color-primary) !important;
          box-shadow: 0 0 0 3px var(--color-primary-ring) !important;
        }
        /* Icon picks up the brand colour while the field is focused */
        #login-page .lg-input-wrap:focus-within .lg-input-icon { color: var(--color-primary-strong); }

        #login-page .login-submit {
          position: relative; overflow: hidden;
          transition: transform .15s, box-shadow .15s, opacity .15s;
        }
        #login-page .login-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 30px var(--color-primary-ring) !important;
        }
        #login-page .login-submit:active:not(:disabled) { transform: translateY(0); }
        /* Light sweep across the button on hover */
        #login-page .login-submit::after {
          content: ''; position: absolute; top: 0; left: -60%; width: 45%; height: 100%;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,.28), transparent);
          transform: skewX(-18deg); pointer-events: none;
        }
        #login-page .login-submit:hover:not(:disabled)::after { animation: lgSheen .9s ease-out; }
        #login-page .login-spinner { animation: lgSpin .7s linear infinite; }

        /* ── Tablet / mobile ────────────────────────────────────────── */
        @media (max-width: 1023px) {
          #login-page .lg-brand    { display: none; }
          #login-page .lg-panel    {
            flex: 1 1 100%;
            background:
              radial-gradient(ellipse at 20% -10%, rgba(1,80,170,.16) 0%, transparent 55%),
              radial-gradient(ellipse at 90% 105%, rgba(223,4,25,.10) 0%, transparent 55%),
              var(--surface);
          }
          #login-page .lg-mobile-brand {
            display: flex; flex-direction: column; align-items: center;
            gap: 10px; margin-bottom: 22px; text-align: center;
          }
          #login-page .lg-mobile-logo {
            width: 62px; height: 62px; border-radius: 17px; object-fit: contain;
            background: #fff; padding: 6px; box-sizing: border-box;
            box-shadow: 0 10px 30px rgba(1,80,170,.28);
            animation: lgFloat 5s ease-in-out infinite;
          }
        }
        @media (max-width: 1279px) and (min-width: 1024px) {
          #login-page .lg-brand   { padding: 36px 38px; }
          #login-page .lg-headline{ font-size: 28px; }
        }

        /* With motion off the scene still has to read as a scene, so everything
           the keyframes would have revealed gets a sane resting state. */
        @media (prefers-reduced-motion: reduce) {
          #login-page * { animation: none !important; transition: none !important; }
          #login-page .lg-chip,
          #login-page .lg-tick,
          #login-page .lg-trend circle { opacity: 1; }
          #login-page .lg-steam        { display: none; }
          #login-page .lg-trend-line   { stroke-dasharray: none; }
          #login-page .lg-bars i       { transform: scaleY(.7); }
          #login-page .lg-bars i:nth-child(even) { transform: scaleY(.95); }
          #login-page .lg-crate-1      { left: 6%; }
          #login-page .lg-crate-2      { left: 42%; }
          #login-page .lg-crate-3      { left: 76%; }
        }
      </style>

      <div class="lg-wrap">

        <!-- ════════ Brand side ════════ -->
        <aside class="lg-brand">
          <span class="lg-blob lg-blob-1"></span>
          <span class="lg-blob lg-blob-2"></span>
          <span class="lg-blob lg-blob-3"></span>
          <span class="lg-grid"></span>

          <div class="lg-brand-top">
            <img src="/logo.png" alt="Lallubhai Amichand" class="lg-brand-logo"
                 onerror="this.style.visibility='hidden';" />
            <div>
              <div class="lg-brand-name">Lallubhai Amichand</div>
              <div class="lg-brand-sub">ERP Workspace</div>
            </div>
          </div>

          <div class="lg-brand-mid">
            <div class="lg-greeting">
              <span class="lg-dot"></span>
              ${greeting} &middot; ${dateStr}
            </div>

            <h2 class="lg-headline">
              Ek jagah par<br/><em>poora business</em> control.
            </h2>

            <!-- Decorative only — the screen reader gets the headline and the form. -->
            <div class="lg-stage" aria-hidden="true">
              <div class="lg-stage-top">

                <div class="lg-mock">
                  <div class="lg-mock-bar"><i></i><i></i><i></i><b></b></div>
                  <svg class="lg-trend" viewBox="0 0 260 62">
                    <path class="lg-trend-line" d="M10 50 L60 38 L110 44 L160 22 L210 28 L250 8"/>
                    <circle cx="60"  cy="38" r="3.2"/>
                    <circle cx="110" cy="44" r="3.2"/>
                    <circle cx="160" cy="22" r="3.2"/>
                    <circle cx="210" cy="28" r="3.2"/>
                    <circle cx="250" cy="8"  r="3.2"/>
                  </svg>
                  <div class="lg-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
                </div>

                <div class="lg-chips">
                  <span class="lg-chip"><i style="background:#4ADE80;"></i>Task closed</span>
                  <span class="lg-chip"><i style="background:#6BB0F5;"></i>GRN posted</span>
                  <span class="lg-chip"><i style="background:#FF6B78;"></i>PI approved</span>
                </div>

              </div>

              <div class="lg-belt">
                <span class="lg-belt-line"></span>
                <span class="lg-crate lg-crate-1"><i class="lg-tick">&#x2713;</i></span>
                <span class="lg-crate lg-crate-2"><i class="lg-tick">&#x2713;</i></span>
                <span class="lg-crate lg-crate-3 lg-mug">
                  <span class="lg-steam"></span>
                  <span class="lg-steam"></span>
                  <span class="lg-steam"></span>
                  <i class="lg-tick">&#x2713;</i>
                </span>
              </div>
            </div>

            <p class="lg-quip">${quipsHtml}</p>
          </div>

          <div class="lg-brand-foot">
            <span>Grow Your Business</span>
            <span class="lg-rule"></span>
            <span>&copy; ${now.getFullYear()} Lallubhai Amichand</span>
          </div>
        </aside>

        <!-- ════════ Form side ════════ -->
        <main class="lg-panel">

          <button type="button" class="lg-theme-btn" id="login-theme-btn" aria-label="Toggle theme"></button>

          <div class="login-card">

            <!-- Compact brand block, mobile only (the panel above is hidden there) -->
            <div class="lg-mobile-brand">
              <img src="/logo.png" alt="Lallubhai Amichand" class="lg-mobile-logo"
                   onerror="this.style.display='none';" />
              <div>
                <div style="font-size:15px;font-weight:700;color:var(--text-primary);">Lallubhai Amichand</div>
                <div style="font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--color-primary-strong);margin-top:3px;">ERP Workspace</div>
              </div>
            </div>

            <div class="card" style="
              background: var(--surface);
              border-radius: var(--radius-2xl);
              padding: 2rem 1.9rem;
              box-shadow: var(--shadow-xl);
              border: 1px solid var(--border-base);
            ">

              <!-- Header -->
              <div style="margin-bottom: 1.5rem;">
                <h1 style="font-size: 1.4rem; font-weight: 700; color: var(--text-primary); margin: 0 0 5px;">
                  Welcome back &#x1F44B;
                </h1>
                <p style="font-size: 12.5px; color: var(--text-secondary); margin: 0;">
                  Sign in to continue to your workspace
                </p>
              </div>

              <!-- Form -->
              <form id="login-form" style="display: flex; flex-direction: column; gap: 1rem;">

                <!-- Email -->
                <div class="lg-field">
                  <label class="label" style="margin-bottom:6px;">Email Address</label>
                  <div class="lg-input-wrap" style="position: relative;">
                    <span class="lg-input-icon" style="
                      position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                      color: var(--text-muted); display: flex; pointer-events: none;
                      transition: color .15s;
                    ">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                      </svg>
                    </span>
                    <input
                      id="login-email"
                      class="input login-input"
                      type="text"
                      required
                      placeholder="Enter your email or ID"
                      autocomplete="off"
                      readonly
                      onfocus="this.removeAttribute('readonly')"
                      style="padding-left: 36px; border-radius: 10px;"
                    />
                  </div>
                </div>

                <!-- Name (only shown when the email is shared by more than one account) -->
                <div class="lg-field" id="login-name-field" style="display:none;">
                  <label class="label" style="margin-bottom:6px;">Full Name</label>
                  <div class="lg-input-wrap" style="position: relative;">
                    <span class="lg-input-icon" style="
                      position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                      color: var(--text-muted); display: flex; pointer-events: none;
                      transition: color .15s;
                    ">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    <input
                      id="login-name"
                      class="input login-input"
                      type="text"
                      placeholder="Enter your full name"
                      autocomplete="off"
                      style="padding-left: 36px; border-radius: 10px;"
                    />
                  </div>
                  <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0;">Multiple accounts use this email — enter your name to continue.</p>
                </div>

                <!-- Password -->
                <div class="lg-field">
                  <label class="label" style="margin-bottom:6px;">Password</label>
                  <div class="lg-input-wrap" style="position: relative;">
                    <span class="lg-input-icon" style="
                      position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                      color: var(--text-muted); display: flex; pointer-events: none;
                      transition: color .15s;
                    ">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                    </span>
                    <input
                      id="login-password"
                      class="input login-input"
                      type="password"
                      required
                      placeholder="Enter your password"
                      autocomplete="new-password"
                      readonly
                      onfocus="this.removeAttribute('readonly')"
                      style="padding-left: 36px; padding-right: 42px; border-radius: 10px;"
                    />
                    <button
                      type="button"
                      id="login-toggle-pass"
                      style="
                        position: absolute; right: 11px; top: 50%; transform: translateY(-50%);
                        background: none; border: none; cursor: pointer; color: var(--text-muted);
                        display: flex; padding: 2px;
                      "
                      aria-label="Toggle password visibility"
                    >
                      <!-- Eye icon (show password) — toggled by JS -->
                      <svg id="login-eye-show" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                      </svg>
                      <svg id="login-eye-hide" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- Error message -->
                <p id="login-error" style="
                  display: none;
                  color: var(--color-danger-text); font-size: 12px; text-align: center; margin: 0;
                  background: var(--color-danger-bg); padding: 8px 12px; border-radius: 8px;
                "></p>

                <!-- Submit -->
                <button
                  type="submit"
                  id="login-submit"
                  class="btn-primary btn-lg login-submit"
                  style="
                    width: 100%;
                    box-shadow: 0 4px 20px var(--color-primary-ring);
                    letter-spacing: 0.02em;
                    margin-top: 4px;
                  "
                >
                  <span id="login-btn-text">Sign In <span style="font-size:16px;">&#x2192;</span></span>
                  <span id="login-btn-loading" style="display:none; align-items:center; gap:8px;">
                    <svg class="login-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    Signing in&hellip;
                  </span>
                </button>
              </form>

              <!-- Footer -->
              <div style="text-align: center; margin-top: 1.4rem;">
                <div style="
                  width: 100%; height: 1px;
                  background: linear-gradient(90deg, transparent, var(--border-base), transparent);
                  margin-bottom: 0.9rem;
                "></div>
                <p style="font-size: 11px; color: var(--text-muted); margin: 0;">
                  <span style="color: var(--color-primary-strong); font-weight: 600; letter-spacing: 0.05em;">Lallubhai Amichand</span>
                  <span style="margin: 0 6px; color: var(--border-strong);">&middot;</span>
                  <span>Grow Your Business</span>
                </p>
              </div>

            </div>
          </div>
        </main>
      </div>
    `;

    // ── Wire up interactivity ────────────────────────────────────────────────

    const form        = el.querySelector('#login-form');
    const emailInput  = el.querySelector('#login-email');
    const nameField   = el.querySelector('#login-name-field');
    const nameInput   = el.querySelector('#login-name');
    const passInput   = el.querySelector('#login-password');
    const toggleBtn   = el.querySelector('#login-toggle-pass');
    const eyeShow     = el.querySelector('#login-eye-show');
    const eyeHide     = el.querySelector('#login-eye-hide');
    const errorEl     = el.querySelector('#login-error');
    const submitBtn   = el.querySelector('#login-submit');
    const btnText     = el.querySelector('#login-btn-text');
    const btnLoading  = el.querySelector('#login-btn-loading');
    const themeBtn    = el.querySelector('#login-theme-btn');

    // Theme toggle — same light/dark switch the topbar carries inside the app.
    if (themeBtn && window.Theme) {
      const paintThemeIcon = () => {
        themeBtn.innerHTML = window.Theme.current() === 'dark'
          ? window.Theme.SUN_ICON
          : window.Theme.MOON_ICON;
      };
      paintThemeIcon();
      themeBtn.addEventListener('click', () => { window.Theme.toggle(); paintThemeIcon(); });
    } else if (themeBtn) {
      themeBtn.style.display = 'none';
    }

    // Force-clear fields after Chrome autofill (runs after browser fills them)
    setTimeout(() => { if (emailInput) emailInput.value = ''; if (passInput) passInput.value = ''; }, 200);

    // Show/hide password toggle
    toggleBtn.addEventListener('click', () => {
      const isPassword = passInput.type === 'password';
      passInput.type   = isPassword ? 'text' : 'password';
      eyeShow.style.display = isPassword ? 'none'  : '';
      eyeHide.style.display = isPassword ? ''      : 'none';
    });

    // Helper: set loading state
    function setLoading(on) {
      submitBtn.disabled          = on;
      submitBtn.style.boxShadow   = on ? 'none' : '0 4px 20px var(--color-primary-ring)';
      btnText.style.display       = on ? 'none'  : '';
      btnLoading.style.display    = on ? 'flex'  : 'none';
    }

    // Helper: show error
    function showError(msg) {
      errorEl.textContent    = msg;
      errorEl.style.display  = msg ? 'block' : 'none';
    }

    // Form submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      setLoading(true);

      const email    = emailInput.value.trim();
      const password = passInput.value;
      const name     = nameInput.value.trim();

      try {
        const raw = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(name ? { email, password, name } : { email, password }),
        });
        const json = await raw.json();
        if (!raw.ok) {
          if (json.needsName && nameField.style.display === 'none') {
            nameField.style.display = '';
            nameInput.focus();
            showError(json.error || 'Multiple accounts use this email — please also enter your name.');
            setLoading(false);
            return;
          }
          throw new Error(json.error || 'Invalid email or password');
        }

        const data = json;

        window.currentUser = data.user;

        // Show app shell, hide login page
        const appShell = document.getElementById('app-shell');
        if (appShell) appShell.style.display = 'flex';
        el.style.display = 'none';

        // Bootstrap app
        if (window.Sidebar)  window.Sidebar.render(data.user);
        if (window.Topbar)   window.Topbar.render(data.user);
        if (window.Router) {
          window.Router.init();
          window.Router.navigate('dashboard');
        }

      } catch (err) {
        showError(err && err.message ? err.message : 'Invalid email or password');
        setLoading(false);
      }
    });
  },
};
