window.Pages = window.Pages || {};

window.Pages['client-master'] = (() => {
  /* ── State ─────────────────────────────────────────────────── */
  let _list    = [];
  let _q       = '';
  let _status  = 'All';
  let _open    = false;
  let _editing = null;
  let _saving  = false;
  let _canEdit = false;
  let _form    = _blankForm();
  let _tab        = 'vendors';   // 'vendors' | 'payments'
  let _pmEntries  = [];          // [{ vendorId, amount }] — saved entries
  let _pmDraft    = { vendorId: null, amount: '' }; // current input

  /* ── Helpers ─────────────────────────────────────────────── */
  function _blankForm() {
    return {
      name:'', mobile:'', email:'', state:'', district:'', address:'', pin:'',
      bankName:'', accountHolder:'', accountNo:'', ifscCode:'', branchName:'',
      status:'active',
    };
  }

  function _filtered() {
    const t = _q.toLowerCase();
    return _list.filter(c =>
      (_status === 'All' || c.status === _status.toLowerCase()) &&
      (!t || (c.name+(c.mobile||'')+(c.email||'')+(c.state||'')+(c.district||'')).toLowerCase().includes(t))
    );
  }

  function _initPmEntries(saved) {
    _pmEntries = (saved && saved.length ? saved : [])
      .map(e => ({ vendorId: e.vendorId||null, amount: e.amount||'' }));
    _pmDraft = { vendorId: null, amount: '' };
  }

  function esc(s) {
    return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── API ──────────────────────────────────────────────────── */
  async function _load() {
    try {
      const res = await Utils.apiFetch('/api/clients');
      _list = Array.isArray(res) ? res : [];
    } catch { _list = []; }
    _render();
  }

  async function _save() {
    if (!_form.name.trim()) { Utils.showToast('Vendor name is required','error'); return; }
    _saving = true; _renderModal();
    try {
      const method = _editing !== null ? 'PATCH' : 'POST';
      const body   = _editing !== null ? { id:_editing, ..._form } : _form;
      await Utils.apiFetch('/api/clients', { method, body: JSON.stringify(body) });
      _open=false; _editing=null; _form=_blankForm();
      Utils.showToast(_editing!==null ? 'Vendor updated' : 'Vendor added');
    } catch(e) {
      Utils.showToast(e.message||'Failed to save','error');
    } finally { _saving=false; }
    await _load();
  }

  async function _remove(id) {
    if (!confirm('Delete this vendor?')) return;
    await Utils.apiFetch('/api/clients?id='+id, { method:'DELETE' });
    Utils.showToast('Vendor deleted');
    await _load();
  }

  /* ── Modal open/close ─────────────────────────────────────── */
  function _openAdd()  { _editing=null; _form=_blankForm(); _open=true; _render(); }
  function _openEdit(c) {
    _editing=c.id;
    _form = {
      name:c.name||'', mobile:c.mobile||c.contact_number||'', email:c.email||'',
      state:c.state||'', district:c.district||'', address:c.address||'', pin:c.pin||'',
      bankName:c.bank_name||'', accountHolder:c.account_holder||'',
      accountNo:c.account_no||'', ifscCode:c.ifsc_code||'', branchName:c.branch_name||'',
      status:c.status||'active',
    };
    _open=true; _render();
  }
  function _closeModal() { _open=false; _editing=null; _form=_blankForm(); _render(); }

  /* ── Modal HTML ───────────────────────────────────────────── */
  function _fld(id, label, v, type, ph) {
    return '<div><label style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">'+label+'</label>'
      +'<input class="input" id="'+id+'" type="'+(type||'text')+'" value="'+esc(v)+'" placeholder="'+(ph||'')+'" style="width:100%;box-sizing:border-box;" /></div>';
  }

  function _renderModal() {
    const modal = document.getElementById('cm-modal');
    if (!modal) return;
    if (!_open) { modal.innerHTML=''; return; }
    const title = _editing!==null ? 'Edit Vendor' : 'Add Vendor';
    modal.innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="cm-backdrop">'
      +'<div style="background:#fff;border-radius:16px;width:100%;max-width:600px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;" onclick="event.stopPropagation()">'
      +'<div style="padding:18px 22px 14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">'
      +'<div><div style="font-size:16px;font-weight:700;color:#1e293b;">'+title+'</div><div style="font-size:12px;color:#94a3b8;margin-top:1px;">Fill in vendor information</div></div>'
      +'<button id="cm-modal-close" style="background:transparent;border:none;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1;padding:4px;">&#x2715;</button>'
      +'</div>'
      +'<div style="padding:20px 22px;max-height:70vh;overflow-y:auto;">'
      // Basic section
      +'<div style="margin-bottom:20px;">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">'
      +'<div style="width:28px;height:28px;border-radius:8px;background:#eff6ff;display:grid;place-items:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>'
      +'<span style="font-size:13px;font-weight:700;color:#1e293b;">Basic Details</span></div>'
      +'<div style="display:grid;gap:12px;">'
      +_fld('cm-name','Name *',_form.name,'text','Vendor / Company name')
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'+_fld('cm-mobile','Mobile No.',_form.mobile,'tel','10-digit mobile')+_fld('cm-email','Email',_form.email,'email','vendor@email.com')+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'+_fld('cm-state','State',_form.state,'text','e.g. Rajasthan')+_fld('cm-district','District',_form.district,'text','e.g. Jaipur')+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 120px;gap:12px;">'+_fld('cm-address','Address',_form.address,'text','Street / Area')+_fld('cm-pin','Pin Code',_form.pin,'text','6-digit PIN')+'</div>'
      +'<div><label style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Status</label>'
      +'<select class="input" id="cm-status" style="width:100%;box-sizing:border-box;"><option value="active" '+(_form.status==='active'?'selected':'')+'>Active</option><option value="inactive" '+(_form.status==='inactive'?'selected':'')+'>Inactive</option></select></div>'
      +'</div></div>'
      +'<div style="height:1px;background:#f1f5f9;margin:0 0 20px;"></div>'
      // Bank section
      +'<div>'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">'
      +'<div style="width:28px;height:28px;border-radius:8px;background:#f0fdf4;display:grid;place-items:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg></div>'
      +'<span style="font-size:13px;font-weight:700;color:#1e293b;">Bank Details</span></div>'
      +'<div style="display:grid;gap:12px;">'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'+_fld('cm-bankName','Bank Name',_form.bankName,'text','e.g. SBI, HDFC')+_fld('cm-accountHolder','Account Holder Name',_form.accountHolder,'text','As per bank records')+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'+_fld('cm-accountNo','Account No.',_form.accountNo,'text','Bank account number')+_fld('cm-ifscCode','IFSC Code',_form.ifscCode,'text','e.g. SBIN0001234')+'</div>'
      +_fld('cm-branchName','Branch Name',_form.branchName,'text','Branch location')
      +'</div></div>'
      +'</div>'
      +'<div style="padding:14px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;background:#fafafa;">'
      +'<button id="cm-modal-cancel" style="padding:8px 20px;border-radius:8px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
      +'<button id="cm-modal-save" style="padding:8px 22px;border-radius:8px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;" '+(_saving?'disabled':'')+'>'
      +(_saving ? 'Saving…' : (_editing!==null ? 'Update Vendor' : 'Add Vendor'))
      +'</button></div></div></div>';

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

  /* ── Vendor List table ────────────────────────────────────── */
  function _renderTable() {
    const rows = _filtered();
    if (!rows.length) return '<p style="text-align:center;color:#94a3b8;font-size:13px;padding:32px 0;">No vendors yet.</p>';
    const actionTh = _canEdit ? '<th class="table-th" style="text-align:right;">Action</th>' : '';
    return '<div class="overflow-x-auto"><table class="w-full"><thead><tr>'
      +'<th class="table-th">Name</th><th class="table-th">Mobile</th><th class="table-th">Email</th>'
      +'<th class="table-th">State</th><th class="table-th">District</th><th class="table-th">Bank</th>'
      +'<th class="table-th">Status</th>'+actionTh
      +'</tr></thead><tbody>'
      +rows.map(c => {
        const pill = c.status==='active'
          ? '<span class="pill bg-emerald-50 text-emerald-600">Active</span>'
          : '<span class="pill bg-slate-100 text-slate-500">Inactive</span>';
        const actionTd = _canEdit
          ? '<td class="table-td"><div style="display:flex;gap:6px;justify-content:flex-end;">'
            +'<button class="btn-secondary js-edit" data-id="'+c.id+'" style="font-size:12px;padding:3px 10px;">Edit</button>'
            +'<button class="btn-danger js-delete" data-id="'+c.id+'" style="font-size:12px;padding:3px 10px;">Delete</button>'
            +'</div></td>' : '';
        return '<tr class="table-row">'
          +'<td class="table-td font-medium text-slate-800">'+esc(c.name)+'</td>'
          +'<td class="table-td">'+esc(c.mobile||c.contact_number||'—')+'</td>'
          +'<td class="table-td">'+esc(c.email||'—')+'</td>'
          +'<td class="table-td">'+esc(c.state||'—')+'</td>'
          +'<td class="table-td">'+esc(c.district||'—')+'</td>'
          +'<td class="table-td">'+esc(c.bank_name||'—')+'</td>'
          +'<td class="table-td">'+pill+'</td>'+actionTd
          +'</tr>';
      }).join('')
      +'</tbody></table></div>';
  }

  function _renderVendorTab() {
    const rows = _filtered();
    return '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">'
      +'<div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      +'<input id="cm-search" placeholder="Search name / mobile / email…" value="'+esc(_q)+'" style="flex:1;min-width:180px;padding:7px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;" />'
      +'<select id="cm-status-filter" style="padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;background:#fff;">'
      +'<option '+(_status==='All'?'selected':'')+'>All</option>'
      +'<option '+(_status==='Active'?'selected':'')+'>Active</option>'
      +'<option '+(_status==='Inactive'?'selected':'')+'>Inactive</option>'
      +'</select>'
      +'<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">'+rows.length+' of '+_list.length+'</span>'
      +'</div><div id="cm-table">'+_renderTable()+'</div></div>';
  }

  /* ── Payment Management (entry-based) ───────────────────────── */
  function _pmEntryHtml(entry, idx) {
    const v   = entry.vendorId ? _list.find(x => String(x.id) === String(entry.vendorId)) : null;
    if (!v) return '';
    const tdS = 'padding:11px 14px;font-size:13px;color:#374151;';
    const mS  = tdS + 'font-family:monospace;letter-spacing:.04em;';
    return '<tr data-ei="'+idx+'" style="border-bottom:1px solid #f1f5f9;" onmouseenter="this.style.background=\'#fafafa\'" onmouseleave="this.style.background=\'transparent\'">'
      +'<td style="'+tdS+'text-align:center;color:#94a3b8;min-width:44px;">'+(idx+1)+'</td>'
      +'<td style="'+tdS+'">'
        +'<div style="font-size:13px;font-weight:600;color:#1e293b;">'+esc(v.name)+'</div>'
        +(v.mobile||v.contact_number ? '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">'+esc(v.mobile||v.contact_number)+'</div>' : '')
      +'</td>'
      +'<td style="'+tdS+'font-weight:700;color:#059669;">&#x20B9; '+parseFloat(entry.amount||0).toFixed(2)+'</td>'
      +'<td style="'+tdS+'">'+esc(v.bank_name||'—')+'</td>'
      +'<td style="'+tdS+'">'+esc(v.account_holder||'—')+'</td>'
      +'<td style="'+mS+'">'+esc(v.account_no||'—')+'</td>'
      +'<td style="'+mS+'letter-spacing:.06em;">'+esc(v.ifsc_code||'—')+'</td>'
      +'<td style="'+tdS+'">'+esc(v.branch_name||'—')+'</td>'
      +'<td style="padding:8px 14px;text-align:center;">'
        +'<button class="pm-del-entry" data-ei="'+idx+'" title="Remove" style="background:transparent;border:none;cursor:pointer;color:#cbd5e1;padding:4px;line-height:1;" onmouseenter="this.style.color=\'#ef4444\'" onmouseleave="this.style.color=\'#cbd5e1\'">'
          +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
        +'</button>'
      +'</td>'
      +'</tr>';
  }

  function _pmEntriesTbody() {
    if (!_pmEntries.length) return '<tr><td colspan="9" style="padding:40px;text-align:center;color:#94a3b8;font-size:13px;">No entries yet — search a vendor above and add.</td></tr>';
    return _pmEntries.map(function(e,i){ return _pmEntryHtml(e,i); }).join('');
  }

  function _pmDetailHtml(v) {
    if (!v) return '';
    const thS = 'padding:10px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:left;white-space:nowrap;border-bottom:2px solid #f1f5f9;background:#f8fafc;';
    const tdS = 'padding:12px 14px;color:#374151;font-size:13px;';
    const canTick = !!(v && _pmDraft.amount && parseFloat(_pmDraft.amount) > 0);
    const tickStyle = 'width:32px;height:32px;border:none;border-radius:50%;cursor:'+(canTick?'pointer':'not-allowed')+';'
      +'background:'+(canTick?'#059669':'#e2e8f0')+';color:'+(canTick?'#fff':'#9ca3af')+';'
      +'font-size:16px;font-weight:700;line-height:1;transition:background .15s;';
    return '<div style="margin-top:20px;border-top:1px solid #f1f5f9;padding-top:20px;overflow-x:auto;">'
      +'<table style="width:100%;border-collapse:collapse;">'
        +'<thead><tr>'
          +'<th style="'+thS+'">Name</th>'
          +'<th style="'+thS+'">Mobile</th>'
          +'<th style="'+thS+'">Bank Name</th>'
          +'<th style="'+thS+'">Account Holder</th>'
          +'<th style="'+thS+'">Account No.</th>'
          +'<th style="'+thS+'">IFSC Code</th>'
          +'<th style="'+thS+'">Branch</th>'
          +'<th style="'+thS+'width:52px;"></th>'
        +'</tr></thead>'
        +'<tbody><tr>'
          +'<td style="'+tdS+'font-weight:600;color:#1e293b;">'+esc(v.name)+'</td>'
          +'<td style="'+tdS+'">'+esc(v.mobile||v.contact_number||'—')+'</td>'
          +'<td style="'+tdS+'">'+esc(v.bank_name||'—')+'</td>'
          +'<td style="'+tdS+'">'+esc(v.account_holder||'—')+'</td>'
          +'<td style="'+tdS+'font-family:monospace;letter-spacing:.04em;">'+esc(v.account_no||'—')+'</td>'
          +'<td style="'+tdS+'font-family:monospace;letter-spacing:.06em;">'+esc(v.ifsc_code||'—')+'</td>'
          +'<td style="'+tdS+'">'+esc(v.branch_name||'—')+'</td>'
          +'<td style="padding:8px 14px;text-align:center;">'
            +'<button id="pm-tick-btn" title="Add entry" '+(canTick?'':'disabled')+' style="'+tickStyle+'">&#10003;</button>'
          +'</td>'
        +'</tr></tbody>'
      +'</table>'
    +'</div>';
  }

  function _pmSavedHtml() {
    if (!_pmEntries.length) return '';
    const thS = 'padding:10px 14px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;text-align:left;white-space:nowrap;border-bottom:2px solid #f1f5f9;background:#f8fafc;';
    return '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f1f5f9;background:#fafafa;">'
        +'<span style="font-size:13px;font-weight:700;color:#1e293b;">Added Entries '
          +'<span style="color:#94a3b8;font-weight:400;font-size:12px;">('+_pmEntries.length+')</span></span>'
        +'<div style="display:flex;gap:8px;">'
          +'<button id="pm-save-btn" style="padding:6px 14px;font-size:12px;font-weight:600;border:1.5px solid #C4714A;border-radius:7px;background:#fff;color:#C4714A;cursor:pointer;">Save</button>'
          +'<button id="pm-excel-btn" style="padding:6px 14px;font-size:12px;font-weight:600;border:none;border-radius:7px;background:#059669;color:#fff;cursor:pointer;">&#8675; Excel</button>'
        +'</div>'
      +'</div>'
      +'<div style="overflow-x:auto;">'
        +'<table style="width:100%;border-collapse:collapse;">'
          +'<thead><tr>'
            +'<th style="'+thS+'text-align:center;width:44px;">#</th>'
            +'<th style="'+thS+'">Name</th>'
            +'<th style="'+thS+'">Amount</th>'
            +'<th style="'+thS+'">Bank Name</th>'
            +'<th style="'+thS+'">Account Holder</th>'
            +'<th style="'+thS+'">Account No.</th>'
            +'<th style="'+thS+'">IFSC Code</th>'
            +'<th style="'+thS+'">Branch</th>'
            +'<th style="'+thS+'width:44px;"></th>'
          +'</tr></thead>'
          +'<tbody id="pm-entries-tbody">'
            +_pmEntries.map(function(e,i){ return _pmEntryHtml(e,i); }).join('')
          +'</tbody>'
        +'</table>'
      +'</div>'
    +'</div>';
  }

  function _renderPaymentTab() {
    const dv = _pmDraft.vendorId ? _list.find(v => String(v.id) === String(_pmDraft.vendorId)) : null;
    return '<div style="display:flex;flex-direction:column;gap:16px;">'
      +'<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">'
          +'<div>'
            +'<label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Vendor Name</label>'
            +'<div style="position:relative;">'
              +'<div id="pm-search-wrap" style="display:flex;align-items:center;gap:8px;border:1.5px solid '+(dv?'#C4714A':'#e2e8f0')+';border-radius:9px;padding:9px 12px;background:#fff;transition:border-color .15s;">'
                +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
                +'<input id="pm-vendor-search" type="text" placeholder="Search vendor name…" autocomplete="off" value="'+esc(dv?dv.name:'')+'" '
                  +'style="border:none;outline:none;background:transparent;font-size:13px;font-weight:'+(dv?'600':'400')+';color:#1e293b;width:100%;" />'
              +'</div>'
              +'<div id="pm-vendor-dd" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;min-width:260px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;z-index:200;box-shadow:0 8px 28px rgba(0,0,0,.12);max-height:260px;overflow-y:auto;"></div>'
            +'</div>'
          +'</div>'
          +'<div>'
            +'<label style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Amount</label>'
            +'<div style="display:flex;align-items:center;gap:6px;border:1.5px solid #e2e8f0;border-radius:9px;padding:9px 12px;background:#f8fafc;transition:border-color .15s;" '
              +'onfocusin="this.style.borderColor=\'#C4714A\'" onfocusout="this.style.borderColor=\'#e2e8f0\'">'
              +'<span style="font-size:13px;color:#94a3b8;font-weight:600;">&#x20B9;</span>'
              +'<input id="pm-amount-input" type="number" min="0" step="0.01" placeholder="0.00" value="'+esc(_pmDraft.amount)+'" '
                +'style="border:none;outline:none;background:transparent;font-size:14px;font-weight:700;color:#1e293b;width:100%;" />'
            +'</div>'
          +'</div>'
        +'</div>'
        +'<div id="pm-detail">'+_pmDetailHtml(dv)+'</div>'
      +'</div>'
      +'<div id="pm-saved">'+_pmSavedHtml()+'</div>'
    +'</div>';
  }

  function _refreshSaved() {
    const saved = document.getElementById('pm-saved');
    if (saved) saved.innerHTML = _pmSavedHtml();
    _bindSavedEvents();
  }

  function _bindSavedEvents() {
    document.querySelectorAll('.pm-del-entry').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const idx = parseInt(btn.dataset.ei);
        if (!isNaN(idx) && idx >= 0 && idx < _pmEntries.length) {
          _pmEntries.splice(idx, 1);
          _refreshSaved();
        }
      });
    });
    document.getElementById('pm-save-btn')?.addEventListener('click', function() {
      try {
        localStorage.setItem('pm_entries', JSON.stringify(_pmEntries.map(function(e){ return {vendorId:e.vendorId,amount:e.amount}; })));
        Utils.showToast('Payment entries saved');
      } catch(err) { Utils.showToast('Failed to save','error'); }
    });
    document.getElementById('pm-excel-btn')?.addEventListener('click', function() {
      const today=new Date(), dd=String(today.getDate()).padStart(2,'0'), mm=String(today.getMonth()+1).padStart(2,'0'), yyyy=today.getFullYear();
      const dateStr=dd+'/'+mm+'/'+yyyy;
      function q(s){ return '"'+String(s||'').replace(/"/g,'""')+'"'; }
      const hdr=['Transaction Type','Beneficiary Code','Beneficiary Account Number','Transaction Amount','Beneficiary Name','Drawee Location in case of Demand Draft','DD Printing Location','Beneficiary Address 1','Beneficiary Address 2','Beneficiary Address 3','Beneficiary Address 4','Beneficiary Address 5','Instruction Reference Number','Customer Reference Number','Payment details 1','Payment details 2','Payment details 3','Payment details 4','Payment details 5','Payment details 6','Payment details 7','Cheque Number','Chq / Trn Date','MICR Number','IFSC Code','Beneficiary Bank Name','Beneficiary Bank Branch Name','Beneficiary email id'];
      const csvRows=[hdr.join(',')]; var sno=1;
      _pmEntries.forEach(function(entry) {
        var v=_list.find(function(x){ return String(x.id)===String(entry.vendorId); });
        if(!v) return;
        csvRows.push(['N',sno++,q(v.account_no),parseFloat(entry.amount||0).toFixed(2),q(v.name),'','','','','','','','','','','','','','','','','',dateStr,'',q(v.ifsc_code),q(v.bank_name),q(v.branch_name),''].join(','));
      });
      var csv='﻿'+csvRows.join('\r\n');
      var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url; a.download='neft_payment_'+yyyy+mm+dd+'.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      Utils.showToast('NEFT payment file downloaded');
    });
  }

  function _bindPaymentEvents() {
    const searchInp = document.getElementById('pm-vendor-search');
    if (!searchInp) return;
    const ddMenu = document.getElementById('pm-vendor-dd');
    const wrap   = document.getElementById('pm-search-wrap');

    function _updateTick() {
      const tickBtn = document.getElementById('pm-tick-btn');
      if (!tickBtn) return;
      const canTick = !!(  _pmDraft.vendorId && _pmDraft.amount && parseFloat(_pmDraft.amount) > 0);
      tickBtn.disabled         = !canTick;
      tickBtn.style.background = canTick ? '#059669' : '#e2e8f0';
      tickBtn.style.color      = canTick ? '#fff'    : '#9ca3af';
      tickBtn.style.cursor     = canTick ? 'pointer' : 'not-allowed';
    }

    function _bindTickEvent() {
      const tickBtn = document.getElementById('pm-tick-btn');
      if (!tickBtn) return;
      tickBtn.addEventListener('click', function() {
        const dv = _pmDraft.vendorId ? _list.find(function(x){ return String(x.id)===String(_pmDraft.vendorId); }) : null;
        if (!dv || !_pmDraft.amount || parseFloat(_pmDraft.amount) <= 0) return;
        _pmEntries.push({ vendorId: _pmDraft.vendorId, amount: _pmDraft.amount });
        _pmDraft = { vendorId: null, amount: '' };
        searchInp.value = ''; searchInp.style.fontWeight = '400';
        var amtInp = document.getElementById('pm-amount-input');
        if (amtInp) amtInp.value = '';
        if (wrap) wrap.style.borderColor = '#e2e8f0';
        var detail = document.getElementById('pm-detail');
        if (detail) detail.innerHTML = '';
        _refreshSaved();
        Utils.showToast('Entry added');
        setTimeout(function(){ searchInp.focus(); }, 80);
      });
    }

    function _showDetail() {
      const detail = document.getElementById('pm-detail');
      if (!detail) return;
      const dv = _pmDraft.vendorId ? _list.find(function(x){ return String(x.id)===String(_pmDraft.vendorId); }) : null;
      detail.innerHTML = _pmDetailHtml(dv);
      if (wrap) wrap.style.borderColor = dv ? '#C4714A' : '#e2e8f0';
      _updateTick();
      _bindTickEvent();
    }

    function _buildMenu(q) {
      if (!ddMenu) return;
      var qt      = q.trim().toLowerCase();
      var matches = qt ? _list.filter(function(v){ return v.name.toLowerCase().includes(qt)||(v.mobile||'').includes(qt); }) : _list.slice();
      if (!matches.length) { ddMenu.innerHTML='<div style="padding:12px 16px;font-size:13px;color:#94a3b8;">No vendors found</div>'; return; }
      var usedIds = _pmEntries.map(function(e){ return String(e.vendorId); });
      matches.sort(function(a, b) {
        var aUsed = usedIds.includes(String(a.id));
        var bUsed = usedIds.includes(String(b.id));
        if (aUsed === bUsed) return 0;
        return aUsed ? 1 : -1;
      });
      ddMenu.innerHTML = matches.slice(0,50).map(function(v){
        var used = usedIds.includes(String(v.id));
        return '<div class="pm-dd-opt" data-id="'+v.id+'" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid #f8fafc;">'
          +'<div style="font-size:13px;font-weight:600;color:'+(used?'#94a3b8':'#1e293b')+';">'+esc(v.name)+'</div>'
          +(v.mobile ? '<div style="font-size:11px;color:#94a3b8;margin-top:1px;">'+esc(v.mobile)+'</div>' : '')
        +'</div>';
      }).join('');
      ddMenu.querySelectorAll('.pm-dd-opt').forEach(function(opt) {
        opt.addEventListener('mouseenter', function() { opt.style.background='#f1f5f9'; });
        opt.addEventListener('mouseleave', function() { opt.style.background=''; });
        opt.addEventListener('mousedown', function(e) {
          e.preventDefault();
          var vendor = _list.find(function(v){ return String(v.id)===String(opt.dataset.id); });
          if (!vendor) return;
          _pmDraft.vendorId  = vendor.id;
          searchInp.value    = vendor.name;
          searchInp.style.fontWeight = '600';
          ddMenu.style.display = 'none';
          _showDetail();
        });
      });
    }

    searchInp.addEventListener('focus', function() { ddMenu.style.display='block'; _buildMenu(searchInp.value); });
    searchInp.addEventListener('input', function() {
      _pmDraft.vendorId = null;
      searchInp.style.fontWeight = '400';
      ddMenu.style.display = 'block';
      _buildMenu(searchInp.value);
      _showDetail();
    });
    searchInp.addEventListener('blur', function() {
      setTimeout(function() {
        ddMenu.style.display = 'none';
        if (_pmDraft.vendorId) {
          var v = _list.find(function(x){ return String(x.id)===String(_pmDraft.vendorId); });
          if (v && searchInp.value !== v.name) searchInp.value = v.name;
        } else { searchInp.value = ''; _showDetail(); }
      }, 160);
    });
    searchInp.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { ddMenu.style.display='none'; searchInp.blur(); }
    });

    document.getElementById('pm-amount-input')?.addEventListener('input', function(e) {
      _pmDraft.amount = e.target.value;
      _updateTick();
    });

    _bindSavedEvents();
  }

  /* ── Main render ──────────────────────────────────────────── */
  function _render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const tabBtn = (id, label, active) =>
      '<button id="'+id+'" style="padding:7px 18px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;'
      +'background:'+(active?'#fff':'transparent')+';color:'+(active?'#C4714A':'#64748b')+';'
      +'box-shadow:'+(active?'0 1px 4px rgba(0,0,0,.1)':'none')+';">'+label+'</button>';

    el.innerHTML = '<div style="padding:20px;max-width:1200px;margin:0 auto;">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">'
        +'<div><h1 style="font-size:18px;font-weight:700;color:#1e293b;margin:0;">Vendor Master</h1>'
        +'<p style="font-size:12px;color:#94a3b8;margin:2px 0 0;">Manage vendors and payment information</p></div>'
        +(_tab==='vendors' && _canEdit
          ? '<button id="cm-add-btn" style="padding:9px 20px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">'
            +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Add Vendor</button>'
          : '')
      +'</div>'
      +'<div style="display:flex;gap:4px;padding:4px;background:#f1f5f9;border-radius:10px;width:fit-content;margin-bottom:20px;">'
        +tabBtn('tab-vendors','Vendor List',_tab==='vendors')
        +tabBtn('tab-payments','Payment Management',_tab==='payments')
      +'</div>'
      +'<div id="cm-tab-content">'+(_tab==='vendors' ? _renderVendorTab() : _renderPaymentTab())+'</div>'
      +'<div id="cm-modal"></div>'
    +'</div>';

    document.getElementById('tab-vendors').addEventListener('click', () => { _tab='vendors'; _render(); });
    document.getElementById('tab-payments').addEventListener('click', () => { _tab='payments'; _render(); });
    document.getElementById('cm-add-btn')?.addEventListener('click', _openAdd);

    _bindTableButtons();
    _bindPaymentEvents();
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

  /* ── Public API ───────────────────────────────────────────── */
  return {
    async render() {
      _canEdit = (window.currentUser?.roles||[]).some
        ? (window.currentUser?.roles||[]).some(r => r==='Admin'||r==='HOD')
        : String(window.currentUser?.roles||'').includes('Admin');
      _q=''; _status='All'; _open=false; _editing=null; _saving=false;
      _form=_blankForm(); _list=[];
      try { _initPmEntries(JSON.parse(localStorage.getItem('pm_entries')||'[]')); } catch { _initPmEntries([]); }
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:13px;">Loading vendors…</div>';
      await _load();
    },
  };
})();
