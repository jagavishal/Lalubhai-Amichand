window.Pages = window.Pages || {};

window.Pages['packing-master'] = (() => {
  /* ── State ──────────────────────────────────────────────────── */
  let _list    = [];
  let _q       = '';
  let _group   = 'All';
  let _open    = false;
  let _editing = null;
  let _saving  = false;
  let _canEdit = false;
  let _form    = _blankForm();

  /* ── Helpers ────────────────────────────────────────────────── */
  function _blankForm() {
    return {
      itemName:'', sizeLabel:'', pcsPerBox:'', lengthIn:'', widthIn:'', heightIn:'',
      plyType:'', productCode:'', barcode:'', cbmPerBox:'', customerGroup:'', remarks:'',
    };
  }

  function _groups() {
    const set = new Set();
    _list.forEach(p => { if (p.customer_group) set.add(p.customer_group); });
    return Array.from(set).sort();
  }

  function _filtered() {
    const t = _q.toLowerCase();
    return _list.filter(p =>
      (_group === 'All' || (p.customer_group||'(general)') === _group) &&
      (!t || (p.id + p.item_name + (p.size_label||'') + (p.product_code||'') + (p.barcode||'') + (p.customer_group||'')).toLowerCase().includes(t))
    );
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── API ────────────────────────────────────────────────────── */
  async function _load(skipRender) {
    try {
      const res = await Utils.apiFetch('/api/packing-items');
      _list = Array.isArray(res) ? res : [];
    } catch { _list = []; }
    if (!skipRender) _render();
  }

  async function _save() {
    if (!_form.itemName.trim()) { Utils.showToast('Item name is required', 'error'); return; }
    _saving = true; _renderModal();
    try {
      const method = _editing !== null ? 'PATCH' : 'POST';
      const body   = _editing !== null ? { id: _editing, ..._form } : _form;
      await Utils.apiFetch('/api/packing-items', { method, body: JSON.stringify(body) });
      _open = false; _editing = null; _form = _blankForm();
      Utils.showToast(_editing !== null ? 'Item updated' : 'Item added');
    } catch(e) {
      Utils.showToast(e.message || 'Failed to save', 'error');
    } finally { _saving = false; }
    await _load();
  }

  async function _remove(id) {
    if (!await Utils.showConfirm('This packing-box item will be permanently removed.', { title: 'Delete Item', confirmText: 'Delete', danger: true })) return;
    await Utils.apiFetch('/api/packing-items?id=' + id, { method: 'DELETE' });
    Utils.showToast('Item deleted');
    await _load();
  }

  /* ── Modal helpers ──────────────────────────────────────────── */
  function _openAdd()  { _editing = null; _form = _blankForm(); _open = true; _render(); }
  function _openEdit(p) {
    _editing = p.id;
    _form = {
      itemName: p.item_name||'', sizeLabel: p.size_label||'', pcsPerBox: p.pcs_per_box||'',
      lengthIn: p.length_in||'', widthIn: p.width_in||'', heightIn: p.height_in||'',
      plyType: p.ply_type||'', productCode: p.product_code||'', barcode: p.barcode||'',
      cbmPerBox: p.cbm_per_box||'', customerGroup: p.customer_group||'', remarks: p.remarks||'',
    };
    _open = true; _render();
  }
  function _closeModal() { _open = false; _editing = null; _form = _blankForm(); _render(); }

  function _fld(id, label, v, ph) {
    return '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">' + label + '</label>'
      + '<input class="input" id="' + id + '" type="text" value="' + esc(v) + '" placeholder="' + (ph||'') + '" style="width:100%;box-sizing:border-box;" /></div>';
  }

  function _renderModal() {
    const modal = document.getElementById('pk-modal');
    if (!modal) return;
    if (!_open) { modal.innerHTML = ''; return; }
    const title = _editing !== null ? 'Edit Packing Item' : 'Add Packing Item';
    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="pk-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:640px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
      + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
        + '<div style="width:38px;height:38px;border-radius:10px;background:#fff8f5;display:grid;place-items:center;flex-shrink:0;">'
          + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4714A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>'
        + '</div>'
        + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + title + '</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">Fill in packing-box specification</div></div>'
        + '<button id="pk-modal-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;" onmouseenter="this.style.background=\'#f1f5f9\'" onmouseleave="this.style.background=\'transparent\'">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
        + '</button>'
      + '</div>'
      + '<div style="padding:22px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px;">'
        + _fld('pk-itemName', 'Item Name *', _form.itemName, 'e.g. New Milk Jug Bright')
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('pk-sizeLabel','Size',_form.sizeLabel,'e.g. 11 or No.2') + _fld('pk-pcsPerBox','Pcs / Box',_form.pcsPerBox,'e.g. 24') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">' + _fld('pk-lengthIn','L (in)',_form.lengthIn,'') + _fld('pk-widthIn','W (in)',_form.widthIn,'') + _fld('pk-heightIn','H (in)',_form.heightIn,'') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('pk-plyType','Ply Type',_form.plyType,'e.g. 7 ply') + _fld('pk-cbmPerBox','CBM / Box',_form.cbmPerBox,'e.g. 0.09252') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('pk-productCode','Product Code',_form.productCode,'') + _fld('pk-barcode','Barcode',_form.barcode,'') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('pk-customerGroup','Customer / Group',_form.customerGroup,'e.g. MIDDLE EAST') + _fld('pk-remarks','Remarks',_form.remarks,'') + '</div>'
      + '</div>'
      + '<div style="padding:14px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;background:#fafafa;">'
        + '<button id="pk-modal-cancel" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
        + '<button id="pk-modal-save" style="padding:9px 24px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;" ' + (_saving ? 'disabled' : '') + '>'
          + (_saving ? 'Saving…' : (_editing !== null ? 'Update Item' : 'Add Item'))
        + '</button>'
      + '</div>'
    + '</div></div>';

    document.getElementById('pk-backdrop').addEventListener('click', _closeModal);
    document.getElementById('pk-modal-close').addEventListener('click', _closeModal);
    document.getElementById('pk-modal-cancel').addEventListener('click', _closeModal);
    document.getElementById('pk-modal-save').addEventListener('click', () => {
      _form.itemName      = document.getElementById('pk-itemName').value.trim();
      _form.sizeLabel      = document.getElementById('pk-sizeLabel').value.trim();
      _form.pcsPerBox       = document.getElementById('pk-pcsPerBox').value.trim();
      _form.lengthIn        = document.getElementById('pk-lengthIn').value.trim();
      _form.widthIn         = document.getElementById('pk-widthIn').value.trim();
      _form.heightIn        = document.getElementById('pk-heightIn').value.trim();
      _form.plyType         = document.getElementById('pk-plyType').value.trim();
      _form.cbmPerBox       = document.getElementById('pk-cbmPerBox').value.trim();
      _form.productCode     = document.getElementById('pk-productCode').value.trim();
      _form.barcode         = document.getElementById('pk-barcode').value.trim();
      _form.customerGroup   = document.getElementById('pk-customerGroup').value.trim();
      _form.remarks         = document.getElementById('pk-remarks').value.trim();
      _save();
    });
  }

  /* ── Table ──────────────────────────────────────────────────── */
  function _renderTable() {
    const rows = _filtered();
    if (!rows.length) {
      return '<div style="padding:56px 24px;text-align:center;">'
        + '<div style="width:48px;height:48px;border-radius:12px;background:#f1f5f9;display:grid;place-items:center;margin:0 auto 12px;">'
          + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>'
        + '</div>'
        + '<div style="font-size:14px;font-weight:600;color:#374151;">No packing items found</div>'
        + '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">Try adjusting your search or filter</div>'
      + '</div>';
    }

    const thS = 'padding:10px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;';
    const actionTh = _canEdit ? '<th style="' + thS + 'text-align:right;">Actions</th>' : '';

    return '<div class="overflow-x-auto"><table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr style="border-bottom:2px solid #e2e8f0;">'
        + '<th style="' + thS + 'text-align:center;width:44px;">#</th>'
        + '<th style="' + thS + '">Item Code</th>'
        + '<th style="' + thS + '">Item Name</th>'
        + '<th style="' + thS + '">Size</th>'
        + '<th style="' + thS + 'text-align:right;">Pcs/Box</th>'
        + '<th style="' + thS + 'text-align:right;">L × W × H (in)</th>'
        + '<th style="' + thS + '">Ply</th>'
        + '<th style="' + thS + 'text-align:right;">CBM/Box</th>'
        + '<th style="' + thS + '">Barcode</th>'
        + '<th style="' + thS + '">Customer / Group</th>'
        + actionTh
      + '</tr></thead>'
      + '<tbody>'
        + rows.map((p, i) => {
          const tdS = 'padding:10px 14px;font-size:12.5px;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap;';
          const dims = [p.length_in, p.width_in, p.height_in].filter(v => v).join(' × ') || '—';
          const actionTd = _canEdit
            ? '<td style="' + tdS + '"><div style="display:flex;gap:6px;justify-content:flex-end;">'
              + '<button class="js-edit" data-id="' + p.id + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:11px;font-weight:600;cursor:pointer;">Edit</button>'
              + '<button class="js-delete" data-id="' + p.id + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #fecaca;background:#fff5f5;color:#ef4444;font-size:11px;font-weight:600;cursor:pointer;">Delete</button>'
              + '</div></td>' : '';
          return '<tr style="' + (i % 2 === 1 ? 'background:#fafafa;' : '') + '" onmouseenter="this.style.background=\'#fff8f5\'" onmouseleave="this.style.background=\'' + (i % 2 === 1 ? '#fafafa' : 'transparent') + '\'">'
            + '<td style="' + tdS + 'text-align:center;color:#94a3b8;font-weight:600;">' + (i+1) + '</td>'
            + '<td style="' + tdS + 'font-weight:600;color:#1e293b;">' + esc(p.id) + '</td>'
            + '<td style="' + tdS + 'white-space:normal;min-width:220px;">' + esc(p.item_name) + (p.remarks ? '<div style="font-size:11px;color:#f59e0b;margin-top:1px;">' + esc(p.remarks) + '</div>' : '') + '</td>'
            + '<td style="' + tdS + '">' + esc(p.size_label||'—') + '</td>'
            + '<td style="' + tdS + 'text-align:right;">' + esc(p.pcs_per_box||'—') + '</td>'
            + '<td style="' + tdS + 'text-align:right;">' + esc(dims) + '</td>'
            + '<td style="' + tdS + '">' + esc(p.ply_type||'—') + '</td>'
            + '<td style="' + tdS + 'text-align:right;">' + esc(p.cbm_per_box||'—') + '</td>'
            + '<td style="' + tdS + '">' + esc(p.barcode||'—') + '</td>'
            + '<td style="' + tdS + '">' + (p.customer_group ? '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:600;">' + esc(p.customer_group) + '</span>' : '<span style="color:#94a3b8;">General</span>') + '</td>'
            + actionTd
          + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  function _renderContent() {
    const rows = _filtered();
    const groups = _groups();

    return '<div style="display:flex;flex-direction:column;gap:16px;">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.04);">'
          + '<div style="width:32px;height:32px;border-radius:8px;background:#f8fafc;display:grid;place-items:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg></div>'
          + '<div><div style="font-size:18px;font-weight:800;color:#1e293b;line-height:1;">' + _list.length + '</div><div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">Total Items</div></div>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;">'
          + '<div style="width:32px;height:32px;border-radius:8px;background:#dbeafe;display:grid;place-items:center;"><span style="width:8px;height:8px;border-radius:50%;background:#2563eb;"></span></div>'
          + '<div><div style="font-size:18px;font-weight:800;color:#2563eb;line-height:1;">' + groups.length + '</div><div style="font-size:10.5px;color:#1d4ed8;margin-top:1px;">Customer Groups</div></div>'
        + '</div>'
      + '</div>'
      + '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);">'
        + '<div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
          + '<div style="position:relative;flex:1;min-width:200px;">'
            + '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
            + '<input id="pk-search" placeholder="Search item code, name, size, barcode…" value="' + esc(_q) + '" style="width:100%;box-sizing:border-box;padding:8px 12px 8px 32px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;" onfocus="this.style.borderColor=\'var(--color-primary)\';this.style.background=\'#fff\'" onblur="this.style.borderColor=\'#e2e8f0\';this.style.background=\'#f8fafc\'" />'
          + '</div>'
          + '<select id="pk-group-filter" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;color:#374151;cursor:pointer;">'
            + '<option ' + (_group==='All'?'selected':'') + '>All</option>'
            + groups.map(g => '<option ' + (_group===g?'selected':'') + '>' + esc(g) + '</option>').join('')
          + '</select>'
          + '<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">' + rows.length + ' of ' + _list.length + '</span>'
          + (_canEdit ? '<button id="pk-add-btn" style="margin-left:auto;padding:8px 16px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;">+ Add Item</button>' : '')
        + '</div>'
        + '<div id="pk-table">' + _renderTable() + '</div>'
      + '</div>'
    + '</div>';
  }

  function _bindEvents() {
    document.getElementById('pk-search')?.addEventListener('input', (e) => {
      _q = e.target.value;
      const t = document.getElementById('pk-table');
      if (t) t.innerHTML = _renderTable();
      _bindTableEvents();
    });
    document.getElementById('pk-group-filter')?.addEventListener('change', (e) => {
      _group = e.target.value;
      const t = document.getElementById('pk-table');
      if (t) t.innerHTML = _renderTable();
      _bindTableEvents();
    });
    document.getElementById('pk-add-btn')?.addEventListener('click', _openAdd);
    _bindTableEvents();
  }

  function _bindTableEvents() {
    document.querySelectorAll('.js-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = _list.find(x => String(x.id) === String(btn.dataset.id));
        if (p) _openEdit(p);
      });
    });
    document.querySelectorAll('.js-delete').forEach(btn => {
      btn.addEventListener('click', () => _remove(btn.dataset.id));
    });
  }

  /* ── Page render ────────────────────────────────────────────── */
  function _render() {
    const main = document.getElementById('main-content');
    if (!main) return;
    _canEdit = window.Sidebar?._isAdmin(window.currentUser) || false;

    main.innerHTML = '<div style="padding:20px;max-width:1400px;margin:0 auto;">'
      + '<div id="pk-content">' + _renderContent() + '</div>'
      + '<div id="pk-modal"></div>'
    + '</div>';

    _bindEvents();
    _renderModal();
  }

  return {
    async render() {
      const main = document.getElementById('main-content');
      if (main) main.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;letter-spacing:.01em;">Loading…</div></div></div>';
      await _load(true);
      _render();
    },
  };
})();
