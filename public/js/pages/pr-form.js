window.Pages = window.Pages || {};

window.Pages['pr-form'] = (() => {
  /* ── Constants — transcribed verbatim from the store team's PR Form (Google Form PDF) ── */
  const VENDOR_LIST = [
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

  const DEPARTMENT_LIST = [
    'accessory dept', 'Brazing dept', 'CNC dept', 'consumable', 'electric dept',
    'Packing dept', 'Pressing dept', 'Washing dept', 'Welding dept',
  ];

  // Reused verbatim from the store team's prior (since-removed) PR intake implementation —
  // casing already corrected there to match this same source form.
  const PRODUCT_CATALOG = {
    accessory: ['BACK LIGHT MILK JUG KNOB', 'BRASS INSERT', 'S.S MILK JUG SCREW', 'STEEL CAP RIVET'],
    brazing: ['ALU.BRAZING POWDER (MUMBAI)', 'ALU.BRAZING POWDER (PUNA)'],
    consumable: ['-297 EX.COARSE PAPER', 'APPRON', 'COCONUT OIL', 'COTTON HAND GLOVES JE', 'COTTON WASTE', 'EMERY PAPER 320 NO', 'EMERY PAPER J-297 FINE', 'EXTRA PAPER J-297.', 'GREEN BAR', 'GREEN SCOTCH BRIGHT HAND PAD', 'GUMBOOT', 'KEROSENE', 'KNITTED HAND GLOVES HEAVY', 'KNITTED HAND GLOVES SMALL', 'A.P. - GREASE', 'M.S. WIRE', 'MADRASI BUFF 12 * 12', 'MS WELDING ROD NO.08', 'MS WELDING ROD NO.10', 'PVC COATED HAND GLOVES', 'QUENCHING OIL', 'RANI PAPER', 'SAFETY GOGGALS', 'SAFETY MASK', 'STEEL WOOL', 'TAPPER WHEEL', 'WHITE COTTON WASTE', 'WOODEN DHOKHA', 'WOODEN STICK', 'WOODEN WASTE', 'YELLOW CLOTHS'],
    electric: ['2.5 MFD CAPECITOR', '35 A R/F SWITCH', '4 MFD CAPECITOR', '6 MFD CAPECITOR', 'HALOZEN LIGHT 200W', 'L&T MK-1 4 TO 10 A', 'L&T MK-1 4 TO 6.5 A', 'TUBE LIGHT', 'TUBE LIGHT 36 W'],
    packing: ['B.O.P.P TAPP ROLL (BROWN)', 'POLYTHENE BAG 10*10', 'POLYTHENE BAG 10*12', 'POLYTHENE BAG 11*13', 'POLYTHENE BAG 12*12', 'POLYTHENE BAG 13*15', 'POLYTHENE BAG 14*16', 'POLYTHENE BAG 16*18', 'POLYTHENE BAG 18*20', 'POLYTHENE BAG 20*20', 'POLYTHENE BAG 20*22', 'POLYTHENE BAG 24*24', 'POLYTHENE BAG 26*26', 'POLYTHENE BAG 28*28', 'POLYTHENE BAG 32*32', 'POLYTHENE BAG 8*8', 'WHITE TAPE ROLL 1/2"', 'WHITE TAPE ROLL 3"', 'Pp bag 32×32'],
    pressing: ['ALU DRWMATE POWDER', 'COMPRESSOR OIL 220 NO', 'HYDROLIC OIL 68 NO', 'LUBRICANT OIL 40 NO', 'HP EP 220 NO GEAR OIL'],
    washing: ['AMONIUM ALUM', 'CAUSTIC SODA', 'CHROMIC ACID', 'HYDROFLORIC ACID', 'LIME POWDER', 'LIME POWDER LIQUID', 'LPG CYLENDER', 'NITRIC ACID', 'PHOSPHURIC ACID', 'SULPHURIC ACID', 'Saw firewood'],
    welding: ['ALU WELDING ROD 1.63 MM SMALL', 'ALU.WELDING ROD 2 MM', 'OXYGEN CYLENDER'],
  };

  const CNC_PRODUCTS = ['HYDROPAC OIL 100 FOR CNC'];

  /* ── Helpers ────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _fieldWrap(label, sublabel, innerHtml, required) {
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">'
      + '<div style="font-size:13px;font-weight:700;color:#1e293b;">' + esc(label) + (required ? ' <span style="color:#ef4444;">*</span>' : '') + '</div>'
      + '<div style="font-size:11.5px;color:#94a3b8;margin:2px 0 10px;">' + esc(sublabel) + '</div>'
      + innerHtml
      + '</div>';
  }

  function _textField(id, label, sublabel, required) {
    return _fieldWrap(label, sublabel,
      '<input type="text" id="' + id + '" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;" />',
      required);
  }

  function _numberField(id, label, sublabel, required) {
    return _fieldWrap(label, sublabel,
      '<input type="text" inputmode="decimal" id="' + id + '" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;" />',
      required);
  }

  function _chkRow(cls, value, isOther) {
    return '<label class="pr-chk-row' + (isOther ? ' pr-other-row' : '') + '" data-name="' + esc(value.toLowerCase()) + '" style="display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:13px;color:#374151;cursor:pointer;">'
      + '<input type="checkbox" class="' + cls + '" value="' + esc(value) + '" style="width:15px;height:15px;cursor:pointer;accent-color:var(--color-primary);flex-shrink:0;" />'
      + esc(value)
      + '</label>';
  }

  function _checkboxGroup(cls, label, sublabel, options, includeOther) {
    const rows = options.map(o => _chkRow(cls, o)).join('') + (includeOther ? _chkRow(cls, 'Other', true) : '');
    const inner = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 12px;max-height:260px;overflow-y:auto;border:1px solid #f1f5f9;border-radius:8px;padding:8px 10px;">' + rows + '</div>';
    return _fieldWrap(label, sublabel, inner, true);
  }

  function _vendorGroup() {
    const rows = VENDOR_LIST.map(o => _chkRow('pr-vendor-chk', o)).join('') + _chkRow('pr-vendor-chk', 'Other', true);
    const inner = '<input type="text" id="pr-vendor-search" placeholder="Search vendor…" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12.5px;margin-bottom:8px;outline:none;" />'
      + '<div id="pr-vendor-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 12px;max-height:280px;overflow-y:auto;border:1px solid #f1f5f9;border-radius:8px;padding:8px 10px;">' + rows + '</div>';
    return _fieldWrap('Available Options of Vendors', 'ઉપલબ્ધ વેન્ડરના વિકલ્પો / वेंडरों के उपलब्ध विकल्प', inner, true);
  }

  function _cncGroup() {
    const opts = CNC_PRODUCTS.concat(['Other']).map(o => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('');
    const inner = '<select id="pr-cnc-select" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;background:#fff;">'
      + '<option value="">Choose…</option>' + opts
      + '</select>';
    return _fieldWrap('CNC Product Name', 'સીએનસી ઉત્પાદનનું નામ / सीएनसी उत्पाद का नाम', inner, false);
  }

  function _checkedValues(cls) {
    return Array.from(document.querySelectorAll('.' + cls + ':checked')).map(cb => cb.value);
  }

  /* ── Submit ─────────────────────────────────────────────────── */
  async function _submit(e) {
    e.preventDefault();
    const prNo             = document.getElementById('pr-no').value.trim();
    const filledBy         = document.getElementById('pr-filled-by').value.trim();
    const vendors           = _checkedValues('pr-vendor-chk');
    const vendorOther       = document.getElementById('pr-vendor-other').value.trim();
    const department        = _checkedValues('pr-dept-chk');
    const departmentOther   = document.getElementById('pr-dept-other').value.trim();
    const accessoryProduct  = _checkedValues('pr-accessory-chk');
    const brazingProduct    = _checkedValues('pr-brazing-chk');
    const cncProduct        = document.getElementById('pr-cnc-select').value;
    const consumableProduct = _checkedValues('pr-consumable-chk');
    const electricProduct   = _checkedValues('pr-electric-chk');
    const packingProduct    = _checkedValues('pr-packing-chk');
    const pressingProduct   = _checkedValues('pr-pressing-chk');
    const washingProduct    = _checkedValues('pr-washing-chk');
    const weldingProduct    = _checkedValues('pr-welding-chk');
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

  function _bindVendorSearch() {
    const input = document.getElementById('pr-vendor-search');
    if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      document.querySelectorAll('#pr-vendor-list .pr-chk-row').forEach(row => {
        if (row.classList.contains('pr-other-row')) return;
        row.style.display = (!q || (row.dataset.name || '').includes(q)) ? 'flex' : 'none';
      });
    });
  }

  /* ── Render ─────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    el.innerHTML = '<div style="max-width:760px;margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:20px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">PR Form</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Checking safety stock and raising a Purchase Requisition after receiving the requirement from a department head.</p>'
      + '</div>'
      + '<form id="pr-form-el" style="display:flex;flex-direction:column;gap:16px;">'
        + _textField('pr-no', 'Purchase Requisition Number (PR NO.)', 'पी.आर. नंबर / પી.આર. નંબર', true)
        + _textField('pr-filled-by', 'Name of Person Filling the Form', 'फ़ॉर्म भरने वाले व्यक्ति का नाम / ફોર્મ ભરતા વ્યક્તિનું નામ', true)
        + _vendorGroup()
        + _textField('pr-vendor-other', 'If New Vendor then Enter Here', 'જો નવો વેન્ડર હોય તો અહીં દાખલ કરો / अगर नया वेंडर हो तो यहां दर्ज करें', false)
        + _checkboxGroup('pr-dept-chk', 'Department', 'વિભાગ / विभाग', DEPARTMENT_LIST, true)
        + _textField('pr-dept-other', 'If New Department then Enter Here', 'જો નવો વિભાગ હોય તો અહીં દાખલ કરો / अगर नया विभाग हो तो यहां दर्ज करें', false)
        + _checkboxGroup('pr-accessory-chk', 'Accessory Product Name', 'અનુસંગી ઉત્પાદનનું નામ / सहायक उत्पाद का नाम', PRODUCT_CATALOG.accessory, true)
        + _checkboxGroup('pr-brazing-chk', 'Brazing Product Name', 'બ્રેઝિંગ ઉત્પાદનનું નામ / ब्रेजिंग उत्पाद का नाम', PRODUCT_CATALOG.brazing, false)
        + _cncGroup()
        + _checkboxGroup('pr-consumable-chk', 'Consumable Product Name', 'ઉપયોગી વસ્તુનું નામ / उपभोज्य उत्पाद का नाम', PRODUCT_CATALOG.consumable, true)
        + _checkboxGroup('pr-electric-chk', 'Electric Product Name', 'ઇલેક્ટ્રિક ઉત્પાદનનું નામ / विद्युत उत्पाद का नाम', PRODUCT_CATALOG.electric, true)
        + _checkboxGroup('pr-packing-chk', 'Packing Product Name', 'પેકિંગ ઉત્પાદનનું નામ / पैकिंग उत्पाद का नाम', PRODUCT_CATALOG.packing, true)
        + _checkboxGroup('pr-pressing-chk', 'Pressing Product Name', 'પેકિંગ ઉત્પાદનનું નામ / पैकिंग उत्पाद का नाम', PRODUCT_CATALOG.pressing, true)
        + _checkboxGroup('pr-washing-chk', 'Washing Product Name', 'ધોઈ ઉત્પાદનનું નામ / धोनेका उत्पाद का नाम', PRODUCT_CATALOG.washing, true)
        + _checkboxGroup('pr-welding-chk', 'Welding Product Name', 'વેલ્ડીંગ ઉત્પાદનનું નામ / वेल्डिंग उत्पाद का नाम', PRODUCT_CATALOG.welding, true)
        + _textField('pr-new-product', 'If New Product then Enter Here', 'જો નવો ઉત્પાદન હોય તો અહીં દાખલ કરો / अगर नया उत्पाद है तो यहाँ दर्ज करें', false)
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;">'
          + _numberField('pr-current-stock', 'Current Stock', 'वर्तमान स्टॉक / હાલનું સ્ટોક', true)
          + _numberField('pr-qty-required', 'Quantity Required', 'आवश्यक मात्रा / જરૂરી પ્રમાણ', true)
          + _numberField('pr-previous-rate', 'Previous Rate', 'पिछली दर / પહેલી દર', true)
        + '</div>'
        + '<button type="submit" id="pr-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Submit PR</button>'
      + '</form>'
    + '</div>';

    document.getElementById('pr-form-el').addEventListener('submit', _submit);
    _bindVendorSearch();
  }

  return {
    render() { renderPage(); },
  };
})();
