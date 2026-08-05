window.Pages = window.Pages || {};

// ── IMS (Inventory Management System) ──────────────────────────────────────
// The item-master dashboard: catalog + live current stock (kept in sync by
// Inward/Outward, see inward.js/outward.js and /api/ims/* in server.js — a
// plain MySQL table, not Google-Sheets-backed like PR/PO/GRN). Rows at or
// below their Minimum Order Qty are flagged Low Stock. Add/Edit here only
// ever touches catalog fields (category/description/size/uom/moq/maxLevel/
// onOrderQty/vendorName) — current stock only moves via Inward/Outward
// transactions. category ("Stores" vs "ALU") separates the two real-world
// stock books this table holds and drives the filter dropdown below.
window.Pages['ims'] = (() => {
  /* ── state ──────────────────────────────────────────────────── */
  let _rows = [];
  let _loaded = false;
  let _loadError = '';
  let _search = '';
  let _lowStockOnly = false;
  let _searchTimer = null;
  let _category = ''; // '' = All
  let _categories = ['Stores', 'ALU']; // overwritten from /api/ims/masters once loaded
  let _mastersLoaded = false;

  let _formOpen = false;
  let _editingCode = null; // null = "add new item" mode

  // Day-wise Stock view: a per-item closing-stock matrix, one column per day,
  // matching the reference sheet's daily layout. Shares the same search/
  // category filters as the list view above; range defaults to 7 days with
  // 14/21/30/"3 months" as the other presets.
  let _viewMode = 'list'; // 'list' | 'daywise'
  let _historyDays = 7;
  let _historyDayOptions = [7, 14, 21, 30, 92];
  let _historyDates = [];
  let _historyRows = [];
  let _historyLoaded = false;
  let _historyLoadError = '';

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
    return _fieldWrap(label, '<input type="' + (opts.type || 'text') + '" id="' + id + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" ' + (opts.disabled ? 'disabled style="' + _inputStyle + 'background:#f1f5f9;color:#94a3b8;"' : 'style="' + _inputStyle + '"') + ' />');
  }
  function _selectField(id, label, options, selected) {
    const opts = options.map(o => '<option value="' + esc(o) + '"' + (o === selected ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    return _fieldWrap(label, '<select id="' + id + '" style="' + _inputStyle + '">' + opts + '</select>');
  }

  /* ── Load ───────────────────────────────────────────────────────────── */
  async function _load() {
    _loaded = false;
    _loadError = '';
    _renderTable();
    try {
      const params = new URLSearchParams();
      if (_search) params.set('q', _search);
      if (_lowStockOnly) params.set('lowStock', '1');
      if (_category) params.set('category', _category);
      _rows = await Utils.apiFetch('/api/ims/items?' + params.toString()) || [];
    } catch (e) {
      _rows = [];
      _loadError = e.message || 'Failed to load items';
    }
    _loaded = true;
    _renderTable();
  }

  // Pulls the real category list once (falls back to the hardcoded default
  // above if this fails, so the filter still works before the API responds).
  async function _loadMasters() {
    if (_mastersLoaded) return;
    try {
      const data = await Utils.apiFetch('/api/ims/masters');
      if (Array.isArray(data?.categories) && data.categories.length) _categories = data.categories;
      _mastersLoaded = true;
    } catch (e) { /* keep hardcoded fallback */ }
  }

  async function _loadHistory() {
    _historyLoaded = false;
    _historyLoadError = '';
    _renderHistoryTable();
    try {
      const params = new URLSearchParams();
      params.set('days', String(_historyDays));
      if (_search) params.set('q', _search);
      if (_category) params.set('category', _category);
      const data = await Utils.apiFetch('/api/ims/stock-history?' + params.toString());
      _historyDates = data?.dates || [];
      _historyRows = data?.items || [];
      if (Array.isArray(data?.dayOptions) && data.dayOptions.length) _historyDayOptions = data.dayOptions;
    } catch (e) {
      _historyDates = [];
      _historyRows = [];
      _historyLoadError = e.message || 'Failed to load stock history';
    }
    _historyLoaded = true;
    _renderHistoryTable();
  }

  function _renderTable() {
    const body = document.getElementById('ims-body');
    const countEl = document.getElementById('ims-count');
    if (!body) return;

    if (!_loaded) {
      body.innerHTML = '<tr><td colspan="11" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_loadError) {
      body.innerHTML = '<tr><td colspan="11" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_loadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (countEl) countEl.textContent = _rows.length + ' item' + (_rows.length === 1 ? '' : 's');
    if (!_rows.length) {
      body.innerHTML = '<tr><td colspan="11" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">No items found</td></tr>';
      return;
    }
    body.innerHTML = _rows.map(r => {
      const low = _num(r.currentStock) <= _num(r.moq);
      return '<tr style="border-bottom:1px solid #f1f5f9;' + (low ? 'background:#fef2f2;' : '') + '">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">' + esc(r.itemCode) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;"><span style="display:inline-flex;padding:2px 7px;border-radius:10px;background:#f1f5f9;color:#475569;font-size:10.5px;font-weight:700;">' + esc(r.category || 'Stores') + '</span></td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.description) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.size) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.uom) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;font-weight:700;">' + esc(r.currentStock)
          + (low ? ' <span style="display:inline-flex;padding:2px 7px;border-radius:10px;background:#fee2e2;color:#dc2626;font-size:10.5px;font-weight:700;margin-left:4px;">LOW STOCK</span>' : '')
        + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.moq) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.maxLevel) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.onOrderQty) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.vendorName) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;"><button type="button" class="ims-edit-btn" data-code="' + esc(r.itemCode) + '" style="border:none;background:transparent;color:var(--color-primary);cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Edit</button></td>'
      + '</tr>';
    }).join('');
  }

  function _dateLabel(iso) {
    // '2026-08-05' -> '05 Aug' — compact enough for ~90 columns side by side.
    const parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const m = MONTHS[parseInt(parts[1], 10) - 1] || parts[1];
    return parts[2] + ' ' + m;
  }

  function _renderHistoryTable() {
    const head = document.getElementById('ims-history-head');
    const body = document.getElementById('ims-history-body');
    const countEl = document.getElementById('ims-count');
    if (!body || !head) return;
    const colCount = 3 + _historyDates.length; // Item Code, Description, UOM + one per day

    if (!_historyLoaded) {
      body.innerHTML = '<tr><td colspan="' + colCount + '" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_historyLoadError) {
      body.innerHTML = '<tr><td colspan="' + colCount + '" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_historyLoadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (countEl) countEl.textContent = _historyRows.length + ' item' + (_historyRows.length === 1 ? '' : 's') + ' · ' + _historyDates.length + ' day' + (_historyDates.length === 1 ? '' : 's');

    head.innerHTML = '<tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
      + ['Item Code', 'Description', 'UOM'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;position:sticky;left:0;background:#f8fafc;">' + esc(h) + '</th>').join('')
      + _historyDates.map(d => '<th style="padding:8px 10px;text-align:right;font-size:10.5px;color:#94a3b8;white-space:nowrap;">' + esc(_dateLabel(d)) + '</th>').join('')
    + '</tr>';

    if (!_historyRows.length) {
      body.innerHTML = '<tr><td colspan="' + colCount + '" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">No items found</td></tr>';
      return;
    }
    body.innerHTML = _historyRows.map(r => {
      return '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;white-space:nowrap;position:sticky;left:0;background:#fff;">' + esc(r.itemCode) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">' + esc(r.description) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.uom) + '</td>'
        + (r.daily || []).map(v => '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(v) + '</td>').join('')
      + '</tr>';
    }).join('');
  }

  function _bindRowActions() {
    const body = document.getElementById('ims-body');
    if (!body || body.dataset.actionsBound) return;
    body.dataset.actionsBound = '1';
    body.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.ims-edit-btn');
      if (editBtn) {
        const row = _rows.find(r => String(r.itemCode) === editBtn.dataset.code);
        if (row) _openForm(row);
      }
    });
  }

  /* ── Filter bar ─────────────────────────────────────────────────────── */
  function _categoryOptionsHtml(selected) {
    return '<option value="">All categories</option>'
      + _categories.map(c => '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  }

  function _filterBarHtml() {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<input type="text" id="ims-search" placeholder="Search item code / description…" value="' + esc(_search) + '" style="' + _inputStyle + 'min-width:220px;width:auto;flex:1;" />'
      + '<select id="ims-category" style="' + _inputStyle + 'width:auto;">' + _categoryOptionsHtml(_category) + '</select>'
      + '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#475569;cursor:pointer;">'
        + '<input type="checkbox" id="ims-lowstock" ' + (_lowStockOnly ? 'checked' : '') + ' /> Low stock only'
      + '</label>'
      + '<button type="button" id="ims-add-btn" style="padding:8px 14px;border-radius:8px;background:var(--color-primary);border:none;color:var(--color-primary-text);font-size:12.5px;font-weight:700;cursor:pointer;">+ Add Item</button>'
      + '<button type="button" id="ims-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _bindFilterBar() {
    document.getElementById('ims-search').addEventListener('input', (e) => {
      _search = e.target.value;
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(_load, 300);
    });
    document.getElementById('ims-category').addEventListener('change', (e) => { _category = e.target.value; _load(); });
    document.getElementById('ims-lowstock').addEventListener('change', (e) => { _lowStockOnly = e.target.checked; _load(); });
    document.getElementById('ims-add-btn').addEventListener('click', () => _openForm(null));
    document.getElementById('ims-refresh').addEventListener('click', _load);
  }

  /* ── Day-wise Stock toolbar (search/category shared, range replaces low-stock) ── */
  function _dayOptionLabel(n) { return n >= 60 ? '3 Months' : n + ' Days'; }

  function _historyToolbarHtml() {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<input type="text" id="ims-h-search" placeholder="Search item code / description…" value="' + esc(_search) + '" style="' + _inputStyle + 'min-width:220px;width:auto;flex:1;" />'
      + '<select id="ims-h-category" style="' + _inputStyle + 'width:auto;">' + _categoryOptionsHtml(_category) + '</select>'
      + '<div style="display:flex;gap:4px;background:#f1f5f9;padding:3px;border-radius:8px;">'
        + _historyDayOptions.map(n => '<button type="button" class="ims-h-range" data-days="' + n + '" style="padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;'
          + (n === _historyDays ? 'background:var(--color-primary);color:var(--color-primary-text);' : 'background:transparent;color:#475569;') + '">' + _dayOptionLabel(n) + '</button>').join('')
      + '</div>'
      + '<button type="button" id="ims-h-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _bindHistoryToolbar() {
    document.getElementById('ims-h-search').addEventListener('input', (e) => {
      _search = e.target.value;
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(_loadHistory, 300);
    });
    document.getElementById('ims-h-category').addEventListener('change', (e) => { _category = e.target.value; _loadHistory(); });
    document.getElementById('ims-h-refresh').addEventListener('click', _loadHistory);
    document.querySelectorAll('.ims-h-range').forEach(btn => {
      btn.addEventListener('click', () => {
        _historyDays = parseInt(btn.dataset.days, 10);
        renderPage(); // re-render so the active-range highlight moves too
        _loadHistory();
      });
    });
  }

  /* ── Add/Edit form (inline panel, toggled open) ────────────────────── */
  function _openForm(row) {
    _editingCode = row ? row.itemCode : null;
    _formOpen = true;
    renderPage(row);
  }

  function _closeForm() {
    _formOpen = false;
    _editingCode = null;
    renderPage();
  }

  function _formHtml(row) {
    const isEdit = !!row;
    return '<div style="background:#fff;border:1.5px solid var(--color-primary);border-radius:12px;padding:16px;margin-bottom:16px;">'
      + '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:12px;">' + (isEdit ? 'Edit Item — ' + esc(row.itemCode) : 'Add New Item') + '</div>'
      + '<form id="ims-item-form" style="display:flex;flex-direction:column;gap:14px;">'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">'
          + _textField('ims-f-code', 'Item Code', { value: isEdit ? row.itemCode : '', disabled: isEdit })
          + _selectField('ims-f-category', 'Category', _categories, isEdit ? (row.category || 'Stores') : 'Stores')
          + _textField('ims-f-desc', 'Description', { value: isEdit ? row.description : '' })
          + _textField('ims-f-size', 'Size', { value: isEdit ? row.size : '' })
          + _textField('ims-f-uom', 'UOM', { value: isEdit ? row.uom : '' })
          + _textField('ims-f-moq', 'MOQ (Min Order Qty)', { value: isEdit ? row.moq : '' })
          + _textField('ims-f-maxlevel', 'Max Level', { value: isEdit ? row.maxLevel : '' })
          + _textField('ims-f-onorder', 'On Order Qty', { value: isEdit ? row.onOrderQty : '' })
          + _textField('ims-f-vendor', 'Vendor Name', { value: isEdit ? row.vendorName : '' })
          + (isEdit ? '' : _textField('ims-f-opening', 'Opening Stock', { value: '0' }))
        + '</div>'
        + '<div style="display:flex;gap:10px;">'
          + '<button type="submit" id="ims-f-submit" style="padding:9px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13px;font-weight:700;cursor:pointer;">' + (isEdit ? 'Save Changes' : 'Add Item') + '</button>'
          + '<button type="button" id="ims-f-cancel" style="padding:9px 22px;border-radius:9px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
        + '</div>'
      + '</form>'
    + '</div>';
  }

  async function _submitForm(e, row) {
    e.preventDefault();
    const isEdit = !!row;
    const body = {
      category: document.getElementById('ims-f-category').value,
      description: document.getElementById('ims-f-desc').value.trim(),
      size: document.getElementById('ims-f-size').value.trim(),
      uom: document.getElementById('ims-f-uom').value.trim(),
      moq: document.getElementById('ims-f-moq').value.trim(),
      maxLevel: document.getElementById('ims-f-maxlevel').value.trim(),
      onOrderQty: document.getElementById('ims-f-onorder').value.trim(),
      vendorName: document.getElementById('ims-f-vendor').value.trim(),
    };
    const btn = document.getElementById('ims-f-submit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (isEdit) {
        await Utils.apiFetch('/api/ims/items/' + encodeURIComponent(row.itemCode), { method: 'PATCH', body: JSON.stringify(body) });
        Utils.showToast('Item updated', 'success');
      } else {
        const itemCode = document.getElementById('ims-f-code').value.trim();
        if (!itemCode) { Utils.showToast('Item Code is required', 'error'); btn.disabled = false; btn.textContent = 'Add Item'; return; }
        body.itemCode = itemCode;
        body.openingStock = document.getElementById('ims-f-opening').value.trim();
        await Utils.apiFetch('/api/ims/items', { method: 'POST', body: JSON.stringify(body) });
        Utils.showToast('Item added', 'success');
      }
      _formOpen = false;
      _editingCode = null;
      renderPage();
      await _load();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to save item', 'error');
      btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Add Item';
    }
  }

  /* ── View-mode toggle (Item List vs Day-wise Stock) ─────────────────── */
  function _viewToggleHtml() {
    function tab(mode, label) {
      const active = _viewMode === mode;
      return '<button type="button" class="ims-view-tab" data-mode="' + mode + '" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:700;'
        + (active ? 'background:var(--color-primary);color:var(--color-primary-text);' : 'background:transparent;color:#64748b;') + '">' + label + '</button>';
    }
    return '<div style="display:flex;gap:4px;background:#f1f5f9;padding:3px;border-radius:9px;width:fit-content;margin-bottom:14px;">'
      + tab('list', 'Item List') + tab('daywise', 'Day-wise Stock')
    + '</div>';
  }

  function _bindViewToggle() {
    document.querySelectorAll('.ims-view-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === _viewMode) return;
        _viewMode = btn.dataset.mode;
        _formOpen = false; _editingCode = null;
        renderPage();
      });
    });
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage(formRow) {
    const el = document.getElementById('main-content');
    if (!el) return;
    const isDaywise = _viewMode === 'daywise';

    el.innerHTML = '<div style="max-width:1300px;margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">IMS — Item Master</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Live stock levels and reorder catalog, kept up to date by Inward/Outward entries.</p>'
      + '</div>'
      + _viewToggleHtml()
      + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:2px;flex-wrap:wrap;">'
        + '<span></span>'
        + '<span id="ims-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + (!isDaywise && _formOpen ? _formHtml(formRow) : '')
      + (isDaywise
        ? _historyToolbarHtml()
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;">'
              + '<thead id="ims-history-head"></thead>'
              + '<tbody id="ims-history-body"><tr><td style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
            + '</table>'
          + '</div>'
        : _filterBarHtml()
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:1180px;">'
              + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
                + ['Item Code', 'Category', 'Description', 'Size', 'UOM', 'Current Stock', 'MOQ', 'Max Level', 'On Order', 'Vendor', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
              + '</tr></thead>'
              + '<tbody id="ims-body"><tr><td colspan="11" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
            + '</table>'
          + '</div>')
    + '</div>';

    _bindViewToggle();

    if (isDaywise) {
      _bindHistoryToolbar();
      _renderHistoryTable();
      if (!_historyLoaded) _loadHistory();
      return;
    }

    _bindFilterBar();
    _bindRowActions();

    if (_formOpen) {
      document.getElementById('ims-item-form').addEventListener('submit', (e) => _submitForm(e, formRow));
      document.getElementById('ims-f-cancel').addEventListener('click', _closeForm);
    }

    _renderTable();
    if (!_loaded) _load(); // only the very first render needs a fetch — filter/refresh/save actions trigger their own
    _loadMasters(); // fire-and-forget; hardcoded fallback already covers Stores/ALU so no re-render needed today
  }

  return {
    render() { renderPage(); },
  };
})();
