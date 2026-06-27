window.Pages = window.Pages || {};

window.Pages.profile = {
  /* ── state ─────────────────────────────────────────────── */
  _me: null,
  _picture: null,
  _picSaving: false,
  _saving: false,
  _form: {},

  /* ── helpers ───────────────────────────────────────────── */
  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _initials(name) {
    return (name || 'U')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase() || 'U';
  },

  /* ── fetch full user record (picture + notif email) ─────── */
  async _fetchMe() {
    const user = window.currentUser;
    if (!user?.id) return null;
    try {
      // Fetch the users list; find self for picture + notification email
      const res = await fetch('/api/users');
      if (!res.ok) return null;
      const list = await res.json();
      return Array.isArray(list) ? list.find((u) => u.id === user.id) || null : null;
    } catch {
      return null;
    }
  },

  /* ── render entry ──────────────────────────────────────── */
  async render() {
    const el = document.getElementById('main-content');
    el.innerHTML = `<div class="space-y-6 animate-fade-in" id="profile-root"><div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:#C4714A;animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div></div>`;

    const user = window.currentUser;
    const fullUser = await this._fetchMe();

    this._me = { ...user, ...(fullUser || {}) };
    this._picture = this._me.picture || null;
    this._form = {
      name:              this._me.name              || '',
      email:             this._me.email             || '',
      notificationEmail: this._me.notif_email       || this._me.notifEmail || '',
      phone:             this._me.phone             || '',
      currentPassword:   '',
      newPassword:       '',
      confirmPassword:   '',
    };

    this._renderContent();
  },

  /* ── main render ───────────────────────────────────────── */
  _renderContent() {
    const root = document.getElementById('profile-root');
    if (!root) return;

    const me       = this._me || {};
    const f        = this._form;
    const role     = Array.isArray(me.roles) ? me.roles[0] : (me.roles || 'User');
    const initials = this._initials(f.name);
    const dept     = me.department || '—';

    const avatarHtml = this._picture
      ? `<img src="${this._esc(this._picture)}" alt="Profile" class="w-24 h-24 rounded-2xl object-cover shadow-elevated ring-4 ring-white" id="profile-avatar-img" />`
      : `<div class="w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 grid place-items-center text-white text-2xl font-bold shadow-elevated ring-4 ring-white" id="profile-avatar-initials">${this._esc(initials)}</div>`;

    root.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">

        <!-- Identity card -->
        <div class="card overflow-hidden">
          <div class="h-24 bg-gradient-to-br from-primary-500 via-primary-600 to-violet-600"></div>
          <div class="px-6 pb-6 -mt-12">
            <div class="relative w-24 h-24" id="profile-avatar-wrap">
              ${avatarHtml}
            </div>
            <div class="mt-4">
              <div class="text-lg font-semibold text-slate-900" id="profile-display-name">${this._esc(f.name || '—')}</div>
              <div class="text-sm text-slate-500" id="profile-display-email">${this._esc(f.email || '—')}</div>
              <span class="pill bg-amber-50 text-amber-700 border border-amber-100 mt-2 inline-flex items-center gap-1">
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7Z"/></svg>
                ${this._esc(role)}
              </span>
            </div>
            <div class="flex gap-2 mt-4">
              <button id="profile-change-photo-btn" class="btn-secondary !py-1.5 text-xs flex-1" ${this._picSaving ? 'disabled' : ''}>
                ${this._picSaving ? 'Saving…' : 'Change Photo'}
              </button>
              <button id="profile-remove-photo-btn" class="btn-ghost !py-1.5 text-xs text-red-600 hover:bg-red-50 flex-1" ${this._picSaving ? 'disabled' : ''}>
                Remove
              </button>
              <input id="profile-file-input" type="file" accept="image/*" class="hidden" />
            </div>
            <div class="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 gap-3 text-center">
              <div>
                <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Department</div>
                <div class="text-sm font-medium text-slate-800 mt-0.5">${this._esc(dept)}</div>
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Phone</div>
                <div class="text-sm font-medium text-slate-800 mt-0.5" id="profile-display-phone">${this._esc(f.phone || '—')}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Forms -->
        <div class="space-y-6">

          <!-- Personal Information -->
          <div class="card p-5">
            <div class="mb-4">
              <h3 class="text-[15px] font-semibold text-slate-900">Personal Information</h3>
              <p class="text-xs text-slate-500 mt-0.5">Public profile details</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              ${this._fieldHtml('name',              'Full Name',           f.name,              'text',     '')}
              ${this._fieldHtml('email',             'Email Address',       f.email,             'email',    '')}
              ${this._fieldHtml('phone',             'Phone Number',        f.phone,             'text',     '')}
              ${this._fieldHtml('notificationEmail', 'Notification Email',  f.notificationEmail, 'email',    'Real Gmail/Outlook for task notifications', 'yourrealemail@gmail.com')}
            </div>
          </div>

          <!-- Security -->
          <div class="card p-5">
            <div class="mb-4">
              <h3 class="text-[15px] font-semibold text-slate-900">Security</h3>
              <p class="text-xs text-slate-500 mt-0.5">Change your account password</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              ${this._fieldHtml('currentPassword', 'Current Password', '', 'password', '', '••••••')}
              ${this._fieldHtml('newPassword',     'New Password',     '', 'password', '', 'Enter new password')}
              ${this._fieldHtml('confirmPassword', 'Confirm Password', '', 'password', '', 'Confirm new password')}
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <button id="profile-cancel-btn" class="btn-secondary">Cancel</button>
            <button id="profile-save-btn" class="btn-primary" ${this._saving ? 'disabled' : ''}>
              ${this._saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
  },

  /* ── field HTML helper ─────────────────────────────────── */
  _fieldHtml(id, label, value, type, hint, placeholder) {
    const isPass = type === 'password';
    const inputId = `profile-field-${id}`;
    const eyeId   = `profile-eye-${id}`;
    const val     = this._esc(value || '');
    const ph      = this._esc(placeholder || '');
    const inputType = isPass ? 'password' : type;

    const inputHtml = `
      <div class="relative">
        <input
          id="${inputId}"
          type="${inputType}"
          value="${val}"
          placeholder="${ph}"
          class="input${isPass ? ' pr-10' : ''}"
        />
        ${isPass ? `
        <button type="button" id="${eyeId}" tabindex="-1"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
          aria-label="Show password">
          ${this._eyeClosedSvg()}
        </button>` : ''}
      </div>
      ${hint ? `<div class="text-[11px] text-slate-400 mt-1">${this._esc(hint)}</div>` : ''}
    `;

    return `
      <div>
        <label class="label" for="${inputId}">${this._esc(label)}</label>
        ${inputHtml}
      </div>
    `;
  },

  /* ── eye icons ─────────────────────────────────────────── */
  _eyeOpenSvg() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
  },

  _eyeClosedSvg() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  },

  /* ── bind events ───────────────────────────────────────── */
  _bindEvents() {
    const root = document.getElementById('profile-root');
    if (!root) return;

    /* photo buttons */
    const fileInput = document.getElementById('profile-file-input');
    document.getElementById('profile-change-photo-btn')?.addEventListener('click', () => {
      fileInput?.click();
    });
    document.getElementById('profile-remove-photo-btn')?.addEventListener('click', () => {
      this._picture = null;
      this._savePicture(null);
      this._updateAvatarDOM();
    });
    fileInput?.addEventListener('change', (e) => this._handleFileChange(e));

    /* save / cancel */
    document.getElementById('profile-save-btn')?.addEventListener('click', () => this._save());
    document.getElementById('profile-cancel-btn')?.addEventListener('click', () => {
      // Re-render to reset form
      this._form = {
        name:              this._me?.name              || '',
        email:             this._me?.email             || '',
        notificationEmail: this._me?.notif_email       || this._me?.notifEmail || '',
        phone:             this._me?.phone             || '',
        currentPassword:   '',
        newPassword:       '',
        confirmPassword:   '',
      };
      this._renderContent();
    });

    /* password eye toggles */
    ['currentPassword', 'newPassword', 'confirmPassword'].forEach((id) => {
      const eyeBtn   = document.getElementById(`profile-eye-${id}`);
      const inputEl  = document.getElementById(`profile-field-${id}`);
      if (!eyeBtn || !inputEl) return;
      eyeBtn.addEventListener('click', () => {
        const isText = inputEl.type === 'text';
        inputEl.type = isText ? 'password' : 'text';
        eyeBtn.innerHTML = isText ? this._eyeClosedSvg() : this._eyeOpenSvg();
      });
    });

    /* sync form state on input change */
    const fieldMap = {
      'profile-field-name':              'name',
      'profile-field-email':             'email',
      'profile-field-phone':             'phone',
      'profile-field-notificationEmail': 'notificationEmail',
      'profile-field-currentPassword':   'currentPassword',
      'profile-field-newPassword':       'newPassword',
      'profile-field-confirmPassword':   'confirmPassword',
    };
    Object.entries(fieldMap).forEach(([elId, key]) => {
      document.getElementById(elId)?.addEventListener('input', (e) => {
        this._form[key] = e.target.value;
        /* live-update identity card for name / email / phone */
        if (key === 'name') {
          const dn = document.getElementById('profile-display-name');
          if (dn) dn.textContent = e.target.value || '—';
          this._updateAvatarInitials(e.target.value);
        }
        if (key === 'email') {
          const de = document.getElementById('profile-display-email');
          if (de) de.textContent = e.target.value || '—';
        }
        if (key === 'phone') {
          const dp = document.getElementById('profile-display-phone');
          if (dp) dp.textContent = e.target.value || '—';
        }
      });
    });
  },

  /* ── update avatar section without full re-render ───────── */
  _updateAvatarDOM() {
    const wrap = document.getElementById('profile-avatar-wrap');
    if (!wrap) return;
    if (this._picture) {
      wrap.innerHTML = `<img src="${this._esc(this._picture)}" alt="Profile" class="w-24 h-24 rounded-2xl object-cover shadow-elevated ring-4 ring-white" id="profile-avatar-img" />`;
    } else {
      const initials = this._initials(this._form.name);
      wrap.innerHTML = `<div class="w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 grid place-items-center text-white text-2xl font-bold shadow-elevated ring-4 ring-white" id="profile-avatar-initials">${this._esc(initials)}</div>`;
    }
  },

  _updateAvatarInitials(name) {
    const el = document.getElementById('profile-avatar-initials');
    if (el) el.textContent = this._initials(name);
  },

  /* ── photo file handling ───────────────────────────────── */
  _handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size   = 200;
      const canvas = document.createElement('canvas');
      canvas.width  = size;
      canvas.height = size;
      const ctx   = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w     = img.width  * scale;
      const h     = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      const b64 = canvas.toDataURL('image/jpeg', 0.75);
      this._picture = b64;
      this._updateAvatarDOM();
      this._savePicture(b64);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  },

  async _savePicture(b64) {
    this._picSaving = true;
    const btn = document.getElementById('profile-change-photo-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await fetch('/api/profile', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ picture: b64 }),
      });
    } catch { /* ignore */ }
    this._picSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Change Photo'; }
  },

  /* ── save profile ──────────────────────────────────────── */
  async _save() {
    const f = this._form;

    if (f.newPassword && f.newPassword !== f.confirmPassword) {
      Utils.showToast('New passwords do not match', 'error');
      return;
    }

    this._saving = true;
    const btn = document.getElementById('profile-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      const res = await fetch('/api/profile', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...f }),
      });

      if (res.ok) {
        window.Utils?.showToast('Profile updated');
        // Clear password fields
        this._form.currentPassword = '';
        this._form.newPassword     = '';
        this._form.confirmPassword = '';
        // Patch cached me object
        if (this._me) {
          this._me.name  = f.name;
          this._me.email = f.email;
          this._me.phone = f.phone;
        }
        // Re-render to reflect cleared password fields
        this._renderContent();
      } else {
        const data = await res.json().catch(() => ({}));
        Utils.showToast(data.error || 'Failed to save profile', 'error');
      }
    } catch (err) {
      Utils.showToast('Network error: ' + err.message, 'error');
    }

    this._saving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
  },
};
