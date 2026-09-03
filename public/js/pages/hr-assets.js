/* =====================================================================
   HR Assets
   ---------------------------------------------------------------------
   The asset register from the old sheet's Assets / Assets Repair tabs:
   what the company owns, who is holding it, and what is at the shop.

   One page, two audiences. An Admin gets the full register — add, edit,
   assign, send to repair, and the repair book on its own tab. Everyone
   else gets "My Assets": the things booked out to them, read-only, the
   same view the old Apps Script HRMS gave them.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-assets'] = (() => {
  const H = window.HR;

  let _mine = false;
  let _assets = [];
  let _repairs = [];
  let _employees = [];
  let _tab = 'register';
  let _filter = { q: '', category: 'All', type: 'All', status: 'All' };

  const STATUSES = ['Available', 'Assigned', 'Under Repair', 'Scrapped'];
  // The sheet's own condition vocabulary (New/Good/Fair/Poor — verified
  // against all 93 rows of the Assets tab), so the register keeps speaking
  // the words the company already uses. 'Working' survives in the good-set
  // for rows created before the vocabulary was aligned with the import.
  const CONDITIONS = ['New', 'Good', 'Fair', 'Poor'];
  const GOOD = new Set(['New', 'Good', 'Working']);

  // The shared STATUS_VARIANT map doesn't know asset wording, so this page
  // carries its own.
  const VARIANT = {
    Available: 'success', Assigned: 'info', 'Under Repair': 'warning', Scrapped: 'neutral',
    New: 'info', Good: 'success', Working: 'success', Fair: 'warning', Poor: 'danger',
    open: 'warning', done: 'success',
  };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');

  async function load() {
    const res = await H.api('/api/hr/assets');
    _mine = !!res.mine;
    _assets = res.assets || [];
    if (!_mine) {
      const [repairs, masters] = await Promise.all([
        H.api('/api/hr/asset-repairs').catch(() => []),
        H.api('/api/hr/masters').catch(() => ({})),
      ]);
      _repairs = repairs || [];
      _employees = (masters.employees || []).filter((e) => e.status === 'Active');
    }
  }

  const holderOf = (a) => a.assigned_name || a.assigned_to || '';

  function filtered() {
    const f = _filter;
    const needle = f.q.trim().toLowerCase();
    return _assets.filter((a) => {
      if (f.category !== 'All' && a.category !== f.category) return false;
      if (f.type !== 'All' && a.asset_type !== f.type) return false;
      if (f.status !== 'All' && a.status !== f.status) return false;
      if (needle) {
        const hay = [a.id, a.name, a.serial_no, holderOf(a)].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    el.innerHTML = `<div class="animate-fade-in">${_mine ? myView() : adminView()}</div>`;
    bind();
  }

  function myView() {
    const assigned = _assets.filter((a) => a.status === 'Assigned').length;
    const working = _assets.filter((a) => GOOD.has(a.asset_condition)).length;
    const repair = _assets.filter((a) => a.status === 'Under Repair').length;
    return `
      ${H.header('My Assets', 'Everything the company has booked out to you',
        `<button id="hra-add" class="btn-primary btn-sm">+ Add Asset</button>`)}
      ${H.stats([
        { label: 'My Assets', value: _assets.length },
        { label: 'Currently Assigned', value: assigned },
        { label: 'Good Condition', value: _assets.length ? working : '—' },
        { label: 'Under Repair', value: repair, color: repair ? '#d97706' : undefined },
      ])}
      ${H.table(
        ['Code', 'Category', 'Type', 'Asset', 'Serial No', 'Since', 'Status', ''],
        _assets.map((a) => [
          `<b>${H.esc(a.id)}</b>`, H.esc(a.category), H.esc(a.asset_type), H.esc(a.name),
          H.esc(a.serial_no || '—'), H.fmtDate(a.assigned_on), pill(a.status),
          `<button class="btn-secondary btn-sm" data-view="${H.esc(a.id)}">View</button>`,
        ]),
        { empty: 'Nothing is assigned to you yet — Add Asset to record what you are holding' },
      )}`;
  }

  function adminView() {
    const actions = `
      <button id="hra-export" class="btn-secondary btn-sm">Export CSV</button>
      <button id="hra-add" class="btn-primary btn-sm">+ Add Asset</button>`;
    const openRepairs = _repairs.filter((r) => r.status === 'open').length;
    return `
      ${H.header('Assets', 'The asset register — what the company owns and who is holding it', actions)}
      ${H.tabs('hra', [
        { key: 'register', label: 'Register', count: _assets.length },
        { key: 'repairs', label: 'Repairs', count: openRepairs || _repairs.length },
      ], _tab)}
      ${_tab === 'register' ? registerTab() : repairsTab()}`;
  }

  function registerTab() {
    const uniq = (arr) => ['All', ...[...new Set(arr.filter(Boolean))].sort()];
    const rows = filtered();
    const count = (s) => _assets.filter((a) => a.status === s).length;
    return `
      ${H.stats([
        { label: 'Total Assets', value: _assets.length },
        { label: 'Assigned', value: count('Assigned') },
        { label: 'Available', value: count('Available') },
        { label: 'Under Repair', value: count('Under Repair'), color: count('Under Repair') ? '#d97706' : undefined },
        { label: 'Good Condition', value: _assets.filter((a) => GOOD.has(a.asset_condition)).length },
      ])}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="hra-q" value="${H.esc(_filter.q)}" placeholder="Search code, name, serial, holder…"
          style="${H.CONTROL}max-width:240px;" />
        ${['category', 'type', 'status'].map((k) => `
          <select id="hra-f-${k}" style="${H.CONTROL}max-width:170px;">
            ${(k === 'status' ? ['All', ...STATUSES]
              : uniq(_assets.map((a) => (k === 'category' ? a.category : a.asset_type))))
              .map((o) => `<option value="${H.esc(o)}"${_filter[k] === o ? ' selected' : ''}>${H.esc(o === 'All' ? `All ${k === 'category' ? 'Categories' : k === 'type' ? 'Types' : 'Statuses'}` : o)}</option>`).join('')}
          </select>`).join('')}
        <button id="hra-clear" class="btn-secondary btn-sm">Clear</button>
      </div>
      ${H.table(
        ['Code', 'Category', 'Type', 'Asset', 'Serial No', 'Assigned To', 'Condition', 'Status', 'Actions'],
        rows.map((a) => [
          `<b>${H.esc(a.id)}</b>`, H.esc(a.category), H.esc(a.asset_type), H.esc(a.name),
          H.esc(a.serial_no || '—'), H.esc(holderOf(a) || '—'),
          pill(a.asset_condition), pill(a.status),
          `<div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button class="btn-secondary btn-sm" data-view="${H.esc(a.id)}">View</button>
            <button class="btn-secondary btn-sm" data-edit="${H.esc(a.id)}">Edit</button>
            <button class="btn-secondary btn-sm" data-assign="${H.esc(a.id)}">${holderOf(a) ? 'Reassign' : 'Assign'}</button>
            ${a.status !== 'Under Repair' ? `<button class="btn-secondary btn-sm" data-repair="${H.esc(a.id)}">Repair</button>` : ''}
            ${H.isOwner() ? `<button class="btn-secondary btn-sm" data-del="${H.esc(a.id)}" style="color:#dc2626;">Delete</button>` : ''}
          </div>`,
        ]),
        { empty: _assets.length ? 'No assets match these filters' : 'No assets yet — add one, or run the sheet import from Employee Master' },
      )}`;
  }

  function repairsTab() {
    return H.table(
      ['Asset', 'Issue', 'Reported', 'Vendor', { label: 'Cost', align: 'right' }, 'Status', 'Resolved', ''],
      _repairs.map((r) => [
        `<b>${H.esc(r.asset_id)}</b><div style="font-size:11px;color:#94a3b8;">${H.esc(r.asset_name || '')}</div>`,
        H.esc(r.issue),
        `${H.fmtDate(r.reported_on)}${r.reported_by ? `<div style="font-size:11px;color:#94a3b8;">${H.esc(r.reported_by)}</div>` : ''}`,
        H.esc(r.vendor || '—'), H.inr(r.cost), pill(r.status), H.fmtDate(r.resolved_on),
        r.status === 'open'
          ? `<div style="display:flex;gap:5px;"><button class="btn-secondary btn-sm" data-rep-edit="${H.esc(r.id)}">Update</button>
             <button class="btn-primary btn-sm" data-rep-done="${H.esc(r.id)}">Mark Done</button></div>`
          : '',
      ]),
      { empty: 'No repairs on record' },
    );
  }

  /* ── Modals ───────────────────────────────────────────────────────── */

  function assetForm(a) {
    const editing = !!a;
    a = a || {};
    H.openModal({
      id: 'hra-form',
      title: editing ? `Edit ${a.id}` : 'Add Asset',
      subtitle: editing ? ''
        : _mine ? 'This asset is recorded as assigned to you; its code is generated from the category and type'
        : 'The unique code (LAL-ELE-LAP-001 style) is generated from the category and type',
      width: 620,
      bodyHTML: H.grid(
        H.field('af-category', 'Category', a.category, { required: true, placeholder: 'Electronic' })
        + H.field('af-type', 'Asset Type', a.asset_type, { required: true, placeholder: 'Laptop' })
        + H.field('af-name', 'Asset Name', a.name, { required: true, placeholder: 'Lenovo - V14 G3 IAP', span: 2 })
        + H.field('af-serial', 'Serial No', a.serial_no)
        + H.select('af-condition', 'Condition', a.asset_condition || 'Good',
            CONDITIONS.includes(a.asset_condition) || !a.asset_condition ? CONDITIONS : [a.asset_condition, ...CONDITIONS])
        + (editing ? H.select('af-status', 'Status', a.status, STATUSES,
            { hint: 'Assigning and repairs move this on their own — set it by hand only to scrap or to fix a mistake' }) : '')
        + H.field('af-pdate', 'Purchase Date', a.purchase_date, { type: 'date' })
        + H.field('af-cost', 'Purchase Cost (₹)', a.purchase_cost || '', { type: 'number', step: '0.01' })
        + H.field('af-vendor', 'Vendor', a.vendor)
        + H.field('af-warranty', 'Warranty Till', a.warranty_till, { type: 'date' })
        + H.textarea('af-notes', 'Notes', a.notes || ''),
      ),
      confirmText: editing ? 'Save Changes' : 'Add Asset',
      onConfirm: async () => {
        const body = {
          category: H.val('af-category'), asset_type: H.val('af-type'), name: H.val('af-name'),
          serial_no: H.val('af-serial'), asset_condition: H.val('af-condition'),
          purchase_date: H.val('af-pdate'), purchase_cost: H.val('af-cost'),
          vendor: H.val('af-vendor'), warranty_till: H.val('af-warranty'), notes: H.val('af-notes'),
        };
        if (!body.name.trim()) throw new Error('Asset name is required');
        if (editing) body.status = H.val('af-status');
        if (editing) await H.patch(`/api/hr/assets/${encodeURIComponent(a.id)}`, body);
        else await H.post('/api/hr/assets', body);
        H.closeModal('hra-form');
        H.toast(editing ? 'Asset updated' : 'Asset added');
        await refresh();
      },
    });
  }

  function assignModal(a) {
    const holder = holderOf(a);
    H.openModal({
      id: 'hra-assign',
      title: `Assign ${a.id}`,
      subtitle: holder ? `Currently with ${holder}` : 'Currently in stock',
      bodyHTML: H.grid(
        H.select('as-emp', 'Assign To', a.assigned_to || '', [
          { value: '', label: '— Return to stock —' },
          ..._employees.map((e) => ({ value: e.id, label: `${e.name} (${e.id})` })),
        ], { span: 2 }),
      ),
      confirmText: 'Save',
      onConfirm: async () => {
        await H.post(`/api/hr/assets/${encodeURIComponent(a.id)}/assign`, { employee_id: H.val('as-emp') });
        H.closeModal('hra-assign');
        H.toast('Assignment saved');
        await refresh();
      },
    });
  }

  function repairModal(a) {
    H.openModal({
      id: 'hra-repair',
      title: `Send ${a.id} for repair`,
      subtitle: 'The asset shows as Under Repair until this is marked done',
      bodyHTML: H.grid(
        H.field('rp-issue', 'Issue', '', { required: true, span: 2, placeholder: 'What is wrong with it' })
        + H.field('rp-vendor', 'Vendor / Service Centre', '')
        + H.field('rp-cost', 'Estimated Cost (₹)', '', { type: 'number', step: '0.01' })
        + H.textarea('rp-remarks', 'Remarks', ''),
      ),
      confirmText: 'Open Repair',
      onConfirm: async () => {
        if (!H.val('rp-issue').trim()) throw new Error('Describe the issue');
        await H.post(`/api/hr/assets/${encodeURIComponent(a.id)}/repairs`, {
          issue: H.val('rp-issue'), vendor: H.val('rp-vendor'),
          cost: H.val('rp-cost'), remarks: H.val('rp-remarks'),
        });
        H.closeModal('hra-repair');
        H.toast('Repair opened');
        await refresh();
      },
    });
  }

  function repairEditModal(r, markDone) {
    H.openModal({
      id: 'hra-rep-edit',
      title: markDone ? `Close repair — ${r.asset_id}` : `Update repair — ${r.asset_id}`,
      subtitle: markDone ? 'The asset goes back to its holder, or to stock if it has none' : '',
      bodyHTML: H.grid(
        H.field('re-issue', 'Issue', r.issue, { span: 2 })
        + H.field('re-vendor', 'Vendor', r.vendor)
        + H.field('re-cost', 'Actual Cost (₹)', r.cost || '', { type: 'number', step: '0.01' })
        + H.textarea('re-remarks', 'Remarks', r.remarks || ''),
      ),
      confirmText: markDone ? 'Mark Done' : 'Save',
      onConfirm: async () => {
        await H.patch(`/api/hr/asset-repairs/${encodeURIComponent(r.id)}`, {
          issue: H.val('re-issue'), vendor: H.val('re-vendor'),
          cost: H.val('re-cost'), remarks: H.val('re-remarks'),
          status: markDone ? 'done' : r.status,
        });
        H.closeModal('hra-rep-edit');
        H.toast(markDone ? 'Repair closed' : 'Repair updated');
        await refresh();
      },
    });
  }

  async function viewModal(id) {
    let detail;
    try { detail = await H.api(`/api/hr/assets/${encodeURIComponent(id)}`); }
    catch (e) { return H.fail(e); }
    const a = detail.asset;
    const repairs = detail.repairs || [];
    H.openModal({
      id: 'hra-view',
      title: a.name,
      subtitle: a.id,
      width: 620,
      hideConfirm: true,
      cancelText: 'Close',
      bodyHTML: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Category', a.category)}${H.readout('Asset Type', a.asset_type)}
          ${H.readout('Serial No', a.serial_no)}${H.readout('Condition', a.asset_condition)}
          ${H.readout('Status', a.status)}${H.readout('Assigned To', holderOf(a))}
          ${H.readout('Assigned On', a.assigned_on ? H.fmtDate(a.assigned_on) : '')}
          ${H.readout('Purchase Date', a.purchase_date ? H.fmtDate(a.purchase_date) : '')}
          ${H.readout('Purchase Cost', a.purchase_cost > 0 ? '₹ ' + H.inr(a.purchase_cost) : '')}
          ${H.readout('Vendor', a.vendor)}
          ${H.readout('Warranty Till', a.warranty_till ? H.fmtDate(a.warranty_till) : '')}
        </div>
        ${a.notes ? `<div style="font-size:12.5px;color:#64748b;margin-top:12px;white-space:pre-wrap;">${H.esc(a.notes)}</div>` : ''}
        ${repairs.length ? `
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:16px 0 8px;">Repair History</div>
          ${repairs.map((r) => `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
              <div><div style="color:#1e293b;">${H.esc(r.issue)}</div>
                <div style="font-size:11px;color:#94a3b8;">${H.fmtDate(r.reported_on)}${r.vendor ? ' · ' + H.esc(r.vendor) : ''}${H.num(r.cost) ? ' · ₹ ' + H.inr(r.cost) : ''}</div></div>
              <div>${pill(r.status)}</div>
            </div>`).join('')}` : ''}`,
    });
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  async function refresh() {
    try { await load(); render(); } catch (e) { H.fail(e); }
  }

  function bind() {
    document.querySelectorAll('[data-hra-tab]').forEach((b) => b.addEventListener('click', () => {
      _tab = b.getAttribute('data-hra-tab');
      render();
    }));

    document.getElementById('hra-add')?.addEventListener('click', () => assetForm(null));
    document.getElementById('hra-export')?.addEventListener('click', () => {
      H.downloadCsv('assets.csv',
        ['Unique Code', 'Category', 'Asset Type', 'Asset Name', 'Serial No', 'Assigned To', 'Condition', 'Status', 'Purchase Date', 'Purchase Cost', 'Vendor', 'Warranty Till'],
        filtered().map((a) => [a.id, a.category, a.asset_type, a.name, a.serial_no, holderOf(a),
          a.asset_condition, a.status, a.purchase_date || '', a.purchase_cost || '', a.vendor || '', a.warranty_till || '']));
    });

    const q = document.getElementById('hra-q');
    if (q) {
      let t;
      q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          _filter.q = q.value;
          render();
          // Re-rendering replaces the input, so put the cursor back where it was.
          const q2 = document.getElementById('hra-q');
          if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
        }, 250);
      });
    }
    for (const k of ['category', 'type', 'status']) {
      document.getElementById(`hra-f-${k}`)?.addEventListener('change', (e) => { _filter[k] = e.target.value; render(); });
    }
    document.getElementById('hra-clear')?.addEventListener('click', () => {
      _filter = { q: '', category: 'All', type: 'All', status: 'All' };
      render();
    });

    const byId = (id) => _assets.find((a) => a.id === id);
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewModal(b.getAttribute('data-view'))));
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => assetForm(byId(b.getAttribute('data-edit')))));
    document.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => assignModal(byId(b.getAttribute('data-assign')))));
    document.querySelectorAll('[data-repair]').forEach((b) => b.addEventListener('click', () => repairModal(byId(b.getAttribute('data-repair')))));
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-del');
      const ok = await Utils.showConfirm(
        `Delete ${id} and its repair history? Scrapping (Edit → Status) is usually the right move — delete only a row added by mistake.`,
        { title: 'Delete Asset', confirmText: 'Delete', danger: true },
      );
      if (!ok) return;
      try { await H.del(`/api/hr/assets/${encodeURIComponent(id)}`); H.toast('Asset deleted'); await refresh(); }
      catch (e) { H.fail(e); }
    }));
    const repById = (id) => _repairs.find((r) => r.id === id);
    document.querySelectorAll('[data-rep-edit]').forEach((b) => b.addEventListener('click', () => repairEditModal(repById(b.getAttribute('data-rep-edit')), false)));
    document.querySelectorAll('[data-rep-done]').forEach((b) => b.addEventListener('click', () => repairEditModal(repById(b.getAttribute('data-rep-done')), true)));
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening the asset register…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load assets', e.message); }
    },
  };
})();
