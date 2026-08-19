window.Pages = window.Pages || {};

// ── Proforma Invoice (PI) Creation ────────────────────────────────────────────
// Fills a brand-new, dedicated live Google Sheet ("ERP - Proforma Invoice" —
// see PI_CREATION_SHEET_ID in server.js / scripts/rebuild-pi-sheet.js). Unlike
// PO/PR/GRN Creation (create-then-Cancel-only), a PI is a genuine two-stage
// record: any User creates it (consignee + shipping + items — no price at all),
// then whoever is granted the 'set_price' feature for this page (Admin/HOD
// always, or a specific User granted it from Users → Access tab) opens that
// same PI and fills in the rate per piece — along with the price basis (CNF /
// CIF / FOB / Ex Fact) and the currency, which is what every money label on
// the printed document is then built from. That finalizes it in place.
//
// This is the company's EXPORT PI / OCS document — priced C&F in US$ by
// default, though the basis and currency are per PI now, with
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
  let _consignees = [];     // buyer master from the export team's fetch_consignee sheet
  // Options for the three shipping selects, from the values that master
  // already uses (see _piShippingOptions in server.js).
  let _shippingOptions = { portOfLoading: [], portOfDischarge: [], placeOfDelivery: [] };
  // Price basis and currency — chosen on the Add Price screen, and what the
  // whole printed PI's money labels are built from (see priceLabels in
  // backend/lib/pi-format.js).
  let _priceTypes = [];
  let _currencies = [];
  let _priceDefault = { priceType: 'CNF', currency: 'USD' };
  let _defaults = null;     // boilerplate from backend/lib/pi-format.js
  let _maxItems = 30;

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

  // Revision state — set while the Create tab is being used to re-issue an
  // existing PI rather than raise a new one. { piNo, status } of the parent.
  let _reviseOf = null;

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
      _consignees = data.consignees || [];
      if (data.shippingOptions) _shippingOptions = data.shippingOptions;
      if (data.priceTypes) _priceTypes = data.priceTypes;
      if (data.currencies) _currencies = data.currencies;
      if (data.priceDefault) _priceDefault = data.priceDefault;
      if (data.defaults) _defaults = data.defaults;
      if (data.maxItems) _maxItems = data.maxItems;
      _mastersLoaded = true;
      const el = document.getElementById('pic-next-no');
      if (el) el.textContent = _piNoDisplay();
      const terms = document.getElementById('pic-terms');
      if (terms && !terms.value && _defaults) terms.value = (_defaults.terms || []).join('\n');
      _applyShippingOptions();
      // The Add Price screen may already be open and waiting on these two
      // lists. Refill the selects in place rather than re-rendering it — a
      // re-render would throw away any rate already typed.
      _refreshPriceSelects();
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

  /* ── Consignee — free-text input + suggestion dropdown over the export
     team's own buyer master (the fetch_consignee tab of "PI Export (Final)";
     this app has no Buyer/Customer master of its own). Picking one fills the
     rest of the consignee block and the ports, all of which used to be copied
     by hand off an older PI. Buyers seen on past PIs but missing from that
     sheet still show up underneath, name only. ─────────────────────────── */
  function _buyerField() {
    return _fieldWrap('Consignee Name', ''
      + '<input type="text" id="pic-buyer" autocomplete="off" placeholder="M/s. …" style="' + _inputStyle + '" />'
      + '<div id="pic-buyer-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:260px;overflow-y:auto;"></div>');
  }

  function _buyerKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  // The master first, then any past-PI buyer it does not already cover.
  function _buyerMatches(q) {
    const hit = (name) => !q || name.toLowerCase().includes(q);
    const inMaster = new Set(_consignees.map(c => _buyerKey(c.name)));
    return _consignees.filter(c => hit(c.name))
      .concat(_recentBuyers.filter(b => !inMaster.has(_buyerKey(b)) && hit(b)).map(b => ({ name: b, recent: true })));
  }

  // Address and Tel./Email belong to the buyer as one block, so they are
  // replaced outright — otherwise switching from a two-line address to a
  // one-line one leaves the previous buyer's second line behind.
  //
  // Port of Discharge and Place of Delivery both come from the buyer — that is
  // where their goods land and where they take delivery, and neither changes
  // much shipment to shipment. Port of Loading deliberately does not: that is
  // ours to choose, and it stays on its own dropdown.
  function _fillFromConsignee(c) {
    const put = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    put('pic-buyer-addr1', c.address1);
    put('pic-buyer-addr2', c.address2);
    put('pic-buyer-contact', c.contact);
    if (c.portOfDischarge) put('pic-port-discharge', c.portOfDischarge);
    // A dropdown, so it takes a forced selection rather than an assignment —
    // and _fillShippingSelect adds an option for a value the master's own list
    // does not already carry.
    if (c.placeOfDelivery) _fillShippingSelect('pic-place-delivery', _optionsFor('placeOfDelivery'), '', c.placeOfDelivery);
    // Terms of Payment is a dropdown now, so a value has to go in as a forced
    // selection rather than an assignment. (The master's own column is empty
    // top to bottom today; this is here for the day it is not.)
    if (c.paymentTerms) _fillShippingSelect('pic-payment-terms', _optionsFor('paymentTerms'), '', c.paymentTerms);
  }

  /* ── The three shipping fields — dropdowns over the values the consignee
     master already uses, so a PI cannot invent a 4th spelling of DAMMAM.
     "Other…" is still there for a destination the company has not shipped to
     before; it reveals a text box beside the select. ──────────────────── */
  const _OTHER = '__other__';
  // The fields the buyer wants picked from a list rather than typed. Port of
  // Discharge is NOT one of them — it fills in from the consignee and stays a
  // plain text box with suggestions, because it is the one that genuinely
  // varies per shipment (see _dischargeField below).
  const _SHIP_FIELDS = [
    { id: 'pic-payment-terms', key: 'paymentTerms' },
    { id: 'pic-port-loading',  key: 'portOfLoading' },
    { id: 'pic-place-delivery', key: 'placeOfDelivery' },
  ];

  // Free text with suggestions, not a dropdown: this one is filled in from the
  // consignee when a buyer is picked, and still has to be typeable over for a
  // shipment going somewhere the buyer does not normally receive at.
  function _dischargeField() {
    return _fieldWrap('Port of Discharge',
      '<input type="text" id="pic-port-discharge" list="pic-port-discharge-list" autocomplete="off" placeholder="e.g. JEBEL ALI" style="' + _inputStyle + '" />'
      + '<datalist id="pic-port-discharge-list"></datalist>'
      + '<div style="font-size:11px;color:#94a3b8;margin-top:5px;">Fills in from the consignee — type over it for a one-off destination.</div>');
  }

  function _selectField(id, label) {
    return _fieldWrap(label,
      '<select id="' + id + '" style="' + _inputStyle + 'background:#fff;cursor:pointer;">'
        + '<option value="">Select…</option>'
      + '</select>'
      + '<input type="text" id="' + id + '-other" placeholder="Type the new one" style="' + _inputStyle + 'margin-top:8px;display:none;" />');
  }

  // Options arrive with the masters, i.e. after the form is already on screen,
  // so the selects are (re)filled rather than rendered complete. Whatever is
  // already chosen survives the refill — a date change reloads the masters and
  // must not reset a half-filled form.
  // `forced` is for a revision loading the parent's own choice: without it the
  // Port of Loading default already sitting in the select would win, since a
  // refill otherwise keeps whatever is selected.
  function _fillShippingSelect(id, values, fallback, forced) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const keep = forced || ((sel.value && sel.value !== _OTHER) ? sel.value : (fallback || ''));
    const all = (keep && !values.includes(keep)) ? values.concat([keep]) : values;
    sel.innerHTML = '<option value="">Select…</option>'
      + all.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('')
      + '<option value="' + _OTHER + '">Other…</option>';
    sel.value = keep;
  }

  // Payment terms come straight off the boilerplate (pi-format.js), the two
  // location lists off the consignee master — see _piShippingOptions.
  function _optionsFor(key) {
    if (key === 'paymentTerms') return (_defaults && _defaults.paymentTermsOptions) || [];
    return _shippingOptions[key] || [];
  }

  function _applyShippingOptions() {
    _SHIP_FIELDS.forEach(f => _fillShippingSelect(
      f.id,
      _optionsFor(f.key),
      // Port of Loading is the one with a house default ("Mundra Port").
      f.key === 'portOfLoading' && _defaults ? _defaults.portOfLoading : '',
    ));
    _fillDischargeList();
  }

  /* ── Term 3's dispatch-days blank ───────────────────────────────────────
     Matches the blank AND whatever was put in it last, so the number can be
     changed as often as the user likes. Kept in step with SHIPMENT_DAYS_RE in
     backend/lib/pi-format.js, which is where the sentence itself lives. */
  const _SHIPMENT_DAYS_RE = /(SHIPMENT TO BE DISPATCHED\s+)(\S+)(\s+DAYS\b)/i;

  function _applyShipmentDays() {
    const daysEl = document.getElementById('pic-shipment-days');
    const termsEl = document.getElementById('pic-terms');
    if (!daysEl || !termsEl) return;
    const days = daysEl.value.trim();
    termsEl.value = termsEl.value.split('\n').map(line => (
      _SHIPMENT_DAYS_RE.test(line) ? line.replace(_SHIPMENT_DAYS_RE, '$1' + (days || '____') + '$3') : line
    )).join('\n');
  }

  // Port of Discharge stays a text input; the master's values just ride along
  // as a datalist so the common ones are one keystroke away.
  function _fillDischargeList() {
    const list = document.getElementById('pic-port-discharge-list');
    if (!list) return;
    list.innerHTML = (_shippingOptions.portOfDischarge || [])
      .map(v => '<option value="' + esc(v) + '"></option>').join('');
  }

  function _bindShippingSelects() {
    _SHIP_FIELDS.forEach(f => {
      const sel = document.getElementById(f.id);
      const other = document.getElementById(f.id + '-other');
      if (!sel || !other) return;
      sel.addEventListener('change', () => {
        const on = sel.value === _OTHER;
        other.style.display = on ? 'block' : 'none';
        if (on) other.focus(); else other.value = '';
      });
    });
  }

  // "Other…" hands the value over to the text box beside the select.
  function _shippingVal(id) {
    const sel = document.getElementById(id);
    if (!sel) return '';
    if (sel.value !== _OTHER) return sel.value.trim();
    const other = document.getElementById(id + '-other');
    return other ? other.value.trim() : '';
  }

  function _bindBuyerField() {
    const input = document.getElementById('pic-buyer');
    const dd = document.getElementById('pic-buyer-dd');
    if (!input || !dd) return;
    let matches = [];
    const showMatches = () => {
      matches = _buyerMatches(input.value.trim().toLowerCase()).slice(0, 30);
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map((c, i) => {
        // Where the goods go and how they get there — enough to tell two
        // similarly named establishments apart at a glance.
        const sub = c.recent ? 'From an earlier PI' : [c.placeOfDelivery, [c.portOfLoading, c.portOfDischarge].filter(Boolean).join(' → ')].filter(Boolean).join(' · ');
        return '<div class="pic-buyer-opt" style="padding:7px 12px;cursor:pointer;" data-i="' + i + '">'
          + '<div style="font-size:12.5px;color:#1e293b;">' + esc(c.name) + '</div>'
          + (sub ? '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">' + esc(sub) + '</div>' : '')
        + '</div>';
      }).join('');
      const rect = input.getBoundingClientRect();
      dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = rect.width + 'px';
      dd.style.display = 'block';
    };
    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.pic-buyer-opt');
      if (!opt) return;
      const c = matches[Number(opt.dataset.i)];
      if (!c) return;
      input.value = c.name;
      if (!c.recent) _fillFromConsignee(c);
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
    + '<p style="font-size:11.5px;color:#94a3b8;margin:8px 2px 0;">Pick a Model No. and the name, size, SWG, packing and photo fill in from the product master; Total Box, CBM and Weight are then worked out from Qty. Type over any of them to override. The rate, its basis and its currency are added later by an authorized user.</p>';
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

  /* ── Revision — the Create tab, pre-filled from the PI being re-issued ──
     The buyer asked for changes, so everything starts as it was and only what
     they asked about gets touched. ────────────────────────────────────── */
  // What the auto-assigned number field shows. While revising, the next NEW
  // PI number is the wrong answer — the revision keeps its parent's number.
  // A preview either way: the server assigns the real one at submit.
  function _piNoDisplay() {
    if (!_reviseOf) return _nextPiNumber || 'Loading…';
    const m = /^(.*?)\s+R(\d+)$/i.exec(_reviseOf.piNo);
    return m ? m[1] + ' R' + (parseInt(m[2], 10) + 1) : _reviseOf.piNo + ' R1';
  }

  function _startRevise(row) {
    _reviseOf = { piNo: row.piNo, status: row.status };
    _view = 'create';
    renderPage();
    _prefillForm(row.form || {});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _cancelRevise() {
    _reviseOf = null;
    _view = 'create';
    renderPage();
  }

  function _prefillForm(form) {
    const put = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
    put('pic-date', form.date || _today());
    put('pic-order-no', form.orderNo);
    put('pic-port-discharge', form.portOfDischarge);
    put('pic-target-date', form.targetDate);
    put('pic-buyer', form.buyerName);
    put('pic-buyer-trn', form.buyerTrn);
    put('pic-buyer-addr1', form.buyerAddress1);
    put('pic-buyer-addr2', form.buyerAddress2);
    put('pic-buyer-contact', form.buyerContact);
    put('pic-origin', form.countryOfOrigin);
    put('pic-shipment-note', form.shipmentNote);
    put('pic-validity', form.validity);
    put('pic-terms', (form.terms || []).join('\n'));
    // Lift the parent's dispatch days back into their own box, so changing
    // them on the revision is one edit rather than a hunt through the terms.
    const daysEl = document.getElementById('pic-shipment-days');
    const daysMatch = _SHIPMENT_DAYS_RE.exec((form.terms || []).join('\n'));
    if (daysEl && daysMatch && !/^_+$/.test(daysMatch[2])) daysEl.value = daysMatch[2];
    const decl = document.getElementById('pic-declaration');
    if (decl) decl.checked = form.includeDeclaration !== false;

    // The parent's ports may pre-date the dropdowns (or be spelled a way the
    // master no longer lists), so they are passed as the value to keep —
    // _fillShippingSelect adds an option for anything it does not already have.
    _SHIP_FIELDS.forEach(f => _fillShippingSelect(f.id, _optionsFor(f.key), '', form[f.key] || ''));
    _fillDischargeList();

    const noEl = document.getElementById('pic-next-no');
    if (noEl) noEl.textContent = _piNoDisplay();

    _prefillItems(Array.isArray(form.items) ? form.items : []);
  }

  function _prefillItems(items) {
    const tbody = document.getElementById('pic-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = (items.length ? items : [null]).map(() => _itemRowHtml()).join('');
    Array.from(tbody.querySelectorAll('.pic-item-row')).forEach((row, i) => {
      const it = items[i];
      if (it) {
        _ITEM_COLS.forEach(c => {
          const el = row.querySelector('[data-field="' + c.field + '"]');
          if (el) el.value = it[c.field] ?? '';
        });
        row.querySelector('[data-field="imageUrl"]').value = it.imageUrl || '';
        const thumb = row.querySelector('.pic-item-thumb');
        if (thumb) {
          thumb.innerHTML = it.imageUrl
            ? '<img src="' + esc(it.imageUrl) + '" alt="" onerror="this.remove()" style="max-width:44px;max-height:40px;object-fit:contain;border-radius:4px;" />'
            : '<span style="font-size:10px;color:#cbd5e1;">no photo</span>';
        }
        // Back out the per-box CBM and per-piece weight the parent's own
        // numbers imply, so changing Qty — far and away the commonest reason a
        // buyer asks for a revision — still re-derives Box/CBM/Weight instead
        // of leaving the old PI's figures behind.
        const qty = _num(it.qty), boxes = _num(it.boxes), cbm = _num(it.cbm), weight = _num(it.weight);
        if (boxes > 0 && cbm > 0) row.dataset.cbmPerBox = String(cbm / boxes);
        if (qty > 0 && weight > 0) row.dataset.weightPerPc = String(weight / qty);
      }
      _bindItemRow(row);
    });
  }

  function _reviseBannerHtml() {
    if (!_reviseOf) return '';
    return '<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">'
      + '<div style="flex:1;">'
        + '<div style="font-size:13px;font-weight:700;color:#1e40af;">Revising ' + esc(_reviseOf.piNo) + '</div>'
        + '<div style="font-size:12px;color:#3b6fc4;margin-top:2px;">Saving issues the next revision of this same number. '
          + esc(_reviseOf.piNo) + ' is marked Superseded and keeps its own PDF as the record of what was first offered'
          + (_reviseOf.status === 'Priced' ? '. Rates carry over for every line you leave unchanged; a new or re-specced line comes through unpriced.' : '.')
        + '</div>'
      + '</div>'
      + '<button type="button" id="pic-revise-cancel" style="padding:6px 12px;border-radius:8px;background:#fff;border:1.5px solid #bfdbfe;color:#1e40af;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">Start a new PI instead</button>'
    + '</div>';
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
    // Target Date is not printed on the PI — it goes to the export team's
    // follow-up tracker, which wants a date to chase against. Optional; blank
    // just leaves that cell for the team. The tracker's owner column is no
    // longer asked for either: every PI opens against FMS_TRACKER's
    // defaultAssignee (see backend/lib/pi-format.js).
    return '<div style="' + _grid + '">'
      + _textField('pic-date', 'PI Date', { type: 'date', value: _today() })
      + _readonlyField('pic-next-no', _reviseOf ? 'Pro. Invoice No. (revision)' : 'Pro. Invoice No. (auto-assigned)', _piNoDisplay())
      + _textField('pic-order-no', 'Order No.', { placeholder: 'Buyer order reference' })
      + _selectField('pic-payment-terms', 'Terms of Payment')
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
      + _selectField('pic-port-loading', 'Port of Loading')
      + _dischargeField()
      + _selectField('pic-place-delivery', 'Place of Delivery')
      + _textField('pic-origin', 'Country of Origin of Goods', { value: _defaults ? _defaults.countryOfOrigin : '' })
      + _textField('pic-shipment-note', 'Shipment / Container Note', { value: _defaults ? _defaults.shipmentNote : '' })
    + '</div>';
  }

  function _footerFieldsHtml() {
    return '<div style="' + _grid + '">'
      + _textField('pic-validity', 'Price Validity', { value: _defaults ? _defaults.validity : '', placeholder: 'e.g. 03 WORKING DAYS' })
      // Term 3 reads "…DISPATCHED ____ DAYS FROM RECEIPT OF CONFIRMATION AND
      // ADVANCE PAYMENT." — this box is what fills the blank. It writes
      // straight into the terms below rather than being spliced in at submit,
      // so the textarea stays exactly what the buyer will read.
      + _fieldWrap('Shipment in (days)',
          '<input type="text" id="pic-shipment-days" inputmode="numeric" autocomplete="off" placeholder="e.g. 45" style="' + _inputStyle + '" />'
          + '<div style="font-size:11px;color:#94a3b8;margin-top:5px;">Fills the blank in term 3 below.</div>')
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
    // "SHIPMENT TO BE DISPATCHED ____ DAYS" going out to a buyer as-is is a
    // visible defect, so the blank has to be filled or the line removed.
    const termsText = val('pic-terms');
    if (/SHIPMENT TO BE DISPATCHED\s+_+\s+DAYS/i.test(termsText)) {
      Utils.showToast('Fill in Shipment in (days) — term 3 still has a blank in it', 'error');
      document.getElementById('pic-shipment-days')?.focus();
      return;
    }
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }
    if (items.length > _maxItems) { Utils.showToast('The PI template holds ' + _maxItems + ' item rows — this PI has ' + items.length, 'error'); return; }

    const payload = {
      date, buyerName, items,
      orderNo: val('pic-order-no'),
      paymentTerms: _shippingVal('pic-payment-terms'),
      buyerTrn: val('pic-buyer-trn'),
      buyerAddress1: val('pic-buyer-addr1'),
      buyerAddress2: val('pic-buyer-addr2'),
      buyerContact: val('pic-buyer-contact'),
      portOfLoading: _shippingVal('pic-port-loading'),
      portOfDischarge: val('pic-port-discharge'),
      placeOfDelivery: _shippingVal('pic-place-delivery'),
      countryOfOrigin: val('pic-origin'),
      shipmentNote: val('pic-shipment-note'),
      validity: val('pic-validity'),
      targetDate: document.getElementById('pic-target-date').value,
      terms: val('pic-terms').split('\n').map(t => t.trim()).filter(Boolean),
      includeDeclaration: document.getElementById('pic-declaration').checked,
    };

    const revising = _reviseOf;
    const url = revising
      ? '/api/proforma-invoice/revise?piNo=' + encodeURIComponent(revising.piNo)
      : '/api/proforma-invoice';

    const btn = document.getElementById('pic-submit-btn');
    btn.disabled = true; btn.textContent = revising ? 'Issuing revision…' : 'Creating…';
    try {
      const result = await Utils.apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
      const warnings = [];
      if (!result.pdfLink) warnings.push('PDF export failed');
      if (result.fmsTracked === false) warnings.push('Export Marketing FMS row not added');
      if (revising) {
        // Whether the rates survived decides what happens next, so it is said
        // outright rather than left to be discovered on the list.
        Utils.showToast('PI ' + result.piNumber + ' issued — ' + revising.piNo + ' is now Superseded'
          + (warnings.length ? ' (' + warnings.join('; ') + ')' : '')
          + (result.status === 'Priced' ? '. Rates carried over.' : '. Needs pricing.'),
          warnings.length ? 'warning' : 'success');
        _reviseOf = null;
        _view = 'list';
      } else {
        Utils.showToast('PI ' + result.piNumber + ' created'
          + (warnings.length ? ' — ' + warnings.join('; ') + ' (PI itself is saved)' : ' — PDF saved to Drive, FMS row opened'),
          warnings.length ? 'warning' : 'success');
      }
      await _loadMasters(date);
      renderPage();
    } catch (err) {
      Utils.showToast(err.message || (revising ? 'Failed to issue the revision' : 'Failed to create Proforma Invoice'), 'error');
      btn.disabled = false; btn.textContent = revising ? 'Issue Revision' : 'Create Proforma Invoice';
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
      // Not dead like a cancelled PI — replaced by its own revision, and still
      // the record of what was offered before that.
      Superseded: 'background:#eff6ff;color:#1e40af;',
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
        // Not every PI is in the same currency any more, so the column
        // says which one rather than assuming US$ in its header.
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;white-space:nowrap;">'
          + (r.status === 'Priced'
            ? esc(r.total) + ' <span style="color:#94a3b8;font-size:11px;">' + esc(_currencyLabel((r.form && r.form.currency) || _priceDefault.currency)) + '</span>'
            : '<span style="color:#cbd5e1;">—</span>')
        + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + (r.pdfLink ? '<a href="' + esc(r.pdfLink) + '" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">View PDF</a>' : '<span style="color:#cbd5e1;">—</span>') + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
          + (r.status !== 'Cancelled' && r.canSetPrice
            ? '<button type="button" class="pic-price-btn" data-pi="' + esc(r.piNo) + '" style="border:1.5px solid var(--color-primary);background:#fff;color:var(--color-primary);cursor:pointer;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:7px;margin-right:6px;">' + (r.status === 'Priced' ? 'Edit Price' : 'Add Price') + '</button>'
            : '')
          // The buyer came back with changes: re-issue as R1, R2… rather than
          // editing a PI they already hold a copy of.
          + (r.canRevise && r.form
            ? '<button type="button" class="pic-revise-btn" data-pi="' + esc(r.piNo) + '" style="border:1.5px solid #bfdbfe;background:#fff;color:#1e40af;cursor:pointer;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:7px;margin-right:6px;">Revise</button>'
            : '')
          + (r.status === 'Cancelled'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
            : r.status === 'Superseded'
            ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#eff6ff;color:#1e40af;font-size:11px;font-weight:600;">Revised</span>'
            : '<button type="button" class="pic-cancel-btn" data-pi="' + esc(r.piNo) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
          + Utils.ownerDeleteBtn('pic-delete-btn', 'pi', r.piNo)
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
      const delBtn = e.target.closest('.pic-delete-btn');
      if (delBtn) {
        const piNo = delBtn.dataset.pi;
        // Worth spelling out here: the next PI number comes off the highest
        // one still on the log, so deleting the latest hands its number to the
        // next PI raised — while its PDF may already be with the buyer.
        if (!(await Utils.ownerDeleteConfirm('PI ' + piNo + ' (its number can then be re-issued to a new PI)'))) return;
        try {
          await Utils.apiFetch('/api/proforma-invoice?piNo=' + encodeURIComponent(piNo), { method: 'DELETE' });
          Utils.showToast('PI ' + piNo + ' deleted', 'success');
          await _pilLoad();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to delete', 'error');
        }
        return;
      }
      const reviseBtn = e.target.closest('.pic-revise-btn');
      if (reviseBtn) {
        const row = _pilRows.find(r => String(r.piNo) === reviseBtn.dataset.pi);
        if (!row || !row.form) { Utils.showToast('This PI has no saved detail to revise from', 'error'); return; }
        _startRevise(row);
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
            + ['Pro. Invoice No', 'Date', 'Consignee', 'Status', 'Total', 'PDF', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="pil-body"><tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>'
      + '<div id="pi-price-modal"></div>';
  }

  /* ── Add Price modal — lists the PI's own stored items (read-only
     model/name/size/qty from Form JSON) with a per-piece rate input per
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

  /* ── Add Price: the two things that decide how the whole PI reads ────── */
  // "US$" is what the sheet prints for USD; the rest print their own code.
  // Kept in step with CURRENCIES in backend/lib/pi-format.js, which is what
  // actually writes the headers.
  const _CURRENCY_LABELS = { INR: 'INR', USD: 'US$', GBP: 'GBP', SAR: 'SAR', KWD: 'KWD', EUR: 'EUR' };
  function _currencyLabel(code) { return _CURRENCY_LABELS[code] || code || ''; }

  // Repopulates the two selects once the lists arrive, keeping whatever is
  // selected. A no-op when the modal is closed or the options are already in.
  function _refreshPriceSelects() {
    [['pipm-price-type', _priceTypes], ['pipm-currency', _currencies]].forEach(([id, values]) => {
      const sel = document.getElementById(id);
      if (!sel || !values.length || sel.options.length === values.length) return;
      const keep = sel.value;
      sel.innerHTML = values.map(v => '<option value="' + esc(v) + '"' + (v === keep ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
      sel.value = keep;
    });
  }

  function _priceSelectHtml(id, label, values, selected) {
    // A list that has not loaded yet must still show what the PI is on, or
    // saving would quietly change it.
    const opts = (values && values.length ? values : [selected]).filter(Boolean);
    return '<div>'
      + '<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">' + esc(label) + '</div>'
      + '<select id="' + id + '" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;background:#fff;cursor:pointer;outline:none;">'
        + opts.map(v => '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>').join('')
      + '</select>'
    + '</div>';
  }

  function _renderPriceModal() {
    const modal = document.getElementById('pi-price-modal');
    if (!modal) return;
    if (!_priceModalRow) { modal.innerHTML = ''; return; }
    const row = _priceModalRow;
    const form = row.form || {};
    const items = Array.isArray(form.items) ? form.items : [];
    // A PI already priced re-opens on what it was priced in; a fresh one on
    // the house default.
    const priceType = form.priceType || _priceDefault.priceType;
    const currency = form.currency || _priceDefault.currency;

    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="pipm-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:820px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
        + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
          + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + (row.status === 'Priced' ? 'Edit Price' : 'Add Price') + ' — PI ' + esc(row.piNo) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">' + esc(row.buyer) + '</div></div>'
          + '<button id="pipm-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
          + '</button>'
        + '</div>'
        + '<div style="padding:22px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px;">'
          // Basis and currency come first because everything under them is
          // read in those terms — and because they relabel the PI itself, not
          // just this screen.
          + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
            + _priceSelectHtml('pipm-price-type', 'Price Type', _priceTypes, priceType)
            + _priceSelectHtml('pipm-currency', 'Currency', _currencies, currency)
          + '</div>'
          + '<div id="pipm-price-note" style="font-size:11.5px;color:#94a3b8;margin:-8px 2px 0;">The PI prints these: “' + esc(priceType + ' ' + _currencyLabel(currency)) + ' Per Pc” on the rate column, and the total and amount in words to match.</div>'
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:740px;">'
              + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
                // Total Weight rides along for reference only — it is not
                // printed on the PI (see printHiddenCols in pi-format.js), but
                // it is what the rate is usually sanity-checked against.
                // The last two follow the dropdowns above, so this screen
                // reads the same way the printed PI will.
                + ['Photo', 'Model No.', 'Item Name', 'Size', 'Total Qty', 'Total Weight (Kgs)'].map(h => '<th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
                + '<th id="pipm-rate-head" style="padding:7px 8px;text-align:left;font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(priceType + ' ' + _currencyLabel(currency) + ' Per Pc') + '</th>'
                + '<th id="pipm-amount-head" style="padding:7px 8px;text-align:left;font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc('Amount (' + _currencyLabel(currency) + ')') + '</th>'
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
                  + '<td style="padding:6px 8px;font-size:12.5px;color:#64748b;text-align:right;">' + esc(it.weight || '—') + '</td>'
                  + '<td style="padding:6px 8px;"><input type="text" inputmode="decimal" class="pipm-rate" value="' + esc(it.rate || '') + '" placeholder="0.000" style="width:110px;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;text-align:right;" /></td>'
                  + '<td class="pipm-amount" style="padding:6px 8px;font-size:12.5px;color:#64748b;text-align:right;">0.00</td>'
                + '</tr>').join('')
              + '</tbody>'
            + '</table>'
          + '</div>'
          + '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">'
            + '<div><span id="pipm-total-cap" style="font-size:12.5px;font-weight:700;color:#64748b;">' + esc('Total ' + priceType + ' ' + _currencyLabel(currency)) + ' </span><span style="font-size:17px;font-weight:800;color:#0f172a;"><span id="pipm-total">0.00</span></span></div>'
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
    // Relabel in place rather than re-rendering — a re-render would throw away
    // the rates already typed in.
    const relabel = () => {
      const t = document.getElementById('pipm-price-type').value;
      const c = _currencyLabel(document.getElementById('pipm-currency').value);
      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set('pipm-rate-head', t + ' ' + c + ' Per Pc');
      set('pipm-amount-head', 'Amount (' + c + ')');
      set('pipm-total-cap', 'Total ' + t + ' ' + c + ' ');
      set('pipm-price-note', 'The PI prints these: “' + t + ' ' + c + ' Per Pc” on the rate column, and the total and amount in words to match.');
    };
    ['pipm-price-type', 'pipm-currency'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', relabel);
    });
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
        body: JSON.stringify({
          items,
          priceType: document.getElementById('pipm-price-type').value,
          currency: document.getElementById('pipm-currency').value,
        }),
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
        + _reviseBannerHtml()
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
        + '<button type="submit" id="pic-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">' + (_reviseOf ? 'Issue Revision' : 'Create Proforma Invoice') + '</button>'
      + '</form>';

    el.innerHTML = '<div style="max-width:' + (isList ? '1200px' : '1180px') + ';margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">Proforma Invoice / OCS</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Export PI. Create captures consignee, shipping &amp; items only — the rate, its basis and its currency are added afterward by an authorized user.</p>'
      + '</div>'
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    // Switching to Create by hand means a NEW PI — a half-finished revision
    // must not silently ride along on the tab the user thinks is blank.
    document.querySelector('.pic-create-tab').addEventListener('click', () => { _reviseOf = null; _view = 'create'; renderPage(); });
    document.querySelector('.pic-list-tab').addEventListener('click', () => { _view = 'list'; renderPage(); });

    // Both views need the masters, not just Create: the Add Price screen opens
    // off the LIST, and its Price Type / Currency dropdowns are filled from
    // them. Loading it only on Create left both dropdowns showing nothing but
    // the value the PI already had. Every field _loadMasters() touches is
    // looked up by id and skipped when absent, so it is safe on either view.
    if (!_mastersLoaded) _loadMasters(_today());

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

    const shipDays = document.getElementById('pic-shipment-days');
    if (shipDays) shipDays.addEventListener('input', _applyShipmentDays);

    const reviseCancel = document.getElementById('pic-revise-cancel');
    if (reviseCancel) reviseCancel.addEventListener('click', _cancelRevise);

    _bindBuyerField();
    _bindShippingSelects();
    // The masters may already be in hand from an earlier render, in which case
    // _loadMasters() below does not run and these selects would stay empty.
    _applyShippingOptions();
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
