window.Utils = {

  /* ── API fetch with timeout ─────────────────────────────────────── */
  // 45s (not 15s) because several writes (PR/PO/GRN/Proforma creation) chain
  // multiple sequential Google Sheets + Drive API calls plus a deliberate
  // recalculation pause server-side — comfortably over 15s on a slow day,
  // which was surfacing as a false "Request timed out" even though the
  // server-side write had actually gone through.
  async apiFetch(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        ...opts,
      });
      clearTimeout(timer);
      if (res.status === 401) { window.location.hash = '#login'; return null; }
      // A proxy/hosting-layer error (Hostinger, or Node itself crashing mid-
      // request) doesn't return JSON — it returns an HTML or plain-text error
      // page. Calling res.json() directly on that throws a raw browser
      // "Unexpected token '<'... is not valid JSON" SyntaxError, which used
      // to surface to users completely unexplained. Parse as text first so a
      // non-JSON body becomes a normal, readable error instead of a crash.
      const raw = await res.text();
      let data = null;
      if (raw) {
        try { data = JSON.parse(raw); }
        catch { throw new Error(res.ok ? 'Server returned an unexpected response — please try again' : `Server error (HTTP ${res.status}) — please try again`); }
      }
      if (!res.ok) throw new Error(data?.error || 'Error');
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('Request timed out');
      throw e;
    }
  },

  /* ── Enter-key guard for the big creation forms ─────────────────── */
  // A form full of text inputs with one submit button fires the browser's
  // IMPLICIT submission on Enter — so typing an item code and hitting Enter
  // was creating the whole PR/PO/GRN half-filled ("automatic save"). Only a
  // real click on the submit button may submit; Enter in a textarea (new
  // line) and on a focused button (click) still work.
  guardEnterSubmit(form, onEnterInput) {
    if (!form) return;
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      if (onEnterInput) onEnterInput(e.target);
    });
  },

  /* ── Toast notification ─────────────────────────────────────────── */
  showToast(msg, type = 'success') {
    // Stack management — remove old ones after 2
    const existing = document.querySelectorAll('.utils-toast');
    if (existing.length >= 3) existing[0].remove();

    const cfg = {
      success: { bg: '#f0fdf4', border: '#86efac', text: '#15803d', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>` },
      error:   { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>` },
      warning: { bg: '#fffbeb', border: '#fcd34d', text: '#b45309', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` },
      info:    { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8', icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>` },
    };
    const c = cfg[type] || cfg.success;

    const toast = document.createElement('div');
    toast.className = 'utils-toast';
    toast.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'z-index:9999',
      'display:flex',
      'align-items:flex-start',
      'gap:10px',
      'padding:13px 16px',
      'border-radius:12px',
      `background:${c.bg}`,
      `border:1.5px solid ${c.border}`,
      'box-shadow:0 8px 32px rgba(0,0,0,.12)',
      'font-size:13px',
      'font-weight:500',
      `color:${c.text}`,
      'max-width:320px',
      'min-width:220px',
      'transform:translateX(calc(100% + 32px))',
      'transition:transform .32s cubic-bezier(.16,1,.3,1),opacity .32s',
      'opacity:0',
      'cursor:default',
      'user-select:none',
    ].join(';');

    toast.innerHTML = `
      <span style="flex-shrink:0;margin-top:1px;">${c.icon}</span>
      <span style="flex:1;line-height:1.45;">${String(msg).replace(/</g,'&lt;')}</span>
      <button onclick="this.parentElement.remove()" aria-label="Close" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:${c.text};opacity:.5;padding:0 0 0 4px;line-height:1;margin-top:1px;display:flex;align-items:center;" title="Dismiss"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity   = '1';
      });
    });
    const hide = () => {
      toast.style.transform = 'translateX(calc(100% + 32px))';
      toast.style.opacity   = '0';
      setTimeout(() => toast.remove(), 340);
    };
    setTimeout(hide, 3200);
  },

  /* ── Confirm dialog (replaces native confirm()) ─────────────────── */
  showConfirm(msg, {
    title       = 'Confirm Action',
    confirmText = 'Confirm',
    cancelText  = 'Cancel',
    danger      = false,
  } = {}) {
    return new Promise((resolve) => {
      const existing = document.getElementById('utils-confirm-overlay');
      if (existing) existing.remove();

      const iconHtml = danger
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-strong)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

      const iconBg  = danger ? '#fef2f2' : 'var(--color-primary-light)';
      const btnBg   = danger ? '#dc2626' : 'var(--color-primary)';
      const btnHover= danger ? '#b91c1c' : 'var(--color-primary-dark)';
      const btnText = danger ? '#fff' : 'var(--color-primary-text)';

      const overlay = document.createElement('div');
      overlay.id = 'utils-confirm-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:grid;place-items:center;padding:16px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';

      overlay.innerHTML = `
        <div id="utils-confirm-box" style="background:#fff;border-radius:18px;width:100%;max-width:380px;box-shadow:0 24px 64px rgba(0,0,0,.2);overflow:hidden;animation:pop-in 220ms cubic-bezier(.16,1,.3,1);">
          <div style="padding:24px 24px 20px;display:flex;gap:14px;align-items:flex-start;">
            <div style="width:42px;height:42px;border-radius:12px;background:${iconBg};display:grid;place-items:center;flex-shrink:0;">${iconHtml}</div>
            <div style="flex:1;min-width:0;padding-top:2px;">
              <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:5px;">${String(title).replace(/</g,'&lt;')}</div>
              <div style="font-size:13px;color:#64748b;line-height:1.5;">${String(msg).replace(/</g,'&lt;')}</div>
            </div>
          </div>
          <div style="padding:0 24px 20px;display:flex;justify-content:flex-end;gap:10px;">
            <button id="utils-confirm-cancel" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background='#fff'">${String(cancelText).replace(/</g,'&lt;')}</button>
            <button id="utils-confirm-ok" style="padding:9px 22px;border-radius:9px;border:none;background:${btnBg};color:${btnText};font-size:13px;font-weight:700;cursor:pointer;transition:background .15s;" onmouseenter="this.style.background='${btnHover}'" onmouseleave="this.style.background='${btnBg}'">${String(confirmText).replace(/</g,'&lt;')}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity .2s';
        setTimeout(() => overlay.remove(), 210);
        resolve(result);
      };

      document.getElementById('utils-confirm-ok').addEventListener('click',     () => cleanup(true));
      document.getElementById('utils-confirm-cancel').addEventListener('click',  () => cleanup(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', esc); }
        if (e.key === 'Enter')  { cleanup(true);  document.removeEventListener('keydown', esc); }
      });
    });
  },

  /* ── Prompt dialog (text input — replaces native prompt()) ──────── */
  showPrompt(msg, {
    title       = 'Enter Value',
    placeholder = '',
    value       = '',
    confirmText = 'Save',
    cancelText  = 'Cancel',
  } = {}) {
    return new Promise((resolve) => {
      const existing = document.getElementById('utils-prompt-overlay');
      if (existing) existing.remove();
      const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const overlay = document.createElement('div');
      overlay.id = 'utils-prompt-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10001;display:grid;place-items:center;padding:16px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:18px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,.2);overflow:hidden;animation:pop-in 220ms cubic-bezier(.16,1,.3,1);">
          <div style="padding:24px 24px 4px;">
            <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:5px;">${escHtml(title)}</div>
            <div style="font-size:13px;color:#64748b;line-height:1.5;">${escHtml(msg)}</div>
          </div>
          <div style="padding:16px 24px 4px;">
            <input id="utils-prompt-input" type="text" value="${escHtml(value)}" placeholder="${escHtml(placeholder)}"
              style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;color:#1e293b;outline:none;" />
            <div id="utils-prompt-err" style="display:none;font-size:12px;color:#dc2626;margin-top:6px;"></div>
          </div>
          <div style="padding:16px 24px 20px;display:flex;justify-content:flex-end;gap:10px;">
            <button id="utils-prompt-cancel" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">${escHtml(cancelText)}</button>
            <button id="utils-prompt-ok" style="padding:9px 22px;border-radius:9px;border:none;background:var(--color-primary);color:var(--color-primary-text,#fff);font-size:13px;font-weight:700;cursor:pointer;">${escHtml(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const input = document.getElementById('utils-prompt-input');
      setTimeout(() => { input?.focus(); input?.select(); }, 60);

      const cleanup = (result) => {
        document.removeEventListener('keydown', onKey);
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity .2s';
        setTimeout(() => overlay.remove(), 210);
        resolve(result);
      };
      const submit = () => {
        const val = (input?.value || '').trim();
        if (!val) {
          const err = document.getElementById('utils-prompt-err');
          if (err) { err.textContent = 'Please enter a value'; err.style.display = 'block'; }
          input?.focus();
          return;
        }
        cleanup(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(null);
        if (e.key === 'Enter' && document.getElementById('utils-prompt-overlay')) { e.preventDefault(); submit(); }
      };

      document.getElementById('utils-prompt-ok').addEventListener('click', submit);
      document.getElementById('utils-prompt-cancel').addEventListener('click', () => cleanup(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
      document.addEventListener('keydown', onKey);
    });
  },

  /* ── Departments master ─────────────────────────────────────────── */
  // Every Department dropdown in the app (Users, Daily Task, IMS Inward/
  // Outward, PR Creation, PO Creation) is built from this one list, served by
  // GET /api/departments. Each of those pages used to hardcode its own list, so
  // the same shop floor was spelled differently depending on where you were
  // standing. Cached per page-load and shared across pages; addDepartment()
  // refreshes the cache so a department added on one form is immediately
  // present in the dropdown of the next.
  _deptCache: null,
  _deptPromise: null,
  DEPT_ADD_NEW: '__add_new__',

  async getDepartments(force = false) {
    if (force) { this._deptCache = null; this._deptPromise = null; }
    if (this._deptCache) return this._deptCache;
    if (!this._deptPromise) {
      this._deptPromise = this.apiFetch('/api/departments')
        .then(list => { this._deptCache = Array.isArray(list) ? list : []; return this._deptCache; })
        .catch(() => { this._deptPromise = null; return []; });
    }
    return this._deptPromise;
  },

  // The cached master list, for views that build their own markup from it
  // rather than using deptOptionsHtml(). Empty until getDepartments() /
  // setDepartments() has filled the cache — see hasDepartments().
  departments() {
    return (this._deptCache || []).slice();
  },

  // True once the master list is in hand — for views built synchronously from
  // the cache, which need to know whether to re-render after a cold-start fetch.
  hasDepartments() {
    return Array.isArray(this._deptCache) && this._deptCache.length > 0;
  },

  // Primes the cache from a response that already carried the master list
  // (/api/ims/masters, /api/po-creation/masters, /api/pr-creation/masters all
  // include it) — saves those pages a second round-trip to /api/departments.
  setDepartments(list) {
    if (!Array.isArray(list) || !list.length) return this._deptCache || [];
    this._deptCache = list.slice();
    this._deptPromise = Promise.resolve(this._deptCache);
    return this._deptCache;
  },

  // Adds to the master list, so it shows up everywhere — not just in the
  // dropdown it was typed into. Throws (with the server's message) on a
  // duplicate name so the caller can surface it.
  async addDepartment(name) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Department name is required');
    const data = await this.apiFetch('/api/departments', {
      method: 'POST',
      body: JSON.stringify({ name: clean }),
    });
    this._deptCache = Array.isArray(data?.departments) ? data.departments : (this._deptCache || []).concat(clean);
    this._deptPromise = Promise.resolve(this._deptCache);
    return this._deptCache;
  },

  // <option> markup for a Department <select>. Call after getDepartments() has
  // resolved (or re-render once it does) — with an empty cache it still renders
  // the placeholder and the "+ Add new department" row, never an empty box.
  deptOptionsHtml(selected = '', { placeholder = 'Select…', addNew = true, extra = [] } = {}) {
    const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const list = (this._deptCache || []).slice();
    // A department stored on an old record but since removed from the master
    // list must still show as the current selection instead of silently
    // resetting the field to blank. Matched case-insensitively: an old record
    // holding "PACKING DEPT." must select the master's "Packing Dept." rather
    // than adding a second, identical-looking option beside it.
    const has = (v) => list.some(d => String(d).toLowerCase() === String(v).toLowerCase());
    [].concat(extra, selected ? [selected] : []).forEach(v => { if (v && !has(v)) list.push(v); });
    // ...and the option that renders as selected is matched the same way.
    const isPicked = (d) => selected != null && String(d).toLowerCase() === String(selected).toLowerCase();
    return (placeholder != null ? `<option value="">${escHtml(placeholder)}</option>` : '')
      + list.map(d => `<option value="${escHtml(d)}"${isPicked(d) ? ' selected' : ''}>${escHtml(d)}</option>`).join('')
      + (addNew ? `<option value="${this.DEPT_ADD_NEW}">+ Add new department</option>` : '');
  },

  // Rebuilds a live <select>'s options in place, preserving the current pick.
  fillDeptSelect(sel, selected = null, opts = {}) {
    if (!sel) return;
    const keep = selected != null ? selected : sel.value;
    sel.innerHTML = this.deptOptionsHtml(keep === this.DEPT_ADD_NEW ? '' : keep, opts);
    if (keep && keep !== this.DEPT_ADD_NEW) {
      // Assigning the stored string straight to .value silently blanks the field
      // when the record spells the department in a different case than the master
      // does — take the option's own value instead.
      const match = [...sel.options].find(o => o.value.toLowerCase() === String(keep).toLowerCase());
      sel.value = match ? match.value : keep;
    }
  },

  // Wires the "+ Add new department" option on a Department <select>: asks for
  // the name, saves it to the master list, then re-fills and selects it.
  // onChange(value) fires for real picks only (never for the add-new sentinel).
  bindDeptSelect(sel, onChange, opts = {}) {
    if (!sel || sel.dataset.deptBound === '1') return;
    sel.dataset.deptBound = '1';
    let last = sel.value === this.DEPT_ADD_NEW ? '' : sel.value;
    sel.addEventListener('change', async () => {
      if (sel.value !== this.DEPT_ADD_NEW) {
        last = sel.value;
        if (typeof onChange === 'function') onChange(sel.value);
        return;
      }
      sel.value = last; // never leave the sentinel showing in the closed select
      const name = await this.showPrompt(
        'It will be added to the department list and become available in every Department dropdown.',
        { title: 'Add New Department', placeholder: 'e.g. Circle Dept.', confirmText: 'Add' }
      );
      if (!name) return;
      try {
        await this.addDepartment(name);
        this.fillDeptSelect(sel, name.trim(), opts);
        last = sel.value;
        if (typeof onChange === 'function') onChange(sel.value);
        this.showToast('Department added');
      } catch (e) {
        this.showToast(e.message || 'Failed to add department', 'error');
      }
    });
  },

  /* ── Page-level loader ──────────────────────────────────────────── */
  showLoader(msg = 'Loading…') {
    const existing = document.getElementById('utils-page-loader');
    if (existing) { existing.querySelector('#utils-loader-msg').textContent = msg; return; }
    const el = document.createElement('div');
    el.id = 'utils-page-loader';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.75);z-index:9990;display:grid;place-items:center;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;">
        <div style="width:44px;height:44px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;"></div>
        <div id="utils-loader-msg" style="font-size:13px;font-weight:500;color:#64748b;">${String(msg).replace(/</g,'&lt;')}</div>
      </div>`;
    document.body.appendChild(el);
  },

  hideLoader() {
    const el = document.getElementById('utils-page-loader');
    if (!el) return;
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  },

  /* ── Inline skeleton block ──────────────────────────────────────── */
  skeleton(rows = 4) {
    const row = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;"><div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;flex-shrink:0;"></div><div style="flex:1;"><div style="height:11px;border-radius:4px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;margin-bottom:6px;width:60%;"></div><div style="height:10px;border-radius:4px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;width:40%;"></div></div></div>';
    return `<style>@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}</style>
      <div style="padding:20px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;">${row.repeat(rows)}</div>`;
  },

  /* ── Date helpers ───────────────────────────────────────────────── */
  formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatDateTime(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  /* ── Photo helpers ──────────────────────────────────────────────── */
  // The avatar stored in the DB is a 512px square crop. This returns the
  // UNCROPPED original as a data URL so the server can archive it on Drive.
  // Anything over ~4MB is downscaled to 1600px first — a raw phone photo
  // base64-encodes ~33% larger and would push the request past the server's
  // 10mb JSON limit.
  readOriginalImage(file, maxBytes = 4 * 1024 * 1024, maxEdge = 1600) {
    return new Promise((resolve) => {
      if (!file) return resolve(null);
      if (file.size <= maxBytes) {
        // Small enough — ship the untouched bytes, no re-encode, no quality loss.
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result || null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale  = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  },

  /* ── Owner-only Delete ─────────────────────────────────────────────
     Every module's list shows a Delete alongside its Cancel, but only for
     the one account SUPER_ADMIN_EMAIL names in server.js — not Admin, not
     HOD, and not grantable from Users → Access. isSuperAdmin rides on the
     session response; the routes check it again server-side, so hiding the
     button here is presentation, never the actual protection. */
  isOwner() { return !!window.currentUser?.isSuperAdmin; },

  // Returns '' for everyone else, so a row can concatenate it unconditionally.
  ownerDeleteBtn(cls, dataName, value) {
    if (!this.isOwner()) return '';
    const safe = String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<button type="button" class="' + cls + '" data-' + dataName + '="' + safe + '"'
      + ' style="border:none;background:transparent;color:#b91c1c;cursor:pointer;font-size:12.5px;font-weight:700;padding:2px 6px;margin-left:2px;">Delete</button>';
  },

  // Cancel keeps the record and its trail; this takes the row out for good, so
  // the wording says so rather than reusing the Cancel copy.
  ownerDeleteConfirm(what) {
    return this.showConfirm(
      what + ' will be deleted outright — the row is removed, not marked Cancelled. This cannot be undone.',
      { title: 'Delete permanently', confirmText: 'Delete', danger: true },
    );
  },

  /* ── Legacy (kept for backward compat) ─────────────────────────── */
  confirm(msg) { return window.confirm(msg); },
};
