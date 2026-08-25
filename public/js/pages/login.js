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

        /* ── Mascot animations ──────────────────────────────────────── */
        @keyframes lgMBob     { 0%, 100% { transform: translateY(0) rotate(0deg); }
                                50%      { transform: translateY(-3px) rotate(1.5deg); } }
        @keyframes lgMBlink   { 0%, 90%, 100% { transform: scaleY(1); }
                                95%           { transform: scaleY(.08); } }
        @keyframes lgMCheer   { 0%, 100% { transform: translateY(0) rotate(0deg); }
                                35%      { transform: translateY(-11px) rotate(-6deg); }
                                70%      { transform: translateY(-4px) rotate(5deg); } }
        @keyframes lgMHuff    { 0%, 100% { transform: translateX(0) rotate(0deg); }
                                25%      { transform: translateX(-5px) rotate(-4deg); }
                                75%      { transform: translateX(5px) rotate(4deg); } }
        @keyframes lgBloom    { 0%   { opacity: 0; transform: translate(0,0) rotate(0deg) scale(.3); }
                                15%, 68% { opacity: 1; }
                                100% { opacity: 0;
                                       transform: translate(var(--dx,0), var(--dy,-80px))
                                                  rotate(var(--rot,0deg)) scale(1.1); } }
        @keyframes lgVein     { 0%, 100% { transform: scale(1); }
                                50%      { transform: scale(1.3); } }
        @keyframes lgShake    { 10%, 90% { transform: translateX(-2px); }
                                20%, 80% { transform: translateX(4px); }
                                30%, 50%, 70% { transform: translateX(-7px); }
                                40%, 60% { transform: translateX(7px); } }

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
        #login-page .lg-foot-sep    { color: #5B7A99; }
        #login-page .lg-powered     { color: #8FB6E4; }
        #login-page .lg-powered b   { font-weight: 700; color: #C6DDF7; }
        #login-page .lg-powered-sm  { margin: 6px 0 0; font-size: 10.5px;
                                      color: var(--text-muted); letter-spacing: .02em; }
        #login-page .lg-powered-sm b{ font-weight: 700; color: var(--text-secondary); }
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

        /* Voice toggle — sits to the left of the theme switch. */
        @keyframes lgVoicePulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--color-primary-ring); }
          50%      { box-shadow: 0 0 0 6px transparent; }
        }
        #login-page .lg-voice-btn {
          position: absolute; top: 20px; right: 62px;
          width: 34px; height: 34px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          background: var(--surface-alt); color: var(--text-secondary);
          border: 1px solid var(--border-base); cursor: pointer;
          transition: color .15s, border-color .15s, transform .15s, opacity .15s;
        }
        #login-page .lg-voice-btn:hover { color: var(--color-primary-strong);
                                          border-color: var(--color-primary); transform: translateY(-1px); }
        #login-page .lg-voice-btn.is-muted    { opacity: .55; }
        #login-page .lg-voice-btn.is-speaking { color: var(--color-primary-strong);
                                                border-color: var(--color-primary);
                                                animation: lgVoicePulse 1.1s ease-in-out infinite; }

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

        /* ── Mascot ─────────────────────────────────────────────────────
              Sits behind the card until the user starts signing in, then
              climbs up and rests its hands on the top border. Purely
              decorative: pointer-events are off on every piece of it, so it
              can never sit between the user and the form. */
        #login-page .lg-cardwrap    { position: relative; }
        #login-page .lg-cardwrap > .card { position: relative; z-index: 1; }

        #login-page .lg-mascot      { position: absolute; left: 50%; top: 0;
                                      width: 88px; height: 88px; z-index: 0;
                                      opacity: 0; pointer-events: none;
                                      transform: translate(-50%, 10px) scale(.5);
                                      transition: transform .55s cubic-bezier(.34,1.56,.64,1),
                                                  opacity .3s ease; }
        #login-page .lg-cardwrap.m-show .lg-mascot { opacity: 1;
                                      transform: translate(-50%, -68px) scale(1); }
        #login-page .lg-cardwrap.m-shy  .lg-mascot {
                                      transform: translate(-50%, -78px) scale(1); }

        #login-page .lg-face        { display: block; width: 100%; height: 100%;
                                      filter: drop-shadow(0 10px 18px rgba(0,0,0,.28)); }
        #login-page .lg-cardwrap.m-show   .lg-face { animation: lgMBob 3.4s ease-in-out infinite; }
        #login-page .lg-cardwrap.m-happy  .lg-face { animation: lgMCheer .5s ease-in-out 3; }
        #login-page .lg-cardwrap.m-angry  .lg-face { animation: lgMHuff .32s ease-in-out 4; }

        /* Expressions — every face part is drawn once and cross-faded. */
        #login-page .lg-face .m-head    { fill: #FFC83D; transition: fill .3s ease; }
        #login-page .lg-face .m-swap    { transition: opacity .22s ease; }
        #login-page .lg-face .m-eyes-happy,
        #login-page .lg-face .m-mouth-happy,
        #login-page .lg-face .m-mouth-angry,
        #login-page .lg-face .m-brows,
        #login-page .lg-face .m-blush   { opacity: 0; }
        #login-page .lg-face .m-eyes-open { transform-box: fill-box; transform-origin: center;
                                      animation: lgMBlink 4.6s ease-in-out infinite; }

        #login-page .m-happy .lg-face .m-eyes-open,
        #login-page .m-happy .lg-face .m-mouth-idle { opacity: 0; }
        #login-page .m-happy .lg-face .m-eyes-happy,
        #login-page .m-happy .lg-face .m-mouth-happy,
        #login-page .m-happy .lg-face .m-blush      { opacity: 1; }

        #login-page .m-angry .lg-face .m-mouth-idle { opacity: 0; }
        #login-page .m-angry .lg-face .m-mouth-angry,
        #login-page .m-angry .lg-face .m-brows      { opacity: 1; }
        #login-page .m-angry .lg-face .m-head       { fill: #F6835F; }

        /* Hands gripping the top border — and covering the eyes while a
           password is being typed, because it is none of its business. */
        #login-page .lg-hands       { position: absolute; left: 50%; top: 0;
                                      width: 124px; height: 24px; z-index: 2;
                                      display: flex; justify-content: space-between;
                                      opacity: 0; pointer-events: none;
                                      transform: translate(-50%, 8px);
                                      transition: transform .55s cubic-bezier(.34,1.56,.64,1) .04s,
                                                  width .45s cubic-bezier(.34,1.56,.64,1) .04s,
                                                  opacity .3s ease .04s; }
        #login-page .lg-cardwrap.m-show .lg-hands { opacity: 1;
                                      transform: translate(-50%, -10px); }
        #login-page .lg-cardwrap.m-shy  .lg-hands { width: 76px;
                                      transform: translate(-50%, -46px); }
        #login-page .lg-hand        { width: 34px; height: 24px; flex: none;
                                      filter: drop-shadow(0 5px 10px rgba(0,0,0,.30));
                                      transition: transform .45s cubic-bezier(.34,1.56,.64,1); }
        #login-page .lg-cardwrap.m-shy .lg-hand-l { transform: rotate(16deg); }
        #login-page .lg-cardwrap.m-shy .lg-hand-r { transform: rotate(-16deg); }

        /* Flower burst on a good password. */
        #login-page .lg-flowers     { position: absolute; left: 50%; top: 0;
                                      width: 0; height: 0; z-index: 3; pointer-events: none; }
        #login-page .lg-flower      { position: absolute; left: -11px; top: -74px;
                                      font-size: 22px; line-height: 1; opacity: 0; }
        #login-page .lg-flowers.bloom .lg-flower { animation: lgBloom 1.6s cubic-bezier(.2,.7,.35,1) forwards; }

        /* Anger vein, drawn into the face so it rides along with every
           expression change instead of floating on its own layer. */
        #login-page .lg-face .m-vein { opacity: 0; transform-box: fill-box;
                                      transform-origin: center; }
        #login-page .m-angry .lg-face .m-vein { opacity: 1;
                                      animation: lgVein .45s ease-out 3; }

        #login-page .lg-shake       { animation: lgShake .55s cubic-bezier(.36,.07,.19,.97); }

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
            gap: 10px; margin-bottom: 66px; text-align: center;
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
              One place for<br/><em>complete business</em> control.
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
            <span class="lg-foot-sep">&middot;</span>
            <span class="lg-powered">Powered by <b>E-Marketing</b></span>
          </div>
        </aside>

        <!-- ════════ Form side ════════ -->
        <main class="lg-panel">

          <button type="button" class="lg-voice-btn" id="login-voice-btn" aria-label="Toggle voice alerts" title="Voice alerts"></button>
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

            <div class="lg-cardwrap" id="login-cardwrap">

            <!-- Mascot. Lives behind the card until the user starts signing in.
                 Decorative only — aria-hidden and pointer-events: none. -->
            <div class="lg-mascot" aria-hidden="true">
              <svg class="lg-face" viewBox="0 0 120 120">
                <circle class="m-head" cx="60" cy="58" r="46" stroke="rgba(0,0,0,.10)" stroke-width="2"/>

                <g class="m-eyes-open m-swap" fill="#2A2118">
                  <ellipse cx="44" cy="56" rx="6.5" ry="8"/>
                  <ellipse cx="76" cy="56" rx="6.5" ry="8"/>
                  <circle cx="46.4" cy="52.6" r="2.2" fill="#FFFFFF"/>
                  <circle cx="78.4" cy="52.6" r="2.2" fill="#FFFFFF"/>
                </g>
                <g class="m-eyes-happy m-swap" fill="none" stroke="#2A2118"
                   stroke-width="4.5" stroke-linecap="round">
                  <path d="M36 59 Q44 47 52 59"/>
                  <path d="M68 59 Q76 47 84 59"/>
                </g>
                <g class="m-brows m-swap" stroke="#8A5410" stroke-width="4.6" stroke-linecap="round">
                  <path d="M34 40 L54 48"/>
                  <path d="M86 40 L66 48"/>
                </g>

                <path class="m-mouth-idle  m-swap" d="M47 75 Q60 85 73 75"
                      fill="none" stroke="#2A2118" stroke-width="4" stroke-linecap="round"/>
                <path class="m-mouth-happy m-swap" d="M42 72 Q60 96 78 72 Z" fill="#2A2118"/>
                <path class="m-mouth-angry m-swap" d="M47 85 Q60 73 73 85"
                      fill="none" stroke="#2A2118" stroke-width="4" stroke-linecap="round"/>

                <g class="m-vein m-swap" fill="none" stroke="#A70A18" stroke-width="4.5"
                   stroke-linecap="round" stroke-linejoin="round">
                  <path d="M80 20 L91 31 L102 20"/>
                  <path d="M80 42 L91 31 L102 42"/>
                </g>

                <g class="m-blush m-swap" fill="#FF7A8A" opacity="0">
                  <ellipse cx="29" cy="70" rx="8.5" ry="5.5"/>
                  <ellipse cx="91" cy="70" rx="8.5" ry="5.5"/>
                </g>
              </svg>
            </div>

            <div class="lg-hands" aria-hidden="true">
              <svg class="lg-hand lg-hand-l" viewBox="0 0 34 24">
                <g fill="#FFC83D" stroke="rgba(0,0,0,.10)" stroke-width="1.5">
                  <circle cx="9" cy="9" r="4"/><circle cx="17" cy="7.5" r="4"/><circle cx="25" cy="9" r="4"/>
                  <rect x="3" y="8" width="28" height="13" rx="6"/>
                </g>
              </svg>
              <svg class="lg-hand lg-hand-r" viewBox="0 0 34 24">
                <g fill="#FFC83D" stroke="rgba(0,0,0,.10)" stroke-width="1.5">
                  <circle cx="9" cy="9" r="4"/><circle cx="17" cy="7.5" r="4"/><circle cx="25" cy="9" r="4"/>
                  <rect x="3" y="8" width="28" height="13" rx="6"/>
                </g>
              </svg>
            </div>

            <div class="lg-flowers" id="login-flowers" aria-hidden="true">
              <span class="lg-flower" style="--dx:-104px; --dy:-30px;  --rot:-140deg; animation-delay:.00s;">&#x1F338;</span>
              <span class="lg-flower" style="--dx:-82px;  --dy:-74px;  --rot:-95deg;  animation-delay:.05s;">&#x1F33C;</span>
              <span class="lg-flower" style="--dx:-50px;  --dy:-104px; --rot:-55deg;  animation-delay:.10s;">&#x1F33A;</span>
              <span class="lg-flower" style="--dx:-18px;  --dy:-120px; --rot:-20deg;  animation-delay:.15s;">&#x1F337;</span>
              <span class="lg-flower" style="--dx:0px;    --dy:-128px; --rot:15deg;   animation-delay:.08s;">&#x2728;</span>
              <span class="lg-flower" style="--dx:18px;   --dy:-120px; --rot:20deg;   animation-delay:.15s;">&#x1F338;</span>
              <span class="lg-flower" style="--dx:50px;   --dy:-104px; --rot:55deg;   animation-delay:.10s;">&#x1F490;</span>
              <span class="lg-flower" style="--dx:82px;   --dy:-74px;  --rot:95deg;   animation-delay:.05s;">&#x1F33C;</span>
              <span class="lg-flower" style="--dx:104px;  --dy:-30px;  --rot:140deg;  animation-delay:.00s;">&#x1F337;</span>
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
                <p class="lg-powered-sm">Powered by <b>E-Marketing</b></p>
              </div>

            </div><!-- /.card -->
            </div><!-- /.lg-cardwrap -->
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
    const voiceBtn    = el.querySelector('#login-voice-btn');

    // ── Voice alerts ─────────────────────────────────────────────────────────
    // Speaks the greeting and the sign-in result out loud. Browsers refuse
    // speech before the first user gesture, so the greeting waits for one.
    // Every call is swallowed on failure — a mute browser must never block a
    // login. The on/off choice is remembered per browser.
    const VOICE_KEY = 'lg_login_voice';
    const synth     = window.speechSynthesis || null;

    const SPEAKER_ON_ICON  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M18.36 5.64a9 9 0 0 1 0 12.72"/></svg>';
    const SPEAKER_OFF_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/></svg>';

    let voiceOn = true;
    let greeted = false;
    try { voiceOn = localStorage.getItem(VOICE_KEY) !== 'off'; } catch (_) {}

    // Prefer an Indian-English voice when the platform ships one.
    function pickVoice() {
      if (!synth) return null;
      let list = [];
      try { list = synth.getVoices() || []; } catch (_) { return null; }
      return list.find(v => v.lang === 'en-IN')
          || list.find(v => (v.lang || '').indexOf('en-IN') === 0)
          || list.find(v => (v.lang || '').indexOf('en') === 0)
          || null;
    }

    function say(text) {
      if (!voiceOn || !synth || !text) return;
      try {
        synth.cancel(); // never let two alerts overlap
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice();
        if (v) u.voice = v;
        u.lang    = (v && v.lang) || 'en-IN';
        u.rate    = 1;
        u.pitch   = 1;
        u.volume  = 1;
        u.onstart = () => { if (voiceBtn) voiceBtn.classList.add('is-speaking'); };
        u.onend   = () => { if (voiceBtn) voiceBtn.classList.remove('is-speaking'); };
        u.onerror = u.onend;
        synth.speak(u);
      } catch (_) { /* voice is a nicety, never a blocker */ }
    }

    function paintVoiceIcon() {
      if (!voiceBtn) return;
      voiceBtn.innerHTML = voiceOn ? SPEAKER_ON_ICON : SPEAKER_OFF_ICON;
      voiceBtn.classList.toggle('is-muted', !voiceOn);
      voiceBtn.setAttribute('aria-pressed', String(voiceOn));
      voiceBtn.title = voiceOn ? 'Voice alerts on' : 'Voice alerts off';
    }

    if (voiceBtn && synth) {
      paintVoiceIcon();
      voiceBtn.addEventListener('click', () => {
        voiceOn = !voiceOn;
        try { localStorage.setItem(VOICE_KEY, voiceOn ? 'on' : 'off'); } catch (_) {}
        if (!voiceOn) {
          try { synth.cancel(); } catch (_) {}
          voiceBtn.classList.remove('is-speaking');
        }
        paintVoiceIcon();
        greeted = true; // this click already satisfied the browser gesture rule
        if (voiceOn) say('Voice alerts on.');
      });
      // Voice lists load asynchronously on some browsers.
      try { synth.onvoiceschanged = pickVoice; } catch (_) {}
    } else if (voiceBtn) {
      voiceBtn.style.display = 'none'; // browser has no speech support
    }

    // Greeting — fires once, on the first click or keypress anywhere on the page.
    function greetOnce() {
      if (greeted) return;
      greeted = true;
      say(greeting + '. Welcome to Lallubhai Amichand. Please sign in.');
    }
    if (synth) {
      el.addEventListener('pointerdown', greetOnce, { once: true });
      el.addEventListener('keydown',     greetOnce, { once: true });
    }

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

    // ── Mascot ───────────────────────────────────────────────────────────────
    // It climbs onto the card when the user starts signing in, hides its eyes
    // while the password is typed, and reacts to the result. Every entry point
    // is wrapped in safe() — a broken mascot must never break a login.
    const cardWrap = el.querySelector('#login-cardwrap');
    const flowerEl = el.querySelector('#login-flowers');
    const cardEl   = el.querySelector('#login-cardwrap > .card');

    const safe = (fn) => { try { fn(); } catch (_) { /* decoration only */ } };

    // state: null (perched), 'shy', 'happy', 'angry'
    function setMood(state) {
      if (!cardWrap) return;
      cardWrap.classList.remove('m-shy', 'm-happy', 'm-angry');
      cardWrap.classList.add('m-show');
      if (state) cardWrap.classList.add('m-' + state);
    }
    const mood = (state) => safe(() => setMood(state));

    // Restart a one-shot animation by dropping the class and forcing a reflow.
    function replay(node, cls, clearAfter) {
      if (!node) return;
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
      if (clearAfter) setTimeout(() => node.classList.remove(cls), clearAfter);
    }

    if (emailInput) emailInput.addEventListener('focus', () => mood(null));
    if (nameInput)  nameInput.addEventListener('focus',  () => mood(null));
    if (passInput) {
      passInput.addEventListener('focus', () => mood('shy'));
      passInput.addEventListener('blur',  () => mood(null));
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
            say('Multiple accounts use this email. Please also enter your name.');
            setLoading(false);
            return;
          }
          throw new Error(json.error || 'Invalid email or password');
        }

        const data = json;

        window.currentUser = data.user;

        function enterApp() {
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
        }

        // Let the mascot celebrate for a beat, then go straight in. The timer
        // is unconditional, so the app still opens if the flourish misfires.
        mood('happy');
        const firstName = String((data.user && data.user.name) || '').trim().split(/\s+/)[0];
        say(firstName ? ('Welcome back, ' + firstName + '.') : 'Welcome back.');
        safe(() => replay(flowerEl, 'bloom'));
        setTimeout(enterApp, 1150);

      } catch (err) {
        const failMsg = err && err.message ? err.message : 'Invalid email or password';
        showError(failMsg);
        say('Login failed. ' + failMsg + '.');
        setLoading(false);
        mood('angry');
        safe(() => replay(cardEl, 'lg-shake', 700));
        // Sulk for a moment, then go back to watching over the form.
        setTimeout(() => mood(passInput === document.activeElement ? 'shy' : null), 1700);
      }
    });
  },
};
