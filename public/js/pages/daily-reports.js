window.Pages = window.Pages || {};

window.Pages['daily-reports'] = {
  /* ── state ──────────────────────────────────────────────── */
  _entries: [],
  _month: '',
  _from: '',
  _to: '',
  _q: '',
  _doer: 'All',
  _client: 'All',
  _note: '',

  /* ── helpers ────────────────────────────────────────────── */
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
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _win() {
    if (this._from && this._to) return { from: this._from, to: this._to };
    return this._monthRange(this._month || this._curMonth());
  },

  _inWindow() {
    const w = this._win();
    return this._entries.filter((e) => {
      const d = (e.entryDate || '').split('T')[0];
      return d >= w.from && d <= w.to;
    });
  },

  _filtered() {
    const t = this._q.toLowerCase();
    const inWin = this._inWindow();
    return inWin.filter((e) =>
      (this._doer   === 'All' || e.doer   === this._doer) &&
      (this._client === 'All' || e.client === this._client) &&
      (!t || (e.doer + (e.client || '') + (e.description || '') + (e.department || '')).toLowerCase().includes(t))
    );
  },

  _perUser(filtered) {
    const map = {};
    for (const e of filtered) {
      if (!map[e.doer]) map[e.doer] = { doer: e.doer, tasks: 0, minutes: 0 };
      map[e.doer].tasks   += 1;
      map[e.doer].minutes += Number(e.minutes) || 0;
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  },

  /* ── data ───────────────────────────────────────────────── */
  async _load() {
    try {
      const res  = await fetch('/api/daily-tasks');
      const data = await res.json();
      this._entries = Array.isArray(data) ? data : [];
    } catch { this._entries = []; }
  },

  /* ── render entry ───────────────────────────────────────── */
  async render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    // initialise defaults on first open only
    if (!this._month) this._month = this._curMonth();

    el.innerHTML = `<div id="dr-root" class="space-y-4 animate-fade-in"><div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:#C4714A;animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div></div>`;

    await this._load();
    this._renderContent();
  },

  /* ── full re-render ─────────────────────────────────────── */
  _renderContent() {
    const root = document.getElementById('dr-root');
    if (!root) return;

    const filtered = this._filtered();
    const perUser  = this._perUser(filtered);
    const win      = this._win();

    const inWin   = this._inWindow();
    const doers   = ['All', ...Array.from(new Set(inWin.map((e) => e.doer))).sort()];
    const clients = ['All', ...Array.from(new Set(inWin.map((e) => e.client).filter(Boolean))).sort()];

    root.innerHTML = `
      <div class="card p-5 space-y-4">

        <!-- date controls -->
        <div class="flex items-center gap-3 flex-wrap">
          <label class="label !mb-0">Month</label>
          <input type="month" id="dr-month" class="input w-auto" value="${this._esc(this._month)}" />
          <span class="text-[11px] text-slate-400">OR</span>
          <label class="label !mb-0">From</label>
          <input type="date"  id="dr-from"  class="input w-auto" value="${this._esc(this._from)}" />
          <label class="label !mb-0">To</label>
          <input type="date"  id="dr-to"    class="input w-auto" value="${this._esc(this._to)}" />
          <button id="dr-reset" class="btn-ghost">&#8635; Reset</button>
          <div class="ml-auto flex gap-2">
            <button id="dr-csv" class="btn-secondary">&#11015; CSV</button>
            <button id="dr-pdf" class="btn-warn">&#11015; PDF</button>
          </div>
        </div>

        <!-- automation banners -->
        <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-[13px] font-semibold text-amber-700">Daily Reminder</div>
            <div class="text-[11.5px] text-amber-700/80">
              Sends WhatsApp to the group with names of users who haven&apos;t filled today&apos;s report.
            </div>
          </div>
          <button id="dr-wa-daily" class="btn-warn">Send Now</button>
        </div>
        <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-[13px] font-semibold text-slate-700">Pending Task Summary</div>
            <div class="text-[11.5px] text-slate-500">
              Delegation / Checklist summary to the configured number + DMs to flagged recipients.
            </div>
          </div>
          <button id="dr-wa-summary" class="btn-secondary">Send Now</button>
        </div>
        ${this._note ? `<p id="dr-note" class="text-[12px] text-red-500">${this._esc(this._note)}</p>` : ''}

        <!-- per-user summary -->
        <div>
          <div class="text-[13px] font-semibold text-slate-800 mb-2">Per-User Summary</div>
          ${perUser.length === 0
            ? '<p class="text-[12.5px] text-slate-400">No data in range.</p>'
            : `<div class="overflow-x-auto">
                <table class="w-full">
                  <thead><tr>
                    <th class="table-th">Doer</th>
                    <th class="table-th">Tasks</th>
                    <th class="table-th">Total Minutes</th>
                    <th class="table-th">Hours</th>
                  </tr></thead>
                  <tbody>
                    ${perUser.map((u) => `
                      <tr class="table-row">
                        <td class="table-td font-medium text-slate-800">${this._esc(u.doer)}</td>
                        <td class="table-td">${u.tasks}</td>
                        <td class="table-td">${u.minutes}</td>
                        <td class="table-td">${(u.minutes / 60).toFixed(1)} h</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>`}
        </div>

        <!-- all entries -->
        <div>
          <div class="text-[13px] font-semibold text-slate-800 mb-2">All Entries</div>
          <div class="flex items-center gap-2 flex-wrap mb-3">
            <input id="dr-q" class="input flex-1 min-w-[200px]"
              placeholder="Search by name / client / description…"
              value="${this._esc(this._q)}" />
            <select id="dr-doer" class="input w-auto">
              ${doers.map((d) => `<option${d === this._doer ? ' selected' : ''}>${d === 'All' ? 'All Doers' : this._esc(d)}</option>`).join('')}
            </select>
            <select id="dr-client" class="input w-auto">
              ${clients.map((c) => `<option${c === this._client ? ' selected' : ''}>${c === 'All' ? 'All Clients' : this._esc(c)}</option>`).join('')}
            </select>
          </div>
          ${filtered.length === 0
            ? '<p class="text-[12.5px] text-slate-400">No entries.</p>'
            : `<div class="overflow-x-auto">
                <table class="w-full">
                  <thead><tr>
                    <th class="table-th">Date</th>
                    <th class="table-th">Doer</th>
                    <th class="table-th">Client</th>
                    <th class="table-th">Dept</th>
                    <th class="table-th">Description</th>
                    <th class="table-th">Min</th>
                  </tr></thead>
                  <tbody>
                    ${filtered.map((e) => `
                      <tr class="table-row">
                        <td class="table-td whitespace-nowrap">${this._fmt(e.entryDate)}</td>
                        <td class="table-td">${this._esc(e.doer)}</td>
                        <td class="table-td">${this._esc(e.client || '—')}</td>
                        <td class="table-td">${this._esc(e.department || '—')}</td>
                        <td class="table-td max-w-[360px] truncate" title="${this._esc(e.description)}">${this._esc(e.description)}</td>
                        <td class="table-td">${e.minutes != null ? e.minutes : '—'}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>`}
        </div>
      </div>
    `;

    this._bindEvents(filtered, win);
  },

  /* ── event binding ──────────────────────────────────────── */
  _bindEvents(filtered, win) {
    const root = document.getElementById('dr-root');
    if (!root) return;

    // month picker
    const monthEl = document.getElementById('dr-month');
    if (monthEl) {
      monthEl.addEventListener('change', (e) => {
        this._month = e.target.value;
        this._from  = '';
        this._to    = '';
        const fromEl = document.getElementById('dr-from');
        const toEl   = document.getElementById('dr-to');
        if (fromEl) fromEl.value = '';
        if (toEl)   toEl.value   = '';
        this._renderContent();
      });
    }

    // from/to date pickers
    const fromEl = document.getElementById('dr-from');
    const toEl   = document.getElementById('dr-to');
    if (fromEl) {
      fromEl.addEventListener('change', (e) => {
        this._from = e.target.value;
        if (this._from && this._to) this._renderContent();
      });
    }
    if (toEl) {
      toEl.addEventListener('change', (e) => {
        this._to = e.target.value;
        if (this._from && this._to) this._renderContent();
      });
    }

    // reset
    const resetBtn = document.getElementById('dr-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this._month  = this._curMonth();
        this._from   = '';
        this._to     = '';
        this._q      = '';
        this._doer   = 'All';
        this._client = 'All';
        this._note   = '';
        this._renderContent();
      });
    }

    // search
    const qEl = document.getElementById('dr-q');
    if (qEl) {
      qEl.addEventListener('input', (e) => {
        this._q = e.target.value;
        this._renderContent();
      });
    }

    // doer filter
    const doerEl = document.getElementById('dr-doer');
    if (doerEl) {
      doerEl.addEventListener('change', (e) => {
        const raw = e.target.value;
        this._doer = raw === 'All Doers' ? 'All' : raw;
        this._renderContent();
      });
    }

    // client filter
    const clientEl = document.getElementById('dr-client');
    if (clientEl) {
      clientEl.addEventListener('change', (e) => {
        const raw = e.target.value;
        this._client = raw === 'All Clients' ? 'All' : raw;
        this._renderContent();
      });
    }

    // CSV download
    const csvBtn = document.getElementById('dr-csv');
    if (csvBtn) {
      csvBtn.addEventListener('click', () => this._downloadCSV(filtered, win));
    }

    // PDF (browser print)
    const pdfBtn = document.getElementById('dr-pdf');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', () => window.print());
    }

    // WhatsApp stubs
    const waDailyBtn = document.getElementById('dr-wa-daily');
    if (waDailyBtn) {
      waDailyBtn.addEventListener('click', () => {
        this._note = 'WhatsApp sending is not configured. Connect a provider (Twilio / WhatsApp Business API) and a scheduler to enable auto-send.';
        this._renderContent();
      });
    }

    const waSummaryBtn = document.getElementById('dr-wa-summary');
    if (waSummaryBtn) {
      waSummaryBtn.addEventListener('click', () => {
        this._note = 'WhatsApp sending is not configured. Connect a provider and a scheduler to enable auto-send.';
        this._renderContent();
      });
    }
  },

  /* ── CSV export ─────────────────────────────────────────── */
  _downloadCSV(filtered, win) {
    const head  = ['Date', 'Doer', 'Client', 'Department', 'Description', 'Minutes'];
    const lines = filtered.map((e) => [
      this._fmt(e.entryDate),
      e.doer,
      e.client      || '',
      e.department  || '',
      '"' + (e.description || '').replaceAll('"', '""') + '"',
      e.minutes != null ? e.minutes : '',
    ].join(','));
    const csv  = [head.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `daily-report-${win.from}_to_${win.to}.csv`;
    a.click();
  },
};
