window.Pages = window.Pages || {};

// ── Export Documentation ─────────────────────────────────────────────────────
// The export team fills ONE form — the Custom Invoice (plus the container/
// stuffing details that ride along with a shipment) — and every other customs
// document is generated from it: Packing List, Annexure (Examination Report
// for self-sealed container), DBK Drawback Declaration and the VGM sheet.
// The LUT (GST RFD-11) itself is filed on the GST portal once a year; only its
// ARN number and date are printed on the documents, so they sit here as
// prefilled defaults that are updated once per financial year.
//
// Records live in the app DB (export_shipments — see server.js), one row per
// shipment, the whole form saved as JSON so a document can be reprinted or
// corrected at any time.
window.Pages['export-documentation'] = (() => {

  /* ── permission helper — same shape as consignee-master.js ────────────── */
  function _hasFeature(feat) {
    const roles = window.currentUser?.roles || [];
    const isAdmin = Array.isArray(roles)
      ? (roles.includes('Admin') || roles.includes('HOD'))
      : (String(roles).includes('Admin') || String(roles).includes('HOD'));
    if (isAdmin) return true;
    const perms = window.currentUser?.permissions;
    if (!perms || !perms.features) return true;
    const pageFeats = perms.features['export-documentation'];
    if (!pageFeats) return false;
    return pageFeats.includes(feat);
  }

  /* ── company constants — printed on every document ────────────────────── */
  const COMPANY = {
    name: 'LALLUBHAI AMICHAND LIMITED',
    shortName: 'LALLUBHAI AMICHAND LTD',
    addr1: '175/3, Ghodasar Village, Near G.I.D.C.',
    addr2: 'Vatva, Ahmedabad-382445 (Gujarat)',
    country: 'India.',
    dbkAddr: '175/2, VILLAGE GHODSAR, NEAR GIDC VATVA, VATVA, AHMEDABAD - 382445.',
    gstNo: '24AAACL0829R1Z9',
    iecNo: '0388049201',
    panNo: 'AAACL0829R',
    cinNo: 'U51420MH1948PLC006816',
    forexAc: '05442020000080',
    adCode: '0510001-6000009,',
    bankName: 'HDFC BANK LTD',
    works: 'Works: 175/3, Ghodasar Village, Near G.I.D.C., Vatva-Ahmedabad, Gujarat, India',
  };

  /* ── per-shipment defaults (editable on the form) ─────────────────────── */
  const DEFAULTS = {
    consignee: 'TO ORDER',
    buyer: 'TO ORDER',
    deliveryTerms: 'C&F',
    paymentTerms: 'T.T.',
    lutArnNo: 'AD2404260126682',
    lutArnDate: '08.4.2026',
    vessel: 'BY SEA',
    portOfLoading: 'MUNDRA/INDIA',
    countryOrigin: 'INDIA',
    hsnCode: '76151030',
    itemDescription: 'TABLE KITCHEN AND OTHER HOUSEHOLD ARTICLES MADE OF ALUMINIUM (OTHER THAN THOSE COVERED UNDER SION AT C-1749)- 1050 GRADE-UTENSILS HSN CODE 76151030',
    remarks: 'RODTEP DECLARATION RD001',
    containerSize: '40 FT',
    containerSizeText: "1x40'  FCL",
    maxPermissibleWt: '32500.00',
    weighbridge: 'PERFECT WEIGH BRIDGE',
    weighingMethod: 'Method-2',
    cargoType: 'NORMAL',
    unNo: 'N/A',
    signatoryName: 'NIMESH M SHAH',
    signatoryDesignation: 'ADM MANAGER',
    signatoryContact: '9824088243/7878772005',
    fspNo: 'VIII-48-768/FS/MP & SEZ/10-11 DT.28.01.2011',
    stuffingTimeFrom: '2.0PM',
    stuffingTimeTo: '6.0PM',
  };

  const _blankItem = () => ({
    invItem: 'UTENSILS', itemName: '', scheme: 'DBK/RDT', productCode: '', size: '',
    qty: '', uom: 'PCS', rate: '', cartonFrom: '', cartonTo: '', pcsPerCarton: '', ntWtPerCarton: '',
  });

  // Dates print exactly as typed, and their own documents write them d.M.yyyy
  // ("21.8.2026") — so that is what the automatic date fills in.
  function _todayStr() {
    const t = new Date();
    return t.getDate() + '.' + (t.getMonth() + 1) + '.' + t.getFullYear();
  }

  function _blankForm() {
    return Object.assign({
      invoiceNo: '', invoiceDate: _todayStr(), buyersOrderNo: '', exportersRef: '', otherRef: '',
      consigneeName: '', consigneeAddress: '', consigneeTel: '', consigneeCr: '',
      preCarriage: '', placeOfReceipt: '', portOfDischarge: '', placeOfDelivery: '', countryFinal: '',
      swg: '', totalGrossWt: '', vehicleNo: '', containerNo: '', lrNo: '', lrDate: '',
      exchRate: '', freightUsd: '', shippingMarks: '',
      bookingNo: '', shippingLineSealNo: '', customSealNo: '',
      stuffingDate: '', containerTareWt: '', weighingDate: '', weighingTime: '', weighingSlipNo: '',
    }, DEFAULTS);
  }

  /* ── state ────────────────────────────────────────────────────────────── */
  let _view = 'form';           // 'form' | 'list'
  let _rows = [];
  let _loaded = false;
  let _loadError = '';
  let _q = '';
  let _saving = false;
  let _editingId = null;        // null = creating new
  let _form = _blankForm();
  let _items = [_blankItem()];
  let _plList = null;           // packing lists from /api/packing-list/list (null = not fetched yet)
  let _plLoading = false;
  let _plSelected = '';

  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const money = (n) => n.toFixed(2);
  const wt = (n) => n.toFixed(3);

  /* ── derived figures — the single place every document computes from ──── */
  function _calc() {
    let totalQty = 0, totalCf = 0, totalTaxable = 0, totalCartons = 0, totalNetWt = 0;
    const exch = num(_form.exchRate);
    const items = _items.map((it) => {
      const qty = num(it.qty);
      const rate = num(it.rate);
      const amount = qty * rate;
      const taxable = amount * exch;
      const from = num(it.cartonFrom), to = num(it.cartonTo);
      const cartons = (to >= from && to > 0) ? (to - from + 1) : 0;
      const netWt = cartons * num(it.ntWtPerCarton);
      totalQty += qty; totalCf += amount; totalTaxable += taxable;
      totalCartons += cartons; totalNetWt += netWt;
      return Object.assign({}, it, { amount, taxable, cartons, netWt });
    });
    const freight = num(_form.freightUsd);
    const fob = totalCf - freight;
    const fobInr = fob * exch;
    const grossWt = num(_form.totalGrossWt);
    const vgm = grossWt + num(_form.containerTareWt);
    return { items, totalQty, totalCf, totalTaxable, totalCartons, totalNetWt, freight, fob, fobInr, grossWt, vgm, exch };
  }

  /* ── number → words (US dollars style: "SEVENTY SIX THOUSAND …") ─────── */
  const _ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const _TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  function _below1000(n) {
    let s = '';
    if (n >= 100) { s += _ONES[Math.floor(n / 100)] + ' HUNDRED'; n %= 100; if (n) s += ' '; }
    if (n >= 20) { s += _TENS[Math.floor(n / 10)]; n %= 10; if (n) s += ' ' + _ONES[n]; }
    else if (n > 0) { s += _ONES[n]; }
    return s;
  }
  function _numWords(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'ZERO';
    const parts = [];
    const scales = [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND']];
    for (const [div, label] of scales) {
      if (n >= div) { parts.push(_below1000(Math.floor(n / div)) + ' ' + label); n %= div; }
    }
    if (n > 0) parts.push(_below1000(n));
    return parts.join(' ');
  }
  function _usdWords(amount, prefix) {
    const intPart = Math.floor(amount);
    const cents = Math.round((amount - intPart) * 100);
    let s = (prefix ? prefix + ' ' : '') + 'US DOLLARS ' + _numWords(intPart);
    if (cents > 0) s += ' AND CENTS ' + _numWords(cents);
    return s + ' ONLY';
  }

  /* ── Packing List connection ──────────────────────────────────────────────
     The export team already raises its Packing Lists in the app (Proforma
     Invoice → Packing List, logged to the "ERP Packing List Log"). Picking one
     here pulls the order numbers, consignee, container and every item/carton
     line straight from it — the custom invoice form starts filled instead of
     retyped. Prices, exchange rate and the stuffing details stay manual (the
     packing list never had them). */
  let _plError = '';
  async function _loadPLs(force) {
    if ((_plList !== null && !force) || _plLoading) return;
    _plLoading = true;
    _plError = '';
    try {
      const data = await Utils.apiFetch('/api/packing-list/list');
      _plList = Array.isArray(data) ? data.filter(p => (p.status || 'Open') !== 'Cancelled') : [];
    } catch (e) {
      // A failed fetch must not be remembered as "no packing lists" — keep it
      // null so the next render (or the Retry button) tries again.
      _plList = null;
      _plError = e.message || 'Failed to load packing lists';
    } finally {
      _plLoading = false;
      // Only the picker needs repainting — a full render would wipe anything
      // already typed into the form.
      const slot = document.getElementById('ed-pl-picker');
      if (slot) { const fresh = document.createElement('div'); fresh.innerHTML = _plPickerHtml(); slot.replaceWith(fresh.firstElementChild); }
    }
  }

  function _plPickerHtml() {
    let inner;
    const retryBtn = '<button type="button" id="ed-pl-retry" style="padding:6px 14px;border:1px solid #bfdbfe;border-radius:8px;background:#fff;color:#1d4ed8;font-size:12px;font-weight:700;cursor:pointer;">Retry</button>';
    if (_plError) {
      inner = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
        + '<span style="font-size:12px;color:#b91c1c;">Packing lists could not be loaded: ' + esc(_plError) + '</span>' + retryBtn + '</div>';
    } else if (_plList === null) {
      inner = '<div style="font-size:12px;color:#94a3b8;">Loading packing lists…</div>';
    } else if (!_plList.length) {
      inner = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
        + '<span style="font-size:12px;color:#94a3b8;">No packing lists found — the form can still be filled by hand.</span>' + retryBtn + '</div>';
    } else {
      const opts = _plList.map(p => {
        const label = [p.plNo, p.invoiceNo && ('Inv ' + p.invoiceNo), p.buyer, p.orderNos && ('Orders ' + p.orderNos)].filter(Boolean).join(' — ');
        return '<option value="' + esc(p.plNo) + '"' + (_plSelected === p.plNo ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      inner = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
        + '<select id="ed-pl-select" style="' + _inputStyle + 'max-width:520px;">'
          + '<option value="">Select a packing list…</option>' + opts
        + '</select>'
        + '<button type="button" id="ed-pl-load" style="padding:8px 16px;border:none;border-radius:8px;background:var(--color-primary);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Load</button>'
      + '</div>';
    }
    return '<div id="ed-pl-picker" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 18px;margin-bottom:14px;">'
      + '<div style="font-size:13px;font-weight:800;color:#1e40af;">Load from Packing List</div>'
      + '<div style="font-size:11.5px;color:#3b82f6;margin:2px 0 8px;">Pick a packing list and everything fills in — order numbers, consignee, container and every item/carton row. Rates, exchange rate and stuffing details are then all that is left to add.</div>'
      + inner
    + '</div>';
  }

  function _applyPL(pl) {
    const f = pl.form || {};
    _plSelected = pl.plNo;

    _form.buyersOrderNo = pl.orderNos || (f.orderNos || []).join(', ');
    if (pl.invoiceNo || f.invoiceNo) _form.invoiceNo = pl.invoiceNo || f.invoiceNo;
    if (!_form.invoiceDate) _form.invoiceDate = _todayStr();
    if (pl.buyer || f.buyerName) _form.consigneeName = pl.buyer || f.buyerName;

    // "20 FT HC" / "40 FT HC" — printed as-is on the VGM, and mapped to the
    // Annexure's own "1x40'  FCL" phrasing.
    const cs = String(f.containerSize || '').trim();
    if (cs) {
      _form.containerSize = cs;
      if (/40/.test(cs)) _form.containerSizeText = "1x40'  FCL";
      else if (/20/.test(cs)) _form.containerSizeText = "1x20'  FCL";
    }

    const items = Array.isArray(f.items) ? f.items : [];
    if (items.length) {
      let grossSum = 0;
      _items = items.map(it => {
        // cartonNo is the packing list's own computed range ("121-180", "05").
        const m = String(it.cartonNo || '').match(/^(\d+)\s*-\s*(\d+)$/);
        const single = String(it.cartonNo || '').match(/^(\d+)$/);
        grossSum += num(it.grossTotal);
        return Object.assign(_blankItem(), {
          itemName: it.description || '',
          productCode: it.itemCode || '',
          size: it.size || '',
          qty: it.packedQty != null ? String(it.packedQty) : '',
          cartonFrom: m ? String(Number(m[1])) : (single ? String(Number(single[1])) : ''),
          cartonTo: m ? String(Number(m[2])) : (single ? String(Number(single[1])) : ''),
          pcsPerCarton: it.perCarton != null ? String(it.perCarton) : '',
          ntWtPerCarton: it.netPerCarton != null ? String(it.netPerCarton) : '',
        });
      });
      // Their packing list carries gross weight per carton, so the invoice's
      // total gross weight comes along too — still editable if the weighbridge
      // figure differs.
      if (grossSum > 0 && !num(_form.totalGrossWt)) _form.totalGrossWt = wt(grossSum);
    }

    render();
    Utils.showToast('Loaded ' + pl.plNo + (pl.orderNos ? ' — orders ' + pl.orderNos : ''), 'success');
  }

  /* ── data ─────────────────────────────────────────────────────────────── */
  async function _load() {
    try {
      const data = await Utils.apiFetch('/api/export-docs');
      if (!data) return;
      _rows = data.rows || [];
      _loadError = '';
    } catch (e) {
      _loadError = e.message || 'Failed to load export shipments';
    } finally {
      _loaded = true;
    }
  }

  /* ── field helpers — same cards as consignee-master, denser grid ──────── */
  const _inputStyle = 'width:100%;box-sizing:border-box;padding:7px 9px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#1e293b;outline:none;background:#fff;';
  function _fld(key, label, opts) {
    opts = opts || {};
    return '<div>'
      + '<div style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">' + esc(label) + (opts.required ? ' *' : '') + '</div>'
      + '<input type="text" data-field="' + key + '" value="' + esc(_form[key] ?? '') + '" autocomplete="off" placeholder="' + esc(opts.placeholder || '') + '" style="' + _inputStyle + '" />'
      + (opts.hint ? '<div style="font-size:10.5px;color:#94a3b8;margin-top:3px;">' + esc(opts.hint) + '</div>' : '')
    + '</div>';
  }
  function _area(key, label, rows, hint) {
    return '<div>'
      + '<div style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">' + esc(label) + '</div>'
      + '<textarea data-field="' + key + '" rows="' + (rows || 2) + '" style="' + _inputStyle + 'resize:vertical;font-family:inherit;">' + esc(_form[key] ?? '') + '</textarea>'
      + (hint ? '<div style="font-size:10.5px;color:#94a3b8;margin-top:3px;">' + esc(hint) + '</div>' : '')
    + '</div>';
  }
  function _section(title, note, gridHtml, cols) {
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;">'
      + '<div style="font-size:13px;font-weight:800;color:#0f172a;">' + esc(title) + '</div>'
      + (note ? '<div style="font-size:11.5px;color:#94a3b8;margin-top:2px;">' + esc(note) + '</div>' : '')
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(' + (cols || 190) + 'px,1fr));gap:12px;margin-top:12px;">' + gridHtml + '</div>'
    + '</div>';
  }

  /* ── tabs ─────────────────────────────────────────────────────────────── */
  function _tabBtn(label, active, cls) {
    return '<button type="button" class="' + cls + '" style="'
      + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
      + 'color:' + (active ? 'var(--color-primary)' : '#94a3b8') + ';'
      + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
      + '">' + esc(label) + '</button>';
  }
  function _tabsHtml() {
    const canAdd = _hasFeature('add');
    return '<div style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid #e2e8f0;">'
      + (canAdd ? _tabBtn(_editingId ? ('Editing ' + (_form.invoiceNo || 'shipment')) : 'Custom Invoice', _view === 'form', 'ed-form-tab') : '')
      + _tabBtn('Shipments' + (_loaded ? ' (' + _rows.length + ')' : ''), _view === 'list', 'ed-list-tab')
    + '</div>';
  }

  /* ── items table (form) ───────────────────────────────────────────────── */
  function _itemCell(idx, key, width, ph) {
    return '<td style="padding:3px;"><input type="text" data-item-idx="' + idx + '" data-item-key="' + key + '" value="' + esc(_items[idx][key] ?? '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off" style="' + _inputStyle + 'padding:6px 7px;font-size:12px;min-width:' + width + 'px;" /></td>';
  }
  function _itemsTableHtml() {
    const c = _calc();
    const head = ['#', 'Item (Invoice)', 'Item Name (Packing List)', 'Product Code', 'Size', 'Scheme', 'Qty', 'UOM', 'Rate US$', 'Carton From', 'Carton To', 'Pcs/Carton', 'Nt Wt/Carton (kg)', 'Cartons', 'Amount US$', '']
      .map(h => '<th style="padding:6px 6px;text-align:left;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;">' + esc(h) + '</th>').join('');
    const body = _items.map((it, i) => {
      const d = c.items[i];
      return '<tr style="border-top:1px solid #f1f5f9;">'
        + '<td style="padding:3px 6px;font-size:12px;color:#94a3b8;">' + (i + 1) + '</td>'
        + _itemCell(i, 'invItem', 90)
        + _itemCell(i, 'itemName', 160, 'e.g. Mug With Handle Naxi')
        + _itemCell(i, 'productCode', 90, '022-0201')
        + _itemCell(i, 'size', 90)
        + _itemCell(i, 'scheme', 80)
        + _itemCell(i, 'qty', 60)
        + _itemCell(i, 'uom', 55, 'PCS')
        + _itemCell(i, 'rate', 70)
        + _itemCell(i, 'cartonFrom', 60)
        + _itemCell(i, 'cartonTo', 60)
        + _itemCell(i, 'pcsPerCarton', 60)
        + _itemCell(i, 'ntWtPerCarton', 75)
        + '<td style="padding:3px 6px;font-size:12px;color:#475569;text-align:right;white-space:nowrap;">' + (d.cartons || '') + '</td>'
        + '<td style="padding:3px 6px;font-size:12px;color:#475569;text-align:right;white-space:nowrap;">' + (d.amount ? money(d.amount) : '') + '</td>'
        + '<td style="padding:3px 4px;"><button type="button" class="ed-del-item" data-idx="' + i + '" title="Remove row" style="border:none;background:#fef2f2;color:#dc2626;border-radius:6px;width:24px;height:24px;cursor:pointer;font-weight:700;">×</button></td>'
      + '</tr>';
    }).join('');
    return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;background:#fff;">'
      + '<table style="border-collapse:collapse;width:100%;min-width:1280px;"><thead><tr style="background:#f8fafc;">' + head + '</tr></thead><tbody>' + body + '</tbody></table>'
    + '</div>';
  }

  function _totalsHtml() {
    const c = _calc();
    const box = (label, val) => '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;min-width:130px;">'
      + '<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(label) + '</div>'
      + '<div style="font-size:14px;font-weight:800;color:#0f172a;margin-top:2px;">' + esc(val) + '</div></div>';
    return '<div id="ed-totals" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">'
      + box('Total Cartons', String(c.totalCartons || 0))
      + box('Total Qty', String(c.totalQty || 0))
      + box('C&F Value USD', money(c.totalCf))
      + box('Freight USD', money(c.freight))
      + box('FOB Value USD', money(c.fob))
      + box('FOB Value INR', money(c.fobInr))
      + box('Taxable Value ₹', money(c.totalTaxable))
      + box('Net Wt (calc)', wt(c.totalNetWt) + ' KGS')
      + box('Gross Wt', wt(c.grossWt) + ' KGS')
      + box('VGM (gross + tare)', wt(c.vgm) + ' KGS')
    + '</div>';
  }

  /* ── form view ────────────────────────────────────────────────────────── */
  function _formHtml() {
    return '<form id="ed-form" autocomplete="off">'

      // Only on a fresh invoice — loading a packing list over a record being
      // edited would silently overwrite what was already saved.
      + (_editingId ? '' : _plPickerHtml())

      + _section('Invoice Header', 'Dates are printed exactly as typed (e.g. 21.8.2026). Invoice Date is prefilled with today.',
          _fld('invoiceNo', 'Invoice No.', { required: true, placeholder: 'LA-16/26-27' })
        + _fld('invoiceDate', 'Invoice Date', { required: true, placeholder: '21.8.2026' })
        + _fld('buyersOrderNo', "Buyer's Order No.", { placeholder: 'P00595,P00660' })
        + _fld('exportersRef', "Exporter's Ref")
        + _fld('otherRef', 'Other Reference(s)')
        + _fld('consignee', 'Consignee (on invoice)')
        + _fld('buyer', 'Buyer (if other than consignee)')
        + _fld('deliveryTerms', 'Terms of Delivery')
        + _fld('paymentTerms', 'Terms of Payment')
        + _fld('exchRate', 'Exchange Rate (₹/US$)', { required: true, placeholder: '94.80' })
        + _fld('freightUsd', 'Freight US$', { placeholder: '6800.00' }))

      + _section('LUT (GST RFD-11)', 'Update once per financial year, after the new LUT is filed on the GST portal.',
          _fld('lutArnNo', 'LUT ARN No.')
        + _fld('lutArnDate', 'LUT ARN Date'))

      + _section('Consignee Details', 'Printed on the Packing List and the Annexure (the invoice itself shows the "Consignee" field above, e.g. TO ORDER).',
          _fld('consigneeName', 'Consignee Name', { required: true, placeholder: 'M/S SAIF PLUS TRADING COMPANY' })
        + _area('consigneeAddress', 'Consignee Address (one line per row)', 3)
        + _fld('consigneeTel', 'Consignee Tel.', { placeholder: '+966 50 018 1920' })
        + _fld('consigneeCr', 'CR Number', { placeholder: '1010883381' }), 240)

      + _section('Route & Ports', '',
          _fld('preCarriage', 'Pre-Carriage by')
        + _fld('placeOfReceipt', 'Place of Receipt by Pre-carrier')
        + _fld('vessel', 'Vessel / Flight No.')
        + _fld('portOfLoading', 'Port of Loading')
        + _fld('portOfDischarge', 'Port of Discharge', { required: true, placeholder: 'JEDDAH' })
        + _fld('placeOfDelivery', 'Place of Delivery', { required: true, placeholder: 'JEDDAH' })
        + _fld('countryOrigin', 'Country of Origin')
        + _fld('countryFinal', 'Country of Final Destination', { required: true, placeholder: 'SAUDI ARABIA' }))

      + _section('Goods', '',
          '<div style="grid-column:1/-1;">' + _area('itemDescription', 'Item Description (printed heading)', 2) + '</div>'
        + _fld('hsnCode', 'HSN Code')
        + _fld('swg', 'SWG', { placeholder: '2.03MM,1.22MM,0.91MM', hint: 'Printed on the Packing List.' })
        + _fld('remarks', 'Remarks / Scheme Declaration')
        + '<div style="grid-column:1/-1;">' + _area('shippingMarks', 'Shipping Marks (one line per row)', 4, 'Printed in the invoice "Marks and numbers" column and under the Packing List.') + '</div>')

      + _section('Transport & Container', 'Gross weight comes from the weighbridge; net weight is calculated from the carton rows below.',
          _fld('totalGrossWt', 'Total Gross Weight (KGS)', { required: true, placeholder: '12915.550' })
        + _fld('vehicleNo', 'Vehicle No.', { placeholder: 'GJ12BZ6467' })
        + _fld('containerNo', 'Container No.', { required: true, placeholder: 'TRKU4414246' })
        + _fld('lrNo', 'LR No.')
        + _fld('lrDate', 'LR Date', { placeholder: '20.8.2026' })
        + _fld('bookingNo', 'Booking No.', { placeholder: 'MUN26080233', hint: 'Printed on the VGM sheet.' })
        + _fld('containerSize', 'Container Size (VGM)', { placeholder: '40 FT' })
        + _fld('containerSizeText', 'Container Size (Annexure)', { placeholder: "1x40'  FCL" })
        + _fld('maxPermissibleWt', 'Max Permissible Wt (CSC Plate)')
        + _fld('shippingLineSealNo', 'Shipping Line Seal No.', { placeholder: '021429' })
        + _fld('customSealNo', 'Self/Custom Seal No.', { placeholder: 'iTEK0379293' }))

      + _section('Stuffing & Weighing', 'Feeds the Annexure examination report and the VGM sheet.',
          _fld('stuffingDate', 'Date of Stuffing', { placeholder: '21.8.2026' })
        + _fld('stuffingTimeFrom', 'Stuffing Start Time')
        + _fld('stuffingTimeTo', 'Stuffing End Time')
        + _fld('weighbridge', 'Weighbridge Name')
        + _fld('weighingMethod', 'Weighing Method')
        + _fld('containerTareWt', 'Container Tare Wt (KGS)', { hint: 'VGM = Gross Wt + Tare. Leave 0 to print gross weight as VGM.' })
        + _fld('weighingDate', 'Date of Weighing', { placeholder: '21.8.2026' })
        + _fld('weighingTime', 'Time of Weighing', { placeholder: '12.28' })
        + _fld('weighingSlipNo', 'Weighing Slip No.')
        + _fld('cargoType', 'Cargo Type')
        + _fld('unNo', 'If Hazardous: UN No / IMDG'))

      + _section('Authorised Official & Annexure', '',
          _fld('signatoryName', 'Official Name (VGM)')
        + _fld('signatoryDesignation', 'Designation')
        + _fld('signatoryContact', '24×7 Contact')
        + '<div style="grid-column:1/-1;">' + _fld('fspNo', 'Factory Stuffing Permission F.No. (Annexure)') + '</div>', 220)

      + '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'
          + '<div><div style="font-size:13px;font-weight:800;color:#0f172a;">Items & Cartons</div>'
          + '<div style="font-size:11.5px;color:#94a3b8;margin-top:2px;">One row per product/carton range. Cartons, net weight and amounts calculate themselves.</div></div>'
          + '<button type="button" id="ed-add-item" style="padding:7px 14px;border:none;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;cursor:pointer;">+ Add Row</button>'
        + '</div>'
        + '<div id="ed-items-wrap" style="margin-top:12px;">' + _itemsTableHtml() + '</div>'
        + _totalsHtml()
      + '</div>'

      + '<div style="display:flex;align-items:center;gap:12px;margin-top:4px;">'
        + '<button type="submit" id="ed-submit" style="padding:10px 24px;border:none;border-radius:9px;background:var(--color-primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer;">' + (_saving ? 'Saving…' : (_editingId ? 'Update Shipment' : 'Save Shipment')) + '</button>'
        + (_editingId ? '<button type="button" id="ed-cancel-edit" style="padding:10px 18px;border:1.5px solid #e2e8f0;border-radius:9px;background:#fff;color:#475569;font-size:13px;font-weight:700;cursor:pointer;">Cancel Edit</button>' : '')
        + '<span style="font-size:12px;color:#94a3b8;">Saving opens the Shipments tab, where each document prints from this one entry.</span>'
      + '</div>'
    + '</form>';
  }

  /* ── list view ────────────────────────────────────────────────────────── */
  function _filtered() {
    const q = _q.trim().toLowerCase();
    if (!q) return _rows;
    return _rows.filter(r => [r.invoice_no, r.invoice_date, r.consignee_name, r.created_by].join(' ').toLowerCase().includes(q));
  }

  const _DOCS = [
    ['invoice', 'Custom Invoice'],
    ['packing', 'Packing List'],
    ['annexure', 'Annexure'],
    ['dbk', 'DBK Declaration'],
    ['vgm', 'VGM'],
  ];

  // The LUT paperwork itself — FORM GST RFD-11 and its portal acknowledgement.
  // Filed once per financial year on the GST portal, so these are the filed
  // PDFs served as-is (public/export-lut-*.pdf); replace both files when the
  // new year's LUT is filed. They ride along with every shipment's documents.
  const _STATIC_DOCS = [
    ['/export-lut-rfd11.pdf', 'LUT (RFD-11)'],
    ['/export-lut-ack.pdf', 'LUT Ack.'],
  ];

  function _tableHtml() {
    const rows = _filtered();
    const owner = Utils.isOwner();
    const canAdd = _hasFeature('add');
    const head = ['Invoice No.', 'Date', 'Consignee', 'Cartons', 'C&F US$', 'Documents', '']
      .map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">' + esc(h) + '</th>').join('');

    const docBtn = (id, key, label) =>
      '<button type="button" class="ed-doc-btn" data-id="' + esc(id) + '" data-doc="' + key + '" style="padding:5px 9px;border:1px solid #dbeafe;border-radius:7px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">' + esc(label) + '</button>';

    const body = rows.length
      ? rows.map(r => {
          let d = {};
          try { d = JSON.parse(r.data || '{}'); } catch {}
          const totals = d._totals || {};
          return '<tr style="border-top:1px solid #f1f5f9;">'
            + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;color:#1e293b;white-space:nowrap;">' + esc(r.invoice_no) + '</td>'
            + '<td style="padding:8px 10px;font-size:12.5px;color:#475569;white-space:nowrap;">' + esc(r.invoice_date) + '</td>'
            + '<td style="padding:8px 10px;font-size:12.5px;color:#475569;">' + esc(r.consignee_name) + '</td>'
            + '<td style="padding:8px 10px;font-size:12.5px;color:#475569;text-align:right;">' + esc(totals.cartons ?? '') + '</td>'
            + '<td style="padding:8px 10px;font-size:12.5px;color:#475569;text-align:right;white-space:nowrap;">' + esc(totals.cf ?? '') + '</td>'
            + '<td style="padding:6px 10px;"><div style="display:flex;gap:5px;flex-wrap:wrap;">'
              + _DOCS.map(([k, l]) => docBtn(r.id, k, l)).join('')
              + _STATIC_DOCS.map(([href, l]) => '<a href="' + esc(href) + '" target="_blank" rel="noopener" style="padding:5px 9px;border:1px solid #e2e8f0;border-radius:7px;background:#f8fafc;color:#475569;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none;">' + esc(l) + '</a>').join('')
            + '</div></td>'
            + '<td style="padding:8px 10px;white-space:nowrap;">'
              + (canAdd ? '<button type="button" class="ed-edit-btn" data-id="' + esc(r.id) + '" style="padding:5px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;color:#475569;font-size:11px;font-weight:700;cursor:pointer;">Edit</button>' : '')
              + (owner ? ' <button type="button" class="ed-delete-btn" data-id="' + esc(r.id) + '" data-name="' + esc(r.invoice_no) + '" style="padding:5px 10px;border:1px solid #fecaca;border-radius:7px;background:#fef2f2;color:#dc2626;font-size:11px;font-weight:700;cursor:pointer;">Delete</button>' : '')
            + '</td>'
          + '</tr>';
        }).join('')
      : '<tr><td colspan="7" style="padding:26px;text-align:center;font-size:13px;color:#94a3b8;">' + (_rows.length ? 'No shipment matches "' + esc(_q) + '".' : 'No shipments yet — fill the Custom Invoice tab and every document generates from it.') + '</td></tr>';

    return '<div id="ed-table" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:auto;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:980px;"><thead><tr style="background:#f8fafc;">' + head + '</tr></thead>'
      + '<tbody>' + body + '</tbody></table>'
    + '</div>';
  }

  function _listHtml() {
    if (!_loaded) return '<div style="padding:26px;text-align:center;font-size:13px;color:#94a3b8;">Loading…</div>';
    if (_loadError) return '<div style="padding:16px;border:1px solid #fecaca;background:#fef2f2;border-radius:10px;font-size:13px;color:#b91c1c;">' + esc(_loadError) + '</div>';
    return '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">'
        + '<input type="text" id="ed-search" value="' + esc(_q) + '" placeholder="Search invoice no, consignee…" style="' + _inputStyle + 'max-width:340px;" />'
        + '<span id="ed-count" style="font-size:12px;color:#94a3b8;">' + _filtered().length + ' of ' + _rows.length + '</span>'
      + '</div>'
      + _tableHtml();
  }

  /* ════════════════════════════════════════════════════════════════════════
     DOCUMENT GENERATION — every layout below reads one saved form (d) plus
     the derived figures (c) from _calcFrom(d).
     ════════════════════════════════════════════════════════════════════════ */
  function _calcFrom(d) {
    const savedForm = _form, savedItems = _items;
    _form = d; _items = d.items || [];
    const c = _calc();
    _form = savedForm; _items = savedItems;
    return c;
  }

  const _PRINT_CSS = `
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; color: #000; margin: 0; padding: 24px; background:#fff; }
    .sheet { max-width: 780px; margin: 0 auto; }
    table.grid { width: 100%; border-collapse: collapse; }
    table.grid th, table.grid td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
    table.plain td { border: none; padding: 2px 4px; vertical-align: top; }
    .b { font-weight: bold; }
    .c { text-align: center; }
    .r { text-align: right; }
    .sm { font-size: 10.5px; }
    .title { text-align: center; font-weight: bold; font-size: 15px; margin: 0 0 8px; }
    .nb { border: none !important; }
    .print-btn { position: fixed; top: 12px; right: 12px; padding: 9px 18px; background: #0150AA; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; }
    @media print { .print-btn { display: none; } body { padding: 0; } }
    @page { size: A4; margin: 12mm; }
  `;

  function _openPrint(title, bodyHtml) {
    const w = window.open('', '_blank');
    if (!w) { Utils.showToast('Popup blocked — allow popups for this site to open documents', 'error'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + _PRINT_CSS + '</style></head><body>'
      + '<button class="print-btn" onclick="window.print()">Print / Save PDF</button>'
      + '<div class="sheet">' + bodyHtml + '</div>'
      + '</body></html>');
    w.document.close();
  }

  const _lines = (s) => String(s || '').split('\n').map(l => l.trim()).filter(Boolean);
  const _linesHtml = (s) => _lines(s).map(l => esc(l)).join('<br>');

  function _signBlock(forText) {
    return '<table class="plain" style="width:100%;margin-top:26px;"><tr>'
      + '<td></td><td class="r"><div class="b">' + esc(forText || 'For, ' + COMPANY.name) + '</div>'
      + '<div style="height:52px;"></div><div>Authorized Signatory</div></td></tr></table>';
  }

  /* ── 1. CUSTOM INVOICE ────────────────────────────────────────────────── */
  function _docInvoice(d) {
    const c = _calcFrom(d);
    const marks = _lines(d.shippingMarks);
    const itemRows = c.items.map((it, i) => '<tr>'
      + '<td class="sm">' + esc(marks[i] || '') + '</td>'
      + '<td>' + esc(it.invItem) + '</td>'
      + '<td>' + esc(it.scheme) + '</td>'
      + '<td>' + esc(it.productCode) + '</td>'
      + '<td>' + esc(it.size) + '</td>'
      + '<td class="r">' + esc(it.qty) + '</td>'
      + '<td>' + esc(it.uom) + '</td>'
      + '<td class="r">' + money(num(it.rate)) + '</td>'
      + '<td class="r">' + money(it.amount) + '</td>'
      + '<td class="r">' + money(it.taxable) + '</td>'
      + '<td>LUT</td>'
    + '</tr>').join('');
    const extraMarks = marks.slice(c.items.length);

    return '<table class="grid">'
      // Their invoice's letterhead: the "Exporter" block with the Queen Brand
      // trade-mark emblem and the Mumbai Regd./Admn. offices — extracted from
      // the export team's own invoice workbook (public/export-header.png).
      + '<tr>'
        // Absolute URL: the print window is an about:blank document, where a
        // relative /path may have no base to resolve against.
        + '<td style="width:50%;vertical-align:middle;"><img src="' + esc(window.location.origin + '/export-header.png') + '" alt="Exporter — LALLUBHAI AMICHAND LIMITED" style="width:100%;max-width:430px;display:block;"></td>'
        + '<td style="vertical-align:top;"><div class="b c" style="font-size:16px;margin:2px 0 6px;">INVOICE</div>'
          + '<span class="sm">Invoice No. & Date</span><br><span class="b">' + esc(d.invoiceNo) + '</span> &nbsp; DATE: <span class="b">' + esc(d.invoiceDate) + '</span>'
          + '<br><span class="sm">Exporter\'s Ref:</span> ' + esc(d.exportersRef)
          + '<br><span class="sm">Buyer\'s Order No.</span> <span class="b">' + esc(d.buyersOrderNo) + '</span>'
          + '<br><span class="sm">Other Reference(s):</span> ' + esc(d.otherRef) + '</td>'
      + '</tr>'
      + '<tr>'
        + '<td><span class="sm">Consignee</span><br><span class="b">' + esc(d.consignee) + '</span>'
          + '<br><br><span class="sm">Buyer (if other than consignee)</span><br><span class="b">' + esc(d.buyer) + '</span></td>'
        + '<td><span class="sm">Terms of delivery &amp; payment</span> <span class="b">' + esc(d.deliveryTerms) + ' &nbsp; ' + esc(d.paymentTerms) + '</span>'
        + '<br><span class="b">SHIPMENT UNDER LUT</span>'
        + '<br>LUT ARN NO. <span class="b">' + esc(d.lutArnNo) + '</span>'
        + '<br>LUT ARN DATE <span class="b">' + esc(d.lutArnDate) + '</span></td>'
      + '</tr>'
      + '<tr>'
        + '<td><span class="sm">Shipper</span><br><span class="b">' + esc(COMPANY.name) + '</span><br>'
          + esc(COMPANY.addr1) + '<br>' + esc(COMPANY.addr2) + '<br>' + esc(COMPANY.country) + '</td>'
        + '<td>TOTAL GR WT: <span class="b">' + esc(d.totalGrossWt) + '</span> KGS.'
          + '<br>TOTAL NT WT: <span class="b">' + wt(c.totalNetWt) + '</span> KGS.'
          + '<br>VEHICLE NO. <span class="b">' + esc(d.vehicleNo) + '</span>'
          + '<br>CONTAINER NO: <span class="b">' + esc(d.containerNo) + '</span>'
          + '<br>HSN CODE: <span class="b">' + esc(d.hsnCode) + '</span>'
          + '<br>LR NO. <span class="b">' + esc(d.lrNo) + '</span> &nbsp; DATE: <span class="b">' + esc(d.lrDate) + '</span>'
          + '<br>CARTONS: <span class="b">' + c.totalCartons + '</span>'
          + '<br>EXCH. RATE: <span class="b">' + esc(d.exchRate) + '</span></td>'
      + '</tr>'
      + '<tr>'
        + '<td><table class="plain sm"><tr><td>Pre-Carriage by<br><span class="b">' + esc(d.preCarriage) + '</span></td><td>Place of receipt by Pre-carrier<br><span class="b">' + esc(d.placeOfReceipt) + '</span></td></tr>'
        + '<tr><td>Vessel/Flight No.<br><span class="b">' + esc(d.vessel) + '</span></td><td>Port of Loading<br><span class="b">' + esc(d.portOfLoading) + '</span></td></tr></table></td>'
        + '<td><table class="plain sm"><tr><td>Port of Discharge<br><span class="b">' + esc(d.portOfDischarge) + '</span></td><td>Place of Delivery<br><span class="b">' + esc(d.placeOfDelivery) + '</span></td></tr>'
        + '<tr><td>Country of Origin of Goods<br><span class="b">' + esc(d.countryOrigin) + '</span></td><td>Country of Final Destination<br><span class="b">' + esc(d.countryFinal) + '</span></td></tr></table></td>'
      + '</tr>'
      + '<tr><td colspan="2" class="b sm">ITEM DESCRIPTION:- ' + esc(d.itemDescription) + '</td></tr>'
      + '</table>'

      + '<table class="grid" style="margin-top:-1px;">'
      + '<tr class="sm"><th>Marks and numbers</th><th>(ITEM)</th><th>SCHEME</th><th>PRODUCT CODE</th><th>SIZE</th><th>Qty. PCS/SET</th><th>UOM</th><th>Rate Per PC/SET US$</th><th>' + esc(d.deliveryTerms) + ' US$</th><th>Taxable Value (Rs)</th><th>LUT</th></tr>'
      + itemRows
      + (extraMarks.length ? '<tr><td class="sm">' + extraMarks.map(esc).join('<br>') + '</td><td colspan="10"></td></tr>' : '')
      + '<tr class="b"><td></td><td colspan="4" class="r">TOTAL</td><td class="r">' + c.totalQty + '</td><td></td><td class="r">TOTAL</td><td class="r">' + money(c.totalCf) + '</td><td class="r">' + money(c.totalTaxable) + '</td><td></td></tr>'
      + '</table>'

      + '<table class="grid" style="margin-top:-1px;">'
      + '<tr><td style="width:40%;" class="sm">'
          + 'FOREX BANK A/C NO.' + esc(COMPANY.forexAc) + '<br>'
          + 'AD CODE: ' + esc(COMPANY.adCode) + '<br>'
          + esc(COMPANY.bankName) + '<br><br>'
          + 'GST NO. ' + esc(COMPANY.gstNo) + '<br>'
          + 'IEC NO ' + esc(COMPANY.iecNo)
        + '</td>'
        + '<td style="width:28%;" class="sm">'
          + '<table class="plain sm" style="width:100%;">'
          + '<tr><td>' + esc(d.deliveryTerms) + ' VALUE USD</td><td class="r b">' + money(c.totalCf) + '</td></tr>'
          + '<tr><td>FREIGHT USD</td><td class="r b">' + money(c.freight) + '</td></tr>'
          + '<tr><td>FOB VALUE USD</td><td class="r b">' + money(c.fob) + '</td></tr>'
          + '<tr><td>FOB VALUE IN INR</td><td class="r b">' + money(c.fobInr) + '</td></tr>'
          + '</table>'
        + '</td>'
        + '<td class="sm">'
          + 'WE ARE MANUFACTURER CUM MERCHANT EXPORTER<br>'
          + 'REMARKS : ' + esc(d.remarks) + '<br>'
          + 'DECLARATION:<br>'
          + 'WE INTENT TO CLAIM INCENTIVES DBK AND RODTEP'
        + '</td>'
      + '</tr>'
      + '<tr><td colspan="3" class="sm"><span class="b">Amount Chargeable in words:</span> ' + esc(_usdWords(c.totalCf, d.deliveryTerms)) + '</td></tr>'
      + '<tr><td colspan="3" class="sm">'
          + 'MANUFACTURED IN INDIA AND GOODS ARE INDIAN ORIGIN. '
          + 'IT IS FURTHER DECLARED THAT THE ABOVE GOODS ARE NOT OF ISRAELI ORIGIN/MANUFACTURE NOR DO THEY CONTAIN ANY ISRAELI MATERIAL.<br>'
          + 'Manufacturers: ' + esc(COMPANY.name)
        + '</td></tr>'
      + '<tr><td colspan="2" class="sm">'
          + '<span class="b">Declaration</span><br>'
          + 'We hereby declare that this Invoice shows the actual price of the goods described and that particulars are true and correct.<br><br>'
          + esc(COMPANY.works)
        + '</td>'
        + '<td class="sm"><div class="b">' + esc(COMPANY.shortName) + '</div><div style="height:46px;"></div>Authorized Signatory</td></tr>'
      + '</table>';
  }

  /* ── 2. PACKING LIST ──────────────────────────────────────────────────── */
  function _docPacking(d) {
    const c = _calcFrom(d);
    const itemRows = c.items.map((it) => '<tr>'
      + '<td class="r">' + esc(it.cartonFrom) + '</td>'
      + '<td class="r">' + esc(it.cartonTo) + '</td>'
      + '<td class="r">' + it.cartons + '</td>'
      + '<td>' + esc(it.itemName || it.invItem) + '</td>'
      + '<td>' + esc(it.size) + '</td>'
      + '<td>' + esc(it.productCode) + '</td>'
      + '<td class="r">' + esc(it.pcsPerCarton) + '</td>'
      + '<td class="r">' + esc(it.ntWtPerCarton) + '</td>'
      + '<td class="r">' + esc(it.qty) + '</td>'
      + '<td>' + esc(it.uom) + '</td>'
      + '<td>' + esc(it.scheme) + '</td>'
      + '<td class="r">' + wt(it.netWt) + '</td>'
    + '</tr>').join('');

    return '<div class="title">PACKING LIST</div>'
      + '<table class="grid">'
      + '<tr>'
        + '<td style="width:55%;"><span class="sm">Shipper</span><br><span class="b">' + esc(COMPANY.name) + '</span><br>'
          + esc(COMPANY.addr1) + '<br>' + esc(COMPANY.addr2) + '<br>' + esc(COMPANY.country) + '</td>'
        + '<td><span class="sm">Invoice No &amp; Date</span><br><span class="b">' + esc(d.invoiceNo) + '</span> &nbsp; DATE: <span class="b">' + esc(d.invoiceDate) + '</span>'
          + '<br><span class="sm">Buyer\'s Order No.</span> <span class="b">' + esc(d.buyersOrderNo) + '</span>'
          + '<br><span class="b">SHIPMENT UNDER LUT</span>'
          + '<br>ARN NO. <span class="b">' + esc(d.lutArnNo) + '</span>'
          + '<br>ARN DATE <span class="b">' + esc(d.lutArnDate) + '</span></td>'
      + '</tr>'
      + '<tr>'
        + '<td><span class="sm">CONSIGNEE</span><br><span class="b">' + esc(d.consigneeName) + '</span><br>'
          + _linesHtml(d.consigneeAddress)
          + (d.consigneeTel ? '<br>TEL ' + esc(d.consigneeTel) : '')
          + (d.consigneeCr ? '<br>CR NUMBER ' + esc(d.consigneeCr) : '') + '</td>'
        + '<td>GROSS WEIGHT: <span class="b">' + esc(d.totalGrossWt) + '</span> KGS'
          + '<br>NET WEIGHT: <span class="b">' + wt(c.totalNetWt) + '</span> KGS'
          + (d.swg ? '<br>SWG : <span class="b">' + esc(d.swg) + '</span>' : '')
          + '<br>HSN CODE <span class="b">' + esc(d.hsnCode) + '</span>'
          + '<br>TOTAL CARTONS: <span class="b">' + c.totalCartons + '</span></td>'
      + '</tr>'
      + '<tr>'
        + '<td><table class="plain sm" style="width:100%;"><tr><td>PORT OF LOADING<br><span class="b">' + esc(d.portOfLoading) + '</span></td>'
          + '<td>PORT OF DISCHARGE<br><span class="b">' + esc(d.portOfDischarge) + '</span></td>'
          + '<td>PLACE OF DELIVERY<br><span class="b">' + esc(d.placeOfDelivery) + '</span></td></tr></table></td>'
        + '<td><table class="plain sm" style="width:100%;"><tr><td>COUNTRY OF ORIGIN<br><span class="b">' + esc(d.countryOrigin) + '</span></td>'
          + '<td>COUNTRY OF FINAL DESTINATION<br><span class="b">' + esc(d.countryFinal) + '</span></td></tr></table></td>'
      + '</tr>'
      + '<tr><td colspan="2" class="b sm">DESCRIPTION:- ' + esc(d.itemDescription) + '</td></tr>'
      + '</table>'

      + '<table class="grid sm" style="margin-top:-1px;">'
      + '<tr><th>CARTON NO FROM</th><th>CARTON NO TO</th><th>TOTAL CARTONS</th><th>ITEM</th><th>SIZE</th><th>Product code</th><th>PCS PER CARTON</th><th>NT.WT. PER CARTON</th><th>TOTAL PCS</th><th>UOM</th><th>SCHEME</th><th>TOTAL NET WEIGHT</th></tr>'
      + itemRows
      + '<tr class="b"><td></td><td></td><td class="r">' + c.totalCartons + '</td><td colspan="5" class="r">TOTAL</td><td class="r">' + c.totalQty + '</td><td></td><td></td><td class="r">' + wt(c.totalNetWt) + '</td></tr>'
      + '</table>'

      + '<table class="plain" style="width:100%;margin-top:14px;"><tr>'
        + '<td><span class="b">SHIPPING MARKS:</span><br>' + _linesHtml(d.shippingMarks) + '</td>'
        + '<td class="r"><div class="b">' + esc(COMPANY.name) + '</div><div style="height:52px;"></div>Authorized Signatory</td>'
      + '</tr></table>'
      + '<div class="sm" style="margin-top:10px;">' + esc(COMPANY.works) + '</div>';
  }

  /* ── 3. ANNEXURE (Examination report, self-sealed container) ─────────── */
  function _docAnnexure(d) {
    const c = _calcFrom(d);
    const row = (n, label, value) => '<tr><td style="width:26px;" class="c">' + n + '</td><td style="width:44%;">' + label + '</td><td>: &nbsp;' + value + '</td></tr>';
    return '<div class="title">ANNEXURE</div>'
      + '<div class="c b" style="margin-bottom:10px;">EXAMINATION REPORT FOR SELF-SEALED/CERTIFIED CONTAINER</div>'
      + '<div style="margin-bottom:6px;">Shipping Bill No. with Date: - _____________________________________</div>'
      + '<div style="margin-bottom:12px;">Examination of Factory Stuffing Permission F. No.: <span class="b">' + esc(d.fspNo) + '</span></div>'
      + '<table class="plain" style="width:100%;line-height:1.75;">'
      + row('1.', 'Name of Exporter', '<span class="b">' + esc(COMPANY.name) + '</span>')
      + row('2.', 'a) IEC No.', '<span class="b">' + esc(COMPANY.iecNo) + '</span>')
      + row('', 'b) BIN (PAN based business)', '<span class="b">' + esc(COMPANY.panNo) + '</span>')
      + row('', 'c) GSTIN', '<span class="b">' + esc(COMPANY.gstNo) + '</span>')
      + row('3.', 'Factory/Place of Stuffing Address', '<span class="b">175/3, GHODASAR VILLAGE, NR. GIDC VATVA, AHMEDABAD-382445, GUJARAT.</span>')
      + row('5.', 'Date of Stuffing', '<span class="b">' + esc(d.stuffingDate || d.invoiceDate) + '</span>')
      + row('6.', 'Time of Stuffing', '<span class="b">Starting Time ' + esc(d.stuffingTimeFrom) + ' Completion Time: ' + esc(d.stuffingTimeTo) + '</span>')
      + row('7.', 'Description of cargo with Quantity', '<span class="b">Aluminium Utensils &amp; Total Net Qty. ' + wt(c.totalNetWt) + ' KGS</span>')
      + row('8.', 'Country of final destination', '<span class="b">' + esc(d.countryFinal) + '</span>')
      + row('9.', 'Particulars of Export Invoice', '')
      + row('', '(a) Export Invoice No.', '<span class="b">' + esc(d.invoiceNo) + '</span>')
      + row('', '(b) Total No. of Packages', '<span class="b">' + c.totalCartons + ' cartons</span>')
      + row('', '(c) Name &amp; address of the consignee abroad', '<span class="b">' + esc(d.consigneeName) + '</span><br><span style="margin-left:14px;">' + _linesHtml(d.consigneeAddress) + '</span>')
      + '</table>'
      + '<div style="margin-top:12px;"><span class="b">10. &nbsp; Container particulars</span></div>'
      + '<table class="grid" style="margin-top:6px;">'
      + '<tr class="sm"><th>Container Number</th><th>Size</th><th>Shipping Line Seal No.</th><th>Seal No.</th><th>No. of Packages Stuffed in Container</th></tr>'
      + '<tr class="c"><td class="b">' + esc(d.containerNo) + '</td><td>' + esc(d.containerSizeText) + '</td><td>' + esc(d.shippingLineSealNo) + '</td><td>' + esc(d.customSealNo) + '</td><td>' + c.totalCartons + ' CARTONS</td></tr>'
      + '</table>'
      + '<table class="plain" style="width:100%;margin-top:34px;"><tr>'
        + '<td></td><td class="r"><div>Signature of Exporter</div><div style="height:44px;"></div>'
        + '<div>Name: ______________________</div><div>Designation: Authorized Signatory</div></td>'
      + '</tr></table>';
  }

  /* ── 4. DBK DECLARATION ───────────────────────────────────────────────── */
  function _docDbk(d) {
    const c = _calcFrom(d);
    const P = (t) => '<li style="margin-bottom:9px;text-align:justify;">' + t + '</li>';
    return '<div class="title" style="font-size:13px;">DECLARATION TO BE FILLED IN CASE OF EXPORT OF GOODS UNDER<br>CLAIM FOR DRAWBACK</div>'
      + '<table class="plain" style="width:100%;margin:10px 0;"><tr>'
        + '<td><span class="b">INVOICE NUMBER: ' + esc(d.invoiceNo) + ' DT.' + esc(d.invoiceDate) + '</span></td>'
      + '</tr><tr><td>SB No.: __________________________ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: __________________</td></tr></table>'
      + '<p style="text-align:justify;">I/WE, <span class="b">' + esc(COMPANY.name) + ', ' + esc(COMPANY.dbkAddr) + '</span> DO HEREBY DECLARE AS FOLLOWS:</p>'
      + '<ol style="padding-left:18px;">'
      + P('THAT THE QUALITY AND SPECIFICATIONS OF THE GOODS AS STATED IN THIS SHIPPING BILL ARE IN ACCORDANCE WITH THE TERMS OF THE EXPORT CONTRACT ENTERED INTO WITH THE BUYER/CONSIGNEE IN PURSUANCE OF WHICH THE GOODS ARE BEING EXPORTED.')
      + P('THAT THE DUTIES OF CUSTOMS AND CENTRAL EXCISE HAVE BEEN PAID IN RESPECT OF THE CONTAINERS, PACKING MATERIALS AND OTHER MATERIALS USED IN THE MANUFACTURE OF THE EXPORT GOODS ON WHICH DRAWBACK IS BEING CLAIMED AND THAT IN RESPECT OF SUCH CONTAINERS, PACKING MATERIALS OR OTHER MATERIALS, NO SEPARATE CLAIM FOR REBATE OF DUTY UNDER RULE 12A OR RULE 191A OF THE CENTRAL EXCISE RULES, 1994 HAS BEEN MADE OR WILL BE MADE TO THE CENTRAL EXCISE AUTHORITIES.')
      + P('THAT THERE IS NO CHANGE IN THE MANUFACTURING FORMULA AND IN THE QUANTUM PER UNIT OF THE IMPORTED MATERIALS OR COMPONENTS, IF ANY, UTILISED IN THE MANUFACTURE OF EXPORT GOODS AND THAT THE MATERIALS OR COMPONENTS WHICH HAVE BEEN STATED IN THE APPLICATION UNDER RULE 6 OR RULE 7 TO HAVE BEEN IMPORTED, CONTINUE TO BE SO IMPORTED AND ARE NOT BEING OBTAINED FROM INDIGENOUS SOURCES.')
      + P('THAT THE PRESENT MARKET VALUE OF THE GOODS IS AS FOLLOWS: <span class="b">FOB VALUE INR ' + money(c.fobInr) + '</span>')
      + P('THAT THE GOODS ARE NOT MANUFACTURED AND/OR EXPORTED IN DISCHARGE OF EXPORT OBLIGATION AGAINST AN ADVANCE LICENSE ISSUED UNDER THE DUTY EXEMPTION SCHEME VIDE RELEVANT IMPORT AND EXPORT POLICY IN FORCE.')
      + P('THAT THE GOODS ARE NOT MANUFACTURED AND/OR EXPORTED BY A UNIT LICENSED AS 100% EXPORT ORIENTED UNIT IN TERMS OF THE IMPORT AND EXPORT POLICY IN FORCE.')
      + P('THAT THE GOODS ARE NOT MANUFACTURED AND/OR EXPORTED BY A UNIT SITUATED IN ANY FREE-TRADE ZONE/EXPORT PROCESSING ZONE OR ANY SUCH OTHER ZONE.')
      + P('THAT THE GOODS ARE NOT MANUFACTURED PARTLY OR WHOLLY IN BOND UNDER SECTION 65 OF THE CUSTOMS ACT, 1962.')
      + P('THAT THE GOODS ARE NOT MANUFACTURED PARTLY OR WHOLLY IN BOND UNDER RULE 191B OF THE CENTRAL EXCISE RULES, 1944.')
      + P('THAT THE EXPORT VALUE OF EACH OF THE GOODS COVERED BY THIS SHIPPING BILL IS NOT LESS THAN THE TOTAL VALUE OF ALL IMPORTED MATERIALS USED IN THE MANUFACTURE OF SUCH GOODS.')
      + '</ol>'
      + '<div class="sm">NOTE: STRIKE OUT THE DECLARATIONS WHICHEVER IS NOT APPLICABLE.</div>'
      + _signBlock('For, ' + COMPANY.name)
      + '<div style="margin-top:30px;border-top:1px solid #000;padding-top:10px;">'
        + '<div class="c b sm">(FOR USE BY THE CUSTOMS AUTHORITIES)</div>'
        + '<table class="plain" style="width:100%;margin-top:12px;"><tr>'
          + '<td>SHIPPING BILL NO: ____________________<br><br>DATE: ____________________</td>'
          + '<td class="r">NAME AND SIGNATURE OF THE CUSTOMS OFFICER<br><br><br>__________________________</td>'
        + '</tr></table>'
      + '</div>';
  }

  /* ── 5. VGM ───────────────────────────────────────────────────────────── */
  function _docVgm(d) {
    const c = _calcFrom(d);
    const row = (n, label, value, star) => '<tr><td class="c" style="width:34px;">' + n + (star === false ? '' : '*') + '</td><td style="width:46%;">' + label + '</td><td>' + value + '</td></tr>';
    return '<div class="title" style="font-size:13.5px;">INFORMATION ABOUT VERIFIED GROSS MASS OF CONTAINER</div>'
      + '<div class="r b" style="margin-bottom:8px;">DATE: ' + esc(d.weighingDate || d.invoiceDate) + '</div>'
      + '<table class="grid">'
      + '<tr class="b c"><td style="width:34px;">Sr. No</td><td>Details of Information</td><td>Particulars</td></tr>'
      + row('1', 'Booking No', '<span class="b">' + esc(d.bookingNo) + '</span>')
      + row('2', 'Name of the Shipper', '<span class="b">' + esc(COMPANY.shortName) + '</span>')
      + row('3', 'Shipper Registration / License No (IEC No / CIN No)', '<span class="b">IEC NO. ' + esc(COMPANY.iecNo) + ' / CIN NO. ' + esc(COMPANY.cinNo) + '</span>')
      + row('4', 'Name &amp; Designation of the Official of the Shipper authorized to sign document', '<span class="b">NAME: ' + esc(d.signatoryName) + ' &nbsp; DESIGNATION: ' + esc(d.signatoryDesignation) + '</span>')
      + row('5', '24 x 7 Contact details of Authorized official of Shipper', '<span class="b">' + esc(d.signatoryContact) + '</span>')
      + row('6', 'Container No', '<span class="b">' + esc(d.containerNo) + '</span>')
      + row('7', 'Container Size (TEU/FUE/Others)', '<span class="b">' + esc(d.containerSize) + '</span>')
      + row('8', 'Maximum permissible weight of container as per the CSC Plate', '<span class="b">' + esc(d.maxPermissibleWt) + '</span>')
      + row('9', 'Weighbridge registration no &amp; address of weighbridge', '<span class="b">' + esc(d.weighbridge) + '</span>')
      + row('10', 'Weighing Method (Method-1 / Method-2)', '<span class="b">' + esc(d.weighingMethod) + '</span>')
      + row('11', 'Verified Gross Mass of the Container', '<span class="b">KGS. ' + wt(c.vgm) + '</span>')
      + row('12', 'Unit Of Measure (KG / MT / LBS)', '<span class="b">KG.</span>')
      + row('13', 'Date &amp; Time of Weighing', '<span class="b">' + esc(d.weighingDate) + ' &nbsp; ' + esc(d.weighingTime) + '</span>')
      + row('14', 'Weighing Slip No.', '<span class="b">' + esc(d.weighingSlipNo) + '</span>')
      + row('15', 'Type (Normal / Reefer / Hazardous / Others)', '<span class="b">' + esc(d.cargoType) + '</span>', false)
      + row('16', 'If Hazardous, UN No, IMDG Class', '<span class="b">' + esc(d.unNo) + '</span>', false)
      + '</table>'
      + '<div class="sm" style="margin-top:6px;">*Mandatory Fields</div>'
      + _signBlock('For ' + COMPANY.name);
  }

  function _openDoc(docKey, rec) {
    let d = {};
    try { d = JSON.parse(rec.data || '{}'); } catch {}
    const invNo = d.invoiceNo || rec.invoice_no || '';
    const map = {
      invoice:  ['Custom Invoice ' + invNo, _docInvoice],
      packing:  ['Packing List ' + invNo, _docPacking],
      annexure: ['Annexure ' + invNo, _docAnnexure],
      dbk:      ['DBK Declaration ' + invNo, _docDbk],
      vgm:      ['VGM ' + invNo, _docVgm],
    };
    const [title, fn] = map[docKey] || [];
    if (!fn) return;
    _openPrint(title, fn(d));
  }

  /* ── save ─────────────────────────────────────────────────────────────── */
  async function _submit(e) {
    e.preventDefault();
    if (_saving) return;
    if (!_form.invoiceNo.trim()) { Utils.showToast('Invoice No. is required', 'error'); return; }
    if (!_form.invoiceDate.trim()) { Utils.showToast('Invoice Date is required', 'error'); return; }
    if (!_form.consigneeName.trim()) { Utils.showToast('Consignee Name is required (printed on the Packing List and Annexure)', 'error'); return; }
    const realItems = _items.filter(it => String(it.qty).trim() || String(it.productCode).trim() || String(it.itemName).trim());
    if (!realItems.length) { Utils.showToast('Add at least one item row', 'error'); return; }

    const c = _calc();
    const data = Object.assign({}, _form, {
      items: _items.slice(),
      // Small summary block so the list can show figures without recomputing.
      _totals: { cartons: c.totalCartons, qty: c.totalQty, cf: money(c.totalCf), fob: money(c.fob), fobInr: money(c.fobInr), netWt: wt(c.totalNetWt), vgm: wt(c.vgm) },
    });
    const payload = {
      invoiceNo: _form.invoiceNo.trim(),
      invoiceDate: _form.invoiceDate.trim(),
      consigneeName: _form.consigneeName.trim(),
      data,
    };

    _saving = true;
    const btn = document.getElementById('ed-submit');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      if (_editingId) {
        const res = await Utils.apiFetch('/api/export-docs/' + encodeURIComponent(_editingId), { method: 'PUT', body: JSON.stringify(payload) });
        if (!res) return;
        Utils.showToast(payload.invoiceNo + ' updated', 'success');
      } else {
        const res = await Utils.apiFetch('/api/export-docs', { method: 'POST', body: JSON.stringify(payload) });
        if (!res) return;
        Utils.showToast(payload.invoiceNo + ' saved — all documents are ready to print', 'success');
      }
      _editingId = null;
      _form = _blankForm();
      _items = [_blankItem()];
      _plSelected = '';
      _loaded = false;
      _q = payload.invoiceNo;
      _view = 'list';
      await _load();
      render();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to save the shipment', 'error');
    } finally {
      _saving = false;
      const b2 = document.getElementById('ed-submit');
      if (b2) { b2.textContent = _editingId ? 'Update Shipment' : 'Save Shipment'; b2.disabled = false; }
    }
  }

  function _startEdit(rec) {
    let d = {};
    try { d = JSON.parse(rec.data || '{}'); } catch {}
    _editingId = rec.id;
    _form = Object.assign(_blankForm(), d);
    delete _form.items; delete _form._totals;
    _items = Array.isArray(d.items) && d.items.length ? d.items.map(it => Object.assign(_blankItem(), it)) : [_blankItem()];
    _view = 'form';
    render();
    const mc = document.getElementById('main-content');
    if (mc) mc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── live updates without full re-render ──────────────────────────────── */
  function _refreshItemsDerived() {
    // Re-render only the items table + totals, keeping caret position of the
    // input being typed in by re-focusing it afterwards.
    const active = document.activeElement;
    const key = active?.dataset?.itemKey, idx = active?.dataset?.itemIdx;
    const selStart = active?.selectionStart;
    const wrap = document.getElementById('ed-items-wrap');
    if (wrap) wrap.innerHTML = _itemsTableHtml();
    const totals = document.getElementById('ed-totals');
    if (totals) { const fresh = document.createElement('div'); fresh.innerHTML = _totalsHtml(); totals.replaceWith(fresh.firstElementChild); }
    if (key != null && idx != null) {
      const el = document.querySelector('input[data-item-idx="' + idx + '"][data-item-key="' + key + '"]');
      if (el) { el.focus(); try { el.setSelectionRange(selStart, selStart); } catch {} }
    }
  }

  function _refreshTotalsOnly() {
    const totals = document.getElementById('ed-totals');
    if (totals) { const fresh = document.createElement('div'); fresh.innerHTML = _totalsHtml(); totals.replaceWith(fresh.firstElementChild); }
  }

  /* ── render ───────────────────────────────────────────────────────────── */
  function render() {
    const canAdd = _hasFeature('add');
    if (_view === 'form' && !canAdd) _view = 'list';

    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = '<div style="padding:22px 24px 40px;">'
      + '<div style="margin-bottom:16px;">'
        + '<h2 style="margin:0;font-size:20px;font-weight:800;color:#0f172a;">Export Documentation</h2>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Fill the Custom Invoice once — the Packing List, Annexure, DBK Declaration and VGM print themselves from it. LUT ARN details are prefilled and updated once per financial year.</p>'
      + '</div>'
      + _tabsHtml()
      + (_view === 'form' ? _formHtml() : _listHtml())
    + '</div>';

    const formTab = mc.querySelector('.ed-form-tab');
    if (formTab) formTab.addEventListener('click', () => { _view = 'form'; render(); });
    const listTab = mc.querySelector('.ed-list-tab');
    if (listTab) listTab.addEventListener('click', () => { _view = 'list'; render(); });

    const form = document.getElementById('ed-form');
    if (form) {
      form.addEventListener('submit', _submit);

      // One delegated input listener keeps state in sync for every field —
      // header fields write into _form, item cells into _items — so nothing is
      // lost when only part of the page re-renders.
      form.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.field) {
          _form[t.dataset.field] = t.value;
          if (['exchRate', 'freightUsd', 'totalGrossWt', 'containerTareWt'].includes(t.dataset.field)) _refreshTotalsOnly();
          return;
        }
        if (t.dataset.itemKey != null) {
          const it = _items[Number(t.dataset.itemIdx)];
          if (it) it[t.dataset.itemKey] = t.value;
          if (['qty', 'rate', 'cartonFrom', 'cartonTo', 'ntWtPerCarton'].includes(t.dataset.itemKey)) _refreshItemsDerived();
        }
      });

      form.addEventListener('click', (e) => {
        const del = e.target.closest('.ed-del-item');
        if (del) {
          _items.splice(Number(del.dataset.idx), 1);
          if (!_items.length) _items.push(_blankItem());
          _refreshItemsDerived();
          return;
        }
        if (e.target.id === 'ed-add-item') {
          // Convenience: continue the carton numbering from the previous row.
          const prev = _items[_items.length - 1];
          const next = _blankItem();
          const prevTo = num(prev?.cartonTo);
          if (prevTo > 0) next.cartonFrom = String(prevTo + 1);
          if (prev?.uom) next.uom = prev.uom;
          _items.push(next);
          _refreshItemsDerived();
          return;
        }
        if (e.target.id === 'ed-pl-load') {
          const sel = document.getElementById('ed-pl-select');
          const plNo = sel ? sel.value : '';
          if (!plNo) { Utils.showToast('Pick a packing list first', 'warning'); return; }
          const pl = (_plList || []).find(p => p.plNo === plNo);
          if (pl) _applyPL(pl);
          return;
        }
        if (e.target.id === 'ed-pl-retry') {
          _loadPLs(true);
          const slot = document.getElementById('ed-pl-picker');
          if (slot) { _plError = ''; const fresh = document.createElement('div'); fresh.innerHTML = _plPickerHtml(); slot.replaceWith(fresh.firstElementChild); }
          return;
        }
        if (e.target.id === 'ed-cancel-edit') {
          _editingId = null;
          _form = _blankForm();
          _items = [_blankItem()];
          _plSelected = '';
          _view = 'list';
          render();
        }
      });

      // Picking from the dropdown applies the packing list straight away —
      // no separate Load click needed (the button stays as a redo).
      form.addEventListener('change', (e) => {
        if (e.target.id === 'ed-pl-select') {
          _plSelected = e.target.value;
          if (!_plSelected) return;
          const pl = (_plList || []).find(p => p.plNo === _plSelected);
          if (pl) _applyPL(pl);
        }
      });

      if (!_editingId) _loadPLs();
    }

    // List interactions — delegated on the page wrapper so they survive the
    // table being swapped by the search box.
    const page = mc.firstElementChild;
    if (page && _view === 'list') {
      page.addEventListener('click', async (e) => {
        const docBtn = e.target.closest('.ed-doc-btn');
        if (docBtn) {
          const rec = _rows.find(r => r.id === docBtn.dataset.id);
          if (rec) _openDoc(docBtn.dataset.doc, rec);
          return;
        }
        const editBtn = e.target.closest('.ed-edit-btn');
        if (editBtn) {
          const rec = _rows.find(r => r.id === editBtn.dataset.id);
          if (rec) _startEdit(rec);
          return;
        }
        const delBtn = e.target.closest('.ed-delete-btn');
        if (delBtn) {
          const name = delBtn.dataset.name;
          if (!(await Utils.ownerDeleteConfirm(name))) return;
          try {
            await Utils.apiFetch('/api/export-docs?id=' + encodeURIComponent(delBtn.dataset.id), { method: 'DELETE' });
            Utils.showToast(name + ' deleted', 'success');
            _rows = _rows.filter(r => r.id !== delBtn.dataset.id);
            render();
          } catch (err) {
            Utils.showToast(err.message || 'Failed to delete', 'error');
          }
        }
      });

      const search = document.getElementById('ed-search');
      if (search) {
        search.addEventListener('input', (e) => {
          _q = e.target.value;
          const table = document.getElementById('ed-table');
          const count = document.getElementById('ed-count');
          if (!table) { render(); return; }
          const fresh = document.createElement('div');
          fresh.innerHTML = _tableHtml();
          table.replaceWith(fresh.firstElementChild);
          if (count) count.textContent = _filtered().length + ' of ' + _rows.length;
        });
      }
    }

    if (!_loaded) {
      _load().then(() => {
        if (_view === 'list') { render(); return; }
        const tab = document.querySelector('.ed-list-tab');
        if (tab) tab.textContent = 'Shipments (' + _rows.length + ')';
      });
    }
  }

  return { render };
})();
