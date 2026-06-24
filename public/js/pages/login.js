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
          border-color: #C4714A !important;
          box-shadow: 0 0 0 3px rgba(196,113,74,0.12) !important;
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
          <div style="
            background: #FFFFFF;
            border-radius: 1.5rem;
            padding: 2.25rem 2rem;
            box-shadow: 0 8px 40px rgba(180,120,50,0.12), 0 2px 8px rgba(0,0,0,0.06);
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
              <div style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#C4714A;margin-bottom:8px;">Lallubhai Amichand</div>

              <h1 style="font-size: 1.35rem; font-weight: 700; color: #1e293b; margin: 0 0 4px;">
                Welcome back &#x1F44B;
              </h1>
              <p style="font-size: 12.5px; color: #94a3b8; margin: 0;">
                Sign in to your account
              </p>
            </div>

            <!-- Form -->
            <form id="login-form" style="display: flex; flex-direction: column; gap: 1rem;">

              <!-- Email -->
              <div>
                <label style="
                  display: block; font-size: 10.5px; font-weight: 600;
                  letter-spacing: 0.08em; text-transform: uppercase;
                  color: #64748b; margin-bottom: 6px;
                ">Email Address</label>
                <div style="position: relative;">
                  <span style="
                    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                    color: #94a3b8; display: flex; pointer-events: none;
                  ">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                  </span>
                  <input
                    id="login-email"
                    class="login-input"
                    type="email"
                    required
                    placeholder="Enter your email"
                    autocomplete="email"
                    style="
                      width: 100%; box-sizing: border-box;
                      padding: 10px 12px 10px 36px;
                      background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px;
                      color: #1e293b; font-size: 13px; transition: border-color 0.15s, box-shadow 0.15s;
                    "
                  />
                </div>
              </div>

              <!-- Password -->
              <div>
                <label style="
                  display: block; font-size: 10.5px; font-weight: 600;
                  letter-spacing: 0.08em; text-transform: uppercase;
                  color: #64748b; margin-bottom: 6px;
                ">Password</label>
                <div style="position: relative;">
                  <span style="
                    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                    color: #94a3b8; display: flex; pointer-events: none;
                  ">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    id="login-password"
                    class="login-input"
                    type="password"
                    required
                    placeholder="Enter your password"
                    autocomplete="current-password"
                    style="
                      width: 100%; box-sizing: border-box;
                      padding: 10px 42px 10px 36px;
                      background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px;
                      color: #1e293b; font-size: 13px; transition: border-color 0.15s, box-shadow 0.15s;
                    "
                  />
                  <button
                    type="button"
                    id="login-toggle-pass"
                    style="
                      position: absolute; right: 11px; top: 50%; transform: translateY(-50%);
                      background: none; border: none; cursor: pointer; color: #94a3b8;
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
                color: #ef4444; font-size: 12px; text-align: center; margin: 0;
                background: #fef2f2; padding: 8px 12px; border-radius: 8px;
              "></p>

              <!-- Submit -->
              <button
                type="submit"
                id="login-submit"
                class="login-submit"
                style="
                  width: 100%; padding: 12px;
                  background: linear-gradient(135deg, #C4714A 0%, #D4895A 100%);
                  color: white; font-weight: 700; font-size: 14px;
                  border: none; border-radius: 10px;
                  cursor: pointer;
                  box-shadow: 0 4px 20px rgba(196,113,74,0.35);
                  transition: all 0.15s; letter-spacing: 0.02em;
                  display: flex; align-items: center; justify-content: center; gap: 8px;
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
                background: linear-gradient(90deg, transparent, #E2E8F0, transparent);
                margin-bottom: 1rem;
              "></div>
              <p style="font-size: 11px; color: #94a3b8; margin: 0;">
                <span style="color: #C4714A; font-weight: 600; letter-spacing: 0.05em;">Lallubhai Amichand</span>
                <span style="margin: 0 6px; color: #cbd5e1;">&middot;</span>
                <span style="color: #94a3b8;">Grow Your Business</span>
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
      submitBtn.style.cursor      = on ? 'not-allowed' : 'pointer';
      submitBtn.style.opacity     = on ? '0.8' : '1';
      submitBtn.style.background  = on
        ? '#D4916A'
        : 'linear-gradient(135deg, #C4714A 0%, #D4895A 100%)';
      submitBtn.style.boxShadow   = on ? 'none' : '0 4px 20px rgba(196,113,74,0.35)';
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
        const res  = await (window.Utils && window.Utils.apiFetch
          ? window.Utils.apiFetch('/api/auth/login', {
              method: 'POST',
              body:   JSON.stringify({ email, password }),
            })
          : fetch('/api/auth/login', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ email, password }),
            }).then(async r => {
              if (!r.ok) throw new Error('Invalid email or password');
              return r.json();
            })
        );

        // res is already the parsed JSON when Utils.apiFetch is used
        const data = res && res.user ? res : (res.json ? await res.json() : res);

        window.currentUser = data.user;

        // Show app shell, hide login page
        const appShell = document.getElementById('app-shell');
        if (appShell) appShell.style.display = 'flex';
        el.style.display = 'none';

        // Bootstrap app
        if (window.Sidebar)  window.Sidebar.render(data.user);
        if (window.Topbar)   window.Topbar.render(data.user);
        if (window.Router)   window.Router.init();

      } catch (err) {
        showError(err && err.message ? err.message : 'Invalid email or password');
        setLoading(false);
      }
    });
  },
};
