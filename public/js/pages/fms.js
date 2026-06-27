window.Pages = window.Pages || {};

window.Pages.fms = (() => {
  /* ── constants ─────────────────────────────────────────────────────── */
  const FMS_STEPS = [
    { name: 'New Client Order Confirmation',   who: 'Sales Team',    how: 'Google Form' },
    { name: 'Draft Campaign Plan & Budgeting', who: 'Doer',          how: 'Google Sheet' },
    { name: 'Plan Meeting & Get Plan Approved',who: 'Doer',          how: 'Zoom + G-Sheets' },
    { name: 'KW Analysis + Grouping',          who: 'Doer',          how: 'Whatsapp' },
    { name: 'Receive Negative KW',             who: 'Doer',          how: 'G-Sheets' },
    { name: 'Ad Content',                      who: 'Content Team',  how: 'Google Drive' },
    { name: 'Ad Content Approval',             who: 'Doer',          how: 'Ad Account' },
    { name: 'Make Campaigns Live',             who: 'Doer',          how: 'Ad Account' },
  ];

  /* ── state ─────────────────────────────────────────────────────────── */
  let _rows   = [];
  let _search = '';
  let _modal  = false;
  let _saving = false;
  let _form   = { clientName: '', platforms: '', mobile: '', doer: '' };

  /* ── helpers ───────────────────────────────────────────────────────── */
  function fmt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit' })
      + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fmtEntry(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function computeDelay(planned, actual) {
    if (!planned || !actual) return '';
    const diff = new Date(actual) - new Date(planned);
    if (diff <= 0) return '';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h + ':' + String(m).padStart(2, '0');
  }

  function stepStatus(s) {
    if (s.actual) return { label: 'Done',    cls: 'bg-emerald-50 text-emerald-700' };
    if (s.planned && new Date(s.planned) < new Date())
                    return { label: 'Delayed', cls: 'bg-red-50 text-red-700' };
    return           { label: 'Pending',  cls: 'bg-amber-50 text-amber-700' };
  }

  function progressOf(r) {
    const done = r.steps.filter((s) => s.actual).length;
    return Math.round((done / r.steps.length) * 100);
  }

  function computeStats() {
    let totalSteps = 0, done = 0, delayed = 0;
    _rows.forEach((r) => r.steps.forEach((s) => {
      totalSteps++;
      if (s.actual) done++;
      else if (s.planned && new Date(s.planned) < new Date()) delayed++;
    }));
    return { clients: _rows.length, totalSteps, done, delayed, pending: totalSteps - done };
  }

  function filtered() {
    if (!_search) return _rows;
    const q = _search.toLowerCase();
    return _rows.filter((r) =>
      (r.clientName || '').toLowerCase().includes(q) ||
      (r.platforms  || '').toLowerCase().includes(q) ||
      (r.doer       || '').toLowerCase().includes(q) ||
      (r.mobile     || '').toLowerCase().includes(q)
    );
  }

  function avatarInitials(name) {
    if (!name) return '·';
    return name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('').toUpperCase();
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── API ────────────────────────────────────────────────────────────── */
  async function loadRows() {
    try {
      const data = await Utils.apiFetch('/api/fms');
      _rows = Array.isArray(data) ? data : [];
    } catch (e) {
      Utils.showToast('Failed to load FMS data', 'error');
      _rows = [];
    }
  }

  async function markDone(fmsId, stepIndex) {
    try {
      await Utils.apiFetch('/api/fms/step', {
        method: 'POST',
        body: JSON.stringify({ fmsId, stepIndex }),
      });
      await loadRows();
      renderPage();
      Utils.showToast('Step marked as done');
    } catch (e) {
      Utils.showToast('Failed to update step', 'error');
    }
  }

  async function createEntry() {
    if (!_form.clientName.trim()) {
      Utils.showToast('Client name is required', 'error');
      return;
    }
    _saving = true;
    renderModal();
    try {
      await Utils.apiFetch('/api/fms', {
        method: 'POST',
        body: JSON.stringify(_form),
      });
      _form   = { clientName: '', platforms: '', mobile: '', doer: '' };
      _modal  = false;
      _saving = false;
      await loadRows();
      renderPage();
      Utils.showToast('FMS entry created');
    } catch (e) {
      _saving = false;
      renderModal();
      Utils.showToast('Failed to create entry', 'error');
    }
  }

  /* ── render helpers ─────────────────────────────────────────────────── */
  function renderMini(label, value, tone) {
    const tones = {
      primary: 'text-primary-700 bg-primary-50',
      emerald: 'text-emerald-700 bg-emerald-50',
      amber:   'text-amber-700 bg-amber-50',
      red:     'text-red-700 bg-red-50',
    };
    const badge = tone === 'red' ? 'attention' : tone === 'emerald' ? 'good' : 'live';
    return `
      <div class="card p-4">
        <div class="text-[11px] uppercase tracking-wider font-semibold text-slate-500">${esc(label)}</div>
        <div class="flex items-baseline justify-between mt-1.5">
          <div class="text-2xl font-bold text-slate-900 tracking-tight">${esc(value)}</div>
          <span class="pill ${tones[tone]}">${badge}</span>
        </div>
      </div>`;
  }

  function renderAvatar(name) {
    const ini = avatarInitials(name);
    return `<div class="w-6 h-6 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-white grid place-items-center text-[9px] font-bold shrink-0">${esc(ini)}</div>`;
  }

  function renderTable(rows) {
    const stepHeaders = FMS_STEPS.map((s, i) => `
      <th colspan="4" class="text-center px-3 py-3 border-l-2 border-slate-200 font-semibold bg-slate-100/50">
        <div class="text-[11px]">Step ${i + 1}</div>
        <div class="text-[10px] font-normal text-slate-500 mt-0.5">${esc(s.name)}</div>
      </th>`).join('');

    const subHeaders = FMS_STEPS.map((_, i) => `
      <th class="px-2 py-1.5 border-l-2 border-slate-200 font-medium">Planned</th>
      <th class="px-2 py-1.5 font-medium">Actual</th>
      <th class="px-2 py-1.5 font-medium">Delay</th>
      <th class="px-2 py-1.5 font-medium">Status</th>`).join('');

    const bodyRows = rows.map((r, idx) => {
      const pct = progressOf(r);
      const barColor = pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-primary-500' : 'bg-amber-500';

      const stepCells = r.steps.map((s, i) => {
        const st = stepStatus(s);
        const statusCell = s.actual
          ? `<span class="pill ${st.cls}">&#10003; ${st.label}</span>`
          : `<button class="pill ${st.cls} hover:ring-2 hover:ring-emerald-300/50 cursor-pointer transition"
               data-fms-id="${esc(r.id)}" data-step-index="${i}"
               title="Click to mark done">${st.label}</button>`;
        return `
          <td class="px-2 py-3 border-l-2 border-slate-100 whitespace-nowrap text-slate-600">${fmt(s.planned)}</td>
          <td class="px-2 py-3 whitespace-nowrap text-slate-600">${fmt(s.actual)}</td>
          <td class="px-2 py-3 whitespace-nowrap text-red-600 font-medium tabular-nums">${computeDelay(s.planned, s.actual)}</td>
          <td class="px-2 py-3 whitespace-nowrap">${statusCell}</td>`;
      }).join('');

      const doerCell = r.doer
        ? `<div class="flex items-center gap-1.5">${renderAvatar(r.doer)}<span class="text-slate-700">${esc(r.doer)}</span></div>`
        : `<span class="text-slate-400">—</span>`;

      return `
        <tr class="border-t border-slate-100 hover:bg-primary-50/30 ${idx % 2 === 1 ? 'bg-slate-50/30' : ''}">
          <td class="px-4 py-3 sticky left-0 bg-inherit z-10 whitespace-nowrap border-r border-slate-100">${fmtEntry(r.createdAt)}</td>
          <td class="px-4 py-3 sticky left-[110px] bg-inherit z-10 border-r border-slate-100">
            <div class="font-semibold text-slate-900 whitespace-nowrap">${esc(r.clientName)}</div>
          </td>
          <td class="px-3 py-3 text-slate-600 max-w-[180px] truncate" title="${esc(r.platforms)}">${esc(r.platforms) || '—'}</td>
          <td class="px-3 py-3 whitespace-nowrap text-slate-600">${esc(r.mobile) || '—'}</td>
          <td class="px-3 py-3 whitespace-nowrap">${doerCell}</td>
          <td class="px-3 py-3">
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[60px]">
                <div class="h-full rounded-full ${barColor}" style="width:${pct}%"></div>
              </div>
              <span class="text-[11px] font-semibold text-slate-700 tabular-nums w-8 text-right">${pct}%</span>
            </div>
          </td>
          ${stepCells}
        </tr>`;
    }).join('');

    return `
      <div class="overflow-x-auto">
        <table class="text-xs" style="min-width:2200px">
          <thead>
            <tr class="bg-slate-50 text-slate-600">
              <th class="text-left px-4 py-3 sticky left-0 bg-slate-50 z-10 font-semibold border-r border-slate-200 w-[110px]">Entry</th>
              <th class="text-left px-4 py-3 sticky left-[110px] bg-slate-50 z-10 font-semibold border-r border-slate-200 w-[220px]">Client</th>
              <th class="text-left px-3 py-3 font-semibold w-[180px]">Platforms</th>
              <th class="text-left px-3 py-3 font-semibold">Mobile</th>
              <th class="text-left px-3 py-3 font-semibold">Doer</th>
              <th class="text-left px-3 py-3 font-semibold w-[140px]">Progress</th>
              ${stepHeaders}
            </tr>
            <tr class="bg-slate-50/60 text-slate-500 text-[10px] uppercase tracking-wider">
              <th class="sticky left-0 bg-slate-50/60 border-r border-slate-200"></th>
              <th class="sticky left-[110px] bg-slate-50/60 border-r border-slate-200"></th>
              <th></th><th></th><th></th><th></th>
              ${subHeaders}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
  }

  function renderEmpty() {
    return `
      <div class="p-14 text-center">
        <div class="w-14 h-14 rounded-2xl bg-primary-50 grid place-items-center mx-auto mb-3">
          <svg class="w-7 h-7 text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="text-sm font-medium text-slate-800">No FMS entries</div>
        <div class="text-xs text-slate-500 mt-1">Add your first client to start tracking the campaign workflow.</div>
      </div>`;
  }

  function renderModal() {
    const existing = document.getElementById('fms-modal-overlay');
    if (!_modal) {
      if (existing) existing.remove();
      return;
    }

    const html = `
      <div id="fms-modal-overlay" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md" id="fms-modal-box">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 grid place-items-center">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="flex-1">
              <h2 class="text-base font-semibold text-slate-900">New FMS Entry</h2>
              <p class="text-[12px] text-slate-500 mt-0.5">Start tracking a new client campaign</p>
            </div>
            <button id="fms-modal-close" class="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div class="p-6 space-y-4">
            <div>
              <label class="label">Client Name *</label>
              <input id="fms-f-clientName" class="input" value="${esc(_form.clientName)}" placeholder="Client name" />
            </div>
            <div>
              <label class="label">Platforms</label>
              <input id="fms-f-platforms" class="input" value="${esc(_form.platforms)}" placeholder="Google Ads, Meta Ads" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label">Mobile Number</label>
                <input id="fms-f-mobile" class="input" value="${esc(_form.mobile)}" />
              </div>
              <div>
                <label class="label">Doer Name</label>
                <input id="fms-f-doer" class="input" value="${esc(_form.doer)}" />
              </div>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <button id="fms-modal-cancel" class="btn-secondary">Cancel</button>
            <button id="fms-modal-save" class="btn-primary" ${_saving ? 'disabled' : ''}>${_saving ? 'Saving…' : 'Create Entry'}</button>
          </div>
        </div>
      </div>`;

    if (existing) {
      existing.outerHTML = html;
    } else {
      document.body.insertAdjacentHTML('beforeend', html);
    }

    // re-bind after innerHTML replacement
    bindModal();
  }

  function bindModal() {
    const overlay = document.getElementById('fms-modal-overlay');
    if (!overlay) return;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.getElementById('fms-modal-close')?.addEventListener('click', closeModal);
    document.getElementById('fms-modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('fms-modal-save')?.addEventListener('click', () => {
      _form.clientName = document.getElementById('fms-f-clientName')?.value || '';
      _form.platforms  = document.getElementById('fms-f-platforms')?.value  || '';
      _form.mobile     = document.getElementById('fms-f-mobile')?.value     || '';
      _form.doer       = document.getElementById('fms-f-doer')?.value       || '';
      createEntry();
    });

    // sync form state on input change so it persists on re-render
    ['clientName', 'platforms', 'mobile', 'doer'].forEach((k) => {
      document.getElementById(`fms-f-${k}`)?.addEventListener('input', (e) => {
        _form[k] = e.target.value;
      });
    });
  }

  function closeModal() {
    _modal  = false;
    _saving = false;
    _form   = { clientName: '', platforms: '', mobile: '', doer: '' };
    renderModal();
  }

  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const stats   = computeStats();
    const rows    = filtered();

    el.innerHTML = `
      <div class="space-y-6 animate-fade-in">
        <!-- header -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold text-slate-900">FMS — Campaign Workflow</h1>
            <p class="text-[13px] text-slate-500 mt-0.5">8-step launch process per client</p>
          </div>
          <button id="fms-new-btn" class="btn-primary flex items-center gap-1.5">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            New FMS Entry
          </button>
        </div>

        <!-- stat cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${renderMini('Clients',    stats.clients,  'primary')}
          ${renderMini('Steps Done', stats.done,     'emerald')}
          ${renderMini('Pending',    stats.pending,  'amber')}
          ${renderMini('Delayed',    stats.delayed,  'red')}
        </div>

        <!-- search bar -->
        <div class="card p-3 flex items-center gap-3 flex-wrap">
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input id="fms-search" value="${esc(_search)}" placeholder="Search by client, doer, platform…" class="input pl-9 w-80" />
          </div>
          <div class="flex-1"></div>
          <div class="text-xs text-slate-500">${rows.length} of ${_rows.length} entries</div>
        </div>

        <!-- table -->
        <div class="card overflow-hidden">
          ${rows.length === 0 ? renderEmpty() : renderTable(rows)}
        </div>
      </div>`;

    // bind events
    document.getElementById('fms-new-btn')?.addEventListener('click', () => {
      _modal = true;
      renderModal();
    });

    document.getElementById('fms-search')?.addEventListener('input', (e) => {
      _search = e.target.value;
      renderPage();
    });

    // step "mark done" buttons
    el.querySelectorAll('[data-fms-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmsId    = btn.dataset.fmsId;
        const stepIdx  = parseInt(btn.dataset.stepIndex, 10);
        markDone(fmsId, stepIdx);
      });
    });
  }

  /* ── public entry point ─────────────────────────────────────────────── */
  return {
    async render() {
      const el = document.getElementById('main-content');
      if (!el) return;
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:#C4714A;animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div>';
      await loadRows();
      renderPage();
    },
  };
})();
