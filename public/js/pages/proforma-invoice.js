window.Pages = window.Pages || {};

// ── Proforma Invoice (PI) Creation ────────────────────────────────────────────
// Fills a brand-new, dedicated live Google Sheet ("ERP - Proforma Invoice" —
// see PI_CREATION_SHEET_ID in server.js / scripts/rebuild-pi-sheet.js). Unlike
// PO/PR/GRN Creation (create-then-Cancel-only), a PI is a genuine two-stage
// record: any User creates it (consignee + shipping + items — no price at all),
// then whoever is granted the 'set_price' feature for this page (Admin/HOD
// always, or a specific User granted it from Users → Access tab) opens that
// same PI and fills in the C&F US$ rate per piece, which finalizes it in place.
//
// This is the company's EXPORT PI / OCS document — priced in C&F US$, with
// consignee/port/container details and CBM + weight per line. There is no
// GST/HSN/INR anywhere: those belong to a domestic invoice, which this app
// does not raise. The printed layout lives in backend/lib/pi-format.js.
window.Pages['proforma-invoice'] = (() => {
  /* ── permission helper — same hasFeature() shape as all-tasks.js /
     client-master.js, scoped to this page's one feature key ───────────── */
  function _hasFeature(feat) {
    const roles = window.currentUser?.roles || [];
    const isAdmin = Array.isArray(roles)
      ? (roles.includes('Admin') || roles.includes('HOD'))
      : (String(roles).includes('Admin') || String(roles).includes('HOD'));
    if (isAdmin) return true;
    const perms = window.currentUser?.permissions;
    if (!perms || !perms.features) return true;
    const pageFeats = perms.features['proforma-invoice'];
    if (!pageFeats) return false;
    return pageFeats.includes(feat);
  }

  /* ── state ──────────────────────────────────────────────────── */
  let _view = 'create'; // 'create' | 'list'
  let _mastersLoaded = false;
  let _nextPiNumber = null;
  let _recentBuyers = [];
  let _defaults = null;     // boilerplate from backend/lib/pi-format.js
  let _maxItems = 30;
  let _assignees = [];      // who a PI can be handed to in the FMS tracker

  // PI List (in-page tab) state — read-only history from the ERP PI Log tab.
  let _pilRows = [];
  let _pilLoaded = false;
  let _pilLoadError = '';
  let _pilFBuyer = '';
  let _pilFFrom = '';
  let _pilFTo = '';

  // Add Price modal state.
  let _priceModalRow = null; // the PI row (from _pilRows) currently being priced, or null
  let _priceSaving = false;
  // Set only when the Add Price screen was reached from an FMS "Add Pricing"
  // step (see openPriceFor below) — the hash to send the user back to once the
  // price is saved, so they land where they clicked Done, not on the PI List.
  let _priceReturnHash = '';
  // True for exactly one router render: the one openPriceFor() is navigating
  // into. Without it, a price modal the user walked away from instead of
  // closing would pop up again the next time they opened this page.
  let _priceQueued = false;

  // New Product modal state.
  let _newProductOpen = false;
  let _newProductPhoto = null;   // data URL, uploaded to Drive on save
  let _newProductSaving = false;

  function _today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function _fmtUsd(n) { return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ── field helpers (styled like PO/GRN Creation, for a consistent look) ── */
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
  function _textareaField(id, label, value, rows) {
    return _fieldWrap(label, '<textarea id="' + id + '" rows="' + (rows || 8) + '" style="' + _inputStyle + 'resize:vertical;line-height:1.5;font-family:inherit;">' + esc(value) + '</textarea>');
  }
  function _sectionTitle(text) {
    return '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:8px 2px -4px;">' + esc(text) + '</div>';
  }

  /* ── Masters (next PI number / recent buyers / boilerplate defaults) ──
     The PI number is scoped to the PI date's financial year ("VTV/052/25-26"),
     so it is re-fetched whenever the date changes — the server assigns the
     real one at submit time regardless, this is only the preview. */
  async function _loadMasters(date) {
    try {
      const data = await Utils.apiFetch('/api/proforma-invoice/masters?date=' + encodeURIComponent(date || _today()));
      if (!data) return;
      _nextPiNumber = data.nextPiNumber;
      _recentBuyers = data.recentBuyers || [];
      if (data.defaults) _defaults = data.defaults;
      if (data.maxItems) _maxItems = data.maxItems;
      if (data.assignees) _assignees = data.assignees;
      _mastersLoaded = true;
      const el = document.getElementById('pic-next-no');
      if (el) el.textContent = _nextPiNumber || 'Loading…';
      const terms = document.getElementById('pic-terms');
      if (terms && !terms.value && _defaults) terms.value = (_defaults.terms || []).join('\n');
      const load = document.getElementById('pic-port-loading');
      if (load && !load.value && _defaults) load.value = _defaults.portOfLoading || '';
      const origin = document.getElementById('pic-origin');
      if (origin && !origin.value && _defaults) origin.value = _defaults.countryOfOrigin || '';
      const validity = document.getElementById('pic-validity');
      if (validity && !validity.value && _defaults) validity.value = _defaults.validity || '';
      const shipment = document.getElementById('pic-shipment-note');
      if (shipment && !shipment.value && _defaults) shipment.value = _defaults.shipmentNote || '';
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load Proforma Invoice masters', 'error');
    }
  }

  /* ── Consignee — free-text input + suggestion dropdown of recent buyers (no
     dedicated Buyer/Customer master exists in this app yet) ─────────────── */
  function _buyerField() {
    return _fieldWrap('Consignee Name', ''
      + '<input type="text" id="pic-buyer" autocomplete="off" placeholder="M/s. …" style="' + _inputStyle + '" />'
      + '<div id="pic-buyer-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>');
  }

  function _bindBuyerField() {
    const input = document.getElementById('pic-buyer');
    const dd = document.getElementById('pic-buyer-dd');
    if (!input || !dd) return;
    const showMatches = () => {
      const q = input.value.trim().toLowerCase();
      const matches = (q ? _recentBuyers.filter(b => b.toLowerCase().includes(q)) : _recentBuyers).slice(0, 30);
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map(b => '<div class="pic-buyer-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-b="' + esc(b) + '">' + esc(b) + '</div>').join('');
      const rect = input.getBoundingClientRect();
      dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = rect.width + 'px';
      dd.style.display = 'block';
    };
    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.pic-buyer-opt');
      if (!opt) return;
      input.value = opt.dataset.b;
      dd.style.display = 'none';
    });
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Model-No typeahead per row — same fixed-position dropdown pattern
     used by PO/GRN Creation, but backed by the finished-goods master
     (fetch_product), not PO's raw-material ITEM_CODES. Picking a model fills
     the whole line: name, size, SWG, per-box packing, and the per-box CBM /
     per-piece weight that Qty is multiplied against below. The product photo
     rides along on the row and ends up in the printed PI. ───────────────── */
  let _itemSearchTimer = null;

  // Boxes, CBM and Weight all fall out of Qty once a model is picked, so they
  // are computed rather than typed — but only for fields the user hasn't
  // overridden by hand, since a part-box order is a real thing.
  function _recomputeRow(row) {
    const get = (f) => row.querySelector('[data-field="' + f + '"]');
    const qty = _num(get('qty').value);
    const packing = _num(get('packing').value);
    const cbmPerBox = _num(row.dataset.cbmPerBox);
    const weightPerPc = _num(row.dataset.weightPerPc);
    if (!qty) return;
    const boxesEl = get('boxes'), cbmEl = get('cbm'), weightEl = get('weight');
    let boxes = _num(boxesEl.value);
    if (packing > 0 && boxesEl.dataset.touched !== '1') {
      boxes = Math.round((qty / packing) * 1000) / 1000;
      boxesEl.value = boxes;
    }
    if (cbmPerBox > 0 && boxes > 0 && cbmEl.dataset.touched !== '1') {
      cbmEl.value = (boxes * cbmPerBox).toFixed(4);
    }
    if (weightPerPc > 0 && weightEl.dataset.touched !== '1') {
      weightEl.value = (qty * weightPerPc).toFixed(2);
    }
  }

  function _applyProduct(row, p) {
    const set = (f, v) => { const el = row.querySelector('[data-field="' + f + '"]'); if (el && v) el.value = v; };
    set('itemName', p.itemName);
    set('size', p.size);
    set('swg', p.swg);
    set('packing', p.perBoxPacking);
    row.dataset.cbmPerBox = p.perBoxCbm || '';
    row.dataset.weightPerPc = p.perPcsWeight || '';
    row.querySelector('[data-field="imageUrl"]').value = p.imageUrl || '';
    const thumb = row.querySelector('.pic-item-thumb');
    thumb.innerHTML = p.imageUrl
      ? '<img src="' + esc(p.imageUrl) + '" alt="" onerror="this.remove()" style="max-width:44px;max-height:40px;object-fit:contain;border-radius:4px;" />'
      : '<span style="font-size:10px;color:#cbd5e1;">no photo</span>';
    _recomputeRow(row);
  }

  function _bindItemCodeInput(input) {
    const row = input.closest('.pic-item-row');
    const dd = row.querySelector('.pic-item-dd');
    let _lastMatches = [];
    const runSearch = () => {
      clearTimeout(_itemSearchTimer);
      _itemSearchTimer = setTimeout(async () => {
        const q = input.value.trim();
        try {
          const res = await fetch('/api/proforma-invoice/items?q=' + encodeURIComponent(q));
          if (!res.ok) return;
          _lastMatches = await res.json();
          if (!_lastMatches.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = _lastMatches.slice(0, 50).map((m, i) => '<div class="pic-item-opt" style="display:flex;align-items:center;gap:10px;padding:6px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid #f8fafc;" data-i="' + i + '">'
            + '<span style="width:40px;height:40px;flex:none;display:grid;place-items:center;background:#f8fafc;border-radius:5px;overflow:hidden;">'
              + (m.imageUrl
                  // A dead thumbnail must not leave a broken-image glyph in the list.
                  ? '<img src="' + esc(m.imageUrl) + '" alt="" onerror="this.remove()" style="max-width:38px;max-height:38px;object-fit:contain;" />'
                  : '')
            + '</span>'
            + '<span><b>' + esc(m.modelNo) + '</b> — ' + esc(m.itemName) + (m.size ? ' <span style="color:#94a3b8;">(size ' + esc(m.size) + ')</span>' : '') + '</span>'
            + '</div>').join('');
          const rect = input.getBoundingClientRect();
          dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 360) + 'px';
          dd.style.display = 'block';
        } catch {}
      }, 220);
    };
    input.addEventListener('input', runSearch);
    input.addEventListener('focus', runSearch);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.pic-item-opt');
      if (!opt) return;
      const p = _lastMatches[parseInt(opt.dataset.i, 10)];
      if (!p) return;
      input.value = p.modelNo;
      _applyProduct(row, p);
      dd.style.display = 'none';
    });
    window.addEventListener('scroll', (e) => { if (e.target !== dd) dd.style.display = 'none'; }, true);
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Item rows (Create form) — deliberately NO Rate/Amount column here:
     pricing is a separate, permission-gated step done later. The columns
     mirror the printed PI exactly, minus the two priced ones. ──────────── */
  const _ITEM_COLS = [
    { field: 'modelNo', label: 'Model No.', width: 130, typeahead: true },
    { field: 'itemName', label: 'Item Name', width: 180 },
    { field: 'size', label: 'Size', width: 64 },
    { field: 'swg', label: 'SWG', width: 60 },
    { field: 'packing', label: 'Per Box Dozen Packing', width: 88, numeric: true },
    { field: 'qty', label: 'Total Qty (Pcs/Set)', width: 92, numeric: true },
    { field: 'boxes', label: 'Total Box', width: 78, numeric: true, derived: true },
    { field: 'cbm', label: 'Total CBM', width: 84, numeric: true, derived: true },
    { field: 'weight', label: 'Total Weight (Kgs)', width: 92, numeric: true, derived: true },
    { field: 'remarks', label: 'Remarks', width: 110 },
  ];
  const _cellInput = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;';

  function _itemRowHtml() {
    return '<tr class="pic-item-row" style="border-bottom:1px solid #f1f5f9;">'
      // Photo cell — filled in once a model is picked; also the visual
      // confirmation that the image the PDF will use actually loads.
      + '<td style="padding:6px;width:56px;text-align:center;">'
        + '<div class="pic-item-thumb" style="width:46px;height:42px;display:grid;place-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">'
          + '<span style="font-size:10px;color:#cbd5e1;">—</span>'
        + '</div>'
        + '<input type="hidden" data-field="imageUrl" />'
      + '</td>'
      + _ITEM_COLS.map(c => '<td style="padding:6px;min-width:' + c.width + 'px;' + (c.typeahead ? 'position:relative;' : '') + '">'
          + '<input type="text" ' + (c.typeahead ? 'class="pic-item-code" autocomplete="off" ' : '') + (c.numeric ? 'inputmode="decimal" ' : '')
            + (c.derived ? 'class="pic-derived" ' : '')
            + 'data-field="' + c.field + '" placeholder="' + esc(c.label) + '" style="' + _cellInput + (c.numeric ? 'text-align:right;' : '') + '" />'
          + (c.typeahead ? '<div class="pic-item-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:260px;overflow-y:auto;"></div>' : '')
        + '</td>').join('')
      + '<td style="padding:6px;text-align:center;"><button type="button" class="pic-item-remove" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove row">×</button></td>'
    + '</tr>';
  }

  function _itemsTableHtml() {
    const minWidth = _ITEM_COLS.reduce((sum, c) => sum + c.width, 0) + 120;
    return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:' + minWidth + 'px;">'
        + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
          + '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Photo</th>'
          + _ITEM_COLS.map(c => '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(c.label) + '</th>').join('')
          + '<th></th>'
        + '</tr></thead>'
        + '<tbody id="pic-items-tbody">' + _itemRowHtml() + '</tbody>'
      + '</table>'
    + '</div>'
    + '<p style="font-size:11.5px;color:#94a3b8;margin:8px 2px 0;">Pick a Model No. and the name, size, SWG, packing and photo fill in from the product master; Total Box, CBM and Weight are then worked out from Qty. Type over any of them to override. C&amp;F US$ rate is added later by an authorized user.</p>';
  }

  function _bindItemRow(rowEl) {
    const codeInput = rowEl.querySelector('.pic-item-code');
    if (codeInput) _bindItemCodeInput(codeInput);

    // Qty (or a corrected packing) re-derives the three computed columns…
    ['qty', 'packing'].forEach(f => {
      rowEl.querySelector('[data-field="' + f + '"]').addEventListener('input', () => _recomputeRow(rowEl));
    });
    // …until the user types in one of them, which pins it for good.
    rowEl.querySelectorAll('.pic-derived').forEach(el => {
      el.addEventListener('input', () => { el.dataset.touched = '1'; });
    });

    const removeBtn = rowEl.querySelector('.pic-item-remove');
    removeBtn.addEventListener('click', () => {
      const tbody = document.getElementById('pic-items-tbody');
      if (tbody.querySelectorAll('.pic-item-row').length <= 1) { Utils.showToast('At least one item row is required', 'warning'); return; }
      rowEl.remove();
    });
  }

  function _bindAllItemRows() {
    document.querySelectorAll('#pic-items-tbody .pic-item-row').forEach(_bindItemRow);
  }

  /* ── New Product — adds a finished good to the shared product master so it
     is pickable straight away, here and on every future PI. The photo is
     uploaded to Drive server-side and stored as the same thumbnail URL the
     existing rows use. ─────────────────────────────────────────────────── */
  const _NP_FIELDS = [
    { id: 'np-model', label: 'Model No.', key: 'modelNo', required: true, placeholder: 'e.g. NMJB-7' },
    { id: 'np-name', label: 'Item Name', key: 'itemName', required: true, placeholder: 'e.g. New Milk Jug Bright' },
    { id: 'np-size', label: 'Size', key: 'size', placeholder: 'e.g. 7' },
    { id: 'np-swg', label: 'SWG', key: 'swg', placeholder: 'e.g. 1.22' },
    { id: 'np-packing', label: 'Per Box Packing (pcs)', key: 'perBoxPacking', placeholder: 'e.g. 36' },
    { id: 'np-cbm', label: 'Per Box CBM', key: 'perBoxCbm', placeholder: 'e.g. 0.0419' },
    { id: 'np-weight', label: 'Per Pcs Weight (kg)', key: 'perPcsWeight', placeholder: 'e.g. 0.17' },
  ];

  function _renderNewProductModal() {
    const host = document.getElementById('pi-product-modal');
    if (!host) return;
    if (!_newProductOpen) { host.innerHTML = ''; return; }

    host.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:60;padding:16px;overflow-y:auto;" id="np-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:640px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
        + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
          + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">New Product</div>'
            + '<div style="font-size:12px;color:#94a3b8;margin-top:1px;">Saved to the shared product master — available on every PI from now on.</div></div>'
          + '<button id="np-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
          + '</button>'
        + '</div>'
        + '<div style="padding:22px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:14px;">'
          + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;">'
            + _NP_FIELDS.map(f => _fieldWrap(f.label + (f.required ? ' *' : ''),
                '<input type="text" id="' + f.id + '" placeholder="' + esc(f.placeholder || '') + '" style="' + _inputStyle + '" />')).join('')
          + '</div>'
          + _fieldWrap('Product Photo',
              '<div style="display:flex;align-items:center;gap:14px;">'
                + '<div id="np-preview" style="width:76px;height:70px;flex:none;display:grid;place-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">'
                  + (_newProductPhoto
                      ? '<img src="' + esc(_newProductPhoto) + '" alt="" style="max-width:72px;max-height:66px;object-fit:contain;" />'
                      : '<span style="font-size:10.5px;color:#cbd5e1;">no photo</span>')
                + '</div>'
                + '<div style="flex:1;">'
                  + '<input type="file" id="np-photo" accept="image/*" style="font-size:12.5px;" />'
                  + '<div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Shown on the printed PI next to this item. Optional — you can add it later.</div>'
                + '</div>'
              + '</div>')
        + '</div>'
        + '<div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;">'
          + '<button type="button" id="np-cancel" style="padding:9px 18px;border-radius:9px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>'
          + '<button type="button" id="np-save" style="padding:9px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13px;font-weight:700;cursor:pointer;">Save Product</button>'
        + '</div>'
      + '</div>'
    + '</div>';

    const close = () => { _newProductOpen = false; _newProductPhoto = null; _renderNewProductModal(); };
    document.getElementById('np-backdrop').addEventListener('click', close);
    document.getElementById('np-close').addEventListener('click', close);
    document.getElementById('np-cancel').addEventListener('click', close);
    document.getElementById('np-photo').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      // 900px is plenty for a cell-sized picture on an A4 page, and keeps the
      // request well inside the server's 10mb JSON limit.
      _newProductPhoto = await Utils.readOriginalImage(file, 512 * 1024, 900);
      const prev = document.getElementById('np-preview');
      prev.innerHTML = _newProductPhoto
        ? '<img src="' + esc(_newProductPhoto) + '" alt="" style="max-width:72px;max-height:66px;object-fit:contain;" />'
        : '<span style="font-size:10.5px;color:#cbd5e1;">no photo</span>';
    });
    document.getElementById('np-save').addEventListener('click', _saveNewProduct);
  }

  async function _saveNewProduct() {
    if (_newProductSaving) return;
    const payload = { photo: _newProductPhoto || undefined };
    for (const f of _NP_FIELDS) payload[f.key] = document.getElementById(f.id).value.trim();
    if (!payload.modelNo || !payload.itemName) { Utils.showToast('Model No. and Item Name are required', 'error'); return; }

    _newProductSaving = true;
    const btn = document.getElementById('np-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const result = await Utils.apiFetch('/api/proforma-invoice/products', { method: 'POST', body: JSON.stringify(payload) });
      Utils.showToast('Product ' + result.product.modelNo + ' added'
        + (result.photoSaved ? '' : ' — photo upload failed, add it later'), result.photoSaved ? 'success' : 'warning');
      _newProductOpen = false; _newProductPhoto = null;
      _renderNewProductModal();
      // Drop it straight onto the PI being written, so adding a product and
      // using it is one motion rather than two.
      _useProductOnFirstFreeRow(result.product);
    } catch (err) {
      Utils.showToast(err.message || 'Failed to add product', 'error');
      btn.disabled = false; btn.textContent = 'Save Product';
    } finally {
      _newProductSaving = false;
    }
  }

  function _useProductOnFirstFreeRow(product) {
    const tbody = document.getElementById('pic-items-tbody');
    if (!tbody) return;
    let row = Array.from(tbody.querySelectorAll('.pic-item-row'))
      .find(r => !r.querySelector('[data-field="modelNo"]').value.trim());
    if (!row) {
      tbody.insertAdjacentHTML('beforeend', _itemRowHtml());
      row = tbody.lastElementChild;
      _bindItemRow(row);
    }
    row.querySelector('[data-field="modelNo"]').value = product.modelNo;
    _applyProduct(row, product);
  }

  /* ── Header fields (Create form), grouped the way the printed PI reads:
     invoice details, then consignee, then shipping. ─────────────────────── */
  const _grid = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;';

  function _invoiceFieldsHtml() {
    // Assigned To and Target Date are not printed on the PI — they open the
    // row in the export team's follow-up tracker, which needs an owner and a
    // date. Both optional; blank just leaves those cells for the team.
    const assigneeOpts = (_assignees || []).map(a => '<option value="' + esc(a) + '"></option>').join('');
    return '<div style="' + _grid + '">'
      + _textField('pic-date', 'PI Date', { type: 'date', value: _today() })
      + _readonlyField('pic-next-no', 'Pro. Invoice No. (auto-assigned)', _nextPiNumber || 'Loading…')
      + _textField('pic-order-no', 'Order No.', { placeholder: 'Buyer order reference' })
      + _textField('pic-payment-terms', 'Terms of Payment', { placeholder: 'e.g. 30% ADVANCE AND BALANCE AGT. B/L COPY' })
      + _fieldWrap('Assigned To',
          '<input type="text" id="pic-assigned-to" list="pic-assignee-list" autocomplete="off" placeholder="Who follows this PI up" style="' + _inputStyle + '" />'
          + '<datalist id="pic-assignee-list">' + assigneeOpts + '</datalist>')
      + _textField('pic-target-date', 'Target Date', { type: 'date' })
    + '</div>';
  }

  function _consigneeFieldsHtml() {
    return '<div style="' + _grid + '">'
      + _buyerField()
      + _textField('pic-buyer-trn', 'TRN / Tax Reg. No.', { placeholder: 'e.g. TRN NO: 100502326000003' })
      + _textField('pic-buyer-addr1', 'Address Line 1', { placeholder: 'P.O. Box, plot, block…' })
      + _textField('pic-buyer-addr2', 'Address Line 2', { placeholder: 'Area, city, country' })
      + _textField('pic-buyer-contact', 'Tel. / Email', { placeholder: 'TEL: +971 … , Email: …' })
    + '</div>';
  }

  function _shippingFieldsHtml() {
    return '<div style="' + _grid + '">'
      + _textField('pic-port-loading', 'Port of Loading', { value: _defaults ? _defaults.portOfLoading : '' })
      + _textField('pic-port-discharge', 'Port of Discharge', { placeholder: 'e.g. JEBEL ALI' })
      + _textField('pic-place-delivery', 'Place of Delivery', { placeholder: 'e.g. JEBEL ALI' })
      + _textField('pic-origin', 'Country of Origin of Goods', { value: _defaults ? _defaults.countryOfOrigin : '' })
      + _textField('pic-shipment-note', 'Shipment / Container Note', { value: _defaults ? _defaults.shipmentNote : '' })
    + '</div>';
  }

  function _footerFieldsHtml() {
    return '<div style="' + _grid + '">'
      + _textField('pic-validity', 'Price Validity', { value: _defaults ? _defaults.validity : '', placeholder: 'e.g. 03 WORKING DAYS' })
      + _fieldWrap('Declaration', '<label style="display:flex;align-items:flex-start;gap:9px;font-size:12.5px;color:#475569;cursor:pointer;line-height:1.45;">'
          + '<input type="checkbox" id="pic-declaration" checked style="margin-top:2px;" />'
          + '<span>Print the non-Israeli origin / material declaration (required by most Gulf buyers).</span>'
        + '</label>')
    + '</div>'
    + '<div style="margin-top:14px;">'
      + _textareaField('pic-terms', 'Terms & Conditions (one per line, printed as-is)', _defaults ? (_defaults.terms || []).join('\n') : '', 9)
    + '</div>';
  }

  /* ── Tabs (Create + PI List, same in-page-tab pattern as PO/GRN Creation) ── */
  function _tabTab(label, active, extraAttrs) {
    return '<button type="button" ' + extraAttrs + ' style="'
      + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
      + 'color:' + (active ? 'var(--color-primary)' : '#94a3b8') + ';'
      + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
      + '">' + esc(label) + '</button>';
  }

  function _tabsHtml() {
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">'
      + _tabTab('Create PI', _view === 'create', 'class="pic-create-tab"')
      + _tabTab('PI List', _view === 'list', 'class="pic-list-tab"')
    + '</div>';
  }

  /* ── Submit (Create) ────────────────────────────────────────────────── */
  function _collectItems() {
    return Array.from(document.querySelectorAll('#pic-items-tbody .pic-item-row')).map(row => {
      const item = {};
      _ITEM_COLS.forEach(c => { item[c.field] = row.querySelector('[data-field="' + c.field + '"]').value.trim(); });
      // Not a visible column — it rides along from the product master so the
      // printed PI can show the photo.
      item.imageUrl = row.querySelector('[data-field="imageUrl"]').value.trim();
      return item;
    }).filter(it => it.modelNo || it.itemName);
  }

  async function _submit(e) {
    e.preventDefault();
    const val = (id) => document.getElementById(id).value.trim();
    const date = document.getElementById('pic-date').value;
    const buyerName = val('pic-buyer');
    const items = _collectItems();

    if (!date) { Utils.showToast('PI Date is required', 'error'); return; }
    if (!buyerName) { Utils.showToast('Consignee Name is required', 'error'); return; }
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }
    if (items.length > _maxItems) { Utils.showToast('The PI template holds ' + _maxItems + ' item rows — this PI has ' + items.length, 'error'); return; }

    const payload = {
      date, buyerName, items,
      orderNo: val('pic-order-no'),
      paymentTerms: val('pic-payment-terms'),
      buyerTrn: val('pic-buyer-trn'),
      buyerAddress1: val('pic-buyer-addr1'),
      buyerAddress2: val('pic-buyer-addr2'),
      buyerContact: val('pic-buyer-contact'),
      portOfLoading: val('pic-port-loading'),
      portOfDischarge: val('pic-port-discharge'),
      placeOfDelivery: val('pic-place-delivery'),
      countryOfOrigin: val('pic-origin'),
      shipmentNote: val('pic-shipment-note'),
      validity: val('pic-validity'),
      assignedTo: val('pic-assigned-to'),
      targetDate: document.getElementById('pic-target-date').value,
      terms: val('pic-terms').split('\n').map(t => t.trim()).filter(Boolean),
      includeDeclaration: document.getElementById('pic-declaration').checked,
    };

    const btn = document.getElementById('pic-submit-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const result = await Utils.apiFetch('/api/proforma-invoice', { method: 'POST', body: JSON.stringify(payload) });
      const warnings = [];
      if (!result.pdfLink) warnings.push('PDF export failed');
      if (result.fmsTracked === false) warnings.push('Export Marketing FMS row not added');
      Utils.showToast('PI ' + result.piNumber + ' created'
        + (warnings.length ? ' — ' + warnings.join('; ') + ' (PI itself is saved)' : ' — PDF saved to Drive, FMS row opened'),
        warnings.length ? 'warning' : 'success');
      await _loadMasters(date);
      renderPage();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to create Proforma Invoice', 'error');
      btn.disabled = false; btn.textContent = 'Create Proforma Invoice';
    }
  }

  /* ── PI List (in-page tab) — read-only history from the ERP PI Log tab ── */
  async function _pilLoad() {
    _pilLoaded = false;
    _pilLoadError = '';
    _pilRenderTable();
    try {
      _pilRows = await Utils.apiFetch('/api/proforma-invoice/list') || [];
    } catch (e) {
      _pilRows = [];
      _pilLoadError = e.message || 'Failed to load Proforma Invoices';
    }
    _pilLoaded = true;
    _pilRenderTable();
  }

  function _pilFilteredRows() {
    return _pilRows.filter(r => {
      if (_pilFBuyer && !(r.buyer || '').toLowerCase().includes(_pilFBuyer.toLowerCase())) return false;
      if (_pilFFrom && (r.date || '') < _pilFFrom) return false;
      if (_pilFTo && (r.date || '') > _pilFTo) return false;
      return true;
    });
  }

  function _statusPillHtml(status) {
    const styles = {
      Draft: 'background:#fffbeb;color:#b45309;',
      Priced: 'background:#f0fdf4;color:#15803d;',
      Cancelled: 'background:#f1f5f9;color:#64748b;',
    };
    return '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;' + (styles[status] || styles.Draft) + '">' + esc(status || 'Draft') + '</span>';
  }

  function _pilRenderTable() {
    const body = document.getElementById('pil-body');
    const countEl = document.getElementById('pil-count');
    if (!body) return;

    if (!_pilLoaded) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_pilLoadError) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_pilLoadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = _pilFilteredRows();
    if (countEl) countEl.textContent = rows.length + ' of ' + _pilRows.length;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_pilRows.length ? 'No Proforma Invoices match these filters' : 'No Proforma Invoices created yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;white-space:nowrap;">' + esc(r.piNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.buyer) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + _statusPillHtml(r.status) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + (r.status === 'Priced' ? esc(r.total) : '<span style="color:#cbd5e1;">—</span>') + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + (r.pdfLink ? '<a href="' + esc(r.pdfLink) + '" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">View PDF</a>' : '<span style="color:#cbd5e1;">—</span>') + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
          + (r.status !== 'Cancelled' && r.canSetPrice
            ? '<button type="button" class="pic-price-btn" data-pi="' + esc(r.piNo) + '" style="border:1.5px solid var(--color-primary);background:#fff;color:var(--color-primary);cursor:pointer;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:7px;margin-right:6px;">' + (r.status === 'Priced' ? 'Edit Price' : 'Add Price') + '</button>'
            : '')
          + (r.status === 'Cancelled'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
            : '<button type="button" class="pic-cancel-btn" data-pi="' + esc(r.piNo) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
        + '</td>'
      + '</tr>').join('');
  }

  function _pilBindRowActions() {
    const body = document.getElementById('pil-body');
    if (!body || body.dataset.actionsBound) return;
    body.dataset.actionsBound = '1';
    body.addEventListener('click', async (e) => {
      const cancelBtn = e.target.closest('.pic-cancel-btn');
      if (cancelBtn) {
        const ok = await Utils.showConfirm('PI ' + cancelBtn.dataset.pi + ' will be marked Cancelled. This can\'t be undone.', { title: 'Cancel Proforma Invoice', confirmText: 'Cancel PI', danger: true });
        if (!ok) return;
        try {
          await Utils.apiFetch('/api/proforma-invoice/cancel?piNo=' + encodeURIComponent(cancelBtn.dataset.pi), { method: 'PUT' });
          Utils.showToast('PI ' + cancelBtn.dataset.pi + ' cancelled', 'success');
          await _pilLoad();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to cancel', 'error');
        }
        return;
      }
      const priceBtn = e.target.closest('.pic-price-btn');
      if (priceBtn) {
        const row = _pilRows.find(r => String(r.piNo) === priceBtn.dataset.pi);
        if (row) { _priceModalRow = row; _renderPriceModal(); }
      }
    });
  }

  function _pilFilterBarHtml() {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<input type="text" id="pil-buyer" placeholder="Search consignee…" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
      + '<input type="date" id="pil-from" style="' + _inputStyle + 'width:auto;" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="pil-to" style="' + _inputStyle + 'width:auto;" />'
      + '<button type="button" id="pil-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="pil-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _pilBindFilterBar() {
    document.getElementById('pil-buyer').addEventListener('input', (e) => { _pilFBuyer = e.target.value; _pilRenderTable(); });
    document.getElementById('pil-from').addEventListener('change', (e) => { _pilFFrom = e.target.value; _pilRenderTable(); });
    document.getElementById('pil-to').addEventListener('change', (e) => { _pilFTo = e.target.value; _pilRenderTable(); });
    document.getElementById('pil-clear').addEventListener('click', () => {
      _pilFBuyer = ''; _pilFFrom = ''; _pilFTo = '';
      document.getElementById('pil-buyer').value = '';
      document.getElementById('pil-from').value = '';
      document.getElementById('pil-to').value = '';
      _pilRenderTable();
    });
    document.getElementById('pil-refresh').addEventListener('click', _pilLoad);
  }

  function _pilViewHtml() {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<p style="font-size:12.5px;color:#64748b;margin:0;">Every Proforma Invoice created here, read live from the sheet\'s ERP PI Log.</p>'
        + '<span id="pil-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _pilFilterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:880px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['Pro. Invoice No', 'Date', 'Consignee', 'Status', 'Total C&F (US$)', 'PDF', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="pil-body"><tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>'
      + '<div id="pi-price-modal"></div>';
  }

  /* ── Add Price modal — lists the PI's own stored items (read-only
     model/name/size/qty from Form JSON) with a C&F US$ per-piece input per
     row. Rows are addressed by index, not model number: an export PI can
     legitimately list the same model twice at different sizes. Submits to
     PUT /api/proforma-invoice/price ────────────────────────────────────── */
  function _priceRecompute() {
    const modal = document.getElementById('pi-price-modal');
    if (!modal) return;
    let total = 0;
    modal.querySelectorAll('.pipm-item-row').forEach(row => {
      const qty = _num(row.dataset.qty);
      const rate = _num(row.querySelector('.pipm-rate').value);
      const amt = Math.round(qty * rate * 100) / 100;
      row.querySelector('.pipm-amount').textContent = _fmtUsd(amt);
      total += amt;
    });
    document.getElementById('pipm-total').textContent = _fmtUsd(total);
  }

  function _closePriceModal() {
    _priceModalRow = null;
    _priceReturnHash = '';
    const modal = document.getElementById('pi-price-modal');
    if (modal) modal.innerHTML = '';
  }

  function _renderPriceModal() {
    const modal = document.getElementById('pi-price-modal');
    if (!modal) return;
    if (!_priceModalRow) { modal.innerHTML = ''; return; }
    const row = _priceModalRow;
    const form = row.form || {};
    const items = Array.isArray(form.items) ? form.items : [];

    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="pipm-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:820px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
        + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
          + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + (row.status === 'Priced' ? 'Edit Price' : 'Add Price') + ' — PI ' + esc(row.piNo) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">' + esc(row.buyer) + '</div></div>'
          + '<button id="pipm-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
          + '</button>'
        + '</div>'
        + '<div style="padding:22px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px;">'
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:640px;">'
              + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
                + ['Photo', 'Model No.', 'Item Name', 'Size', 'Total Qty', 'C&F US$ Per Pc', 'Amount (US$)'].map(h => '<th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
              + '</tr></thead>'
              + '<tbody>' + items.map((it, i) => ''
                + '<tr class="pipm-item-row" data-index="' + i + '" data-qty="' + esc(it.qty || 0) + '" style="border-bottom:1px solid #f1f5f9;">'
                  + '<td style="padding:6px 8px;">' + (it.imageUrl
                      ? '<img src="' + esc(it.imageUrl) + '" alt="" onerror="this.remove()" style="width:34px;height:34px;object-fit:contain;" />'
                      : '<span style="color:#cbd5e1;font-size:11px;">—</span>') + '</td>'
                  // itemCode/description are the pre-export-format field names —
                  // a Draft raised before the switch still has to be priceable.
                  + '<td style="padding:6px 8px;font-size:12.5px;">' + esc(it.modelNo || it.itemCode || '—') + '</td>'
                  + '<td style="padding:6px 8px;font-size:12.5px;color:#64748b;">' + esc(it.itemName || it.description || '—') + '</td>'
                  + '<td style="padding:6px 8px;font-size:12.5px;color:#64748b;">' + esc(it.size || '—') + '</td>'
                  + '<td style="padding:6px 8px;font-size:12.5px;text-align:right;">' + esc(it.qty || '') + '</td>'
                  + '<td style="padding:6px 8px;"><input type="text" inputmode="decimal" class="pipm-rate" value="' + esc(it.rate || '') + '" placeholder="0.000" style="width:110px;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;text-align:right;" /></td>'
                  + '<td class="pipm-amount" style="padding:6px 8px;font-size:12.5px;color:#64748b;text-align:right;">0.00</td>'
                + '</tr>').join('')
              + '</tbody>'
            + '</table>'
          + '</div>'
          + '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">'
            + '<div><span style="font-size:12.5px;font-weight:700;color:#64748b;">Total C&amp;F US$ </span><span style="font-size:17px;font-weight:800;color:#0f172a;"><span id="pipm-total">0.00</span></span></div>'
            + '<div style="font-size:11.5px;color:#94a3b8;">Shown for confirmation — the printed total is the sheet\'s own formula.</div>'
          + '</div>'
        + '</div>'
        + '<div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;">'
          + '<button type="button" id="pipm-cancel" style="padding:9px 18px;border-radius:9px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>'
          + '<button type="button" id="pipm-save" style="padding:9px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13px;font-weight:700;cursor:pointer;">Save Price</button>'
        + '</div>'
      + '</div>'
    + '</div>';

    document.getElementById('pipm-backdrop').addEventListener('click', _closePriceModal);
    document.getElementById('pipm-close').addEventListener('click', _closePriceModal);
    document.getElementById('pipm-cancel').addEventListener('click', _closePriceModal);
    modal.querySelectorAll('.pipm-rate').forEach(inp => inp.addEventListener('input', _priceRecompute));
    document.getElementById('pipm-save').addEventListener('click', _submitPrice);
    _priceRecompute();
  }

  async function _submitPrice() {
    if (_priceSaving || !_priceModalRow) return;
    const piNo = _priceModalRow.piNo;
    const modal = document.getElementById('pi-price-modal');
    const items = Array.from(modal.querySelectorAll('.pipm-item-row')).map(row => ({
      index: parseInt(row.dataset.index, 10),
      rate: row.querySelector('.pipm-rate').value.trim(),
    }));

    _priceSaving = true;
    const btn = document.getElementById('pipm-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const result = await Utils.apiFetch('/api/proforma-invoice/price?piNo=' + encodeURIComponent(piNo), {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
      // The server closes the tracker's "Add Pricing" step as part of this
      // save, so say so — that step is why the user is on this screen at all.
      Utils.showToast('PI ' + piNo + ' priced'
        + (result.pdfLink ? ' — PDF updated on Drive' : '')
        + (result.fmsStepDone ? ' · Add Pricing step marked done' : ''), 'success');
      const returnTo = _priceReturnHash;
      _closePriceModal();
      if (returnTo) { window.Router.navigate(returnTo); return; }
      await _pilLoad();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to save price', 'error');
      btn.disabled = false; btn.textContent = 'Save Price';
    } finally {
      _priceSaving = false;
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const isList = _view === 'list';
    const bodyHtml = isList
      ? _pilViewHtml()
      : '<form id="pic-form" style="display:flex;flex-direction:column;gap:16px;">'
        + _sectionTitle('Invoice Details')
        + _invoiceFieldsHtml()
        + _sectionTitle('Consignee')
        + _consigneeFieldsHtml()
        + _sectionTitle('Shipping')
        + _shippingFieldsHtml()
        + _sectionTitle('Items')
        + _itemsTableHtml()
        + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
          + '<button type="button" id="pic-add-item" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ Add Item</button>'
          + (_hasFeature('add_product')
            ? '<button type="button" id="pic-new-product" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px dashed var(--color-primary);color:var(--color-primary);font-size:12.5px;font-weight:700;cursor:pointer;">+ New Product</button>'
            : '')
        + '</div>'
        + '<div id="pi-product-modal"></div>'
        + _sectionTitle('Validity & Terms')
        + _footerFieldsHtml()
        + '<button type="submit" id="pic-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Create Proforma Invoice</button>'
      + '</form>';

    el.innerHTML = '<div style="max-width:' + (isList ? '1200px' : '1180px') + ';margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">Proforma Invoice / OCS</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Export PI in C&amp;F US$. Create captures consignee, shipping &amp; items only — the rate is added afterward by an authorized user.</p>'
      + '</div>'
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    document.querySelector('.pic-create-tab').addEventListener('click', () => { _view = 'create'; renderPage(); });
    document.querySelector('.pic-list-tab').addEventListener('click', () => { _view = 'list'; renderPage(); });

    if (isList) {
      _pilBindFilterBar();
      _pilBindRowActions();
      // renderPage() rebuilt the list's markup, #pi-price-modal included, so a
      // modal that was already open (or one openPriceFor() queued up before
      // navigating here) has to be painted again. _pilLoad() only ever touches
      // #pil-body, so it will not wipe it back out.
      _renderPriceModal();
      _pilLoad();
      return;
    }

    _bindBuyerField();
    _bindAllItemRows();

    document.getElementById('pic-add-item').addEventListener('click', () => {
      const tbody = document.getElementById('pic-items-tbody');
      if (tbody.querySelectorAll('.pic-item-row').length >= _maxItems) {
        Utils.showToast('The PI template holds ' + _maxItems + ' item rows', 'warning');
        return;
      }
      tbody.insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(tbody.lastElementChild);
    });

    const newProductBtn = document.getElementById('pic-new-product');
    if (newProductBtn) {
      newProductBtn.addEventListener('click', () => { _newProductOpen = true; _renderNewProductModal(); });
    }

    // The PI number is FY-scoped, so a date change can change it.
    document.getElementById('pic-date').addEventListener('change', (e) => { _loadMasters(e.target.value); });

    document.getElementById('pic-form').addEventListener('submit', _submit);

    if (!_mastersLoaded) _loadMasters(_today());
  }

  /* ── entry point for the FMS "Add Pricing" step ───────────────────────
     Clicking Done on that step does not open a Mark-as-Done modal — it lands
     the doer straight on this PI's Add Price screen, because saving the price
     is what completes the step (server-side, in PUT /price). Resolves to
     { ok: false, reason } instead of navigating when this PI can't be priced
     by this user, so the caller can fall back to the normal modal rather than
     stranding them on a page with nothing to do. ───────────────────────── */
  async function openPriceFor(piNo, opts) {
    const wanted = String(piNo || '').trim();
    if (!wanted) return { ok: false, reason: 'No PI number on this row' };

    let rows;
    try {
      rows = await Utils.apiFetch('/api/proforma-invoice/list') || [];
    } catch (e) {
      return { ok: false, reason: e.message || 'Could not load Proforma Invoices' };
    }
    const row = rows.find(r => String(r.piNo || '').trim() === wanted);
    if (!row) return { ok: false, reason: 'PI ' + wanted + ' is not in the PI log' };
    if (row.status === 'Cancelled') return { ok: false, reason: 'PI ' + wanted + ' has been cancelled' };
    // canSetPrice is the server's own verdict — the 'set_price' feature AND
    // still-a-Draft. Anything else and the PUT would come back 403 or 400.
    if (!row.canSetPrice) {
      return {
        ok: false,
        reason: row.status === 'Priced'
          ? 'PI ' + wanted + ' is already priced'
          : 'You do not have permission to price a Proforma Invoice',
      };
    }

    _pilRows = rows;
    _pilLoaded = true;
    _pilLoadError = '';
    _view = 'list';
    _priceModalRow = row;
    _priceReturnHash = String((opts && opts.returnTo) || '').replace('#', '');

    // Navigating fires the router, which calls render() — and renderPage()
    // paints the queued modal. Already here, and nothing would fire, so paint
    // it directly.
    const here = (window.location.hash || '').replace('#', '') === 'proforma-invoice';
    _priceQueued = !here;
    if (here) renderPage(); else window.Router.navigate('proforma-invoice');
    return { ok: true };
  }

  return {
    render() {
      if (!_priceQueued) { _priceModalRow = null; _priceReturnHash = ''; }
      _priceQueued = false;
      renderPage();
    },
    openPriceFor,
  };
})();
