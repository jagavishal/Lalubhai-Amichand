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

  // Payment Management state
  let _tab           = 'vendors';   // 'vendors' | 'payments'
  let _pmSearch      = '';
  let _pmDropOpen    = false;
  let _pmSelected    = null;        // selected vendor object

  /* ── Helpers ────────────────────────────────────────────────── */
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

  function esc(s) {
    return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function val(v) { return v || '—'; }

  /* ── API ────────────────────────────────────────────────────── */
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
    await Utils.apiFetch(`/api/clients?id=${id}`, { method:'DELETE' });
    Utils.showToast('Vendor deleted');
    await _load();
  }

  /* ── Open/close modal ───────────────────────────────────────── */
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

  /* ── Modal HTML ─────────────────────────────────────────────── */
  function _fld(id,label,val,type='text',ph='') {
    return `<div>
      <label style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">${label}</label>
      <input class="input" id="${id}" type="${type}" value="${esc(val)}" placeholder="${ph}" style="width:100%;box-sizing:border-box;" />
    </div>`;
  }

  function _renderModal() {
    const modal = document.getElementById('cm-modal');
    if (!modal) return;
    if (!_open) { modal.innerHTML=''; return; }
    const title = _editing!==null ? 'Edit Vendor' : 'Add Vendor';
    modal.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;z-index:50;padding:16px;overflow-y:auto;" id="cm-backdrop">
        <div style="background:#fff;border-radius:16px;width:100%;max-width:600px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;" onclick="event.stopPropagation()">
          <div style="padding:18px 22px 14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-size:16px;font-weight:700;color:#1e293b;">${title}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:1px;">Fill in vendor information</div>
            </div>
            <button id="cm-modal-close" style="background:transparent;border:none;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1;padding:4px;">✕</button>
          </div>
          <div style="padding:20px 22px;max-height:70vh;overflow-y:auto;">
            <div style="margin-bottom:20px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                <div style="width:28px;height:28px;border-radius:8px;background:#eff6ff;display:grid;place-items:center;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <span style="font-size:13px;font-weight:700;color:#1e293b;">Basic Details</span>
              </div>
              <div style="display:grid;gap:12px;">
                ${_fld('cm-name','Name *',_form.name,'text','Vendor / Company name')}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  ${_fld('cm-mobile','Mobile No.',_form.mobile,'tel','10-digit mobile')}
                  ${_fld('cm-email','Email',_form.email,'email','vendor@email.com')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  ${_fld('cm-state','State',_form.state,'text','e.g. Rajasthan')}
                  ${_fld('cm-district','District',_form.district,'text','e.g. Jaipur')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 120px;gap:12px;">
                  ${_fld('cm-address','Address',_form.address,'text','Street / Area')}
                  ${_fld('cm-pin','Pin Code',_form.pin,'text','6-digit PIN')}
                </div>
                <div>
                  <label style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Status</label>
                  <select class="input" id="cm-status" style="width:100%;box-sizing:border-box;">
                    <option value="active"   ${_form.status==='active'   ?'selected':''}>Active</option>
                    <option value="inactive" ${_form.status==='inactive' ?'selected':''}>Inactive</option>
                  </select>
                </div>
              </div>
            </div>
            <div style="height:1px;background:#f1f5f9;margin:0 0 20px;"></div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
                <div style="width:28px;height:28px;border-radius:8px;background:#f0fdf4;display:grid;place-items:center;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                </div>
                <span style="font-size:13px;font-weight:700;color:#1e293b;">Bank Details</span>
              </div>
              <div style="display:grid;gap:12px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  ${_fld('cm-bankName','Bank Name',_form.bankName,'text','e.g. SBI, HDFC')}
                  ${_fld('cm-accountHolder','Account Holder Name',_form.accountHolder,'text','As per bank records')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  ${_fld('cm-accountNo','Account No.',_form.accountNo,'text','Bank account number')}
                  ${_fld('cm-ifscCode','IFSC Code',_form.ifscCode,'text','e.g. SBIN0001234')}
                </div>
                ${_fld('cm-branchName','Branch Name',_form.branchName,'text','Branch location')}
              </div>
            </div>
          </div>
          <div style="padding:14px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px;background:#fafafa;">
            <button id="cm-modal-cancel" style="padding:8px 20px;border-radius:8px;border:1.5px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
            <button id="cm-modal-save" style="padding:8px 22px;border-radius:8px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;" ${_saving?'disabled':''}>
              ${_saving ? 'Saving…' : (_editing!==null ? 'Update Vendor' : 'Add Vendor')}
            </button>
          </div>
        </div>
      </div>`;

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

  /* ── Vendor table ───────────────────────────────────────────── */
  function _renderTable() {
    const rows = _filtered();
    if (!rows.length) return `<p style="text-align:center;color:#94a3b8;font-size:13px;padding:32px 0;">No vendors yet.</p>`;
    const actionTh = _canEdit ? `<th class="table-th" style="text-align:right;">Action</th>` : '';
    return `<div class="overflow-x-auto">
      <table class="w-full">
        <thead><tr>
          <th class="table-th">Name</th><th class="table-th">Mobile</th><th class="table-th">Email</th>
          <th class="table-th">State</th><th class="table-th">District</th><th class="table-th">Bank</th>
          <th class="table-th">Status</th>${actionTh}
        </tr></thead>
        <tbody>${rows.map(c => {
          const pill = c.status==='active'
            ? `<span class="pill bg-emerald-50 text-emerald-600">Active</span>`
            : `<span class="pill bg-slate-100 text-slate-500">Inactive</span>`;
          const actionTd = _canEdit ? `<td class="table-td"><div style="display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn-secondary js-edit" data-id="${c.id}" style="font-size:12px;padding:3px 10px;">Edit</button>
            <button class="btn-danger js-delete" data-id="${c.id}" style="font-size:12px;padding:3px 10px;">Delete</button>
          </div></td>` : '';
          return `<tr class="table-row">
            <td class="table-td font-medium text-slate-800">${esc(c.name)}</td>
            <td class="table-td">${esc(c.mobile||c.contact_number||'—')}</td>
            <td class="table-td">${esc(c.email||'—')}</td>
            <td class="table-td">${esc(c.state||'—')}</td>
            <td class="table-td">${esc(c.district||'—')}</td>
            <td class="table-td">${esc(c.bank_name||'—')}</td>
            <td class="table-td">${pill}</td>${actionTd}
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }

  /* ── Payment Management tab ─────────────────────────────────── */
  function _pmFiltered() {
    const t = _pmSearch.trim().toLowerCase();
    if (!t) return _list;
    return _list.filter(v => v.name.toLowerCase().includes(t) || (v.mobile||'').includes(t));
  }

  function _renderPaymentTab() {
    const suggestions = _pmFiltered();
    const showDrop    = _pmDropOpen && suggestions.length > 0;

    const detailCard = _pmSelected ? `
      <div style="border-radius:14px;border:1.5px solid #e2e8f0;overflow:hidden;margin-top:24px;">

        <!-- Vendor header strip -->
        <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:20px 24px;display:flex;align-items:center;gap:16px;">
          <div style="width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,0.12);display:grid;place-items:center;flex-shrink:0;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:17px;font-weight:700;color:#fff;">${esc(_pmSelected.name)}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px;">ID: ${esc(_pmSelected.id)}</div>
          </div>
          <span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.04em;
            background:${_pmSelected.status==='active'?'rgba(16,185,129,.2)':'rgba(148,163,184,.2)'};
            color:${_pmSelected.status==='active'?'#6ee7b7':'#94a3b8'};">
            ${_pmSelected.status==='active'?'ACTIVE':'INACTIVE'}
          </span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">

          <!-- Basic Details -->
          <div style="padding:20px 24px;border-right:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
              <div style="width:26px;height:26px;border-radius:7px;background:#eff6ff;display:grid;place-items:center;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <span style="font-size:12px;font-weight:700;color:#1e293b;letter-spacing:.02em;">Basic Details</span>
            </div>
            ${_infoRow('Mobile',   _pmSelected.mobile||_pmSelected.contact_number)}
            ${_infoRow('Email',    _pmSelected.email)}
            ${_infoRow('State',    _pmSelected.state)}
            ${_infoRow('District', _pmSelected.district)}
            ${_infoRow('Address',  _pmSelected.address)}
            ${_infoRow('Pin Code', _pmSelected.pin)}
          </div>

          <!-- Bank Details -->
          <div style="padding:20px 24px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
              <div style="width:26px;height:26px;border-radius:7px;background:#f0fdf4;display:grid;place-items:center;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
              </div>
              <span style="font-size:12px;font-weight:700;color:#1e293b;letter-spacing:.02em;">Bank Details</span>
            </div>
            ${_infoRow('Bank Name',     _pmSelected.bank_name)}
            ${_infoRow('Account Holder',_pmSelected.account_holder)}
            ${_infoRow('Account No.',   _pmSelected.account_no, true)}
            ${_infoRow('IFSC Code',     _pmSelected.ifsc_code, true)}
            ${_infoRow('Branch',        _pmSelected.branch_name)}
          </div>
        </div>
      </div>` : `
      <div style="margin-top:40px;text-align:center;padding:40px;">
        <div style="width:56px;height:56px;border-radius:16px;background:#f1f5f9;display:grid;place-items:center;margin:0 auto 14px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </div>
        <div style="font-size:14px;font-weight:600;color:#475569;margin-bottom:6px;">Search for a vendor</div>
        <div style="font-size:12px;color:#94a3b8;">Type vendor name above to view their full details</div>
      </div>`;

    return `
      <div style="max-width:780px;margin:0 auto;">
        <!-- Search box -->
        <div style="position:relative;">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ${_pmDropOpen?'#C4714A':'#e2e8f0'};border-radius:12px;background:#fff;transition:border-color .15s;cursor:text;" id="pm-search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input id="pm-search-input" placeholder="Search vendor by name or mobile…"
              value="${esc(_pmSearch)}"
              style="flex:1;border:none;outline:none;font-size:14px;color:#1e293b;background:transparent;"
              autocomplete="off" />
            ${_pmSearch ? `<button id="pm-clear" style="background:transparent;border:none;cursor:pointer;color:#94a3b8;font-size:16px;padding:0;line-height:1;">✕</button>` : ''}
          </div>

          <!-- Dropdown suggestions -->
          ${showDrop ? `
          <div id="pm-dropdown" style="position:absolute;top:calc(100% + 6px);left:0;right:0;background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.12);z-index:20;max-height:240px;overflow-y:auto;">
            ${suggestions.map(v => `
              <div class="pm-opt" data-id="${v.id}"
                style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f8fafc;transition:background .1s;"
                onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background='transparent'">
                <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#C4714A,#D4895A);display:grid;place-items:center;flex-shrink:0;">
                  <span style="color:#fff;font-weight:700;font-size:12px;">${esc(v.name.charAt(0).toUpperCase())}</span>
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:#1e293b;">${esc(v.name)}</div>
                  <div style="font-size:11px;color:#94a3b8;">${esc(v.mobile||v.contact_number||'')} ${v.state?'· '+v.state:''}</div>
                </div>
                <span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;
                  background:${v.status==='active'?'#ecfdf5':'#f1f5f9'};
                  color:${v.status==='active'?'#059669':'#64748b'};">${v.status==='active'?'Active':'Inactive'}</span>
              </div>`).join('')}
          </div>` : ''}
        </div>

        ${detailCard}
      </div>`;
  }

  function _infoRow(label, value, mono=false) {
    const display = val(value);
    return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #f8fafc;">
      <span style="font-size:11px;color:#94a3b8;font-weight:500;flex-shrink:0;margin-right:8px;">${label}</span>
      <span style="font-size:13px;color:#1e293b;font-weight:${display==='—'?'400':'600'};${mono?'font-family:monospace;letter-spacing:.04em;':''};text-align:right;">${esc(display)}</span>
    </div>`;
  }

  /* ── Main render ────────────────────────────────────────────── */
  function _render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    el.innerHTML = `
      <div style="padding:20px;max-width:1200px;margin:0 auto;">

        <!-- Page header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
          <div>
            <h1 style="font-size:18px;font-weight:700;color:#1e293b;margin:0;">Vendor Master</h1>
            <p style="font-size:12px;color:#94a3b8;margin:2px 0 0;">Manage vendors and payment information</p>
          </div>
          ${_tab==='vendors' && _canEdit ? `
          <button id="cm-add-btn" style="padding:9px 20px;border-radius:9px;background:#C4714A;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            Add Vendor
          </button>` : ''}
        </div>

        <!-- Tabs -->
        <div style="display:flex;gap:4px;padding:4px;background:#f1f5f9;border-radius:10px;width:fit-content;margin-bottom:20px;">
          <button id="tab-vendors" onclick="" style="padding:7px 18px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;
            background:${_tab==='vendors'?'#fff':'transparent'};color:${_tab==='vendors'?'#C4714A':'#64748b'};
            box-shadow:${_tab==='vendors'?'0 1px 4px rgba(0,0,0,.1)':'none'};">
            Vendor List
          </button>
          <button id="tab-payments" onclick="" style="padding:7px 18px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;
            background:${_tab==='payments'?'#fff':'transparent'};color:${_tab==='payments'?'#C4714A':'#64748b'};
            box-shadow:${_tab==='payments'?'0 1px 4px rgba(0,0,0,.1)':'none'};">
            Payment Management
          </button>
        </div>

        <!-- Tab content -->
        <div id="cm-tab-content">
          ${_tab === 'vendors' ? _renderVendorTab() : _renderPaymentTab()}
        </div>

        <div id="cm-modal"></div>
      </div>`;

    /* Tab buttons */
    document.getElementById('tab-vendors').addEventListener('click', () => {
      _tab='vendors'; _render();
    });
    document.getElementById('tab-payments').addEventListener('click', () => {
      _tab='payments'; _render();
    });

    /* Add vendor button */
    const addBtn = document.getElementById('cm-add-btn');
    if (addBtn) addBtn.addEventListener('click', _openAdd);

    _bindTableButtons();
    _bindPaymentEvents();
    _renderModal();
  }

  function _renderVendorTab() {
    const rows = _filtered();
    return `
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
        <div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <input id="cm-search" placeholder="Search name / mobile / email…" value="${esc(_q)}"
            style="flex:1;min-width:180px;padding:7px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;" />
          <select id="cm-status-filter"
            style="padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;background:#fff;">
            <option ${_status==='All'      ?'selected':''}>All</option>
            <option ${_status==='Active'   ?'selected':''}>Active</option>
            <option ${_status==='Inactive' ?'selected':''}>Inactive</option>
          </select>
          <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">${rows.length} of ${_list.length}</span>
        </div>
        <div id="cm-table">${_renderTable()}</div>
      </div>`;
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

  function _bindPaymentEvents() {
    const input  = document.getElementById('pm-search-input');
    const clearBtn = document.getElementById('pm-clear');

    if (!input) return;

    input.addEventListener('focus', () => {
      _pmDropOpen = true;
      _rerenderPayment();
    });

    input.addEventListener('input', e => {
      _pmSearch   = e.target.value;
      _pmDropOpen = true;
      _pmSelected = null;
      _rerenderPayment();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        _pmSearch=''; _pmDropOpen=false; _pmSelected=null;
        _rerenderPayment();
      });
    }

    /* Dropdown option click */
    document.querySelectorAll('.pm-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const id = opt.dataset.id;
        _pmSelected = _list.find(v => String(v.id) === String(id)) || null;
        if (_pmSelected) _pmSearch = _pmSelected.name;
        _pmDropOpen = false;
        _rerenderPayment();
      });
    });

    /* Close dropdown on outside click */
    document.addEventListener('click', _pmOutsideClick, { once: true });
  }

  function _pmOutsideClick(e) {
    const box = document.getElementById('pm-search-box');
    if (box && !box.contains(e.target)) {
      _pmDropOpen = false;
      _rerenderPayment();
    }
  }

  function _rerenderPayment() {
    const content = document.getElementById('cm-tab-content');
    if (!content || _tab !== 'payments') return;
    content.innerHTML = _renderPaymentTab();
    _bindPaymentEvents();
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    async render() {
      _canEdit = (window.currentUser?.roles||[]).some
        ? (window.currentUser?.roles||[]).some(r=>r==='Admin'||r==='HOD')
        : String(window.currentUser?.roles||'').includes('Admin');
      _q=''; _status='All'; _open=false; _editing=null; _saving=false;
      _form=_blankForm(); _list=[];
      _pmSearch=''; _pmDropOpen=false; _pmSelected=null;
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;font-size:13px;">Loading vendors…</div>`;
      await _load();
    },
  };
})();
