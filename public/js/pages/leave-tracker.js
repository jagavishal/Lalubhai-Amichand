window.Pages = window.Pages || {};

window.Pages['leave-tracker'] = {
  /* ── state ─────────────────────────────────────────────── */
  _leaves: [],
  _tab: 'All',
  _scope: 'mine',
  _q: '',
  _open: false,
  _saving: false,
  _form: { type: 'Leave', fromDate: '', toDate: '', reason: '' },

  /* ── helpers ───────────────────────────────────────────── */
  _fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB').replaceAll('/', '-');
  },

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _canApprove() {
    const roles = window.currentUser?.roles || [];
    return roles.includes('Admin') || roles.includes('HOD');
  },

  /* ── fetch ─────────────────────────────────────────────── */
  async _load() {
    const user = window.currentUser;
    const url = this._scope === 'mine'
      ? `/api/leaves?userId=${encodeURIComponent(user?.id || '')}`
      : '/api/leaves';
    try {
      const res = await fetch(url);
      const data = await res.json();
      this._leaves = Array.isArray(data) ? data : [];
    } catch {
      this._leaves = [];
    }
    this._renderContent();
  },

  /* ── API actions ───────────────────────────────────────── */
  async _apply() {
    const user = window.currentUser;
    if (!this._form.fromDate || !this._form.toDate) return;
    this._saving = true;
    this._renderModal();
    try {
      await fetch('/api/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          userName: user?.name || user?.email || 'Unknown',
          ...this._form,
          approver: 'HOD',
        }),
      });
      this._open = false;
      this._form = { type: 'Leave', fromDate: '', toDate: '', reason: '' };
    } finally {
      this._saving = false;
    }
    await this._load();
  },

  async _decide(id, status) {
    await fetch('/api/leaves', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    await this._load();
  },

  /* ── render entry ──────────────────────────────────────── */
  async render() {
    const el = document.getElementById('main-content');
    const canApprove = this._canApprove();

    // Reset state on each navigation
    this._tab = 'All';
    this._scope = canApprove ? 'all' : 'mine';
    this._q = '';
    this._open = false;
    this._saving = false;
    this._form = { type: 'Leave', fromDate: '', toDate: '', reason: '' };

    el.innerHTML = '<div class="space-y-4 animate-fade-in" id="leave-root"><div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:#C4714A;animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div></div>';

    await this._load();
  },

  /* ── main content render ───────────────────────────────── */
  _renderContent() {
    const root = document.getElementById('leave-root');
    if (!root) return;

    // Remove any lingering modal overlay before full re-render
    const existing = document.getElementById('leave-modal-overlay');
    if (existing) existing.remove();

    root.innerHTML = this._buildView();
    this._bindEvents();

    if (this._open) this._renderModal();
  },

  /* ── full page HTML ────────────────────────────────────── */
  _buildView() {
    const canApprove = this._canApprove();
    const filtered = this._filtered();

    const STATUS_STYLE = {
      pending:  'bg-amber-50 text-amber-600',
      approved: 'bg-emerald-50 text-emerald-600',
      rejected: 'bg-red-50 text-red-600',
    };

    const tabs = ['All', 'Pending', 'Approved', 'Rejected'];
    const tabHtml = tabs.map((t) => {
      const active = this._tab === t;
      return `<button data-tab="${t}" class="leave-tab pill border ${active
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">${t}</button>`;
    }).join('');

    const scopeSelect = canApprove ? `
      <select id="leave-scope" class="input w-auto ml-2">
        <option value="all" ${this._scope === 'all' ? 'selected' : ''}>All employees</option>
        <option value="mine" ${this._scope === 'mine' ? 'selected' : ''}>My leaves</option>
      </select>` : '';

    let tableHtml;
    if (filtered.length === 0) {
      tableHtml = `<p class="text-center text-[13px] text-slate-400 py-8">No leave records yet.</p>`;
    } else {
      const rows = filtered.map((l) => {
        const statusCls = STATUS_STYLE[l.status] || 'bg-slate-100 text-slate-500';
        const actionCell = canApprove
          ? l.status === 'pending'
            ? `<td class="table-td">
                <div class="flex gap-1 justify-end">
                  <button data-action="approve" data-id="${this._esc(String(l.id))}" class="pill bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer">Approve</button>
                  <button data-action="reject" data-id="${this._esc(String(l.id))}" class="pill bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer">Reject</button>
                </div>
               </td>`
            : `<td class="table-td text-slate-400 text-[11px] text-right">${this._fmt(l.decidedAt)}</td>`
          : '';

        return `<tr class="table-row">
          <td class="table-td font-medium text-slate-800">${this._esc(l.userName || '—')}</td>
          <td class="table-td">${this._esc(l.type || '—')}</td>
          <td class="table-td whitespace-nowrap">${this._fmt(l.fromDate)}</td>
          <td class="table-td whitespace-nowrap">${this._fmt(l.toDate)}</td>
          <td class="table-td max-w-[260px] truncate" title="${this._esc(l.reason || '')}">${this._esc(l.reason || '—')}</td>
          <td class="table-td"><span class="pill ${statusCls}">${this._esc(l.status || '—')}</span></td>
          ${actionCell}
        </tr>`;
      }).join('');

      const actionHeader = canApprove
        ? `<th class="table-th text-right pr-3">Action</th>`
        : '';

      tableHtml = `<div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50/80">
            <tr>
              <th class="table-th">Name</th>
              <th class="table-th">Type</th>
              <th class="table-th">From</th>
              <th class="table-th">To</th>
              <th class="table-th">Reason</th>
              <th class="table-th">Status</th>
              ${actionHeader}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }

    return `
      <div class="card p-5">
        <div class="flex items-start justify-between flex-wrap gap-3">
          <p class="text-[13px] text-slate-600">
            Apply for leave, work-from-home, or extra working.
            <b class="text-amber-600">Your approver: HOD</b>
          </p>
          <button id="leave-apply-btn" class="btn-warn">+ Apply for Leave</button>
        </div>

        <div class="flex items-center justify-between flex-wrap gap-3 mt-5">
          <div class="flex items-center gap-2 flex-wrap">
            ${tabHtml}
            ${scopeSelect}
          </div>
          <input id="leave-search" class="input max-w-xs"
            placeholder="Search by name / reason / type…"
            value="${this._esc(this._q)}" />
        </div>

        <div class="mt-4">${tableHtml}</div>
      </div>
    `;
  },

  /* ── filtered data ─────────────────────────────────────── */
  _filtered() {
    const t = this._q.toLowerCase();
    return this._leaves.filter((l) =>
      (this._tab === 'All' || (l.status || '').toLowerCase() === this._tab.toLowerCase()) &&
      (!t || (String(l.userName || '') + String(l.reason || '') + String(l.type || '')).toLowerCase().includes(t))
    );
  },

  /* ── bind events ───────────────────────────────────────── */
  _bindEvents() {
    const root = document.getElementById('leave-root');
    if (!root) return;

    // Apply button
    const applyBtn = document.getElementById('leave-apply-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        this._open = true;
        this._renderModal();
      });
    }

    // Tab switching
    root.querySelectorAll('.leave-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        this._renderContent();
      });
    });

    // Scope select (approvers only)
    const scopeEl = document.getElementById('leave-scope');
    if (scopeEl) {
      scopeEl.addEventListener('change', () => {
        this._scope = scopeEl.value;
        this._load();
      });
    }

    // Search
    const searchEl = document.getElementById('leave-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        this._q = searchEl.value;
        this._renderContent();
      });
    }

    // Approve / Reject actions
    root.querySelectorAll('[data-action="approve"]').forEach((btn) => {
      btn.addEventListener('click', () => this._decide(btn.dataset.id, 'approved'));
    });
    root.querySelectorAll('[data-action="reject"]').forEach((btn) => {
      btn.addEventListener('click', () => this._decide(btn.dataset.id, 'rejected'));
    });
  },

  /* ── apply modal ───────────────────────────────────────── */
  _renderModal() {
    const existing = document.getElementById('leave-modal-overlay');
    if (existing) existing.remove();

    if (!this._open) return;

    const overlay = document.createElement('div');
    overlay.id = 'leave-modal-overlay';
    overlay.className = 'fixed inset-0 bg-black/40 grid place-items-center z-50 p-4';
    overlay.innerHTML = `
      <div id="leave-modal" class="card p-5 w-full max-w-md">
        <div class="text-[15px] font-semibold mb-4">Apply for Leave</div>
        <div class="space-y-3">
          <div>
            <label class="label">Type</label>
            <select id="leave-form-type" class="input">
              <option ${this._form.type === 'Leave' ? 'selected' : ''}>Leave</option>
              <option ${this._form.type === 'WFH' ? 'selected' : ''}>WFH</option>
              <option ${this._form.type === 'Extra Working' ? 'selected' : ''}>Extra Working</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">From</label>
              <input id="leave-form-from" type="date" class="input" value="${this._esc(this._form.fromDate)}" />
            </div>
            <div>
              <label class="label">To</label>
              <input id="leave-form-to" type="date" class="input" value="${this._esc(this._form.toDate)}" />
            </div>
          </div>
          <div>
            <label class="label">Reason</label>
            <textarea id="leave-form-reason" class="input" rows="3">${this._esc(this._form.reason)}</textarea>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button id="leave-modal-cancel" class="btn-secondary">Cancel</button>
          <button id="leave-modal-submit" class="btn-warn" ${this._saving ? 'disabled' : ''}>
            ${this._saving ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !this._saving) {
        this._open = false;
        overlay.remove();
      }
    });

    // Cancel
    document.getElementById('leave-modal-cancel').addEventListener('click', () => {
      if (this._saving) return;
      this._open = false;
      overlay.remove();
    });

    // Live-sync form fields into state so values survive re-renders
    document.getElementById('leave-form-type').addEventListener('change', (e) => {
      this._form.type = e.target.value;
    });
    document.getElementById('leave-form-from').addEventListener('change', (e) => {
      this._form.fromDate = e.target.value;
    });
    document.getElementById('leave-form-to').addEventListener('change', (e) => {
      this._form.toDate = e.target.value;
    });
    document.getElementById('leave-form-reason').addEventListener('input', (e) => {
      this._form.reason = e.target.value;
    });

    // Submit
    document.getElementById('leave-modal-submit').addEventListener('click', () => {
      // Read current field values before submitting
      this._form.type      = document.getElementById('leave-form-type').value;
      this._form.fromDate  = document.getElementById('leave-form-from').value;
      this._form.toDate    = document.getElementById('leave-form-to').value;
      this._form.reason    = document.getElementById('leave-form-reason').value;
      this._apply();
    });
  },
};
