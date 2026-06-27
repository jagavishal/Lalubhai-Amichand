window.Pages = window.Pages || {};

window.Pages['client-master'] = (() => {
  /* ── State ──────────────────────────────────────────────────── */
  let _list    = [];
  let _q       = '';
  let _status  = 'All';
  let _open    = false;
  let _editing = null;
  let _saving  = false;
  let _canEdit = false;
  let _form    = _blankForm();
  let _tab     = 'vendors';

  // Payment grid state
  let _pmRows     = [];   // [{ id, vendorId, vendorSearch, amount, txnType, narration, checked }]
  let _pmSaving   = false;
  let _pmSaved    = false;

  /* ── Helpers ────────────────────────────────────────────────── */
  function _blankForm() {
    return {
      name:'', mobile:'', email:'', state:'', district:'', address:'', pin:'',
      bankName:'', accountHolder:'', accountNo:'', ifscCode:'', branchName:'',
      status:'active',
    };
  }

  function _blankRow() { return { id: null, vendorId: null, vendorSearch: '', amount: '', txnType: 'N', narration: '', checked: false }; }

  function _initRows(saved) {
    _pmRows = (Array.isArray(saved) ? saved : [])
      .map(e => ({ id: e.id || null, vendorId: e.vendor_id || e.vendorId || null, vendorSearch: '', amount: e.amount || '', txnType: e.txn_type || e.txnType || 'N', narration: e.narration || '', checked: false }));
    _resolveVendorNames();
    while (_pmRows.length < 10) _pmRows.push(_blankRow());
  }

  function _resolveVendorNames() {
    _pmRows.forEach(row => {
      if (row.vendorId && !row.vendorSearch) {
        const v = _list.find(x => String(x.id) === String(row.vendorId));
        if (v) row.vendorSearch = v.name;
      }
    });
  }

  function _filtered() {
    const t = _q.toLowerCase();
    return _list.filter(c =>
      (_status === 'All' || c.status === _status.toLowerCase()) &&
      (!t || (c.name + (c.mobile||'') + (c.email||'') + (c.state||'') + (c.district||'')).toLowerCase().includes(t))
    );
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── API ────────────────────────────────────────────────────── */
  async function _load(skipRender) {
    try {
      const res = await Utils.apiFetch('/api/clients');
      _list = Array.isArray(res) ? res : [];
    } catch { _list = []; }
    _resolveVendorNames();
    if (!skipRender) _render();
  }

  async function _save() {
    if (!_form.name.trim()) { Utils.showToast('Vendor name is required', 'error'); return; }
    _saving = true; _renderModal();
    try {
      const method = _editing !== null ? 'PATCH' : 'POST';
      const body   = _editing !== null ? { id: _editing, ..._form } : _form;
      await Utils.apiFetch('/api/clients', { method, body: JSON.stringify(body) });
      _open = false; _editing = null; _form = _blankForm();
      Utils.showToast(_editing !== null ? 'Vendor updated' : 'Vendor added');
    } catch(e) {
      Utils.showToast(e.message || 'Failed to save', 'error');
    } finally { _saving = false; }
    await _load();
  }

  async function _remove(id) {
    if (!await Utils.showConfirm('All vendor data will be permanently removed.', { title: 'Delete Vendor', confirmText: 'Delete', danger: true })) return;
    await Utils.apiFetch('/api/clients?id=' + id, { method: 'DELETE' });
    Utils.showToast('Vendor deleted');
    await _load();
  }

  /* ── Modal helpers ──────────────────────────────────────────── */
  function _openAdd()  { _editing = null; _form = _blankForm(); _open = true; _render(); }
  function _openEdit(c) {
    _editing = c.id;
    _form = {
      name: c.name||'', mobile: c.mobile||c.contact_number||'', email: c.email||'',
      state: c.state||'', district: c.district||'', address: c.address||'', pin: c.pin||'',
      bankName: c.bank_name||'', accountHolder: c.account_holder||'',
      accountNo: c.account_no||'', ifscCode: c.ifsc_code||'', branchName: c.branch_name||'',
      status: c.status||'active',
    };
    _open = true; _render();
  }
  function _closeModal() { _open = false; _editing = null; _form = _blankForm(); _render(); }

  function _fld(id, label, v, type, ph) {
    return '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">' + label + '</label>'
      + '<input class="input" id="' + id + '" type="' + (type||'text') + '" value="' + esc(v) + '" placeholder="' + (ph||'') + '" style="width:100%;box-sizing:border-box;" /></div>';
  }

  function _renderModal() {
    const modal = document.getElementById('cm-modal');
    if (!modal) return;
    if (!_open) { modal.innerHTML = ''; return; }
    const title = _editing !== null ? 'Edit Vendor' : 'Add Vendor';
    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="cm-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:600px;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
      + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">'
        + '<div style="width:38px;height:38px;border-radius:10px;background:#fff8f5;display:grid;place-items:center;flex-shrink:0;">'
          + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4714A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        + '</div>'
        + '<div style="flex:1;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + title + '</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">Fill in vendor information</div></div>'
        + '<button id="cm-modal-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;" onmouseenter="this.style.background=\'#f1f5f9\'" onmouseleave="this.style.background=\'transparent\'">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
        + '</button>'
      + '</div>'
      + '<div style="padding:22px 24px;max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:20px;">'
        + '<div>'
          + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">'
            + '<div style="width:26px;height:26px;border-radius:7px;background:#eff6ff;display:grid;place-items:center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>'
            + '<span style="font-size:12px;font-weight:700;color:#1e293b;letter-spacing:.01em;">Basic Details</span>'
          + '</div>'
          + '<div style="display:grid;gap:12px;">'
            + _fld('cm-name', 'Name *', _form.name, 'text', 'Vendor / Company name')
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('cm-mobile','Mobile No.',_form.mobile,'tel','10-digit mobile') + _fld('cm-email','Email',_form.email,'email','vendor@email.com') + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('cm-state','State',_form.state,'text','e.g. Rajasthan') + _fld('cm-district','District',_form.district,'text','e.g. Jaipur') + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 120px;gap:12px;">' + _fld('cm-address','Address',_form.address,'text','Street / Area') + _fld('cm-pin','Pin Code',_form.pin,'text','6-digit PIN') + '</div>'
            + '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">Status</label>'
              + '<select class="input" id="cm-status" style="width:100%;box-sizing:border-box;"><option value="active" ' + (_form.status==='active'?'selected':'') + '>Active</option><option value="inactive" ' + (_form.status==='inactive'?'selected':'') + '>Inactive</option></select></div>'
          + '</div>'
        + '</div>'
        + '<div style="height:1px;background:#f1f5f9;"></div>'
        + '<div>'
          + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">'
            + '<div style="width:26px;height:26px;border-radius:7px;background:#f0fdf4;display:grid;place-items:center;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg></div>'
            + '<span style="font-size:12px;font-weight:700;color:#1e293b;letter-spacing:.01em;">Bank Details</span>'
          + '</div>'
          + '<div style="display:grid;gap:12px;">'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('cm-bankName','Bank Name',_form.bankName,'text','e.g. SBI, HDFC') + _fld('cm-accountHolder','Account Holder',_form.accountHolder,'text','As per bank records') + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('cm-accountNo','Account No.',_form.accountNo,'text','Bank account number') + _fld('cm-ifscCode','IFSC Code',_form.ifscCode,'text','e.g. SBIN0001234') + '</div>'
            + _fld('cm-branchName','Branch Name',_form.branchName,'text','Branch location')
          + '</div>'
        + '</div>'
      + '</div>'
      + '<div style="padding:14px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;background:#fafafa;">'
        + '<button id="cm-modal-cancel" style="padding:9px 22px;border-radius:9px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
        + '<button id="cm-modal-save" style="padding:9px 24px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;" ' + (_saving ? 'disabled' : '') + '>'
          + (_saving ? 'Saving…' : (_editing !== null ? 'Update Vendor' : 'Add Vendor'))
        + '</button>'
      + '</div>'
    + '</div></div>';

    document.getElementById('cm-backdrop').addEventListener('click', _closeModal);
    document.getElementById('cm-modal-close').addEventListener('click', _closeModal);
    document.getElementById('cm-modal-cancel').addEventListener('click', _closeModal);
    document.getElementById('cm-modal-save').addEventListener('click', () => {
      _form.name          = document.getElementById('cm-name').value.trim();
      _form.mobile        = document.getElementById('cm-mobile').value.trim();
      _form.email         = document.getElementById('cm-email').value.trim();
      _form.state         = document.getElementById('cm-state').value.trim();
      _form.district      = document.getElementById('cm-district').value.trim();
      _form.address       = document.getElementById('cm-address').value.trim();
      _form.pin           = document.getElementById('cm-pin').value.trim();
      _form.status        = document.getElementById('cm-status').value;
      _form.bankName      = document.getElementById('cm-bankName').value.trim();
      _form.accountHolder = document.getElementById('cm-accountHolder').value.trim();
      _form.accountNo     = document.getElementById('cm-accountNo').value.trim();
      _form.ifscCode      = document.getElementById('cm-ifscCode').value.trim().toUpperCase();
      _form.branchName    = document.getElementById('cm-branchName').value.trim();
      _save();
    });
  }

  /* ── Vendor List tab ────────────────────────────────────────── */
  function _renderTable() {
    const rows = _filtered();
    if (!rows.length) {
      return '<div style="padding:56px 24px;text-align:center;">'
        + '<div style="width:48px;height:48px;border-radius:12px;background:#f1f5f9;display:grid;place-items:center;margin:0 auto 12px;">'
          + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        + '</div>'
        + '<div style="font-size:14px;font-weight:600;color:#374151;">No vendors found</div>'
        + '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">Try adjusting your search or filter</div>'
      + '</div>';
    }

    const thS = 'padding:10px 16px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;';
    const actionTh = _canEdit ? '<th style="' + thS + 'text-align:right;">Actions</th>' : '';

    return '<div class="overflow-x-auto"><table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr style="border-bottom:2px solid #e2e8f0;">'
        + '<th style="' + thS + 'text-align:center;width:44px;">#</th>'
        + '<th style="' + thS + '">Name</th>'
        + '<th style="' + thS + '">Mobile</th>'
        + '<th style="' + thS + '">Email</th>'
        + '<th style="' + thS + '">State</th>'
        + '<th style="' + thS + '">District</th>'
        + '<th style="' + thS + '">Bank</th>'
        + '<th style="' + thS + '">Status</th>'
        + actionTh
      + '</tr></thead>'
      + '<tbody>'
        + rows.map((c, i) => {
          const pill = c.status === 'active'
            ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:#f0fdf4;color:#16a34a;font-size:11px;font-weight:600;"><span style="width:5px;height:5px;border-radius:50%;background:#16a34a;"></span>Active</span>'
            : '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;"><span style="width:5px;height:5px;border-radius:50%;background:#94a3b8;"></span>Inactive</span>';
          const tdS = 'padding:12px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f1f5f9;';
          const actionTd = _canEdit
            ? '<td style="' + tdS + '"><div style="display:flex;gap:6px;justify-content:flex-end;">'
              + '<button class="js-edit" data-id="' + c.id + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:11px;font-weight:600;cursor:pointer;">Edit</button>'
              + '<button class="js-delete" data-id="' + c.id + '" style="padding:4px 12px;border-radius:6px;border:1.5px solid #fecaca;background:#fff5f5;color:#ef4444;font-size:11px;font-weight:600;cursor:pointer;">Delete</button>'
              + '</div></td>' : '';
          return '<tr style="' + (i % 2 === 1 ? 'background:#fafafa;' : '') + '" onmouseenter="this.style.background=\'#fff8f5\'" onmouseleave="this.style.background=\'' + (i % 2 === 1 ? '#fafafa' : 'transparent') + '\'">'
            + '<td style="' + tdS + 'text-align:center;color:#94a3b8;font-weight:600;">' + (i+1) + '</td>'
            + '<td style="' + tdS + '">'
              + '<div style="font-weight:600;color:#1e293b;">' + esc(c.name) + '</div>'
              + (c.email ? '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">' + esc(c.email) + '</div>' : '')
            + '</td>'
            + '<td style="' + tdS + '">' + esc(c.mobile||c.contact_number||'—') + '</td>'
            + '<td style="' + tdS + '">' + esc(c.email||'—') + '</td>'
            + '<td style="' + tdS + '">' + esc(c.state||'—') + '</td>'
            + '<td style="' + tdS + '">' + esc(c.district||'—') + '</td>'
            + '<td style="' + tdS + '">' + esc(c.bank_name||'—') + '</td>'
            + '<td style="' + tdS + '">' + pill + '</td>'
            + actionTd
          + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  function _renderVendorTab() {
    const rows = _filtered();
    const active   = _list.filter(c => c.status === 'active').length;
    const inactive = _list.filter(c => c.status !== 'active').length;

    return '<div style="display:flex;flex-direction:column;gap:16px;">'
      // Stat chips
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.04);">'
          + '<div style="width:32px;height:32px;border-radius:8px;background:#f8fafc;display:grid;place-items:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>'
          + '<div><div style="font-size:18px;font-weight:800;color:#1e293b;line-height:1;">' + _list.length + '</div><div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">Total</div></div>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#f0fdf4;border:1px solid #bbf7d0;">'
          + '<div style="width:32px;height:32px;border-radius:8px;background:#dcfce7;display:grid;place-items:center;"><span style="width:8px;height:8px;border-radius:50%;background:#16a34a;"></span></div>'
          + '<div><div style="font-size:18px;font-weight:800;color:#16a34a;line-height:1;">' + active + '</div><div style="font-size:10.5px;color:#15803d;margin-top:1px;">Active</div></div>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">'
          + '<div style="width:32px;height:32px;border-radius:8px;background:#f1f5f9;display:grid;place-items:center;"><span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;"></span></div>'
          + '<div><div style="font-size:18px;font-weight:800;color:#64748b;line-height:1;">' + inactive + '</div><div style="font-size:10.5px;color:#94a3b8;margin-top:1px;">Inactive</div></div>'
        + '</div>'
      + '</div>'
      // Table card
      + '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);">'
        + '<div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
          + '<div style="position:relative;flex:1;min-width:200px;">'
            + '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
            + '<input id="cm-search" placeholder="Search name, mobile, email…" value="' + esc(_q) + '" style="width:100%;box-sizing:border-box;padding:8px 12px 8px 32px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;" onfocus="this.style.borderColor=\'#C4714A\';this.style.background=\'#fff\'" onblur="this.style.borderColor=\'#e2e8f0\';this.style.background=\'#f8fafc\'" />'
          + '</div>'
          + '<select id="cm-status-filter" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;color:#374151;cursor:pointer;">'
            + '<option ' + (_status==='All'?'selected':'') + '>All</option>'
            + '<option ' + (_status==='Active'?'selected':'') + '>Active</option>'
            + '<option ' + (_status==='Inactive'?'selected':'') + '>Inactive</option>'
          + '</select>'
          + '<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">' + rows.length + ' of ' + _list.length + '</span>'
        + '</div>'
        + '<div id="cm-table">' + _renderTable() + '</div>'
      + '</div>'
    + '</div>';
  }

  /* ── Payment Management – Excel grid ───────────────────────── */
  function _pmAllChecked() {
    const filled = _pmRows.filter(r => r.vendorId && r.amount && parseFloat(r.amount) > 0);
    return filled.length > 0 && filled.every(r => r.checked);
  }

  function _pmCheckedCount() {
    return _pmRows.filter(r => r.checked && r.vendorId && r.amount && parseFloat(r.amount) > 0).length;
  }

  function _pmRowHtml(row, i) {
    const v       = row.vendorId ? _list.find(x => String(x.id) === String(row.vendorId)) : null;
    const hasData = !!(row.vendorId || row.vendorSearch || row.amount || row.narration);
    const cellS   = 'padding:5px 8px;border-right:1px solid #f0f4f8;';
    const autoS   = 'font-size:12.5px;color:' + (v ? '#374151' : '#cbd5e1') + ';padding:7px 10px;';
    const monoS   = autoS + 'font-family:monospace;letter-spacing:.04em;';
    const txn     = row.txnType || 'N';
    const chkd    = row.checked && v && row.amount;
    const rowBg   = chkd ? 'background:#f0fff8;' : (i % 2 === 1 ? 'background:#fafbfc;' : '');

    return '<tr data-ri="' + i + '" style="border-bottom:1px solid #eef2f7;' + rowBg + '">'
      // Checkbox
      + '<td style="' + cellS + 'text-align:center;width:36px;padding:5px 4px;">'
        + (hasData
          ? '<input type="checkbox" class="pm-row-chk" data-ri="' + i + '" ' + (chkd ? 'checked' : '') + ' style="width:15px;height:15px;cursor:pointer;accent-color:var(--color-primary);" />'
          : '<span style="display:block;width:15px;height:15px;border:1.5px solid #e2e8f0;border-radius:3px;margin:auto;background:#f8fafc;"></span>')
      + '</td>'
      // S.No
      + '<td style="' + cellS + 'text-align:center;width:32px;color:#94a3b8;font-size:12px;font-weight:600;padding:5px 4px;">' + (i+1) + '</td>'
      // Txn Type - N / R / I
      + '<td style="' + cellS + 'width:64px;padding:4px 5px;">'
        + '<select class="pm-txn-inp" data-ri="' + i + '" style="width:100%;padding:6px 6px;border:1.5px solid #e9ecef;border-radius:7px;font-size:13px;font-weight:700;color:#1e293b;outline:none;background:#fff;cursor:pointer;">'
          + '<option value="N" ' + (txn==='N'?'selected':'') + '>N</option>'
          + '<option value="R" ' + (txn==='R'?'selected':'') + '>R</option>'
          + '<option value="I" ' + (txn==='I'?'selected':'') + '>I</option>'
        + '</select>'
      + '</td>'
      // Name - editable with search
      + '<td style="' + cellS + 'min-width:180px;padding:4px 5px;">'
        + '<div style="position:relative;">'
          + '<input class="pm-name-inp" data-ri="' + i + '" type="text" placeholder="Search vendor…" autocomplete="off" value="' + esc(row.vendorSearch) + '" '
            + 'style="width:100%;box-sizing:border-box;padding:6px 10px;border:1.5px solid ' + (v ? 'var(--color-primary)' : '#e9ecef') + ';border-radius:7px;font-size:13px;font-weight:' + (v?'600':'400') + ';color:#1e293b;outline:none;background:' + (v?'#fff8f5':'#fff') + ';transition:border-color .15s;" />'
          + '<div class="pm-dd" data-ri="' + i + '" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;min-width:230px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;z-index:300;box-shadow:0 10px 32px rgba(0,0,0,.14);max-height:200px;overflow-y:auto;"></div>'
        + '</div>'
      + '</td>'
      // Amount - editable
      + '<td style="' + cellS + 'min-width:120px;padding:4px 5px;">'
        + '<div style="display:flex;align-items:center;gap:4px;border:1.5px solid #e9ecef;border-radius:7px;padding:6px 9px;background:' + (row.amount?'#f8fff9':'#fff') + ';transition:border-color .15s;" onfocusin="this.style.borderColor=\'#059669\';this.style.background=\'#f0fdf4\'" onfocusout="this.style.borderColor=\'#e9ecef\';this.style.background=\'' + (row.amount?'#f8fff9':'#fff') + '\'">'
          + '<span style="color:#94a3b8;font-size:12px;font-weight:600;">₹</span>'
          + '<input class="pm-amount-inp" data-ri="' + i + '" type="number" min="0" step="0.01" placeholder="0.00" value="' + esc(row.amount) + '" '
            + 'style="border:none;outline:none;background:transparent;font-size:13px;font-weight:700;color:#1e293b;width:100%;" />'
        + '</div>'
      + '</td>'
      // Narration
      + '<td style="' + cellS + 'min-width:150px;padding:4px 5px;">'
        + '<input class="pm-narr-inp" data-ri="' + i + '" type="text" placeholder="Bill no / narration…" value="' + esc(row.narration) + '" '
          + 'style="width:100%;box-sizing:border-box;padding:6px 10px;border:1.5px solid ' + (row.narration?'#6366f1':'#e9ecef') + ';border-radius:7px;font-size:12px;color:#374151;outline:none;background:' + (row.narration?'#f5f5ff':'#fff') + ';transition:border-color .15s;" '
          + 'onfocus="this.style.borderColor=\'#6366f1\';this.style.background=\'#f5f5ff\'" onblur="this.style.borderColor=\'' + (row.narration?'#6366f1':'#e9ecef') + '\';this.style.background=\'' + (row.narration?'#f5f5ff':'#fff') + '\'" />'
      + '</td>'
      // Auto-filled cells
      + '<td style="' + cellS + 'min-width:100px;"><span class="pm-auto-span" style="' + autoS + '">' + esc(v?.bank_name||'—') + '</span></td>'
      + '<td style="' + cellS + 'min-width:120px;"><span class="pm-auto-span" style="' + autoS + '">' + esc(v?.account_holder||'—') + '</span></td>'
      + '<td style="' + cellS + 'min-width:140px;"><span class="pm-auto-span" style="' + monoS + '">' + esc(v?.account_no||'—') + '</span></td>'
      + '<td style="' + cellS + 'min-width:100px;"><span class="pm-auto-span" style="' + monoS + '">' + esc(v?.ifsc_code||'—') + '</span></td>'
      + '<td style="' + cellS + 'min-width:100px;border-right:none;"><span class="pm-auto-span" style="' + autoS + '">' + esc(v?.branch_name||'—') + '</span></td>'
      // Clear
      + '<td style="padding:5px 6px;text-align:center;width:32px;">'
        + (hasData
          ? '<button class="pm-clear-row" data-ri="' + i + '" title="Clear row" style="background:transparent;border:none;cursor:pointer;color:#d1d5db;padding:3px;line-height:1;" onmouseenter="this.style.color=\'#ef4444\'" onmouseleave="this.style.color=\'#d1d5db\'">'
              + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
            + '</button>'
          : '')
      + '</td>'
    + '</tr>';
  }

  function _renderPaymentTab() {
    const filledRows  = _pmRows.filter(r => r.vendorId && r.amount && parseFloat(r.amount) > 0);
    const checkedRows = filledRows.filter(r => r.checked);
    const total       = filledRows.reduce((s, r) => s + parseFloat(r.amount||0), 0);
    const selTotal    = checkedRows.reduce((s, r) => s + parseFloat(r.amount||0), 0);
    const allChk      = _pmAllChecked();

    const thS = 'padding:10px 12px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f4f6f9;text-align:left;white-space:nowrap;border-bottom:2px solid #e2e8f0;border-right:1px solid #eaecef;';

    const saveLabel = _pmSaving ? 'Saving…' : (_pmSaved ? '✓ Saved' : 'Save Draft');

    return '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">'
      // Header
      + '<div style="padding:14px 20px;border-bottom:1px solid #f0f4f8;background:linear-gradient(to right,#fafbfc,#f8fafc);">'
        + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
          + '<div>'
            + '<div style="font-size:14px;font-weight:700;color:#1e293b;">Payment Entries</div>'
            + '<div id="pm-subheader" style="font-size:11px;color:#94a3b8;margin-top:2px;">'
              + filledRows.length + ' filled &nbsp;·&nbsp; Total: <strong style="color:#1e293b;">₹' + total.toLocaleString('en-IN', {minimumFractionDigits:2}) + '</strong>'
              + (checkedRows.length ? ' &nbsp;·&nbsp; <span style="color:#059669;font-weight:600;">' + checkedRows.length + ' selected ₹' + selTotal.toLocaleString('en-IN', {minimumFractionDigits:2}) + '</span>' : '')
            + '</div>'
          + '</div>'
          + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
            + '<button id="pm-save-btn" style="display:flex;align-items:center;gap:6px;padding:7px 16px;font-size:12px;font-weight:600;border:1.5px solid var(--color-primary);border-radius:8px;background:#fff;color:var(--color-primary);cursor:pointer;" ' + (_pmSaving ? 'disabled' : '') + ' onmouseenter="this.style.background=\'var(--color-primary-light)\'" onmouseleave="this.style.background=\'#fff\'">'
              + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>' + saveLabel
            + '</button>'
            + '<button id="pm-excel-btn" style="display:flex;align-items:center;gap:6px;padding:7px 16px;font-size:12px;font-weight:600;border:none;border-radius:8px;background:#059669;color:#fff;cursor:pointer;" onmouseenter="this.style.background=\'#047857\'" onmouseleave="this.style.background=\'#059669\'">'
              + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
              + (checkedRows.length ? 'Export ' + checkedRows.length + ' Selected' : 'Export Excel')
            + '</button>'
          + '</div>'
        + '</div>'
        + (checkedRows.length === 0 && filledRows.length > 0
          ? '<div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:#fef3c7;border:1px solid #fde68a;font-size:11.5px;color:#92400e;">Tick checkboxes on left to select rows for export</div>'
          : '')
      + '</div>'
      // Table
      + '<div style="overflow-x:auto;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:960px;">'
          + '<thead><tr>'
            + '<th style="' + thS + 'text-align:center;width:36px;">'
              + '<input type="checkbox" id="pm-chk-all" ' + (allChk ? 'checked' : '') + ' style="width:15px;height:15px;cursor:pointer;accent-color:var(--color-primary);" />'
            + '</th>'
            + '<th style="' + thS + 'text-align:center;width:32px;">#</th>'
            + '<th style="' + thS + 'width:64px;">Txn</th>'
            + '<th style="' + thS + 'min-width:180px;">Beneficiary Name</th>'
            + '<th style="' + thS + 'min-width:120px;">Amount</th>'
            + '<th style="' + thS + 'min-width:150px;">Narration / Ref No.</th>'
            + '<th style="' + thS + 'min-width:100px;">Bank</th>'
            + '<th style="' + thS + 'min-width:120px;">Account Holder</th>'
            + '<th style="' + thS + 'min-width:140px;">Account No.</th>'
            + '<th style="' + thS + 'min-width:100px;">IFSC</th>'
            + '<th style="' + thS + 'min-width:100px;border-right:none;">Branch</th>'
            + '<th style="' + thS + 'width:32px;border-right:none;"></th>'
          + '</tr></thead>'
          + '<tbody id="pm-tbody">'
            + _pmRows.map((r, i) => _pmRowHtml(r, i)).join('')
          + '</tbody>'
        + '</table>'
      + '</div>'
      // Footer
      + '<div style="padding:10px 14px;border-top:1px solid #f0f4f8;background:#fafbfc;display:flex;align-items:center;gap:12px;">'
        + '<button id="pm-add-rows-btn" style="display:flex;align-items:center;gap:6px;padding:6px 14px;font-size:12px;font-weight:600;border:1.5px dashed #d1d5db;border-radius:7px;background:transparent;color:#64748b;cursor:pointer;" onmouseenter="this.style.borderColor=\'var(--color-primary)\';this.style.color=\'var(--color-primary)\'" onmouseleave="this.style.borderColor=\'#d1d5db\';this.style.color=\'#64748b\'">'
          + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
          + 'Add 5 more rows'
        + '</button>'
        + '<span style="font-size:11px;color:#94a3b8;margin-left:auto;">Entries are saved to server — accessible from any device</span>'
      + '</div>'
    + '</div>';
  }

  function _refreshPmTbody() {
    const tbody = document.getElementById('pm-tbody');
    if (!tbody) return;
    tbody.innerHTML = _pmRows.map((r, i) => _pmRowHtml(r, i)).join('');
    _bindPaymentRowEvents();
  }

  function _updatePmHeader() {
    const filledRows  = _pmRows.filter(r => r.vendorId && r.amount && parseFloat(r.amount) > 0);
    const checkedRows = filledRows.filter(r => r.checked);
    const total    = filledRows.reduce((s, r) => s + parseFloat(r.amount||0), 0);
    const selTotal = checkedRows.reduce((s, r) => s + parseFloat(r.amount||0), 0);
    const sub = document.querySelector('#pm-subheader');
    if (sub) {
      sub.innerHTML = filledRows.length + ' filled &nbsp;·&nbsp; Total: <strong style="color:#1e293b;">₹' + total.toLocaleString('en-IN', {minimumFractionDigits:2}) + '</strong>'
        + (checkedRows.length ? ' &nbsp;·&nbsp; <span style="color:#059669;font-weight:600;">' + checkedRows.length + ' selected ₹' + selTotal.toLocaleString('en-IN', {minimumFractionDigits:2}) + '</span>' : '');
    }
    // Update Export button label
    const excelBtn = document.getElementById('pm-excel-btn');
    if (excelBtn) {
      const svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      excelBtn.innerHTML = svg + (checkedRows.length ? 'Export ' + checkedRows.length + ' Selected' : 'Export Excel');
    }
    // Update select-all checkbox
    const allChk = document.getElementById('pm-chk-all');
    if (allChk) allChk.checked = _pmAllChecked();
  }

  /* ── Payment event binding ─────────────────────────────────── */
  function _buildDropdown(ddEl, q, excludeRows) {
    const qt = q.trim().toLowerCase();
    const usedIds = _pmRows.filter((r,ri) => !excludeRows.includes(ri)).map(r => String(r.vendorId));
    let matches = qt
      ? _list.filter(v => v.name.toLowerCase().includes(qt) || (v.mobile||'').includes(qt))
      : _list.slice();
    if (!matches.length) {
      ddEl.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:#94a3b8;">No vendors found</div>';
      return;
    }
    matches.sort((a, b) => {
      const aU = usedIds.includes(String(a.id));
      const bU = usedIds.includes(String(b.id));
      return aU === bU ? 0 : (aU ? 1 : -1);
    });
    ddEl.innerHTML = matches.slice(0, 40).map(v => {
      const used = usedIds.includes(String(v.id));
      return '<div class="pm-dd-opt" data-vid="' + v.id + '" style="padding:9px 14px;cursor:pointer;border-bottom:1px solid #f8fafc;">'
        + '<div style="font-size:13px;font-weight:600;color:' + (used ? '#94a3b8' : '#1e293b') + ';">' + esc(v.name) + (used ? ' <span style="font-size:10px;font-weight:400;">(added)</span>' : '') + '</div>'
        + (v.mobile ? '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">' + esc(v.mobile) + '</div>' : '')
      + '</div>';
    }).join('');
  }

  // Bind search + delegation for a single row — works even after _buildDropdown rebuilds innerHTML
  function _bindSingleRow(ri, rowEl) {
    const inp    = rowEl.querySelector('.pm-name-inp[data-ri="' + ri + '"]');
    const ddEl   = rowEl.querySelector('.pm-dd[data-ri="' + ri + '"]');
    const amtInp = rowEl.querySelector('.pm-amount-inp[data-ri="' + ri + '"]');
    const clearBtn = rowEl.querySelector('.pm-clear-row[data-ri="' + ri + '"]');
    const chkBox = rowEl.querySelector('.pm-row-chk[data-ri="' + ri + '"]');

    if (chkBox) {
      chkBox.addEventListener('change', () => {
        _pmRows[ri].checked = chkBox.checked;
        rowEl.style.background = chkBox.checked ? '#f0fff8' : (ri % 2 === 1 ? '#fafbfc' : '');
        _updatePmHeader();
      });
    }

    if (inp && ddEl) {
      inp.addEventListener('focus', () => {
        _buildDropdown(ddEl, inp.value, [ri]);
        ddEl.style.display = 'block';
      });
      inp.addEventListener('input', () => {
        _pmRows[ri].vendorId     = null;
        _pmRows[ri].vendorSearch = inp.value;
        inp.style.fontWeight     = '400';
        inp.style.borderColor    = '#e9ecef';
        inp.style.background     = '#fff';
        _buildDropdown(ddEl, inp.value, [ri]);
        ddEl.style.display = 'block';
        const tr = rowEl.closest ? rowEl : document.querySelector('tr[data-ri="' + ri + '"]');
        if (tr) {
          tr.querySelectorAll('.pm-auto-span').forEach(span => {
            span.textContent = '—'; span.style.color = '#cbd5e1';
          });
        }
      });
      inp.addEventListener('blur', () => {
        setTimeout(() => {
          ddEl.style.display = 'none';
          if (!_pmRows[ri].vendorId) { _pmRows[ri].vendorSearch = ''; inp.value = ''; }
        }, 160);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') { ddEl.style.display = 'none'; inp.blur(); }
      });

      // Delegation — handles dynamically created .pm-dd-opt items
      ddEl.addEventListener('mouseover', e => {
        const opt = e.target.closest('.pm-dd-opt');
        ddEl.querySelectorAll('.pm-dd-opt').forEach(o => { o.style.background = ''; });
        if (opt) opt.style.background = '#f1f5f9';
      });
      ddEl.addEventListener('mouseout', e => {
        const opt = e.target.closest('.pm-dd-opt');
        if (opt) opt.style.background = '';
      });
      ddEl.addEventListener('mousedown', e => {
        e.preventDefault();
        const opt = e.target.closest('.pm-dd-opt');
        if (!opt) return;
        const v = _list.find(x => String(x.id) === String(opt.dataset.vid));
        if (!v) return;
        _pmRows[ri].vendorId     = v.id;
        _pmRows[ri].vendorSearch = v.name;
        inp.value             = v.name;
        inp.style.fontWeight  = '600';
        inp.style.borderColor = '#C4714A';
        inp.style.background  = '#fff8f5';
        ddEl.style.display    = 'none';
        // Fill auto cells in this row
        const tr = document.querySelector('tr[data-ri="' + ri + '"]');
        if (tr) {
          const spans = tr.querySelectorAll('.pm-auto-span');
          const vals  = [v.bank_name, v.account_holder, v.account_no, v.ifsc_code, v.branch_name];
          spans.forEach((span, si) => {
            if (si < vals.length) { span.textContent = vals[si] || '—'; span.style.color = '#374151'; }
          });
          // Show clear button if not already there
          const clearCell = tr.querySelector('td:last-child');
          if (clearCell && !clearCell.querySelector('.pm-clear-row')) {
            clearCell.innerHTML = '<button class="pm-clear-row" data-ri="' + ri + '" title="Clear row" style="background:transparent;border:none;cursor:pointer;color:#d1d5db;padding:3px;line-height:1;" onmouseenter="this.style.color=\'#ef4444\'" onmouseleave="this.style.color=\'#d1d5db\'">'
              + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
            + '</button>';
            clearCell.querySelector('.pm-clear-row').addEventListener('click', () => {
              _pmRows[ri] = _blankRow(); _refreshPmRow(ri); _updatePmHeader();
            });
          }
        }
        const amtI = document.querySelector('.pm-amount-inp[data-ri="' + ri + '"]');
        if (amtI) amtI.focus();
        _updatePmHeader();
      });
    }

    if (amtInp) {
      amtInp.addEventListener('input', () => { _pmRows[ri].amount = amtInp.value; _updatePmHeader(); });
    }
    const txnInp  = rowEl.querySelector('.pm-txn-inp[data-ri="'  + ri + '"]');
    const narrInp = rowEl.querySelector('.pm-narr-inp[data-ri="' + ri + '"]');
    if (txnInp)  txnInp.addEventListener('change', () => { _pmRows[ri].txnType  = txnInp.value; });
    if (narrInp) narrInp.addEventListener('input',  () => { _pmRows[ri].narration = narrInp.value; });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { _pmRows[ri] = _blankRow(); _refreshPmRow(ri); _updatePmHeader(); });
    }
  }

  function _bindPaymentRowEvents() {
    document.querySelectorAll('tr[data-ri]').forEach(tr => {
      const ri = parseInt(tr.dataset.ri);
      if (!isNaN(ri)) _bindSingleRow(ri, tr);
    });
  }

  function _refreshPmRow(ri) {
    const tr = document.querySelector('tr[data-ri="' + ri + '"]');
    if (!tr) return;
    const tmp = document.createElement('tbody');
    tmp.innerHTML = _pmRowHtml(_pmRows[ri], ri);
    const newTr = tmp.firstElementChild;
    tr.replaceWith(newTr);
    _bindSingleRow(ri, newTr);
  }

  function _bindPaymentTabEvents() {
    _bindPaymentRowEvents();

    // Select All checkbox
    document.getElementById('pm-chk-all')?.addEventListener('change', (e) => {
      const check = e.target.checked;
      _pmRows.forEach((r, i) => {
        if (r.vendorId && r.amount && parseFloat(r.amount) > 0) {
          r.checked = check;
          const tr = document.querySelector('tr[data-ri="' + i + '"]');
          if (tr) {
            tr.style.background = check ? '#f0fff8' : (i % 2 === 1 ? '#fafbfc' : '');
            const chk = tr.querySelector('.pm-row-chk');
            if (chk) chk.checked = check;
          }
        }
      });
      _updatePmHeader();
    });

    document.getElementById('pm-add-rows-btn')?.addEventListener('click', () => {
      for (let i = 0; i < 5; i++) _pmRows.push(_blankRow());
      _refreshPmTbody();
      _updatePmHeader();
    });

    document.getElementById('pm-save-btn')?.addEventListener('click', async () => {
      if (_pmSaving) return;
      _pmSaving = true; _pmSaved = false;
      const saveBtn = document.getElementById('pm-save-btn');
      if (saveBtn) saveBtn.textContent = 'Saving…';
      try {
        const entries = _pmRows
          .filter(r => r.vendorId && r.amount)
          .map(r => ({ vendorId: r.vendorId, amount: r.amount, txnType: r.txnType || 'N', narration: r.narration || '' }));
        const res = await fetch('/api/payment-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }),
        });
        if (!res.ok) throw new Error('Server error');
        _pmSaved = true;
        Utils.showToast('Draft entries saved to server', 'success');
      } catch { Utils.showToast('Failed to save', 'error'); }
      finally { _pmSaving = false; }
      if (saveBtn) {
        saveBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>✓ Saved';
        setTimeout(() => {
          if (saveBtn.textContent.includes('Saved')) saveBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save Draft';
        }, 2500);
      }
    });

    document.getElementById('pm-excel-btn')?.addEventListener('click', async () => {
      const toExport = _pmRows.filter(r => r.checked && r.vendorId && r.amount && parseFloat(r.amount) > 0);
      // Fall back: if nothing checked but rows exist, warn
      if (!toExport.length) {
        const allFilled = _pmRows.filter(r => r.vendorId && r.amount && parseFloat(r.amount) > 0);
        if (!allFilled.length) { Utils.showToast('No filled entries to export', 'warning'); return; }
        Utils.showToast('Please tick the checkboxes for rows you want to export', 'warning');
        return;
      }

      const today = new Date();
      const dd    = String(today.getDate()).padStart(2,'0');
      const mm    = String(today.getMonth()+1).padStart(2,'0');
      const yyyy  = today.getFullYear();
      const dateStr   = dd + '/' + mm + '/' + yyyy;
      const batchLabel = 'Export ' + dd + '/' + mm + '/' + yyyy;

      function qf(s) { return '"' + String(s||'').replace(/"/g,'""') + '"'; }

      const hdr = ['Transaction Type','Beneficiary Code','Beneficiary Account Number','Transaction Amount','Beneficiary Name','Instruction Reference Number','Debit Statement Narration','Chq / Trn Date','IFSC Code','Beneficiary email id'];
      const csvRows = [hdr.join(',')];
      let sno = 1;
      const exportedIds = [];
      toExport.forEach(entry => {
        const v = _list.find(x => String(x.id) === String(entry.vendorId));
        if (!v) return;
        if (entry.id) exportedIds.push(entry.id);
        csvRows.push([
          entry.txnType || 'N', sno++,
          qf("'" + (v.account_no || '')),
          parseFloat(entry.amount || 0).toFixed(2),
          qf(v.name), qf(entry.narration || ''), '',
          dateStr, qf(v.ifsc_code || ''), '',
        ].join(','));
      });

      const csv  = csvRows.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'RBI_Bulk_' + yyyy + mm + dd + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);

      // Mark exported rows in DB (best-effort)
      if (exportedIds.length) {
        try {
          await fetch('/api/payment-entries', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: exportedIds, batchLabel }),
          });
          // Remove exported rows from draft grid
          _pmRows = _pmRows.filter(r => !exportedIds.includes(r.id));
          while (_pmRows.length < 10) _pmRows.push(_blankRow());
          _refreshPmTbody();
          _updatePmHeader();
        } catch { /* silently ignore — file is already downloaded */ }
      }
      Utils.showToast('RBI bulk file downloaded — ' + toExport.length + ' entries exported', 'success');
    });
  }

  /* ── Main render ────────────────────────────────────────────── */
  function _render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const tabBtn = (id, label, active) =>
      '<button id="' + id + '" style="padding:7px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;'
      + 'background:' + (active ? '#fff' : 'transparent') + ';color:' + (active ? '#C4714A' : '#64748b') + ';'
      + 'box-shadow:' + (active ? '0 1px 4px rgba(0,0,0,.08)' : 'none') + ';">' + label + '</button>';

    el.innerHTML = '<div style="padding:20px;max-width:1280px;margin:0 auto;">'
      // Page header
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:10px;">'
        + '<div>'
          + '<h1 style="font-size:20px;font-weight:800;color:#1e293b;margin:0;letter-spacing:-.3px;">Vendor Master</h1>'
          + '<p style="font-size:12px;color:#94a3b8;margin:3px 0 0;">Manage vendors and payment information</p>'
        + '</div>'
        + (_tab === 'vendors' && _canEdit
          ? '<button id="cm-add-btn" style="display:flex;align-items:center;gap:6px;padding:9px 20px;border-radius:10px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(196,113,74,.3);" onmouseenter="this.style.background=\'#b5603a\'" onmouseleave="this.style.background=\'#C4714A\'">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Add Vendor'
          + '</button>'
          : '')
      + '</div>'
      // Tabs
      + '<div style="display:flex;gap:3px;padding:4px;background:#f1f5f9;border-radius:11px;width:fit-content;margin-bottom:20px;">'
        + tabBtn('tab-vendors', 'Vendor List', _tab === 'vendors')
        + tabBtn('tab-payments', 'Payment Management', _tab === 'payments')
      + '</div>'
      // Content
      + '<div id="cm-tab-content">' + (_tab === 'vendors' ? _renderVendorTab() : _renderPaymentTab()) + '</div>'
      + '<div id="cm-modal"></div>'
    + '</div>';

    document.getElementById('tab-vendors').addEventListener('click', () => { _tab = 'vendors'; _render(); });
    document.getElementById('tab-payments').addEventListener('click', () => { _tab = 'payments'; _render(); });
    document.getElementById('cm-add-btn')?.addEventListener('click', _openAdd);

    _bindTableButtons();
    if (_tab === 'payments') _bindPaymentTabEvents();
    _renderModal();
  }

  function _bindTableButtons() {
    document.getElementById('cm-search')?.addEventListener('input', e => {
      _q = e.target.value;
      document.getElementById('cm-table').innerHTML = _renderTable();
      _bindTableButtons();
    });
    document.getElementById('cm-status-filter')?.addEventListener('change', e => {
      _status = e.target.value;
      document.getElementById('cm-table').innerHTML = _renderTable();
      _bindTableButtons();
    });
    document.querySelectorAll('.js-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = _list.find(x => String(x.id) === String(btn.dataset.id));
        if (c) _openEdit(c);
      });
    });
    document.querySelectorAll('.js-delete').forEach(btn => {
      btn.addEventListener('click', () => _remove(btn.dataset.id));
    });
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    async render() {
      _canEdit = (window.currentUser?.roles || []).some
        ? (window.currentUser?.roles || []).some(r => r === 'Admin' || r === 'HOD')
        : String(window.currentUser?.roles || '').includes('Admin');
      _q = ''; _status = 'All'; _open = false; _editing = null; _saving = false;
      _pmSaving = false; _pmSaved = false;
      _form = _blankForm(); _list = [];
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div>';
      // Load vendor list + draft payment entries in parallel, then render once
      const [, draftRes] = await Promise.all([
        _load(true),
        fetch('/api/payment-entries').then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      _initRows(Array.isArray(draftRes) ? draftRes : []);
      _render();
    },
  };
})();
