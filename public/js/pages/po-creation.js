window.Pages = window.Pages || {};

// ── PO Creation ──────────────────────────────────────────────────────────────
// Mirrors the store team's live "PO July 2026" Google Sheet field-for-field —
// the sheet itself is the database (see POST /api/po-creation in server.js).
// Three formats, each its own template tab in that sheet: PurchaseOrder / ENR PO
// / Diamond PO. Submitting fills the matching tab, exports it as a PDF (saved
// to Drive), and logs it — the "PO List" tab (in-page, alongside the 3 format
// tabs) shows that created-PO history with filters.
window.Pages['po-creation'] = (() => {
  const FORMATS = ['PurchaseOrder', 'ENR PO', 'Diamond PO'];
  const FORMAT_LABEL = { PurchaseOrder: 'Purchase Order', 'ENR PO': 'ENR PO', 'Diamond PO': 'Diamond PO' };
  const PARTY_LABEL  = { PurchaseOrder: 'Customer Name', 'ENR PO': 'Vendor', 'Diamond PO': 'Vendor' };
  const ITEM_CODE_LABEL = { PurchaseOrder: 'Item Code', 'ENR PO': 'Item #', 'Diamond PO': 'Item #' };

  // Departments are the app-wide master list (Utils' shared cache, primed from
  // /api/po-creation/masters and served by GET /api/departments) — the same one
  // Users, Daily Task, IMS Inward/Outward and PR Creation use. This page used to
  // keep its own copy of the sheet's Vendor Details!N3:N31 dropdown, which spelt
  // the same shop floors differently from every other form.

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

  // Maps a PR Creation tab name (returned as prTabName by /pending-prs) to the
  // PO format it corresponds to, and maps that PR format's own item fields
  // onto this PO format's item fields — lets picking a pending PR carry its
  // items over, not just its header fields. ALU has no clean PO analog, so it
  // falls back to PurchaseOrder.
  const PR_TAB_TO_PO_FORMAT = {
    'Purchase Requisition': 'PurchaseOrder',
    'PURCHASE REQUISITION(PACKING_STICKER)': 'ENR PO',
    'PURCHASE REQUISITION(PACKING_BOX)': 'Diamond PO',
    'purchase_requisition(ALU)': 'PurchaseOrder',
  };
  const PR_ITEM_MAPPERS = {
    'Purchase Requisition': it => ({ itemCode: it.itemCode || '', hsnCode: '', uom: it.uom || '', qty: it.qtyRequired || '', unitPrice: it.lastUnitPrice || '', gst: it.tax || '' }),
    'PURCHASE REQUISITION(PACKING_STICKER)': it => ({ itemCode: it.itemCode || '', customerCodeRef: '', barcode: '', stickerQty: it.stickerQty || '', rate: it.rate || '', taxPercent: '' }),
    'PURCHASE REQUISITION(PACKING_BOX)': it => ({ itemCode: it.itemCode || '', boxQty: it.boxQty || '', boxRate: it.boxRate || '', plateQty: it.plateQty || '', plateRate: it.plateRate || '' }),
    'purchase_requisition(ALU)': it => ({ itemCode: it.itemCode || '', hsnCode: '', uom: it.uom || '', qty: it.qtyRequired || '', unitPrice: it.rate || '', gst: it.tax || '' }),
  };

  // Item fields that stay editable once a PR has been applied to the form —
  // either because PR_ITEM_MAPPERS never fills them from the PR (hardcoded
  // to '' — there's no PR-side source for them), or because price genuinely
  // needs to move at PO time (a vendor's actual quoted price at PO stage
  // routinely differs from the PR's own estimate). Every other mapped field
  // still locks, since it came straight from the approved PR.
  const PO_ONLY_ITEM_FIELDS = {
    PurchaseOrder: ['hsnCode', 'unitPrice'],
    'ENR PO': ['customerCodeRef', 'barcode', 'taxPercent', 'rate'],
    'Diamond PO': ['boxRate', 'plateRate'],
  };
  const READONLY_FIELD_STYLE = 'background:#f8fafc;color:#64748b;cursor:not-allowed;';

  /* ── state ──────────────────────────────────────────────────── */
  let _view = 'create'; // 'create' | 'list'
  let _format = 'PurchaseOrder';
  let _mastersLoaded = false;
  let _vendors = [];
  let _shipToLocations = [];
  let _nextPoNumber = null;
  let _pendingPrsLoaded = false;
  let _pendingPrs = []; // PRs (from the PR Creation sheet) not yet used on any PO
  let _pendingPrToApply = null; // set when a PR selection also needs a format switch + re-render first

  // PO List (in-page tab) state — read-only history from the ERP PO Log tab.
  let _polRows = [];
  let _polLoaded = false;
  let _polLoadError = '';
  let _polFFormat = '';
  let _polFDept = '';
  let _polFParty = '';
  let _polFFrom = '';
  let _polFTo = '';

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
  function _textareaField(id, label, opts) {
    opts = opts || {};
    return _fieldWrap(label, '<textarea id="' + id + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.placeholder || '') + '" style="' + _inputStyle + 'resize:vertical;font-family:inherit;">' + esc(opts.value || '') + '</textarea>');
  }
  function _selectField(id, label, options) {
    return _fieldWrap(label, '<select id="' + id + '" style="' + _inputStyle + 'background:#fff;">' + options.map(o => '<option value="' + esc(o) + '">' + (o || 'Select…') + '</option>').join('') + '</select>');
  }

  /* ── Masters (vendors / ship-to / departments / next PO number) ───────── */
  async function _loadMasters() {
    try {
      const data = await Utils.apiFetch('/api/po-creation/masters');
      if (!data) return;
      _vendors = data.vendors || [];
      _shipToLocations = data.shipToLocations || [];
      Utils.setDepartments(data.departments || []);
      _nextPoNumber = data.nextPoNumber;
      _mastersLoaded = true;
      const el = document.getElementById('poc-next-no');
      if (el) el.textContent = _nextPoNumber != null ? _nextPoNumber : '—';
      // Options render before this fetch resolves (shows "Loading…") — patch
      // selects in place so an in-progress fill on other fields isn't wiped out.
      const shipToSel = document.getElementById('poc-ship-to');
      if (shipToSel && _shipToLocations.length) {
        shipToSel.innerHTML = _shipToLocations.map(s => '<option value="' + esc(s) + '"' + (s.includes('(Factory)') ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
      }
      const deptSel = document.getElementById('poc-department');
      if (deptSel) {
        Utils.fillDeptSelect(deptSel);
        Utils.bindDeptSelect(deptSel);
      }
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load PO masters', 'error');
    }
  }

  async function _loadPendingPrs() {
    try {
      _pendingPrs = await Utils.apiFetch('/api/po-creation/pending-prs') || [];
      _pendingPrsLoaded = true;
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load pending PRs', 'error');
    }
  }

  /* ── P.R. NO — free-text input (still fully editable/typeable) with a
     suggestion dropdown of pending PRs (raised via PR Creation, not yet used
     on any PO); picking one prefills Party/Department from that PR ──────── */
  function _prNoField() {
    return _fieldWrap('P.R. NO', ''
      + '<input type="text" id="poc-pr-no" autocomplete="off" placeholder="Type, or pick a pending PR…" style="' + _inputStyle + '" />'
      + '<div id="poc-prno-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>');
  }

  function _bindPrNoField() {
    const input = document.getElementById('poc-pr-no');
    const dd = document.getElementById('poc-prno-dd');
    if (!input || !dd) return;
    const showMatches = () => {
      const q = input.value.trim().toLowerCase();
      const matches = (q
        ? _pendingPrs.filter(p => String(p.prNo).toLowerCase().includes(q) || (p.party || '').toLowerCase().includes(q))
        : _pendingPrs).slice(0, 30);
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map(p => '<div class="poc-prno-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-pr="' + esc(p.prNo) + '" data-party="' + esc(p.party) + '" data-dept="' + esc(p.department) + '">'
        + '<b>#' + esc(p.prNo) + '</b> — ' + esc(p.party) + (p.department ? ' <span style="color:#94a3b8;">(' + esc(p.department) + ')</span>' : '') + '</div>').join('');
      const rect = input.getBoundingClientRect();
      dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 260) + 'px';
      dd.style.display = 'block';
    };
    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.poc-prno-opt');
      if (!opt) return;
      dd.style.display = 'none';
      const pr = _pendingPrs.find(p => String(p.prNo) === opt.dataset.pr);
      if (pr) _applyPendingPr(pr); else input.value = opt.dataset.pr;
    });
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Applying a picked pending PR — prefills Party/Department, carries the
     PR's own items over (mapped field-for-field), and switches format first
     if the PR's format doesn't match the one currently open. Everything
     stays a prefill: every field (including P.R. NO itself) is still freely
     editable afterward, nothing gets locked. ──────────────────────────────── */
  function _applyPendingPr(pr) {
    const targetFormat = PR_TAB_TO_PO_FORMAT[pr.prTabName] || _format;
    if (targetFormat !== _format) {
      _format = targetFormat;
      _pendingPrToApply = pr;
      renderPage(); // _fillPrIntoForm runs after the new format's DOM exists
    } else {
      _fillPrIntoForm(pr);
    }
  }

  // Once a pending PR is actually applied, the Basic Detail + Item List
  // fields it supplied become non-editable — only fields the PR has no
  // analog for (PO_ONLY_ITEM_FIELDS, plus everything outside Party/
  // Department/Items) stay editable. A manually-created PO (no PR ever
  // applied) is completely unaffected.
  function _fillPrIntoForm(pr) {
    const prInput = document.getElementById('poc-pr-no');
    if (prInput) prInput.value = pr.prNo;
    const partyInput = document.getElementById('poc-party');
    if (partyInput && pr.party) { partyInput.value = pr.party; partyInput.readOnly = true; partyInput.style.cssText += READONLY_FIELD_STYLE; }
    const deptSel = document.getElementById('poc-department');
    if (deptSel && pr.department) {
      if (!deptSel.querySelector('option[value="' + CSS.escape(pr.department) + '"]')) {
        deptSel.insertAdjacentHTML('beforeend', '<option value="' + esc(pr.department) + '">' + esc(pr.department) + '</option>');
      }
      deptSel.value = pr.department;
      deptSel.disabled = true;
      deptSel.style.cssText += READONLY_FIELD_STYLE;
    }

    const mapper = PR_ITEM_MAPPERS[pr.prTabName];
    const tbody = document.getElementById('poc-items-tbody');
    if (!mapper || !tbody || !Array.isArray(pr.items) || !pr.items.length) return;
    const poOnlyFields = PO_ONLY_ITEM_FIELDS[_format] || [];
    tbody.innerHTML = '';
    pr.items.forEach(it => {
      tbody.insertAdjacentHTML('beforeend', _itemRowHtml());
      const row = tbody.lastElementChild;
      _bindItemRow(row);
      const mapped = mapper(it);
      const codeInput = row.querySelector('.poc-item-code');
      if (codeInput) { codeInput.value = mapped.itemCode || ''; codeInput.readOnly = true; codeInput.style.cssText += READONLY_FIELD_STYLE; }
      _resolveItemPreview(row, mapped.itemCode);
      Object.entries(mapped).forEach(([field, val]) => {
        if (field === 'itemCode') return;
        const fieldInput = row.querySelector('[data-field="' + field + '"]');
        if (!fieldInput) return;
        fieldInput.value = val;
        if (!poOnlyFields.includes(field)) { fieldInput.readOnly = true; fieldInput.style.cssText += READONLY_FIELD_STYLE; }
      });
      _recomputeRow(row);
    });
    _recomputeGrandTotal();
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

  // Looks up an exact item code and fills that row's Description/Size preview
  // cells — shared by the item-code input's blur handler (manual typing) and
  // _fillPrIntoForm (programmatic prefill from a picked PR), since setting
  // .value in JS doesn't fire the input events the dropdown/blur flow relies on.
  async function _resolveItemPreview(row, code) {
    const q = String(code || '').trim();
    if (!q) return;
    const previewDesc = row.querySelector('.poc-item-desc');
    const previewSize = row.querySelector('.poc-item-size');
    if (!previewDesc || !previewSize) return;
    try {
      const res = await fetch('/api/po-creation/items?format=' + encodeURIComponent(_format) + '&q=' + encodeURIComponent(q));
      if (!res.ok) return;
      const matches = await res.json();
      const exact = matches.find(m => m.code.toLowerCase() === q.toLowerCase());
      if (exact) { previewDesc.textContent = exact.description || '—'; previewSize.textContent = exact.size || '—'; }
    } catch {}
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
    // Typing an exact, valid code and tabbing/clicking away — without ever
    // opening the suggestion dropdown — used to leave Description/Size stuck
    // on the placeholder "—". Resolve it on blur too, not just on an
    // explicit dropdown click.
    input.addEventListener('blur', () => _resolveItemPreview(row, input.value));
    window.addEventListener('scroll', (e) => { if (e.target !== dd) dd.style.display = 'none'; }, true);
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

  /* ── PO List (in-page tab) — read-only history from the ERP PO Log tab,
     filterable by format/department/party/date range ───────────────────── */
  async function _polLoad() {
    _polLoaded = false;
    _polLoadError = '';
    _polRenderTable();
    try {
      _polRows = await Utils.apiFetch('/api/po-creation/list') || [];
    } catch (e) {
      _polRows = [];
      _polLoadError = e.message || 'Failed to load POs';
    }
    _polLoaded = true;
    _polRefreshDeptOptions();
    _polRenderTable();
  }

  function _polDepartmentOptions() {
    return Array.from(new Set(_polRows.map(r => r.department).filter(Boolean))).sort();
  }

  function _polRefreshDeptOptions() {
    const sel = document.getElementById('pol-dept');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Departments</option>' + _polDepartmentOptions().map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
    if (current) sel.value = current;
  }

  function _polFilteredRows() {
    return _polRows.filter(r => {
      if (_polFFormat && r.format !== _polFFormat) return false;
      if (_polFDept && r.department !== _polFDept) return false;
      if (_polFParty && !(r.party || '').toLowerCase().includes(_polFParty.toLowerCase())) return false;
      if (_polFFrom && (r.date || '') < _polFFrom) return false;
      if (_polFTo && (r.date || '') > _polFTo) return false;
      return true;
    });
  }

  function _polRenderTable() {
    const body = document.getElementById('pol-body');
    const countEl = document.getElementById('pol-count');
    if (!body) return;

    if (!_polLoaded) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_polLoadError) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_polLoadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = _polFilteredRows();
    if (countEl) countEl.textContent = rows.length + ' of ' + _polRows.length;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_polRows.length ? 'No POs match these filters' : 'No POs created yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">' + esc(r.poNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;"><span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:600;">' + esc(FORMAT_LABEL[r.format] || r.format) + '</span></td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.party) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.department) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.total) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.createdBy) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + (r.pdfLink ? '<a href="' + esc(r.pdfLink) + '" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">View PDF</a>' : '<span style="color:#cbd5e1;">—</span>') + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
          + (r.status === 'Cancelled'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
            : '<button type="button" class="poc-cancel-btn" data-po="' + esc(r.poNo) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
        + '</td>'
      + '</tr>').join('');
  }

  function _polBindRowActions() {
    const body = document.getElementById('pol-body');
    if (!body || body.dataset.actionsBound) return;
    body.dataset.actionsBound = '1';
    body.addEventListener('click', async (e) => {
      const cancelBtn = e.target.closest('.poc-cancel-btn');
      if (cancelBtn) {
        const ok = await Utils.showConfirm('PO #' + cancelBtn.dataset.po + ' will be marked Cancelled and excluded from future GRN creation. This can\'t be undone.', { title: 'Cancel PO', confirmText: 'Cancel PO', danger: true });
        if (!ok) return;
        try {
          await Utils.apiFetch('/api/po-creation/cancel?poNo=' + encodeURIComponent(cancelBtn.dataset.po), { method: 'PUT' });
          Utils.showToast('PO #' + cancelBtn.dataset.po + ' cancelled', 'success');
          await _polLoad();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to cancel', 'error');
        }
      }
    });
  }

  function _polFilterBarHtml() {
    const formatOptions = '<option value="">All Formats</option>' + FORMATS.map(f => '<option value="' + esc(f) + '">' + esc(FORMAT_LABEL[f]) + '</option>').join('');
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<select id="pol-format" style="' + _inputStyle + 'min-width:140px;width:auto;background:#fff;">' + formatOptions + '</select>'
      + '<select id="pol-dept" style="' + _inputStyle + 'min-width:160px;width:auto;background:#fff;"><option value="">All Departments</option></select>'
      + '<input type="text" id="pol-party" placeholder="Search customer/vendor…" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
      + '<input type="date" id="pol-from" style="' + _inputStyle + 'width:auto;" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="pol-to" style="' + _inputStyle + 'width:auto;" />'
      + '<button type="button" id="pol-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="pol-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _polBindFilterBar() {
    document.getElementById('pol-format').addEventListener('change', (e) => { _polFFormat = e.target.value; _polRenderTable(); });
    document.getElementById('pol-dept').addEventListener('change', (e) => { _polFDept = e.target.value; _polRenderTable(); });
    document.getElementById('pol-party').addEventListener('input', (e) => { _polFParty = e.target.value; _polRenderTable(); });
    document.getElementById('pol-from').addEventListener('change', (e) => { _polFFrom = e.target.value; _polRenderTable(); });
    document.getElementById('pol-to').addEventListener('change', (e) => { _polFTo = e.target.value; _polRenderTable(); });
    document.getElementById('pol-clear').addEventListener('click', () => {
      _polFFormat = ''; _polFDept = ''; _polFParty = ''; _polFFrom = ''; _polFTo = '';
      document.getElementById('pol-format').value = '';
      document.getElementById('pol-dept').value = '';
      document.getElementById('pol-party').value = '';
      document.getElementById('pol-from').value = '';
      document.getElementById('pol-to').value = '';
      _polRenderTable();
    });
    document.getElementById('pol-refresh').addEventListener('click', _polLoad);
  }

  function _polViewHtml() {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<p style="font-size:12.5px;color:#64748b;margin:0;">Every PO created here, read live from the sheet\'s ERP PO Log.</p>'
        + '<span id="pol-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _polFilterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:920px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['PO No','Format','Date','Party','Department','Total (INR)','Created By','PDF','Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + h + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="pol-body"><tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>';
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
    // Rendered from Utils' cache; _loadMasters() re-fills this select in place
    // once the master list lands, so an early render is never left empty.
    const deptOptions = Utils.deptOptionsHtml();

    const common = ''
      + _textField('poc-date', 'Date', { type: 'date', value: _today() })
      + _readonlyField('poc-next-no', 'P.O. NO (auto-assigned)', _nextPoNumber != null ? _nextPoNumber : 'Loading…')
      + _prNoField()
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

  /* ── Additional Details — Terms & Conditions / Comments / Test Certificate
     (PurchaseOrder format only: the live template has a clean, dedicated,
     always-blank cell for each of these three; ENR PO/Diamond PO bake their
     own "YES / NO" placeholder into the label itself with nowhere separate
     to write, so they don't get this section). ─────────────────────────── */
  function _extraFieldsHtml() {
    if (_format !== 'PurchaseOrder') return '';
    return '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Additional Details</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
        + _textareaField('poc-terms', 'Terms and Conditions', { rows: 4, placeholder: 'One line per row (up to 5 lines)…' })
        + _textField('poc-comments', 'Any Comments')
        + _selectField('poc-test-cert', 'Test Certificate Required', ['', 'Yes', 'No'])
      + '</div>';
  }

  /* ── Format tabs (+ the PO List tab, alongside the 3 create formats) ──── */
  function _tabTab(label, active, extraAttrs) {
    return '<button type="button" ' + extraAttrs + ' style="'
      + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
      + 'color:' + (active ? 'var(--color-primary)' : '#94a3b8') + ';'
      + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
      + '">' + esc(label) + '</button>';
  }

  function _tabsHtml() {
    const formatTabs = FORMATS.map(f => _tabTab(FORMAT_LABEL[f], _view === 'create' && f === _format, 'class="poc-format-tab" data-format="' + esc(f) + '"')).join('');
    const listTab = _tabTab('PO List', _view === 'list', 'class="poc-list-tab"');
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">' + formatTabs + listTab + '</div>';
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

  /* ── Success popup — shows the Drive PDF link right after creation ────── */
  function _showPoCreatedModal(poNumber, pdfLink) {
    const existing = document.getElementById('poc-success-overlay');
    if (existing) existing.remove();

    const pdfSection = pdfLink
      ? '<a href="' + esc(pdfLink) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);font-size:13.5px;font-weight:700;text-decoration:none;">'
        + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6M9 15h6"/></svg>'
        + 'Open PDF in Drive</a>'
      : '<div style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;text-align:left;">PDF wasn\'t saved (Drive export/upload failed) — the PO itself is safely saved in the sheet. Check the Drive folder\'s sharing permissions for the service account.</div>';

    const overlay = document.createElement('div');
    overlay.id = 'poc-success-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:grid;place-items:center;padding:16px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
    overlay.innerHTML = ''
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:380px;box-shadow:0 24px 64px rgba(0,0,0,.2);overflow:hidden;animation:pop-in 200ms cubic-bezier(.16,1,.3,1);">'
        + '<div style="padding:26px 24px 22px;text-align:center;">'
          + '<div style="width:46px;height:46px;border-radius:50%;background:#f0fdf4;display:grid;place-items:center;margin:0 auto 14px;">'
            + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>'
          + '</div>'
          + '<div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px;">' + esc(poNumber) + ' Created</div>'
          + '<div style="font-size:12.5px;color:#64748b;margin-bottom:18px;">Saved into the live PO Google Sheet.</div>'
          + pdfSection
        + '</div>'
        + '<div style="padding:0 24px 22px;display:flex;justify-content:center;">'
          + '<button id="poc-success-close" style="padding:8px 20px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:12.5px;font-weight:600;cursor:pointer;">Close</button>'
        + '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('poc-success-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
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
    const termsAndConditions = _format === 'PurchaseOrder' ? document.getElementById('poc-terms').value : '';
    const comments = _format === 'PurchaseOrder' ? document.getElementById('poc-comments').value.trim() : '';
    const testCertificateRequired = _format === 'PurchaseOrder' ? document.getElementById('poc-test-cert').value : '';

    if (!date) { Utils.showToast('Date is required', 'error'); return; }
    if (!party) { Utils.showToast(PARTY_LABEL[_format] + ' is required', 'error'); return; }
    if (!poMadeBy) { Utils.showToast('PO Made By is required', 'error'); return; }
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }

    const btn = document.getElementById('poc-submit-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const result = await Utils.apiFetch('/api/po-creation', {
        method: 'POST',
        body: JSON.stringify({ format: _format, date, prNo, department, party, shipTo, deliverySchedule, poValidity, paymentTerms, poMadeBy, items, summary, termsAndConditions, comments, testCertificateRequired }),
      });
      await _loadMasters();
      renderPage();
      _showPoCreatedModal(result.poNumber, result.pdfLink);
    } catch (err) {
      Utils.showToast(err.message || 'Failed to create PO', 'error');
      btn.disabled = false; btn.textContent = 'Create Purchase Order';
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const isList = _view === 'list';
    const bodyHtml = isList
      ? _polViewHtml()
      : '<form id="poc-form" style="display:flex;flex-direction:column;gap:16px;">'
        + _headerFieldsHtml()
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Items</div>'
        + _itemsTableHtml()
        + '<div>'
          + '<button type="button" id="poc-add-item" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ Add Item</button>'
        + '</div>'
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Charges</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;">' + _summaryFieldsHtml() + '</div>'
        + _extraFieldsHtml()
        + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">'
          + '<span style="font-size:12.5px;font-weight:700;color:#64748b;">Estimated Total</span>'
          + '<span id="poc-grand-total" style="font-size:17px;font-weight:800;color:#0f172a;">₹0.00</span>'
        + '</div>'
        + '<button type="submit" id="poc-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Create Purchase Order</button>'
      + '</form>';

    el.innerHTML = '<div style="max-width:' + (isList ? '1200px' : '1080px') + ';margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">PO Creation</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Fills the same live PO Google Sheet the store team already uses, then saves a PDF of it to Drive.</p>'
      + '</div>'
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    document.querySelectorAll('.poc-format-tab').forEach(btn => {
      btn.addEventListener('click', () => { _view = 'create'; _format = btn.dataset.format; renderPage(); });
    });
    const listTab = document.querySelector('.poc-list-tab');
    if (listTab) listTab.addEventListener('click', () => { _view = 'list'; renderPage(); });

    if (isList) {
      _polBindFilterBar();
      _polBindRowActions();
      _polLoad();
      return;
    }

    _bindPartyField();
    _bindPrNoField();
    _bindAllItemRows();

    // Department dropdown: bound on every render (the form is rebuilt from
    // scratch each time), not just inside _loadMasters — which only runs on the
    // first render — so its "+ Add new department" option keeps working when
    // you switch format or come back from the List tab.
    Utils.bindDeptSelect(document.getElementById('poc-department'));

    document.getElementById('poc-add-item').addEventListener('click', () => {
      document.getElementById('poc-items-tbody').insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(document.getElementById('poc-items-tbody').lastElementChild);
    });

    const form = document.getElementById('poc-form');
    form.addEventListener('submit', _submit);
    form.addEventListener('input', _onFormInput);

    if (!_mastersLoaded) _loadMasters();
    if (!_pendingPrsLoaded) _loadPendingPrs();

    if (_pendingPrToApply) {
      const pr = _pendingPrToApply;
      _pendingPrToApply = null;
      _fillPrIntoForm(pr);
    }
  }

  return {
    render() { renderPage(); },
  };
})();
