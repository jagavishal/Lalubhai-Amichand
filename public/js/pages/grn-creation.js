window.Pages = window.Pages || {};

// ── GRN Creation ─────────────────────────────────────────────────────────────
// Mirrors the store team's live "GRN June 2026" Google Sheet field-for-field —
// the sheet itself is the database (see POST /api/grn-creation in server.js).
// Only one template ("GRN"), no format tabs like PO Creation. Submitting fills
// that tab, exports it as a PDF (saved to Drive), and logs it — the "GRN List"
// tab (in-page, alongside Create) shows that created-GRN history with filters.
window.Pages['grn-creation'] = (() => {
  /* ── state ──────────────────────────────────────────────────── */
  let _view = 'create'; // 'create' | 'list'
  let _mastersLoaded = false;
  let _vendors = [];
  let _nextGrNumber = null;
  let _poListLoaded = false;
  let _poList = []; // POs (from PO Creation's own ERP PO Log) not yet used on any GRN, for the PO No. suggestion dropdown

  // GRN List (in-page tab) state — read-only history from the ERP GRN Log tab.
  let _grlRows = [];
  let _grlLoaded = false;
  let _grlLoadError = '';
  let _grlFVendor = '';
  let _grlFFrom = '';
  let _grlFTo = '';

  function _today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function _fmtMoney(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ── Helpers (styled like PO Creation, for a consistent look) ─────────── */
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

  /* ── Masters (vendors / next GR number) ────────────────────────────── */
  async function _loadMasters() {
    try {
      const data = await Utils.apiFetch('/api/grn-creation/masters');
      if (!data) return;
      _vendors = data.vendors || [];
      _nextGrNumber = data.nextGrNumber;
      _mastersLoaded = true;
      const el = document.getElementById('grnc-next-no');
      if (el) el.textContent = _nextGrNumber != null ? ('#' + _nextGrNumber) : '—';
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load GRN masters', 'error');
    }
  }

  async function _loadPoList() {
    try {
      _poList = await Utils.apiFetch('/api/grn-creation/po-list') || [];
      _poListLoaded = true;
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load PO list', 'error');
    }
  }

  /* ── PO No. — free-text input (still fully editable/typeable) with a
     suggestion dropdown of POs not yet used on a GRN; picking one prefills
     Vendor Name, PR No. (read-only, derived from the PO itself — a PO
     already carries the PR No it was raised against) and carries that PO's
     items over (mapped field-for-field) ─────────────────────────────────── */
  function _poNoField() {
    return _fieldWrap('PO No.', ''
      + '<input type="text" id="grnc-po-no" autocomplete="off" placeholder="Type, or pick a PO…" style="' + _inputStyle + '" />'
      + '<div id="grnc-pono-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>');
  }

  // Per-format extraction, mirroring how PO Creation's own PR_ITEM_MAPPERS
  // knows each format's item shape (PurchaseOrder: qty/uom/unitPrice; ENR PO:
  // stickerQty/rate; Diamond PO: boxQty/boxRate) — the "ordered" quantity is
  // a read-only reference only, never sent back to the server.
  function _mapPoItemToGrn(it, format) {
    if (format === 'ENR PO') return { itemNo: it.itemCode || '', orderedQty: it.stickerQty || '', uom: '', rate: it.rate || '' };
    if (format === 'Diamond PO') return { itemNo: it.itemCode || '', orderedQty: it.boxQty || '', uom: '', rate: it.boxRate || '' };
    return { itemNo: it.itemCode || '', orderedQty: it.qty || '', uom: it.uom || '', rate: it.unitPrice || '' };
  }

  function _fillPoIntoForm(po) {
    const poInput = document.getElementById('grnc-po-no');
    if (poInput) poInput.value = po.poNo;
    const prDisplay = document.getElementById('grnc-pr-no');
    if (prDisplay) prDisplay.textContent = po.prNo || '—';
    const vendorInput = document.getElementById('grnc-vendor');
    if (vendorInput && po.vendorName) vendorInput.value = po.vendorName;

    const tbody = document.getElementById('grnc-items-tbody');
    if (!tbody || !Array.isArray(po.items) || !po.items.length) return;
    tbody.innerHTML = '';
    po.items.forEach(it => {
      tbody.insertAdjacentHTML('beforeend', _itemRowHtml());
      const row = tbody.lastElementChild;
      _bindItemRow(row);
      const mapped = _mapPoItemToGrn(it, po.format);
      const noInput = row.querySelector('.grnc-item-no');
      if (noInput) noInput.value = mapped.itemNo;
      const orderedCell = row.querySelector('.grnc-item-ordered');
      if (orderedCell) orderedCell.textContent = mapped.orderedQty || '—';
      // Received defaults to what was ordered — the user adjusts it down if
      // less actually arrived; Approved/Rejected start blank either way.
      const receivedInput = row.querySelector('[data-field="receivedQty"]');
      if (receivedInput) receivedInput.value = mapped.orderedQty || '';
      ['uom', 'rate'].forEach(field => {
        const fieldInput = row.querySelector('[data-field="' + field + '"]');
        if (fieldInput) fieldInput.value = mapped[field];
      });
      _recomputeRow(row);
    });
    _recomputeGrandTotal();
  }

  function _bindPoNoField() {
    const input = document.getElementById('grnc-po-no');
    const dd = document.getElementById('grnc-pono-dd');
    if (!input || !dd) return;
    const showMatches = () => {
      const q = input.value.trim().toLowerCase();
      const matches = (q
        ? _poList.filter(p => String(p.poNo).toLowerCase().includes(q) || (p.vendorName || '').toLowerCase().includes(q))
        : _poList).slice(0, 30);
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map(p => '<div class="grnc-pono-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-po="' + esc(p.poNo) + '">'
        + '<b>#' + esc(p.poNo) + '</b> — ' + esc(p.vendorName) + (p.department ? ' <span style="color:#94a3b8;">(' + esc(p.department) + ')</span>' : '') + '</div>').join('');
      const rect = input.getBoundingClientRect();
      dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 260) + 'px';
      dd.style.display = 'block';
    };
    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.grnc-pono-opt');
      if (!opt) return;
      dd.style.display = 'none';
      const po = _poList.find(p => String(p.poNo) === opt.dataset.po);
      if (po) _fillPoIntoForm(po); else input.value = opt.dataset.po;
    });
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Vendor typeahead — plain text input + filtered list, same pattern as
     PO Creation's party field ────────────────────────────────────────── */
  function _vendorField() {
    return _fieldWrap('Vendor Name', ''
      + '<input type="text" id="grnc-vendor" autocomplete="off" placeholder="Type to search…" style="' + _inputStyle + '" />'
      + '<div id="grnc-vendor-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>');
  }

  function _bindVendorField() {
    const input = document.getElementById('grnc-vendor');
    const dd = document.getElementById('grnc-vendor-dd');
    if (!input || !dd) return;
    const showMatches = () => {
      const q = input.value.trim().toLowerCase();
      const matches = (q ? _vendors.filter(v => v.toLowerCase().includes(q)) : _vendors).slice(0, 30);
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map(v => '<div class="grnc-vendor-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-v="' + esc(v) + '">' + esc(v) + '</div>').join('');
      const rect = input.getBoundingClientRect();
      dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = rect.width + 'px';
      dd.style.display = 'block';
    };
    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.grnc-vendor-opt');
      if (!opt) return;
      input.value = opt.dataset.v;
      dd.style.display = 'none';
    });
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Item-no typeahead per row — fixed-position dropdown so it isn't
     clipped by the item table's horizontal scroll ───────────────────────── */
  let _itemSearchTimer = null;
  function _bindItemNoInput(input) {
    const row = input.closest('.grnc-item-row');
    const dd = row.querySelector('.grnc-item-dd');
    const previewDesc = row.querySelector('.grnc-item-desc');
    const previewSize = row.querySelector('.grnc-item-size');
    const runSearch = () => {
      clearTimeout(_itemSearchTimer);
      _itemSearchTimer = setTimeout(async () => {
        const q = input.value.trim();
        try {
          const res = await fetch('/api/grn-creation/items?q=' + encodeURIComponent(q));
          if (!res.ok) return;
          const matches = await res.json();
          if (!matches.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = matches.map(m => '<div class="grnc-item-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-code="' + esc(m.code) + '" data-desc="' + esc(m.description) + '" data-size="' + esc(m.size) + '">'
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
      const opt = e.target.closest('.grnc-item-opt');
      if (!opt) return;
      input.value = opt.dataset.code;
      previewDesc.textContent = opt.dataset.desc || '—';
      previewSize.textContent = opt.dataset.size || '—';
      dd.style.display = 'none';
    });
    window.addEventListener('scroll', (e) => { if (e.target !== dd) dd.style.display = 'none'; }, true);
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Live computed previews (row Total, Grand Total) — Amount is Rate ×
     Approved Qty (rejected goods aren't billed), same math the sheet's own
     column-L formula does off Received Qty — see the GRN_ITEMS comment in
     server.js for why those two can drift ──────────────────────────────── */
  function _recomputeRow(row) {
    const approvedQty = _num(row.querySelector('[data-field="approvedQty"]').value);
    const rate = _num(row.querySelector('[data-field="rate"]').value);
    row.querySelector('.grnc-item-total').textContent = _fmtMoney(approvedQty * rate);
  }

  function _computeSubtotal() {
    let subtotal = 0;
    document.querySelectorAll('#grnc-items-tbody .grnc-item-row').forEach(row => {
      subtotal += _num(row.querySelector('[data-field="approvedQty"]').value) * _num(row.querySelector('[data-field="rate"]').value);
    });
    return subtotal;
  }

  function _recomputeGrandTotal() {
    const el = document.getElementById('grnc-grand-total');
    if (!el) return;
    const cgst = _num(document.getElementById('grnc-cgst').value);
    const sgst = _num(document.getElementById('grnc-sgst').value);
    const roundOff = _num(document.getElementById('grnc-round-off').value);
    el.textContent = '₹' + _fmtMoney(_computeSubtotal() + cgst + sgst + roundOff);
  }

  // Auto-fills CGST/SGST as an even split of the chosen GST % on the current
  // item Subtotal (e.g. 18% -> 9% CGST + 9% SGST) — the live GRN sheet only
  // has cells for CGST/SGST amounts (no IGST cell exists in that template),
  // so this only ever covers the intra-state case; an inter-state GRN still
  // needs its rupee amount(s) entered by hand. "Manual" (blank) leaves both
  // fields exactly as typed — this never runs unless a % is actually chosen,
  // and either field stays freely editable afterward either way.
  function _applyGstPercent() {
    const pct = _num(document.getElementById('grnc-gst-percent').value);
    if (!pct) return;
    const half = (_computeSubtotal() * pct / 2 / 100).toFixed(2);
    document.getElementById('grnc-cgst').value = half;
    document.getElementById('grnc-sgst').value = half;
  }

  function _onFormInput(e) {
    if (e.target.matches('.grnc-item-field')) {
      const row = e.target.closest('.grnc-item-row');
      if (row) _recomputeRow(row);
      _applyGstPercent(); // keep CGST/SGST following Subtotal whenever a % is selected
    }
    if (e.target.id === 'grnc-gst-percent') _applyGstPercent();
    if (e.target.matches('.grnc-item-field, .grnc-summary-field') || e.target.id === 'grnc-gst-percent') _recomputeGrandTotal();
  }

  /* ── Item rows ──────────────────────────────────────────────────────── */
  function _itemRowHtml() {
    return '<tr class="grnc-item-row" style="border-bottom:1px solid #f1f5f9;">'
      + '<td style="padding:6px;min-width:150px;position:relative;">'
        + '<input type="text" class="grnc-item-no" autocomplete="off" placeholder="Item No…" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" />'
        + '<div class="grnc-item-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>'
      + '</td>'
      + '<td style="padding:6px;min-width:140px;font-size:12px;color:#64748b;" class="grnc-item-desc">—</td>'
      + '<td style="padding:6px;min-width:90px;font-size:12px;color:#64748b;" class="grnc-item-size">—</td>'
      + '<td style="padding:6px;min-width:80px;font-size:12px;color:#64748b;text-align:right;" class="grnc-item-ordered">—</td>'
      + '<td style="padding:6px;"><input type="text" inputmode="decimal" data-field="receivedQty" class="grnc-item-field" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;"><input type="text" inputmode="decimal" data-field="approvedQty" class="grnc-item-field" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;"><input type="text" inputmode="decimal" data-field="rejectedQty" class="grnc-item-field" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;"><input type="text" data-field="uom" class="grnc-item-field" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;"><input type="text" inputmode="decimal" data-field="rate" class="grnc-item-field" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td class="grnc-item-total" style="padding:6px 10px;font-size:12.5px;color:#64748b;text-align:right;white-space:nowrap;">0.00</td>'
      + '<td style="padding:6px;text-align:center;"><button type="button" class="grnc-item-remove" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove row">×</button></td>'
    + '</tr>';
  }

  function _itemsTableHtml() {
    return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:1080px;">'
        + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
          + ['Item No.', 'Description', 'Dept/Size', 'Ordered Qty', 'Received Qty', 'Approved Qty', 'Rejected Qty', 'UOM', 'Rate per UOM'].map(h => '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '<th style="padding:8px 6px;text-align:right;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">Total (INR)</th>'
          + '<th></th>'
        + '</tr></thead>'
        + '<tbody id="grnc-items-tbody">' + _itemRowHtml() + '</tbody>'
      + '</table>'
    + '</div>';
  }

  function _bindItemRow(rowEl) {
    _bindItemNoInput(rowEl.querySelector('.grnc-item-no'));
    const removeBtn = rowEl.querySelector('.grnc-item-remove');
    removeBtn.addEventListener('click', () => {
      const tbody = document.getElementById('grnc-items-tbody');
      if (tbody.querySelectorAll('.grnc-item-row').length <= 1) { Utils.showToast('At least one item row is required', 'warning'); return; }
      rowEl.remove();
      _recomputeGrandTotal();
    });
  }

  function _bindAllItemRows() {
    document.querySelectorAll('#grnc-items-tbody .grnc-item-row').forEach(_bindItemRow);
  }

  /* ── GRN List (in-page tab) — read-only history from the ERP GRN Log tab,
     filterable by vendor/date range ─────────────────────────────────────── */
  async function _grlLoad() {
    _grlLoaded = false;
    _grlLoadError = '';
    _grlRenderTable();
    try {
      _grlRows = await Utils.apiFetch('/api/grn-creation/list') || [];
    } catch (e) {
      _grlRows = [];
      _grlLoadError = e.message || 'Failed to load GRNs';
    }
    _grlLoaded = true;
    _grlRenderTable();
  }

  function _grlFilteredRows() {
    return _grlRows.filter(r => {
      if (_grlFVendor && !(r.vendorName || '').toLowerCase().includes(_grlFVendor.toLowerCase())) return false;
      if (_grlFFrom && (r.date || '') < _grlFFrom) return false;
      if (_grlFTo && (r.date || '') > _grlFTo) return false;
      return true;
    });
  }

  function _grlRenderTable() {
    const body = document.getElementById('grnl-body');
    const countEl = document.getElementById('grnl-count');
    if (!body) return;

    if (!_grlLoaded) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_grlLoadError) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_grlLoadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = _grlFilteredRows();
    if (countEl) countEl.textContent = rows.length + ' of ' + _grlRows.length;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_grlRows.length ? 'No GRNs match these filters' : 'No GRNs created yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">#' + esc(r.grNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.vendorName) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.prNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.poNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.total) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.createdBy) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + (r.pdfLink ? '<a href="' + esc(r.pdfLink) + '" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">View PDF</a>' : '<span style="color:#cbd5e1;">—</span>') + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
          + (r.status === 'Cancelled'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
            : '<button type="button" class="grnc-cancel-btn" data-gr="' + esc(r.grNo) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
        + '</td>'
      + '</tr>').join('');
  }

  function _grlBindRowActions() {
    const body = document.getElementById('grnl-body');
    if (!body || body.dataset.actionsBound) return;
    body.dataset.actionsBound = '1';
    body.addEventListener('click', async (e) => {
      const cancelBtn = e.target.closest('.grnc-cancel-btn');
      if (cancelBtn) {
        const ok = await Utils.showConfirm('GR #' + cancelBtn.dataset.gr + ' will be marked Cancelled. This can\'t be undone.', { title: 'Cancel GRN', confirmText: 'Cancel GRN', danger: true });
        if (!ok) return;
        try {
          await Utils.apiFetch('/api/grn-creation/cancel?grNo=' + encodeURIComponent(cancelBtn.dataset.gr), { method: 'PUT' });
          Utils.showToast('GR #' + cancelBtn.dataset.gr + ' cancelled', 'success');
          await _grlLoad();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to cancel', 'error');
        }
      }
    });
  }

  function _grlFilterBarHtml() {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<input type="text" id="grnl-vendor" placeholder="Search vendor…" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
      + '<input type="date" id="grnl-from" style="' + _inputStyle + 'width:auto;" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="grnl-to" style="' + _inputStyle + 'width:auto;" />'
      + '<button type="button" id="grnl-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="grnl-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _grlBindFilterBar() {
    document.getElementById('grnl-vendor').addEventListener('input', (e) => { _grlFVendor = e.target.value; _grlRenderTable(); });
    document.getElementById('grnl-from').addEventListener('change', (e) => { _grlFFrom = e.target.value; _grlRenderTable(); });
    document.getElementById('grnl-to').addEventListener('change', (e) => { _grlFTo = e.target.value; _grlRenderTable(); });
    document.getElementById('grnl-clear').addEventListener('click', () => {
      _grlFVendor = ''; _grlFFrom = ''; _grlFTo = '';
      document.getElementById('grnl-vendor').value = '';
      document.getElementById('grnl-from').value = '';
      document.getElementById('grnl-to').value = '';
      _grlRenderTable();
    });
    document.getElementById('grnl-refresh').addEventListener('click', _grlLoad);
  }

  function _grlViewHtml() {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<p style="font-size:12.5px;color:#64748b;margin:0;">Every GRN created here, read live from the sheet\'s ERP GRN Log.</p>'
        + '<span id="grnl-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _grlFilterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:920px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['GR No', 'Date', 'Vendor', 'PR No', 'PO No', 'Total (INR)', 'Created By', 'PDF', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="grnl-body"><tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>';
  }

  /* ── Header fields ──────────────────────────────────────────────────── */
  function _headerFieldsHtml() {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
      + _textField('grnc-date', 'Date of Making GRN', { type: 'date', value: _today() })
      + _readonlyField('grnc-next-no', 'GR NO. (auto-assigned)', _nextGrNumber != null ? ('#' + _nextGrNumber) : 'Loading…')
      + _textField('grnc-made-by', 'Made By', { value: (window.currentUser && window.currentUser.name) || '' })
      + _poNoField()
      + _readonlyField('grnc-pr-no', 'PR No.', '—')
      + _vendorField()
      + _textField('grnc-bill-no', 'Bill No')
      + _textField('grnc-bill-recv-date', 'Bill Recv. Date', { type: 'date' })
      + _textField('grnc-dept-head', 'Dept. Head')
    + '</div>';
  }

  /* ── Tabs (Create + GRN List, same in-page-tab pattern as PO Creation) ── */
  function _tabTab(label, active, extraAttrs) {
    return '<button type="button" ' + extraAttrs + ' style="'
      + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
      + 'color:' + (active ? 'var(--color-primary)' : '#94a3b8') + ';'
      + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
      + '">' + esc(label) + '</button>';
  }

  function _tabsHtml() {
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">'
      + _tabTab('Create GRN', _view === 'create', 'class="grnc-create-tab"')
      + _tabTab('GRN List', _view === 'list', 'class="grnc-list-tab"')
    + '</div>';
  }

  /* ── Submit ─────────────────────────────────────────────────────────── */
  function _collectItems() {
    return Array.from(document.querySelectorAll('#grnc-items-tbody .grnc-item-row')).map(row => ({
      itemNo: row.querySelector('.grnc-item-no').value.trim(),
      receivedQty: row.querySelector('[data-field="receivedQty"]').value.trim(),
      approvedQty: row.querySelector('[data-field="approvedQty"]').value.trim(),
      rejectedQty: row.querySelector('[data-field="rejectedQty"]').value.trim(),
      uom: row.querySelector('[data-field="uom"]').value.trim(),
      rate: row.querySelector('[data-field="rate"]').value.trim(),
    })).filter(it => it.itemNo);
  }

  async function _submit(e) {
    e.preventDefault();
    const date = document.getElementById('grnc-date').value;
    const madeBy = document.getElementById('grnc-made-by').value.trim();
    const poNo = document.getElementById('grnc-po-no').value.trim();
    const prNoText = document.getElementById('grnc-pr-no').textContent.trim();
    const prNo = prNoText === '—' ? '' : prNoText;
    const vendorName = document.getElementById('grnc-vendor').value.trim();
    const billNo = document.getElementById('grnc-bill-no').value.trim();
    const billRecvDate = document.getElementById('grnc-bill-recv-date').value;
    const deptHead = document.getElementById('grnc-dept-head').value.trim();
    const comments = document.getElementById('grnc-comments').value.trim();
    const cgst = document.getElementById('grnc-cgst').value.trim();
    const sgst = document.getElementById('grnc-sgst').value.trim();
    const roundOff = document.getElementById('grnc-round-off').value.trim();
    const items = _collectItems();

    if (!date) { Utils.showToast('Date is required', 'error'); return; }
    if (!vendorName) { Utils.showToast('Vendor Name is required', 'error'); return; }
    if (!madeBy) { Utils.showToast('Made By is required', 'error'); return; }
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }

    const btn = document.getElementById('grnc-submit-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const result = await Utils.apiFetch('/api/grn-creation', {
        method: 'POST',
        body: JSON.stringify({ date, madeBy, prNo, poNo, vendorName, billNo, billRecvDate, deptHead, comments, cgst, sgst, roundOff, items }),
      });
      Utils.showToast('GR #' + result.grNumber + ' created' + (result.pdfLink ? ' — PDF saved to Drive' : ' (PDF export failed, GRN still saved)'), result.pdfLink ? 'success' : 'warning');
      await _loadMasters();
      renderPage();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to create GRN', 'error');
      btn.disabled = false; btn.textContent = 'Create GRN';
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const isList = _view === 'list';
    const bodyHtml = isList
      ? _grlViewHtml()
      : '<form id="grnc-form" style="display:flex;flex-direction:column;gap:16px;">'
        + _headerFieldsHtml()
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Items</div>'
        + _itemsTableHtml()
        + '<div>'
          + '<button type="button" id="grnc-add-item" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ Add Item</button>'
        + '</div>'
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Comments</div>'
        + _fieldWrap('Extra Comments / Reason for GRN Delay', '<textarea id="grnc-comments" rows="2" style="' + _inputStyle + 'resize:vertical;"></textarea>')
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Charges</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;">'
          + _fieldWrap('GST % (auto-fills CGST + SGST)', '<select id="grnc-gst-percent" style="' + _inputStyle + 'background:#fff;">'
              + [['', 'Manual — enter below myself'], ['0', '0%'], ['5', '5% (2.5 + 2.5)'], ['12', '12% (6 + 6)'], ['18', '18% (9 + 9)'], ['28', '28% (14 + 14)']]
                .map(([v, label]) => '<option value="' + v + '">' + esc(label) + '</option>').join('')
            + '</select>', 'grid-column:1 / -1;max-width:280px;')
          + _fieldWrap('CGST', '<input type="text" inputmode="decimal" id="grnc-cgst" class="grnc-summary-field" style="' + _inputStyle + '" placeholder="0" />')
          + _fieldWrap('SGST', '<input type="text" inputmode="decimal" id="grnc-sgst" class="grnc-summary-field" style="' + _inputStyle + '" placeholder="0" />')
          + _fieldWrap('Round Off', '<input type="text" inputmode="decimal" id="grnc-round-off" class="grnc-summary-field" style="' + _inputStyle + '" placeholder="0" />')
        + '</div>'
        + '<div style="font-size:11.5px;color:#94a3b8;margin:-10px 2px 0;">Inter-state vendor (IGST)? The live GRN sheet doesn\'t have an IGST cell yet — enter the full amount in CGST or SGST and adjust manually, or ask to have an IGST row added to the sheet.</div>'
        + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">'
          + '<span style="font-size:12.5px;font-weight:700;color:#64748b;">Estimated Total</span>'
          + '<span id="grnc-grand-total" style="font-size:17px;font-weight:800;color:#0f172a;">₹0.00</span>'
        + '</div>'
        + '<button type="submit" id="grnc-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Create GRN</button>'
      + '</form>';

    el.innerHTML = '<div style="max-width:' + (isList ? '1200px' : '1080px') + ';margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">GRN Creation</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Fills the same live GRN Google Sheet the store team already uses, then saves a PDF of it to Drive.</p>'
      + '</div>'
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    document.querySelector('.grnc-create-tab').addEventListener('click', () => { _view = 'create'; renderPage(); });
    document.querySelector('.grnc-list-tab').addEventListener('click', () => { _view = 'list'; renderPage(); });

    if (isList) {
      _grlBindFilterBar();
      _grlBindRowActions();
      _grlLoad();
      return;
    }

    _bindVendorField();
    _bindPoNoField();
    _bindAllItemRows();

    document.getElementById('grnc-add-item').addEventListener('click', () => {
      document.getElementById('grnc-items-tbody').insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(document.getElementById('grnc-items-tbody').lastElementChild);
    });

    const form = document.getElementById('grnc-form');
    form.addEventListener('submit', _submit);
    form.addEventListener('input', _onFormInput);

    if (!_mastersLoaded) _loadMasters();
    if (!_poListLoaded) _loadPoList();
  }

  return {
    render() { renderPage(); },
  };
})();
