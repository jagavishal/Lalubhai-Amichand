window.Pages = window.Pages || {};

// ── Proforma Invoice (PI) Creation ────────────────────────────────────────────
// Fills a brand-new, dedicated live Google Sheet ("ERP - Proforma Invoice" —
// see PI_CREATION_SHEET_ID in server.js / scripts/create-pi-sheet.js). Unlike
// PO/PR/GRN Creation (create-then-Cancel-only), a PI is a genuine two-stage
// record: any User creates it (buyer + items + qty — no price at all), then
// whoever is granted the 'set_price' feature for this page (Admin/HOD always,
// or a specific User granted it from Users → Access tab) opens that same PI
// and fills in Rate/GST/Freight, which finalizes it in place.
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

  function _today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function _fmtMoney(n) { return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

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

  /* ── Masters (next PI number / recent buyers) ──────────────────────── */
  async function _loadMasters() {
    try {
      const data = await Utils.apiFetch('/api/proforma-invoice/masters');
      if (!data) return;
      _nextPiNumber = data.nextPiNumber;
      _recentBuyers = data.recentBuyers || [];
      _mastersLoaded = true;
      const el = document.getElementById('pic-next-no');
      if (el) el.textContent = _nextPiNumber || 'Loading…';
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load Proforma Invoice masters', 'error');
    }
  }

  /* ── Buyer — free-text input + suggestion dropdown of recent buyers (no
     dedicated Buyer/Customer master exists in this app yet) ─────────────── */
  function _buyerField() {
    return _fieldWrap('Buyer Name', ''
      + '<input type="text" id="pic-buyer" autocomplete="off" placeholder="Type buyer / company name…" style="' + _inputStyle + '" />'
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

  /* ── Item-code typeahead per row — same fixed-position dropdown pattern
     used by PO/GRN Creation, backed by the same ITEM_CODES catalog ─────── */
  let _itemSearchTimer = null;
  function _bindItemCodeInput(input) {
    const row = input.closest('.pic-item-row');
    const dd = row.querySelector('.pic-item-dd');
    const descInput = row.querySelector('[data-field="description"]');
    const runSearch = () => {
      clearTimeout(_itemSearchTimer);
      _itemSearchTimer = setTimeout(async () => {
        const q = input.value.trim();
        try {
          const res = await fetch('/api/proforma-invoice/items?q=' + encodeURIComponent(q));
          if (!res.ok) return;
          const matches = await res.json();
          if (!matches.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = matches.map(m => '<div class="pic-item-opt" style="padding:7px 12px;font-size:12.5px;cursor:pointer;" data-code="' + esc(m.code) + '" data-desc="' + esc(m.description) + '">'
            + '<b>' + esc(m.code) + '</b> — ' + esc(m.description) + '</div>').join('');
          const rect = input.getBoundingClientRect();
          dd.style.top = (rect.bottom + 3) + 'px'; dd.style.left = rect.left + 'px'; dd.style.width = Math.max(rect.width, 260) + 'px';
          dd.style.display = 'block';
        } catch {}
      }, 220);
    };
    input.addEventListener('input', runSearch);
    input.addEventListener('focus', runSearch);
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.pic-item-opt');
      if (!opt) return;
      input.value = opt.dataset.code;
      if (descInput && !descInput.value) descInput.value = opt.dataset.desc || '';
      dd.style.display = 'none';
    });
    window.addEventListener('scroll', (e) => { if (e.target !== dd) dd.style.display = 'none'; }, true);
    document.addEventListener('click', (e) => { if (e.target !== input) dd.style.display = 'none'; });
  }

  /* ── Item rows (Create form) — deliberately NO Rate/Amount column here:
     pricing is a separate, permission-gated step done later ────────────── */
  function _itemRowHtml() {
    return '<tr class="pic-item-row" style="border-bottom:1px solid #f1f5f9;">'
      + '<td style="padding:6px;min-width:140px;position:relative;">'
        + '<input type="text" class="pic-item-code" data-field="itemCode" autocomplete="off" placeholder="Item code…" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" />'
        + '<div class="pic-item-dd" style="display:none;position:fixed;z-index:50;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;"></div>'
      + '</td>'
      + '<td style="padding:6px;min-width:180px;"><input type="text" data-field="description" placeholder="Description" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;min-width:100px;"><input type="text" data-field="hsnCode" placeholder="HSN" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;min-width:80px;"><input type="text" inputmode="decimal" data-field="qty" placeholder="Qty" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;min-width:80px;"><input type="text" data-field="uom" placeholder="UOM" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
      + '<td style="padding:6px;text-align:center;"><button type="button" class="pic-item-remove" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;line-height:1;" title="Remove row">×</button></td>'
    + '</tr>';
  }

  function _itemsTableHtml() {
    return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
      + '<table style="width:100%;border-collapse:collapse;min-width:720px;">'
        + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
          + ['Item Code', 'Description', 'HSN Code', 'Qty', 'UOM'].map(h => '<th style="padding:8px 6px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '<th></th>'
        + '</tr></thead>'
        + '<tbody id="pic-items-tbody">' + _itemRowHtml() + '</tbody>'
      + '</table>'
    + '</div>'
    + '<p style="font-size:11.5px;color:#94a3b8;margin:8px 2px 0;">Price is added later by an authorized user — this form only captures buyer &amp; item details.</p>';
  }

  function _bindItemRow(rowEl) {
    _bindItemCodeInput(rowEl.querySelector('.pic-item-code'));
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

  /* ── Header fields (Create form) ───────────────────────────────────── */
  function _headerFieldsHtml() {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
      + _textField('pic-date', 'PI Date', { type: 'date', value: _today() })
      + _readonlyField('pic-next-no', 'PI No. (auto-assigned)', _nextPiNumber || 'Loading…')
      + _buyerField()
      + _textField('pic-buyer-address', 'Buyer Address')
      + _textField('pic-buyer-gstin', 'Buyer GSTIN')
      + _textField('pic-payment-terms', 'Payment Terms', { placeholder: 'e.g. 50% advance, balance before dispatch' })
      + _textField('pic-validity', 'Validity', { placeholder: 'e.g. 30 days' })
      + _textField('pic-made-by', 'PI Made By', { value: (window.currentUser && window.currentUser.name) || '' })
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
    return Array.from(document.querySelectorAll('#pic-items-tbody .pic-item-row')).map(row => ({
      itemCode: row.querySelector('[data-field="itemCode"]').value.trim(),
      description: row.querySelector('[data-field="description"]').value.trim(),
      hsnCode: row.querySelector('[data-field="hsnCode"]').value.trim(),
      qty: row.querySelector('[data-field="qty"]').value.trim(),
      uom: row.querySelector('[data-field="uom"]').value.trim(),
    })).filter(it => it.itemCode);
  }

  async function _submit(e) {
    e.preventDefault();
    const date = document.getElementById('pic-date').value;
    const buyerName = document.getElementById('pic-buyer').value.trim();
    const buyerAddress = document.getElementById('pic-buyer-address').value.trim();
    const buyerGstin = document.getElementById('pic-buyer-gstin').value.trim();
    const paymentTerms = document.getElementById('pic-payment-terms').value.trim();
    const validity = document.getElementById('pic-validity').value.trim();
    const items = _collectItems();

    if (!date) { Utils.showToast('PI Date is required', 'error'); return; }
    if (!buyerName) { Utils.showToast('Buyer Name is required', 'error'); return; }
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }

    const btn = document.getElementById('pic-submit-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const result = await Utils.apiFetch('/api/proforma-invoice', {
        method: 'POST',
        body: JSON.stringify({ date, buyerName, buyerAddress, buyerGstin, paymentTerms, validity, items }),
      });
      Utils.showToast('PI #' + result.piNumber + ' created' + (result.pdfLink ? ' — PDF saved to Drive' : ' (PDF export failed, PI still saved)'), result.pdfLink ? 'success' : 'warning');
      await _loadMasters();
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
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">#' + esc(r.piNo) + '</td>'
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
        const ok = await Utils.showConfirm('PI #' + cancelBtn.dataset.pi + ' will be marked Cancelled. This can\'t be undone.', { title: 'Cancel Proforma Invoice', confirmText: 'Cancel PI', danger: true });
        if (!ok) return;
        try {
          await Utils.apiFetch('/api/proforma-invoice/cancel?piNo=' + encodeURIComponent(cancelBtn.dataset.pi), { method: 'PUT' });
          Utils.showToast('PI #' + cancelBtn.dataset.pi + ' cancelled', 'success');
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
      + '<input type="text" id="pil-buyer" placeholder="Search buyer…" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
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
            + ['PI No', 'Date', 'Buyer', 'Status', 'Total (INR)', 'PDF', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="pil-body"><tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>'
      + '<div id="pi-price-modal"></div>';
  }

  /* ── Add Price modal — lists the PI's own stored items (read-only
     description/qty from Form JSON) with a Rate input per row, plus GST%/
     Freight — submits to PUT /api/proforma-invoice/price ────────────────── */
  function _priceRecompute() {
    const modal = document.getElementById('pi-price-modal');
    if (!modal) return;
    let subtotal = 0;
    modal.querySelectorAll('.pipm-item-row').forEach(row => {
      const qty = _num(row.dataset.qty);
      const rate = _num(row.querySelector('.pipm-rate').value);
      const amt = qty * rate;
      row.querySelector('.pipm-amount').textContent = _fmtMoney(amt);
      subtotal += amt;
    });
    const gstPercent = _num(document.getElementById('pipm-gst').value);
    const freight = _num(document.getElementById('pipm-freight').value);
    const gstAmount = subtotal * gstPercent / 100;
    const total = subtotal + gstAmount + freight;
    document.getElementById('pipm-subtotal').textContent = _fmtMoney(subtotal);
    document.getElementById('pipm-total').textContent = _fmtMoney(total);
  }

  function _closePriceModal() {
    _priceModalRow = null;
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
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:720px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
        + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
          + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + (row.status === 'Priced' ? 'Edit Price' : 'Add Price') + ' — PI #' + esc(row.piNo) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">' + esc(row.buyer) + '</div></div>'
          + '<button id="pipm-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
          + '</button>'
        + '</div>'
        + '<div style="padding:22px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px;">'
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:560px;">'
              + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
                + ['Item Code', 'Description', 'Qty', 'UOM', 'Rate (INR)', 'Amount (INR)'].map(h => '<th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
              + '</tr></thead>'
              + '<tbody>' + items.map(it => ''
                + '<tr class="pipm-item-row" data-code="' + esc(it.itemCode || '') + '" data-qty="' + esc(it.qty || 0) + '" style="border-bottom:1px solid #f1f5f9;">'
                  + '<td style="padding:6px 8px;font-size:12.5px;">' + esc(it.itemCode) + '</td>'
                  + '<td style="padding:6px 8px;font-size:12.5px;color:#64748b;">' + esc(it.description || '—') + '</td>'
                  + '<td style="padding:6px 8px;font-size:12.5px;">' + esc(it.qty) + '</td>'
                  + '<td style="padding:6px 8px;font-size:12.5px;color:#64748b;">' + esc(it.uom || '—') + '</td>'
                  + '<td style="padding:6px 8px;"><input type="text" inputmode="decimal" class="pipm-rate" value="' + esc(it.rate || '') + '" placeholder="0" style="width:100px;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12.5px;" /></td>'
                  + '<td class="pipm-amount" style="padding:6px 8px;font-size:12.5px;color:#64748b;text-align:right;">0.00</td>'
                + '</tr>').join('')
              + '</tbody>'
            + '</table>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;">'
            + _fieldWrap('GST %', '<input type="text" inputmode="decimal" id="pipm-gst" value="' + esc(form.gstPercent || '') + '" placeholder="0" style="' + _inputStyle + '" />')
            + _fieldWrap('Freight / Other Charges', '<input type="text" inputmode="decimal" id="pipm-freight" value="' + esc(form.freight || '') + '" placeholder="0" style="' + _inputStyle + '" />')
          + '</div>'
          + '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">'
            + '<div style="font-size:12px;color:#64748b;">Subtotal: ₹<span id="pipm-subtotal">0.00</span></div>'
            + '<div><span style="font-size:12.5px;font-weight:700;color:#64748b;">Total </span><span style="font-size:17px;font-weight:800;color:#0f172a;">₹<span id="pipm-total">0.00</span></span></div>'
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
    document.getElementById('pipm-gst').addEventListener('input', _priceRecompute);
    document.getElementById('pipm-freight').addEventListener('input', _priceRecompute);
    document.getElementById('pipm-save').addEventListener('click', _submitPrice);
    _priceRecompute();
  }

  async function _submitPrice() {
    if (_priceSaving || !_priceModalRow) return;
    const piNo = _priceModalRow.piNo;
    const modal = document.getElementById('pi-price-modal');
    const items = Array.from(modal.querySelectorAll('.pipm-item-row')).map(row => ({ code: row.dataset.code, rate: row.querySelector('.pipm-rate').value.trim() }));
    const gstPercent = document.getElementById('pipm-gst').value.trim();
    const freight = document.getElementById('pipm-freight').value.trim();

    _priceSaving = true;
    const btn = document.getElementById('pipm-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const result = await Utils.apiFetch('/api/proforma-invoice/price?piNo=' + encodeURIComponent(piNo), {
        method: 'PUT',
        body: JSON.stringify({ items, gstPercent, freight }),
      });
      Utils.showToast('PI #' + piNo + ' priced' + (result.pdfLink ? ' — PDF updated on Drive' : ''), 'success');
      _closePriceModal();
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
        + _headerFieldsHtml()
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:4px 2px -4px;">Items</div>'
        + _itemsTableHtml()
        + '<div>'
          + '<button type="button" id="pic-add-item" style="padding:7px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">+ Add Item</button>'
        + '</div>'
        + '<button type="submit" id="pic-submit-btn" style="align-self:flex-start;padding:10px 28px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13.5px;font-weight:700;cursor:pointer;">Create Proforma Invoice</button>'
      + '</form>';

    el.innerHTML = '<div style="max-width:' + (isList ? '1200px' : '1080px') + ';margin:0 auto;padding:4px 0 40px;">'
      + '<div style="margin-bottom:14px;">'
        + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">Proforma Invoice</h1>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Create captures buyer &amp; items only — price is added afterward by an authorized user.</p>'
      + '</div>'
      + _tabsHtml()
      + bodyHtml
    + '</div>';

    document.querySelector('.pic-create-tab').addEventListener('click', () => { _view = 'create'; renderPage(); });
    document.querySelector('.pic-list-tab').addEventListener('click', () => { _view = 'list'; renderPage(); });

    if (isList) {
      _pilBindFilterBar();
      _pilBindRowActions();
      _pilLoad();
      return;
    }

    _bindBuyerField();
    _bindAllItemRows();

    document.getElementById('pic-add-item').addEventListener('click', () => {
      document.getElementById('pic-items-tbody').insertAdjacentHTML('beforeend', _itemRowHtml());
      _bindItemRow(document.getElementById('pic-items-tbody').lastElementChild);
    });

    document.getElementById('pic-form').addEventListener('submit', _submit);

    if (!_mastersLoaded) _loadMasters();
  }

  return {
    render() { renderPage(); },
  };
})();
