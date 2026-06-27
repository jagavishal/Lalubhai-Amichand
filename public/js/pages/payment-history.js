window.Pages = window.Pages || {};

window.Pages['payment-history'] = {
  /* ── state ─────────────────────────────────────────────── */
  _rows:       [],
  _filterMonth: '',
  _openBatch:   null,   // batch_label of expanded batch

  /* ── helpers ───────────────────────────────────────────── */
  _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  _fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' });
  },

  _fmtAmt(v) {
    return '₹' + parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  _curMonth() { return new Date().toISOString().slice(0, 7); },

  /* ── data grouping ──────────────────────────────────────── */
  _batches() {
    const map = {};
    for (const r of this._rows) {
      const key   = r.batch_label || this._fmt(r.exported_at);
      const dateY = (r.exported_at || '').slice(0, 7);   // YYYY-MM
      if (this._filterMonth && dateY !== this._filterMonth) continue;
      if (!map[key]) map[key] = { label: key, exportedAt: r.exported_at, entries: [] };
      map[key].entries.push(r);
    }
    return Object.values(map).sort((a, b) => new Date(b.exportedAt) - new Date(a.exportedAt));
  },

  /* ── summary stats ──────────────────────────────────────── */
  _stats() {
    const curM = this._curMonth();
    const thisMonth = this._rows.filter(r => (r.exported_at || '').slice(0, 7) === curM);
    const allAmt    = this._rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const mAmt      = thisMonth.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const vendors   = new Set(this._rows.map(r => r.vendor_id)).size;
    return { total: this._rows.length, allAmt, mAmt, vendors, mCount: thisMonth.length };
  },

  /* ── vendor-wise report ─────────────────────────────────── */
  _vendorReport() {
    const map = {};
    for (const r of this._rows) {
      const vn = r.vendor_name || r.vendor_id || 'Unknown';
      if (!map[vn]) map[vn] = { name: vn, count: 0, total: 0 };
      map[vn].count++;
      map[vn].total += parseFloat(r.amount || 0);
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10);
  },

  /* ── monthly trend ──────────────────────────────────────── */
  _monthlyTrend() {
    const map = {};
    for (const r of this._rows) {
      const m = (r.exported_at || '').slice(0, 7);
      if (!m) continue;
      if (!map[m]) map[m] = { month: m, count: 0, total: 0 };
      map[m].count++;
      map[m].total += parseFloat(r.amount || 0);
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  },

  /* ── fetch ──────────────────────────────────────────────── */
  async _load() {
    try {
      const res = await fetch('/api/payment-history');
      this._rows = res.ok ? (await res.json()) : [];
    } catch { this._rows = []; }
  },

  /* ── render entry ───────────────────────────────────────── */
  async render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    this._filterMonth = this._curMonth();
    this._openBatch   = null;

    el.innerHTML = '<div id="ph-root" class="space-y-5 animate-fade-in"><div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div></div>';

    await this._load();
    this._renderContent();
  },

  /* ── main render ────────────────────────────────────────── */
  _renderContent() {
    const root = document.getElementById('ph-root');
    if (!root) return;
    root.innerHTML = this._buildView();
    this._bindEvents();
  },

  /* ── build HTML ─────────────────────────────────────────── */
  _buildView() {
    const stats   = this._stats();
    const batches = this._batches();
    const vendors = this._vendorReport();
    const trend   = this._monthlyTrend();

    /* ── stat cards ── */
    const statCard = (label, val, sub, color) =>
      `<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,.04);">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color || '#1e293b'};margin-top:4px;line-height:1;">${val}</div>
        ${sub ? '<div style="font-size:11px;color:#94a3b8;margin-top:3px;">' + sub + '</div>' : ''}
      </div>`;

    const statsHtml = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
        ${statCard('Total Payments', stats.total, 'all time entries', 'var(--color-primary)')}
        ${statCard('Total Amount', this._fmtAmt(stats.allAmt), 'all time', '#1e293b')}
        ${statCard('This Month', stats.mCount + ' entries', this._fmtAmt(stats.mAmt), '#059669')}
        ${statCard('Unique Vendors', stats.vendors, 'paid to', '#6366f1')}
      </div>`;

    /* ── monthly trend table ── */
    const trendHtml = trend.length === 0 ? '' : `
      <div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);">
        <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:13px;font-weight:700;color:#1e293b;">Monthly Payment Trend</div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8fafc;">
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:left;">Month</th>
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:right;">Entries</th>
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:right;">Total Amount</th>
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:left;">Bar</th>
            </tr></thead>
            <tbody>
              ${(() => {
                const maxAmt = Math.max(...trend.map(t => t.total), 1);
                return trend.map((t, i) => {
                  const pct = Math.round((t.total / maxAmt) * 100);
                  const [y, m] = t.month.split('-');
                  const label = new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
                  return `<tr style="border-bottom:1px solid #f1f5f9;${i % 2 === 1 ? 'background:#fafbfc;' : ''}">
                    <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#374151;">${label}</td>
                    <td style="padding:10px 16px;font-size:13px;color:#64748b;text-align:right;">${t.count}</td>
                    <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#1e293b;text-align:right;">${this._fmtAmt(t.total)}</td>
                    <td style="padding:10px 16px;">
                      <div style="background:#f1f5f9;border-radius:9999px;height:8px;overflow:hidden;min-width:80px;">
                        <div style="width:${pct}%;height:100%;background:var(--color-primary);border-radius:9999px;transition:width .4s;"></div>
                      </div>
                    </td>
                  </tr>`;
                }).join('');
              })()}
            </tbody>
          </table>
        </div>
      </div>`;

    /* ── top vendors ── */
    const vendorHtml = vendors.length === 0 ? '' : `
      <div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);">
        <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:13px;font-weight:700;color:#1e293b;">Top Vendors by Payment</div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8fafc;">
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:left;">#</th>
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:left;">Vendor</th>
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:right;">Payments</th>
              <th style="padding:9px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:right;">Total Amount</th>
            </tr></thead>
            <tbody>
              ${vendors.map((v, i) => `
                <tr style="border-bottom:1px solid #f1f5f9;${i % 2 === 1 ? 'background:#fafbfc;' : ''}">
                  <td style="padding:10px 16px;font-size:12px;color:#94a3b8;font-weight:600;">${i + 1}</td>
                  <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#1e293b;">${this._esc(v.name)}</td>
                  <td style="padding:10px 16px;font-size:13px;color:#64748b;text-align:right;">${v.count}</td>
                  <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#059669;text-align:right;">${this._fmtAmt(v.total)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    /* ── batch list ── */
    const batchesHtml = batches.length === 0
      ? `<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:48px 24px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04);">
          <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">No payments exported yet</div>
          <div style="font-size:12px;color:#94a3b8;">Go to Vendor Master → Payment Management, fill entries and click Export</div>
        </div>`
      : batches.map(batch => {
          const bTotal = batch.entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
          const isOpen = this._openBatch === batch.label;
          return `
            <div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);">
              <div class="ph-batch-hdr" data-batch="${this._esc(batch.label)}" style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;cursor:pointer;user-select:none;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''">
                <div style="display:flex;align-items:center;gap:14px;">
                  <div style="width:36px;height:36px;border-radius:10px;background:var(--color-primary-light);display:grid;place-items:center;flex-shrink:0;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                  </div>
                  <div>
                    <div style="font-size:13.5px;font-weight:700;color:#1e293b;">${this._esc(batch.label)}</div>
                    <div style="font-size:11px;color:#94a3b8;margin-top:1px;">${batch.entries.length} entries &nbsp;·&nbsp; ${this._fmt(batch.exportedAt)}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:16px;">
                  <div style="font-size:15px;font-weight:800;color:#059669;">${this._fmtAmt(bTotal)}</div>
                  <svg style="transition:transform .2s;${isOpen ? 'transform:rotate(180deg);' : ''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
              ${isOpen ? this._buildBatchDetail(batch) : ''}
            </div>`;
        }).join('');

    /* ── month filter ── */
    const months = [...new Set(this._rows.map(r => (r.exported_at || '').slice(0, 7)).filter(Boolean))].sort().reverse();

    return `
      <div style="max-width:1100px;margin:0 auto;padding-bottom:40px;">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:10px;">
          <div>
            <h1 style="font-size:20px;font-weight:800;color:#1e293b;margin:0;letter-spacing:-.3px;">Payment History</h1>
            <p style="font-size:12px;color:#94a3b8;margin:3px 0 0;">All exported payment batches and analytics</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="ph-month-filter" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#fff;color:#374151;cursor:pointer;">
              <option value="">All Time</option>
              ${months.map(m => {
                const [y, mo] = m.split('-');
                const label = new Date(+y, +mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
                return `<option value="${m}" ${m === this._filterMonth ? 'selected' : ''}>${label}</option>`;
              }).join('')}
            </select>
            <button id="ph-refresh" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border:1.5px solid #e2e8f0;border-radius:9px;background:#fff;font-size:12px;font-weight:600;color:#64748b;cursor:pointer;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background='#fff'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
              Refresh
            </button>
          </div>
        </div>

        <!-- Stats -->
        ${statsHtml}

        <!-- Reports row -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
          ${trendHtml}
          ${vendorHtml}
        </div>

        <!-- Batch list -->
        <div style="margin-top:16px;">
          <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:10px;">
            Export Batches ${this._filterMonth ? '— ' + new Date(this._filterMonth + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : ''}
          </div>
          <div class="space-y-3" id="ph-batches">${batchesHtml}</div>
        </div>

      </div>`;
  },

  /* ── batch detail table ─────────────────────────────────── */
  _buildBatchDetail(batch) {
    const thS = 'padding:9px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;';
    return `
      <div style="border-top:1px solid #f1f5f9;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:700px;">
          <thead><tr>
            <th style="${thS}">#</th>
            <th style="${thS}">Vendor</th>
            <th style="${thS}">Bank</th>
            <th style="${thS}">Account No.</th>
            <th style="${thS}">IFSC</th>
            <th style="${thS}">Txn</th>
            <th style="${thS}">Narration</th>
            <th style="${thS}text-align:right;">Amount</th>
          </tr></thead>
          <tbody>
            ${batch.entries.map((e, i) => `
              <tr style="border-bottom:1px solid #f1f5f9;${i % 2 === 1 ? 'background:#fafbfc;' : ''}">
                <td style="padding:9px 14px;font-size:12px;color:#94a3b8;">${i + 1}</td>
                <td style="padding:9px 14px;font-size:13px;font-weight:600;color:#1e293b;">${this._esc(e.vendor_name || e.vendor_id || '—')}</td>
                <td style="padding:9px 14px;font-size:12.5px;color:#374151;">${this._esc(e.bank_name || '—')}</td>
                <td style="padding:9px 14px;font-size:12px;color:#374151;font-family:monospace;">${this._esc(e.account_no || '—')}</td>
                <td style="padding:9px 14px;font-size:12px;color:#374151;font-family:monospace;">${this._esc(e.ifsc_code || '—')}</td>
                <td style="padding:9px 14px;font-size:12px;color:#64748b;">${this._esc(e.txn_type || 'N')}</td>
                <td style="padding:9px 14px;font-size:12px;color:#64748b;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this._esc(e.narration || '—')}</td>
                <td style="padding:9px 14px;font-size:13px;font-weight:700;color:#059669;text-align:right;">${this._fmtAmt(e.amount)}</td>
              </tr>`).join('')}
            <tr style="border-top:2px solid #e2e8f0;background:#f8fafc;">
              <td colspan="7" style="padding:10px 14px;font-size:12px;font-weight:700;color:#374151;">Total</td>
              <td style="padding:10px 14px;font-size:14px;font-weight:800;color:#059669;text-align:right;">
                ${this._fmtAmt(batch.entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
  },

  /* ── events ─────────────────────────────────────────────── */
  _bindEvents() {
    const root = document.getElementById('ph-root');
    if (!root) return;

    // Month filter
    const monthEl = document.getElementById('ph-month-filter');
    if (monthEl) {
      monthEl.addEventListener('change', () => {
        this._filterMonth = monthEl.value;
        this._openBatch   = null;
        this._renderContent();
      });
    }

    // Refresh
    const refreshBtn = document.getElementById('ph-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.style.opacity = '0.6';
        await this._load();
        this._renderContent();
        refreshBtn.disabled = false;
        refreshBtn.style.opacity = '1';
      });
    }

    // Batch expand/collapse
    root.querySelectorAll('.ph-batch-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const label = hdr.dataset.batch;
        this._openBatch = this._openBatch === label ? null : label;
        this._renderContent();
      });
    });
  },
};
