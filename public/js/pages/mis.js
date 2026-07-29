window.Pages.mis = {
  _state: {
    misStart: '',
    misEnd: '',
    misTab: 'Delegation MIS',
    misRows: [],
    misSummary: {},
    misLoading: false,
    misModal: null,
    misTaskLoad: false,
  },

  // ── helpers ──────────────────────────────────────────────────────────────

  _isoWeekAgo() {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().split('T')[0];
  },
  _today() {
    return new Date().toISOString().split('T')[0];
  },
  _curMonth() {
    return new Date().toISOString().slice(0, 7);
  },
  _monthRange(ym) {
    const [y, m] = ym.split('-').map(Number);
    const from = new Date(y, m - 1, 1).toISOString().split('T')[0];
    const to   = new Date(y, m,     0).toISOString().split('T')[0];
    return { from, to };
  },
  _fmt(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-GB').replaceAll('/', '-');
  },
  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  // ── render entry point ────────────────────────────────────────────────────

  async render() {
    const s = this._state;
    if (!s.misStart) s.misStart = this._isoWeekAgo();
    if (!s.misEnd)   s.misEnd   = this._today();

    const el = document.getElementById('main-content');
    el.innerHTML = '<div class="space-y-4"><div id="mis-body"></div></div>';

    if (s.misRows.length === 0 && !s.misLoading) {
      await this._generateMIS();
    } else {
      this._renderMIS();
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  MIS REPORT TAB
  // ═══════════════════════════════════════════════════════════════════════════

  _renderMIS() {
    const s = this._state;
    const body = document.getElementById('mis-body');
    body.innerHTML = `
      <div class="space-y-5 animate-fade-in" id="mis-panel">

        <!-- Filter bar -->
        <div class="card p-5 space-y-4">
          <div class="flex items-end gap-3 flex-wrap">
            <div>
              <label class="label">Start Date</label>
              <input type="date" id="mis-start" value="${s.misStart}" class="input !w-44" />
            </div>
            <div>
              <label class="label">End Date</label>
              <input type="date" id="mis-end" value="${s.misEnd}" class="input !w-44" />
            </div>
            <button id="mis-generate" class="btn-primary flex items-center gap-1.5">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 14 4-4 4 4 5-6"/><path d="M3 3v18h18"/></svg>
              Generate
            </button>
            <button id="mis-export" class="btn-secondary flex items-center gap-1.5">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
              Export CSV
            </button>
          </div>
          <div class="flex gap-2 flex-wrap pt-2 border-t border-slate-100" id="mis-tabs">
            ${['Delegation MIS', 'Checklist MIS', ...(window.currentUser?.featureFlags?.fms ? ['FMS MIS'] : []), 'All MIS'].map(t => `
              <button data-tab="${this._esc(t)}" class="px-3 py-1.5 rounded-lg text-xs font-medium border transition
                ${s.misTab === t ? 'bg-primary-50 text-primary-700 border-primary-200' : 'text-slate-600 hover:bg-slate-50 border-slate-200'}">
                ${this._esc(t)}
              </button>`).join('')}
          </div>
        </div>

        <!-- Summary pills -->
        <div id="mis-summary" class="flex gap-3 flex-wrap"></div>

        <!-- Table -->
        <div class="card overflow-hidden" id="mis-table-wrap"></div>

        <!-- Modal -->
        <div id="mis-modal-wrap"></div>
      </div>`;

    this._renderMISSummary();
    this._renderMISTable();
    this._bindMISEvents();
  },

  _bindMISEvents() {
    const s = this._state;

    document.getElementById('mis-start').addEventListener('change', e => { s.misStart = e.target.value; });
    document.getElementById('mis-end').addEventListener('change',   e => { s.misEnd   = e.target.value; });

    document.getElementById('mis-generate').addEventListener('click', () => this._generateMIS());
    document.getElementById('mis-export').addEventListener('click',   () => this._exportMISCSV());

    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        s.misTab   = btn.dataset.tab;
        s.misRows  = [];
        s.misSummary = {};
        s.misModal = null;
        this._renderMIS();
      });
    });
  },

  async _generateMIS() {
    const s = this._state;
    if (!s.misStart || !s.misEnd) { Utils.showToast('Please select Start Date and End Date first', 'warning'); return; }
    s.misLoading = true;
    s.misModal   = null;

    const btn = document.getElementById('mis-generate');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg> Generating…`;
    }

    try {
      const res  = await fetch(`/api/mis?start=${s.misStart}&end=${s.misEnd}&type=${encodeURIComponent(s.misTab)}`);
      const json = await res.json();
      s.misRows    = json.rows    || [];
      s.misSummary = json.summary || {};
    } catch {
      s.misRows    = [];
      s.misSummary = {};
    }

    s.misLoading = false;
    this._renderMISSummary();
    this._renderMISTable();

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 14 4-4 4 4 5-6"/><path d="M3 3v18h18"/></svg> Generate`;
    }
  },

  _renderMISSummary() {
    const wrap = document.getElementById('mis-summary');
    if (!wrap) return;
    const s = this._state;
    if (!Object.keys(s.misSummary).length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = Object.entries(s.misSummary).map(([k, v]) => `
      <div class="bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
        <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">${this._esc(k)}</div>
        <div class="text-lg font-bold text-slate-900 tabular-nums">${this._esc(String(v))}</div>
      </div>`).join('');
  },

  _renderMISTable() {
    const wrap = document.getElementById('mis-table-wrap');
    if (!wrap) return;
    const s = this._state;

    if (!s.misRows.length) {
      const msg = Object.keys(s.misSummary).length
        ? 'No records in this period.'
        : 'Select a date range and click Generate.';
      wrap.innerHTML = `
        <div class="p-14 text-center">
          <div class="w-14 h-14 rounded-2xl bg-primary-50 grid place-items-center mx-auto mb-3">
            <svg class="w-7 h-7 text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/></svg>
          </div>
          <div class="text-sm font-medium text-slate-800">${this._esc(msg)}</div>
        </div>`;
      return;
    }

    const rows = s.misRows.map((r, i) => {
      const good     = r.score >= 0;
      const barWidth = Math.min(Math.abs(r.score), 100);
      const scoreColor = good ? 'text-emerald-600' : 'text-red-500';
      const barColor   = good ? 'bg-emerald-500'   : 'bg-red-500';
      const label      = good
        ? `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 12 2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Perfect`
        : `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> Needs Improvement`;
      return `
        <tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition mis-row" data-idx="${i}">
          <td class="px-5 py-3.5 text-xs text-slate-400 font-mono">${i + 1}</td>
          <td class="px-5 py-3.5 font-medium text-primary-600 hover:text-primary-800">${this._esc(r.name)}</td>
          <td class="px-4 py-3.5 text-center font-semibold text-slate-800">${r.total}</td>
          <td class="px-4 py-3.5 text-center font-semibold text-orange-500">${r.pending}</td>
          <td class="px-4 py-3.5 text-center font-semibold text-emerald-600">${r.completed}</td>
          <td class="px-4 py-3.5 text-center font-semibold text-amber-500">${r.revised}</td>
          <td class="px-4 py-3.5 text-center font-semibold text-red-500">${r.delayed}</td>
          <td class="px-4 py-3.5 min-w-[160px]">
            <div class="font-bold text-sm ${scoreColor}">${r.score > 0 ? '+' : ''}${r.score}%</div>
            <div class="flex items-center gap-1 mt-0.5 text-[10px] font-medium ${scoreColor}">${label}</div>
            <div class="mt-1 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
              <div class="h-full rounded-full ${barColor}" style="width:${barWidth}%"></div>
            </div>
          </td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50/80 border-b border-slate-200">
            <tr>
              <th class="text-left px-5 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">#</th>
              <th class="text-left px-5 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">Name <span class="normal-case font-normal text-slate-400">(click for details)</span></th>
              <th class="text-center px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">Total</th>
              <th class="text-center px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">Pending</th>
              <th class="text-center px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">Completed</th>
              <th class="text-center px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">Revised</th>
              <th class="text-center px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">Delayed</th>
              <th class="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-slate-500">Score %</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    document.querySelectorAll('.mis-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const r = s.misRows[Number(tr.dataset.idx)];
        if (r) this._openMISDetail(r);
      });
    });
  },

  async _openMISDetail(r) {
    const s = this._state;
    s.misModal    = { row: r, tasks: null };
    s.misTaskLoad = true;
    this._renderMISModal();

    try {
      const res  = await fetch(`/api/mis?start=${s.misStart}&end=${s.misEnd}&type=${encodeURIComponent(s.misTab)}&employee=${encodeURIComponent(r.name)}`);
      const json = await res.json();
      s.misModal.tasks = json.rows || [];
    } catch {
      s.misModal.tasks = [];
    }
    s.misTaskLoad = false;
    this._renderMISModal();
  },

  _renderMISModal() {
    const wrap = document.getElementById('mis-modal-wrap');
    if (!wrap) return;
    const s = this._state;
    if (!s.misModal) { wrap.innerHTML = ''; return; }

    const r    = s.misModal.row;
    const good = r.score >= 0;
    const scoreColor = good ? 'text-emerald-600' : 'text-red-500';

    const pendingWarning = !good ? `
      <div class="text-xs text-amber-600 mb-2 flex items-center gap-1">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        Score reduced because: ${r.pending} task(s) still pending
      </div>` : '';

    const stats = [
      { label: 'Total',   val: r.total,     color: 'text-slate-700',   icon: '\u{1F4CB}' },
      { label: 'Done',    val: r.completed, color: 'text-emerald-600', icon: '✅' },
      { label: 'Pending', val: r.pending,   color: 'text-orange-500',  icon: '⏳' },
      { label: 'Delayed', val: r.delayed,   color: 'text-red-500',     icon: '🔴' },
      { label: 'Revised', val: r.revised,   color: 'text-amber-500',   icon: '🔄' },
    ].map(({ label, val, color, icon }) =>
      `<div class="text-sm font-semibold ${color} flex items-center gap-1">
        <span>${icon}</span> ${label}: <span class="font-bold">${val}</span>
      </div>`
    ).join('');

    let taskBody = '';
    if (s.misTaskLoad) {
      taskBody = '<div class="p-8 text-center text-sm text-slate-400">Loading…</div>';
    } else if (!s.misModal.tasks?.length) {
      taskBody = '<div class="p-8 text-center text-sm text-slate-400">No tasks found.</div>';
    } else {
      const statusClass = (st) => {
        if (st === 'done')             return 'bg-emerald-50 text-emerald-700';
        if (st === 'pending')          return 'bg-red-50 text-red-700';
        if (st === 'revise')           return 'bg-amber-50 text-amber-700';
        if (st === 'revise_requested') return 'bg-orange-50 text-orange-700';
        return 'bg-slate-100 text-slate-600';
      };
      const taskRows = s.misModal.tasks.map((t, j) => `
        <tr class="border-t border-slate-100">
          <td class="px-4 py-2.5 text-xs text-slate-400">${j + 1}</td>
          <td class="px-4 py-2.5 text-slate-700 max-w-[260px]">${this._esc(t['Description'] || '')}</td>
          <td class="px-4 py-2.5 text-slate-500 whitespace-nowrap">${this._esc(t['Assigned By'] || t['AssignedBy'] || '—')}</td>
          <td class="px-4 py-2.5 text-slate-500 whitespace-nowrap">${this._esc(t['Due Date'] || '')}</td>
          <td class="px-4 py-2.5">
            <span class="pill text-[10px] ${statusClass(t['Status'])}">${this._esc(t['Status'] || '')}</span>
          </td>
        </tr>`).join('');
      taskBody = `
        <table class="w-full text-sm">
          <thead class="bg-slate-50/80 sticky top-0">
            <tr>
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">#</th>
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">Description</th>
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">Assigned By</th>
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">Due Date</th>
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">Status</th>
            </tr>
          </thead>
          <tbody>${taskRows}</tbody>
        </table>`;
    }

    wrap.innerHTML = `
      <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" id="mis-modal-backdrop">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" id="mis-modal-inner">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 class="text-base font-semibold text-slate-900">${this._esc(r.name)} — ${this._esc(s.misTab)}</h2>
            <button id="mis-modal-close" class="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <!-- Score card -->
          <div class="px-6 py-4 border-b border-slate-100">
            <div class="text-4xl font-bold mb-1 ${scoreColor}">${r.score > 0 ? '+' : ''}${r.score}%</div>
            ${pendingWarning}
            <div class="flex flex-wrap gap-3 mt-2">${stats}</div>
          </div>
          <!-- Task list -->
          <div class="flex-1 overflow-y-auto">
            <div class="px-6 py-3 text-[10px] uppercase tracking-wider font-semibold text-slate-400 border-b border-slate-100">All Tasks in Date Range</div>
            ${taskBody}
          </div>
          <!-- Footer -->
          <div class="px-6 py-4 border-t border-slate-100 flex justify-end">
            <button id="mis-modal-close2" class="btn-secondary">Close</button>
          </div>
        </div>
      </div>`;

    const close = () => { s.misModal = null; wrap.innerHTML = ''; };
    document.getElementById('mis-modal-close').addEventListener('click',  close);
    document.getElementById('mis-modal-close2').addEventListener('click', close);
    document.getElementById('mis-modal-backdrop').addEventListener('click', close);
    document.getElementById('mis-modal-inner').addEventListener('click',  e => e.stopPropagation());
  },

  _exportMISCSV() {
    const s = this._state;
    if (!s.misRows.length) { Utils.showToast('Generate the report first', 'warning'); return; }
    const headers = ['#', 'Name', 'Total', 'Pending', 'Completed', 'Revised', 'Delayed', 'Score %'];
    const lines   = s.misRows.map((r, i) =>
      [i + 1, r.name, r.total, r.pending, r.completed, r.revised, r.delayed, r.score + '%'].join(',')
    );
    const csv  = [headers.join(','), ...lines].join('\n');
    const link = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `MIS_${s.misTab.replace(/\s/g, '_')}_${s.misStart}_to_${s.misEnd}.csv`,
    });
    link.click();
  },

};