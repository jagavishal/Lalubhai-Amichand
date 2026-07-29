window.Pages = window.Pages || {};

// ── PO Creation ──────────────────────────────────────────────────────────────
// Mirrors the store team's live "PO July 2026" Google Sheet field-for-field —
// the sheet itself is the database (see POST /api/po-creation in server.js).
// Three formats, each its own template tab in that sheet: PurchaseOrder / ENR PO
// / Diamond PO. Submitting fills the matching tab, exports it as a PDF (saved
// to Drive), and logs it — see the separate "PO List" tab for the created-PO
// history with filters (po-list.js).
window.Pages['po-creation'] = (() => {
  const FORMATS = ['PurchaseOrder', 'ENR PO', 'Diamond PO'];
  const FORMAT_LABEL = { PurchaseOrder: 'Purchase Order', 'ENR PO': 'ENR PO', 'Diamond PO': 'Diamond PO' };
  const PARTY_LABEL  = { PurchaseOrder: 'Customer Name', 'ENR PO': 'Vendor', 'Diamond PO': 'Vendor' };
  const ITEM_CODE_LABEL = { PurchaseOrder: 'Item Code', 'ENR PO': 'Item #', 'Diamond PO': 'Item #' };

  // Fallback list — replaced by the live sheet's own Department dropdown
  // (Vendor Details!N3:N31) once /api/po-creation/masters resolves.
  let _departments = [
    'Press Shop', 'Accessories', 'Fitting', 'Spinning', 'Milk Jug Fitting', 'Washing', 'Packing',
    'Tool Room', 'Store', 'Time Keeper', 'Cnc', 'Circles', 'Riveting Department', 'ST STEEL', 'PRESSING', 'ALU CIRCLE',
  ];

  // Manual columns per format, in on-sheet order — everything else (description,
  // size, amount/total) is computed by the sheet's own formulas once Item Code
  // is filled in, so those are shown read-only and never sent to the server.
  const ITEM_FIELDS = {
    PurchaseOrder: [
      { key: 'hsnCode',   label: 'HSN Code' },
      { key: 'uom',       label: 'UOM' },
      { key: 'qty',       label: 'Qty', numeric: true },
      { key: 'unitPrice', label: 'Unit Price (INR)', numeric: true },
      { key: 'gst',       label: 'GST %', numeric: true },
    ],
    'ENR PO': [
      { key: 'customerCodeRef', label: 'Customer Code/Ref.' },
      { key: 'barcode',         label: 'Barcode' },
      { key: 'stickerQty',      label: 'Sticker Qty (Nos.)', numeric: true },
      { key: 'rate',            label: 'Rate (INR)', numeric: true },
      { key: 'taxPercent',      label: 'Tax %', numeric: true },
    ],
    'Diamond PO': [
      { key: 'boxQty',    label: 'Box Qty (Nos.)', numeric: true },
      { key: 'boxRate',   label: 'Box Rate (INR)', numeric: true },
      { key: 'plateQty',  label: 'Plate Qty (Nos.)', numeric: true },
      { key: 'plateRate', label: 'Plate Rate (INR)', numeric: true },
    ],
  };

  // Read-only, live-computed columns — same math the sheet's own formulas do,
  // shown here purely as a preview (the sheet recomputes these itself; these
  // values are never sent to the server).
  const ITEM_COMPUTED = {
    PurchaseOrder: [
      { key: 'amount',        label: 'Amount (INR)',         compute: v => _num(v.qty) * _num(v.unitPrice) },
      { key: 'amountWithTax', label: 'Amount w/ Tax (INR)',   compute: v => { const a = _num(v.qty) * _num(v.unitPrice); return a + a * _num(v.gst) / 100; } },
    ],
    'ENR PO': [
      { key: 'total', label: 'Total Amount (INR)', compute: v => { const b = _num(v.stickerQty) * _num(v.rate); return b + b * _num(v.taxPercent) / 100; } },
    ],
    'Diamond PO': [
      { key: 'total', label: 'Total (INR)', compute: v => _num(v.boxQty) * _num(v.boxRate) + _num(v.plateQty) * _num(v.plateRate) },
    ],
  };

  // Financial fields below the item table that feed the sheet's own Total
  // formula — always sent (defaulting to 0) so a previous PO's numbers can
  // never bleed into a new one.
  const SUMMARY_FIELDS = {
    PurchaseOrder: [
      { key: 'freightCharges', label: 'Freight Charges' },
      { key: 'packingCharges', label: 'Packing Charges' },
      { key: 'discount',       label: 'Discount' },
    ],
    'ENR PO': [
      { key: 'shipping',        label: 'Shipping' },
      { key: 'other',           label: 'Other' },
      { key: 'discountPercent', label: 'Discount %' },
    ],
    'Diamond PO': [
      { key: 'gstPercent',      label: 'GST %' },
      { key: 'shipping',        label: 'Shipping' },
      { key: 'other',           label: 'Other' },
      { key: 'discountPercent', label: 'Discount %' },
    ],
  };

  /* ── state ──────────────────────────────────────────────────── */
  let _format = 'PurchaseOrder';
  let _mastersLoaded = false;
  let _vendors = [];
  let _shipToLocations = [];
  let _nextPoNumber = null;

  function _today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function _fmtMoney(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ── Helpers (styled like the PR Form tab, for a consistent look) ─────── */
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

  /* ── Masters (vendors / ship-to / departments / next PO number) ───────── */
  async function _loadMasters() {
    try {
      const data = await Utils.apiFetch('/api/po-creation/masters');
      if (!data) return;
      _vendors = data.vendors || [];
      _shipToLocations = data.shipToLocations || [];
      if (Array.isArray(data.departments) && data.departments.length) _departments = data.departments;
      _nextPoNumber = data.nextPoNumber;
      _mastersLoaded = true;
      const el = document.getElementById('poc-next-no');
      if (el) el.textContent = _nextPoNumber != null ? ('#' + _nextPoNumber) : '—';
      // Options render before this fetch resolves (shows "Loading…") — patch
      // selects in place so an in-progress fill on other fields isn't wiped out.
      const shipToSel = document.getElementById('poc-ship-to');
      if (shipToSel && _shipToLocations.length) {
        shipToSel.innerHTML = _shipToLocations.map(s => '<option value="' + esc(s) + '"' + (s.includes('(Factory)') ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
      }
      const deptSel = document.getElementById('poc-department');
      if (deptSel) {
        const current = deptSel.value;
        deptSel.innerHTML = '<option value="">Select…</option>' + _departments.map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
        if (current) deptSel.value = current;
      }
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load PO masters', 'error');
    }
  }

  /* ── Party (customer/vendor) typeahead — plain text input + filtered list,
     same pattern as the PR Form's vendor search box ─────────────────────── */
  function _partyField() {
    return _fieldWrap(PARTY_LABEL[_format], ''
      + '<input type="text" id="poc-party" autocomplete="off" placeholder="Type to search…" style="' + _inputStyle + '" />'
      + '<div id="poc-party-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>');
  }

  function _bindPartyField() {
    const input = document.getElementById('poc-party');
    const dd = document.getElementById('poc-party-dd');
    if (!input || !dd) return;
    const showMatches = () => {
      const q = input.value.trim().toLowerCase();
      const matches = (q ? _vendors.filter(v => v.toLowerCase().includes(q)) : _vendors).slice(0, 30);
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map(v => '<div class="poc-party-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-v="' + esc(v) + '">' + esc(v) + '</div>').join('');
      const rect = input.getBoundingClientRect();
      dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = rect.width + 'px';
      dd.style.display = 'block';
    };
    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.poc-party-opt');
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
    const row = input.closest('.poc-item-row');
    const dd = row.querySelector('.poc-item-dd');
    const previewDesc = row.querySelector('.poc-item-desc');
    const previewSize = row.querySelector('.poc-item-size');
    const runSearch = () => {
      clearTimeout(_itemSearchTimer);
      _itemSearchTimer = setTimeout(async () => {
        const q = input.value.trim();
        try {
          const res = await fetch('/api/po-creation/items?format=' + encodeURIComponent(_format) + '&q=' + encodeURIComponent(q));
          if (!res.ok) return;
          const matches = await res.json();
          if (!matches.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = matches.map(m => '<div class="poc-item-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-code="' + esc(m.code) + '" data-desc="' + esc(m.description) + '" data-size="' + esc(m.size) + '">'
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
      const opt = e.target.closest('.poc-item-opt');
      if (!opt) return;
      input.value = opt.dataset.code;
      previewDesc.textContent = opt.dataset.desc || '—';
      previewSize.textContent = opt.dataset.size || '—';
      dd.style.display = 'none';
    });
    window.addEventListener('scroll', () => { dd.style.display = 'none'; }, true);
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Live computed previews (Amount / Amount w/ Tax / Total, Grand Total) ─ */
  function _recomputeRow(row) {
    const vals = {};
    row.querySelectorAll('.poc-item-field').forEach(inp => { vals[inp.dataset.field] = inp.value; });
    ITEM_COMPUTED[_format].forEach(c => {
      const cell = row.querySelector('.poc-item-computed[data-key="' + c.key + '"]');
      if (cell) cell.textContent = _fmtMoney(c.compute(vals));
    });
  }

  function _recomputeGrandTotal() {
    const el = document.getElementById('poc-grand-total');
    if (!el) return;
    let subtotal = 0, taxInclusive = 0, itemsSum = 0;
    document.querySelectorAll('#poc-items-tbody .poc-item-row').forEach(row => {
      const vals = {};
      row.querySelectorAll('.poc-item-field').forEach(inp => { vals[inp.dataset.field] = inp.value; });
      if (_format === 'PurchaseOrder') {
        const amt = _num(vals.qty) * _num(vals.unitPrice);
        subtotal += amt;
        taxInclusive += amt + amt * _num(vals.gst) / 100;
      } else if (_format === 'ENR PO') {
        const base = _num(vals.stickerQty) * _num(vals.rate);
        itemsSum += base + base * _num(vals.taxPercent) / 100;
      } else if (_format === 'Diamond PO') {
        itemsSum += _num(vals.boxQty) * _num(vals.boxRate) + _num(vals.plateQty) * _num(vals.plateRate);
      }
    });

    const s = {};
    document.querySelectorAll('.poc-summary-field').forEach(inp => { s[inp.dataset.field] = inp.value; });

    let total = 0;
    if (_format === 'PurchaseOrder') {
      total = taxInclusive + _num(s.freightCharges) + _num(s.packingCharges) - _num(s.discount);
    } else if (_format === 'ENR PO') {
      total = itemsSum + _num(s.shipping) + _num(s.other) - itemsSum * _num(s.discountPercent) / 100;
    } else if (_format === 'Diamond PO') {
      const gstAmt = itemsSum * _num(s.gstPercent) / 100;
      total = itemsSum + gstAmt + _num(s.shipping) + _num(s.other) - itemsSum * _num(s.discountPercent) / 100;
    }
    el.textContent = '₹' + _fmtMoney(total);
  }

  function _onFormInput(e) {
    if (e.target.matches('.poc-item-field')) {
      const row = e.target.closest('.poc-item-row');
      if (row) _recomputeRow(row);
    }
    if (e.target.matches('.poc-item-field, .poc-summary-field')) _recomputeGrandTotal();
  }

  /* ── Item rows ──────────────────────────────────────────────────────── */
  function _itemRowHtml() {
    const fields = ITEM_FIELDS[_format];
    const computed = ITEM_COMPUTED[_format];
    const fieldCells = fields.map(f => ''
      + '<td style="padding:6px;"><input type="text" inputmode="' + (f.numeric ? 'decimal' : 'text') + '" data-field="' + f.key + '" class="poc-item-field" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
    ).join('');
    const computedCells = computed.map(c => '<td class="poc-item-computed" data-key="' + c.key + '" style="padding:6px 10px;font-size:12.5px;color:#64748b;text-align:right;white-space:nowrap;">0.00</td>').join('');
    return '<tr class="poc-item-row" style="border-bottom:1px solid #f1f5f9;">'
      + '<td style="padding:6px;min-width:150px;position:relative;">'
        + '<input type="text" class="poc-item-code" autocomplete="off" placeholder="' + esc(ITEM_CODE_LABEL[_format]) + '…" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" />'
        + '<div class="poc-item-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>'
      + '</td>'
      + '<td style="padding:6px;min-width:140px;font-size:12px;color:#64748b;" class="poc-item-desc">—</td>'
      + '<td style="padding:6px;min-width:90px;font-size:12px;color:#64748b;" class="poc-item-size">—</td>'
      + fieldCells
      + computedCells
      + '<td style="padding:6px;text-align:center;"><button type="button" class="poc-item-remove" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove row">×</button></td>'
    + '</tr>';
  }

  function _itemsTableHtml() {
    const fields = ITEM_FIELDS[_format];
    const computed = ITEM_COMPUTED[_format];
    const headCells = fields.map(f => '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(f.label) + '</th>').join('');
    const computedHeadCells = computed.map(c => '<th style="padding:8px 6px;text-align:right;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">' + esc(c.label) + '</th>').join('');
    return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:960px;">'
        + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
          + '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(ITEM_CODE_LABEL[_format]) + '</th>'
          + '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Description</th>'
          + '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Size</th>'
          + headCells
          + computedHeadCells
          + '<th></th>'
        + '</tr></thead>'
        + '<tbody id="poc-items-tbody">' + _itemRowHtml() + '</tbody>'
      + '</table>'
    + '</div>';
  }

  function _bindItemRow(rowEl) {
    _bindItemCodeInput(rowEl.querySelector('.poc-item-code'));
    const removeBtn = rowEl.querySelector('.poc-item-remove');
    removeBtn.addEventListener('click', () => {
      const tbody = document.getElementById('poc-items-tbody');
      if (tbody.querySelectorAll('.poc-item-row').length <= 1) { Utils.showToast('At least one item row is required', 'warning'); return; }
      rowEl.remove();
      _recomputeGrandTotal();
    });
  }

  function _bindAllItemRows() {
    document.querySelectorAll('#poc-items-tbody .poc-item-row').forEach(_bindItemRow);
  }

  /* ── Summary (financial) fields ─────────────────────────────────────── */
  function _summaryFieldsHtml() {
    return SUMMARY_FIELDS[_format].map(f => _fieldWrap(f.label,
      '<input type="text" inputmode="decimal" data-field="' + f.key + '" class="poc-summary-field" style="' + _inputStyle + '" placeholder="0" />'
    )).join('');
  }

  /* ── Header fields per format ───────────────────────────────────────── */
  function _headerFieldsHtml() {
    const shipToOptions = _shipToLocations.length
      ? _shipToLocations.map(s => '<option value="' + esc(s) + '"' + (s.includes('(Factory)') ? ' selected' : '') + '>' + esc(s) + '</option>').join('')
      : '<option value="">Loading…</option>';
    const deptOptions = '<option value="">Select…</option>' + _departments.map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');

    const common = ''
      + _textField('poc-date', 'Date', { type: 'date', value: _today() })
      + _readonlyField('poc-next-no', 'P.O. NO (auto-assigned)', _nextPoNumber != null ? ('#' + _nextPoNumber) : 'Loading…')
      + _textField('poc-pr-no', 'P.R. NO')
      + _fieldWrap('Department', '<select id="poc-department" style="' + _inputStyle + 'background:#fff;">' + deptOptions + '</select>')
      + _partyField();

    const shipTo = _format === 'PurchaseOrder'
      ? _fieldWrap('Ship To', '<select id="poc-ship-to" style="' + _inputStyle + 'background:#fff;">' + shipToOptions + '</select>')
      : '';

    const terms = ''
      + _textField('poc-delivery-schedule', 'Delivery Schedule', { type: 'date' })
      + _textField('poc-po-validity', 'PO Validity From Date of Issuing', { placeholder: '1 MONTH', value: '1 MONTH' })
      + _textField('poc-payment-terms', 'Payment Terms', { placeholder: '30 days', value: '30 days' })
      + _textField('poc-po-made-by', 'PO Made By', { value: (window.currentUser && window.currentUser.name) || '' });

    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">' + common + shipTo + terms + '</div>';
  }

  /* ── Format tabs ────────────────────────────────────────────────────── */
  function _tabsHtml() {
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">'
      + FORMATS.map(f => {
          const active = f === _format;
          return '<button type="button" class="poc-format-tab" data-format="' + esc(f) + '" style="'
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
    return Array.from(document.querySelectorAll('#poc-items-tbody .poc-item-row')).map(row => {
      const item = { itemCode: row.querySelector('.poc-item-code').value.trim() };
      fields.forEach(f => { item[f.key] = row.querySelector('[data-field="' + f.key + '"]').value.trim(); });
      return item;
    }).filter(it => it.itemCode);
  }

  function _collectSummary() {
    const summary = {};
    document.querySelectorAll('.poc-summary-field').forEach(inp => { summary[inp.dataset.field] = inp.value.trim(); });
    return summary;
  }

  async function _submit(e) {
    e.preventDefault();
    const date = document.getElementById('poc-date').value;
    const prNo = document.getElementById('poc-pr-no').value.trim();
    const department = document.getElementById('poc-department').value;
    const party = document.getElementById('poc-party').value.trim();
    const shipTo = _format === 'PurchaseOrder' ? document.getElementById('poc-ship-to').value : '';
    const deliverySchedule = document.getElementById('poc-delivery-schedule').value;
    const poValidity = document.getElementById('poc-po-validity').value.trim();
    const paymentTerms = document.getElementById('poc-payment-terms').value.trim();
    const poMadeBy = document.getElementById('poc-po-made-by').value.trim();
    const items = _collectItems();
    const summary = _collectSummary();

    if (!date) { Utils.showToast('Date is required', 'error'); return; }
    if (!party) { Utils.showToast(PARTY_LABEL[_format] + ' is required', 'error'); return; }
    if (!poMadeBy) { Utils.showToast('PO Made By is required', 'error'); return; }
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }

    const btn = document.getElementById('poc-submit-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const result = await Utils.apiFetch('/api/po-creation', {
        method: 'POST',
        body: JSON.stringify({ format: _format, date, prNo, department, party, shipTo, deliverySchedule, poValidity, paymentTerms, poMadeBy, items, summary }),
      });
      Utils.showToast('PO #' + result.poNumber + ' created' + (result.pdfLink ? ' — PDF saved to Drive' : ' (PDF export failed, PO still saved)'), result.pdfLink ? 'success' : 'warning');
      await _loadMasters();
      renderPage();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to create PO', 'error');
      btn.disabled = false; btn.textContent = 'Create Purchase Order';
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    el.innerHTML = '<div style="max-width:1080px;margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">PO Creation</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Fills the same live PO Google Sheet the store team already uses, then saves a PDF of it to Drive.</p>'
      + '</div>'
      + _tabsHtml()
      + '<form id="poc-form" style="display:flex;flex-direction:column;gap:16px;">'
        + _headerFieldsHtml()
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Items</div>'
        + _itemsTableHtml()
        + '<div>'
          + '<button type="button" id="poc-add-item" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ Add Item</button>'
        + '</div>'
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Charges</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;">' + _summaryFieldsHtml() + '</div>'
        + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">'
          + '<span style="font-size:12.5px;font-weight:700;color:#64748b;">Estimated Total</span>'
          + '<span id="poc-grand-total" style="font-size:17px;font-weight:800;color:#0f172a;">₹0.00</span>'
        + '</div>'
        + '<button type="submit" id="poc-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Create Purchase Order</button>'
      + '</form>'
    + '</div>';

    document.querySelectorAll('.poc-format-tab').forEach(btn => {
      btn.addEventListener('click', () => { _format = btn.dataset.format; renderPage(); });
    });

    _bindPartyField();
    _bindAllItemRows();

    document.getElementById('poc-add-item').addEventListener('click', () => {
      document.getElementById('poc-items-tbody').insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(document.getElementById('poc-items-tbody').lastElementChild);
    });

    const form = document.getElementById('poc-form');
    form.addEventListener('submit', _submit);
    form.addEventListener('input', _onFormInput);

    if (!_mastersLoaded) _loadMasters();
  }

  return {
    render() { renderPage(); },
  };
})();
