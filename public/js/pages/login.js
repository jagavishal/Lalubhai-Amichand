window.Pages = window.Pages || {};

window.Pages.login = {
  render() {
    const el = document.getElementById('login-page');
    if (!el) return;

    el.innerHTML = `
      <style>
        @keyframes loginFloat {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          33%       { transform: translateY(-12px) rotate(-2deg); }
          66%       { transform: translateY(-6px) rotate(2deg); }
        }
        @keyframes loginPulse {
          0%, 100% { box-shadow: 0 8px 32px rgba(196,113,74,0.25); }
          50%       { box-shadow: 0 16px 48px rgba(196,113,74,0.45); }
        }
        @keyframes loginFadeSlide {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes loginSpin {
          to { transform: rotate(360deg); }
        }
        #login-page .login-card {
          animation: loginFadeSlide 0.5s cubic-bezier(0.16,1,0.3,1) both;
        }
        #login-page .login-input:focus {
          border-color: var(--color-primary) !important;
          box-shadow: 0 0 0 3px var(--color-primary-ring) !important;
          outline: none;
        }
        #login-page .login-input {
          outline: none;
        }
        #login-page .login-submit:hover:not(:disabled) {
          opacity: 0.9;
          box-shadow: 0 6px 28px rgba(196,113,74,0.45) !important;
        }
        #login-page .login-spinner {
          animation: loginSpin 0.7s linear infinite;
        }
      </style>

      <div style="
        width: 100%;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        box-sizing: border-box;
        background: radial-gradient(ellipse at 25% 60%, #F5C97A 0%, #FDEBC8 35%, #FDF6ED 65%, #FFFBF5 100%);
      ">
        <div class="login-card" style="width: 100%; max-width: 23rem;">

          <!-- Card -->
          <div class="card" style="
            background: var(--surface);
            border-radius: var(--radius-2xl);
            padding: 2.25rem 2rem;
            box-shadow: var(--shadow-xl);
            border: none;
          ">

            <!-- Header / Logo area -->
            <div style="text-align: center; margin-bottom: 1.75rem;">

              <!-- Animated brand logo -->
              <div style="display:flex;justify-content:center;margin-bottom:14px;">
                <div style="animation: loginFloat 3.5s ease-in-out infinite;">
                  <img src="/logo.png" alt="Logo"
                    style="width:72px;height:72px;border-radius:18px;object-fit:contain;box-shadow:0 8px 32px rgba(196,113,74,0.3);"
                    onerror="this.style.display='none';document.getElementById('login-fallback-icon').style.display='flex';"
                  />
                  <div id="login-fallback-icon" style="display:none;width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,#C4714A,#D4895A);align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(196,113,74,0.3);">
                    <svg width="40" height="40" viewBox="0 0 28 28" fill="none">
                      <path d="M7 20V10l7-4 7 4v10" stroke="rgba(255,255,255,0.8)" stroke-width="1.8" stroke-linejoin="round"/>
                      <path d="M11 20v-5h6v5" stroke="rgba(255,255,255,0.8)" stroke-width="1.8" stroke-linejoin="round"/>
                      <path d="M4 12l10-6 10 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Brand name -->
              <div style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--color-primary);margin-bottom:8px;">Lallubhai Amichand</div>

              <h1 style="font-size: 1.35rem; font-weight: 700; color: var(--text-primary); margin: 0 0 4px;">
                Welcome back &#x1F44B;
              </h1>
              <p style="font-size: 12.5px; color: var(--text-muted); margin: 0;">
                Sign in to your account
              </p>
            </div>

            <!-- Form -->
            <form id="login-form" style="display: flex; flex-direction: column; gap: 1rem;">

              <!-- Email -->
              <div>
                <label class="label" style="margin-bottom:6px;">Email Address</label>
                <div style="position: relative;">
                  <span style="
                    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                    color: var(--text-muted); display: flex; pointer-events: none;
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

              <!-- Password -->
              <div>
                <label class="label" style="margin-bottom:6px;">Password</label>
                <div style="position: relative;">
                  <span style="
                    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                    color: var(--text-muted); display: flex; pointer-events: none;
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
            <div style="text-align: center; margin-top: 1.5rem;">
              <div style="
                width: 100%; height: 1px;
                background: linear-gradient(90deg, transparent, var(--border-base), transparent);
                margin-bottom: 1rem;
              "></div>
              <p style="font-size: 11px; color: var(--text-muted); margin: 0;">
                <span style="color: var(--color-primary); font-weight: 600; letter-spacing: 0.05em;">Lallubhai Amichand</span>
                <span style="margin: 0 6px; color: var(--border-strong);">&middot;</span>
                <span style="color: var(--text-muted);">Grow Your Business</span>
              </p>
            </div>

          </div>
        </div>
      </div>
    `;

    // ── Wire up interactivity ────────────────────────────────────────────────

    const form        = el.querySelector('#login-form');
    const emailInput  = el.querySelector('#login-email');
    const passInput   = el.querySelector('#login-password');
    const toggleBtn   = el.querySelector('#login-toggle-pass');
    const eyeShow     = el.querySelector('#login-eye-show');
    const eyeHide     = el.querySelector('#login-eye-hide');
    const errorEl     = el.querySelector('#login-error');
    const submitBtn   = el.querySelector('#login-submit');
    const btnText     = el.querySelector('#login-btn-text');
    const btnLoading  = el.querySelector('#login-btn-loading');

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

      try {
        let res;
        if (window.Utils && window.Utils.apiFetch) {
          const raw = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const json = await raw.json();
          if (!raw.ok) throw new Error(json.error || 'Invalid email or password');
          res = json;
        } else {
          const raw = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const json = await raw.json();
          if (!raw.ok) throw new Error(json.error || 'Invalid email or password');
          res = json;
        }

        const data = res;

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
