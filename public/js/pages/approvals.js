window.Pages = window.Pages || {};

window.Pages.approvals = {
  /* ── state ─────────────────────────────────────────────── */
  _tab: 'Shift Requests',          // admin: 'Shift Requests' | 'Task Approvals'
  _reviseRequests: [],
  _taskApprovals: [],
  _myRequests: [],
  _seenRevise: new Set(),
  _seenApprovals: new Set(),
  _grantTask: null,
  _granting: false,
  _seenTimer: null,

  /* ── helpers ───────────────────────────────────────────── */
  _hasFeature(feat) {
    const roles = window.currentUser?.roles || [];
    const isAdmin = Array.isArray(roles) ? roles.includes('Admin') || roles.includes('HOD') : String(roles).includes('Admin') || String(roles).includes('HOD');
    if (isAdmin) return true;
    const perms = window.currentUser?.permissions;
    if (!perms || !perms.features) return true;
    const pageFeats = perms.features['approvals'];
    if (!pageFeats) return false;
    return pageFeats.includes(feat);
  },

  _fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  _loadSeen(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
  },

  _saveSeen(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
  },

  _startSeenTimer() {
    clearTimeout(this._seenTimer);
    this._seenTimer = setTimeout(() => {
      if (this._tab === 'Shift Requests') {
        const updated = new Set([...this._seenRevise, ...this._reviseRequests.map(r => r.id)]);
        this._seenRevise = updated;
        this._saveSeen('seen_revise_ids', updated);
      } else if (this._tab === 'Task Approvals') {
        const updated = new Set([...this._seenApprovals, ...this._taskApprovals.map(r => r.id)]);
        this._seenApprovals = updated;
        this._saveSeen('seen_approval_ids', updated);
      }
      this._renderContent();
    }, 6000);
  },

  /* ── fetch data ────────────────────────────────────────── */
  async _fetchAdmin() {
    const [r1, r2] = await Promise.all([
      fetch('/api/delegations?filter=revise_requested'),
      fetch('/api/delegations?filter=approval_required'),
    ]);
    this._reviseRequests = r1.ok ? (await r1.json()) : [];
    this._taskApprovals  = r2.ok ? (await r2.json()) : [];
  },

  async _fetchUser() {
    const res = await fetch('/api/delegations?myRevise=true');
    this._myRequests = res.ok ? (await res.json()) : [];
  },

  /* ── API actions ───────────────────────────────────────── */
  async _grantRevise(task) {
    this._granting = true;
    this._renderGrantModal();
    try {
      const res = await fetch('/api/delegations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status: 'revise', _grantRevise: true }),
      });
      if (!res.ok) throw new Error('Server error ' + res.status);
    } catch (err) {
      console.error('Grant revise failed:', err);
      if (window.Utils?.showToast) Utils.showToast('Failed to grant revise. Try again.', 'error');
    } finally {
      this._granting = false;
      this._grantTask = null;
      document.getElementById('grant-modal-overlay')?.remove();
    }
    await this._refresh();
  },

  async _denyRevise(task) {
    if (!await Utils.showConfirm('This will send the task back for revision.', { title: 'Deny Request', confirmText: 'Deny', danger: true })) return;
    try {
      const res = await fetch('/api/delegations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status: 'pending', _denyRevise: true }),
      });
      if (!res.ok) throw new Error('Server error ' + res.status);
    } catch (err) {
      console.error('Deny revise failed:', err);
      if (window.Utils?.showToast) Utils.showToast('Failed to deny request. Try again.', 'error');
    }
    await this._refresh();
  },

  async _approveTask(task) {
    try {
      const res = await fetch('/api/delegations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status: 'pending', approval: 'Approved' }),
      });
      if (!res.ok) throw new Error('Server error ' + res.status);
    } catch (err) {
      console.error('Approve failed:', err);
      if (window.Utils?.showToast) Utils.showToast('Failed to approve. Try again.', 'error');
    }
    await this._refresh();
  },

  async _rejectTask(task) {
    if (!await Utils.showConfirm('The task will be moved to Revise status.', { title: 'Reject Task', confirmText: 'Reject', danger: true })) return;
    await fetch('/api/delegations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: 'revise' }),
    });
    await this._refresh();
  },

  async _refresh() {
    const user = window.currentUser;
    const isAdmin = user?.roles?.includes('Admin') || user?.roles?.includes('HOD');
    if (isAdmin) {
      await this._fetchAdmin();
    } else {
      await this._fetchUser();
    }
    this._renderContent();
  },

  /* ── render entry ──────────────────────────────────────── */
  async render() {
    const el = document.getElementById('main-content');
    const user = window.currentUser;
    const isAdmin = user?.roles?.includes('Admin') || user?.roles?.includes('HOD');

    // Load seen sets from localStorage
    this._seenRevise    = this._loadSeen('seen_revise_ids');
    this._seenApprovals = this._loadSeen('seen_approval_ids');

    // Reset tab default per role
    this._tab = isAdmin ? 'Shift Requests' : 'My Requests';
    this._grantTask = null;
    this._granting  = false;

    // Initial skeleton
    el.innerHTML = '<div class="space-y-5 animate-fade-in" id="approvals-root"><div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div></div>';

    // Fetch
    if (isAdmin) {
      await this._fetchAdmin();
    } else {
      await this._fetchUser();
    }

    this._renderContent();
  },

  /* ── main content render ───────────────────────────────── */
  _renderContent() {
    const root = document.getElementById('approvals-root');
    if (!root) return;

    const user = window.currentUser;
    const isAdmin = user?.roles?.includes('Admin') || user?.roles?.includes('HOD');

    if (isAdmin) {
      root.innerHTML = this._buildAdminView();
      this._bindAdminEvents();
      this._startSeenTimer();
    } else {
      root.innerHTML = this._buildUserView();
      // no events needed for user view (read-only table)
    }

    // Re-attach grant modal if open
    if (this._grantTask) {
      this._renderGrantModal();
    }
  },

  /* ── ADMIN VIEW ────────────────────────────────────────── */
  _buildAdminView() {
    const tabs = [
      { key: 'Shift Requests', count: this._reviseRequests.length, icon: 'revise' },
      { key: 'Task Approvals',  count: this._taskApprovals.length,  icon: 'task'   },
    ];

    const tabHtml = tabs.map(({ key, count, icon }) => {
      const active = this._tab === key;
      const countCls = count > 0 ? 'bg-red-50 text-red-600' : active ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-500';
      const btnCls = active
        ? 'bg-white border-slate-200 text-slate-900 shadow-card'
        : 'bg-transparent border-transparent text-slate-600 hover:bg-white/60 hover:border-slate-200';
      const iconHtml = icon === 'revise' ? this._reviseIconSvg('w-4 h-4') : this._taskIconSvg('w-4 h-4');
      const iconColorCls = active ? 'text-primary-600' : 'text-slate-400';
      return `<button data-tab="${key}" class="approvals-tab flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${btnCls}">
        <span class="${iconColorCls}">${iconHtml}</span>
        ${key}
        <span class="pill ${countCls}">${count}</span>
      </button>`;
    }).join('');

    let contentHtml = '';
    if (this._tab === 'Shift Requests') {
      contentHtml = this._buildReviseTable();
    } else {
      contentHtml = this._buildTaskApprovalsTable();
    }

    return `
      <div class="flex gap-2 flex-wrap">${tabHtml}</div>
      <div id="approvals-content">${contentHtml}</div>
    `;
  },

  _buildReviseTable() {
    const items = this._reviseRequests;
    if (items.length === 0) {
      return this._emptyState(this._reviseIconSvg('w-8 h-8 text-primary-400'), 'No pending revise requests', 'Requests will appear here when submitted.');
    }
    const rows = items.map((t, i) => {
      const unseen = !this._seenRevise.has(t.id);
      const rowStyle = unseen ? 'style="background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b"' : '';
      const titleCls = unseen ? 'font-semibold text-amber-700' : 'font-medium text-slate-800';
      const newBadge = unseen ? '<span class="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400 text-black">NEW</span>' : '';
      return `<tr class="table-row" ${rowStyle}>
        <td class="table-td text-slate-400 text-xs font-mono">${i + 1}</td>
        <td class="table-td max-w-[240px] truncate">
          <span class="${titleCls}">${this._esc(t.description)}</span>${newBadge}
        </td>
        <td class="table-td text-slate-600">${this._esc(t.doer || '—')}</td>
        <td class="table-td text-slate-500 whitespace-nowrap">${this._fmt(t.createdAt)}</td>
        <td class="table-td text-slate-500">${this._esc(t.remarks || '—')}</td>
        <td class="table-td">
          <div class="flex gap-1.5">
            ${this._hasFeature('grant_revise') ? `<button data-action="grant" data-id="${t.id}" class="pill bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer">Grant</button>` : ''}
            ${this._hasFeature('reject') ? `<button data-action="deny" data-id="${t.id}" class="pill bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer">Deny</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
    return `<div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50/80">
          <tr>
            <th class="table-th">#</th>
            <th class="table-th">Task</th>
            <th class="table-th">Doer</th>
            <th class="table-th">Requested On</th>
            <th class="table-th">Remarks</th>
            <th class="table-th">Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  },

  _buildTaskApprovalsTable() {
    const items = this._taskApprovals;
    if (items.length === 0) {
      return this._emptyState(this._taskIconSvg('w-8 h-8 text-primary-400'), 'No pending task approvals', 'Requests will appear here when submitted.');
    }
    const rows = items.map((t, i) => {
      const unseen = !this._seenApprovals.has(t.id);
      const rowStyle = unseen ? 'style="background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b"' : '';
      const titleCls = unseen ? 'font-semibold text-amber-700' : 'font-medium text-slate-800';
      const newBadge = unseen ? '<span class="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400 text-black">NEW</span>' : '';
      const priCls = t.priority === 'High' ? 'bg-red-50 text-red-700' : t.priority === 'Medium' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
      return `<tr class="table-row" ${rowStyle}>
        <td class="table-td text-slate-400 text-xs font-mono">${i + 1}</td>
        <td class="table-td max-w-[220px] truncate">
          <span class="${titleCls}">${this._esc(t.description)}</span>${newBadge}
        </td>
        <td class="table-td text-slate-600">${this._esc(t.doer || '—')}</td>
        <td class="table-td text-slate-500">${this._esc(t.client || '—')}</td>
        <td class="table-td text-slate-500 whitespace-nowrap">${this._fmt(t.dueDate)}</td>
        <td class="table-td"><span class="pill ${priCls}">${this._esc(t.priority || 'Low')}</span></td>
        <td class="table-td">
          <div class="flex gap-1.5">
            ${this._hasFeature('approve') ? `<button data-action="approve" data-id="${t.id}" class="pill bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer">Approve</button>` : ''}
            ${this._hasFeature('reject') ? `<button data-action="reject" data-id="${t.id}" class="pill bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer">Reject</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
    return `<div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50/80">
          <tr>
            <th class="table-th">#</th>
            <th class="table-th">Task</th>
            <th class="table-th">Assigned To</th>
            <th class="table-th">Client</th>
            <th class="table-th">Due Date</th>
            <th class="table-th">Priority</th>
            <th class="table-th">Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  },

  _bindAdminEvents() {
    const root = document.getElementById('approvals-root');
    if (!root) return;

    // Tab switching
    root.querySelectorAll('.approvals-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        clearTimeout(this._seenTimer);
        this._renderContent();
      });
    });

    const content = document.getElementById('approvals-content');
    if (!content) return;

    // Shift Requests actions
    content.querySelectorAll('[data-action="grant"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const task = this._reviseRequests.find(t => t.id === btn.dataset.id) ||
                     this._reviseRequests.find(t => String(t.id) === btn.dataset.id);
        if (task) { this._grantTask = task; this._renderGrantModal(); }
      });
    });

    content.querySelectorAll('[data-action="deny"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const task = this._reviseRequests.find(t => String(t.id) === btn.dataset.id);
        if (task) this._denyRevise(task);
      });
    });

    // Task Approvals actions
    content.querySelectorAll('[data-action="approve"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const task = this._taskApprovals.find(t => String(t.id) === btn.dataset.id);
        if (task) this._approveTask(task);
      });
    });

    content.querySelectorAll('[data-action="reject"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const task = this._taskApprovals.find(t => String(t.id) === btn.dataset.id);
        if (task) this._rejectTask(task);
      });
    });
  },

  /* ── GRANT MODAL ───────────────────────────────────────── */
  _renderGrantModal() {
    // Remove existing modal if present
    const existing = document.getElementById('grant-modal-overlay');
    if (existing) existing.remove();

    if (!this._grantTask) return;

    const t = this._grantTask;
    const overlay = document.createElement('div');
    overlay.id = 'grant-modal-overlay';
    overlay.className = 'fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div id="grant-modal" class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div class="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 grid place-items-center shrink-0">
            ${this._reviseIconSvg('w-5 h-5')}
          </div>
          <div class="flex-1">
            <h2 class="text-base font-semibold">Grant Shift Request</h2>
            <p class="text-xs text-slate-500 mt-0.5">Approve this revision request and send task back?</p>
          </div>
          <button id="grant-modal-close" ${this._granting ? 'disabled' : ''} class="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="p-6 space-y-3">
          <div class="rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm space-y-2">
            <div class="font-medium text-slate-800">${this._esc(t.description)}</div>
            <div class="text-xs text-slate-500">Doer: <b>${this._esc(t.doer || '—')}</b></div>
            ${t.dueDate ? `
            <div class="flex items-center gap-1.5 text-xs text-slate-600 pt-2 border-t border-slate-200">
              <svg class="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <span class="text-slate-400">Shift Until:</span>
              <b class="text-primary-600">${this._fmt(t.dueDate)}</b>
            </div>` : ''}
            <div class="text-xs text-slate-600 pt-2 border-t border-slate-200">
              <span class="text-slate-400">Shift Note:</span>
              <span class="font-medium">${this._esc(t.remarks || '—')}</span>
            </div>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button id="grant-modal-cancel" ${this._granting ? 'disabled' : ''} class="btn-secondary">Cancel</button>
          <button id="grant-modal-confirm" ${this._granting ? 'disabled' : ''} class="btn-success">
            ${this._granting ? 'Granting…' : 'Grant Shift'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close on overlay click (not modal itself)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !this._granting) {
        this._grantTask = null;
        overlay.remove();
      }
    });

    document.getElementById('grant-modal-close').addEventListener('click', () => {
      if (!this._granting) { this._grantTask = null; overlay.remove(); }
    });

    document.getElementById('grant-modal-cancel').addEventListener('click', () => {
      if (!this._granting) { this._grantTask = null; overlay.remove(); }
    });

    document.getElementById('grant-modal-confirm').addEventListener('click', () => {
      this._grantRevise(this._grantTask);
    });
  },

  /* ── USER VIEW ─────────────────────────────────────────── */
  _buildUserView() {
    const items = this._myRequests;

    const STATUS = {
      pending: { label: 'Pending',  cls: 'bg-amber-50 text-amber-700'    },
      granted: { label: 'Granted',  cls: 'bg-emerald-50 text-emerald-700' },
      denied:  { label: 'Denied',   cls: 'bg-red-50 text-red-700'         },
    };

    if (items.length === 0) {
      return this._emptyState(
        this._reviseIconSvg('w-7 h-7 text-primary-400'),
        'No revise requests',
        'Your revision requests will appear here.'
      );
    }

    const rows = items.map((t, i) => {
      const s = STATUS[t.reviseAction] || STATUS.pending;
      return `<tr class="table-row">
        <td class="table-td text-slate-400 text-xs font-mono">${i + 1}</td>
        <td class="table-td font-medium text-slate-800 max-w-[240px] truncate">${this._esc(t.description)}</td>
        <td class="table-td text-slate-500">${this._esc(t.client || '—')}</td>
        <td class="table-td text-slate-500 whitespace-nowrap">${this._fmt(t.dueDate)}</td>
        <td class="table-td text-slate-500 whitespace-nowrap">${this._fmt(t.createdAt)}</td>
        <td class="table-td text-slate-500">${this._esc(t.remarks || '—')}</td>
        <td class="table-td"><span class="pill font-semibold ${s.cls}">${s.label}</span></td>
      </tr>`;
    }).join('');

    return `<div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50/80">
          <tr>
            <th class="table-th">#</th>
            <th class="table-th">Task</th>
            <th class="table-th">Client</th>
            <th class="table-th">Due Date</th>
            <th class="table-th">Requested On</th>
            <th class="table-th">Remarks</th>
            <th class="table-th">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  },

  /* ── shared UI helpers ─────────────────────────────────── */
  _emptyState(iconHtml, title, subtitle) {
    return `<div class="card p-14 text-center">
      <div class="w-14 h-14 rounded-2xl bg-primary-50 grid place-items-center mx-auto mb-3">
        ${iconHtml}
      </div>
      <div class="text-sm font-medium text-slate-700">${title}</div>
      <div class="text-xs text-slate-500 mt-1">${subtitle}</div>
    </div>`;
  },

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _reviseIconSvg(cls) {
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M3 8a9 9 0 1 0 2.6-5.6L3 8"/></svg>`;
  },

  _taskIconSvg(cls) {
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>`;
  },
};
