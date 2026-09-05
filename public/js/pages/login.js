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
    const QUIP_CYCLE = 14; // seconds for the full rotation — must match the lgQuip duration in css/login.css

    const quipsHtml = QUIPS.map((q, i) => `
      <span style="animation-delay:${(i * QUIP_CYCLE / QUIPS.length).toFixed(2)}s;">${q}</span>
    `).join('');

    el.innerHTML = `

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

    // The mascot reacts as each field takes focus.
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
        safe(() => replay(flowerEl, 'bloom'));
        setTimeout(enterApp, 1150);

      } catch (err) {
        const failMsg = err && err.message ? err.message : 'Invalid email or password';
        showError(failMsg);
        setLoading(false);
        mood('angry');
        safe(() => replay(cardEl, 'lg-shake', 700));
        // Sulk for a moment, then go back to watching over the form.
        setTimeout(() => mood(passInput === document.activeElement ? 'shy' : null), 1700);
      }
    });
  },
};
