window.Pages = window.Pages || {};

window.Pages.users = (() => {
  /* ── constants ──────────────────────────────────────────────────────── */
  const ROLES = ['Admin', 'User', 'HOD'];

  const ROLE_STYLE = {
    Admin: 'bg-amber-50 text-amber-700 border-amber-200',
    User:  'bg-primary-50 text-primary-700 border-primary-200',
    HOD:   'bg-violet-50 text-violet-700 border-violet-200',
  };

  /* ── state ──────────────────────────────────────────────────────────── */
  let _users       = [];
  let _departments = [];
  let _search      = '';
  let _isAdmin     = false;

  // add / edit modal
  let _modalOpen      = false;
  let _editingUser    = null;   // null = add, object = edit
  let _form           = {};
  let _picture        = null;
  let _pictureChanged = false;
  let _saving         = false;

  // bulk CSV inside add modal
  let _bulkFile   = null;
  let _bulkSaving = false;
  let _bulkMsg    = '';

  // set-password modal
  let _pwdModalOpen = false;
  let _pwdUser      = null;
  let _pwdPassword  = '';
  let _pwdConfirm   = '';
  let _pwdShowPass  = false;
  let _pwdShowConf  = false;
  let _pwdSaving    = false;
  let _pwdError     = '';

  /* ── helpers ────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeRoles(roles) {
    if (Array.isArray(roles)) return roles;
    if (typeof roles === 'string') return roles.split(',').map(r => r.trim()).filter(Boolean);
    return ['User'];
  }

  function avatarHtml(name, picture, size = 9) {
    const ini = (name || 'U').split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'U';
    if (picture) {
      return `<img src="${esc(picture)}" alt="${esc(name)}" class="w-${size} h-${size} rounded-full object-cover" />`;
    }
    return `<div class="w-${size} h-${size} rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white grid place-items-center text-[11px] font-bold">${esc(ini)}</div>`;
  }

  function rolePillsHtml(roles) {
    const ROLE_ICON_SVG = {
      Admin: `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7Z"/></svg>`,
      HOD:   `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
      User:  `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    };
    return normalizeRoles(roles).map(r => {
      const style = ROLE_STYLE[r] || 'bg-slate-100 text-slate-700 border-slate-200';
      const icon  = ROLE_ICON_SVG[r] || '';
      return `<span class="pill border ${esc(style)}">${icon}${esc(r)}</span>`;
    }).join('');
  }

  function filtered() {
    const s = _search.toLowerCase();
    return _users
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .filter(u => {
        if (!s) return true;
        return (
          (u.name       || '').toLowerCase().includes(s) ||
          (u.email      || '').toLowerCase().includes(s) ||
          (u.phone      || '').toLowerCase().includes(s) ||
          (u.department || '').toLowerCase().includes(s)
        );
      });
  }

  function blankForm() {
    return { name: '', email: '', phone: '', department: '', roles: ['User'], password: '', notifEmail: '' };
  }

  /* ── API ────────────────────────────────────────────────────────────── */
  async function loadData() {
    try {
      const [usersData, deptsData] = await Promise.all([
        Utils.apiFetch('/api/users'),
        Utils.apiFetch('/api/departments').catch(() => null),
      ]);
      _users       = Array.isArray(usersData) ? usersData : [];
      _departments = Array.isArray(deptsData)
        ? deptsData
        : [...new Set(_users.map(u => u.department).filter(Boolean))].sort();
    } catch {
      _users       = [];
      _departments = [];
    }
  }

  async function deleteUser(id) {
    if (!Utils.confirm('Delete this user?')) return;
    try {
      await Utils.apiFetch('/api/users?id=' + id, { method: 'DELETE' });
      await loadData();
      renderPage();
      Utils.showToast('User deleted');
    } catch (e) {
      Utils.showToast(e.message || 'Failed to delete user', 'error');
    }
  }

  async function saveUser() {
    if (!_form.name?.trim() || !_form.email?.trim()) {
      Utils.showToast('Name and email are required.', 'error');
      return;
    }
    _saving = true;
    renderModal();

    const payload = { ..._form };
    if (_pictureChanged) payload.picture = _picture;

    try {
      await Utils.apiFetch('/api/users', {
        method: _editingUser ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      _modalOpen      = false;
      _saving         = false;
      _picture        = null;
      _pictureChanged = false;
      await loadData();
      renderPage();
      Utils.showToast(_editingUser ? 'User updated' : 'User added');
    } catch (e) {
      _saving = false;
      renderModal();
      Utils.showToast(e.message || 'Failed to save user', 'error');
    }
  }

  async function uploadBulkUsers() {
    if (!_bulkFile) return;
    _bulkSaving = true;
    _bulkMsg    = '';
    renderModal();

    try {
      const text = await _bulkFile.text();
      const rows = parseUserCSV(text);
      if (!rows.length) {
        _bulkMsg    = 'No valid rows found.';
        _bulkSaving = false;
        renderModal();
        return;
      }
      const res  = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk: rows }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      _bulkMsg    = `Uploaded: ${d.inserted} added${d.errors?.length ? ` · ${d.errors.length} skipped` : ''}`;
      _bulkFile   = null;
      _bulkSaving = false;
      await loadData();
      renderPage();
      renderModal();
    } catch (e) {
      _bulkMsg    = 'Error: ' + e.message;
      _bulkSaving = false;
      renderModal();
    }
  }

  function parseUserCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const header   = lines[0].split(',').map(h => h.trim().toLowerCase());
    const hasHeader = header.includes('email') || header.includes('name');
    const cols     = hasHeader ? header : ['name','email','password','role','user_role','phone','department'];
    const start    = hasHeader ? 1 : 0;
    return lines.slice(start).map(line => {
      const parts = line.split(',');
      const row   = {};
      cols.forEach((c, i) => { row[c] = (parts[i] || '').trim(); });
      return row;
    });
  }

  function downloadUserSample() {
    const csv = 'name,email,password,role,user_role,phone,department\n' +
      'John Doe,john@test.com,pass123,user,user,9876543210,Sales\n' +
      'Jane Smith,jane@test.com,pass123,hod,hod,9876543211,Production\n' +
      'IT Admin,it@test.com,pass123,admin,user,9876543212,IT\n';
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'users-sample.csv';
    a.click();
  }

  async function setPassword() {
    _pwdError = '';
    if (_pwdPassword.length < 6) { _pwdError = 'Password must be at least 6 characters.'; renderPwdModal(); return; }
    if (_pwdPassword !== _pwdConfirm) { _pwdError = 'Passwords do not match.'; renderPwdModal(); return; }
    _pwdSaving = true;
    renderPwdModal();
    try {
      const res = await fetch('/api/users/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: _pwdUser.id, password: _pwdPassword }),
      });
      if (res.ok) {
        _pwdModalOpen = false;
        _pwdSaving    = false;
        renderPwdModal();
        Utils.showToast('Password updated');
      } else {
        const d = await res.json().catch(() => ({}));
        _pwdError  = d.error || 'Something went wrong';
        _pwdSaving = false;
        renderPwdModal();
      }
    } catch (e) {
      _pwdError  = 'Network error: ' + e.message;
      _pwdSaving = false;
      renderPwdModal();
    }
  }

  /* ── photo helper (canvas crop to 200×200) ──────────────────────────── */
  function handlePhotoFile(file) {
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
      _picture        = canvas.toDataURL('image/jpeg', 0.75);
      _pictureChanged = true;
      URL.revokeObjectURL(url);
      renderModal();
    };
    img.src = url;
  }

  /* ── render: main page ──────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const rows = filtered();

    const tableRows = rows.length === 0
      ? `<tr><td colspan="${_isAdmin ? 6 : 5}" class="table-td text-center text-slate-400 py-10">No users found</td></tr>`
      : rows.map(u => {
          const actionCells = _isAdmin ? `
            <td class="table-td">
              <div class="flex gap-1.5 flex-wrap">
                <button data-action="edit"   data-id="${esc(u.id)}" class="pill bg-primary-50 text-primary-700 hover:bg-primary-100 cursor-pointer">Edit</button>
                <button data-action="setpwd" data-id="${esc(u.id)}" class="pill bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer">Set Password</button>
                <button data-action="delete" data-id="${esc(u.id)}" class="pill bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer">Delete</button>
              </div>
            </td>` : '';
          return `
            <tr class="table-row">
              <td class="table-td">
                <div class="flex items-center gap-2.5">
                  ${avatarHtml(u.name, u.picture, 9)}
                  <div>
                    <div class="font-medium text-slate-900">${esc(u.name || 'Unknown')}</div>
                    <div class="text-[11px] text-slate-500">${esc(u.department || '—')}</div>
                  </div>
                </div>
              </td>
              <td class="table-td text-slate-600">${esc(u.email || '—')}</td>
              <td class="table-td text-slate-600">${esc(u.phone || '—')}</td>
              <td class="table-td text-slate-600">${esc(u.department || '—')}</td>
              <td class="table-td"><div class="flex flex-wrap gap-1">${rolePillsHtml(u.roles)}</div></td>
              ${actionCells}
            </tr>`;
        }).join('');

    const addBtnHtml = _isAdmin
      ? `<button id="users-add-btn" class="btn-primary flex items-center gap-1.5 shrink-0">
           <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
           Add User
         </button>`
      : '';

    el.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 w-72 shadow-sm">
            <svg class="w-3.5 h-3.5 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input id="users-search" type="text" value="${esc(_search)}"
              placeholder="Name, Email, Phone, Department…"
              class="bg-transparent border-none outline-none text-[13px] text-slate-700 placeholder:text-slate-400 w-full" />
          </div>
          ${addBtnHtml}
        </div>

        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-slate-50/80">
                <tr>
                  <th class="table-th">User</th>
                  <th class="table-th">Email</th>
                  <th class="table-th">Phone</th>
                  <th class="table-th">Department</th>
                  <th class="table-th">Roles</th>
                  ${_isAdmin ? '<th class="table-th">Action</th>' : ''}
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    /* bind events */
    document.getElementById('users-search')?.addEventListener('input', e => {
      _search = e.target.value;
      renderPage();
    });

    document.getElementById('users-add-btn')?.addEventListener('click', () => {
      _editingUser    = null;
      _form           = blankForm();
      _picture        = null;
      _pictureChanged = false;
      _bulkFile       = null;
      _bulkMsg        = '';
      _modalOpen      = true;
      renderModal();
    });

    el.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = _users.find(x => String(x.id) === String(btn.dataset.id));
        if (!u) return;
        _editingUser    = u;
        _form           = {
          id: u.id, name: u.name || '', email: u.email || '', phone: u.phone || '',
          department: u.department || '', roles: normalizeRoles(u.roles),
          active: u.active !== false, notifEmail: u.notifEmail || '',
        };
        _picture        = u.picture || null;
        _pictureChanged = false;
        _modalOpen      = true;
        renderModal();
      });
    });

    el.querySelectorAll('[data-action="setpwd"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = _users.find(x => String(x.id) === String(btn.dataset.id));
        if (!u) return;
        _pwdUser      = u;
        _pwdPassword  = '';
        _pwdConfirm   = '';
        _pwdShowPass  = false;
        _pwdShowConf  = false;
        _pwdSaving    = false;
        _pwdError     = '';
        _pwdModalOpen = true;
        renderPwdModal();
      });
    });

    el.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteUser(btn.dataset.id);
      });
    });
  }

  /* ── render: add/edit modal ─────────────────────────────────────────── */
  function renderModal() {
    const existing = document.getElementById('users-modal-overlay');
    if (!_modalOpen) {
      if (existing) existing.remove();
      return;
    }

    const isEdit   = !!_editingUser;
    const curRoles = normalizeRoles(_form.roles);

    const initials = (_form.name || 'U').split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'U';

    const photoHtml = _picture
      ? `<img src="${esc(_picture)}" alt="" class="w-14 h-14 rounded-xl object-cover ring-2 ring-slate-100 shadow-sm" />`
      : `<div class="w-14 h-14 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 grid place-items-center text-white text-base font-bold ring-2 ring-slate-100 shadow-sm">${esc(initials)}</div>`;

    const removePhotoBtn = _picture
      ? `<button id="um-remove-photo" type="button" class="text-xs text-red-500 hover:text-red-700 transition">Remove</button>`
      : '';

    const deptOptions = _departments.map(d => `<option value="${esc(d)}" ${_form.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('');

    const rolesHtml = ROLES.map(r => {
      const active = curRoles.includes(r);
      const style  = active ? (ROLE_STYLE[r] || 'bg-primary-50 text-primary-700 border-primary-200') : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600';
      return `<button type="button" data-role="${esc(r)}" class="um-role-btn flex-1 py-2 text-xs rounded-xl border font-medium transition ${esc(style)}">${esc(r)}</button>`;
    }).join('');

    const passwordField = !isEdit ? `
      <div>
        <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Password</label>
        <div class="relative">
          <input id="um-password" type="password" value="${esc(_form.password || '')}"
            placeholder="Enter password"
            class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-10 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition" />
          <button type="button" id="um-toggle-pass" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition" aria-label="Toggle password">
            ${eyeIconSvg(false)}
          </button>
        </div>
      </div>` : '';

    const bulkSection = !isEdit ? `
      <div class="rounded-xl border border-dashed border-slate-200 p-3">
        <div class="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">Bulk Add Users (CSV)</div>
        <div class="flex flex-wrap items-center gap-2">
          <input id="um-bulk-file" type="file" accept=".csv,text/csv"
            class="text-[12px] file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-slate-700 hover:file:bg-slate-50" />
          <button id="um-bulk-upload" class="btn-success !py-1.5 text-xs" ${_bulkSaving || !_bulkFile ? 'disabled' : ''}>
            ${_bulkSaving ? 'Uploading…' : 'Upload CSV'}
          </button>
          <button id="um-bulk-sample" class="btn-secondary !py-1.5 text-xs">Sample</button>
        </div>
        ${_bulkMsg ? `<div class="text-[12px] mt-2 text-slate-600">${esc(_bulkMsg)}</div>` : ''}
        <div class="text-[10px] text-slate-400 mt-1.5">Format: name, email, password, role, user_role, phone, department</div>
      </div>` : '';

    const html = `
      <div id="users-modal-overlay" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div id="users-modal-box" class="bg-white rounded-2xl shadow-2xl w-full max-w-[440px] overflow-hidden">

          <!-- Header -->
          <div class="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-primary-50 text-primary-600 grid place-items-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="flex-1">
              <h2 class="text-[15px] font-semibold text-slate-900">${isEdit ? 'Edit User' : 'Add User'}</h2>
              <p class="text-[11px] text-slate-400 mt-0.5">${isEdit ? 'Update member details' : 'Create a new team member'}</p>
            </div>
            <button id="um-close" class="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Body -->
          <div class="px-6 py-5 space-y-3 overflow-y-auto max-h-[calc(90vh-160px)]">

            <!-- Photo picker -->
            <div class="flex items-center gap-4 pb-1">
              <div class="shrink-0">${photoHtml}</div>
              <div class="flex items-center gap-2">
                <button type="button" id="um-upload-photo-btn" class="btn-secondary !py-1.5 !px-3 text-xs">Upload Photo</button>
                ${removePhotoBtn}
                <input id="um-photo-input" type="file" accept="image/*" class="hidden" />
              </div>
            </div>

            <!-- Row 1: Name + Email -->
            <div class="grid grid-cols-2 gap-3">
              ${uFieldHtml('um-name', 'Full Name', 'Enter full name', _form.name || '', 'text')}
              ${uFieldHtml('um-email', 'Email', 'Enter login email', _form.email || '', 'email', 'Login')}
            </div>

            <!-- Row 2: Notification Email + Phone -->
            <div class="grid grid-cols-2 gap-3">
              ${uFieldHtml('um-notifEmail', 'Notification Email', 'real email for notifications', _form.notifEmail || '', 'text', 'Real Gmail for task notifications')}
              ${uFieldHtml('um-phone', 'Phone Number', 'Enter phone number', _form.phone || '', 'text')}
            </div>

            <!-- Row 3: Department + Password (add only) -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Department</label>
                  <button type="button" id="um-dept-add-btn" title="Add new department"
                    style="width:20px;height:20px;border-radius:50%;background:#C4714A;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;flex-shrink:0;">+</button>
                </div>
                <div class="relative">
                  <select id="um-department"
                    class="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition">
                    <option value="">e.g. Sales, Production</option>
                    ${deptOptions}
                  </select>
                  <svg class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
                <div id="um-dept-new-row" style="display:none;margin-top:6px;display:none;">
                  <div style="display:flex;gap:6px;">
                    <input id="um-dept-new-input" type="text" placeholder="New department name"
                      style="flex:1;padding:6px 10px;border:1.5px solid #C4714A;border-radius:8px;font-size:12.5px;outline:none;" />
                    <button type="button" id="um-dept-new-save"
                      style="padding:6px 12px;background:#C4714A;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Add</button>
                    <button type="button" id="um-dept-new-cancel"
                      style="padding:6px 10px;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;font-size:12px;cursor:pointer;">✕</button>
                  </div>
                </div>
              </div>
              ${passwordField}
            </div>

            <!-- Roles -->
            <div>
              <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Roles</div>
              <div class="flex gap-2">${rolesHtml}</div>
            </div>

            ${bulkSection}
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <button id="um-cancel" class="btn-secondary">Cancel</button>
            <button id="um-save" class="btn-primary" ${_saving ? 'disabled' : ''}>${_saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>`;

    if (existing) {
      existing.outerHTML = html;
    } else {
      document.body.insertAdjacentHTML('beforeend', html);
    }

    bindModal();
  }

  function uFieldHtml(id, label, placeholder, value, type, sublabel) {
    const sublabelHtml = sublabel ? `<span class="normal-case font-normal text-slate-400 ml-1">(${esc(sublabel)})</span>` : '';
    return `
      <div>
        <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
          ${esc(label)}${sublabelHtml}
        </label>
        <input id="${esc(id)}" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}"
          class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition" />
      </div>`;
  }

  function eyeIconSvg(open) {
    if (open) {
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
    }
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }

  function bindModal() {
    const overlay = document.getElementById('users-modal-overlay');
    if (!overlay) return;

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('um-close')?.addEventListener('click', closeModal);
    document.getElementById('um-cancel')?.addEventListener('click', closeModal);

    // Photo upload
    document.getElementById('um-upload-photo-btn')?.addEventListener('click', () => {
      document.getElementById('um-photo-input')?.click();
    });
    document.getElementById('um-photo-input')?.addEventListener('change', e => {
      handlePhotoFile(e.target.files?.[0]);
      e.target.value = '';
    });
    document.getElementById('um-remove-photo')?.addEventListener('click', () => {
      _picture        = null;
      _pictureChanged = true;
      renderModal();
    });

    // Text inputs — keep _form in sync
    const inputMap = {
      'um-name':        'name',
      'um-email':       'email',
      'um-notifEmail':  'notifEmail',
      'um-phone':       'phone',
    };
    Object.entries(inputMap).forEach(([elId, key]) => {
      document.getElementById(elId)?.addEventListener('input', e => { _form[key] = e.target.value; });
    });

    document.getElementById('um-department')?.addEventListener('change', e => { _form.department = e.target.value; });

    /* Department: + add new */
    document.getElementById('um-dept-add-btn')?.addEventListener('click', () => {
      const row = document.getElementById('um-dept-new-row');
      if (row) { row.style.display = row.style.display === 'none' || !row.style.display ? 'block' : 'none'; }
      setTimeout(() => document.getElementById('um-dept-new-input')?.focus(), 50);
    });
    document.getElementById('um-dept-new-cancel')?.addEventListener('click', () => {
      const row = document.getElementById('um-dept-new-row');
      if (row) row.style.display = 'none';
      const inp = document.getElementById('um-dept-new-input');
      if (inp) inp.value = '';
    });
    document.getElementById('um-dept-new-save')?.addEventListener('click', () => {
      const inp = document.getElementById('um-dept-new-input');
      const val = (inp?.value || '').trim();
      if (!val) { inp?.focus(); return; }
      /* add to local list if not already there */
      if (!_departments.includes(val)) _departments.push(val);
      /* add option to select and auto-select it */
      const sel = document.getElementById('um-department');
      if (sel) {
        const exists = [...sel.options].some(o => o.value === val);
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = val; opt.textContent = val;
          sel.appendChild(opt);
        }
        sel.value = val;
        _form.department = val;
      }
      /* hide input row */
      document.getElementById('um-dept-new-row').style.display = 'none';
      if (inp) inp.value = '';
    });
    document.getElementById('um-dept-new-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('um-dept-new-save')?.click(); }
      if (e.key === 'Escape') document.getElementById('um-dept-new-cancel')?.click();
    });

    // Password field + toggle (add mode only)
    document.getElementById('um-password')?.addEventListener('input', e => { _form.password = e.target.value; });
    const passToggleBtn = document.getElementById('um-toggle-pass');
    const passInput     = document.getElementById('um-password');
    if (passToggleBtn && passInput) {
      let passVisible = false;
      passToggleBtn.addEventListener('click', () => {
        passVisible      = !passVisible;
        passInput.type   = passVisible ? 'text' : 'password';
        passToggleBtn.innerHTML = eyeIconSvg(passVisible);
      });
    }

    // Role toggles
    overlay.querySelectorAll('.um-role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r   = btn.dataset.role;
        const cur = normalizeRoles(_form.roles);
        _form.roles = cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r];
        if (_form.roles.length === 0) _form.roles = [r]; // keep at least one
        renderModal();
      });
    });

    // Bulk CSV
    document.getElementById('um-bulk-file')?.addEventListener('change', e => {
      _bulkFile = e.target.files?.[0] || null;
      _bulkMsg  = '';
      renderModal();
    });
    document.getElementById('um-bulk-upload')?.addEventListener('click', uploadBulkUsers);
    document.getElementById('um-bulk-sample')?.addEventListener('click', downloadUserSample);

    // Save
    document.getElementById('um-save')?.addEventListener('click', saveUser);
  }

  function closeModal() {
    _modalOpen      = false;
    _saving         = false;
    _bulkFile       = null;
    _bulkMsg        = '';
    _picture        = null;
    _pictureChanged = false;
    renderModal();
  }

  /* ── render: set-password modal ─────────────────────────────────────── */
  function renderPwdModal() {
    const existing = document.getElementById('pwd-modal-overlay');
    if (!_pwdModalOpen) {
      if (existing) existing.remove();
      return;
    }

    const mismatch    = _pwdConfirm.length > 0 && _pwdPassword !== _pwdConfirm;
    const saveDisabled = _pwdSaving || mismatch;

    const html = `
      <div id="pwd-modal-overlay" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div id="pwd-modal-box" class="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
          <h2 class="text-lg font-semibold mb-1">Set Password</h2>
          <p class="text-sm text-slate-500 mb-4">${esc(_pwdUser?.name || '')}</p>
          <div class="space-y-4">

            <!-- New Password -->
            <div>
              <label class="label">New Password</label>
              <div class="relative">
                <input id="pwd-new" type="${_pwdShowPass ? 'text' : 'password'}" value="${esc(_pwdPassword)}"
                  class="input pr-10" placeholder="Min. 6 characters" />
                <button type="button" id="pwd-toggle-new"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  ${eyeIconSvg(_pwdShowPass)}
                </button>
              </div>
            </div>

            <!-- Confirm Password -->
            <div>
              <label class="label">Confirm Password</label>
              <div class="relative">
                <input id="pwd-confirm" type="${_pwdShowConf ? 'text' : 'password'}" value="${esc(_pwdConfirm)}"
                  class="input pr-10 ${mismatch ? 'border-red-400 bg-red-50' : ''}"
                  placeholder="Re-enter password" />
                <button type="button" id="pwd-toggle-conf"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  ${eyeIconSvg(_pwdShowConf)}
                </button>
              </div>
              ${mismatch ? '<p class="text-red-500 text-xs mt-1">Passwords do not match</p>' : ''}
            </div>

            ${_pwdError ? `<p class="text-red-500 text-sm">${esc(_pwdError)}</p>` : ''}
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <button id="pwd-cancel" class="btn-secondary">Cancel</button>
            <button id="pwd-save" class="btn-primary" ${saveDisabled ? 'disabled' : ''}>${_pwdSaving ? 'Saving...' : 'Set Password'}</button>
          </div>
        </div>
      </div>`;

    if (existing) {
      existing.outerHTML = html;
    } else {
      document.body.insertAdjacentHTML('beforeend', html);
    }

    bindPwdModal();
  }

  function bindPwdModal() {
    const overlay = document.getElementById('pwd-modal-overlay');
    if (!overlay) return;

    overlay.addEventListener('click', e => { if (e.target === overlay) closePwdModal(); });
    document.getElementById('pwd-cancel')?.addEventListener('click', closePwdModal);

    document.getElementById('pwd-new')?.addEventListener('input', e => {
      _pwdPassword = e.target.value;
      // live re-render only if confirm is non-empty (to update mismatch indicator)
      if (_pwdConfirm.length > 0) renderPwdModal();
    });
    document.getElementById('pwd-confirm')?.addEventListener('input', e => {
      _pwdConfirm = e.target.value;
      renderPwdModal();
    });

    document.getElementById('pwd-toggle-new')?.addEventListener('click', () => {
      _pwdShowPass = !_pwdShowPass;
      renderPwdModal();
    });
    document.getElementById('pwd-toggle-conf')?.addEventListener('click', () => {
      _pwdShowConf = !_pwdShowConf;
      renderPwdModal();
    });

    document.getElementById('pwd-save')?.addEventListener('click', setPassword);
  }

  function closePwdModal() {
    _pwdModalOpen = false;
    _pwdSaving    = false;
    renderPwdModal();
  }

  /* ── public entry point ─────────────────────────────────────────────── */
  return {
    async render() {
      const el = document.getElementById('main-content');
      if (!el) return;

      // Determine admin status from the current session user
      const user      = window.currentUser;
      const userRoles = Array.isArray(user?.roles)
        ? user.roles
        : (typeof user?.roles === 'string' ? user.roles.split(',').map(r => r.trim()) : []);
      _isAdmin = userRoles.includes('Admin') || userRoles.includes('HOD');

      // Reset state on each navigation to this page
      _search         = '';
      _modalOpen      = false;
      _pwdModalOpen   = false;
      _editingUser    = null;
      _form           = blankForm();
      _picture        = null;
      _pictureChanged = false;
      _saving         = false;
      _bulkFile       = null;
      _bulkMsg        = '';
      _pwdPassword    = '';
      _pwdConfirm     = '';
      _pwdError       = '';

      el.innerHTML = `<div class="flex items-center justify-center h-48 text-slate-400 text-sm">Loading users…</div>`;

      await loadData();
      renderPage();
    },
  };
})();
