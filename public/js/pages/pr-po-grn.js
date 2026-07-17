window.Pages = window.Pages || {};

window.Pages['pr-po-grn'] = (() => {
  /* ── Constants ──────────────────────────────────────────────── */
  const TYPES = [
    { key: 'ITEM_CODE',       label: 'Item Code' },
    { key: 'PACKING_STICKER', label: 'Packing Sticker' },
    { key: 'PACKING_BOX',     label: 'Packing Box' },
    { key: 'ALU',              label: 'Aluminium' },
  ];
  const TYPE_LABEL = {}; TYPES.forEach(t => TYPE_LABEL[t.key] = t.label);

  const STATUSES = ['pending', 'ordered', 'received', 'cancelled'];
  const STATUS_LABEL = { pending: 'Pending', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' };
  const STATUS_COLOR = {
    pending:   { bg:'#fef3c7', fg:'#92400e', dot:'#f59e0b' },
    ordered:   { bg:'#eff6ff', fg:'#1d4ed8', dot:'#3b82f6' },
    received:  { bg:'#f0fdf4', fg:'#16a34a', dot:'#16a34a' },
    cancelled: { bg:'#f1f5f9', fg:'#64748b', dot:'#94a3b8' },
  };

  /* ── Shared state ───────────────────────────────────────────── */
  let _tab      = 'masters'; // 'masters' | 'forms' | 'fms'
  let _canEdit  = false;     // Admin/HOD

  /* ── Masters (Item Master) state ───────────────────────────── */
  let _items       = [];
  let _itemsLoaded = false;
  let _itemQ       = '';
  let _itemTypeF   = 'All';
  let _itemOpen    = false;
  let _itemEditing = null;
  let _itemSaving  = false;
  let _itemForm    = _blankItemForm();

  /* ── Forms (Purchase Requisition) state ────────────────────── */
  let _prs         = [];
  let _vendors     = [];
  let _vendorsLoaded = false;
  let _prQ         = '';
  let _prStatusF   = 'All';
  let _prTypeF     = 'All';
  let _prScope     = 'mine';
  let _prOpen      = false;
  let _prViewing   = null;
  let _prSaving    = false;
  let _prForm      = _blankPrForm();

  /* ── FMS (dispatch/shipment tracking) state ────────────────── */
  let _fmsStatusF  = 'ordered'; // 'ordered' | 'All'
  let _fmsQ        = '';

  /* ── Helpers ────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _today() { return new Date().toISOString().slice(0, 10); }
  function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function _money(n) { return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function _typeSelectOptions(selected) {
    return TYPES.map(t => '<option value="' + t.key + '" ' + (selected===t.key?'selected':'') + '>' + t.label + '</option>').join('');
  }

  function _blankItemForm() {
    return {
      itemType: _itemTypeF !== 'All' ? _itemTypeF : 'ITEM_CODE',
      itemName:'', sizeLabel:'', pcsPerBox:'', lengthIn:'', widthIn:'', heightIn:'',
      plyType:'', productCode:'', barcode:'', cbmPerBox:'', customerGroup:'', remarks:'',
    };
  }
  function _blankPrItem() {
    return { packingItemId: null, itemSearch: '', itemName: '', unit: '', quantity: '', estimatedRate: '', remarks: '' };
  }
  function _blankPrForm() {
    return { prType: 'ITEM_CODE', prDate: _today(), vendorId: null, vendorSearch: '', remarks: '', items: [_blankPrItem()] };
  }

  /* ── API ────────────────────────────────────────────────────── */
  async function _loadItems(skipRender) {
    try { const res = await Utils.apiFetch('/api/packing-items'); _items = Array.isArray(res) ? res : []; } catch { _items = []; }
    _itemsLoaded = true;
    if (!skipRender) _renderTabContent();
  }
  async function _loadVendors() {
    if (_vendorsLoaded) return;
    try { const v = await Utils.apiFetch('/api/clients'); _vendors = Array.isArray(v) ? v : []; } catch { _vendors = []; }
    _vendorsLoaded = true;
  }
  async function _loadPrs(skipRender) {
    try {
      const url = (_canEdit && _prScope === 'all')
        ? '/api/purchase-requisitions'
        : '/api/purchase-requisitions?requestedById=' + encodeURIComponent(window.currentUser?.id || '');
      const res = await Utils.apiFetch(url);
      _prs = Array.isArray(res) ? res : [];
    } catch { _prs = []; }
    if (!skipRender) _renderTabContent();
  }

  /* ═══════════════════════════════════════════════════════════════
     MASTERS TAB — Item Master (type-tagged: Item Code / Packing
     Sticker / Packing Box / Aluminium)
     ═══════════════════════════════════════════════════════════════ */

  function _itemsFiltered() {
    const t = _itemQ.toLowerCase();
    return _items.filter(p =>
      (_itemTypeF === 'All' || p.itemType === _itemTypeF) &&
      (!t || (p.id + p.item_name + (p.size_label||'') + (p.product_code||'') + (p.barcode||'') + (p.customer_group||'')).toLowerCase().includes(t))
    );
  }

  async function _saveItem() {
    if (!_itemForm.itemName.trim()) { Utils.showToast('Item name is required', 'error'); return; }
    _itemSaving = true; _renderItemModal();
    try {
      const method = _itemEditing !== null ? 'PATCH' : 'POST';
      const body   = _itemEditing !== null ? { id: _itemEditing, ..._itemForm } : _itemForm;
      await Utils.apiFetch('/api/packing-items', { method, body: JSON.stringify(body) });
      _itemOpen = false; _itemEditing = null; _itemForm = _blankItemForm();
      Utils.showToast(_itemEditing !== null ? 'Item updated' : 'Item added');
    } catch (e) {
      Utils.showToast(e.message || 'Failed to save', 'error');
    } finally { _itemSaving = false; }
    await _loadItems();
  }

  async function _removeItem(id) {
    if (!await Utils.showConfirm('This item will be permanently removed.', { title: 'Delete Item', confirmText: 'Delete', danger: true })) return;
    await Utils.apiFetch('/api/packing-items?id=' + id, { method: 'DELETE' });
    Utils.showToast('Item deleted');
    await _loadItems();
  }

  function _openAddItem()  { _itemEditing = null; _itemForm = _blankItemForm(); _itemOpen = true; _renderTabContent(); }
  function _openEditItem(p) {
    _itemEditing = p.id;
    _itemForm = {
      itemType: p.itemType || 'ITEM_CODE', itemName: p.item_name||'', sizeLabel: p.size_label||'', pcsPerBox: p.pcs_per_box||'',
      lengthIn: p.length_in||'', widthIn: p.width_in||'', heightIn: p.height_in||'',
      plyType: p.ply_type||'', productCode: p.product_code||'', barcode: p.barcode||'',
      cbmPerBox: p.cbm_per_box||'', customerGroup: p.customer_group||'', remarks: p.remarks||'',
    };
    _itemOpen = true; _renderTabContent();
  }
  function _closeItemModal() { _itemOpen = false; _itemEditing = null; _itemForm = _blankItemForm(); _renderTabContent(); }

  function _fld(id, label, v, ph, type) {
    return '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">' + label + '</label>'
      + '<input class="input" id="' + id + '" type="' + (type||'text') + '" value="' + esc(v) + '" placeholder="' + (ph||'') + '" style="width:100%;box-sizing:border-box;" /></div>';
  }

  function _renderItemModal() {
    const modal = document.getElementById('ppgm-modal');
    if (!modal) return;
    if (!_itemOpen) { modal.innerHTML = ''; return; }
    const title = _itemEditing !== null ? 'Edit Item' : 'Add Item';
    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="ppgm-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:640px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
      + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
        + '<div style="width:38px;height:38px;border-radius:10px;background:#fff8f5;display:grid;place-items:center;flex-shrink:0;">'
          + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4714A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>'
        + '</div>'
        + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + title + '</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">Item master specification</div></div>'
        + '<button id="ppgm-modal-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
        + '</button>'
      + '</div>'
      + '<div style="padding:22px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px;">'
        + '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">Type *</label>'
          + '<select class="input" id="ppgm-itemType" style="width:100%;box-sizing:border-box;">' + _typeSelectOptions(_itemForm.itemType) + '</select></div>'
        + _fld('ppgm-itemName', 'Item Name *', _itemForm.itemName, 'e.g. New Milk Jug Bright')
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('ppgm-sizeLabel','Size',_itemForm.sizeLabel,'e.g. 11 or No.2') + _fld('ppgm-pcsPerBox','Pcs / Box',_itemForm.pcsPerBox,'e.g. 24') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">' + _fld('ppgm-lengthIn','L (in)',_itemForm.lengthIn,'') + _fld('ppgm-widthIn','W (in)',_itemForm.widthIn,'') + _fld('ppgm-heightIn','H (in)',_itemForm.heightIn,'') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('ppgm-plyType','Ply Type',_itemForm.plyType,'e.g. 7 ply') + _fld('ppgm-cbmPerBox','CBM / Box',_itemForm.cbmPerBox,'e.g. 0.09252') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('ppgm-productCode','Product Code',_itemForm.productCode,'') + _fld('ppgm-barcode','Barcode',_itemForm.barcode,'') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('ppgm-customerGroup','Customer / Group',_itemForm.customerGroup,'e.g. MIDDLE EAST') + _fld('ppgm-remarks','Remarks',_itemForm.remarks,'') + '</div>'
      + '</div>'
      + '<div style="padding:14px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;background:#fafafa;">'
        + '<button id="ppgm-modal-cancel" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
        + '<button id="ppgm-modal-save" style="padding:9px 24px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;" ' + (_itemSaving ? 'disabled' : '') + '>'
          + (_itemSaving ? 'Saving…' : (_itemEditing !== null ? 'Update Item' : 'Add Item'))
        + '</button>'
      + '</div>'
    + '</div></div>';

    document.getElementById('ppgm-backdrop').addEventListener('click', _closeItemModal);
    document.getElementById('ppgm-modal-close').addEventListener('click', _closeItemModal);
    document.getElementById('ppgm-modal-cancel').addEventListener('click', _closeItemModal);
    document.getElementById('ppgm-modal-save').addEventListener('click', () => {
      _itemForm.itemType      = document.getElementById('ppgm-itemType').value;
      _itemForm.itemName      = document.getElementById('ppgm-itemName').value.trim();
      _itemForm.sizeLabel     = document.getElementById('ppgm-sizeLabel').value.trim();
      _itemForm.pcsPerBox     = document.getElementById('ppgm-pcsPerBox').value.trim();
      _itemForm.lengthIn      = document.getElementById('ppgm-lengthIn').value.trim();
      _itemForm.widthIn       = document.getElementById('ppgm-widthIn').value.trim();
      _itemForm.heightIn      = document.getElementById('ppgm-heightIn').value.trim();
      _itemForm.plyType       = document.getElementById('ppgm-plyType').value.trim();
      _itemForm.cbmPerBox     = document.getElementById('ppgm-cbmPerBox').value.trim();
      _itemForm.productCode   = document.getElementById('ppgm-productCode').value.trim();
      _itemForm.barcode       = document.getElementById('ppgm-barcode').value.trim();
      _itemForm.customerGroup = document.getElementById('ppgm-customerGroup').value.trim();
      _itemForm.remarks       = document.getElementById('ppgm-remarks').value.trim();
      _saveItem();
    });
  }

  function _renderItemsTable() {
    const rows = _itemsFiltered();
    if (!rows.length) {
      return '<div style="padding:56px 24px;text-align:center;">'
        + '<div style="font-size:14px;font-weight:600;color:#374151;">No items found</div>'
        + '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">Try adjusting your search or type filter</div>'
      + '</div>';
    }
    const thS = 'padding:10px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;';
    const actionTh = _canEdit ? '<th style="' + thS + 'text-align:right;">Actions</th>' : '';

    return '<div class="overflow-x-auto"><table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr style="border-bottom:2px solid #e2e8f0;">'
        + '<th style="' + thS + 'text-align:center;width:44px;">#</th>'
        + '<th style="' + thS + '">Item Code</th>'
        + '<th style="' + thS + '">Type</th>'
        + '<th style="' + thS + '">Item Name</th>'
        + '<th style="' + thS + '">Size</th>'
        + '<th style="' + thS + 'text-align:right;">Pcs/Box</th>'
        + '<th style="' + thS + 'text-align:right;">L × W × H (in)</th>'
        + '<th style="' + thS + 'text-align:right;">CBM/Box</th>'
        + '<th style="' + thS + '">Barcode</th>'
        + actionTh
      + '</tr></thead>'
      + '<tbody>'
        + rows.map((p, i) => {
          const tdS = 'padding:10px 14px;font-size:12.5px;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap;';
          const dims = [p.length_in, p.width_in, p.height_in].filter(v => v).join(' × ') || '—';
          const actionTd = _canEdit
            ? '<td style="' + tdS + '"><div style="display:flex;gap:6px;justify-content:flex-end;">'
              + '<button class="ppgm-edit" data-id="' + p.id + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:11px;font-weight:600;cursor:pointer;">Edit</button>'
              + '<button class="ppgm-delete" data-id="' + p.id + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #fecaca;background:#fff5f5;color:#ef4444;font-size:11px;font-weight:600;cursor:pointer;">Delete</button>'
              + '</div></td>' : '';
          return '<tr style="' + (i % 2 === 1 ? 'background:#fafafa;' : '') + '">'
            + '<td style="' + tdS + 'text-align:center;color:#94a3b8;font-weight:600;">' + (i+1) + '</td>'
            + '<td style="' + tdS + 'font-weight:600;color:#1e293b;">' + esc(p.id) + '</td>'
            + '<td style="' + tdS + '"><span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:600;">' + esc(TYPE_LABEL[p.itemType] || p.itemType) + '</span></td>'
            + '<td style="' + tdS + 'white-space:normal;min-width:220px;">' + esc(p.item_name) + (p.remarks ? '<div style="font-size:11px;color:#f59e0b;margin-top:1px;">' + esc(p.remarks) + '</div>' : '') + '</td>'
            + '<td style="' + tdS + '">' + esc(p.size_label||'—') + '</td>'
            + '<td style="' + tdS + 'text-align:right;">' + esc(p.pcs_per_box||'—') + '</td>'
            + '<td style="' + tdS + 'text-align:right;">' + esc(dims) + '</td>'
            + '<td style="' + tdS + 'text-align:right;">' + esc(p.cbm_per_box||'—') + '</td>'
            + '<td style="' + tdS + '">' + esc(p.barcode||'—') + '</td>'
            + actionTd
          + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  function _renderMastersTab() {
    const rows = _itemsFiltered();
    return '<div style="display:flex;flex-direction:column;gap:16px;">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;">'
          + '<div><div style="font-size:18px;font-weight:800;color:#1e293b;line-height:1;">' + _items.length + '</div><div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">Total Items</div></div>'
        + '</div>'
        + TYPES.map(t => {
          const c = _items.filter(p => p.itemType === t.key).length;
          return '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;">'
            + '<div><div style="font-size:18px;font-weight:800;color:#2563eb;line-height:1;">' + c + '</div><div style="font-size:10.5px;color:#1d4ed8;margin-top:1px;">' + t.label + '</div></div>'
          + '</div>';
        }).join('')
      + '</div>'
      + '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);">'
        + '<div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
          + '<div style="position:relative;flex:1;min-width:200px;">'
            + '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
            + '<input id="ppgm-search" placeholder="Search item code, name, size, barcode…" value="' + esc(_itemQ) + '" style="width:100%;box-sizing:border-box;padding:8px 12px 8px 32px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;" />'
          + '</div>'
          + '<select id="ppgm-type-filter" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;color:#374151;cursor:pointer;">'
            + '<option ' + (_itemTypeF==='All'?'selected':'') + '>All</option>'
            + _typeSelectOptions(_itemTypeF !== 'All' ? _itemTypeF : null)
          + '</select>'
          + '<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">' + rows.length + ' of ' + _items.length + '</span>'
          + (_canEdit ? '<button id="ppgm-add-btn" style="margin-left:auto;padding:8px 16px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;">+ Add Item</button>' : '')
        + '</div>'
        + '<div id="ppgm-table">' + _renderItemsTable() + '</div>'
      + '</div>'
    + '</div>';
  }

  function _bindMastersEvents() {
    document.getElementById('ppgm-search')?.addEventListener('input', (e) => {
      _itemQ = e.target.value;
      const t = document.getElementById('ppgm-table');
      if (t) t.innerHTML = _renderItemsTable();
      _bindItemsTableEvents();
    });
    document.getElementById('ppgm-type-filter')?.addEventListener('change', (e) => {
      _itemTypeF = e.target.value;
      const t = document.getElementById('ppgm-table');
      if (t) t.innerHTML = _renderItemsTable();
      _bindItemsTableEvents();
    });
    document.getElementById('ppgm-add-btn')?.addEventListener('click', _openAddItem);
    _bindItemsTableEvents();
  }
  function _bindItemsTableEvents() {
    document.querySelectorAll('.ppgm-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = _items.find(x => String(x.id) === String(btn.dataset.id));
        if (p) _openEditItem(p);
      });
    });
    document.querySelectorAll('.ppgm-delete').forEach(btn => {
      btn.addEventListener('click', () => _removeItem(btn.dataset.id));
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     FORMS TAB — Purchase Requisition (single form; Type selector
     drives which item-master items appear in the line-item dropdown)
     ═══════════════════════════════════════════════════════════════ */

  function _prItemsForType(type) { return _items.filter(p => p.itemType === type); }

  function _prFiltered() {
    const t = _prQ.toLowerCase();
    return _prs.filter(pr =>
      (_prStatusF === 'All' || pr.status === _prStatusF) &&
      (_prTypeF === 'All' || pr.prType === _prTypeF) &&
      (!t || (pr.id + pr.requestedBy + (pr.vendorName||'') + (pr.items||[]).map(i => i.itemName).join(' ')).toLowerCase().includes(t))
    );
  }
  function _prTotal(pr) { return (pr.items||[]).reduce((s, i) => s + _num(i.quantity) * _num(i.estimatedRate), 0); }
  function _formTotal() { return _prForm.items.reduce((s, i) => s + _num(i.quantity) * _num(i.estimatedRate), 0); }
  function _canDeletePr(pr) {
    return _canEdit || (String(pr.requestedById) === String(window.currentUser?.id) && pr.status === 'pending');
  }

  async function _savePr() {
    if (!_prForm.prDate) { Utils.showToast('PR date is required', 'error'); return; }
    const items = _prForm.items.filter(i => i.itemName.trim());
    if (!items.length) { Utils.showToast('Add at least one item', 'error'); return; }
    _prSaving = true; _renderPrModal();
    try {
      await Utils.apiFetch('/api/purchase-requisitions', {
        method: 'POST',
        body: JSON.stringify({
          prType: _prForm.prType, prDate: _prForm.prDate, vendorId: _prForm.vendorId, remarks: _prForm.remarks,
          items: items.map(i => ({ packingItemId: i.packingItemId, itemName: i.itemName, unit: i.unit, quantity: i.quantity, estimatedRate: i.estimatedRate, remarks: i.remarks })),
        }),
      });
      _prOpen = false; _prForm = _blankPrForm();
      Utils.showToast('Purchase requisition raised');
    } catch (e) {
      Utils.showToast(e.message || 'Failed to save', 'error');
    } finally { _prSaving = false; }
    await _loadPrs();
  }

  async function _removePr(id) {
    if (!await Utils.showConfirm('This purchase requisition will be permanently removed.', { title: 'Delete Requisition', confirmText: 'Delete', danger: true })) return;
    await Utils.apiFetch('/api/purchase-requisitions?id=' + id, { method: 'DELETE' });
    Utils.showToast('Requisition deleted');
    _prViewing = null;
    await _loadPrs();
  }
  async function _setPrStatus(id, status) {
    await Utils.apiFetch('/api/purchase-requisitions', { method: 'PATCH', body: JSON.stringify({ id, status }) });
    Utils.showToast('Status updated to ' + STATUS_LABEL[status]);
    if (_prViewing && _prViewing.id === id) _prViewing.status = status;
    await _loadPrs();
    _renderPrViewModal();
  }

  function _openAddPr() { _prForm = _blankPrForm(); _prOpen = true; _renderTabContent(); }
  function _closePrModal() { _prOpen = false; _prForm = _blankPrForm(); _renderTabContent(); }

  function _vendorDropdownHtml() {
    return '<div style="position:relative;">'
      + '<input id="ppgf-vendor-inp" type="text" placeholder="Search vendor…" autocomplete="off" value="' + esc(_prForm.vendorSearch) + '" '
        + 'style="width:100%;box-sizing:border-box;padding:8px 12px;border:1.5px solid ' + (_prForm.vendorId ? 'var(--color-primary)' : '#e2e8f0') + ';border-radius:9px;font-size:13px;font-weight:' + (_prForm.vendorId?'600':'400') + ';color:#1e293b;outline:none;background:' + (_prForm.vendorId?'#fff8f5':'#f8fafc') + ';" />'
      + '<div id="ppgf-vendor-dd" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;z-index:300;box-shadow:0 10px 32px rgba(0,0,0,.14);max-height:220px;overflow-y:auto;"></div>'
    + '</div>';
  }
  function _buildVendorDropdown(q) {
    const ddEl = document.getElementById('ppgf-vendor-dd');
    if (!ddEl) return;
    const qt = q.trim().toLowerCase();
    const matches = qt ? _vendors.filter(v => v.name.toLowerCase().includes(qt) || (v.mobile||'').includes(qt)) : _vendors.slice();
    if (!matches.length) { ddEl.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:#94a3b8;">No vendors found</div>'; return; }
    ddEl.innerHTML = matches.slice(0, 40).map(v =>
      '<div class="ppgf-vendor-opt" data-vid="' + v.id + '" style="padding:9px 14px;cursor:pointer;border-bottom:1px solid #f8fafc;">'
        + '<div style="font-size:13px;font-weight:600;color:#1e293b;">' + esc(v.name) + '</div>'
        + (v.mobile ? '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">' + esc(v.mobile) + '</div>' : '')
      + '</div>'
    ).join('');
  }
  function _bindVendorField() {
    const inp = document.getElementById('ppgf-vendor-inp');
    const ddEl = document.getElementById('ppgf-vendor-dd');
    if (!inp || !ddEl) return;
    inp.addEventListener('focus', () => { _buildVendorDropdown(inp.value); ddEl.style.display = 'block'; });
    inp.addEventListener('input', () => {
      _prForm.vendorId = null; _prForm.vendorSearch = inp.value;
      inp.style.borderColor = '#e2e8f0'; inp.style.fontWeight = '400'; inp.style.background = '#f8fafc';
      _buildVendorDropdown(inp.value); ddEl.style.display = 'block';
    });
    inp.addEventListener('blur', () => { setTimeout(() => { ddEl.style.display = 'none'; if (!_prForm.vendorId) { _prForm.vendorSearch = ''; inp.value = ''; } }, 160); });
    ddEl.addEventListener('mousedown', e => {
      e.preventDefault();
      const opt = e.target.closest('.ppgf-vendor-opt');
      if (!opt) return;
      const v = _vendors.find(x => String(x.id) === String(opt.dataset.vid));
      if (!v) return;
      _prForm.vendorId = v.id; _prForm.vendorSearch = v.name;
      inp.value = v.name; inp.style.borderColor = 'var(--color-primary)'; inp.style.fontWeight = '600'; inp.style.background = '#fff8f5';
      ddEl.style.display = 'none';
    });
  }

  function _itemRowHtml(item, i) {
    const cellS = 'padding:5px 6px;';
    return '<tr data-ri="' + i + '" style="border-bottom:1px solid #eef2f7;">'
      + '<td style="' + cellS + 'text-align:center;width:28px;color:#94a3b8;font-size:12px;font-weight:600;">' + (i+1) + '</td>'
      + '<td style="' + cellS + 'min-width:220px;position:relative;">'
        + '<input class="ppgf-item-inp" data-ri="' + i + '" type="text" placeholder="Search ' + TYPE_LABEL[_prForm.prType].toLowerCase() + ' item…" autocomplete="off" value="' + esc(item.itemSearch || item.itemName) + '" '
          + 'style="width:100%;box-sizing:border-box;padding:6px 10px;border:1.5px solid ' + (item.packingItemId ? 'var(--color-primary)' : '#e9ecef') + ';border-radius:7px;font-size:12.5px;color:#1e293b;outline:none;background:' + (item.packingItemId?'#fff8f5':'#fff') + ';" />'
        + '<div class="ppgf-item-dd" data-ri="' + i + '" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;min-width:260px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;z-index:300;box-shadow:0 10px 32px rgba(0,0,0,.14);max-height:220px;overflow-y:auto;"></div>'
      + '</td>'
      + '<td style="' + cellS + 'min-width:80px;"><input class="ppgf-unit-inp" data-ri="' + i + '" type="text" placeholder="Box/Pcs" value="' + esc(item.unit) + '" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e9ecef;border-radius:7px;font-size:12.5px;" /></td>'
      + '<td style="' + cellS + 'min-width:80px;"><input class="ppgf-qty-inp" data-ri="' + i + '" type="number" min="0" step="any" placeholder="0" value="' + esc(item.quantity) + '" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e9ecef;border-radius:7px;font-size:12.5px;" /></td>'
      + '<td style="' + cellS + 'min-width:100px;"><input class="ppgf-rate-inp" data-ri="' + i + '" type="number" min="0" step="any" placeholder="0.00" value="' + esc(item.estimatedRate) + '" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e9ecef;border-radius:7px;font-size:12.5px;" /></td>'
      + '<td style="' + cellS + 'min-width:120px;"><input class="ppgf-lremarks-inp" data-ri="' + i + '" type="text" placeholder="Remarks" value="' + esc(item.remarks) + '" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e9ecef;border-radius:7px;font-size:12.5px;" /></td>'
      + '<td style="' + cellS + 'width:30px;text-align:center;">'
        + (_prForm.items.length > 1 ? '<button class="ppgf-remove-row" data-ri="' + i + '" style="background:transparent;border:none;cursor:pointer;color:#d1d5db;padding:3px;line-height:1;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' : '')
      + '</td>'
    + '</tr>';
  }

  function _buildItemDropdown(ri, q) {
    const ddEl = document.querySelector('.ppgf-item-dd[data-ri="' + ri + '"]');
    if (!ddEl) return;
    const pool = _prItemsForType(_prForm.prType);
    const qt = q.trim().toLowerCase();
    const matches = qt
      ? pool.filter(p => (p.id+p.item_name+(p.size_label||'')+(p.barcode||'')).toLowerCase().includes(qt))
      : pool.slice(0, 40);
    if (!matches.length) { ddEl.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:#94a3b8;">No ' + TYPE_LABEL[_prForm.prType].toLowerCase() + ' items found in the master</div>'; return; }
    ddEl.innerHTML = matches.slice(0, 40).map(p =>
      '<div class="ppgf-item-opt" data-pid="' + p.id + '" style="padding:9px 14px;cursor:pointer;border-bottom:1px solid #f8fafc;">'
        + '<div style="font-size:12.5px;font-weight:600;color:#1e293b;">' + esc(p.id) + ' — ' + esc(p.item_name) + '</div>'
        + '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">Size ' + esc(p.size_label||'—') + ' · ' + esc(p.pcs_per_box||'—') + ' pcs/box</div>'
      + '</div>'
    ).join('');
  }

  function _bindItemRow(ri, rowEl) {
    const inp = rowEl.querySelector('.ppgf-item-inp[data-ri="' + ri + '"]');
    const ddEl = rowEl.querySelector('.ppgf-item-dd[data-ri="' + ri + '"]');
    const unitInp = rowEl.querySelector('.ppgf-unit-inp[data-ri="' + ri + '"]');
    const qtyInp = rowEl.querySelector('.ppgf-qty-inp[data-ri="' + ri + '"]');
    const rateInp = rowEl.querySelector('.ppgf-rate-inp[data-ri="' + ri + '"]');
    const remInp = rowEl.querySelector('.ppgf-lremarks-inp[data-ri="' + ri + '"]');
    const removeBtn = rowEl.querySelector('.ppgf-remove-row[data-ri="' + ri + '"]');

    if (inp && ddEl) {
      inp.addEventListener('focus', () => { _buildItemDropdown(ri, inp.value); ddEl.style.display = 'block'; });
      inp.addEventListener('input', () => {
        _prForm.items[ri].packingItemId = null; _prForm.items[ri].itemSearch = inp.value; _prForm.items[ri].itemName = inp.value;
        inp.style.borderColor = '#e9ecef'; inp.style.background = '#fff';
        _buildItemDropdown(ri, inp.value); ddEl.style.display = 'block';
      });
      inp.addEventListener('blur', () => { setTimeout(() => { ddEl.style.display = 'none'; }, 160); });
      ddEl.addEventListener('mousedown', e => {
        e.preventDefault();
        const opt = e.target.closest('.ppgf-item-opt');
        if (!opt) return;
        const p = _items.find(x => String(x.id) === String(opt.dataset.pid));
        if (!p) return;
        _prForm.items[ri].packingItemId = p.id;
        _prForm.items[ri].itemName = p.item_name + (p.size_label ? ' (' + p.size_label + ')' : '');
        _prForm.items[ri].itemSearch = _prForm.items[ri].itemName;
        inp.value = _prForm.items[ri].itemName;
        inp.style.borderColor = 'var(--color-primary)'; inp.style.background = '#fff8f5';
        ddEl.style.display = 'none';
        if (!_prForm.items[ri].unit) { _prForm.items[ri].unit = 'Box'; if (unitInp) unitInp.value = 'Box'; }
        if (qtyInp) qtyInp.focus();
      });
    }
    if (unitInp) unitInp.addEventListener('input', () => { _prForm.items[ri].unit = unitInp.value; });
    if (qtyInp) qtyInp.addEventListener('input', () => { _prForm.items[ri].quantity = qtyInp.value; _updateFormTotal(); });
    if (rateInp) rateInp.addEventListener('input', () => { _prForm.items[ri].estimatedRate = rateInp.value; _updateFormTotal(); });
    if (remInp) remInp.addEventListener('input', () => { _prForm.items[ri].remarks = remInp.value; });
    if (removeBtn) removeBtn.addEventListener('click', () => { _prForm.items.splice(ri, 1); _refreshItemsTable(); });
  }

  function _updateFormTotal() {
    const el = document.getElementById('ppgf-form-total');
    if (el) el.textContent = _money(_formTotal());
  }
  function _refreshItemsTable() {
    const tbody = document.getElementById('ppgf-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = _prForm.items.map((it, i) => _itemRowHtml(it, i)).join('');
    document.querySelectorAll('#ppgf-items-tbody tr[data-ri]').forEach(tr => {
      const ri = parseInt(tr.dataset.ri);
      if (!isNaN(ri)) _bindItemRow(ri, tr);
    });
    _updateFormTotal();
  }

  function _renderPrModal() {
    const modal = document.getElementById('ppgf-modal');
    if (!modal) return;
    if (!_prOpen) { modal.innerHTML = ''; return; }
    const thS = 'padding:8px 6px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;';

    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="ppgf-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:920px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
      + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
        + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">Raise Purchase Requisition</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">Pick a type, then request items to purchase from a vendor</div></div>'
        + '<button id="ppgf-modal-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
        + '</button>'
      + '</div>'
      + '<div style="padding:22px 24px;max-height:70vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px;">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;">'
          + '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">Type *</label>'
            + '<select class="input" id="ppgf-prtype" style="width:100%;box-sizing:border-box;">' + _typeSelectOptions(_prForm.prType) + '</select></div>'
          + _fld('ppgf-date', 'PR Date *', _prForm.prDate, '', 'date')
          + '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">Vendor</label>' + _vendorDropdownHtml() + '</div>'
          + _fld('ppgf-remarks', 'Remarks', _prForm.remarks, 'Optional note')
        + '</div>'
        + '<div>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
            + '<span style="font-size:12px;font-weight:700;color:#1e293b;">Items <span style="font-weight:400;color:#94a3b8;">(' + TYPE_LABEL[_prForm.prType] + ')</span></span>'
            + '<button id="ppgf-add-row-btn" style="display:flex;align-items:center;gap:6px;padding:5px 12px;font-size:11.5px;font-weight:600;border:1.5px dashed #d1d5db;border-radius:7px;background:transparent;color:#64748b;cursor:pointer;">+ Add Row</button>'
          + '</div>'
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:680px;">'
              + '<thead><tr>'
                + '<th style="' + thS + 'width:28px;">#</th>'
                + '<th style="' + thS + '">Item</th>'
                + '<th style="' + thS + '">Unit</th>'
                + '<th style="' + thS + '">Qty</th>'
                + '<th style="' + thS + '">Est. Rate</th>'
                + '<th style="' + thS + '">Remarks</th>'
                + '<th style="' + thS + 'width:30px;"></th>'
              + '</tr></thead>'
              + '<tbody id="ppgf-items-tbody">' + _prForm.items.map((it, i) => _itemRowHtml(it, i)).join('') + '</tbody>'
            + '</table>'
          + '</div>'
          + '<div style="text-align:right;margin-top:8px;font-size:13px;color:#374151;">Estimated Total: <strong id="ppgf-form-total" style="color:#1e293b;">' + _money(_formTotal()) + '</strong></div>'
        + '</div>'
      + '</div>'
      + '<div style="padding:14px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;background:#fafafa;">'
        + '<button id="ppgf-modal-cancel" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
        + '<button id="ppgf-modal-save" style="padding:9px 24px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;" ' + (_prSaving ? 'disabled' : '') + '>'
          + (_prSaving ? 'Saving…' : 'Raise Requisition')
        + '</button>'
      + '</div>'
    + '</div></div>';

    document.getElementById('ppgf-backdrop').addEventListener('click', _closePrModal);
    document.getElementById('ppgf-modal-close').addEventListener('click', _closePrModal);
    document.getElementById('ppgf-modal-cancel').addEventListener('click', _closePrModal);
    document.getElementById('ppgf-prtype').addEventListener('change', (e) => {
      _prForm.prType = e.target.value;
      _prForm.items = [_blankPrItem()];
      _renderPrModal();
    });
    document.getElementById('ppgf-add-row-btn').addEventListener('click', () => { _prForm.items.push(_blankPrItem()); _refreshItemsTable(); });
    document.getElementById('ppgf-modal-save').addEventListener('click', () => {
      _prForm.prDate  = document.getElementById('ppgf-date').value;
      _prForm.remarks = document.getElementById('ppgf-remarks').value.trim();
      _savePr();
    });
    _bindVendorField();
    document.querySelectorAll('#ppgf-items-tbody tr[data-ri]').forEach(tr => {
      const ri = parseInt(tr.dataset.ri);
      if (!isNaN(ri)) _bindItemRow(ri, tr);
    });
  }

  /* ── View modal ─────────────────────────────────────────────── */
  function _openViewPr(pr) { _prViewing = pr; _renderPrViewModal(); }
  function _closeViewPr() { _prViewing = null; _renderPrViewModal(); }

  function _renderPrViewModal() {
    const modal = document.getElementById('ppgf-view-modal');
    if (!modal) return;
    if (!_prViewing) { modal.innerHTML = ''; return; }
    const pr = _prViewing;
    const sc = STATUS_COLOR[pr.status] || STATUS_COLOR.pending;
    const thS = 'padding:8px 10px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;';
    const tdS = 'padding:8px 10px;font-size:12.5px;color:#374151;border-bottom:1px solid #f1f5f9;';

    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:55;padding:16px;overflow-y:auto;" id="ppgf-view-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:760px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
      + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
        + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + esc(pr.id) + ' <span style="font-size:11px;font-weight:600;color:#2563eb;background:#eff6ff;padding:2px 8px;border-radius:10px;margin-left:6px;">' + esc(TYPE_LABEL[pr.prType] || pr.prType) + '</span></div>'
          + '<div style="font-size:12px;color:#94a3b8;margin-top:1px;">Raised by ' + esc(pr.requestedBy) + ' on ' + esc(pr.prDate) + '</div></div>'
        + '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;background:' + sc.bg + ';color:' + sc.fg + ';font-size:11.5px;font-weight:700;"><span style="width:5px;height:5px;border-radius:50%;background:' + sc.dot + ';"></span>' + STATUS_LABEL[pr.status] + '</span>'
        + '<button id="ppgf-view-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
        + '</button>'
      + '</div>'
      + '<div style="padding:20px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:14px;">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px;color:#374151;">'
          + '<div><span style="color:#94a3b8;">Vendor:</span> ' + esc(pr.vendorName || '—') + '</div>'
          + '<div><span style="color:#94a3b8;">Remarks:</span> ' + esc(pr.remarks || '—') + '</div>'
        + '</div>'
        + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
          + '<table style="width:100%;border-collapse:collapse;min-width:600px;">'
            + '<thead><tr><th style="' + thS + '">Item</th><th style="' + thS + '">Unit</th><th style="' + thS + 'text-align:right;">Qty</th><th style="' + thS + 'text-align:right;">Rate</th><th style="' + thS + 'text-align:right;">Amount</th><th style="' + thS + '">Remarks</th></tr></thead>'
            + '<tbody>' + (pr.items||[]).map(it =>
              '<tr><td style="' + tdS + '">' + esc(it.itemName) + '</td><td style="' + tdS + '">' + esc(it.unit||'—') + '</td>'
                + '<td style="' + tdS + 'text-align:right;">' + esc(it.quantity) + '</td><td style="' + tdS + 'text-align:right;">' + esc(it.estimatedRate) + '</td>'
                + '<td style="' + tdS + 'text-align:right;font-weight:600;">' + _money(_num(it.quantity)*_num(it.estimatedRate)) + '</td>'
                + '<td style="' + tdS + '">' + esc(it.remarks||'—') + '</td></tr>'
            ).join('') + '</tbody>'
          + '</table>'
        + '</div>'
        + '<div style="text-align:right;font-size:13px;color:#374151;">Estimated Total: <strong style="color:#1e293b;">' + _money(_prTotal(pr)) + '</strong></div>'
        + (_canEdit ? (
          '<div style="display:flex;align-items:center;gap:10px;padding-top:6px;border-top:1px solid #f1f5f9;">'
            + '<span style="font-size:11.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Update Status</span>'
            + '<select id="ppgf-status-select" style="padding:6px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;background:#fff;cursor:pointer;">'
              + STATUSES.map(s => '<option value="' + s + '" ' + (pr.status===s?'selected':'') + '>' + STATUS_LABEL[s] + '</option>').join('')
            + '</select>'
          + '</div>'
        ) : '')
      + '</div>'
      + '<div style="padding:14px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;background:#fafafa;">'
        + (_canDeletePr(pr) ? '<button id="ppgf-view-delete" style="margin-right:auto;padding:9px 18px;border-radius:9px;border:1.5px solid #fecaca;background:#fff5f5;color:#ef4444;font-size:13px;font-weight:600;cursor:pointer;">Delete</button>' : '')
        + '<button id="ppgf-view-ok" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Close</button>'
      + '</div>'
    + '</div></div>';

    document.getElementById('ppgf-view-backdrop').addEventListener('click', _closeViewPr);
    document.getElementById('ppgf-view-close').addEventListener('click', _closeViewPr);
    document.getElementById('ppgf-view-ok').addEventListener('click', _closeViewPr);
    document.getElementById('ppgf-view-delete')?.addEventListener('click', () => _removePr(pr.id));
    document.getElementById('ppgf-status-select')?.addEventListener('change', (e) => _setPrStatus(pr.id, e.target.value));
  }

  /* ── Forms table ────────────────────────────────────────────── */
  function _renderPrTable() {
    const rows = _prFiltered();
    if (!rows.length) {
      return '<div style="padding:56px 24px;text-align:center;">'
        + '<div style="font-size:14px;font-weight:600;color:#374151;">No purchase requisitions found</div>'
        + '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">Try adjusting your search or filters</div>'
      + '</div>';
    }
    const thS = 'padding:10px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;';

    return '<div class="overflow-x-auto"><table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr style="border-bottom:2px solid #e2e8f0;">'
        + '<th style="' + thS + 'text-align:center;width:44px;">#</th>'
        + '<th style="' + thS + '">PR ID</th>'
        + '<th style="' + thS + '">Type</th>'
        + '<th style="' + thS + '">Date</th>'
        + '<th style="' + thS + '">Requested By</th>'
        + '<th style="' + thS + '">Vendor</th>'
        + '<th style="' + thS + 'text-align:center;">Items</th>'
        + '<th style="' + thS + 'text-align:right;">Est. Total</th>'
        + '<th style="' + thS + '">Status</th>'
        + '<th style="' + thS + 'text-align:right;">Actions</th>'
      + '</tr></thead>'
      + '<tbody>'
        + rows.map((pr, i) => {
          const sc = STATUS_COLOR[pr.status] || STATUS_COLOR.pending;
          const tdS = 'padding:12px 14px;font-size:12.5px;color:#374151;border-bottom:1px solid #f1f5f9;';
          const pill = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:' + sc.bg + ';color:' + sc.fg + ';font-size:11px;font-weight:600;"><span style="width:5px;height:5px;border-radius:50%;background:' + sc.dot + ';"></span>' + STATUS_LABEL[pr.status] + '</span>';
          return '<tr style="' + (i % 2 === 1 ? 'background:#fafafa;' : '') + '">'
            + '<td style="' + tdS + 'text-align:center;color:#94a3b8;font-weight:600;">' + (i+1) + '</td>'
            + '<td style="' + tdS + 'font-weight:600;color:#1e293b;">' + esc(pr.id) + '</td>'
            + '<td style="' + tdS + '"><span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:600;">' + esc(TYPE_LABEL[pr.prType] || pr.prType) + '</span></td>'
            + '<td style="' + tdS + '">' + esc(pr.prDate) + '</td>'
            + '<td style="' + tdS + '">' + esc(pr.requestedBy) + '</td>'
            + '<td style="' + tdS + '">' + esc(pr.vendorName || '—') + '</td>'
            + '<td style="' + tdS + 'text-align:center;">' + (pr.items||[]).length + '</td>'
            + '<td style="' + tdS + 'text-align:right;font-weight:600;">' + _money(_prTotal(pr)) + '</td>'
            + '<td style="' + tdS + '">' + pill + '</td>'
            + '<td style="' + tdS + '"><div style="display:flex;gap:6px;justify-content:flex-end;">'
              + '<button class="ppgf-view" data-id="' + pr.id + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:11px;font-weight:600;cursor:pointer;">View</button>'
            + '</div></td>'
          + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  function _renderFormsTab() {
    const rows = _prFiltered();
    const pending = _prs.filter(p => p.status === 'pending').length;
    const totalVal = _prs.reduce((s, p) => s + _prTotal(p), 0);

    return '<div style="display:flex;flex-direction:column;gap:16px;">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;">'
          + '<div><div style="font-size:18px;font-weight:800;color:#1e293b;line-height:1;">' + _prs.length + '</div><div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">Total PRs</div></div>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#fef3c7;border:1px solid #fde68a;">'
          + '<div><div style="font-size:18px;font-weight:800;color:#92400e;line-height:1;">' + pending + '</div><div style="font-size:10.5px;color:#92400e;margin-top:1px;">Pending</div></div>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">'
          + '<div><div style="font-size:18px;font-weight:800;color:#1e293b;line-height:1;">' + _money(totalVal) + '</div><div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">Estimated Value</div></div>'
        + '</div>'
      + '</div>'
      + '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);">'
        + '<div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
          + '<div style="position:relative;flex:1;min-width:200px;">'
            + '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
            + '<input id="ppgf-search" placeholder="Search PR ID, requester, vendor, item…" value="' + esc(_prQ) + '" style="width:100%;box-sizing:border-box;padding:8px 12px 8px 32px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;" />'
          + '</div>'
          + '<select id="ppgf-type-filter" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;color:#374151;cursor:pointer;">'
            + '<option ' + (_prTypeF==='All'?'selected':'') + '>All Types</option>'
            + _typeSelectOptions(_prTypeF !== 'All' ? _prTypeF : null)
          + '</select>'
          + '<select id="ppgf-status-filter" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;color:#374151;cursor:pointer;">'
            + '<option ' + (_prStatusF==='All'?'selected':'') + '>All</option>'
            + STATUSES.map(s => '<option value="' + s + '" ' + (_prStatusF===s?'selected':'') + '>' + STATUS_LABEL[s] + '</option>').join('')
          + '</select>'
          + (_canEdit ? (
            '<div style="display:flex;border:1.5px solid #e2e8f0;border-radius:9px;overflow:hidden;">'
              + '<button id="ppgf-scope-mine" style="padding:7px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:' + (_prScope==='mine'?'var(--color-primary)':'#fff') + ';color:' + (_prScope==='mine'?'#fff':'#64748b') + ';">Mine</button>'
              + '<button id="ppgf-scope-all" style="padding:7px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:' + (_prScope==='all'?'var(--color-primary)':'#fff') + ';color:' + (_prScope==='all'?'#fff':'#64748b') + ';">All</button>'
            + '</div>'
          ) : '')
          + '<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">' + rows.length + ' of ' + _prs.length + '</span>'
          + '<button id="ppgf-add-btn" style="margin-left:auto;padding:8px 16px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;">+ Raise Requisition</button>'
        + '</div>'
        + '<div id="ppgf-table">' + _renderPrTable() + '</div>'
      + '</div>'
    + '</div>';
  }

  function _bindFormsEvents() {
    document.getElementById('ppgf-search')?.addEventListener('input', (e) => {
      _prQ = e.target.value;
      const t = document.getElementById('ppgf-table');
      if (t) t.innerHTML = _renderPrTable();
      _bindPrTableEvents();
    });
    document.getElementById('ppgf-type-filter')?.addEventListener('change', (e) => {
      _prTypeF = e.target.value;
      const t = document.getElementById('ppgf-table');
      if (t) t.innerHTML = _renderPrTable();
      _bindPrTableEvents();
    });
    document.getElementById('ppgf-status-filter')?.addEventListener('change', (e) => {
      _prStatusF = e.target.value;
      const t = document.getElementById('ppgf-table');
      if (t) t.innerHTML = _renderPrTable();
      _bindPrTableEvents();
    });
    document.getElementById('ppgf-scope-mine')?.addEventListener('click', async () => { if (_prScope!=='mine') { _prScope='mine'; await _loadPrs(); } });
    document.getElementById('ppgf-scope-all')?.addEventListener('click', async () => { if (_prScope!=='all') { _prScope='all'; await _loadPrs(); } });
    document.getElementById('ppgf-add-btn')?.addEventListener('click', async () => {
      if (!_itemsLoaded) await _loadItems(true);
      await _loadVendors();
      _openAddPr();
    });
    _bindPrTableEvents();
  }
  function _bindPrTableEvents() {
    document.querySelectorAll('.ppgf-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const pr = _prs.find(x => String(x.id) === String(btn.dataset.id));
        if (pr) _openViewPr(pr);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     FMS TAB — dispatch/shipment tracking (which PR is expected when)
     ═══════════════════════════════════════════════════════════════ */

  function _fmsFiltered() {
    const t = _fmsQ.toLowerCase();
    return _prs
      .filter(pr => (_fmsStatusF === 'All' || pr.status === _fmsStatusF))
      .filter(pr => !t || (pr.id + pr.requestedBy + (pr.vendorName||'') + (pr.items||[]).map(i=>i.itemName).join(' ')).toLowerCase().includes(t))
      .sort((a, b) => {
        // no expected date sorts last; otherwise soonest-first
        if (!a.expectedDate && !b.expectedDate) return 0;
        if (!a.expectedDate) return 1;
        if (!b.expectedDate) return -1;
        return new Date(a.expectedDate) - new Date(b.expectedDate);
      });
  }

  function _daysInfo(pr) {
    if (!pr.expectedDate) return { label: 'Not set', color: '#94a3b8' };
    if (pr.status === 'received') return { label: 'Received', color: '#16a34a' };
    const today = new Date(); today.setHours(0,0,0,0);
    const exp = new Date(pr.expectedDate); exp.setHours(0,0,0,0);
    const diffDays = Math.round((exp - today) / 86400000);
    if (diffDays < 0) return { label: Math.abs(diffDays) + ' day' + (Math.abs(diffDays)===1?'':'s') + ' overdue', color: '#dc2626' };
    if (diffDays === 0) return { label: 'Due today', color: '#f59e0b' };
    return { label: 'In ' + diffDays + ' day' + (diffDays===1?'':'s'), color: '#64748b' };
  }

  async function _setPrExpectedDate(id, expectedDate) {
    await Utils.apiFetch('/api/purchase-requisitions', { method: 'PATCH', body: JSON.stringify({ id, expectedDate }) });
    const pr = _prs.find(x => x.id === id);
    if (pr) pr.expectedDate = expectedDate;
  }

  function _renderFmsTable() {
    const rows = _fmsFiltered();
    if (!rows.length) {
      return '<div style="padding:56px 24px;text-align:center;">'
        + '<div style="font-size:14px;font-weight:600;color:#374151;">No requisitions to track</div>'
        + '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">' + (_fmsStatusF === 'ordered' ? 'Nothing is currently marked Ordered.' : 'Try adjusting your filters.') + '</div>'
      + '</div>';
    }
    const thS = 'padding:10px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;';
    return '<div class="overflow-x-auto"><table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr style="border-bottom:2px solid #e2e8f0;">'
        + '<th style="' + thS + '">PR ID</th>'
        + '<th style="' + thS + '">Type</th>'
        + '<th style="' + thS + '">Vendor</th>'
        + '<th style="' + thS + '">Requested By</th>'
        + '<th style="' + thS + '">PR Date</th>'
        + '<th style="' + thS + '">Expected Date</th>'
        + '<th style="' + thS + '">Days</th>'
        + '<th style="' + thS + '">Status</th>'
        + '<th style="' + thS + 'text-align:right;">Actions</th>'
      + '</tr></thead>'
      + '<tbody>' + rows.map((pr, i) => {
        const sc = STATUS_COLOR[pr.status] || STATUS_COLOR.pending;
        const di = _daysInfo(pr);
        const tdS = 'padding:10px 14px;font-size:12.5px;color:#374151;border-bottom:1px solid #f1f5f9;';
        const pill = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:' + sc.bg + ';color:' + sc.fg + ';font-size:11px;font-weight:600;"><span style="width:5px;height:5px;border-radius:50%;background:' + sc.dot + ';"></span>' + STATUS_LABEL[pr.status] + '</span>';
        return '<tr style="' + (i % 2 === 1 ? 'background:#fafafa;' : '') + '">'
          + '<td style="' + tdS + 'font-weight:600;color:#1e293b;">' + esc(pr.id) + '</td>'
          + '<td style="' + tdS + '"><span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:600;">' + esc(TYPE_LABEL[pr.prType] || pr.prType) + '</span></td>'
          + '<td style="' + tdS + '">' + esc(pr.vendorName || '—') + '</td>'
          + '<td style="' + tdS + '">' + esc(pr.requestedBy) + '</td>'
          + '<td style="' + tdS + '">' + esc(pr.prDate) + '</td>'
          + '<td style="' + tdS + '"><input type="date" class="ppgx-expected" data-id="' + esc(pr.id) + '" value="' + esc(pr.expectedDate || '') + '" style="padding:5px 8px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12px;" /></td>'
          + '<td style="' + tdS + 'color:' + di.color + ';font-weight:600;">' + di.label + '</td>'
          + '<td style="' + tdS + '">' + pill + '</td>'
          + '<td style="' + tdS + '"><div style="display:flex;gap:6px;justify-content:flex-end;">'
            + (pr.status !== 'received' ? '<button class="ppgx-received" data-id="' + esc(pr.id) + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #bbf7d0;background:#f0fdf4;color:#16a34a;font-size:11px;font-weight:600;cursor:pointer;">Mark Received</button>' : '')
            + '<button class="ppgx-view" data-id="' + esc(pr.id) + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:11px;font-weight:600;cursor:pointer;">View</button>'
          + '</div></td>'
        + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function _renderFmsTab() {
    const rows = _fmsFiltered();
    const overdue = _prs.filter(pr => pr.status === 'ordered' && pr.expectedDate && new Date(pr.expectedDate) < new Date(new Date().toDateString())).length;
    const ordered = _prs.filter(pr => pr.status === 'ordered').length;

    return '<div style="display:flex;flex-direction:column;gap:16px;">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;">'
          + '<div><div style="font-size:18px;font-weight:800;color:#1e293b;line-height:1;">' + ordered + '</div><div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">Awaiting Delivery</div></div>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;">'
          + '<div><div style="font-size:18px;font-weight:800;color:#dc2626;line-height:1;">' + overdue + '</div><div style="font-size:10.5px;color:#dc2626;margin-top:1px;">Overdue</div></div>'
        + '</div>'
      + '</div>'
      + '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);">'
        + '<div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
          + '<div style="position:relative;flex:1;min-width:200px;">'
            + '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
            + '<input id="ppgx-search" placeholder="Search PR ID, vendor, item…" value="' + esc(_fmsQ) + '" style="width:100%;box-sizing:border-box;padding:8px 12px 8px 32px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;" />'
          + '</div>'
          + '<select id="ppgx-status-filter" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;color:#374151;cursor:pointer;">'
            + '<option value="ordered" ' + (_fmsStatusF==='ordered'?'selected':'') + '>Awaiting Delivery</option>'
            + '<option value="All" ' + (_fmsStatusF==='All'?'selected':'') + '>All Requisitions</option>'
          + '</select>'
          + '<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">' + rows.length + ' shown</span>'
        + '</div>'
        + '<div id="ppgx-table">' + _renderFmsTable() + '</div>'
      + '</div>'
    + '</div>';
  }

  function _bindFmsEvents() {
    document.getElementById('ppgx-search')?.addEventListener('input', (e) => {
      _fmsQ = e.target.value;
      const t = document.getElementById('ppgx-table');
      if (t) t.innerHTML = _renderFmsTable();
      _bindFmsTableEvents();
    });
    document.getElementById('ppgx-status-filter')?.addEventListener('change', (e) => {
      _fmsStatusF = e.target.value;
      _renderTabContent();
    });
    _bindFmsTableEvents();
  }
  function _bindFmsTableEvents() {
    document.querySelectorAll('.ppgx-expected').forEach(inp => {
      inp.addEventListener('change', async () => {
        await _setPrExpectedDate(inp.dataset.id, inp.value || null);
        Utils.showToast('Expected date updated');
        const t = document.getElementById('ppgx-table');
        if (t) t.innerHTML = _renderFmsTable();
        _bindFmsTableEvents();
      });
    });
    document.querySelectorAll('.ppgx-received').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Utils.apiFetch('/api/purchase-requisitions', { method: 'PATCH', body: JSON.stringify({ id: btn.dataset.id, status: 'received' }) });
        const pr = _prs.find(x => x.id === btn.dataset.id);
        if (pr) pr.status = 'received';
        Utils.showToast('Marked as Received');
        _renderTabContent();
      });
    });
    document.querySelectorAll('.ppgx-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const pr = _prs.find(x => String(x.id) === String(btn.dataset.id));
        if (pr) _openViewPr(pr);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     SHELL — tab bar + page render
     ═══════════════════════════════════════════════════════════════ */

  function _renderTabBar() {
    return '<div style="display:flex;gap:4px;margin-bottom:16px;background:#f1f5f9;padding:4px;border-radius:11px;width:fit-content;">'
      + _tabBtn('masters', 'Masters')
      + _tabBtn('forms', 'Forms')
      + _tabBtn('fms', 'FMS')
    + '</div>';
  }
  function _tabBtn(key, label) {
    const active = _tab === key;
    return '<button class="ppg-tab-btn" data-tab="' + key + '" style="padding:8px 20px;border-radius:8px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:' + (active?'#fff':'transparent') + ';color:' + (active?'#1e293b':'#64748b') + ';box-shadow:' + (active?'0 1px 3px rgba(0,0,0,.08)':'none') + ';">' + label + '</button>';
  }
  function _bindTabBar() {
    document.querySelectorAll('.ppg-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.tab;
        if (key === _tab) return;
        _tab = key;
        if (!_itemsLoaded) await _loadItems(true);
        if (key === 'forms' || key === 'fms') { await _loadVendors(); await _loadPrs(true); }
        _render();
      });
    });
  }

  function _currentTabHtml() {
    if (_tab === 'masters') return _renderMastersTab();
    if (_tab === 'fms')     return _renderFmsTab();
    return _renderFormsTab();
  }
  function _bindCurrentTab() {
    if (_tab === 'masters')      { _bindMastersEvents(); _renderItemModal(); }
    else if (_tab === 'fms')     { _bindFmsEvents(); }
    else                          { _bindFormsEvents(); _renderPrModal(); _renderPrViewModal(); }
  }

  function _renderTabContent() {
    const el = document.getElementById('ppg-tab-content');
    if (!el) { _render(); return; }
    el.innerHTML = _currentTabHtml();
    _bindCurrentTab();
  }

  function _render() {
    const main = document.getElementById('main-content');
    if (!main) return;
    _canEdit = window.Sidebar?._isAdmin(window.currentUser) || false;

    main.innerHTML = '<div style="padding:20px;max-width:1400px;margin:0 auto;">'
      + '<div style="margin-bottom:4px;"><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Procurement</span></div>'
      + _renderTabBar()
      + '<div id="ppg-tab-content">' + _currentTabHtml() + '</div>'
      + '<div id="ppgm-modal"></div>'
      + '<div id="ppgf-modal"></div>'
      + '<div id="ppgf-view-modal"></div>'
    + '</div>';

    _bindTabBar();
    _bindCurrentTab();
  }

  return {
    async render() {
      const main = document.getElementById('main-content');
      if (main) main.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;letter-spacing:.01em;">Loading…</div></div></div>';
      _canEdit = window.Sidebar?._isAdmin(window.currentUser) || false;
      _prScope = _canEdit ? 'all' : 'mine';
      await _loadItems(true);
      _render();
    },
  };
})();
