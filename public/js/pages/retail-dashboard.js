/* =====================================================================
   Retail Dashboard — branch expense tracker
   ---------------------------------------------------------------------
   Rebuilt from a standalone Google Apps Script (see docs/RETAIL_DASHBOARD.md
   for that script's shape) as a page inside the ERP, the same way HRMS was.
   Every branch expense is logged here — date, branch, item, category,
   amount, how it was paid, an optional invoice and, for a cheque payment,
   the cheque details right on the row. The Dashboard tab summarises them by
   month, branch, category and payment mode. Categories/items/branches are
   shared master lists, editable from "Manage Lists". Server side:
   /api/retail-dashboard/* in server.js. Uses the HR module's shared H
   helpers (hr-common.js) even though this isn't an HR page — same shapes,
   no reason to duplicate them. "New Expense" opens as a right-side slide-in
   panel (H.openModal's variant:'drawer') rather than a centered dialog.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['retail-dashboard'] = (() => {
  const H = window.HR;
  const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  let _tab = 'dashboard';
  let _config = null;    // { categories, items, branches, paymentTypes }
  let _summary = null;   // { monthly, byCategory, byBranch, byPaymentType, kpis }
  let _expenses = null;  // { rows, total }
  let _filters = { month: '', branch: '', category: '' };
  let _search = '';

  async function loadConfig()   { _config = await H.api('/api/retail-dashboard/config'); }
  async function loadSummary()  { _summary = await H.api('/api/retail-dashboard/summary?months=12'); }
  async function loadExpenses() {
    const qs = new URLSearchParams();
    if (_filters.month) qs.set('month', _filters.month);
    if (_filters.branch) qs.set('branch', _filters.branch);
    if (_filters.category) qs.set('category', _filters.category);
    _expenses = await H.api('/api/retail-dashboard/expenses' + (qs.toString() ? '?' + qs : ''));
  }

  const monthLabel = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  };

  /* ── Dashboard tab — no charting library, same flat-bars approach as
     hr-reports.js's monthChart/breakdown. ─────────────────────────────── */
  function monthChart(monthly) {
    const max = Math.max(1, ...monthly.map((m) => m.total));
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:12px;">Monthly Total</div>
      <div style="display:grid;grid-template-columns:repeat(${monthly.length},1fr);gap:6px;align-items:end;height:150px;">
        ${monthly.map((m) => `
          <div style="display:flex;flex-direction:column;justify-content:flex-end;height:100%;" title="${H.esc(monthLabel(m.month))}: ${rupees(m.total)} (${m.count} entries)">
            <div style="background:var(--color-primary);border-radius:3px 3px 0 0;min-height:${m.total ? '3px' : '0'};height:${(m.total / max) * 100}%;"></div>
          </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(${monthly.length},1fr);gap:6px;margin-top:6px;">
        ${monthly.map((m) => `<div style="text-align:center;font-size:9.5px;color:#94a3b8;font-weight:600;">${H.esc(monthLabel(m.month))}</div>`).join('')}
      </div>
    </div>`;
  }

  function breakdown(title, list) {
    const head = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:12px;">${H.esc(title)}</div>`;
    if (!list.length) return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">${head}<div style="font-size:12.5px;color:#94a3b8;">Nothing logged yet.</div></div>`;
    const max = Math.max(1, ...list.map((x) => x.total));
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">${head}
      ${list.map((x) => `
        <div style="margin-bottom:9px;">
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#334155;margin-bottom:3px;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:10px;">${H.esc(x.name)}</span>
            <b>${rupees(x.total)}</b>
          </div>
          <div style="height:6px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${(x.total / max) * 100}%;background:var(--color-primary);border-radius:99px;"></div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  function dashboardTab() {
    const k = _summary.kpis;
    return `
      ${H.stats([
        { label: 'This month', value: rupees(k.thisMonthTotal), hint: `${k.thisMonthCount} entr${k.thisMonthCount === 1 ? 'y' : 'ies'}` },
        { label: 'Last month', value: rupees(k.lastMonthTotal) },
        { label: 'Last 12 months', value: rupees(k.windowTotal), hint: `${k.windowCount} entries` },
        { label: 'Top category', value: k.topCategory, color: '#0f172a' },
        { label: 'Top branch', value: k.topBranch, color: '#0f172a' },
      ])}
      ${monthChart(_summary.monthly)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
        ${breakdown('By Category', _summary.byCategory)}
        ${breakdown('By Branch', _summary.byBranch)}
        ${breakdown('By Payment Type', _summary.byPaymentType)}
      </div>`;
  }

  /* ── Expenses tab ─────────────────────────────────────────────────── */
  function visibleRows() {
    const s = _search.trim().toLowerCase();
    if (!s) return _expenses?.rows || [];
    return (_expenses?.rows || []).filter((r) =>
      [r.item_name, r.category, r.branch_name, r.person_name, r.note, r.created_by].some((v) => String(v || '').toLowerCase().includes(s)));
  }

  function expensesTab() {
    const rows = visibleRows();
    const all = _expenses?.rows || [];
    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <input type="month" id="rd-month" value="${H.esc(_filters.month)}" style="${H.CONTROL}width:auto;" />
        <select id="rd-branch" style="${H.CONTROL}width:auto;">
          <option value="">All branches</option>
          ${(_config.branches || []).map((b) => `<option value="${H.esc(b)}" ${_filters.branch === b ? 'selected' : ''}>${H.esc(b)}</option>`).join('')}
        </select>
        <select id="rd-category" style="${H.CONTROL}width:auto;">
          <option value="">All categories</option>
          ${(_config.categories || []).map((c) => `<option value="${H.esc(c)}" ${_filters.category === c ? 'selected' : ''}>${H.esc(c)}</option>`).join('')}
        </select>
        <input type="search" id="rd-search" placeholder="Search item, note, branch…" value="${H.esc(_search)}" style="${H.CONTROL}flex:1;min-width:200px;" />
        <span style="font-size:12px;color:#94a3b8;white-space:nowrap;">${rows.length} of ${all.length} · ${rupees(_expenses.total)}</span>
        <button id="rd-csv" class="btn-secondary" style="font-size:12px;">Export CSV</button>
      </div>
      ${rows.length ? H.table(
        ['Date', 'Branch', 'Item', 'Category', { label: 'Amount', align: 'right' }, 'Payment', 'Entered By', 'Invoice', 'Note'],
        rows.map((r) => [
          H.esc(H.fmtDate(r.entry_date)),
          H.esc(r.branch_name || '—'),
          `<b style="color:#0f172a;">${H.esc(r.item_name)}</b>`,
          H.esc(r.category),
          `<span style="white-space:nowrap;font-weight:600;">${rupees(r.amount)}</span>`,
          H.esc(r.payment_type) + (r.payment_type === 'Cheque' && r.cheque_no ? `<div style="font-size:11px;color:#94a3b8;">#${H.esc(r.cheque_no)}</div>` : ''),
          H.esc(r.created_by),
          r.has_invoice ? `<a href="/api/retail-dashboard/expenses/${encodeURIComponent(r.id)}/invoice" target="_blank" style="color:var(--color-primary);font-weight:600;">View</a>` : '—',
          `<span style="display:inline-block;max-width:220px;white-space:normal;">${H.esc(r.note || '—')}</span>`,
        ]),
        { maxHeight: '560px' },
      ) : H.empty('No expenses here', all.length ? 'Nothing matches these filters.' : 'Press "+ New Expense" to log the first one.')}`;
  }

  /* ── New Expense modal ────────────────────────────────────────────── */
  function openNew() {
    const cats = _config.categories || [];
    const items = _config.items || [];
    const branches = _config.branches || [];
    const pts = _config.paymentTypes || [];
    H.openModal({
      id: 'rdn', title: 'New Expense', subtitle: branches.length ? '' : 'No branches set up yet — add one from "Manage Lists" first, or type it below just for this entry.',
      width: 440, variant: 'drawer', confirmText: 'Save expense',
      bodyHTML: H.grid(
        H.field('rdn-date', 'Date', H.todayISO(), { type: 'date', required: true })
        + (branches.length
            ? H.select('rdn-branch', 'Branch', branches[0], branches, { required: true })
            : H.field('rdn-branch', 'Branch', '', { placeholder: 'Branch name' }))
        + H.field('rdn-person', 'Person', '', { placeholder: 'Who made the payment' })
        + H.select('rdn-category', 'Category', cats[0] || '', cats, { required: true })
        + (items.length
            ? H.select('rdn-item', 'Item', items[0], items, { required: true })
            : H.field('rdn-item', 'Item', '', { required: true, placeholder: 'What was this for' }))
        + H.field('rdn-amount', 'Amount (₹)', '', { type: 'number', step: '0.01', required: true, placeholder: '0.00' })
        + H.select('rdn-payment', 'Payment Type', pts[0], pts, { required: true })
        + `<div id="rdn-cheque-fields" style="display:none;grid-column:1/-1;grid-template-columns:repeat(2,1fr);gap:13px;">
             ${H.field('rdn-cheque-date', 'Cheque Date', '', { type: 'date' })}
             ${H.field('rdn-cheque-no', 'Cheque No.', '')}
             ${H.field('rdn-cheque-amount', 'Cheque Amount (₹)', '', { type: 'number', step: '0.01', span: 2 })}
           </div>`
        + `<div style="grid-column:1/-1;">
             <label style="${H.LABEL}">Invoice (optional)</label>
             <input type="file" id="rdn-invoice" accept=".pdf,.jpg,.jpeg,.png,.webp" style="${H.CONTROL}padding:6px;" />
             <div style="font-size:11px;color:#94a3b8;margin-top:4px;">PDF, JPG, PNG or WEBP — up to 4 MB.</div>
           </div>`
        + H.textarea('rdn-note', 'Note', '', { rows: 2, span: 2 }),
        1,
      ),
      onOpen: (root) => {
        const paymentSel = root.querySelector('#rdn-payment');
        const chequeBox = root.querySelector('#rdn-cheque-fields');
        const sync = () => { chequeBox.style.display = paymentSel.value === 'Cheque' ? 'grid' : 'none'; };
        paymentSel?.addEventListener('change', sync);
        sync();
      },
      onConfirm: async () => {
        const amount = Number(H.val('rdn-amount'));
        const branch = H.val('rdn-branch').trim();
        const item = H.val('rdn-item').trim();
        if (!H.val('rdn-category')) throw new Error('Pick a category');
        if (!item) throw new Error('Enter an item');
        if (!(amount > 0)) throw new Error('Enter a valid amount');

        let invoice = null;
        const file = document.getElementById('rdn-invoice')?.files?.[0];
        if (file) {
          if (file.size > 4 * 1024 * 1024) throw new Error('Invoice must be under 4 MB');
          invoice = {
            name: file.name,
            dataUrl: await new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.onerror = () => reject(new Error('Could not read ' + file.name));
              r.readAsDataURL(file);
            }),
          };
        }

        await H.post('/api/retail-dashboard/expenses', {
          entry_date: H.val('rdn-date'), branchName: branch, personName: H.val('rdn-person').trim(),
          itemName: item, category: H.val('rdn-category'), amount, paymentType: H.val('rdn-payment'),
          chequeDate: H.val('rdn-cheque-date'), chequeNo: H.val('rdn-cheque-no'), chequeAmount: H.val('rdn-cheque-amount'),
          note: H.val('rdn-note').trim(), invoice,
        });
        H.closeModal('rdn');
        H.toast('Expense logged');
        _expenses = null;
        await Promise.all([loadSummary(), loadExpenses()]);
        render();
      },
    });
  }

  /* ── Manage Lists modal ───────────────────────────────────────────── */
  function openLists() {
    const section = (type, title, singular, list) => `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:8px;">${H.esc(title)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          ${list.length ? list.map((v) => `<span class="pill pill-neutral pill-sm">${H.esc(v)}</span>`).join('') : '<span style="font-size:12px;color:#94a3b8;">Nothing yet</span>'}
        </div>
        <div style="display:flex;gap:8px;">
          <input id="rdl-${type}-input" placeholder="Add a ${singular}…" style="${H.CONTROL}flex:1;" />
          <button data-rdl-add="${type}" class="btn-secondary" style="white-space:nowrap;">Add</button>
        </div>
      </div>`;
    H.openModal({
      id: 'rdl', title: 'Manage Lists', subtitle: 'Categories, items and branches used across the dashboard',
      width: 520, hideConfirm: true, cancelText: 'Close',
      bodyHTML: section('category', 'Categories', 'category', _config.categories) + section('item', 'Items', 'item', _config.items) + section('branch', 'Branches', 'branch', _config.branches),
      onOpen: (root) => {
        root.querySelectorAll('[data-rdl-add]').forEach((btn) => btn.addEventListener('click', async () => {
          const type = btn.dataset.rdlAdd;
          const input = root.querySelector(`#rdl-${type}-input`);
          const value = input.value.trim();
          if (!value) return;
          try {
            await H.post('/api/retail-dashboard/config', { type, value });
            await loadConfig();
            H.toast('Added');
            H.closeModal('rdl');
            openLists();
          } catch (e) { H.fail(e); }
        }));
      },
    });
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  async function switchTab(tab) {
    _tab = tab;
    if (tab === 'expenses' && !_expenses) {
      const body = document.getElementById('rd-tab-body');
      if (body) body.innerHTML = H.spinner('Loading expenses…');
      try { await loadExpenses(); } catch (e) { H.fail(e); }
    }
    render();
  }

  async function reloadExpenses() {
    try { await loadExpenses(); } catch (e) { H.fail(e); }
    render();
  }

  function render() {
    const el = document.getElementById('main-content');
    if (!el || !_config || !_summary) return;
    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Retail Dashboard', 'Branch expenses — logged, tracked and summarised',
          `<button id="rd-lists" class="btn-secondary btn-sm">Manage Lists</button>
           <button id="rd-new" class="btn-primary btn-sm">+ New Expense</button>`)}
        ${H.tabs('rd', [{ key: 'dashboard', label: 'Dashboard' }, { key: 'expenses', label: 'Expenses' }], _tab)}
        <div id="rd-tab-body">${_tab === 'dashboard' ? dashboardTab() : (_expenses ? expensesTab() : H.spinner('Loading expenses…'))}</div>
      </div>`;
    bind();
  }

  function bind() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    document.querySelectorAll('[data-rd-tab]').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.rdTab)));
    on('rd-new', 'click', openNew);
    on('rd-lists', 'click', openLists);
    if (_tab === 'expenses') {
      on('rd-month', 'change', (e) => { _filters.month = e.target.value; reloadExpenses(); });
      on('rd-branch', 'change', (e) => { _filters.branch = e.target.value; reloadExpenses(); });
      on('rd-category', 'change', (e) => { _filters.category = e.target.value; reloadExpenses(); });
      on('rd-search', 'input', (e) => { _search = e.target.value; render(); document.getElementById('rd-search')?.focus(); });
      on('rd-csv', 'click', () => {
        const rows = visibleRows().map((r) => [r.entry_date, r.branch_name, r.person_name, r.item_name, r.category, r.amount, r.payment_type, r.cheque_no, r.created_by, r.note]);
        H.downloadCsv('retail-expenses.csv', ['Date', 'Branch', 'Person', 'Item', 'Category', 'Amount', 'Payment Type', 'Cheque No', 'Entered By', 'Note'], rows);
      });
    }
  }

  return {
    // opts.openNew: mount the dashboard as usual, then immediately pop the
    // New Expense drawer open on top of it — used by the sidebar's own
    // "New Expense" entry so logging one doesn't require a stop on the
    // dashboard tab first.
    async render(opts = {}) {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening the retail dashboard…');
      try {
        await Promise.all([loadConfig(), loadSummary()]);
        render();
        if (opts.openNew) openNew();
      }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load the Retail Dashboard', e.message); }
    },
  };
})();

// A second, sidebar-only entry point onto the same page — "New Expense"
// above "Retail Dashboard" in the Retail section (see sidebar.js) — so
// logging an expense is one click instead of dashboard-then-button. Same
// page, same permission (aliased to 'retail-dashboard' in Sidebar.canAccess),
// just opens with the drawer already up.
window.Pages['retail-new-expense'] = { render: () => window.Pages['retail-dashboard'].render({ openNew: true }) };
