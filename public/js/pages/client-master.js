window.Pages = window.Pages || {};

window.Pages['client-master'] = (() => {
  /* ── Constants ──────────────────────────────────────────────── */
  const DIVISIONS = ['Export', 'Others', 'Trading', 'Wirerod', 'SSCD Ahd', 'Retail (Satelite)', 'Retail (Bopal)'];

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
  let _pmRows     = [];
  let _pmSaving   = false;
  let _pmSaved    = false;

  // Payment History state
  let _phRows       = [];
  let _phMonth      = '';
  let _phOpenBatch  = null;
  let _phBillsVendor = null;

  /* ── Helpers ────────────────────────────────────────────────── */
  function _blankForm() {
    return {
      name:'', mobile:'', email:'', state:'', district:'', address:'', pin:'',
      bankName:'', accountHolder:'', accountNo:'', ifscCode:'', branchName:'',
      status:'active', division:'',
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
      status: c.status||'active', division: c.division||'',
    };
    _open = true; _render();
  }
  function _closeModal() { _open = false; _editing = null; _form = _blankForm(); _render(); }

  function _fld(id, label, v, type, ph, maxlen) {
    return '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">' + label + '</label>'
      + '<input class="input" id="' + id + '" type="' + (type||'text') + '" value="' + esc(v) + '" placeholder="' + (ph||'') + '" ' + (maxlen ? 'maxlength="' + maxlen + '"' : '') + ' style="width:100%;box-sizing:border-box;" /></div>';
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
            + _fld('cm-name', 'Name *', _form.name, 'text', 'Vendor / Company name', 40)
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('cm-mobile','Mobile No.',_form.mobile,'tel','10-digit mobile') + _fld('cm-email','Email',_form.email,'email','vendor@email.com', 100) + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('cm-state','State',_form.state,'text','e.g. Rajasthan') + _fld('cm-district','District',_form.district,'text','e.g. Jaipur') + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 120px;gap:12px;">' + _fld('cm-address','Address',_form.address,'text','Street / Area') + _fld('cm-pin','Pin Code',_form.pin,'text','6-digit PIN') + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
              + '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">Status</label>'
                + '<select class="input" id="cm-status" style="width:100%;box-sizing:border-box;"><option value="active" ' + (_form.status==='active'?'selected':'') + '>Active</option><option value="inactive" ' + (_form.status==='inactive'?'selected':'') + '>Inactive</option></select></div>'
              + '<div><label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:5px;">Division</label>'
                + '<select class="input" id="cm-division" style="width:100%;box-sizing:border-box;"><option value="">Select division…</option>'
                  + DIVISIONS.map(d => '<option value="' + esc(d) + '" ' + (_form.division===d?'selected':'') + '>' + esc(d) + '</option>').join('')
                + '</select></div>'
            + '</div>'
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
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' + _fld('cm-accountNo','Account No.',_form.accountNo,'text','Bank account number', 25) + _fld('cm-ifscCode','IFSC Code',_form.ifscCode,'text','e.g. SBIN0001234', 15) + '</div>'
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
      _form.division      = document.getElementById('cm-division').value;
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
        + '<th style="' + thS + '">Division</th>'
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
            + '<td style="' + tdS + '">' + esc(c.division||'—') + '</td>'
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
            + '<input id="cm-search" placeholder="Search name, mobile, email…" value="' + esc(_q) + '" style="width:100%;box-sizing:border-box;padding:8px 12px 8px 32px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;outline:none;background:#f8fafc;" onfocus="this.style.borderColor=\'var(--color-primary)\';this.style.background=\'#fff\'" onblur="this.style.borderColor=\'#e2e8f0\';this.style.background=\'#f8fafc\'" />'
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
          + '<input class="pm-amount-inp" data-ri="' + i + '" type="number" min="0" step="0.01" max="99999999999999999.99" maxlength="20" placeholder="0.00" value="' + esc(row.amount) + '" '
            + 'style="border:none;outline:none;background:transparent;font-size:13px;font-weight:700;color:#1e293b;width:100%;" />'
        + '</div>'
      + '</td>'
      // Narration
      + '<td style="' + cellS + 'min-width:150px;padding:4px 5px;">'
        + '<input class="pm-narr-inp" data-ri="' + i + '" type="text" maxlength="20" placeholder="Bill no / narration…" value="' + esc(row.narration) + '" '
          + 'style="width:100%;box-sizing:border-box;padding:6px 10px;border:1.5px solid ' + (row.narration?'#6366f1':'#e9ecef') + ';border-radius:7px;font-size:12px;color:#374151;outline:none;background:' + (row.narration?'#f5f5ff':'#fff') + ';transition:border-color .15s;" '
          + 'onfocus="this.style.borderColor=\'#6366f1\';this.style.background=\'#f5f5ff\'" onblur="this.style.borderColor=\'' + (row.narration?'#6366f1':'#e9ecef') + '\';this.style.background=\'' + (row.narration?'#f5f5ff':'#fff') + '\'" />'
      + '</td>'
      // Auto-filled cells
      + '<td style="' + cellS + 'min-width:110px;"><span class="pm-auto-span" style="' + autoS + '">' + esc(v?.division||'—') + '</span></td>'
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
            + '<th style="' + thS + 'min-width:110px;">Division</th>'
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
          const vals  = [v.division, v.bank_name, v.account_holder, v.account_no, v.ifsc_code, v.branch_name];
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
      const dateStr    = dd + '/' + mm + '/' + yyyy;
      const batchLabel = 'Export ' + dd + '/' + mm + '/' + yyyy;
      const fileStamp  = yyyy + mm + dd;

      function downloadBlob(content, mime, filename) {
        const blob = new Blob([content], { type: mime });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      // Build one shared row-data array.
      const exportedIds = [];
      const rows = [];
      let sno = 1;
      toExport.forEach(entry => {
        const v = _list.find(x => String(x.id) === String(entry.vendorId));
        if (!v) return;
        if (entry.id) exportedIds.push(entry.id);
        rows.push({
          sno: sno++,
          division: v.division || '',
          txnType: entry.txnType || 'N',
          accountNo: v.account_no || '',
          amount: parseFloat(entry.amount || 0),
          name: v.name || '',
          narration: entry.narration || '',
          ifsc: v.ifsc_code || '',
        });
      });

      // Notepad (.txt) — no header row; each line has 26 comma-separated slots with the
      // bank's reserved/blank columns in between (matches the bank's exact raw template —
      // positions 0,1,2,3,4 = type/code/account/amount/name, 12 = reference, 20 = date, 22 = IFSC).
      const csvRows = [];
      rows.forEach(r => {
        const line = new Array(26).fill('');
        line[0]  = r.txnType;
        line[1]  = r.sno;
        line[2]  = r.accountNo;
        line[3]  = r.amount;
        line[4]  = r.name;
        line[12] = r.narration;
        line[20] = dateStr;
        line[22] = r.ifsc;
        csvRows.push(line.join(','));
      });
      downloadBlob(csvRows.join('\r\n'), 'text/plain;charset=utf-8;', 'RBI_Bulk_' + fileStamp + '.txt');

      // Excel (.xlsx) — human-readable workbook with a division-wise summary.
      if (window.XLSX) {
        const wb = window.XLSX.utils.book_new();

        const puAoa = [['Sr No','Division','Transaction Type','Beneficiary Account Number','Transaction Amount','Beneficiary Name','Debit Statement Narration','Chq / Trn Date','IFSC Code']];
        rows.forEach(r => puAoa.push([r.sno, r.division, r.txnType, r.accountNo, r.amount, r.name, r.narration, dateStr, r.ifsc]));
        const wsPU = window.XLSX.utils.aoa_to_sheet(puAoa);
        rows.forEach((r, i) => {
          const cellRef = 'D' + (i + 2); // keep account numbers as text so a leading zero isn't dropped
          if (wsPU[cellRef]) wsPU[cellRef].t = 's';
        });
        wsPU['!cols'] = [{ wch:6 },{ wch:16 },{ wch:8 },{ wch:20 },{ wch:14 },{ wch:26 },{ wch:22 },{ wch:12 },{ wch:13 }];
        window.XLSX.utils.book_append_sheet(wb, wsPU, 'Payment Upload');

        const divTotals = {};
        rows.forEach(r => {
          const key = r.division || '(No Division)';
          if (!divTotals[key]) divTotals[key] = { amount: 0, count: 0 };
          divTotals[key].amount += r.amount;
          divTotals[key].count  += 1;
        });
        const divAoa = [['Division','Total Amount','No. of Payments']];
        Object.keys(divTotals).sort().forEach(k => divAoa.push([k, divTotals[k].amount, divTotals[k].count]));
        divAoa.push(['GRAND TOTAL', rows.reduce((s, r) => s + r.amount, 0), rows.length]);
        const wsDiv = window.XLSX.utils.aoa_to_sheet(divAoa);
        wsDiv['!cols'] = [{ wch:24 },{ wch:16 },{ wch:16 }];
        window.XLSX.utils.book_append_sheet(wb, wsDiv, 'Division Summary');

        window.XLSX.writeFile(wb, 'RBI_Bulk_' + fileStamp + '.xlsx');
      } else {
        Utils.showToast('Excel library unavailable — only the text file downloaded', 'warning');
      }

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
        } catch { /* silently ignore — files are already downloaded */ }
      }
      Utils.showToast('Payment files downloaded (Excel + Text) — ' + rows.length + ' entries exported', 'success');
    });
  }

  /* ── Payment History helpers ────────────────────────────────── */
  async function _phLoad() {
    try {
      const res = await fetch('/api/payment-history');
      _phRows = res.ok ? (await res.json()) : [];
    } catch { _phRows = []; }
  }

  function _phBatches() {
    const map = {};
    for (const r of _phRows) {
      const key   = r.batch_label || _phFmt(r.exported_at);
      const dateY = (r.exported_at || '').slice(0, 7);
      if (_phMonth && dateY !== _phMonth) continue;
      if (!map[key]) map[key] = { label: key, exportedAt: r.exported_at, entries: [] };
      map[key].entries.push(r);
    }
    return Object.values(map).sort((a, b) => new Date(b.exportedAt) - new Date(a.exportedAt));
  }

  function _phFmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  function _phAmt(v) {
    return '₹' + parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }

  function _renderHistoryTab() {
    const batches = _phBatches();
    const curM  = new Date().toISOString().slice(0, 7);
    const thisM = _phRows.filter(r => (r.exported_at || '').slice(0, 7) === curM);
    const allAmt = _phRows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const mAmt   = thisM.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const vendors = new Set(_phRows.map(r => r.vendor_id)).size;

    const months = [...new Set(_phRows.map(r => (r.exported_at || '').slice(0, 7)).filter(Boolean))].sort().reverse();

    const statCard = (label, val, sub, color) =>
      '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,.04);">'
      + '<div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">' + label + '</div>'
      + '<div style="font-size:20px;font-weight:800;color:' + (color||'#1e293b') + ';margin-top:4px;line-height:1;">' + val + '</div>'
      + (sub ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + sub + '</div>' : '')
      + '</div>';

    const statsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px;">'
      + statCard('Total Payments', _phRows.length, 'all time', 'var(--color-primary)')
      + statCard('Total Amount', _phAmt(allAmt), 'all time', '#1e293b')
      + statCard('This Month', thisM.length + ' entries', _phAmt(mAmt), '#059669')
      + statCard('Unique Vendors', vendors, 'paid to', '#6366f1')
      + '</div>';

    // Vendor top list
    const vMap = {};
    for (const r of _phRows) {
      const vn = r.vendor_name || r.vendor_id || 'Unknown';
      if (!vMap[vn]) vMap[vn] = { name: vn, count: 0, total: 0 };
      vMap[vn].count++; vMap[vn].total += parseFloat(r.amount || 0);
    }
    const topVendors = Object.values(vMap).sort((a,b) => b.total - a.total).slice(0, 8);

    // Monthly trend
    const mMap = {};
    for (const r of _phRows) {
      const m = (r.exported_at || '').slice(0, 7);
      if (!m) continue;
      if (!mMap[m]) mMap[m] = { month: m, count: 0, total: 0 };
      mMap[m].count++; mMap[m].total += parseFloat(r.amount || 0);
    }
    const trend = Object.values(mMap).sort((a,b) => a.month.localeCompare(b.month)).slice(-6);
    const maxAmt = Math.max(...trend.map(t => t.total), 1);

    const thS = 'padding:9px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;';
    const tdS = 'padding:9px 14px;font-size:12.5px;color:#374151;border-bottom:1px solid #f1f5f9;';

    const trendHtml = trend.length === 0 ? '' :
      '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:12px;">'
      + '<div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#1e293b;">Monthly Trend</div>'
      + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">'
        + '<thead><tr><th style="' + thS + '">Month</th><th style="' + thS + 'text-align:right;">Entries</th><th style="' + thS + 'text-align:right;">Amount</th><th style="' + thS + '">Bar</th></tr></thead>'
        + '<tbody>' + trend.map((t, i) => {
            const [y, mo] = t.month.split('-');
            const label = new Date(+y, +mo-1, 1).toLocaleString('en-IN', { month:'short', year:'2-digit' });
            const pct = Math.round((t.total / maxAmt) * 100);
            return '<tr style="' + (i%2===1?'background:#fafbfc;':'') + '">'
              + '<td style="' + tdS + 'font-weight:600;">' + label + '</td>'
              + '<td style="' + tdS + 'text-align:right;">' + t.count + '</td>'
              + '<td style="' + tdS + 'font-weight:700;text-align:right;color:#1e293b;">' + _phAmt(t.total) + '</td>'
              + '<td style="' + tdS + '"><div style="background:#f1f5f9;border-radius:9999px;height:7px;min-width:60px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:var(--color-primary);border-radius:9999px;"></div></div></td>'
              + '</tr>';
          }).join('')
        + '</tbody></table></div></div>';

    const vendorHtml = topVendors.length === 0 ? '' :
      '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:12px;">'
      + '<div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#1e293b;">Top Vendors</div>'
      + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">'
        + '<thead><tr><th style="' + thS + '">#</th><th style="' + thS + '">Vendor</th><th style="' + thS + 'text-align:right;">Payments</th><th style="' + thS + 'text-align:right;">Total Amount</th></tr></thead>'
        + '<tbody>' + topVendors.map((v, i) =>
            '<tr class="ph-vendor-row" data-vendor="' + esc(v.name) + '" style="cursor:pointer;' + (i%2===1?'background:#fafbfc;':'') + '" title="Click to view this vendor\'s bills" onmouseenter="this.style.background=\'#f8fafc\'" onmouseleave="this.style.background=\'' + (i%2===1?'#fafbfc':'') + '\'">'
            + '<td style="' + tdS + 'color:#94a3b8;font-weight:600;">' + (i+1) + '</td>'
            + '<td style="' + tdS + 'font-weight:600;color:#1e293b;">' + esc(v.name) + '</td>'
            + '<td style="' + tdS + 'text-align:right;"><span style="color:var(--color-primary);font-weight:700;text-decoration:underline;text-underline-offset:2px;">' + v.count + '</span></td>'
            + '<td style="' + tdS + 'font-weight:700;color:#059669;text-align:right;">' + _phAmt(v.total) + '</td>'
            + '</tr>'
          ).join('')
        + '</tbody></table></div></div>';

    const batchesHtml = batches.length === 0
      ? '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:40px 24px;text-align:center;"><div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">No exports yet</div><div style="font-size:12px;color:#94a3b8;">Go to Payment Management tab, fill entries and click Export</div></div>'
      : batches.map(batch => {
          const bTotal = batch.entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
          const isOpen = _phOpenBatch === batch.label;
          let detailHtml = '';
          if (isOpen) {
            detailHtml = '<div style="border-top:1px solid #f1f5f9;overflow-x:auto;">'
              + '<table style="width:100%;border-collapse:collapse;min-width:600px;">'
              + '<thead><tr>'
                + '<th style="' + thS + '">#</th>'
                + '<th style="' + thS + '">Vendor</th>'
                + '<th style="' + thS + '">Bank</th>'
                + '<th style="' + thS + '">Account No.</th>'
                + '<th style="' + thS + '">IFSC</th>'
                + '<th style="' + thS + '">Txn</th>'
                + '<th style="' + thS + 'text-align:right;">Amount</th>'
              + '</tr></thead>'
              + '<tbody>' + batch.entries.map((e, i) =>
                  '<tr style="' + (i%2===1?'background:#fafbfc;':'') + 'border-bottom:1px solid #f1f5f9;">'
                  + '<td style="' + tdS + 'color:#94a3b8;">' + (i+1) + '</td>'
                  + '<td style="' + tdS + 'font-weight:600;color:#1e293b;">' + esc(e.vendor_name || '—') + '</td>'
                  + '<td style="' + tdS + '">' + esc(e.bank_name || '—') + '</td>'
                  + '<td style="' + tdS + 'font-family:monospace;">' + esc(e.account_no || '—') + '</td>'
                  + '<td style="' + tdS + 'font-family:monospace;">' + esc(e.ifsc_code || '—') + '</td>'
                  + '<td style="' + tdS + '">' + esc(e.txn_type || 'N') + '</td>'
                  + '<td style="' + tdS + 'font-weight:700;color:#059669;text-align:right;">' + _phAmt(e.amount) + '</td>'
                  + '</tr>'
                ).join('')
              + '<tr style="border-top:2px solid #e2e8f0;background:#f8fafc;">'
                + '<td colspan="6" style="' + tdS + 'font-weight:700;">Total</td>'
                + '<td style="' + tdS + 'font-weight:800;color:#059669;font-size:14px;text-align:right;">' + _phAmt(bTotal) + '</td>'
              + '</tr></tbody></table></div>';
          }
          return '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:10px;">'
            + '<div class="ph-batch-hdr" data-batch="' + esc(batch.label) + '" style="display:flex;align-items:center;justify-content:space-between;padding:13px 18px;cursor:pointer;" onmouseenter="this.style.background=\'#f8fafc\'" onmouseleave="this.style.background=\'\'">'
              + '<div style="display:flex;align-items:center;gap:12px;">'
                + '<div style="width:34px;height:34px;border-radius:9px;background:var(--color-primary-light);display:grid;place-items:center;flex-shrink:0;">'
                  + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>'
                + '</div>'
                + '<div>'
                  + '<div style="font-size:13px;font-weight:700;color:#1e293b;">' + esc(batch.label) + '</div>'
                  + '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">' + batch.entries.length + ' entries &nbsp;·&nbsp; ' + _phFmt(batch.exportedAt) + '</div>'
                + '</div>'
              + '</div>'
              + '<div style="display:flex;align-items:center;gap:14px;">'
                + '<div style="font-size:15px;font-weight:800;color:#059669;">' + _phAmt(bTotal) + '</div>'
                + '<svg style="transition:transform .2s;' + (isOpen ? 'transform:rotate(180deg);' : '') + '" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
              + '</div>'
            + '</div>'
            + detailHtml
          + '</div>';
        }).join('');

    const monthSel = '<select id="ph-month-sel" style="padding:7px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:12.5px;outline:none;background:#fff;color:#374151;cursor:pointer;">'
      + '<option value="">All Time</option>'
      + months.map(m => {
          const [y, mo] = m.split('-');
          const lbl = new Date(+y, +mo-1, 1).toLocaleString('en-IN', { month:'long', year:'numeric' });
          return '<option value="' + m + '" ' + (m === _phMonth ? 'selected' : '') + '>' + lbl + '</option>';
        }).join('')
      + '</select>';

    return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">'
      + '<div style="font-size:13px;font-weight:700;color:#1e293b;">Payment History</div>'
      + '<div style="display:flex;gap:8px;align-items:center;">'
        + monthSel
        + '<button id="ph-refresh-btn" style="display:flex;align-items:center;gap:5px;padding:7px 12px;border:1.5px solid #e2e8f0;border-radius:9px;background:#fff;font-size:12px;font-weight:600;color:#64748b;cursor:pointer;" onmouseenter="this.style.background=\'#f8fafc\'" onmouseleave="this.style.background=\'#fff\'">'
          + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>Refresh'
        + '</button>'
      + '</div>'
    + '</div>'
    + statsHtml
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">' + trendHtml + vendorHtml + '</div>'
    + batchesHtml;
  }

  function _bindHistoryTabEvents() {
    document.getElementById('ph-month-sel')?.addEventListener('change', e => {
      _phMonth = e.target.value;
      document.getElementById('cm-tab-content').innerHTML = _renderHistoryTab();
      _bindHistoryTabEvents();
    });
    document.getElementById('ph-refresh-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('ph-refresh-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
      await _phLoad();
      document.getElementById('cm-tab-content').innerHTML = _renderHistoryTab();
      _bindHistoryTabEvents();
    });
    document.querySelectorAll('.ph-batch-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        _phOpenBatch = _phOpenBatch === hdr.dataset.batch ? null : hdr.dataset.batch;
        document.getElementById('cm-tab-content').innerHTML = _renderHistoryTab();
        _bindHistoryTabEvents();
      });
    });
    document.querySelectorAll('.ph-vendor-row').forEach(row => {
      row.addEventListener('click', () => {
        _phBillsVendor = row.dataset.vendor;
        _renderVendorBillsModal();
      });
    });
  }

  function _closeVendorBills() {
    _phBillsVendor = null;
    const modal = document.getElementById('cm-vendor-bills-modal');
    if (modal) modal.innerHTML = '';
  }

  function _renderVendorBillsModal() {
    const modal = document.getElementById('cm-vendor-bills-modal');
    if (!modal) return;
    if (!_phBillsVendor) { modal.innerHTML = ''; return; }

    const rows = _phRows
      .filter(r => (r.vendor_name || r.vendor_id || 'Unknown') === _phBillsVendor)
      .sort((a, b) => new Date(b.exported_at) - new Date(a.exported_at));
    const total = rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

    const thS = 'padding:9px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:#f8fafc;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;';
    const tdS = 'padding:9px 14px;font-size:12.5px;color:#374151;border-bottom:1px solid #f1f5f9;';

    const rowsHtml = rows.length === 0
      ? '<tr><td colspan="5" style="' + tdS + 'text-align:center;color:#94a3b8;padding:24px;">No bills found for this vendor.</td></tr>'
      : rows.map((r, i) =>
          '<tr style="' + (i%2===1?'background:#fafbfc;':'') + '">'
          + '<td style="' + tdS + 'color:#94a3b8;">' + (i+1) + '</td>'
          + '<td style="' + tdS + 'white-space:nowrap;">' + _phFmt(r.exported_at) + '</td>'
          + '<td style="' + tdS + '">' + esc(r.narration || '—') + '</td>'
          + '<td style="' + tdS + '">' + esc(r.txn_type || 'N') + '</td>'
          + '<td style="' + tdS + 'font-weight:700;color:#059669;text-align:right;white-space:nowrap;">' + _phAmt(r.amount) + '</td>'
          + '</tr>'
        ).join('');

    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="cm-bills-backdrop">'
      + '<div style="background:#fff;border-radius:18px;width:100%;max-width:640px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;" onclick="event.stopPropagation()">'
        + '<div style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;flex-shrink:0;">'
          + '<div style="width:38px;height:38px;border-radius:10px;background:#fff8f5;display:grid;place-items:center;flex-shrink:0;">'
            + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4714A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>'
          + '</div>'
          + '<div style="flex:1;min-width:0;"><div style="font-size:15px;font-weight:700;color:#1e293b;">' + esc(_phBillsVendor) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">' + rows.length + ' bill' + (rows.length===1?'':'s') + ' &middot; ' + _phAmt(total) + ' total</div></div>'
          + '<button id="cm-bills-close" style="background:transparent;border:none;cursor:pointer;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:#94a3b8;flex-shrink:0;" onmouseenter="this.style.background=\'#f1f5f9\'" onmouseleave="this.style.background=\'transparent\'">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
          + '</button>'
        + '</div>'
        + '<div style="overflow-y:auto;flex:1;">'
          + '<table style="width:100%;border-collapse:collapse;">'
            + '<thead><tr><th style="' + thS + '">#</th><th style="' + thS + '">Date</th><th style="' + thS + '">Bill No / Narration</th><th style="' + thS + '">Txn</th><th style="' + thS + 'text-align:right;">Amount</th></tr></thead>'
            + '<tbody>' + rowsHtml + '</tbody>'
          + '</table>'
        + '</div>'
      + '</div>'
    + '</div>';

    document.getElementById('cm-bills-backdrop').addEventListener('click', _closeVendorBills);
    document.getElementById('cm-bills-close').addEventListener('click', _closeVendorBills);
  }

  /* ── Main render ────────────────────────────────────────────── */
  function _tabBtn(id, label, icon, active) {
    const hover = active ? '' : ' onmouseenter="this.style.color=\'#374151\'" onmouseleave="this.style.color=\'#64748b\'"';
    return '<button id="' + id + '" style="'
      + 'display:flex;align-items:center;gap:7px;'
      + 'padding:12px 20px;'
      + 'border:none;background:transparent;cursor:pointer;'
      + 'font-size:13px;font-weight:' + (active ? '700' : '500') + ';'
      + 'color:' + (active ? 'var(--color-primary)' : '#64748b') + ';'
      + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';'
      + 'margin-bottom:-1px;transition:color .15s,border-color .15s;white-space:nowrap;'
      + '"' + hover + '>'
      + icon
      + label
      + '</button>';
  }

  function _render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    let tabContent;
    if (_tab === 'vendors')       tabContent = _renderVendorTab();
    else if (_tab === 'payments') tabContent = _renderPaymentTab();
    else                          tabContent = _renderHistoryTab();

    const iconVendor  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    const iconPayment = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>';
    const iconHistory = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 16 4-6 4 4 4-8"/></svg>';

    el.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:20px;">'

      + '<div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,.05);overflow:hidden;">'

        + (_tab === 'vendors' && _canEdit
          ? '<div style="display:flex;align-items:center;justify-content:flex-end;padding:14px 22px 0;">'
              + '<button id="cm-add-btn" style="display:flex;align-items:center;gap:7px;padding:9px 20px;border-radius:10px;background:var(--color-primary);color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px var(--color-primary-ring);" onmouseenter="this.style.filter=\'brightness(.9)\'" onmouseleave="this.style.filter=\'none\'">'
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Add Vendor'
              + '</button>'
            + '</div>'
          : '')

        + '<div style="display:flex;gap:0;border-top:1px solid #f1f5f9;padding:0 10px;">'
          + _tabBtn('tab-vendors',  'Vendor List',        iconVendor,  _tab === 'vendors')
          + _tabBtn('tab-payments', 'Payment Management', iconPayment, _tab === 'payments')
          + _tabBtn('tab-history',  'Payment History',    iconHistory, _tab === 'history')
        + '</div>'

      + '</div>'

      + '<div id="cm-tab-content">' + tabContent + '</div>'

      + '<div id="cm-modal"></div>'
      + '<div id="cm-vendor-bills-modal"></div>'
    + '</div>';

    document.getElementById('tab-vendors') .addEventListener('click', () => { _tab = 'vendors';  _render(); });
    document.getElementById('tab-payments').addEventListener('click', () => { _tab = 'payments'; _render(); });
    document.getElementById('tab-history') .addEventListener('click', async () => {
      _tab = 'history'; _phOpenBatch = null; _phBillsVendor = null;
      ['tab-vendors','tab-payments','tab-history'].forEach(id => {
        const b = document.getElementById(id); if (!b) return;
        const a = id === 'tab-history';
        b.style.color        = a ? 'var(--color-primary)' : '#64748b';
        b.style.borderBottom = '2px solid ' + (a ? 'var(--color-primary)' : 'transparent');
        b.style.fontWeight   = a ? '700' : '500';
      });
      const content = document.getElementById('cm-tab-content');
      if (content) content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:300px;"><div style="text-align:center;"><div style="width:36px;height:36px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 12px;"></div><div style="font-size:13px;color:#94a3b8;">Loading history…</div></div></div>';
      await _phLoad();
      _render();
    });
    document.getElementById('cm-add-btn')?.addEventListener('click', _openAdd);

    _bindTableButtons();
    if (_tab === 'payments') _bindPaymentTabEvents();
    if (_tab === 'history')  _bindHistoryTabEvents();
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
