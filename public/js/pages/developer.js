window.Pages = window.Pages || {};

window.Pages.developer = {
  async render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    // ── State ──────────────────────────────────────────────────────────────────
    let password      = '';
    let showPass      = false;
    let authed        = false;
    let secret        = '';
    let enabled       = null;
    let loading       = false;
    let saving        = false;
    let exporting     = false;
    let confirm       = false;
    let resetOpen     = false;
    let resetInput    = '';
    let resetting     = false;
    let resetDone     = false;
    let usersOpen     = false;
    let usersInput    = '';
    let deletingUsers = false;
    let usersDone     = false;
    let newAdminCreds = null;
    let backups       = [];
    let loadingBackups = false;
    let restoring     = null;
    let restoreDone   = false;
    let confirmRestore = null;
    let errorMsg      = '';

    // ── Render helpers ─────────────────────────────────────────────────────────

    function eyeIconHide() {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>`;
    }

    function eyeIconShow() {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>`;
    }

    function renderLoginForm() {
      return `
        <form id="dev-login-form">
          <label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:8px;">
            Password
          </label>
          <div style="position:relative;margin-bottom:16px;">
            <input
              id="dev-password-input"
              type="${showPass ? 'text' : 'password'}"
              value="${password.replace(/"/g, '&quot;')}"
              placeholder="Enter developer password"
              autocomplete="current-password"
              required
              style="
                width:100%;padding:11px 42px 11px 14px;border-radius:10px;
                border:1.5px solid ${errorMsg ? '#fca5a5' : '#e2e8f0'};
                font-size:14px;outline:none;box-sizing:border-box;
                background:${errorMsg ? '#fff5f5' : '#fff'};color:#0f172a;
              "
            />
            <button type="button" id="dev-toggle-pass" style="
              position:absolute;right:12px;top:50%;transform:translateY(-50%);
              background:none;border:none;cursor:pointer;padding:2px;
              color:#94a3b8;display:flex;align-items:center;
            ">
              ${showPass ? eyeIconHide() : eyeIconShow()}
            </button>
          </div>
          ${errorMsg ? `<p style="color:#ef4444;font-size:12.5px;margin:-8px 0 12px;">${errorMsg}</p>` : ''}
          <button type="submit" id="dev-login-btn" ${loading || !password ? 'disabled' : ''} style="
            width:100%;padding:12px;border-radius:10px;border:none;
            background:${loading || !password ? '#cbd5e1' : '#3b82f6'};
            color:#fff;font-size:14px;font-weight:700;
            cursor:${loading || !password ? 'not-allowed' : 'pointer'};
          ">
            ${loading ? 'Verifying…' : 'Login'}
          </button>
        </form>
      `;
    }

    function renderControlPanel() {
      return `
        <div style="text-align:center;">

          <!-- Status badge -->
          <div style="
            display:inline-flex;align-items:center;gap:8px;
            padding:7px 16px;border-radius:999px;margin-bottom:20px;
            background:${enabled ? '#f0fdf4' : '#fef2f2'};
            border:1px solid ${enabled ? '#bbf7d0' : '#fecaca'};
            font-size:13px;font-weight:600;
            color:${enabled ? '#16a34a' : '#dc2626'};
          ">
            <span style="width:8px;height:8px;border-radius:50%;background:${enabled ? '#22c55e' : '#ef4444'};display:inline-block;"></span>
            ${enabled ? 'Dashboard Active' : 'Dashboard Suspended'}
          </div>

          <p style="font-size:14px;color:#64748b;margin-bottom:24px;">
            Client: <strong style="color:#0f172a;">Lallubhai Amichand</strong>
          </p>

          <!-- Suspend / Restore -->
          <button id="dev-toggle-btn" ${saving ? 'disabled' : ''} style="
            width:100%;padding:13px;border-radius:12px;border:none;
            cursor:${saving ? 'not-allowed' : 'pointer'};
            font-size:14px;font-weight:700;color:#fff;
            background:${enabled ? '#ef4444' : '#22c55e'};
            box-shadow:${enabled ? '0 4px 14px rgba(239,68,68,0.3)' : '0 4px 14px rgba(34,197,94,0.3)'};
            opacity:${saving ? '0.7' : '1'};
          ">
            ${saving ? 'Saving…' : enabled ? '🔴 Suspend Dashboard' : '🟢 Restore Dashboard'}
          </button>

          <!-- Export Excel -->
          <button id="dev-export-btn" ${exporting ? 'disabled' : ''} style="
            width:100%;padding:12px;border-radius:12px;border:none;
            cursor:${exporting ? 'not-allowed' : 'pointer'};
            font-size:14px;font-weight:600;color:#16a34a;
            background:#f0fdf4;margin-top:10px;
            opacity:${exporting ? '0.7' : '1'};
          ">
            ${exporting ? '⏳ Exporting…' : '📊 Export All Data (Excel)'}
          </button>

          <!-- Delete buttons row -->
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button id="dev-reset-tasks-btn" style="
              flex:1;padding:12px;border-radius:12px;
              border:1.5px solid #fecaca;background:#fff5f5;
              cursor:pointer;font-size:13px;font-weight:600;color:#ef4444;
            ">
              🗑️ Delete All Tasks
            </button>
            <button id="dev-reset-users-btn" style="
              flex:1;padding:12px;border-radius:12px;
              border:1.5px solid #fed7aa;background:#fff7ed;
              cursor:pointer;font-size:13px;font-weight:600;color:#ea580c;
            ">
              👤 Delete All Users
            </button>
          </div>

          ${resetDone ? `<p style="color:#16a34a;font-size:13px;margin-top:10px;font-weight:600;">✓ All tasks deleted successfully.</p>` : ''}
          ${usersDone && newAdminCreds ? `
            <div style="
              margin-top:12px;padding:14px 16px;border-radius:12px;
              background:#f0fdf4;border:1.5px solid #86efac;text-align:left;
            ">
              <p style="color:#16a34a;font-size:13px;font-weight:700;margin:0 0 10px;">
                ✓ All users deleted. New admin created:
              </p>
              <div style="background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #bbf7d0;">
                <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Email</div>
                <div style="font-size:14px;font-weight:700;color:#0f172a;font-family:monospace;margin-bottom:8px;">${newAdminCreds.email}</div>
                <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Password</div>
                <div style="font-size:14px;font-weight:700;color:#0f172a;font-family:monospace;">${newAdminCreds.password}</div>
              </div>
              <p style="font-size:11px;color:#94a3b8;margin:8px 0 0;">
                Save these credentials before leaving this page.
              </p>
            </div>
          ` : ''}

          <!-- Restore Section -->
          <div style="margin-top:20px;border-top:1px solid #f1f5f9;padding-top:16px;">
            <button id="dev-load-backups-btn" ${loadingBackups ? 'disabled' : ''} style="
              width:100%;padding:11px;border-radius:12px;
              border:1.5px solid #bfdbfe;background:#eff6ff;
              cursor:pointer;font-size:13px;font-weight:600;color:#1d4ed8;
            ">
              ${loadingBackups ? '⏳ Loading…' : '🔄 View Backups (Restore Data)'}
            </button>

            ${restoreDone ? `<p style="color:#16a34a;font-size:13px;margin-top:8px;font-weight:600;">✓ Data restored successfully!</p>` : ''}

            ${backups.length > 0 ? `
              <div style="margin-top:12px;max-height:220px;overflow-y:auto;border-radius:10px;border:1px solid #e2e8f0;">
                ${backups.map((b, i) => {
                  const date     = new Date(b.created_at);
                  const expires  = new Date(b.expires_at);
                  const daysLeft = Math.ceil((expires - new Date()) / (1000 * 60 * 60 * 24));
                  return `
                    <div style="
                      display:flex;align-items:center;justify-content:space-between;
                      padding:10px 12px;
                      ${i < backups.length - 1 ? 'border-bottom:1px solid #f1f5f9;' : ''}
                      background:${i % 2 === 0 ? '#fff' : '#fafafa'};
                    ">
                      <div style="text-align:left;flex:1;min-width:0;">
                        <div style="font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                          ${b.label || 'Backup'}
                        </div>
                        <div style="font-size:10px;color:#94a3b8;margin-top:2px;">
                          ${date.toLocaleString('en-IN')} &middot; ${daysLeft}d left
                        </div>
                      </div>
                      <button
                        class="dev-restore-btn"
                        data-id="${b.id}"
                        ${restoring ? 'disabled' : ''}
                        style="
                          margin-left:8px;padding:5px 12px;border-radius:8px;border:none;
                          background:${restoring ? '#cbd5e1' : '#3b82f6'};
                          color:#fff;font-size:11px;font-weight:700;
                          cursor:${restoring ? 'not-allowed' : 'pointer'};white-space:nowrap;
                        "
                      >
                        ${restoring === b.id ? '⏳' : 'Restore'}
                      </button>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : (!loadingBackups ? `
              <p style="font-size:12px;color:#94a3b8;margin-top:8px;text-align:center;">
                No backups found. Backups are created automatically before any delete.
              </p>
            ` : '')}
          </div>

          ${errorMsg ? `<p style="color:#ef4444;font-size:13px;margin-top:12px;">${errorMsg}</p>` : ''}

          <button id="dev-logout-btn" style="
            margin-top:20px;background:none;border:none;
            color:#94a3b8;font-size:12px;cursor:pointer;
          ">
            Logout
          </button>
          <p style="color:#e2e8f0;font-size:11px;margin-top:16px;">
            Changes apply immediately for all users.
          </p>
        </div>
      `;
    }

    function renderConfirmModal() {
      if (!confirm) return '';
      return `
        <div id="dev-confirm-overlay" style="
          position:fixed;inset:0;background:rgba(15,23,42,0.5);
          display:flex;align-items:center;justify-content:center;
          z-index:50;padding:24px;
        ">
          <div id="dev-confirm-dialog" style="
            background:#fff;border-radius:16px;padding:32px 28px;
            max-width:340px;width:100%;text-align:center;
            box-shadow:0 20px 60px rgba(0,0,0,0.2);
          ">
            <div style="
              width:48px;height:48px;border-radius:12px;margin:0 auto 16px;
              background:${enabled ? '#fef2f2' : '#f0fdf4'};
              display:flex;align-items:center;justify-content:center;
            ">
              ${enabled
                ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
                : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`
              }
            </div>
            <h2 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px;">
              ${enabled ? 'Suspend Dashboard?' : 'Restore Dashboard?'}
            </h2>
            <p style="font-size:13px;color:#64748b;margin:0 0 24px;line-height:1.5;">
              ${enabled
                ? 'The client dashboard will be suspended immediately. No one will be able to log in.'
                : 'The dashboard will be restored immediately. The client will regain access.'}
            </p>
            <div style="display:flex;gap:10px;">
              <button id="dev-confirm-cancel" style="
                flex:1;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;
                background:#fff;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;
              ">Cancel</button>
              <button id="dev-confirm-ok" style="
                flex:1;padding:10px;border-radius:10px;border:none;
                background:${enabled ? '#ef4444' : '#22c55e'};
                color:#fff;font-size:13px;font-weight:700;cursor:pointer;
              ">
                ${enabled ? 'Yes, Suspend' : 'Yes, Restore'}
              </button>
            </div>
          </div>
        </div>
      `;
    }

    function renderResetModal() {
      if (!resetOpen) return '';
      return `
        <div id="dev-reset-overlay" style="
          position:fixed;inset:0;background:rgba(15,23,42,0.5);
          display:flex;align-items:center;justify-content:center;
          z-index:50;padding:24px;
        ">
          <div id="dev-reset-dialog" style="
            background:#fff;border-radius:16px;padding:32px 28px;
            max-width:360px;width:100%;text-align:center;
            box-shadow:0 20px 60px rgba(0,0,0,0.2);
          ">
            <div style="
              width:48px;height:48px;border-radius:12px;margin:0 auto 16px;
              background:#fef2f2;display:flex;align-items:center;justify-content:center;
            ">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </div>
            <h2 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px;">
              Delete All Tasks?
            </h2>
            <p style="font-size:13px;color:#64748b;margin:0 0 20px;line-height:1.5;">
              This will permanently delete all delegations, checklists, and transfers.
              This action <strong>cannot be undone</strong>.
            </p>
            <p style="font-size:13px;color:#0f172a;margin:0 0 8px;font-weight:600;">
              Type <span style="color:#ef4444;font-family:monospace;">DELETE</span> to confirm
            </p>
            <input
              id="dev-reset-input"
              value="${resetInput}"
              placeholder="Type DELETE here"
              autofocus
              style="
                width:100%;padding:10px 12px;border-radius:8px;box-sizing:border-box;
                border:1.5px solid ${resetInput === 'DELETE' ? '#fca5a5' : '#e2e8f0'};
                font-size:14px;outline:none;margin-bottom:20px;
                text-align:center;font-weight:600;letter-spacing:1px;
              "
            />
            <div style="display:flex;gap:10px;">
              <button id="dev-reset-cancel" style="
                flex:1;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;
                background:#fff;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;
              ">Cancel</button>
              <button id="dev-reset-ok" ${resetInput !== 'DELETE' || resetting ? 'disabled' : ''} style="
                flex:1;padding:10px;border-radius:10px;border:none;
                background:${resetInput === 'DELETE' ? '#ef4444' : '#fca5a5'};
                color:#fff;font-size:13px;font-weight:700;
                cursor:${resetInput !== 'DELETE' || resetting ? 'not-allowed' : 'pointer'};
              ">
                ${resetting ? 'Deleting…' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      `;
    }

    function renderConfirmRestoreModal() {
      if (!confirmRestore) return '';
      return `
        <div id="dev-crestore-overlay" style="
          position:fixed;inset:0;background:rgba(15,23,42,0.5);
          display:flex;align-items:center;justify-content:center;
          z-index:50;padding:24px;
        ">
          <div id="dev-crestore-dialog" style="
            background:#fff;border-radius:16px;padding:32px 28px;
            max-width:360px;width:100%;text-align:center;
            box-shadow:0 20px 60px rgba(0,0,0,0.2);
          ">
            <div style="
              width:48px;height:48px;border-radius:12px;margin:0 auto 16px;
              background:#eff6ff;display:flex;align-items:center;justify-content:center;
            ">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 2v6h6"/><path d="M3 8a9 9 0 1 0 2.6-5.6L3 8"/>
              </svg>
            </div>
            <h2 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px;">Restore Backup?</h2>
            <p style="font-size:13px;color:#64748b;margin:0 0 6px;line-height:1.5;">
              <strong>${confirmRestore.label || 'Backup'}</strong>
            </p>
            <p style="font-size:12px;color:#94a3b8;margin:0 0 24px;">
              ${new Date(confirmRestore.created_at).toLocaleString('en-IN')}
            </p>
            <p style="font-size:13px;color:#dc2626;margin:0 0 20px;font-weight:600;">
              ⚠️ Current data will be permanently replaced.
            </p>
            <div style="display:flex;gap:10px;">
              <button id="dev-crestore-cancel" style="
                flex:1;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;
                background:#fff;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;
              ">Cancel</button>
              <button id="dev-crestore-ok" style="
                flex:1;padding:10px;border-radius:10px;border:none;
                background:#3b82f6;color:#fff;font-size:13px;font-weight:700;cursor:pointer;
              ">Yes, Restore</button>
            </div>
          </div>
        </div>
      `;
    }

    function renderUsersModal() {
      if (!usersOpen) return '';
      const userModes = [
        { mode: 'users',  icon: '👤', label: 'Only Users',   desc: 'Delete all non-admin users. Admin accounts stay.',          color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
        { mode: 'admins', icon: '🛡️', label: 'Only Admins', desc: 'Delete all admin users. A fresh admin will be created.', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
        { mode: 'all',    icon: '🗑️', label: 'All Users',   desc: 'Delete everyone. A fresh admin will be created.',        color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
      ];
      return `
        <div id="dev-users-overlay" style="
          position:fixed;inset:0;background:rgba(15,23,42,0.5);
          display:flex;align-items:center;justify-content:center;
          z-index:50;padding:24px;
        ">
          <div id="dev-users-dialog" style="
            background:#fff;border-radius:16px;padding:32px 28px;
            max-width:360px;width:100%;text-align:center;
            box-shadow:0 20px 60px rgba(0,0,0,0.2);
          ">
            <div style="
              width:48px;height:48px;border-radius:12px;margin:0 auto 16px;
              background:#fff7ed;display:flex;align-items:center;justify-content:center;
            ">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="17" y1="8" x2="23" y2="14"/>
                <line x1="23" y1="8" x2="17" y2="14"/>
              </svg>
            </div>
            <h2 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 8px;">Delete All Users?</h2>
            <p style="font-size:13px;color:#64748b;margin:0 0 16px;line-height:1.5;">
              Choose what to delete. A backup is created automatically before any action.
            </p>

            ${userModes.map(({ mode, icon, label, desc, color, bg, border }) => `
              <div style="
                display:flex;align-items:center;gap:10px;
                padding:10px 12px;border-radius:10px;margin-bottom:8px;
                background:${bg};border:1.5px solid ${border};
              ">
                <span style="font-size:20px;">${icon}</span>
                <div style="flex:1;text-align:left;">
                  <div style="font-size:13px;font-weight:700;color:#0f172a;">${label}</div>
                  <div style="font-size:11px;color:#64748b;margin-top:1px;">${desc}</div>
                </div>
                <button
                  class="dev-delete-users-btn"
                  data-mode="${mode}"
                  ${usersInput !== 'DELETE' || deletingUsers ? 'disabled' : ''}
                  style="
                    padding:6px 14px;border-radius:8px;border:none;
                    background:${usersInput === 'DELETE' ? color : '#cbd5e1'};
                    color:#fff;font-size:12px;font-weight:700;
                    cursor:${usersInput !== 'DELETE' || deletingUsers ? 'not-allowed' : 'pointer'};
                    white-space:nowrap;
                  "
                >
                  ${deletingUsers ? '…' : 'Delete'}
                </button>
              </div>
            `).join('')}

            <p style="font-size:13px;color:#0f172a;margin:12px 0 6px;font-weight:600;">
              Type <span style="color:#ea580c;font-family:monospace;">DELETE</span> to enable
            </p>
            <input
              id="dev-users-input"
              value="${usersInput}"
              placeholder="Type DELETE here"
              autofocus
              style="
                width:100%;padding:10px 12px;border-radius:8px;box-sizing:border-box;
                border:1.5px solid ${usersInput === 'DELETE' ? '#fca5a5' : '#e2e8f0'};
                font-size:14px;outline:none;margin-bottom:12px;
                text-align:center;font-weight:600;letter-spacing:1px;
              "
            />
            <button id="dev-users-cancel" style="
              width:100%;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;
              background:#fff;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;
            ">Cancel</button>
          </div>
        </div>
      `;
    }

    function renderPage() {
      el.innerHTML = `
        <style>
          #dev-page-wrap { min-height: 100%; background: #f8fafc; display: flex; align-items: flex-start; justify-content: center; padding: 24px; font-family: system-ui, sans-serif; }
          #dev-card { background: #fff; border-radius: 20px; padding: 48px 40px; max-width: 400px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #f1f5f9; }
          #dev-card input:focus { outline: none; border-color: #93c5fd !important; box-shadow: 0 0 0 3px rgba(59,130,246,0.12) !important; }
        </style>

        <div id="dev-page-wrap">
          <div id="dev-card">

            <!-- Header -->
            <div style="text-align:center;margin-bottom:32px;">
              <div style="
                width:52px;height:52px;border-radius:14px;
                background:#eff6ff;display:flex;align-items:center;
                justify-content:center;margin:0 auto 16px;
              ">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                  stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <h1 style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 4px;">
                Developer Panel
              </h1>
              <p style="font-size:13px;color:#94a3b8;margin:0;">e-marketing.io</p>
            </div>

            <!-- Dynamic body -->
            <div id="dev-body">
              ${authed ? renderControlPanel() : renderLoginForm()}
            </div>
          </div>
        </div>

        <!-- Modals -->
        ${renderConfirmModal()}
        ${renderResetModal()}
        ${renderConfirmRestoreModal()}
        ${renderUsersModal()}
      `;

      wireEvents();
    }

    // ── Event wiring ───────────────────────────────────────────────────────────

    function wireEvents() {
      // ── Login form ──
      if (!authed) {
        const passInput  = el.querySelector('#dev-password-input');
        const toggleBtn  = el.querySelector('#dev-toggle-pass');
        const loginForm  = el.querySelector('#dev-login-form');

        if (passInput) {
          passInput.addEventListener('input', (e) => {
            password = e.target.value;
            const btn = el.querySelector('#dev-login-btn');
            if (btn) {
              btn.disabled = loading || !password;
              btn.style.background = loading || !password ? '#cbd5e1' : '#3b82f6';
              btn.style.cursor = loading || !password ? 'not-allowed' : 'pointer';
            }
            // Clear error styling on type
            passInput.style.border = '1.5px solid #e2e8f0';
            passInput.style.background = '#fff';
            const errEl = el.querySelector('#dev-error-inline');
            if (errEl) errEl.remove();
          });
        }

        if (toggleBtn) {
          toggleBtn.addEventListener('click', () => {
            showPass = !showPass;
            if (passInput) passInput.type = showPass ? 'text' : 'password';
            toggleBtn.innerHTML = showPass ? eyeIconHide() : eyeIconShow();
          });
        }

        if (loginForm) {
          loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loading || !password) return;
            loading = true;
            errorMsg = '';
            reRenderBody();
            try {
              const res = await fetch(`/api/developer/access?secret=${encodeURIComponent(password)}`);
              const d   = await res.json();
              if (!res.ok) {
                errorMsg = 'Wrong password. Try again.';
                loading  = false;
                reRenderBody();
                return;
              }
              secret  = password;
              enabled = d.enabled;
              authed  = true;
              loading = false;
              reRenderBody();
            } catch {
              errorMsg = 'Network error. Please try again.';
              loading  = false;
              reRenderBody();
            }
          });
        }
        return; // nothing else to wire for login view
      }

      // ── Control panel ──

      const toggleBtn = el.querySelector('#dev-toggle-btn');
      if (toggleBtn) toggleBtn.addEventListener('click', () => {
        confirm = true;
        reRenderModals();
        wireModalEvents();
      });

      const exportBtn = el.querySelector('#dev-export-btn');
      if (exportBtn) exportBtn.addEventListener('click', exportExcel);

      const resetTasksBtn = el.querySelector('#dev-reset-tasks-btn');
      if (resetTasksBtn) resetTasksBtn.addEventListener('click', () => {
        resetOpen  = true;
        resetInput = '';
        resetDone  = false;
        reRenderModals();
        wireModalEvents();
      });

      const resetUsersBtn = el.querySelector('#dev-reset-users-btn');
      if (resetUsersBtn) resetUsersBtn.addEventListener('click', () => {
        usersOpen  = true;
        usersInput = '';
        usersDone  = false;
        reRenderModals();
        wireModalEvents();
      });

      const loadBackupsBtn = el.querySelector('#dev-load-backups-btn');
      if (loadBackupsBtn) loadBackupsBtn.addEventListener('click', loadBackups);

      // Restore buttons (inside backup list)
      el.querySelectorAll('.dev-restore-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const b = backups.find(x => String(x.id) === btn.dataset.id);
          if (b) {
            confirmRestore = b;
            reRenderModals();
            wireModalEvents();
          }
        });
      });

      const logoutBtn = el.querySelector('#dev-logout-btn');
      if (logoutBtn) logoutBtn.addEventListener('click', () => {
        authed   = false;
        password = '';
        secret   = '';
        errorMsg = '';
        reRenderBody();
      });
    }

    function wireModalEvents() {
      // Confirm toggle modal
      const confirmOverlay = el.querySelector('#dev-confirm-overlay');
      if (confirmOverlay) {
        confirmOverlay.addEventListener('click', (e) => {
          if (e.target === confirmOverlay) { confirm = false; reRenderModals(); }
        });
        const cancelBtn = el.querySelector('#dev-confirm-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { confirm = false; reRenderModals(); });
        const okBtn = el.querySelector('#dev-confirm-ok');
        if (okBtn) okBtn.addEventListener('click', toggle);
      }

      // Reset tasks modal
      const resetOverlay = el.querySelector('#dev-reset-overlay');
      if (resetOverlay) {
        resetOverlay.addEventListener('click', (e) => {
          if (e.target === resetOverlay) { resetOpen = false; reRenderModals(); }
        });
        const cancelBtn = el.querySelector('#dev-reset-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { resetOpen = false; reRenderModals(); });

        const resetInputEl = el.querySelector('#dev-reset-input');
        if (resetInputEl) {
          resetInputEl.focus();
          resetInputEl.addEventListener('input', (e) => {
            resetInput = e.target.value;
            // Re-render to update button/border state without full page re-render
            const okBtn = el.querySelector('#dev-reset-ok');
            if (okBtn) {
              okBtn.disabled = resetInput !== 'DELETE' || resetting;
              okBtn.style.background = resetInput === 'DELETE' ? '#ef4444' : '#fca5a5';
              okBtn.style.cursor = resetInput !== 'DELETE' || resetting ? 'not-allowed' : 'pointer';
            }
            resetInputEl.style.borderColor = resetInput === 'DELETE' ? '#fca5a5' : '#e2e8f0';
          });
        }
        const okBtn = el.querySelector('#dev-reset-ok');
        if (okBtn) okBtn.addEventListener('click', resetData);
      }

      // Confirm restore modal
      const crestoreOverlay = el.querySelector('#dev-crestore-overlay');
      if (crestoreOverlay) {
        crestoreOverlay.addEventListener('click', (e) => {
          if (e.target === crestoreOverlay) { confirmRestore = null; reRenderModals(); }
        });
        const cancelBtn = el.querySelector('#dev-crestore-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { confirmRestore = null; reRenderModals(); });
        const okBtn = el.querySelector('#dev-crestore-ok');
        if (okBtn) okBtn.addEventListener('click', () => doRestore(confirmRestore.id));
      }

      // Delete users modal
      const usersOverlay = el.querySelector('#dev-users-overlay');
      if (usersOverlay) {
        usersOverlay.addEventListener('click', (e) => {
          if (e.target === usersOverlay) { usersOpen = false; reRenderModals(); }
        });
        const cancelBtn = el.querySelector('#dev-users-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { usersOpen = false; reRenderModals(); });

        const usersInputEl = el.querySelector('#dev-users-input');
        if (usersInputEl) {
          usersInputEl.focus();
          usersInputEl.addEventListener('input', (e) => {
            usersInput = e.target.value;
            usersInputEl.style.borderColor = usersInput === 'DELETE' ? '#fca5a5' : '#e2e8f0';
            el.querySelectorAll('.dev-delete-users-btn').forEach((btn) => {
              btn.disabled = usersInput !== 'DELETE' || deletingUsers;
              btn.style.background = usersInput === 'DELETE'
                ? (btn.dataset.mode === 'users' ? '#f59e0b' : btn.dataset.mode === 'admins' ? '#ea580c' : '#dc2626')
                : '#cbd5e1';
              btn.style.cursor = usersInput !== 'DELETE' || deletingUsers ? 'not-allowed' : 'pointer';
            });
          });
        }
        el.querySelectorAll('.dev-delete-users-btn').forEach((btn) => {
          btn.addEventListener('click', () => deleteUsers(btn.dataset.mode));
        });
      }
    }

    // ── Partial re-renders ─────────────────────────────────────────────────────

    function reRenderBody() {
      const body = el.querySelector('#dev-body');
      if (body) {
        body.innerHTML = authed ? renderControlPanel() : renderLoginForm();
        wireEvents();
      }
      reRenderModals();
    }

    function reRenderModals() {
      // Remove existing modal root and re-inject
      let modalRoot = el.querySelector('#dev-modal-root');
      if (!modalRoot) {
        modalRoot = document.createElement('div');
        modalRoot.id = 'dev-modal-root';
        el.appendChild(modalRoot);
      }
      modalRoot.innerHTML =
        renderConfirmModal() +
        renderResetModal() +
        renderConfirmRestoreModal() +
        renderUsersModal();
      wireModalEvents();
    }

    // ── API actions ────────────────────────────────────────────────────────────

    async function toggle() {
      confirm = false;
      saving  = true;
      errorMsg = '';
      reRenderBody();
      try {
        const res = await fetch(`/api/developer/access?secret=${encodeURIComponent(secret)}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ enabled: !enabled }),
        });
        const d = await res.json();
        if (res.ok) enabled = d.enabled;
        else errorMsg = d.error || 'Failed';
      } catch {
        errorMsg = 'Network error.';
      }
      saving = false;
      reRenderBody();
    }

    async function resetData() {
      if (resetInput !== 'DELETE') return;
      resetting = true;
      errorMsg  = '';
      reRenderModals();
      try {
        const res = await fetch(`/api/developer/reset?secret=${encodeURIComponent(secret)}`, { method: 'POST' });
        if (res.ok) {
          resetDone  = true;
          resetOpen  = false;
          resetInput = '';
        } else {
          const d  = await res.json();
          errorMsg = d.error || 'Reset failed';
          resetOpen = false;
        }
      } catch {
        errorMsg  = 'Network error.';
        resetOpen = false;
      }
      resetting = false;
      reRenderBody();
    }

    async function loadBackups() {
      loadingBackups = true;
      reRenderBody();
      try {
        const res = await fetch(`/api/developer/backups?secret=${encodeURIComponent(secret)}`);
        const d   = await res.json();
        if (res.ok) backups = d.backups || [];
      } catch { /* ignore */ }
      loadingBackups = false;
      reRenderBody();
    }

    async function doRestore(id) {
      confirmRestore = null;
      restoring      = id;
      restoreDone    = false;
      errorMsg       = '';
      reRenderBody();
      try {
        const res = await fetch(`/api/developer/restore?secret=${encodeURIComponent(secret)}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id }),
        });
        const d = await res.json();
        if (res.ok) restoreDone = true;
        else errorMsg = d.error || 'Restore failed';
      } catch (e) {
        errorMsg = 'Network error: ' + e.message;
      }
      restoring = null;
      reRenderBody();
    }

    async function deleteUsers(mode) {
      if (usersInput !== 'DELETE') return;
      deletingUsers = true;
      errorMsg      = '';
      reRenderModals();
      try {
        const res = await fetch(`/api/developer/reset-users?secret=${encodeURIComponent(secret)}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ mode }),
        });
        const d = await res.json();
        if (res.ok) {
          usersDone     = true;
          newAdminCreds = d.admin || null;
          usersOpen     = false;
          usersInput    = '';
        } else {
          errorMsg  = d.error || 'Delete failed';
          usersOpen = false;
        }
      } catch {
        errorMsg  = 'Network error.';
        usersOpen = false;
      }
      deletingUsers = false;
      reRenderBody();
    }

    async function exportExcel() {
      exporting = true;
      errorMsg  = '';
      reRenderBody();
      try {
        const res = await fetch(`/api/developer/export?secret=${encodeURIComponent(secret)}`);
        if (!res.ok) { errorMsg = 'Export failed'; exporting = false; reRenderBody(); return; }
        const data = await res.json();
        const date = new Date().toISOString().slice(0, 10);

        // Use SheetJS if available, otherwise fall back to CSV download
        if (window.XLSX) {
          const wb = window.XLSX.utils.book_new();
          [
            { name: 'Tasks',      rows: data.delegations },
            { name: 'Users',      rows: data.users       },
            { name: 'Checklists', rows: data.masters     },
            { name: 'Holidays',   rows: data.holidays    },
          ].forEach(({ name, rows }) => {
            const ws = window.XLSX.utils.json_to_sheet(rows || []);
            window.XLSX.utils.book_append_sheet(wb, ws, name);
          });
          window.XLSX.writeFile(wb, `lallubhai_${date}.xlsx`);
        } else {
          // Fallback: JSON download
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const a    = document.createElement('a');
          a.href     = URL.createObjectURL(blob);
          a.download = `lallubhai_${date}.json`;
          a.click();
        }
      } catch (e) {
        errorMsg = 'Export error: ' + e.message;
      }
      exporting = false;
      reRenderBody();
    }

    // ── Initial render ─────────────────────────────────────────────────────────
    renderPage();
  },
};
