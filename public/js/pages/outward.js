window.Pages = window.Pages || {};

// ── Outward (IMS) ───────────────────────────────────────────────────────────
// Logs stock ISSUED out of the Store to a consuming department, against the
// shared MySQL item catalog (see /api/ims/* in server.js — same plain-MySQL
// pattern as Inward, not Google-Sheets-backed). One entry = one item
// movement. If the quantity would take current stock negative the app warns
// but still allows it — store staff must never be blocked from logging a
// real issuance over a paperwork mismatch (confirmed decision). Cancelling
// an entry reverses its effect on that item's current_stock server-side.
window.Pages['outward'] = (() => {
  /* ── state ──────────────────────────────────────────────────── */
  let _view = 'create'; // 'create' | 'list'
  let _departments = [];
  let _mastersLoaded = false;
  let _selectedStock = null; // current_stock of the last item picked from the typeahead, for the short-stock warning

  // List (in-page tab) state.
  let _rows = [];
  let _loaded = false;
  let _loadError = '';
  let _fItem = '';
  let _fFrom = '';
  let _fTo = '';

  function _today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

  /* ── Helpers (styled like PO/GRN Creation, for a consistent look) ─────── */
  function _fieldWrap(label, innerHtml, extra) {
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;' + (extra || '') + '">'
      + '<div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:8px;">' + esc(label) + '</div>'
      + innerHtml
      + '</div>';
  }
  const _inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;';
  function _textField(id, label, opts) {
    opts = opts || {};
    return _fieldWrap(label, '<input type="' + (opts.type || 'text') + '" id="' + id + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" style="' + _inputStyle + '" />');
  }

  /* ── Masters (departments) ─────────────────────────────────────────── */
  async function _loadMasters() {
    try {
      const data = await Utils.apiFetch('/api/ims/masters');
      _departments = (data && data.departments) || [];
      _mastersLoaded = true;
      const sel = document.getElementById('outw-department');
      if (sel) sel.innerHTML = '<option value="">Select…</option>' + _departments.map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load departments', 'error');
    }
  }

  /* ── Item-code typeahead — matches an existing catalog item and previews
     its Description/UOM/current stock; typing an unrecognised code is still
     allowed (the server auto-creates a catalog stub for it) ─────────────── */
  let _itemSearchTimer = null;
  function _bindItemCodeInput() {
    const input = document.getElementById('outw-item-code');
    const dd = document.getElementById('outw-item-dd');
    const descInput = document.getElementById('outw-description');
    const uomInput = document.getElementById('outw-uom');
    const stockHint = document.getElementById('outw-stock-hint');
    if (!input || !dd) return;
    const runSearch = () => {
      clearTimeout(_itemSearchTimer);
      _itemSearchTimer = setTimeout(async () => {
        const query = input.value.trim();
        _selectedStock = null;
        if (stockHint) stockHint.textContent = '';
        if (!query) { dd.style.display = 'none'; return; }
        try {
          const matches = await Utils.apiFetch('/api/ims/items?q=' + encodeURIComponent(query)) || [];
          if (!matches.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = matches.slice(0, 30).map(m => '<div class="outw-item-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-code="' + esc(m.itemCode) + '" data-desc="' + esc(m.description) + '" data-uom="' + esc(m.uom) + '" data-stock="' + esc(m.currentStock) + '">'
            + '<b>' + esc(m.itemCode) + '</b> — ' + esc(m.description) + ' <span style="color:#94a3b8;">(stock: ' + esc(m.currentStock) + ')</span></div>').join('');
          const rect = input.getBoundingClientRect();
          dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 280) + 'px';
          dd.style.display = 'block';
        } catch {}
      }, 220);
    };
    input.addEventListener('input', runSearch);
    input.addEventListener('focus', runSearch);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.outw-item-opt');
      if (!opt) return;
      input.value = opt.dataset.code;
      if (descInput) descInput.value = opt.dataset.desc || '';
      if (uomInput) uomInput.value = opt.dataset.uom || '';
      _selectedStock = _num(opt.dataset.stock);
      if (stockHint) stockHint.textContent = 'Current stock: ' + opt.dataset.stock;
      dd.style.display = 'none';
    });
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── List (in-page tab) ────────────────────────────────────────────── */
  async function _load() {
    _loaded = false;
    _loadError = '';
    _renderTable();
    try {
      _rows = await Utils.apiFetch('/api/ims/outward/list') || [];
    } catch (e) {
      _rows = [];
      _loadError = e.message || 'Failed to load Outward entries';
    }
    _loaded = true;
    _renderTable();
  }

  function _filteredRows() {
    return _rows.filter(r => {
      if (_fItem && !((r.itemCode || '') + ' ' + (r.itemName || '')).toLowerCase().includes(_fItem.toLowerCase())) return false;
      if (_fFrom && (r.date || '') < _fFrom) return false;
      if (_fTo && (r.date || '') > _fTo) return false;
      return true;
    });
  }

  function _renderTable() {
    const body = document.getElementById('outwl-body');
    const countEl = document.getElementById('outwl-count');
    if (!body) return;

    if (!_loaded) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_loadError) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_loadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = _filteredRows();
    if (countEl) countEl.textContent = rows.length + ' of ' + _rows.length;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_rows.length ? 'No entries match these filters' : 'No Outward entries yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">' + esc(r.itemCode) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.itemName) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.quantity) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.uom) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.department) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;color:#64748b;">' + esc(r.remarks) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
          + (r.status === 'Cancelled'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
            : '<button type="button" class="outw-cancel-btn" data-id="' + esc(r.id) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
        + '</td>'
      + '</tr>').join('');
  }

  function _bindRowActions() {
    const body = document.getElementById('outwl-body');
    if (!body || body.dataset.actionsBound) return;
    body.dataset.actionsBound = '1';
    body.addEventListener('click', async (e) => {
      const cancelBtn = e.target.closest('.outw-cancel-btn');
      if (cancelBtn) {
        const ok = await Utils.showConfirm('This Outward entry will be marked Cancelled and the quantity added back to current stock. This can\'t be undone.', { title: 'Cancel Outward Entry', confirmText: 'Cancel Entry', danger: true });
        if (!ok) return;
        try {
          await Utils.apiFetch('/api/ims/outward/cancel?id=' + encodeURIComponent(cancelBtn.dataset.id), { method: 'PUT' });
          Utils.showToast('Entry cancelled', 'success');
          await _load();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to cancel', 'error');
        }
      }
    });
  }

  function _filterBarHtml() {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<input type="text" id="outwl-item" placeholder="Search item code / name…" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
      + '<input type="date" id="outwl-from" style="' + _inputStyle + 'width:auto;" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="outwl-to" style="' + _inputStyle + 'width:auto;" />'
      + '<button type="button" id="outwl-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="outwl-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _bindFilterBar() {
    document.getElementById('outwl-item').addEventListener('input', (e) => { _fItem = e.target.value; _renderTable(); });
    document.getElementById('outwl-from').addEventListener('change', (e) => { _fFrom = e.target.value; _renderTable(); });
    document.getElementById('outwl-to').addEventListener('change', (e) => { _fTo = e.target.value; _renderTable(); });
    document.getElementById('outwl-clear').addEventListener('click', () => {
      _fItem = ''; _fFrom = ''; _fTo = '';
      document.getElementById('outwl-item').value = '';
      document.getElementById('outwl-from').value = '';
      document.getElementById('outwl-to').value = '';
      _renderTable();
    });
    document.getElementById('outwl-refresh').addEventListener('click', _load);
  }

  function _listViewHtml() {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<p style="font-size:12.5px;color:#64748b;margin:0;">Every stock-out entry logged here.</p>'
        + '<span id="outwl-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _filterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:920px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['Date', 'Item Code', 'Description', 'Quantity', 'UOM', 'Issued To', 'Remarks', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="outwl-body"><tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>';
  }

  /* ── Tabs ───────────────────────────────────────────────────────────── */
  function _tabTab(label, active, extraAttrs) {
    return '<button type="button" ' + extraAttrs + ' style="'
      + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
      + 'color:' + (active ? 'var(--color-primary)' : '#94a3b8') + ';'
      + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
      + '">' + esc(label) + '</button>';
  }

  function _tabsHtml() {
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">'
      + _tabTab('Log Outward', _view === 'create', 'class="outw-create-tab"')
      + _tabTab('Outward List', _view === 'list', 'class="outw-list-tab"')
    + '</div>';
  }

  /* ── Create form ────────────────────────────────────────────────────── */
  function _formHtml() {
    return '<form id="outw-form" style="display:flex;flex-direction:column;gap:16px;">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
        + _textField('outw-date', 'Date', { type: 'date', value: _today() })
        + '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;position:relative;">'
          + '<div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:8px;">Item Code</div>'
          + '<input type="text" id="outw-item-code" autocomplete="off" placeholder="Type an item code…" style="' + _inputStyle + '" />'
          + '<div id="outw-stock-hint" style="font-size:11px;color:#94a3b8;margin-top:4px;"></div>'
          + '<div id="outw-item-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>'
        + '</div>'
        + _textField('outw-description', 'Description', { placeholder: 'Auto-fills on match, or type for a new item' })
        + _textField('outw-uom', 'UOM')
        + _textField('outw-quantity', 'Quantity', { type: 'text' })
        + _fieldWrap('Issued To (Department)', '<select id="outw-department" style="' + _inputStyle + '"><option value="">Select…</option></select>')
      + '</div>'
      + _fieldWrap('Remarks', '<textarea id="outw-remarks" rows="2" style="' + _inputStyle + 'resize:vertical;"></textarea>')
      + '<button type="submit" id="outw-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Log Outward</button>'
    + '</form>';
  }

  async function _submit(e) {
    e.preventDefault();
    const date = document.getElementById('outw-date').value;
    const itemCode = document.getElementById('outw-item-code').value.trim();
    const description = document.getElementById('outw-description').value.trim();
    const uom = document.getElementById('outw-uom').value.trim();
    const quantity = document.getElementById('outw-quantity').value.trim();
    const department = document.getElementById('outw-department').value;
    const remarks = document.getElementById('outw-remarks').value.trim();

    if (!date) { Utils.showToast('Date is required', 'error'); return; }
    if (!itemCode) { Utils.showToast('Item Code is required', 'error'); return; }
    if (!_num(quantity) || _num(quantity) <= 0) { Utils.showToast('Quantity must be greater than 0', 'error'); return; }

    // Warn but allow — never block a real issuance over a paperwork mismatch;
    // the server itself never hard-blocks this either (see _imsCreateTxn).
    if (_selectedStock !== null && _num(quantity) > _selectedStock) {
      const ok = await Utils.showConfirm(
        'Only ' + _selectedStock + ' in stock for ' + itemCode + ' — issuing ' + quantity + ' will take it negative. Continue anyway?',
        { title: 'Stock is short', confirmText: 'Issue Anyway', danger: true }
      );
      if (!ok) return;
    }

    const btn = document.getElementById('outw-submit-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const result = await Utils.apiFetch('/api/ims/outward', {
        method: 'POST',
        body: JSON.stringify({ date, itemCode, description, uom, quantity, department, remarks }),
      });
      Utils.showToast('Outward #' + result.id + ' logged', 'success');
      renderPage();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to log Outward entry', 'error');
      btn.disabled = false; btn.textContent = 'Log Outward';
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    _selectedStock = null;
    const isList = _view === 'list';
    const bodyHtml = isList ? _listViewHtml() : _formHtml();

    el.innerHTML = '<div style="max-width:' + (isList ? '1200px' : '900px') + ';margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">Outward</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Log stock issued out of the Store to a department — updates that item\'s current stock on the IMS dashboard.</p>'
      + '</div>'
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    document.querySelector('.outw-create-tab').addEventListener('click', () => { _view = 'create'; renderPage(); });
    document.querySelector('.outw-list-tab').addEventListener('click', () => { _view = 'list'; renderPage(); });

    if (isList) {
      _bindFilterBar();
      _bindRowActions();
      _load();
      return;
    }

    _bindItemCodeInput();
    document.getElementById('outw-form').addEventListener('submit', _submit);
    if (!_mastersLoaded) _loadMasters();
  }

  return {
    render() { renderPage(); },
  };
})();
