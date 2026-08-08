window.Pages = window.Pages || {};

// ── PR (Form + Creation + Summary, all in one tab) ────────────────────────────
// Three in-page views, same pattern as po-creation.js folding in PO List:
//   'form'   — the digitized PR intake Google Form (was pr-form.js)
//   'create' — fills one of 4 live template tabs in the "PR July 2026" Google
//              Sheet (Purchase Requisition / Packing Sticker / Packing Box /
//              Aluminium), exports a PDF (saved to Drive), logs it
//   'list'   — "PR Summary": every sheet-filled PR, read live from ERP PR Log
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

  // Read-only, live-computed preview columns — a UI-only estimate, never sent
  // to the server. ALU has none: its "rate" column already is the row total
  // per the sheet's own SUM formula, not qty×rate.
  //
  // ITEM_CODE's preview is tax-inclusive (qty × price × (1 + tax%)) by
  // request, but the live sheet's own per-row formula (=E*I, verified
  // 2026-08-04) and its SUM total do NOT multiply in tax — so this preview
  // will read higher than the actual totalAmount that gets saved/logged/
  // printed for this PR. Known, accepted tradeoff — not a bug to "fix" by
  // matching the sheet; that would need editing the live per-row formula,
  // which was explicitly declined.
  const ITEM_COMPUTED = {
    ITEM_CODE: [{ key: 'amount', label: 'Total (INR)', compute: v => { const base = _num(v.qtyRequired) * _num(v.lastUnitPrice); return base + base * _num(v.tax) / 100; } }],
    PACKING_STICKER: [{ key: 'total', label: 'Total Amount (INR)', compute: v => _num(v.stickerQty) * _num(v.rate) }],
    PACKING_BOX: [{ key: 'total', label: 'Total (INR)', compute: v => _num(v.boxQty) * _num(v.boxRate) + _num(v.plateQty) * _num(v.plateRate) }],
    ALU: [],
  };

  /* ── PR Form constants — transcribed verbatim from the store team's PR Form
     (Google Form PDF); prefixed PF_ to avoid clashing with the Creation-view
     constants above ─────────────────────────────────────────────────────── */
  const PF_VENDOR_LIST = [
    'ABK LOGISTICS INDIA PVT LTD', 'ADINATH EQUIPMENTS', 'AKIL LIME CO', 'ALLCAST METAL',
    'AMAFF ENTERPRICES', 'AMI METAL INDUSTRY', 'AMUL INDUSTRIES', 'APARNA INDUSTRIAL ENGINEERS',
    'ARYA TRADERS', 'AUTO EQUIPEMENT', 'BOMBAY TRADING CO.', 'CISCO INDUSTRIES', 'DHIREN PAINTS',
    'DIAMOND CORRUGATED BOX', 'ENR CREATIVE SOLUTIONS', 'FAIR FASTENERS', 'GREEN FEIELD RESOURCE',
    'J.D TIMBERS', 'JAGDISH WIRE', 'JAY ENTERPRICES', 'KARNAVATI ELECTRICALS AND CONTROLS',
    'KIRTI TOOLS', 'KRISHNA GAS SERVICE', 'MEHTA METALS', 'NACHIKET SALES', 'NEPTUNE CHEMICALS',
    'OSWAL CHEMICALS', 'PARSHWANATH TRADERS', 'PARTH METAL CAST ODHAV', 'PATEL CASTING',
    'RADHESHYAM ACID', 'RUSHABH TRD.', 'SHREE BHAVANI TRADING COMPANY', 'SHREE KRISHNA ENGINEERING WORK',
    'SHRENATHJI COAL', 'Shri vallabh chemicals', 'TAPAN OXYGEN', 'TIWARI ENTERPTISE & ENGINEERING WORKS',
    'UMIYA PRODUCTS', 'UNICORN METAL INDUSTRIES', 'VAKHARIYA LALUMINIUM INDUSTRIES', 'VASANT ENTERPRICES',
    'VIKRAM OIL INDUSTRIES', 'VIKRANT INDUSTRIES', 'Yamuna Enterprise', 'Unity Sales Corporation',
    'Rippal Chemicals', 'Shree Ram Plastics', 'RUSHABH ELECTRICALS', 'GOPAL TRADERS',
    'SHREENATHJI TRD COMPANY', 'JAI MATADI CORPORATION', 'PARASNATH PACAKAGING',
  ];

  const PF_DEPARTMENT_LIST = [
    'accessory dept', 'Brazing dept', 'CNC dept', 'consumable', 'electric dept',
    'Packing dept', 'Pressing dept', 'Washing dept', 'Welding dept',
  ];

  const PF_PRODUCT_CATALOG = {
    accessory: ['BACK LIGHT MILK JUG KNOB', 'BRASS INSERT', 'S.S MILK JUG SCREW', 'STEEL CAP RIVET'],
    brazing: ['ALU.BRAZING POWDER (MUMBAI)', 'ALU.BRAZING POWDER (PUNA)'],
    consumable: ['-297 EX.COARSE PAPER', 'APPRON', 'COCONUT OIL', 'COTTON HAND GLOVES JE', 'COTTON WASTE', 'EMERY PAPER 320 NO', 'EMERY PAPER J-297 FINE', 'EXTRA PAPER J-297.', 'GREEN BAR', 'GREEN SCOTCH BRIGHT HAND PAD', 'GUMBOOT', 'KEROSENE', 'KNITTED HAND GLOVES HEAVY', 'KNITTED HAND GLOVES SMALL', 'A.P. - GREASE', 'M.S. WIRE', 'MADRASI BUFF 12 * 12', 'MS WELDING ROD NO.08', 'MS WELDING ROD NO.10', 'PVC COATED HAND GLOVES', 'QUENCHING OIL', 'RANI PAPER', 'SAFETY GOGGALS', 'SAFETY MASK', 'STEEL WOOL', 'TAPPER WHEEL', 'WHITE COTTON WASTE', 'WOODEN DHOKHA', 'WOODEN STICK', 'WOODEN WASTE', 'YELLOW CLOTHS'],
    electric: ['2.5 MFD CAPECITOR', '35 A R/F SWITCH', '4 MFD CAPECITOR', '6 MFD CAPECITOR', 'HALOZEN LIGHT 200W', 'L&T MK-1 4 TO 10 A', 'L&T MK-1 4 TO 6.5 A', 'TUBE LIGHT', 'TUBE LIGHT 36 W'],
    packing: ['B.O.P.P TAPP ROLL (BROWN)', 'POLYTHENE BAG 10*10', 'POLYTHENE BAG 10*12', 'POLYTHENE BAG 11*13', 'POLYTHENE BAG 12*12', 'POLYTHENE BAG 13*15', 'POLYTHENE BAG 14*16', 'POLYTHENE BAG 16*18', 'POLYTHENE BAG 18*20', 'POLYTHENE BAG 20*20', 'POLYTHENE BAG 20*22', 'POLYTHENE BAG 24*24', 'POLYTHENE BAG 26*26', 'POLYTHENE BAG 28*28', 'POLYTHENE BAG 32*32', 'POLYTHENE BAG 8*8', 'WHITE TAPE ROLL 1/2"', 'WHITE TAPE ROLL 3"', 'Pp bag 32×32'],
    pressing: ['ALU DRWMATE POWDER', 'COMPRESSOR OIL 220 NO', 'HYDROLIC OIL 68 NO', 'LUBRICANT OIL 40 NO', 'HP EP 220 NO GEAR OIL'],
    washing: ['AMONIUM ALUM', 'CAUSTIC SODA', 'CHROMIC ACID', 'HYDROFLORIC ACID', 'LIME POWDER', 'LIME POWDER LIQUID', 'LPG CYLENDER', 'NITRIC ACID', 'PHOSPHURIC ACID', 'SULPHURIC ACID', 'Saw firewood'],
    welding: ['ALU WELDING ROD 1.63 MM SMALL', 'ALU.WELDING ROD 2 MM', 'OXYGEN CYLENDER'],
  };

  const PF_CNC_PRODUCTS = ['HYDROPAC OIL 100 FOR CNC'];

  /* ── state ──────────────────────────────────────────────────── */
  let _view = 'form'; // 'form' | 'create' | 'list'
  let _format = 'ITEM_CODE';
  let _mastersLoaded = false;
  let _vendors = [];
  let _nextPrNumber = null;
  let _lastDepartment = '';
  // Fallback list — replaced by the live sheet's own Department dropdown
  // (same master list PO Creation uses) once /api/pr-creation/masters resolves.
  let _departments = [
    'Press Shop', 'Accessories', 'Fitting', 'Spinning', 'Milk Jug Fitting', 'Washing', 'Packing',
    'Tool Room', 'Store', 'Time Keeper', 'Cnc', 'Circles', 'Riveting Department', 'ST STEEL', 'PRESSING', 'ALU CIRCLE',
  ];

  // PR Summary (in-page tab) state — read-only history from the ERP PR Log tab.
  let _sumRows = [];
  let _sumLoaded = false;
  let _sumLoadError = '';
  let _sumFFormat = '';
  let _sumFDept = '';
  let _sumFParty = '';
  let _sumFFrom = '';
  let _sumFTo = '';

  function _today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function _fmtMoney(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* ── Helpers (Creation/Summary views) ──────────────────────────────────── */
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
      if (Array.isArray(data.departments) && data.departments.length) _departments = data.departments;
      _nextPrNumber = data.nextPrNumber;
      _mastersLoaded = true;
      const el = document.getElementById('pcr-next-no');
      if (el) el.textContent = _nextPrNumber != null ? _nextPrNumber : '—';
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load PR masters', 'error');
    }
  }

  /* ── Party (vendor/customer) typeahead ─────────────────────────────────── */
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

  /* ── "Add new item" modal — for when the picker below comes up empty.
     Writes straight into the current format's own item-master tab (see
     POST /api/pr-creation/items in server.js), then fills the row that
     triggered it exactly as if the new item had been picked from search. ── */
  function _closeAddItemModal() {
    document.getElementById('pcr-add-item-modal-overlay')?.remove();
  }

  function _openAddItemModal(prefillCode, ctx) {
    _closeAddItemModal();
    const bodyHTML = ''
      + '<div style="display:flex;flex-direction:column;gap:12px;">'
        + _fieldWrap('Item Code', '<input type="text" id="pcr-nai-code" autocomplete="off" value="' + esc(prefillCode || '') + '" style="' + _inputStyle + '" />')
        + _fieldWrap('Description', '<input type="text" id="pcr-nai-desc" autocomplete="off" style="' + _inputStyle + '" />')
        + _fieldWrap('Size', '<input type="text" id="pcr-nai-size" autocomplete="off" style="' + _inputStyle + '" />')
      + '</div>';
    const footerHTML = ''
      + '<button type="button" id="pcr-nai-cancel" class="btn-secondary">Cancel</button>'
      + '<button type="button" id="pcr-nai-save" class="btn-primary">Add Item</button>';
    document.body.insertAdjacentHTML('beforeend', window.UI.modal({
      id: 'pcr-add-item-modal-overlay',
      title: 'Add New Item',
      subtitle: FORMAT_LABEL[_format] + ' item master',
      width: 420,
      closeButtonId: 'pcr-nai-close',
      hiddenByDefault: false,
      bodyHTML, footerHTML,
    }));
    const overlay = document.getElementById('pcr-add-item-modal-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeAddItemModal(); });
    document.getElementById('pcr-nai-close').addEventListener('click', _closeAddItemModal);
    document.getElementById('pcr-nai-cancel').addEventListener('click', _closeAddItemModal);
    document.getElementById('pcr-nai-save').addEventListener('click', () => _submitAddItem(ctx));
    document.getElementById('pcr-nai-code').focus();
  }

  async function _submitAddItem(ctx) {
    const codeInput = document.getElementById('pcr-nai-code');
    const code = codeInput.value.trim();
    const description = document.getElementById('pcr-nai-desc').value.trim();
    const size = document.getElementById('pcr-nai-size').value.trim();
    if (!code) { Utils.showToast('Item code is required', 'warning'); codeInput.focus(); return; }
    const saveBtn = document.getElementById('pcr-nai-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Adding…';
    try {
      const result = await Utils.apiFetch('/api/pr-creation/items', {
        method: 'POST', body: JSON.stringify({ format: _format, code, description, size }),
      });
      if (!result) return;
      ctx.input.value = result.code;
      ctx.previewDesc.textContent = result.description || '—';
      ctx.previewSize.textContent = result.size || '—';
      ctx.dd.style.display = 'none';
      _closeAddItemModal();
      Utils.showToast('Item added — you can now use it right away', 'success');
    } catch (e) {
      Utils.showToast(e.message || 'Failed to add item', 'error');
      saveBtn.disabled = false; saveBtn.textContent = 'Add Item';
    }
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
          const addNewHtml = '<div class="pcr-item-add-new" style="padding:8px 12px;font-size:12.5px;cursor:pointer;font-weight:700;color:var(--color-primary);'
            + (matches.length ? 'border-top:1px solid #e2e8f0;' : '') + '">+ Add' + (q ? ' "' + esc(q) + '"' : '') + ' as new item</div>';
          dd.innerHTML = matches.map(m => '<div class="pcr-item-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-code="' + esc(m.code) + '" data-desc="' + esc(m.description) + '" data-size="' + esc(m.size) + '">'
            + '<b>' + esc(m.code) + '</b> — ' + esc(m.description) + (m.size ? ' (' + esc(m.size) + ')' : '') + '</div>').join('') + addNewHtml;
          const rect = input.getBoundingClientRect();
          dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 260) + 'px';
          dd.style.display = 'block';
        } catch {}
      }, 220);
    };
    input.addEventListener('input', runSearch);
    input.addEventListener('focus', runSearch);
    dd.addEventListener('mousedown', (e) => {
      const addNew = e.target.closest('.pcr-item-add-new');
      if (addNew) {
        dd.style.display = 'none';
        _openAddItemModal(input.value.trim(), { input, previewDesc, previewSize, dd });
        return;
      }
      const opt = e.target.closest('.pcr-item-opt');
      if (!opt) return;
      input.value = opt.dataset.code;
      previewDesc.textContent = opt.dataset.desc || '—';
      previewSize.textContent = opt.dataset.size || '—';
      dd.style.display = 'none';
    });
    window.addEventListener('scroll', (e) => { if (e.target !== dd) dd.style.display = 'none'; }, true);
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
      if (_format === 'ITEM_CODE') { const base = _num(vals.qtyRequired) * _num(vals.lastUnitPrice); total += base + base * _num(vals.tax) / 100; }
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
      _recomputeGrandTotal();
    }
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

  /* ── Header + department fields (Creation view) ─────────────────────────── */
  function _headerFieldsHtml() {
    const common = HEADER_FIELDS[_format].map(f => _textField('pcr-' + f.key, f.label, { type: f.type, value: f.key === 'dateRequested' ? _today() : '' })).join('');
    const deptMode = DEPARTMENT_MODE[_format];
    const dept = deptMode === 'manual'
      ? _fieldWrap('Department', '<select id="pcr-department" style="' + _inputStyle + 'background:#fff;"><option value="">Select…</option>'
          + _departments.map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('') + '</select>')
      : (deptMode === 'auto' ? _readonlyField('pcr-department-preview', 'Department (auto, from first item)', _lastDepartment || 'Filled in after saving') : '');
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
      + _readonlyField('pcr-next-no', 'PR NO (auto-assigned)', _nextPrNumber != null ? _nextPrNumber : 'Loading…')
      + _partyField()
      + common
      + dept
    + '</div>';
  }

  /* ── Submit (Creation view) ─────────────────────────────────────────────── */
  function _collectItems() {
    const fields = ITEM_FIELDS[_format];
    return Array.from(document.querySelectorAll('#pcr-items-tbody .pcr-item-row')).map(row => {
      const item = { itemCode: row.querySelector('.pcr-item-code').value.trim() };
      fields.forEach(f => { item[f.key] = row.querySelector('[data-field="' + f.key + '"]').value.trim(); });
      return item;
    }).filter(it => it.itemCode);
  }

  /* ── Success popup — shows the Drive PDF link right after creation, same
     as PO Creation's ────────────────────────────────────────────────────── */
  function _showPrCreatedModal(prNumber, pdfLink) {
    const existing = document.getElementById('pcr-success-overlay');
    if (existing) existing.remove();

    const pdfSection = pdfLink
      ? '<a href="' + esc(pdfLink) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);font-size:13.5px;font-weight:700;text-decoration:none;">'
        + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6M9 15h6"/></svg>'
        + 'Open PDF in Drive</a>'
      : '<div style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;text-align:left;">PDF wasn\'t saved (Drive export/upload failed) — the PR itself is safely saved in the sheet. Check the Drive folder\'s sharing permissions for the service account.</div>';

    const overlay = document.createElement('div');
    overlay.id = 'pcr-success-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:grid;place-items:center;padding:16px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
    overlay.innerHTML = ''
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:380px;box-shadow:0 24px 64px rgba(0,0,0,.2);overflow:hidden;animation:pop-in 200ms cubic-bezier(.16,1,.3,1);">'
        + '<div style="padding:26px 24px 22px;text-align:center;">'
          + '<div style="width:46px;height:46px;border-radius:50%;background:#f0fdf4;display:grid;place-items:center;margin:0 auto 14px;">'
            + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>'
          + '</div>'
          + '<div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px;">' + esc(prNumber) + ' Created</div>'
          + '<div style="font-size:12.5px;color:#64748b;margin-bottom:18px;">Saved into the live PR Google Sheet.</div>'
          + pdfSection
        + '</div>'
        + '<div style="padding:0 24px 22px;display:flex;justify-content:center;">'
          + '<button id="pcr-success-close" style="padding:8px 20px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:12.5px;font-weight:600;cursor:pointer;">Close</button>'
        + '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('pcr-success-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
  }

  async function _createSubmit(e) {
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
      await _loadMasters();
      renderPage();
      _showPrCreatedModal(result.prNumber, result.pdfLink);
    } catch (err) {
      Utils.showToast(err.message || 'Failed to create PR', 'error');
      btn.disabled = false; btn.textContent = 'Create Purchase Requisition';
    }
  }

  function _createViewHtml() {
    return '<form id="pcr-form" style="display:flex;flex-direction:column;gap:16px;">'
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
    + '</form>';
  }

  function _bindCreateView() {
    _bindPartyField();
    _bindAllItemRows();
    document.getElementById('pcr-add-item').addEventListener('click', () => {
      document.getElementById('pcr-items-tbody').insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(document.getElementById('pcr-items-tbody').lastElementChild);
    });
    const form = document.getElementById('pcr-form');
    form.addEventListener('submit', _createSubmit);
    form.addEventListener('input', _onFormInput);
    if (!_mastersLoaded) _loadMasters();
  }

  /* ── PR Summary (in-page tab) — read-only history from the ERP PR Log tab,
     filterable by format/department/party/date range ───────────────────── */
  async function _sumLoad() {
    _sumLoaded = false;
    _sumLoadError = '';
    _sumRenderTable();
    try {
      _sumRows = await Utils.apiFetch('/api/pr-creation/list') || [];
    } catch (e) {
      _sumRows = [];
      _sumLoadError = e.message || 'Failed to load PRs';
    }
    _sumLoaded = true;
    _sumRefreshDeptOptions();
    _sumRenderTable();
  }

  function _sumDepartmentOptions() {
    return Array.from(new Set(_sumRows.map(r => r.department).filter(Boolean))).sort();
  }

  function _sumRefreshDeptOptions() {
    const sel = document.getElementById('sum-dept');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Departments</option>' + _sumDepartmentOptions().map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
    if (current) sel.value = current;
  }

  function _sumFilteredRows() {
    return _sumRows.filter(r => {
      if (_sumFFormat && r.format !== _sumFFormat) return false;
      if (_sumFDept && r.department !== _sumFDept) return false;
      if (_sumFParty && !(r.party || '').toLowerCase().includes(_sumFParty.toLowerCase())) return false;
      if (_sumFFrom && (r.date || '') < _sumFFrom) return false;
      if (_sumFTo && (r.date || '') > _sumFTo) return false;
      return true;
    });
  }

  function _sumRenderTable() {
    const body = document.getElementById('sum-body');
    const countEl = document.getElementById('sum-count');
    if (!body) return;

    if (!_sumLoaded) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_sumLoadError) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_sumLoadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = _sumFilteredRows();
    if (countEl) countEl.textContent = rows.length + ' of ' + _sumRows.length;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_sumRows.length ? 'No PRs match these filters' : 'No PRs created yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">' + esc(r.prNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;"><span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:600;">' + esc(FORMAT_LABEL[r.format] || r.format) + '</span></td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.party) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.requestedBy) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.department) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.total) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + (r.pdfLink ? '<a href="' + esc(r.pdfLink) + '" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">View PDF</a>' : '<span style="color:#cbd5e1;">—</span>') + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
          + (r.status === 'Cancelled'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
            : '<button type="button" class="pcr-cancel-btn" data-pr="' + esc(r.prNo) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
        + '</td>'
      + '</tr>').join('');
  }

  function _sumBindRowActions() {
    const body = document.getElementById('sum-body');
    if (!body || body.dataset.actionsBound) return;
    body.dataset.actionsBound = '1';
    body.addEventListener('click', async (e) => {
      const cancelBtn = e.target.closest('.pcr-cancel-btn');
      if (cancelBtn) {
        const ok = await Utils.showConfirm('PR #' + cancelBtn.dataset.pr + ' will be marked Cancelled and excluded from future PO creation. This can\'t be undone.', { title: 'Cancel PR', confirmText: 'Cancel PR', danger: true });
        if (!ok) return;
        try {
          await Utils.apiFetch('/api/pr-creation/cancel?prNo=' + encodeURIComponent(cancelBtn.dataset.pr), { method: 'PUT' });
          Utils.showToast('PR #' + cancelBtn.dataset.pr + ' cancelled', 'success');
          await _sumLoad();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to cancel', 'error');
        }
      }
    });
  }

  function _sumFilterBarHtml() {
    const formatOptions = '<option value="">All Formats</option>' + FORMATS.map(f => '<option value="' + esc(f) + '">' + esc(FORMAT_LABEL[f]) + '</option>').join('');
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<select id="sum-format" style="' + _inputStyle + 'min-width:160px;width:auto;background:#fff;">' + formatOptions + '</select>'
      + '<select id="sum-dept" style="' + _inputStyle + 'min-width:160px;width:auto;background:#fff;"><option value="">All Departments</option></select>'
      + '<input type="text" id="sum-party" placeholder="Search vendor/party…" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
      + '<input type="date" id="sum-from" style="' + _inputStyle + 'width:auto;" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="sum-to" style="' + _inputStyle + 'width:auto;" />'
      + '<button type="button" id="sum-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="sum-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _sumBindFilterBar() {
    document.getElementById('sum-format').addEventListener('change', (e) => { _sumFFormat = e.target.value; _sumRenderTable(); });
    document.getElementById('sum-dept').addEventListener('change', (e) => { _sumFDept = e.target.value; _sumRenderTable(); });
    document.getElementById('sum-party').addEventListener('input', (e) => { _sumFParty = e.target.value; _sumRenderTable(); });
    document.getElementById('sum-from').addEventListener('change', (e) => { _sumFFrom = e.target.value; _sumRenderTable(); });
    document.getElementById('sum-to').addEventListener('change', (e) => { _sumFTo = e.target.value; _sumRenderTable(); });
    document.getElementById('sum-clear').addEventListener('click', () => {
      _sumFFormat = ''; _sumFDept = ''; _sumFParty = ''; _sumFFrom = ''; _sumFTo = '';
      document.getElementById('sum-format').value = '';
      document.getElementById('sum-dept').value = '';
      document.getElementById('sum-party').value = '';
      document.getElementById('sum-from').value = '';
      document.getElementById('sum-to').value = '';
      _sumRenderTable();
    });
    document.getElementById('sum-refresh').addEventListener('click', _sumLoad);
  }

  function _summaryViewHtml() {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<p style="font-size:12.5px;color:#64748b;margin:0;">Every PR created via the sheet-fill tool, read live from ERP PR Log.</p>'
        + '<span id="sum-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _sumFilterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:920px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['PR No','Format','Date','Party','Requested By','Department','Total (INR)','PDF','Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + h + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="sum-body"><tr><td colspan="9" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>';
  }

  /* ── PR Form view (digitized Google Form intake) ───────────────────────── */
  function _pfFieldWrap(label, sublabel, innerHtml, required, full) {
    return '<div class="' + (full ? 'pr-form-full ' : '') + 'pr-form-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">'
      + '<div style="font-size:13px;font-weight:700;color:#1e293b;">' + esc(label) + (required ? ' <span style="color:#ef4444;">*</span>' : '') + '</div>'
      + '<div style="font-size:11.5px;color:#94a3b8;margin:2px 0 10px;">' + esc(sublabel) + '</div>'
      + innerHtml
      + '</div>';
  }

  function _pfTextField(id, label, sublabel, required, full) {
    return _pfFieldWrap(label, sublabel,
      '<input type="text" id="' + id + '" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;" />',
      required, full);
  }

  function _pfNumberField(id, label, sublabel, required, full) {
    return _pfFieldWrap(label, sublabel,
      '<input type="text" inputmode="decimal" id="' + id + '" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;" />',
      required, full);
  }

  function _pfChkRow(cls, value, isOther) {
    return '<label class="pr-chk-row' + (isOther ? ' pr-other-row' : '') + '" data-name="' + esc(value.toLowerCase()) + '" style="display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:13px;color:#374151;cursor:pointer;">'
      + '<input type="checkbox" class="' + cls + '" value="' + esc(value) + '" style="width:15px;height:15px;cursor:pointer;accent-color:var(--color-primary);flex-shrink:0;" />'
      + esc(value)
      + '</label>';
  }

  const _PF_CHEVRON = '<svg class="pr-msd-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .15s;flex-shrink:0;color:#94a3b8;"><path d="m6 9 6 6 6-6"/></svg>';

  // Closed-by-default multi-select "dropdown" — looks like a single select field until
  // clicked, then opens a floating panel of checkboxes so several options can be picked
  // without permanently occupying page height (unlike a plain checkbox grid).
  function _pfMultiSelectDropdown(cls, label, sublabel, options, includeOther, cfg) {
    cfg = cfg || {};
    const placeholder = cfg.placeholder || 'Select…';
    const rows = options.map(o => _pfChkRow(cls, o)).join('') + (includeOther ? _pfChkRow(cls, 'Other', true) : '');
    const searchHtml = cfg.searchable
      ? '<input type="text" class="pr-msd-search" placeholder="Search…" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12.5px;margin-bottom:6px;outline:none;" />'
      : '';
    const inner = '<div class="pr-msd" data-cls="' + cls + '" data-placeholder="' + esc(placeholder) + '">'
        + '<button type="button" class="pr-msd-control" style="width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;background:#fff;cursor:pointer;">'
          + '<span class="pr-msd-summary" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;color:#94a3b8;">' + esc(placeholder) + '</span>'
          + _PF_CHEVRON
        + '</button>'
        + '<div class="pr-msd-panel" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:40;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.14);padding:8px;">'
          + searchHtml
          + '<div class="pr-msd-options" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px 10px;max-height:240px;overflow-y:auto;">' + rows + '</div>'
        + '</div>'
      + '</div>';
    return _pfFieldWrap(label, sublabel, inner, cfg.required !== false, cfg.full);
  }

  function _pfCncGroup() {
    const opts = PF_CNC_PRODUCTS.concat(['Other']).map(o => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('');
    const inner = '<select id="pr-cnc-select" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;background:#fff;">'
      + '<option value="">Choose…</option>' + opts
      + '</select>';
    return _pfFieldWrap('CNC Product Name', 'સીએનસી ઉત્પાદનનું નામ / सीएनसी उत्पाद का नाम', inner, false);
  }

  function _pfCheckedValues(cls) {
    return Array.from(document.querySelectorAll('.' + cls + ':checked')).map(cb => cb.value);
  }

  async function _pfSubmit(e) {
    e.preventDefault();
    const prNo             = document.getElementById('pr-no').value.trim();
    const filledBy         = document.getElementById('pr-filled-by').value.trim();
    const vendors           = _pfCheckedValues('pr-vendor-chk');
    const vendorOther       = document.getElementById('pr-vendor-other').value.trim();
    const department        = _pfCheckedValues('pr-dept-chk');
    const departmentOther   = document.getElementById('pr-dept-other').value.trim();
    const accessoryProduct  = _pfCheckedValues('pr-accessory-chk');
    const brazingProduct    = _pfCheckedValues('pr-brazing-chk');
    const cncProduct        = document.getElementById('pr-cnc-select').value;
    const consumableProduct = _pfCheckedValues('pr-consumable-chk');
    const electricProduct   = _pfCheckedValues('pr-electric-chk');
    const packingProduct    = _pfCheckedValues('pr-packing-chk');
    const pressingProduct   = _pfCheckedValues('pr-pressing-chk');
    const washingProduct    = _pfCheckedValues('pr-washing-chk');
    const weldingProduct    = _pfCheckedValues('pr-welding-chk');
    const newProduct        = document.getElementById('pr-new-product').value.trim();
    const currentStock      = document.getElementById('pr-current-stock').value.trim();
    const quantityRequired  = document.getElementById('pr-qty-required').value.trim();
    const previousRate      = document.getElementById('pr-previous-rate').value.trim();

    if (!prNo)     { Utils.showToast('PR No. is required', 'error'); return; }
    if (!filledBy) { Utils.showToast('Name of person filling the form is required', 'error'); return; }
    if (!vendors.length && !vendorOther) { Utils.showToast('Select at least one vendor, or enter a new vendor', 'error'); return; }
    if (!department.length && !departmentOther) { Utils.showToast('Select at least one department, or enter a new department', 'error'); return; }
    if (!currentStock || !quantityRequired || !previousRate) { Utils.showToast('Current Stock, Quantity Required and Previous Rate are required', 'error'); return; }

    const btn = document.getElementById('pr-submit-btn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      await Utils.apiFetch('/api/pr-requisitions', {
        method: 'POST',
        body: JSON.stringify({
          pr_no: prNo, filled_by: filledBy,
          vendors, vendor_other: vendorOther,
          department, department_other: departmentOther,
          accessory_product: accessoryProduct, brazing_product: brazingProduct, cnc_product: cncProduct,
          consumable_product: consumableProduct, electric_product: electricProduct, packing_product: packingProduct,
          pressing_product: pressingProduct, washing_product: washingProduct, welding_product: weldingProduct,
          new_product: newProduct,
          current_stock: currentStock, quantity_required: quantityRequired, previous_rate: previousRate,
        }),
      });
      Utils.showToast('PR submitted successfully', 'success');
      renderPage();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to submit', 'error');
      btn.disabled = false; btn.textContent = 'Submit PR';
    }
  }

  /* ── PR Form multi-select dropdown behaviour (open/close, live summary, search) ── */
  let _pfDocClickHandler = null;

  function _pfCloseAllDropdowns(formEl) {
    formEl.querySelectorAll('.pr-msd.open').forEach(m => _pfSetDropdownOpen(m, false));
  }

  function _pfSetDropdownOpen(msd, open) {
    msd.classList.toggle('open', open);
    const panel   = msd.querySelector('.pr-msd-panel');
    const chevron = msd.querySelector('.pr-msd-chevron');
    if (panel)   panel.style.display   = open ? 'block' : 'none';
    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  }

  function _pfUpdateDropdownSummary(msd) {
    const cls     = msd.dataset.cls;
    const summary = msd.querySelector('.pr-msd-summary');
    const values   = _pfCheckedValues(cls);
    if (!values.length) {
      summary.textContent = msd.dataset.placeholder;
      summary.style.color = '#94a3b8';
    } else {
      summary.textContent = values.length === 1 ? values[0] : (values[0] + '  +' + (values.length - 1) + ' more');
      summary.style.color = '#1e293b';
    }
  }

  function _pfBindMultiSelectDropdowns(formEl) {
    formEl.addEventListener('click', (e) => {
      const control = e.target.closest('.pr-msd-control');
      if (control) {
        const msd = control.closest('.pr-msd');
        const willOpen = !msd.classList.contains('open');
        _pfCloseAllDropdowns(formEl);
        _pfSetDropdownOpen(msd, willOpen);
        return;
      }
      if (!e.target.closest('.pr-msd')) _pfCloseAllDropdowns(formEl);
    });

    formEl.addEventListener('change', (e) => {
      if (!e.target.matches('input[type="checkbox"]')) return;
      const msd = e.target.closest('.pr-msd');
      if (msd) _pfUpdateDropdownSummary(msd);
    });

    formEl.addEventListener('input', (e) => {
      if (!e.target.matches('.pr-msd-search')) return;
      const panel = e.target.closest('.pr-msd-panel');
      const q = e.target.value.trim().toLowerCase();
      panel.querySelectorAll('.pr-chk-row').forEach(row => {
        if (row.classList.contains('pr-other-row')) return;
        row.style.display = (!q || (row.dataset.name || '').includes(q)) ? 'flex' : 'none';
      });
    });

    if (_pfDocClickHandler) document.removeEventListener('click', _pfDocClickHandler);
    _pfDocClickHandler = (e) => { if (!formEl.contains(e.target)) _pfCloseAllDropdowns(formEl); };
    document.addEventListener('click', _pfDocClickHandler);
  }

  function _formViewHtml() {
    return '<style>'
        + '.pr-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;}'
        + '.pr-form-full{grid-column:1 / -1;}'
        + '.pr-msd{position:relative;}'
        + '.pr-msd-control:hover{border-color:#cbd5e1;}'
        + '@media (max-width:760px){.pr-form-grid{grid-template-columns:1fr;}}'
      + '</style>'
      + '<form id="pr-form-el" class="pr-form-grid">'
        + _pfTextField('pr-no', 'Purchase Requisition Number (PR NO.)', 'पी.आर. नंबर / પી.આર. નંબર', true)
        + _pfTextField('pr-filled-by', 'Name of Person Filling the Form', 'फ़ॉर्म भरने वाले व्यक्ति का नाम / ફોર્મ ભરતા વ્યક્તિનું નામ', true)
        + _pfMultiSelectDropdown('pr-vendor-chk', 'Available Options of Vendors', 'ઉપલબ્ધ વેન્ડરના વિકલ્પો / वेंडरों के उपलब्ध विकल्प', PF_VENDOR_LIST, true, { placeholder: 'Select vendor(s)…', searchable: true, full: true })
        + _pfTextField('pr-vendor-other', 'If New Vendor then Enter Here', 'જો નવો વેન્ડર હોય તો અહીં દાખલ કરો / अगर नया वेंडर हो तो यहां दर्ज करें', false)
        + _pfMultiSelectDropdown('pr-dept-chk', 'Department', 'વિભાગ / विभाग', PF_DEPARTMENT_LIST, true, { placeholder: 'Select department(s)…' })
        + _pfTextField('pr-dept-other', 'If New Department then Enter Here', 'જો નવો વિભાગ હોય તો અહીં દાખલ કરો / अगर नया विभाग हो तो यहां दर्ज करें', false)
        + '<div class="pr-form-full" style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Product Name (optional)</div>'
        + _pfMultiSelectDropdown('pr-accessory-chk', 'Accessory Product Name', 'અનુસંગી ઉત્પાદનનું નામ / सहायक उत्पाद का नाम', PF_PRODUCT_CATALOG.accessory, true, { required: false })
        + _pfMultiSelectDropdown('pr-brazing-chk', 'Brazing Product Name', 'બ્રેઝિંગ ઉત્પાદનનું નામ / ब्रेजिंग उत्पाद का नाम', PF_PRODUCT_CATALOG.brazing, false, { required: false })
        + _pfCncGroup()
        + _pfMultiSelectDropdown('pr-consumable-chk', 'Consumable Product Name', 'ઉપયોગી વસ્તુનું નામ / उपभोज्य उत्पाद का नाम', PF_PRODUCT_CATALOG.consumable, true, { required: false, searchable: true })
        + _pfMultiSelectDropdown('pr-electric-chk', 'Electric Product Name', 'ઇલેક્ટ્રિક ઉત્પાદનનું નામ / विद्युत उत्पाद का नाम', PF_PRODUCT_CATALOG.electric, true, { required: false })
        + _pfMultiSelectDropdown('pr-packing-chk', 'Packing Product Name', 'પેકિંગ ઉત્પાદનનું નામ / पैकिंग उत्पाद का नाम', PF_PRODUCT_CATALOG.packing, true, { required: false })
        + _pfMultiSelectDropdown('pr-pressing-chk', 'Pressing Product Name', 'પેકિંગ ઉત્પાદનનું નામ / पैकिंग उत्पाद का नाम', PF_PRODUCT_CATALOG.pressing, true, { required: false })
        + _pfMultiSelectDropdown('pr-washing-chk', 'Washing Product Name', 'ધોઈ ઉત્પાદનનું નામ / धोनेका उत्पाद का नाम', PF_PRODUCT_CATALOG.washing, true, { required: false })
        + _pfMultiSelectDropdown('pr-welding-chk', 'Welding Product Name', 'વેલ્ડીંગ ઉત્પાદનનું નામ / वेल्डिंग उत्पाद का नाम', PF_PRODUCT_CATALOG.welding, true, { required: false })
        + _pfTextField('pr-new-product', 'If New Product then Enter Here', 'જો નવો ઉત્પાદન હોય તો અહીં દાખલ કરો / अगर नया उत्पाद है तो यहाँ दर्ज करें', false)
        + '<div class="pr-form-full" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;">'
          + _pfNumberField('pr-current-stock', 'Current Stock', 'वर्तमान स्टॉक / હાલનું સ્ટોક', true)
          + _pfNumberField('pr-qty-required', 'Quantity Required', 'आवश्यक मात्रा / જરૂરી પ્રમાણ', true)
          + _pfNumberField('pr-previous-rate', 'Previous Rate', 'पिछली दर / પહેલી દર', true)
        + '</div>'
        + '<button type="submit" id="pr-submit-btn" class="pr-form-full" style="justify-self:start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Submit PR</button>'
      + '</form>';
  }

  function _bindFormView() {
    const formEl = document.getElementById('pr-form-el');
    formEl.addEventListener('submit', _pfSubmit);
    _pfBindMultiSelectDropdowns(formEl);
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
    const formTab = _tabTab('PR Form', _view === 'form', 'class="pcr-form-tab"');
    const formatTabs = FORMATS.map(f => _tabTab(FORMAT_LABEL[f], _view === 'create' && f === _format, 'class="pcr-format-tab" data-format="' + esc(f) + '"')).join('');
    const summaryTab = _tabTab('PR Summary', _view === 'list', 'class="pcr-summary-tab"');
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap;">' + formatTabs + formTab + summaryTab + '</div>';
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const bodyHtml = _view === 'form' ? _formViewHtml() : (_view === 'list' ? _summaryViewHtml() : _createViewHtml());
    const maxWidth = _view === 'list' ? '1200px' : (_view === 'form' ? '980px' : '1080px');

    el.innerHTML = '<div style="max-width:' + maxWidth + ';margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">PR</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Raise a PR via the store team\'s Google Form, fill their live PR Google Sheet directly, or browse everything already created.</p>'
      + '</div>'
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    document.querySelector('.pcr-form-tab')?.addEventListener('click', () => { _view = 'form'; renderPage(); });
    document.querySelectorAll('.pcr-format-tab').forEach(btn => {
      btn.addEventListener('click', () => { _view = 'create'; _format = btn.dataset.format; renderPage(); });
    });
    document.querySelector('.pcr-summary-tab')?.addEventListener('click', () => { _view = 'list'; renderPage(); });

    if (_view === 'form') { _bindFormView(); return; }
    if (_view === 'list') { _sumBindFilterBar(); _sumBindRowActions(); _sumLoad(); return; }
    _bindCreateView();
  }

  return {
    render() { renderPage(); },
  };
})();
