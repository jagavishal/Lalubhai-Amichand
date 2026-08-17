window.Pages = window.Pages || {};

// ── Inward (IMS) ────────────────────────────────────────────────────────────
// Logs stock RECEIVED into the Store against the shared MySQL item catalog
// (see /api/ims/* in server.js — this is NOT Google-Sheets-backed like PR/PO/
// GRN, it's the same plain-MySQL pattern as Client Master / Payment Entries).
// One SUBMIT = one batch (shared Date/Category/Department/Remarks) of
// multiple item rows, mirroring how the store team actually logs a delivery
// (several SKUs arrive together on one date). Each row still becomes its own
// ims_transactions entry server-side (sequential POSTs, not a single atomic
// batch insert) so partial success/failure per item is still visible and
// cancellable individually from the Inward List tab below.
// Cancelling an entry there reverses its effect on that item's current_stock.
//
// The category is NOT chosen here any more: the IMS page mounts this module
// once per stock book and passes the book in via render({category}), so the
// Stores tab's Inward form only ever touches the Stores catalog, the Alu & SS
// tab only ALU, and so on (see ims.js). Everything below — the item-code
// typeahead, the "+ New Item" modal, and the Inward List — is scoped to that
// one category.
window.Pages['inward'] = (() => {
  /* ── state ──────────────────────────────────────────────────── */
  let _view = 'create'; // 'create' | 'list'
  // Departments live in Utils' shared cache (the app-wide master list), not in
  // this page's state — _loadMasters() only primes it from /api/ims/masters.
  let _sources = ['In/Out (Manual)', 'IN/OUT(HINDALCO)']; // overwritten from /api/ims/masters once loaded
  let _mastersLoaded = false;
  // The book this mount is locked to — set from render({category}) by ims.js.
  // 'Stores' is only the standalone-page fallback.
  let _category = 'Stores';
  let _categoryLabel = 'Stores'; // display name ("Alu & SS"); _category stays the stored value ('ALU')

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

  // Department is a Stores-side concept — which internal department the stock
  // was received for. Trading is Hindalco job-work moving against a party, not
  // an internal department, so the field is dropped from the form AND the list
  // for that book only (mirror image of how Source is Trading-only). Every
  // other book keeps behaving exactly as before.
  function _showDepartment() { return _category !== 'Trading'; }
  // Size (the bar/rod/section dimension) is the mirror image again: it's how
  // Trading stock is actually identified on the Hindalco paperwork, so that
  // book gets a Size column on both the entry rows and the list. The other
  // books keep size purely as a catalog field on the IMS Report tab.
  function _showSize() { return _category === 'Trading'; }
  // Column count of the list table, which gains/loses Department and Size
  // depending on the book (8 fixed columns: Date, Item Code, Description,
  // Quantity, UOM, Source, Remarks, Actions).
  function _colCount() { return 8 + (_showDepartment() ? 1 : 0) + (_showSize() ? 1 : 0); }

  // Canonical UOM list, seeded from what's actually in use across the real
  // Stores/ALU catalogs (Kg/Ltr/PCS/PKT/FOOT/c.m etc.) plus a few common
  // general-purpose units — "Other…" always covers anything not listed here
  // rather than hard-blocking entry for a genuinely new unit.
  const UOM_OPTIONS = ['Kg', 'KGS', 'Ltr', 'PCS', 'PKT', 'FOOT', 'c.m', 'Nos', 'Mtr', 'Box', 'Set', 'Roll', 'Bag'];

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

  // UOM select + conditional "Other…" free-text fallback, used both in the
  // item rows and the "+ New Item" modal (cls prefixes the two element classes).
  function _uomFieldHtml(cls) {
    const opts = UOM_OPTIONS.map(u => '<option value="' + esc(u) + '">' + esc(u) + '</option>').join('');
    return '<select class="' + cls + '-select" style="' + _inputStyle + '"><option value="">Select…</option>' + opts + '<option value="__other__">Other…</option></select>'
      + '<input type="text" class="' + cls + '-other" placeholder="Enter UOM" style="display:none;margin-top:6px;' + _inputStyle + '" />';
  }
  function _bindUomField(root, cls) {
    const sel = root.querySelector('.' + cls + '-select');
    const other = root.querySelector('.' + cls + '-other');
    if (!sel || !other) return;
    sel.addEventListener('change', () => {
      if (sel.value === '__other__') { other.style.display = 'block'; other.focus(); }
      else { other.style.display = 'none'; other.value = ''; }
    });
  }
  function _getUomValue(root, cls) {
    const sel = root.querySelector('.' + cls + '-select');
    const other = root.querySelector('.' + cls + '-other');
    return sel.value === '__other__' ? other.value.trim() : sel.value;
  }
  // Auto-selects a matching option when an item is picked from the typeahead
  // (case-insensitive, e.g. catalog "kg" -> option "Kg"); falls back to
  // "Other…" with the raw value pre-filled if it isn't one of the presets.
  function _setUomValue(root, cls, value) {
    const sel = root.querySelector('.' + cls + '-select');
    const other = root.querySelector('.' + cls + '-other');
    const match = UOM_OPTIONS.find(u => u.toLowerCase() === String(value || '').toLowerCase());
    if (match) { sel.value = match; other.style.display = 'none'; other.value = ''; }
    else if (value) { sel.value = '__other__'; other.style.display = 'block'; other.value = value; }
    else { sel.value = ''; other.style.display = 'none'; other.value = ''; }
  }

  /* ── Masters (departments / sources) ───────────────────────────────── */
  // Fetching and filling are deliberately separate. renderPage() rebuilds the
  // form's <select>s from scratch every time — switching book, switching
  // Log/List, or coming back to Inward from another tab — so filling has to
  // happen on EVERY render, while the fetch must happen only once. Guarding
  // the whole thing behind a "already loaded" flag (as this used to) left the
  // Department dropdown permanently empty from the second render onward.
  function _fillMasterSelects() {
    const sel = document.getElementById('inw-department');
    if (sel) {
      // Departments are the app-wide master list (same one Users, Daily Task
      // and PR/PO Creation use), and the dropdown's last row adds to it — a
      // store hand who finds their department missing mid-entry doesn't have to
      // go find an Admin. Fill keeps whatever selection is already made.
      Utils.fillDeptSelect(sel);
      Utils.bindDeptSelect(sel);
    }
    const srcSel = document.getElementById('inw-source');
    if (srcSel) {
      const keep = srcSel.value;
      srcSel.innerHTML = _sources.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
      if (keep) srcSel.value = keep;
    }
  }

  // One in-flight fetch shared by every caller; cleared on failure so a later
  // render retries instead of being stuck with empty dropdowns forever.
  let _mastersPromise = null;
  function _loadMasters() {
    if (!_mastersPromise) {
      _mastersPromise = Utils.apiFetch('/api/ims/masters').then(data => {
        Utils.setDepartments((data && data.departments) || []);
        if (Array.isArray(data?.sources) && data.sources.length) _sources = data.sources;
        _mastersLoaded = true;
      }).catch(e => {
        _mastersPromise = null;
        Utils.showToast(e.message || 'Failed to load departments', 'error');
      });
    }
    // Fill from whatever is cached right now (instant on later renders), then
    // again once the first fetch lands.
    _fillMasterSelects();
    return _mastersPromise.then(_fillMasterSelects);
  }

  /* ── Item-code typeahead per row — scoped to the selected Category, shows
     a browsable list immediately on focus (not just once you start typing),
     and matches an existing catalog item to preview/prefill Description+UOM.
     Typing an unrecognised code is still allowed — the server auto-creates a
     catalog stub for it in whichever Category is selected. ────────────────── */
  let _itemSearchTimer = null;
  function _bindItemCodeInput(input) {
    const row = input.closest('.inw-item-row');
    const dd = row.querySelector('.inw-row-dd');
    const descInput = row.querySelector('.inw-row-desc');
    const sizeInput = row.querySelector('.inw-row-size'); // Trading only
    const runSearch = () => {
      clearTimeout(_itemSearchTimer);
      _itemSearchTimer = setTimeout(async () => {
        const query = input.value.trim();
        try {
          const url = '/api/ims/items?category=' + encodeURIComponent(_category) + (query ? '&q=' + encodeURIComponent(query) : '');
          const matches = await Utils.apiFetch(url) || [];
          if (!matches.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = matches.slice(0, 30).map(m => '<div class="inw-item-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-code="' + esc(m.itemCode) + '" data-desc="' + esc(m.description) + '" data-size="' + esc(m.size) + '" data-uom="' + esc(m.uom) + '">'
            + '<b>' + esc(m.itemCode) + '</b> — ' + esc(m.description)
            + (_showSize() && m.size ? ' <span style="color:#64748b;">[' + esc(m.size) + ']</span>' : '')
            + ' <span style="color:#94a3b8;">(stock: ' + esc(m.currentStock) + ')</span></div>').join('');
          const rect = input.getBoundingClientRect();
          dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 280) + 'px';
          dd.style.display = 'block';
        } catch {}
      }, 220);
    };
    input.addEventListener('input', runSearch);
    input.addEventListener('focus', runSearch);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.inw-item-opt');
      if (!opt) return;
      input.value = opt.dataset.code;
      if (descInput) descInput.value = opt.dataset.desc || '';
      // Prefilled from the catalog but still editable — a delivery can come in
      // at a size the catalog row hasn't caught up with yet.
      if (sizeInput) sizeInput.value = opt.dataset.size || '';
      _setUomValue(row, 'row-uom', opt.dataset.uom || '');
      dd.style.display = 'none';
    });
    window.addEventListener('scroll', (e) => { if (e.target !== dd) dd.style.display = 'none'; }, true);
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Item rows (multi-entry) ────────────────────────────────────────── */
  function _itemRowHtml() {
    return '<tr class="inw-item-row" style="border-bottom:1px solid #f1f5f9;">'
      + '<td style="padding:6px;min-width:170px;position:relative;">'
        + '<input type="text" class="inw-row-code" autocomplete="off" placeholder="Click or type an item code…" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" />'
        + '<div class="inw-row-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>'
      + '</td>'
      + '<td style="padding:6px;min-width:170px;"><input type="text" class="inw-row-desc" placeholder="Description" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + (_showSize() ? '<td style="padding:6px;min-width:120px;"><input type="text" class="inw-row-size" placeholder="Size" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>' : '')
      + '<td style="padding:6px;min-width:130px;">' + _uomFieldHtml('row-uom') + '</td>'
      + '<td style="padding:6px;min-width:100px;"><input type="text" inputmode="decimal" class="inw-row-qty" placeholder="Qty" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;text-align:right;" /></td>'
      + '<td style="padding:6px;text-align:center;"><button type="button" class="inw-row-remove" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove row">×</button></td>'
    + '</tr>';
  }

  function _itemsTableHtml() {
    return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:' + (_showSize() ? 900 : 780) + 'px;">'
        + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
          + ['Item Code', 'Description'].concat(_showSize() ? ['Size'] : []).concat(['UOM', 'Quantity', '']).map(h => '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
        + '</tr></thead>'
        + '<tbody id="inw-items-tbody">' + _itemRowHtml() + '</tbody>'
      + '</table>'
    + '</div>';
  }

  function _bindItemRow(rowEl) {
    _bindItemCodeInput(rowEl.querySelector('.inw-row-code'));
    _bindUomField(rowEl, 'row-uom');
    const removeBtn = rowEl.querySelector('.inw-row-remove');
    removeBtn.addEventListener('click', () => {
      const tbody = document.getElementById('inw-items-tbody');
      if (tbody.querySelectorAll('.inw-item-row').length <= 1) { Utils.showToast('At least one item row is required', 'warning'); return; }
      rowEl.remove();
    });
  }

  function _bindAllItemRows() {
    document.querySelectorAll('#inw-items-tbody .inw-item-row').forEach(_bindItemRow);
  }

  function _collectItemRows() {
    return Array.from(document.querySelectorAll('#inw-items-tbody .inw-item-row')).map(row => {
      const sizeInput = row.querySelector('.inw-row-size'); // absent off the Trading book
      return {
        itemCode: row.querySelector('.inw-row-code').value.trim(),
        description: row.querySelector('.inw-row-desc').value.trim(),
        size: sizeInput ? sizeInput.value.trim() : '',
        uom: _getUomValue(row, 'row-uom'),
        quantity: row.querySelector('.inw-row-qty').value.trim(),
      };
    }).filter(it => it.itemCode);
  }

  /* ── "+ New Item" modal — adds a brand-new catalog item to whichever
     Category is currently selected on the form, so store staff don't have to
     leave Inward to go create it on the IMS page first. ────────────────── */
  function _openNewItemModal() {
    const existing = document.getElementById('inw-newitem-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'inw-newitem-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:grid;place-items:center;padding:16px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
    overlay.innerHTML = '<div style="background:#fff;border-radius:18px;width:100%;max-width:440px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.2);animation:pop-in 200ms cubic-bezier(.16,1,.3,1);">'
      + '<div style="padding:22px 24px 4px;">'
        + '<div style="font-size:15px;font-weight:700;color:#0f172a;">New ' + esc(_categoryLabel) + ' Item</div>'
        + '<div style="font-size:12px;color:#64748b;margin:2px 0 14px;">Adds a new item to the ' + esc(_categoryLabel) + ' catalog with 0 opening stock.</div>'
      + '</div>'
      + '<form id="inw-ni-form" style="padding:0 24px 22px;display:flex;flex-direction:column;gap:12px;">'
        + _textField('inw-ni-code', 'Item Code')
        + _textField('inw-ni-desc', 'Description')
        + _textField('inw-ni-size', 'Size')
        + _fieldWrap('UOM', _uomFieldHtml('ni-uom'))
        + _textField('inw-ni-moq', 'MOQ (Min Order Qty)')
        + _textField('inw-ni-maxlevel', 'Max Level')
        + _textField('inw-ni-vendor', 'Vendor Name')
        + '<div style="display:flex;gap:10px;margin-top:4px;">'
          + '<button type="submit" id="inw-ni-submit" style="padding:9px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13px;font-weight:700;cursor:pointer;">Add Item</button>'
          + '<button type="button" id="inw-ni-cancel" style="padding:9px 22px;border-radius:9px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
        + '</div>'
      + '</form>'
    + '</div>';
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('inw-ni-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
    _bindUomField(overlay, 'ni-uom');

    document.getElementById('inw-ni-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const itemCode = document.getElementById('inw-ni-code').value.trim();
      if (!itemCode) { Utils.showToast('Item Code is required', 'error'); return; }
      const btn = document.getElementById('inw-ni-submit');
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        await Utils.apiFetch('/api/ims/items', {
          method: 'POST',
          body: JSON.stringify({
            itemCode,
            description: document.getElementById('inw-ni-desc').value.trim(),
            size: document.getElementById('inw-ni-size').value.trim(),
            uom: _getUomValue(overlay, 'ni-uom'),
            moq: document.getElementById('inw-ni-moq').value.trim(),
            maxLevel: document.getElementById('inw-ni-maxlevel').value.trim(),
            vendorName: document.getElementById('inw-ni-vendor').value.trim(),
            openingStock: '0',
            category: _category,
          }),
        });
        Utils.showToast('"' + itemCode + '" added to ' + _categoryLabel, 'success');
        close();
      } catch (err) {
        Utils.showToast(err.message || 'Failed to add item', 'error');
        btn.disabled = false; btn.textContent = 'Add Item';
      }
    });
  }

  /* ── List (in-page tab) ────────────────────────────────────────────── */
  // Bumped on every _load() and on every book switch. The four IMS book pages
  // all mount this same module into the same #inwl-body, so without this a
  // slow Stores request that lands after you've moved to Alu & SS would paint
  // Stores entries into the Alu & SS list.
  let _loadGen = 0;
  async function _load() {
    const gen = ++_loadGen;
    _loaded = false;
    _loadError = '';
    _renderTable();
    let rows = [], err = '';
    try {
      rows = await Utils.apiFetch('/api/ims/inward/list?category=' + encodeURIComponent(_category)) || [];
    } catch (e) {
      err = e.message || 'Failed to load Inward entries';
    }
    if (gen !== _loadGen) return; // superseded — a newer load (or another book) owns the table now
    _rows = rows;
    _loadError = err;
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

  // 1234.5 -> "1,234.5" — quantities are stored as decimals but are whole
  // numbers most of the time, so trailing .00 is dropped rather than padded.
  function _fmtQty(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  /* ── Totals row, pinned to the bottom of the list ─────────────────────────
     Sums the Quantity column over whatever the filters currently show, minus
     Cancelled entries — those were already reversed back off current stock, so
     counting them would overstate what actually came in. Quantities can be in
     mixed units within one book, so the UOM cell carries a per-unit breakdown
     whenever more than one unit is on screen instead of implying a single
     grand total is meaningful. ────────────────────────────────────────────── */
  function _totalsRowHtml(rows) {
    const active = rows.filter(r => r.status !== 'Cancelled');
    const cancelled = rows.length - active.length;
    const total = active.reduce((sum, r) => sum + _num(r.quantity), 0);

    const byUom = new Map();
    active.forEach(r => {
      const u = (r.uom || '').trim() || '—';
      byUom.set(u, (byUom.get(u) || 0) + _num(r.quantity));
    });
    const uomCell = byUom.size > 1
      ? Array.from(byUom.entries()).map(([u, v]) => esc(_fmtQty(v) + ' ' + u)).join('<br>')
      : esc(Array.from(byUom.keys())[0] || '');

    const label = 'Total · ' + active.length + ' entr' + (active.length === 1 ? 'y' : 'ies')
      + (cancelled ? ' (' + cancelled + ' cancelled excluded)' : '');
    const leadSpan = 3 + (_showSize() ? 1 : 0);   // Date, Item Code, Description [, Size]
    const tailSpan = 3 + (_showDepartment() ? 1 : 0); // [Department,] Source, Remarks, Actions
    const cell = 'padding:10px;font-size:12.5px;font-weight:700;color:#0f172a;background:#f8fafc;';
    return '<tr style="border-top:2px solid #e2e8f0;">'
      + '<td colspan="' + leadSpan + '" style="' + cell + 'text-transform:uppercase;letter-spacing:.04em;font-size:11px;color:#64748b;">' + esc(label) + '</td>'
      + '<td style="' + cell + 'text-align:right;">' + esc(_fmtQty(total)) + '</td>'
      + '<td style="' + cell + 'font-weight:600;color:#64748b;font-size:11.5px;">' + uomCell + '</td>'
      + '<td colspan="' + tailSpan + '" style="' + cell + '"></td>'
    + '</tr>';
  }

  function _renderTable() {
    const body = document.getElementById('inwl-body');
    const countEl = document.getElementById('inwl-count');
    if (!body) return;

    if (!_loaded) {
      body.innerHTML = '<tr><td colspan="' + _colCount() + '" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_loadError) {
      body.innerHTML = '<tr><td colspan="' + _colCount() + '" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_loadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = _filteredRows();
    if (countEl) countEl.textContent = rows.length + ' of ' + _rows.length;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="' + _colCount() + '" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_rows.length ? 'No entries match these filters' : 'No ' + esc(_categoryLabel) + ' Inward entries yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">' + esc(r.itemCode) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.itemName) + '</td>'
        + (_showSize() ? '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.size) + '</td>' : '')
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.quantity) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.uom) + '</td>'
        + (_showDepartment() ? '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.department) + '</td>' : '')
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.source) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;color:#64748b;">' + esc(r.remarks) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
          + (r.status === 'Cancelled'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
            : '<button type="button" class="inw-cancel-btn" data-id="' + esc(r.id) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
        + '</td>'
      + '</tr>').join('')
      + _totalsRowHtml(rows);
  }

  function _bindRowActions() {
    const body = document.getElementById('inwl-body');
    if (!body || body.dataset.actionsBound) return;
    body.dataset.actionsBound = '1';
    body.addEventListener('click', async (e) => {
      const cancelBtn = e.target.closest('.inw-cancel-btn');
      if (cancelBtn) {
        const ok = await Utils.showConfirm('This Inward entry will be marked Cancelled and the quantity removed back off current stock. This can\'t be undone.', { title: 'Cancel Inward Entry', confirmText: 'Cancel Entry', danger: true });
        if (!ok) return;
        try {
          await Utils.apiFetch('/api/ims/inward/cancel?id=' + encodeURIComponent(cancelBtn.dataset.id), { method: 'PUT' });
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
      + '<input type="text" id="inwl-item" placeholder="Search item code / name…" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
      + '<input type="date" id="inwl-from" style="' + _inputStyle + 'width:auto;" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="inwl-to" style="' + _inputStyle + 'width:auto;" />'
      + '<button type="button" id="inwl-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="inwl-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _bindFilterBar() {
    document.getElementById('inwl-item').addEventListener('input', (e) => { _fItem = e.target.value; _renderTable(); });
    document.getElementById('inwl-from').addEventListener('change', (e) => { _fFrom = e.target.value; _renderTable(); });
    document.getElementById('inwl-to').addEventListener('change', (e) => { _fTo = e.target.value; _renderTable(); });
    document.getElementById('inwl-clear').addEventListener('click', () => {
      _fItem = ''; _fFrom = ''; _fTo = '';
      document.getElementById('inwl-item').value = '';
      document.getElementById('inwl-from').value = '';
      document.getElementById('inwl-to').value = '';
      _renderTable();
    });
    document.getElementById('inwl-refresh').addEventListener('click', _load);
  }

  function _listViewHtml() {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<p style="font-size:12.5px;color:#64748b;margin:0;">Every stock-in entry logged against the ' + esc(_categoryLabel) + ' catalog.</p>'
        + '<span id="inwl-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _filterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:' + (_showSize() ? 1020 : 920) + 'px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['Date', 'Item Code', 'Description'].concat(_showSize() ? ['Size'] : []).concat(['Quantity', 'UOM']).concat(_showDepartment() ? ['Department'] : []).concat(['Source', 'Remarks', 'Actions']).map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="inwl-body"><tr><td colspan="' + _colCount() + '" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
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
      + _tabTab('Log Inward', _view === 'create', 'class="inw-create-tab"')
      + _tabTab('Inward List', _view === 'list', 'class="inw-list-tab"')
    + '</div>';
  }

  /* ── Create form ────────────────────────────────────────────────────── */
  // Source (In/Out (Manual) vs IN/OUT(HINDALCO)) only applies to the Trading
  // catalog — every other book keeps behaving exactly as before this field
  // existed, so it's only rendered at all when this mount is the Trading book.
  function _sourceFieldHtml() {
    return _fieldWrap('Source', '<select id="inw-source" style="' + _inputStyle + '">'
      + _sources.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('')
    + '</select>');
  }

  function _formHtml() {
    return '<form id="inw-form" style="display:flex;flex-direction:column;gap:16px;">'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
        + _textField('inw-date', 'Date', { type: 'date', value: _today() })
        + (_showDepartment() ? _fieldWrap('Department', '<select id="inw-department" style="' + _inputStyle + '"><option value="">Select…</option></select>') : '')
        + (_category === 'Trading' ? _sourceFieldHtml() : '')
      + '</div>'
      + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">' + esc(_categoryLabel) + ' Items</div>'
      + _itemsTableHtml()
      + '<div style="display:flex;gap:8px;">'
        + '<button type="button" id="inw-add-row" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ Add Item Row</button>'
        + '<button type="button" id="inw-new-item" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ New Item…</button>'
      + '</div>'
      + _fieldWrap('Remarks (applies to this whole batch)', '<textarea id="inw-remarks" rows="2" style="' + _inputStyle + 'resize:vertical;"></textarea>')
      + '<button type="submit" id="inw-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Log Inward</button>'
    + '</form>';
  }

  async function _submit(e) {
    e.preventDefault();
    const date = document.getElementById('inw-date').value;
    const deptSel = document.getElementById('inw-department');
    const department = deptSel ? deptSel.value : ''; // absent on the Trading book
    const remarks = document.getElementById('inw-remarks').value.trim();
    const sourceSel = document.getElementById('inw-source');
    const source = (_category === 'Trading' && sourceSel) ? sourceSel.value : '';
    const items = _collectItemRows();

    if (!date) { Utils.showToast('Date is required', 'error'); return; }
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }
    const badQty = items.find(it => !_num(it.quantity) || _num(it.quantity) <= 0);
    if (badQty) { Utils.showToast('"' + badQty.itemCode + '" needs a Quantity greater than 0', 'error'); return; }

    const btn = document.getElementById('inw-submit-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    // Sequential POSTs to the existing single-item endpoint (not one atomic
    // batch insert) -- each row succeeds/fails independently, same as if it
    // had been logged one at a time, and each still shows up individually
    // (and cancellably) in the Inward List tab.
    let okCount = 0;
    const failed = [];
    for (const it of items) {
      try {
        await Utils.apiFetch('/api/ims/inward', {
          method: 'POST',
          body: JSON.stringify({ date, itemCode: it.itemCode, description: it.description, size: it.size, uom: it.uom, quantity: it.quantity, department, remarks, category: _category, source }),
        });
        okCount++;
      } catch (err) {
        failed.push(it.itemCode + ' (' + (err.message || 'failed') + ')');
      }
    }

    if (failed.length) {
      Utils.showToast(okCount + ' of ' + items.length + ' items logged. Failed: ' + failed.join(', '), okCount ? 'warning' : 'error');
    } else {
      Utils.showToast(okCount + ' item' + (okCount === 1 ? '' : 's') + ' logged', 'success');
    }
    if (okCount > 0) { renderPage(); return; } // reset back to one empty row on at least partial success
    btn.disabled = false; btn.textContent = 'Log Inward';
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  // opts.containerId / opts.embedded let the IMS page (see ims.js) mount this
  // whole module inside one book's "Inward" tab instead of #main-content, and
  // opts.category locks that mount to the book. They're passed once from
  // render(opts) and every internal re-render (submit, tab switch) keeps
  // reusing them via _renderOpts, no threading needed — so a later
  // renderPage() with no args stays on the same book.
  let _renderOpts = {};
  function renderPage(opts) {
    if (opts) _renderOpts = opts;
    const containerId = _renderOpts.containerId || 'main-content';
    const embedded = !!_renderOpts.embedded;
    if (_renderOpts.category && _renderOpts.category !== _category) {
      // Switched book. This module is a singleton shared by every IMS book
      // page, so all of its state still describes the previous book: the
      // loaded rows, the list filters, and _view — without that last reset,
      // leaving Stores on the "Inward List" tab would drop you straight into
      // Alu & SS's list instead of its Log Inward form.
      _category = _renderOpts.category;
      _view = 'create';
      _loadGen++; // drop any response still in flight for the previous book
      _rows = []; _loaded = false; _loadError = '';
      _fItem = ''; _fFrom = ''; _fTo = '';
    }
    _categoryLabel = _renderOpts.categoryLabel || _category;
    const el = document.getElementById(containerId);
    if (!el) return;

    const isList = _view === 'list';
    const bodyHtml = isList ? _listViewHtml() : _formHtml();

    el.innerHTML = '<div style="max-width:' + (isList ? '1200px' : '980px') + ';margin:0 auto;padding:4px 0 40px;">'
      + (embedded ? '' : '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">Inward</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Log stock received into the Store — updates each item\'s current stock on the IMS dashboard.</p>'
      + '</div>')
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    document.querySelector('.inw-create-tab').addEventListener('click', () => { _view = 'create'; renderPage(); });
    document.querySelector('.inw-list-tab').addEventListener('click', () => { _view = 'list'; renderPage(); });

    if (isList) {
      _bindFilterBar();
      _bindRowActions();
      _load();
      return;
    }

    document.getElementById('inw-add-row').addEventListener('click', () => {
      document.getElementById('inw-items-tbody').insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(document.getElementById('inw-items-tbody').lastElementChild);
    });
    document.getElementById('inw-new-item').addEventListener('click', _openNewItemModal);
    _bindAllItemRows();
    document.getElementById('inw-form').addEventListener('submit', _submit);
    _loadMasters(); // fills the freshly-built selects; only fetches on the first call
  }

  return {
    render(opts) { renderPage(opts); },
  };
})();
