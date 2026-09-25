window.Pages = window.Pages || {};

// ── Company Overview ────────────────────────────────────────────────────────
// A cross-module rollup for the company's leadership — every other page in
// this app is scoped to its own module (PR Creation only shows PRs, HR
// Reports only shows HR), so there was nowhere to see PR/PO/GRN spend,
// export pipeline and headcount side by side. Entirely read-only: pulls from
// GET /api/company-overview (server.js), which itself never writes anything.
window.Pages['company-overview'] = (() => {
  const esc = Utils.esc;
  const money = (n, opts) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0, ...opts });
  const usd = (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  let _data = null;
  let _loading = false;
  let _error = '';

  async function _load() {
    _loading = true; _error = ''; _render();
    try {
      _data = await Utils.apiFetch('/api/company-overview');
    } catch (e) {
      _error = e.message || 'Failed to load';
    }
    _loading = false; _render();
  }

  function _card(label, value, sub, accent) {
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;min-width:0;">
      <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">${esc(label)}</div>
      <div style="font-size:24px;font-weight:800;color:${accent || '#0f172a'};margin-top:6px;letter-spacing:-.02em;">${value}</div>
      ${sub ? `<div style="font-size:11.5px;color:#64748b;margin-top:3px;">${sub}</div>` : ''}
    </div>`;
  }

  function _approvalsCard(d) {
    const p = d.pendingApprovals;
    const rows = [
      ['Task Approvals', p.task, '#approvals'],
      ['PO Awaiting Decision', p.po, '#po-creation'],
      ['PR Awaiting Decision', p.pr, '#pr-creation'],
      ['Leave Requests', p.leave, '#hr-leave'],
      ['Urgent Payments', p.urgentPayment, '#approvals'],
    ];
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">Pending Approvals — Company-Wide</div>
        <div style="font-size:26px;font-weight:800;color:${p.total > 0 ? '#b45309' : '#15803d'};letter-spacing:-.02em;">${p.total}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
        ${rows.map(([label, count, href]) => `<a href="${href}" style="text-decoration:none;display:block;padding:10px 12px;background:#f8fafc;border-radius:9px;border:1px solid #f1f5f9;">
            <div style="font-size:18px;font-weight:700;color:${count > 0 ? '#0f172a' : '#cbd5e1'};">${count}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">${esc(label)}</div>
          </a>`).join('')}
      </div>
    </div>`;
  }

  function _headcountCard(d) {
    const h = d.headcount;
    const max = Math.max(1, ...h.byDepartment.map(x => x.count));
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">Active Headcount</div>
        <div style="font-size:20px;font-weight:800;color:#0f172a;">${h.total}</div>
      </div>
      ${h.byDepartment.length ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:7px;">
        ${h.byDepartment.map(x => `<div>
            <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#475569;margin-bottom:2px;">
              <span>${esc(x.department)}</span><span style="font-weight:700;color:#0f172a;">${x.count}</span>
            </div>
            <div style="height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${(x.count / max * 100).toFixed(0)}%;background:var(--color-primary);"></div>
            </div>
          </div>`).join('')}
      </div>` : `<div style="font-size:11.5px;color:#94a3b8;margin-top:10px;">No HR headcount data available.</div>`}
    </div>`;
  }

  function _render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    let body;
    if (_loading && !_data) {
      body = `<div style="padding:60px 0;text-align:center;color:#94a3b8;font-size:13px;">Loading…</div>`;
    } else if (_error) {
      body = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;color:#b91c1c;font-size:12.5px;">
        Could not load: ${esc(_error)}. <button id="co-retry" style="border:none;background:transparent;color:#b91c1c;text-decoration:underline;cursor:pointer;font-weight:600;">Retry</button>
      </div>`;
    } else {
      const d = _data;
      const po = d.poSpend, pr = d.prRaised, grn = d.grnReceived, ep = d.exportPipeline;
      body = `
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${_approvalsCard(d)}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">
            ${_card('PO Spend — This Month', '₹' + money(po.thisMonthValue), po.thisMonthCount + ' PO' + (po.thisMonthCount === 1 ? '' : 's') + ' approved')}
            ${_card('PO Spend — All Time', '₹' + money(po.allTimeValue), po.allTimeCount + ' PO' + (po.allTimeCount === 1 ? '' : 's') + ' approved')}
            ${_card('PR Raised — This Month', pr.thisMonthCount, '₹' + money(pr.thisMonthValue) + ' estimated')}
            ${_card('GRN Received — This Month', grn.thisMonthCount, '₹' + money(grn.thisMonthValue) + ' received')}
            ${_card('Export Pipeline (PI)', usd(ep.openValueUsd), ep.openCount + ' open Proforma Invoice' + (ep.openCount === 1 ? '' : 's'))}
            ${_card('Urgent Payments Pending', '₹' + money(d.urgentPaymentsPendingValue), d.pendingApprovals.urgentPayment + ' request' + (d.pendingApprovals.urgentPayment === 1 ? '' : 's'))}
          </div>
          ${_headcountCard(d)}
          <div style="font-size:11px;color:#cbd5e1;text-align:right;">Last updated ${new Date(d.generatedAt).toLocaleString('en-IN')} · refreshes every few minutes</div>
        </div>`;
    }

    el.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:4px 0 40px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div>
            <h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">Company Overview</h1>
            <p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Cross-module rollup — pending approvals, spend, export pipeline and headcount, all in one place.</p>
          </div>
          <button id="co-refresh" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>
        </div>
        ${body}
      </div>`;

    document.getElementById('co-refresh')?.addEventListener('click', _load);
    document.getElementById('co-retry')?.addEventListener('click', _load);
  }

  function render() {
    _render();
    if (!_data) _load();
  }

  return { render };
})();
