window.Pages = window.Pages || {};

// ── PR Creation ──────────────────────────────────────────────────────────────
// Mirrors po-creation.js field-for-field, pointed at the store team's live "PR
// July 2026" Google Sheet instead (see POST /api/pr-creation in server.js).
// Four formats, each its own template tab: Purchase Requisition (general) /
// Packing Sticker / Packing Box / Aluminium. Submitting fills the matching
// tab, exports it as a PDF (saved to Drive), and logs it in "ERP PR Log".
window.Pages['pr-creation'] = (() => {
  const FORMATS = ['ITEM_CODE', 'PACKING_STICKER', 'PACKING_BOX', 'ALU'];
  const FORMAT_LABEL = { ITEM_CODE: 'Purchase Requisition', PACKING_STICKER: 'Packing Sticker', PACKING_BOX: 'Packing Box', ALU: 'Aluminium' };
  const PARTY_LABEL  = { ITEM_CODE: 'Vendor Name', PACKING_STICKER: 'Party Name', PACKING_BOX: 'Party Name', ALU: 'Vendor Name' };

  // Header fields shown above the item table, per format — matches each
  // template tab's own manual (non-formula) cells exactly (see PR_FORMAT_CONFIG
  // in server.js, reverse-engineered from the live sheet).
  const HEADER_FIELDS = {
    ITEM_CODE: [
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'personWhoRaisedPr', label: 'Person Who Raised The PR' },
      { key: 'estimatedDelDate', label: 'Estimated Del. Date', type: 'date' },
      { key: 'termsOfPayment', label: 'Terms Of Payment' },
      { key: 'dateRequested', label: 'Date Requested', type: 'date' },
    ],
    PACKING_STICKER: [
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'orderNo', label: 'Order No' },
      { key: 'dateRequested', label: 'Date Requested', type: 'date' },
    ],
    PACKING_BOX: [
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'orderNo', label: 'Order No' },
      { key: 'termsOfPayment', label: 'Terms Of Payment' },
      { key: 'estimatedDelDate', label: 'Estimated Del. Date', type: 'date' },
      { key: 'dateRequested', label: 'Date Requested', type: 'date' },
    ],
    ALU: [
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'termsOfPayment', label: 'Terms Of Payment' },
      { key: 'estimatedDelDate', label: 'Estimated Delivery Date', type: 'date' },
      { key: 'dateRequested', label: 'Date Requested', type: 'date' },
    ],
  };

  // Department: a live formula on every format except ALU (derived from the
  // first item's own category) — shown read-only there, populated after
  // submit; ALU is the only format where it's a manual field.
  const DEPARTMENT_MODE = { ITEM_CODE: 'auto', PACKING_STICKER: 'none', PACKING_BOX: 'none', ALU: 'manual' };

  // Manual item columns per format, in on-sheet order — everything else
  // (description, size, totals) is computed by the sheet's own formulas once
  // Item No. is filled in, so those are shown read-only and never sent.
  const ITEM_FIELDS = {
    ITEM_CODE: [
      { key: 'monthlyConsumption', label: 'Monthly Consumption' },
      { key: 'qtyRequired',        label: 'Qty Required', numeric: true },
      { key: 'uom',                label: 'UOM' },
      { key: 'stock',              label: 'Stock', numeric: true },
      { key: 'lastOrderedDate',    label: 'Last Ordered Date', type: 'date' },
      { key: 'lastUnitPrice',      label: 'Last Unit Price (INR)', numeric: true },
      { key: 'tax',                label: 'Tax %', numeric: true },
    ],
    PACKING_STICKER: [
      { key: 'stickerQty', label: 'Sticker Qty (Nos.)', numeric: true },
      { key: 'rate',       label: 'Rate (INR)', numeric: true },
    ],
    PACKING_BOX: [
      { key: 'boxQty',     label: 'Box Qty (Nos.)', numeric: true },
      { key: 'boxRate',    label: 'Box Rate (INR)', numeric: true },
      { key: 'plateQty',   label: 'Plate Qty (Nos.)', numeric: true },
      { key: 'plateRate',  label: 'Plate Rate (INR)', numeric: true },
    ],
    ALU: [
      { key: 'qtyRequired', label: 'Qty Required', numeric: true },
      { key: 'uom',         label: 'UOM' },
      { key: 'tax',         label: 'Tax %', numeric: true },
      { key: 'rate',        label: 'Rate / Amount (INR)', numeric: true },
      { key: 'stock',       label: 'Stock', numeric: true },
    ],
  };

  // Read-only, live-computed preview columns — the sheet recomputes these
  // itself; never sent to the server. ALU has none: its "rate" column already
  // is the row total per the sheet's own SUM formula, not qty×rate.
  const ITEM_COMPUTED = {
    ITEM_CODE: [{ key: 'amount', label: 'Total (INR)', compute: v => _num(v.qtyRequired) * _num(v.lastUnitPrice) }],
    PACKING_STICKER: [{ key: 'total', label: 'Total Amount (INR)', compute: v => _num(v.stickerQty) * _num(v.rate) }],
    PACKING_BOX: [{ key: 'total', label: 'Total (INR)', compute: v => _num(v.boxQty) * _num(v.boxRate) + _num(v.plateQty) * _num(v.plateRate) }],
    ALU: [],
  };

  /* ── state ──────────────────────────────────────────────────── */
  let _format = 'ITEM_CODE';
  let _mastersLoaded = false;
  let _vendors = [];
  let _nextPrNumber = null;
  let _lastDepartment = '';

  function _today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function _fmtMoney(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ── Helpers (styled like the PR Form / PO Creation tabs, for a consistent look) ─ */
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
  function _readonlyField(id, label, value) {
    return _fieldWrap(label, '<div id="' + id + '" style="padding:8px 10px;border:1.5px dashed #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;background:#f8fafc;">' + esc(value) + '</div>');
  }

  /* ── Masters (vendors / next PR number) ────────────────────────────────── */
  async function _loadMasters() {
    try {
      const data = await Utils.apiFetch('/api/pr-creation/masters');
      if (!data) return;
      _vendors = data.vendors || [];
      _nextPrNumber = data.nextPrNumber;
      _mastersLoaded = true;
      const el = document.getElementById('pcr-next-no');
      if (el) el.textContent = _nextPrNumber != null ? ('#' + _nextPrNumber) : '—';
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load PR masters', 'error');
    }
  }

  /* ── Party (vendor/customer) typeahead — same pattern as po-creation.js ── */
  function _partyField() {
    return _fieldWrap(PARTY_LABEL[_format], ''
      + '<input type="text" id="pcr-party" autocomplete="off" placeholder="Type to search…" style="' + _inputStyle + '" />'
      + '<div id="pcr-party-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>');
  }

  function _bindPartyField() {
    const input = document.getElementById('pcr-party');
    const dd = document.getElementById('pcr-party-dd');
    if (!input || !dd) return;
    const showMatches = () => {
      const q = input.value.trim().toLowerCase();
      const matches = (q ? _vendors.filter(v => v.toLowerCase().includes(q)) : _vendors).slice(0, 30);
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map(v => '<div class="pcr-party-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-v="' + esc(v) + '">' + esc(v) + '</div>').join('');
      const rect = input.getBoundingClientRect();
      dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = rect.width + 'px';
      dd.style.display = 'block';
    };
    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.pcr-party-opt');
      if (!opt) return;
      input.value = opt.dataset.v;
      dd.style.display = 'none';
    });
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Item-code typeahead per row — fixed-position dropdown so it isn't
     clipped by the item table's horizontal scroll ───────────────────────── */
  let _itemSearchTimer = null;
  function _bindItemCodeInput(input) {
    const row = input.closest('.pcr-item-row');
    const dd = row.querySelector('.pcr-item-dd');
    const previewDesc = row.querySelector('.pcr-item-desc');
    const previewSize = row.querySelector('.pcr-item-size');
    const runSearch = () => {
      clearTimeout(_itemSearchTimer);
      _itemSearchTimer = setTimeout(async () => {
        const q = input.value.trim();
        try {
          const res = await fetch('/api/pr-creation/items?format=' + encodeURIComponent(_format) + '&q=' + encodeURIComponent(q));
          if (!res.ok) return;
          const matches = await res.json();
          if (!matches.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = matches.map(m => '<div class="pcr-item-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-code="' + esc(m.code) + '" data-desc="' + esc(m.description) + '" data-size="' + esc(m.size) + '">'
            + '<b>' + esc(m.code) + '</b> — ' + esc(m.description) + (m.size ? ' (' + esc(m.size) + ')' : '') + '</div>').join('');
          const rect = input.getBoundingClientRect();
          dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 260) + 'px';
          dd.style.display = 'block';
        } catch {}
      }, 220);
    };
    input.addEventListener('input', runSearch);
    input.addEventListener('focus', runSearch);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.pcr-item-opt');
      if (!opt) return;
      input.value = opt.dataset.code;
      previewDesc.textContent = opt.dataset.desc || '—';
      previewSize.textContent = opt.dataset.size || '—';
      dd.style.display = 'none';
    });
    window.addEventListener('scroll', () => { dd.style.display = 'none'; }, true);
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Live computed previews (row totals + grand total) ─────────────────── */
  function _recomputeRow(row) {
    const vals = {};
    row.querySelectorAll('.pcr-item-field').forEach(inp => { vals[inp.dataset.field] = inp.value; });
    ITEM_COMPUTED[_format].forEach(c => {
      const cell = row.querySelector('.pcr-item-computed[data-key="' + c.key + '"]');
      if (cell) cell.textContent = _fmtMoney(c.compute(vals));
    });
  }

  function _recomputeGrandTotal() {
    const el = document.getElementById('pcr-grand-total');
    if (!el) return;
    let total = 0;
    document.querySelectorAll('#pcr-items-tbody .pcr-item-row').forEach(row => {
      const vals = {};
      row.querySelectorAll('.pcr-item-field').forEach(inp => { vals[inp.dataset.field] = inp.value; });
      if (_format === 'ITEM_CODE') total += _num(vals.qtyRequired) * _num(vals.lastUnitPrice);
      else if (_format === 'PACKING_STICKER') total += _num(vals.stickerQty) * _num(vals.rate);
      else if (_format === 'PACKING_BOX') total += _num(vals.boxQty) * _num(vals.boxRate) + _num(vals.plateQty) * _num(vals.plateRate);
      else if (_format === 'ALU') total += _num(vals.rate); // sheet sums the Rate column directly, not qty×rate
    });
    el.textContent = '₹' + _fmtMoney(total);
  }

  function _onFormInput(e) {
    if (e.target.matches('.pcr-item-field')) {
      const row = e.target.closest('.pcr-item-row');
      if (row) _recomputeRow(row);
    }
    if (e.target.matches('.pcr-item-field')) _recomputeGrandTotal();
  }

  /* ── Item rows ──────────────────────────────────────────────────────── */
  function _itemRowHtml() {
    const fields = ITEM_FIELDS[_format];
    const computed = ITEM_COMPUTED[_format];
    const fieldCells = fields.map(f => ''
      + '<td style="padding:6px;"><input type="' + (f.type || 'text') + '" inputmode="' + (f.numeric ? 'decimal' : 'text') + '" data-field="' + f.key + '" class="pcr-item-field" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
    ).join('');
    const computedCells = computed.map(c => '<td class="pcr-item-computed" data-key="' + c.key + '" style="padding:6px 10px;font-size:12.5px;color:#64748b;text-align:right;white-space:nowrap;">0.00</td>').join('');
    return '<tr class="pcr-item-row" style="border-bottom:1px solid #f1f5f9;">'
      + '<td style="padding:6px;min-width:150px;position:relative;">'
        + '<input type="text" class="pcr-item-code" autocomplete="off" placeholder="Item No.…" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" />'
        + '<div class="pcr-item-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>'
      + '</td>'
      + '<td style="padding:6px;min-width:140px;font-size:12px;color:#64748b;" class="pcr-item-desc">—</td>'
      + '<td style="padding:6px;min-width:90px;font-size:12px;color:#64748b;" class="pcr-item-size">—</td>'
      + fieldCells
      + computedCells
      + '<td style="padding:6px;text-align:center;"><button type="button" class="pcr-item-remove" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove row">×</button></td>'
    + '</tr>';
  }

  function _itemsTableHtml() {
    const fields = ITEM_FIELDS[_format];
    const computed = ITEM_COMPUTED[_format];
    const headCells = fields.map(f => '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(f.label) + '</th>').join('');
    const computedHeadCells = computed.map(c => '<th style="padding:8px 6px;text-align:right;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">' + esc(c.label) + '</th>').join('');
    return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:900px;">'
        + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
          + '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Item No.</th>'
          + '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Description</th>'
          + '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Size</th>'
          + headCells
          + computedHeadCells
          + '<th></th>'
        + '</tr></thead>'
        + '<tbody id="pcr-items-tbody">' + _itemRowHtml() + '</tbody>'
      + '</table>'
    + '</div>';
  }

  function _bindItemRow(rowEl) {
    _bindItemCodeInput(rowEl.querySelector('.pcr-item-code'));
    const removeBtn = rowEl.querySelector('.pcr-item-remove');
    removeBtn.addEventListener('click', () => {
      const tbody = document.getElementById('pcr-items-tbody');
      if (tbody.querySelectorAll('.pcr-item-row').length <= 1) { Utils.showToast('At least one item row is required', 'warning'); return; }
      rowEl.remove();
      _recomputeGrandTotal();
    });
  }

  function _bindAllItemRows() {
    document.querySelectorAll('#pcr-items-tbody .pcr-item-row').forEach(_bindItemRow);
  }

  /* ── Header + department fields ─────────────────────────────────────── */
  function _headerFieldsHtml() {
    const common = HEADER_FIELDS[_format].map(f => _textField('pcr-' + f.key, f.label, { type: f.type, value: f.key === 'dateRequested' ? _today() : '' })).join('');
    const deptMode = DEPARTMENT_MODE[_format];
    const dept = deptMode === 'manual'
      ? _textField('pcr-department', 'Department')
      : (deptMode === 'auto' ? _readonlyField('pcr-department-preview', 'Department (auto, from first item)', _lastDepartment || 'Filled in after saving') : '');
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
      + _readonlyField('pcr-next-no', 'PR NO (auto-assigned)', _nextPrNumber != null ? ('#' + _nextPrNumber) : 'Loading…')
      + _partyField()
      + common
      + dept
    + '</div>';
  }

  /* ── Format tabs ────────────────────────────────────────────────────── */
  function _tabsHtml() {
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap;">'
      + FORMATS.map(f => {
          const active = f === _format;
          return '<button type="button" class="pcr-format-tab" data-format="' + esc(f) + '" style="'
            + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
            + 'color:' + (active ? 'var(--color-primary)' : '#94a3b8') + ';'
            + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
            + '">' + esc(FORMAT_LABEL[f]) + '</button>';
        }).join('')
    + '</div>';
  }

  /* ── Submit ─────────────────────────────────────────────────────────── */
  function _collectItems() {
    const fields = ITEM_FIELDS[_format];
    return Array.from(document.querySelectorAll('#pcr-items-tbody .pcr-item-row')).map(row => {
      const item = { itemCode: row.querySelector('.pcr-item-code').value.trim() };
      fields.forEach(f => { item[f.key] = row.querySelector('[data-field="' + f.key + '"]').value.trim(); });
      return item;
    }).filter(it => it.itemCode);
  }

  async function _submit(e) {
    e.preventDefault();
    const body = { format: _format, items: _collectItems() };
    HEADER_FIELDS[_format].forEach(f => { body[f.key] = document.getElementById('pcr-' + f.key).value.trim(); });
    const party = document.getElementById('pcr-party').value.trim();
    if (_format === 'PACKING_STICKER' || _format === 'PACKING_BOX') body.partyName = party; else body.vendorName = party;
    if (DEPARTMENT_MODE[_format] === 'manual') body.department = document.getElementById('pcr-department').value.trim();

    if (!body.requestedBy) { Utils.showToast('Requested By is required', 'error'); return; }
    if (!party) { Utils.showToast(PARTY_LABEL[_format] + ' is required', 'error'); return; }
    if (!body.items.length) { Utils.showToast('Add at least one item', 'error'); return; }

    const btn = document.getElementById('pcr-submit-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const result = await Utils.apiFetch('/api/pr-creation', { method: 'POST', body: JSON.stringify(body) });
      _lastDepartment = result.department || '';
      Utils.showToast('PR #' + result.prNumber + ' created' + (result.pdfLink ? ' — PDF saved to Drive' : ' (PDF export failed, PR still saved)'), result.pdfLink ? 'success' : 'warning');
      await _loadMasters();
      renderPage();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to create PR', 'error');
      btn.disabled = false; btn.textContent = 'Create Purchase Requisition';
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    el.innerHTML = '<div style="max-width:1080px;margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">PR Creation</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Fills the same live PR Google Sheet the store team already uses, then saves a PDF of it to Drive.</p>'
      + '</div>'
      + _tabsHtml()
      + '<form id="pcr-form" style="display:flex;flex-direction:column;gap:16px;">'
        + _headerFieldsHtml()
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Items</div>'
        + _itemsTableHtml()
        + '<div>'
          + '<button type="button" id="pcr-add-item" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ Add Item</button>'
        + '</div>'
        + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">'
          + '<span style="font-size:12.5px;font-weight:700;color:#64748b;">Estimated Total</span>'
          + '<span id="pcr-grand-total" style="font-size:17px;font-weight:800;color:#0f172a;">₹0.00</span>'
        + '</div>'
        + '<button type="submit" id="pcr-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Create Purchase Requisition</button>'
      + '</form>'
    + '</div>';

    document.querySelectorAll('.pcr-format-tab').forEach(btn => {
      btn.addEventListener('click', () => { _format = btn.dataset.format; renderPage(); });
    });

    _bindPartyField();
    _bindAllItemRows();

    document.getElementById('pcr-add-item').addEventListener('click', () => {
      document.getElementById('pcr-items-tbody').insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(document.getElementById('pcr-items-tbody').lastElementChild);
    });

    const form = document.getElementById('pcr-form');
    form.addEventListener('submit', _submit);
    form.addEventListener('input', _onFormInput);

    if (!_mastersLoaded) _loadMasters();
  }

  return {
    render() { renderPage(); },
  };
})();
