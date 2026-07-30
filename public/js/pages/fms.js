window.Pages = window.Pages || {};

/* ── shared "Mark as Done" modal — reused by the FMS task page, Dashboard, and
   All Tasks. Attached to window so those other pages can call it directly. ── */
window.FmsDoneModal = (function () {
  let _fmsId = null, _step = null, _row = null, _onSaved = null;
  let _saving = false, _delayReason = '', _extra = {};

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function normalizeDetails(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return Object.entries(data).map(([header, value]) => ({ header, value }));
    return [];
  }

  // Parse a sheet's plan-value text loosely enough to flag lateness client-side —
  // the server is the source of truth for delay reasoning; this only decides
  // whether to force the "reason for delay" field open in the modal.
  function parsePlanDateLoose(val) {
    if (!val) return null;
    const s = String(val).trim();
    let m;
    if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1], 23, 59, 59);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function isLate() {
    const d = parsePlanDateLoose(_row?.planValue);
    return !!(d && d < new Date());
  }

  // Only ask for a delay reason if the step actually has somewhere to save it —
  // no delay_reason_col configured means there's nothing to write it into.
  function needsDelayReason() {
    return isLate() && !!_step?.delay_reason_col;
  }

  function nowPreview() {
    return new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function extraInputHTML(f) {
    const val = _extra[f.col_letter] ?? '';
    const reqMark = f.required ? ' <span style="color:#dc2626;">*</span>' : '';
    if (f.field_type === 'dropdown') {
      const opts = (f.dropdown_options || '').split(',').map(o => o.trim()).filter(Boolean);
      return `
        <div>
          <label class="label">${esc(f.row_label)}${reqMark}</label>
          <select class="input fms-extra-input" data-col="${esc(f.col_letter)}">
            <option value="">Select…</option>
            ${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>
        </div>`;
    }
    const type = f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : f.field_type === 'link' ? 'url' : 'text';
    return `
      <div>
        <label class="label">${esc(f.row_label)}${reqMark}</label>
        <input class="input fms-extra-input" data-col="${esc(f.col_letter)}" type="${type}" value="${esc(val)}" />
      </div>`;
  }

  function bodyHTML() {
    const details = normalizeDetails(_row.data);
    const showDelayReason = needsDelayReason();
    const extraRows = (_step.extraRows || []);

    return `
      <div style="display:flex;flex-direction:column;gap:14px;">
        ${details.length ? `
        <div>
          <div class="label" style="margin-bottom:6px;">Row Data</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
            ${details.map(d => `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;">
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">${esc(d.header)}</div>
                <div style="font-size:12.5px;color:#1e293b;font-weight:600;word-break:break-word;">${esc(d.value) || '—'}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div class="label">Plan Value</div>
            <div style="font-size:13px;font-weight:600;color:#1e293b;padding:8px 0;">${esc(_row.planValue) || '—'}</div>
          </div>
          <div>
            <div class="label">Actual (Now)</div>
            <div style="font-size:13px;font-weight:600;color:#16a34a;padding:8px 0;">${esc(nowPreview())}</div>
          </div>
        </div>

        ${showDelayReason ? `
        <div>
          <label class="label">Reason for Delay <span style="color:#dc2626;">*</span></label>
          <textarea id="fms-done-delay" class="input" rows="2" placeholder="Why is this late?">${esc(_delayReason)}</textarea>
        </div>` : ''}

        ${extraRows.length ? `
        <div>
          <div class="label" style="margin-bottom:6px;">Additional Details</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">
            ${extraRows.map(extraInputHTML).join('')}
          </div>
        </div>` : ''}
      </div>`;
  }

  function render() {
    const existing = document.getElementById('fms-done-modal-overlay');
    const html = `
      <div id="fms-done-modal-overlay" class="modal-overlay" style="display:flex;">
        <div class="modal-box" style="max-width:560px;">
          <div class="modal-header">
            <div style="flex:1;min-width:0;">
              <div class="modal-title">Mark Step as Done</div>
              <div class="modal-subtitle">${esc(_step.step_name)}</div>
            </div>
            <button id="fms-done-close" class="icon-btn" type="button" aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body">${bodyHTML()}</div>
          <div class="modal-footer">
            <button id="fms-done-cancel" class="btn-secondary">Cancel</button>
            <button id="fms-done-save" class="btn-primary" ${_saving ? 'disabled' : ''}>${_saving ? 'Saving…' : '✓ Mark Done'}</button>
          </div>
        </div>
      </div>`;
    if (existing) existing.outerHTML = html; else document.body.insertAdjacentHTML('beforeend', html);
    bind();
  }

  function bind() {
    const overlay = document.getElementById('fms-done-modal-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('fms-done-close')?.addEventListener('click', close);
    document.getElementById('fms-done-cancel')?.addEventListener('click', close);
    document.getElementById('fms-done-save')?.addEventListener('click', save);
    document.getElementById('fms-done-delay')?.addEventListener('input', (e) => { _delayReason = e.target.value; });
    overlay.querySelectorAll('.fms-extra-input').forEach(el => {
      el.addEventListener('input', (e) => { _extra[el.dataset.col] = e.target.value; });
      el.addEventListener('change', (e) => { _extra[el.dataset.col] = e.target.value; });
    });
  }

  async function save() {
    if (needsDelayReason() && !_delayReason.trim()) {
      window.Utils.showToast('Please enter a reason for the delay', 'error');
      return;
    }
    for (const f of (_step.extraRows || [])) {
      if (f.required && !String(_extra[f.col_letter] ?? '').trim()) {
        window.Utils.showToast(`${f.row_label} is required`, 'error');
        return;
      }
    }
    _saving = true;
    render();
    try {
      await window.Utils.apiFetch(`/api/fms-tasks/${_fmsId}/steps/${_step.id}/done`, {
        method: 'POST',
        body: JSON.stringify({
          rowNumber: _row.rowNumber,
          delayReason: _delayReason,
          extraInputs: Object.entries(_extra).map(([colLetter, value]) => ({ colLetter, value })),
        }),
      });
      window.Utils.showToast('Step marked as done');
      const cb = _onSaved;
      close();
      if (cb) cb();
    } catch (e) {
      _saving = false;
      render();
      window.Utils.showToast(e.message || 'Failed to mark done', 'error');
    }
  }

  function close() {
    document.getElementById('fms-done-modal-overlay')?.remove();
    _fmsId = null; _step = null; _row = null; _onSaved = null; _saving = false; _delayReason = ''; _extra = {};
  }

  function open({ fmsId, step, row, onSaved }) {
    _fmsId = fmsId; _step = step; _row = row; _onSaved = onSaved;
    _saving = false; _delayReason = ''; _extra = {};
    render();
  }

  return { open, close };
})();

window.Pages.fms = (() => {
  /* ── state ─────────────────────────────────────────────────────────── */
  let _view = 'list';        // 'list' | 'detail'
  let _sheets = [];
  let _users = [];
  let _detailId = null;
  let _detail = null;        // { sheet, steps, isCoordinator }
  let _detailTab = 'tasks';  // 'tasks' | 'pc' | 'intake'
  let _pc = null;            // { sheet, rows }
  let _intake = null;        // { sheet, fields }
  let _intakeValues = {};
  let _intakeSaving = false;

  // Add/Edit FMS modal state
  let _modalOpen = false, _modalMode = 'create', _modalEditId = null, _modalSaving = false;
  let _modalHeaders = [];    // [{name,col,index}] from fetch-headers
  let _modalForm = null;     // { fmsName, sheetName, sheetId, headerRow, processCoordinatorId, steps:[...] }
  let _modalLoadResult = {}; // stepIdx -> { matched, unmatched }
  let _modalDoerPickerOpen = {}; // stepIdx -> bool, whether the doer checklist is expanded

  // Intake config modal state
  let _intakeModalOpen = false, _intakeModalId = null, _intakeModalSaving = false;
  let _intakeModalForm = null; // { intakeSheetId, intakeSheetName, intakeHeaderRow, intakeFormName, fields:[...] }

  /* ── helpers ───────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isAdmin(user) {
    const roles = Array.isArray(user?.roles) ? user.roles : String(user?.roles || '').split(',').map(r => r.trim());
    return roles.includes('Admin') || roles.includes('HOD');
  }

  function newStep() {
    return {
      stepName: '', planCol: '', actualCol: '', delayReasonCol: '', doerNameCol: '',
      showCols: [], doerIds: [], extraInput: false, extraRows: [], extraCol: '',
    };
  }

  function newExtraField() {
    return { rowLabel: '', colLetter: '', fieldType: 'text', dropdownOptions: '', required: false };
  }

  function newIntakeField() {
    return { fieldLabel: '', colLetter: '', fieldType: 'text', dropdownOptions: '', required: false, autoFill: '', autoFillValue: '' };
  }

  /* ── API ───────────────────────────────────────────────────────────── */
  async function loadList() {
    try { _sheets = await window.Utils.apiFetch('/api/fms') || []; }
    catch (e) { window.Utils.showToast(e.message || 'Failed to load FMS list', 'error'); _sheets = []; }
  }

  async function loadUsers() {
    try { _users = await window.Utils.apiFetch('/api/users') || []; }
    catch { _users = []; }
  }

  async function loadDetail(id) {
    try {
      _detail = await window.Utils.apiFetch(`/api/fms-tasks/${id}`);
    } catch (e) {
      window.Utils.showToast(e.message || 'Failed to load FMS', 'error');
      _detail = null;
    }
    try {
      _intake = await window.Utils.apiFetch(`/api/fms-tasks/${id}/intake`);
    } catch { _intake = { fields: [] }; }
  }

  async function loadPc(id) {
    try { _pc = await window.Utils.apiFetch(`/api/fms/${id}/pc`); }
    catch (e) { window.Utils.showToast(e.message || 'Failed to load PC view', 'error'); _pc = { rows: [] }; }
  }

  /* ── list view ─────────────────────────────────────────────────────── */
  function renderMiniStat(label, value, tone) {
    const colors = { primary: '#5e6ad2', amber: '#d97706', slate: '#475569' }[tone] || '#475569';
    return `<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:${colors};">${esc(value)}</div><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-weight:600;margin-top:1px;">${esc(label)}</div></div>`;
  }

  function renderCard(s, admin) {
    return `
      <div class="card p-4" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="min-width:0;">
            <div style="font-size:14px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(s.fms_name)}">${esc(s.fms_name)}</div>
            <div style="font-size:11.5px;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.sheet_name)}${s.coordinatorName ? ' · PC: ' + esc(s.coordinatorName) : ''}</div>
          </div>
          ${admin ? `
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="icon-btn" data-action="edit" data-id="${esc(s.id)}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="icon-btn" data-action="intake" data-id="${esc(s.id)}" title="Intake Form">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button class="icon-btn danger" data-action="delete" data-id="${esc(s.id)}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            </button>
          </div>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:10px 0;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;">
          ${renderMiniStat('Steps', s.totalSteps, 'slate')}
          ${renderMiniStat('Entries', s.totalEntries, 'slate')}
          ${renderMiniStat('Pending', s.totalPending, 'amber')}
        </div>
        <button class="btn-secondary" data-action="open" data-id="${esc(s.id)}" style="width:100%;">Open →</button>
      </div>`;
  }

  function renderList(el, user, admin) {
    el.innerHTML = `
      <div class="space-y-6 animate-fade-in">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold text-slate-900">FMS — Flow Management System</h1>
            <p class="text-[13px] text-slate-500 mt-0.5">Recurring workflows tracked live in Google Sheets</p>
          </div>
          ${admin ? `
          <button id="fms-add-btn" class="btn-primary flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            Add FMS
          </button>` : ''}
        </div>
        ${_sheets.length === 0 ? window.UI.emptyState({
          title: admin ? 'No FMS workflows yet' : 'No FMS assigned to you',
          message: admin ? 'Add your first flow to start tracking it from a live Google Sheet.' : 'Ask an admin to assign you as a doer on a step.',
        }) : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">${_sheets.map(s => renderCard(s, admin)).join('')}</div>`}
      </div>`;

    document.getElementById('fms-add-btn')?.addEventListener('click', () => openAddModal());
    el.querySelectorAll('[data-action="open"]').forEach(b => b.addEventListener('click', () => openDetail(b.dataset.id)));
    el.querySelectorAll('[data-action="edit"]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(b.dataset.id); }));
    el.querySelectorAll('[data-action="intake"]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openIntakeModal(b.dataset.id); }));
    el.querySelectorAll('[data-action="delete"]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); deleteFms(b.dataset.id); }));
  }

  async function openDetail(id) {
    _view = 'detail'; _detailId = id; _detailTab = 'tasks'; _detail = null; _pc = null;
    renderPage();
    await loadDetail(id);
    renderPage();
  }

  async function deleteFms(id) {
    const ok = await window.Utils.showConfirm('This removes the FMS config (not the Google Sheet or its data). Continue?', { title: 'Delete FMS', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await window.Utils.apiFetch(`/api/fms/${id}`, { method: 'DELETE' });
      window.Utils.showToast('FMS deleted');
      await loadList();
      renderPage();
    } catch (e) { window.Utils.showToast(e.message || 'Failed to delete', 'error'); }
  }

  /* ── detail / task view ───────────────────────────────────────────── */
  function renderDetailHeader(admin) {
    const sheet = _detail.sheet;
    const hasIntake = _intake && _intake.fields && _intake.fields.length > 0;
    return `
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div style="display:flex;align-items:center;gap:10px;">
          <button id="fms-back-btn" class="icon-btn" title="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div>
            <h1 class="text-xl font-bold text-slate-900">${esc(sheet.fms_name)}</h1>
            <p class="text-[12.5px] text-slate-500 mt-0.5">${esc(sheet.sheet_name)}</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          ${hasIntake ? `<button id="fms-new-entry-btn" class="btn-secondary">+ New Entry</button>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:4px;background:#f1f5f9;border-radius:8px;padding:3px;width:fit-content;">
        <button class="fms-tab-btn" data-tab="tasks" style="padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;border:none;cursor:pointer;">My Steps</button>
        ${_detail.isCoordinator ? `<button class="fms-tab-btn" data-tab="pc" style="padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;border:none;cursor:pointer;">PC View</button>` : ''}
      </div>`;
  }

  function renderStepRow(step, admin) {
    const doerNames = (step.doers || []).map(d => d.name).filter(Boolean).join(', ') || '—';
    const rows = step.pending || [];
    return `
      <div class="card" style="overflow:hidden;">
        <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div>
            <div style="font-size:13.5px;font-weight:700;color:#0f172a;">${esc(step.step_name)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:1px;">Doers: ${esc(doerNames)}</div>
          </div>
          <span class="pill pill-warning pill-sm">${rows.length} pending</span>
        </div>
        ${rows.length === 0 ? `<div style="padding:22px;text-align:center;font-size:12.5px;color:#94a3b8;">All caught up — nothing pending for this step.</div>` : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr>
              ${Object.keys(rows[0].data || {}).map(h => `<th class="table-th" style="text-align:left;">${esc(h)}</th>`).join('')}
              <th class="table-th"></th>
            </tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  ${Object.values(r.data || {}).map(v => `<td class="table-td">${esc(v) || '—'}</td>`).join('')}
                  <td class="table-td" style="text-align:right;white-space:nowrap;">
                    <button class="btn-primary btn-sm fms-done-btn" data-step="${esc(step.id)}" data-row="${r.sheetRowNumber}">✓ Done</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>`;
  }

  function renderTasksTab(admin) {
    const steps = (_detail.steps || []).filter(s => admin || s.isMyStep);
    if (!steps.length) return window.UI.emptyState({ title: 'No steps assigned to you', message: 'Ask an admin to add you as a doer on a step of this FMS.' });
    return `<div style="display:flex;flex-direction:column;gap:14px;">${steps.map(s => renderStepRow(s, admin)).join('')}</div>`;
  }

  function renderPcTab() {
    if (!_pc) return `<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px;">Loading PC view…</div>`;
    const rows = _pc.rows || [];
    if (!rows.length) return window.UI.emptyState({ title: 'Nothing pending', message: 'Every step across this FMS is caught up.' });
    const dataKeys = [...new Set(rows.flatMap(r => Object.keys(r.data || {})))];
    return `
      <div class="card" style="overflow:hidden;">
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr>
              <th class="table-th" style="text-align:left;">Step</th>
              <th class="table-th" style="text-align:left;">Doer</th>
              <th class="table-th" style="text-align:left;">Planned Date</th>
              ${dataKeys.map(k => `<th class="table-th" style="text-align:left;">${esc(k)}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td class="table-td">${esc(r.stepName)}</td>
                  <td class="table-td">${esc(r.doer) || '—'}</td>
                  <td class="table-td">${esc(r.planValue) || '—'}</td>
                  ${dataKeys.map(k => `<td class="table-td">${esc((r.data || {})[k]) || '—'}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function renderDetail(el, user, admin) {
    if (!_detail) {
      el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:3rem;color:#94a3b8;font-size:13px;">Loading…</div>`;
      return;
    }
    el.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        ${renderDetailHeader(admin)}
        <div id="fms-detail-body">${_detailTab === 'pc' ? renderPcTab() : renderTasksTab(admin)}</div>
      </div>`;

    document.getElementById('fms-back-btn')?.addEventListener('click', () => { _view = 'list'; renderPage(); });
    document.getElementById('fms-new-entry-btn')?.addEventListener('click', () => openIntakeFormModal());

    el.querySelectorAll('.fms-tab-btn').forEach(btn => {
      const active = btn.dataset.tab === _detailTab;
      btn.style.background = active ? '#fff' : 'transparent';
      btn.style.color = active ? '#0f172a' : '#64748b';
      btn.style.boxShadow = active ? '0 1px 4px rgba(0,0,0,.08)' : 'none';
      btn.addEventListener('click', async () => {
        _detailTab = btn.dataset.tab;
        if (_detailTab === 'pc' && !_pc) { renderPage(); await loadPc(_detailId); renderPage(); }
        else renderPage();
      });
    });

    el.querySelectorAll('.fms-done-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const stepId = btn.dataset.step;
        const rowNumber = parseInt(btn.dataset.row, 10);
        const step = (_detail.steps || []).find(s => s.id === stepId);
        const row = (step.pending || []).find(r => r.sheetRowNumber === rowNumber);
        if (!step || !row) return;
        window.FmsDoneModal.open({
          fmsId: _detailId, step,
          row: { rowNumber: row.sheetRowNumber, planValue: row.planValue, data: row.data },
          onSaved: async () => { await loadDetail(_detailId); renderPage(); },
        });
      });
    });
  }

  /* ── intake form (New Entry) modal ───────────────────────────────── */
  function intakeFieldInputHTML(f) {
    if (f.auto_fill) return ''; // auto-filled fields are never shown to the user
    const val = _intakeValues[f.id] ?? '';
    const reqMark = f.required ? ' <span style="color:#dc2626;">*</span>' : '';
    if (f.field_type === 'dropdown') {
      const opts = (f.dropdown_options || '').split(',').map(o => o.trim()).filter(Boolean);
      return `
        <div>
          <label class="label">${esc(f.field_label)}${reqMark}</label>
          <select class="input fms-intake-input" data-id="${esc(f.id)}">
            <option value="">Select…</option>
            ${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>
        </div>`;
    }
    const type = f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : f.field_type === 'link' ? 'url' : 'text';
    return `
      <div>
        <label class="label">${esc(f.field_label)}${reqMark}</label>
        <input class="input fms-intake-input" data-id="${esc(f.id)}" type="${type}" value="${esc(val)}" />
      </div>`;
  }

  function renderIntakeFormModal() {
    const existing = document.getElementById('fms-intake-form-overlay');
    if (!_intake) { if (existing) existing.remove(); return; }
    const fields = (_intake.fields || []).filter(f => !f.auto_fill);
    const html = `
      <div id="fms-intake-form-overlay" class="modal-overlay" style="display:flex;">
        <div class="modal-box" style="max-width:520px;">
          <div class="modal-header">
            <div style="flex:1;min-width:0;">
              <div class="modal-title">${esc(_intake.sheet?.intake_form_name || 'New Entry')}</div>
              <div class="modal-subtitle">${esc(_intake.sheet?.fms_name || '')}</div>
            </div>
            <button id="fms-intake-form-close" class="icon-btn" type="button" aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${fields.length ? fields.map(intakeFieldInputHTML).join('') : '<div style="font-size:12.5px;color:#94a3b8;">No fields configured for this form.</div>'}
            </div>
          </div>
          <div class="modal-footer">
            <button id="fms-intake-form-cancel" class="btn-secondary">Cancel</button>
            <button id="fms-intake-form-save" class="btn-primary" ${_intakeSaving ? 'disabled' : ''}>${_intakeSaving ? 'Saving…' : 'Submit'}</button>
          </div>
        </div>
      </div>`;
    if (existing) existing.outerHTML = html; else document.body.insertAdjacentHTML('beforeend', html);

    const overlay = document.getElementById('fms-intake-form-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeIntakeFormModal(); });
    document.getElementById('fms-intake-form-close')?.addEventListener('click', closeIntakeFormModal);
    document.getElementById('fms-intake-form-cancel')?.addEventListener('click', closeIntakeFormModal);
    document.getElementById('fms-intake-form-save')?.addEventListener('click', submitIntakeForm);
    overlay.querySelectorAll('.fms-intake-input').forEach(el => {
      const sync = (e) => { _intakeValues[el.dataset.id] = e.target.value; };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
  }

  function openIntakeFormModal() {
    _intakeValues = {};
    _intakeSaving = false;
    renderIntakeFormModal();
  }

  function closeIntakeFormModal() {
    document.getElementById('fms-intake-form-overlay')?.remove();
    _intakeValues = {};
  }

  async function submitIntakeForm() {
    const fields = (_intake.fields || []).filter(f => !f.auto_fill);
    for (const f of fields) {
      if (f.required && !String(_intakeValues[f.id] ?? '').trim()) {
        window.Utils.showToast(`${f.field_label} is required`, 'error');
        return;
      }
    }
    _intakeSaving = true;
    renderIntakeFormModal();
    try {
      await window.Utils.apiFetch(`/api/fms-tasks/${_detailId}/intake`, {
        method: 'POST',
        body: JSON.stringify({ values: _intakeValues }),
      });
      window.Utils.showToast('Entry submitted');
      closeIntakeFormModal();
      await loadDetail(_detailId);
      renderPage();
    } catch (e) {
      _intakeSaving = false;
      renderIntakeFormModal();
      window.Utils.showToast(e.message || 'Failed to submit', 'error');
    }
  }

  /* ── Add/Edit FMS admin modal ────────────────────────────────────── */
  function userOptionsHTML(selectedId) {
    return `<option value="">— None —</option>` + _users.map(u => `<option value="${esc(u.id)}" ${u.id === selectedId ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  }

  // Column-letter fields (Plan/Actual/Doer Name) are all "pick a column from
  // the fetched header row" — a dropdown once headers are loaded, but keep
  // whatever is already configured as a selectable option even if it no
  // longer matches a fetched header (sheet reshuffled, or not fetched yet).
  function colSelectHTML(i, key, currentVal, placeholder) {
    const currentMissing = currentVal && !_modalHeaders.some(h => h.col === currentVal);
    return `
      <select class="input fms-step-field" data-step="${i}" data-k="${key}">
        <option value="">${esc(placeholder)}</option>
        ${currentMissing ? `<option value="${esc(currentVal)}" selected>${esc(currentVal)} (current)</option>` : ''}
        ${_modalHeaders.map(h => `<option value="${esc(h.col)}" ${currentVal === h.col ? 'selected' : ''}>${esc(h.name)} (${esc(h.col)})</option>`).join('')}
      </select>`;
  }

  // Shows the underlying sheet header text next to the label once a column is
  // picked, e.g. "Plan Column (Plan 1)" — a quick sanity check for the admin.
  function colLabelHTML(baseLabel, currentVal) {
    const h = _modalHeaders.find(x => x.col === currentVal);
    return h ? `${esc(baseLabel)} <span style="font-weight:400;color:#94a3b8;">(${esc(h.name)})</span>` : esc(baseLabel);
  }

  // Rebuilt in place on every doer checkbox toggle (see bindAddEditModal) — kept
  // as a standalone function so that patch never has to re-render the whole modal.
  function doerBoxContentHTML(doerIds) {
    const names = _users.filter(u => doerIds.includes(u.id)).map(u => u.name);
    return names.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">${names.map(n => `<span style="display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;">${esc(n)}</span>`).join('')}</div>`
      : `<span style="color:#94a3b8;">Select users…</span>`;
  }

  function stepBlockHTML(step, i, totalSteps) {
    const doerPickerOpen = !!_modalDoerPickerOpen[i];

    const doerChecks = _users.map(u => `
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#334155;padding:2px 0;cursor:pointer;">
        <input type="checkbox" class="fms-doer-chk" data-step="${i}" data-uid="${esc(u.id)}" ${step.doerIds.includes(u.id) ? 'checked' : ''} />
        ${esc(u.name)}
      </label>`).join('');

    // Wrapped chip-style checkboxes (not one-per-line) so a wide header row fits
    // in a compact area instead of a tall scrolling list.
    const showColChecks = _modalHeaders.length ? _modalHeaders.map(h => `
      <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#334155;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;white-space:nowrap;">
        <input type="checkbox" class="fms-showcol-chk" data-step="${i}" data-idx="${h.index}" ${step.showCols.includes(h.index) ? 'checked' : ''} />
        ${esc(h.name)}
      </label>`).join('') : '';

    const loadResult = _modalLoadResult[i];
    const extraRowsHTML = step.extraRows.map((er, j) => `
      <div style="display:grid;grid-template-columns:1.4fr 0.7fr 0.9fr 1.2fr 0.6fr auto;gap:6px;align-items:center;margin-bottom:6px;">
        <input class="input fms-extra-field" data-step="${i}" data-row="${j}" data-k="rowLabel" placeholder="Label" value="${esc(er.rowLabel)}" />
        <input class="input fms-extra-field" data-step="${i}" data-row="${j}" data-k="colLetter" placeholder="Col" value="${esc(er.colLetter)}" style="text-transform:uppercase;" />
        <select class="input fms-extra-field" data-step="${i}" data-row="${j}" data-k="fieldType">
          ${['text', 'number', 'date', 'link', 'dropdown'].map(t => `<option value="${t}" ${er.fieldType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input class="input fms-extra-field" data-step="${i}" data-row="${j}" data-k="dropdownOptions" placeholder="Dropdown options (comma-sep)" value="${esc(er.dropdownOptions)}" ${er.fieldType !== 'dropdown' ? 'disabled style="opacity:.4;"' : ''} />
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;">
          <input type="checkbox" class="fms-extra-req" data-step="${i}" data-row="${j}" ${er.required ? 'checked' : ''} /> req
        </label>
        <button type="button" class="icon-btn danger fms-extra-remove" data-step="${i}" data-row="${j}" title="Remove"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>`).join('');

    const iconBtn = (cls, title, disabled, svgPath) => `
      <button type="button" class="icon-btn ${cls}" data-step="${i}" title="${title}" ${disabled ? 'disabled style="opacity:.3;cursor:default;"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>
      </button>`;

    return `
      <div class="fms-step-block" data-step="${i}" style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:12.5px;font-weight:700;color:var(--color-primary-strong,#b45309);">Step ${i + 1}</div>
          <div style="display:flex;align-items:center;gap:2px;">
            ${iconBtn('fms-step-up', 'Move up', i === 0, '<path d="m18 15-6-6-6 6"/>')}
            ${iconBtn('fms-step-down', 'Move down', i === totalSteps - 1, '<path d="m6 9 6 6 6-6"/>')}
            ${iconBtn('fms-step-dup', 'Duplicate step', false, '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}
            ${iconBtn('fms-step-remove danger', 'Remove step', false, '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/>')}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div><label class="label">Step Name</label><input class="input fms-step-field" data-step="${i}" data-k="stepName" placeholder="Step Name" value="${esc(step.stepName)}" /></div>
          <div>
            <label class="label">Step Doer(s)</label>
            <div class="input fms-doer-toggle" id="fms-doer-box-${i}" data-step="${i}" style="cursor:pointer;min-height:38px;display:flex;align-items:center;">${doerBoxContentHTML(step.doerIds)}</div>
          </div>
        </div>
        ${doerPickerOpen ? `
        <div style="margin-bottom:10px;">
          <div style="max-height:150px;overflow-y:auto;border:1px solid #f1f5f9;border-radius:8px;padding:8px;">${doerChecks || '<span style="font-size:11.5px;color:#94a3b8;">No users found.</span>'}</div>
          ${loadResult ? `
          <div style="margin-top:6px;padding:8px;background:#f8fafc;border-radius:8px;font-size:11.5px;">
            <div style="color:#16a34a;font-weight:600;">Matched: ${loadResult.matched.map(m => esc(m.user_name)).join(', ') || '—'}</div>
            ${loadResult.unmatched.length ? `<div style="color:#dc2626;margin-top:2px;">Unmatched: ${loadResult.unmatched.map(esc).join(', ')}</div>` : ''}
            ${loadResult.matched.length ? `<button type="button" class="btn-secondary btn-sm fms-adopt-matched" data-step="${i}" style="margin-top:6px;">Add All Matched</button>` : ''}
          </div>` : ''}
        </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div><label class="label">${colLabelHTML('Plan Column', step.planCol)}</label>${colSelectHTML(i, 'planCol', step.planCol, 'Column e.g. I')}</div>
          <div><label class="label">${colLabelHTML('Actual Column', step.actualCol)}</label>${colSelectHTML(i, 'actualCol', step.actualCol, 'Column e.g. J')}</div>
        </div>

        <div style="margin-bottom:10px;">
          <label class="label">Columns to Show in FMS Tasks <span style="font-weight:400;color:#94a3b8;">(blank = show all)</span></label>
          ${!_modalHeaders.length ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Will populate once headers are loaded.</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:6px;max-height:110px;overflow-y:auto;border:1px solid #f1f5f9;border-radius:8px;padding:8px;">${showColChecks || '<span style="font-size:11.5px;color:#94a3b8;">Fetch headers above to pick columns.</span>'}</div>
        </div>

        <div style="display:flex;gap:8px;align-items:flex-end;max-width:calc(50% - 4px);margin-bottom:10px;">
          <div style="flex:1;">
            <label class="label">Doer Name Column <span style="font-weight:400;color:#94a3b8;">(auto-saved on completion)</span></label>
            ${colSelectHTML(i, 'doerNameCol', step.doerNameCol, 'None')}
          </div>
          <button type="button" class="btn-secondary btn-sm fms-loaddoers-btn" data-step="${i}" style="white-space:nowrap;padding:9px 12px;">Load Doers</button>
        </div>

        <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#334155;cursor:pointer;margin-bottom:8px;">
          <input type="checkbox" class="fms-extrainput-chk" data-step="${i}" ${step.extraInput ? 'checked' : ''} />
          Collect additional fields when this step is completed
        </label>
        ${step.extraInput ? `
        <div>
          ${extraRowsHTML}
          <button type="button" class="btn-secondary btn-sm fms-extra-add" data-step="${i}">+ Add Field</button>
        </div>` : ''}
      </div>`;
  }

  function modalBodyHTML() {
    const f = _modalForm;
    const fetchBtnHTML = _modalHeaders.length
      ? `<button type="button" id="fms-m-refetch" class="btn-secondary" style="width:100%;justify-content:center;">✅ ${_modalHeaders.length} columns loaded — click to refetch</button>`
      : `<button type="button" id="fms-m-refetch" class="btn-secondary" style="width:100%;justify-content:center;">🔍 Fetch Column Headers</button>`;
    return `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><label class="label">FMS Name <span style="font-weight:400;color:#94a3b8;">(display name)</span></label><input id="fms-m-name" class="input" placeholder="e.g. Factory O2O, Recruitment FMS…" value="${esc(f.fmsName)}" /></div>
          <div><label class="label">Google Sheet Tab Name</label><input id="fms-m-tabname" class="input" placeholder="e.g. Sheet1" value="${esc(f.sheetName)}" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><label class="label">Google Sheet ID <span style="font-weight:400;color:#94a3b8;">(or full URL)</span></label><input id="fms-m-sheetid" class="input" placeholder="Sheet ID or full URL" value="${esc(f.sheetId)}" /></div>
          <div><label class="label">Header Row</label><input id="fms-m-headerrow" class="input" type="number" min="1" value="${esc(f.headerRow)}" /></div>
        </div>
        <div><label class="label">Process Coordinator</label><select id="fms-m-pc" class="input">${userOptionsHTML(f.processCoordinatorId)}</select></div>
        ${fetchBtnHTML}

        <div style="border-top:1px solid #e2e8f0;padding-top:12px;">
          <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">Steps</div>
          <div id="fms-m-steps">${f.steps.map((s, i) => stepBlockHTML(s, i, f.steps.length)).join('')}</div>
        </div>
      </div>`;
  }

  const FMS_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

  function renderAddEditModal() {
    const existing = document.getElementById('fms-modal-overlay');
    if (!_modalOpen) { if (existing) existing.remove(); return; }
    const html = `
      <div id="fms-modal-overlay" class="modal-overlay" style="display:flex;">
        <div class="modal-box" style="max-width:760px;max-height:88vh;">
          <div class="modal-header">
            <div class="modal-header-icon">${FMS_ICON_SVG}</div>
            <div style="flex:1;">
              <div class="modal-title">${_modalMode === 'edit' ? 'Edit FMS Flow' : 'New FMS Flow'}</div>
              <div class="modal-subtitle">Point at a Google Sheet, then configure each step's columns</div>
            </div>
            <button type="button" id="fms-m-addstep-top" class="btn-secondary btn-sm" style="margin-right:4px;">+ Add Step</button>
            <button id="fms-modal-close" class="icon-btn" type="button" aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body" style="max-height:60vh;overflow-y:auto;">${modalBodyHTML()}</div>
          <div class="modal-footer" style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:11.5px;color:#94a3b8;">${_modalForm.steps.length} step${_modalForm.steps.length === 1 ? '' : 's'}</span>
            <div style="display:flex;gap:8px;">
              <button id="fms-modal-cancel" class="btn-secondary">Cancel</button>
              <button id="fms-modal-save" class="btn-primary" ${_modalSaving ? 'disabled' : ''}>${_modalSaving ? 'Saving…' : (_modalMode === 'edit' ? '💾 Save Changes' : 'Save FMS')}</button>
            </div>
          </div>
        </div>
      </div>`;
    if (existing) existing.outerHTML = html; else document.body.insertAdjacentHTML('beforeend', html);
    bindAddEditModal();
  }

  function bindAddEditModal() {
    const overlay = document.getElementById('fms-modal-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAddEditModal(); });
    document.getElementById('fms-modal-close')?.addEventListener('click', closeAddEditModal);
    document.getElementById('fms-modal-cancel')?.addEventListener('click', closeAddEditModal);
    document.getElementById('fms-modal-save')?.addEventListener('click', saveAddEditModal);
    document.getElementById('fms-modal-close-x')?.addEventListener('click', closeAddEditModal);

    document.getElementById('fms-m-name')?.addEventListener('input', (e) => { _modalForm.fmsName = e.target.value; });
    document.getElementById('fms-m-sheetid')?.addEventListener('input', (e) => { _modalForm.sheetId = e.target.value; });
    document.getElementById('fms-m-tabname')?.addEventListener('input', (e) => { _modalForm.sheetName = e.target.value; });
    document.getElementById('fms-m-headerrow')?.addEventListener('input', (e) => { _modalForm.headerRow = parseInt(e.target.value, 10) || 1; });
    document.getElementById('fms-m-pc')?.addEventListener('change', (e) => { _modalForm.processCoordinatorId = e.target.value || null; });
    document.getElementById('fms-m-refetch')?.addEventListener('click', fetchModalHeaders);
    document.getElementById('fms-m-addstep-top')?.addEventListener('click', () => { _modalForm.steps.push(newStep()); renderAddEditModal(); });

    overlay.querySelectorAll('.fms-step-remove').forEach(b => b.addEventListener('click', () => {
      _modalForm.steps.splice(parseInt(b.dataset.step, 10), 1);
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-step-up').forEach(b => b.addEventListener('click', () => {
      const i = parseInt(b.dataset.step, 10);
      if (i <= 0) return;
      const [s] = _modalForm.steps.splice(i, 1);
      _modalForm.steps.splice(i - 1, 0, s);
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-step-down').forEach(b => b.addEventListener('click', () => {
      const i = parseInt(b.dataset.step, 10);
      if (i >= _modalForm.steps.length - 1) return;
      const [s] = _modalForm.steps.splice(i, 1);
      _modalForm.steps.splice(i + 1, 0, s);
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-step-dup').forEach(b => b.addEventListener('click', () => {
      const i = parseInt(b.dataset.step, 10);
      const copy = JSON.parse(JSON.stringify(_modalForm.steps[i]));
      _modalForm.steps.splice(i + 1, 0, copy);
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-step-field').forEach(el => {
      const sync = (e) => { _modalForm.steps[parseInt(el.dataset.step, 10)][el.dataset.k] = e.target.value; };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    overlay.querySelectorAll('.fms-doer-chk').forEach(el => el.addEventListener('change', (e) => {
      const stepIdx = parseInt(el.dataset.step, 10);
      const step = _modalForm.steps[stepIdx];
      const uid = el.dataset.uid;
      if (e.target.checked) { if (!step.doerIds.includes(uid)) step.doerIds.push(uid); }
      else step.doerIds = step.doerIds.filter(id => id !== uid);
      // Patch just the chip box in place — no full modal re-render, so the
      // checklist stays open and scroll position doesn't jump on every click.
      const box = document.getElementById(`fms-doer-box-${stepIdx}`);
      if (box) box.innerHTML = doerBoxContentHTML(step.doerIds);
    }));
    overlay.querySelectorAll('.fms-showcol-chk').forEach(el => el.addEventListener('change', (e) => {
      const step = _modalForm.steps[parseInt(el.dataset.step, 10)];
      const idx = parseInt(el.dataset.idx, 10);
      if (e.target.checked) { if (!step.showCols.includes(idx)) step.showCols.push(idx); }
      else step.showCols = step.showCols.filter(x => x !== idx);
    }));
    overlay.querySelectorAll('.fms-extrainput-chk').forEach(el => el.addEventListener('change', (e) => {
      const step = _modalForm.steps[parseInt(el.dataset.step, 10)];
      step.extraInput = e.target.checked;
      if (step.extraInput && !step.extraRows.length) step.extraRows.push(newExtraField());
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-extra-add').forEach(b => b.addEventListener('click', () => {
      _modalForm.steps[parseInt(b.dataset.step, 10)].extraRows.push(newExtraField());
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-extra-remove').forEach(b => b.addEventListener('click', () => {
      const step = _modalForm.steps[parseInt(b.dataset.step, 10)];
      step.extraRows.splice(parseInt(b.dataset.row, 10), 1);
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-extra-field').forEach(el => {
      const sync = (e) => {
        const step = _modalForm.steps[parseInt(el.dataset.step, 10)];
        step.extraRows[parseInt(el.dataset.row, 10)][el.dataset.k] = e.target.value;
        if (el.dataset.k === 'fieldType') renderAddEditModal();
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    overlay.querySelectorAll('.fms-extra-req').forEach(el => el.addEventListener('change', (e) => {
      const step = _modalForm.steps[parseInt(el.dataset.step, 10)];
      step.extraRows[parseInt(el.dataset.row, 10)].required = e.target.checked;
    }));
    overlay.querySelectorAll('.fms-doer-toggle').forEach(el => el.addEventListener('click', () => {
      const i = parseInt(el.dataset.step, 10);
      _modalDoerPickerOpen[i] = !_modalDoerPickerOpen[i];
      renderAddEditModal();
    }));
    overlay.querySelectorAll('.fms-loaddoers-btn').forEach(b => b.addEventListener('click', () => loadDoersFromColumn(parseInt(b.dataset.step, 10))));
    overlay.querySelectorAll('.fms-adopt-matched').forEach(b => b.addEventListener('click', () => {
      const i = parseInt(b.dataset.step, 10);
      const result = _modalLoadResult[i];
      if (!result) return;
      const step = _modalForm.steps[i];
      result.matched.forEach(m => { if (!step.doerIds.includes(m.user_id)) step.doerIds.push(m.user_id); });
      delete _modalLoadResult[i];
      renderAddEditModal();
    }));
  }

  async function fetchModalHeaders() {
    if (!_modalForm.sheetId.trim() || !_modalForm.sheetName.trim()) {
      window.Utils.showToast('Enter the Sheet URL/ID and Tab Name first', 'error');
      return;
    }
    try {
      _modalHeaders = await window.Utils.apiFetch('/api/fms/fetch-headers', {
        method: 'POST',
        body: JSON.stringify({ sheetUrlOrId: _modalForm.sheetId, tabName: _modalForm.sheetName, headerRow: _modalForm.headerRow }),
      }) || [];
      window.Utils.showToast(`Fetched ${_modalHeaders.length} columns`);
      renderAddEditModal();
    } catch (e) { window.Utils.showToast(e.message || 'Failed to fetch headers', 'error'); }
  }

  async function loadDoersFromColumn(stepIdx) {
    const colLetter = (_modalForm.steps[stepIdx]?.doerNameCol || '').trim().toUpperCase();
    if (!colLetter) { window.Utils.showToast('Pick a Doer Name Column first', 'error'); return; }
    if (!_modalForm.sheetId.trim() || !_modalForm.sheetName.trim()) { window.Utils.showToast('Enter the Sheet ID and Tab Name first', 'error'); return; }
    try {
      const qs = new URLSearchParams({ sheetUrlOrId: _modalForm.sheetId, tabName: _modalForm.sheetName, colLetter, headerRow: _modalForm.headerRow }).toString();
      const result = await window.Utils.apiFetch(`/api/fms/sheet-column-values?${qs}`);
      _modalLoadResult[stepIdx] = result;
      _modalDoerPickerOpen[stepIdx] = true;
      renderAddEditModal();
    } catch (e) { window.Utils.showToast(e.message || 'Failed to load column values', 'error'); }
  }

  function closeAddEditModal() {
    _modalOpen = false; _modalSaving = false; _modalForm = null; _modalHeaders = []; _modalLoadResult = {}; _modalDoerPickerOpen = {};
    renderAddEditModal();
  }

  async function openAddModal() {
    _modalMode = 'create'; _modalEditId = null; _modalHeaders = []; _modalLoadResult = {}; _modalDoerPickerOpen = {};
    _modalForm = { fmsName: '', sheetName: '', sheetId: '', headerRow: 1, processCoordinatorId: null, steps: [newStep()] };
    _modalOpen = true;
    renderAddEditModal();
  }

  async function openEditModal(id) {
    _modalMode = 'edit'; _modalEditId = id; _modalHeaders = []; _modalLoadResult = {}; _modalDoerPickerOpen = {};
    _modalOpen = true;
    _modalForm = { fmsName: '', sheetName: '', sheetId: '', headerRow: 1, processCoordinatorId: null, steps: [] };
    renderAddEditModal();
    try {
      const full = await window.Utils.apiFetch(`/api/fms/${id}`);
      _modalForm = {
        fmsName: full.fms_name || '', sheetName: full.sheet_name || '', sheetId: full.sheet_id || '',
        headerRow: full.header_row || 1, processCoordinatorId: full.process_coordinator_id || null,
        steps: (full.steps || []).map(s => ({
          stepName: s.step_name || '', planCol: s.plan_col || '', actualCol: s.actual_col || '',
          delayReasonCol: s.delay_reason_col || '', doerNameCol: s.doer_name_col || '',
          showCols: Array.isArray(s.show_cols) ? s.show_cols : [],
          doerIds: (s.doers || []).map(d => d.user_id),
          extraInput: s.extra_input === 'yes',
          extraCol: s.extra_col || '',
          extraRows: (s.extraRows || []).map(er => ({
            rowLabel: er.row_label || '', colLetter: er.col_letter || '', fieldType: er.field_type || 'text',
            dropdownOptions: er.dropdown_options || '', required: !!er.required,
          })),
        })),
      };
      if (!_modalForm.steps.length) _modalForm.steps.push(newStep());
      renderAddEditModal();
      if (_modalForm.sheetId && _modalForm.sheetName) await fetchModalHeaders();
    } catch (e) {
      window.Utils.showToast(e.message || 'Failed to load FMS config', 'error');
    }
  }

  async function saveAddEditModal() {
    const f = _modalForm;
    if (!f.fmsName.trim()) { window.Utils.showToast('FMS name is required', 'error'); return; }
    if (!f.sheetId.trim()) { window.Utils.showToast('Google Sheet URL/ID is required', 'error'); return; }
    if (!f.sheetName.trim()) { window.Utils.showToast('Tab name is required', 'error'); return; }
    for (const s of f.steps) {
      if (!s.stepName.trim() || !s.planCol.trim() || !s.actualCol.trim()) {
        window.Utils.showToast('Every step needs a name, Plan column and Actual column', 'error');
        return;
      }
    }
    _modalSaving = true;
    renderAddEditModal();
    try {
      const body = JSON.stringify({
        fmsName: f.fmsName.trim(), sheetName: f.sheetName.trim(), sheetId: f.sheetId.trim(),
        headerRow: f.headerRow || 1, processCoordinatorId: f.processCoordinatorId || null,
        steps: f.steps,
      });
      if (_modalMode === 'edit') await window.Utils.apiFetch(`/api/fms/${_modalEditId}`, { method: 'PUT', body });
      else await window.Utils.apiFetch('/api/fms', { method: 'POST', body });
      window.Utils.showToast(_modalMode === 'edit' ? 'FMS updated' : 'FMS created');
      closeAddEditModal();
      await loadList();
      renderPage();
    } catch (e) {
      _modalSaving = false;
      renderAddEditModal();
      window.Utils.showToast(e.message || 'Failed to save FMS', 'error');
    }
  }

  /* ── Intake Form config modal (admin) ─────────────────────────────── */
  function intakeConfigFieldHTML(field, j) {
    return `
      <div style="display:grid;grid-template-columns:1.4fr 0.7fr 0.9fr 1.2fr 0.9fr 0.9fr 0.5fr auto;gap:6px;align-items:center;margin-bottom:6px;">
        <input class="input fms-icfg-field" data-row="${j}" data-k="fieldLabel" placeholder="Label" value="${esc(field.fieldLabel)}" />
        <input class="input fms-icfg-field" data-row="${j}" data-k="colLetter" placeholder="Col" value="${esc(field.colLetter)}" style="text-transform:uppercase;" />
        <select class="input fms-icfg-field" data-row="${j}" data-k="fieldType">
          ${['text', 'number', 'date', 'link', 'dropdown'].map(t => `<option value="${t}" ${field.fieldType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input class="input fms-icfg-field" data-row="${j}" data-k="dropdownOptions" placeholder="Dropdown options" value="${esc(field.dropdownOptions)}" ${field.fieldType !== 'dropdown' ? 'disabled style="opacity:.4;"' : ''} />
        <select class="input fms-icfg-field" data-row="${j}" data-k="autoFill">
          <option value="" ${!field.autoFill ? 'selected' : ''}>No auto-fill</option>
          <option value="timestamp" ${field.autoFill === 'timestamp' ? 'selected' : ''}>Timestamp</option>
          <option value="user_name" ${field.autoFill === 'user_name' ? 'selected' : ''}>Current user</option>
          <option value="fixed" ${field.autoFill === 'fixed' ? 'selected' : ''}>Fixed value</option>
        </select>
        <input class="input fms-icfg-field" data-row="${j}" data-k="autoFillValue" placeholder="Fixed value" value="${esc(field.autoFillValue)}" ${field.autoFill !== 'fixed' ? 'disabled style="opacity:.4;"' : ''} />
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;">
          <input type="checkbox" class="fms-icfg-req" data-row="${j}" ${field.required ? 'checked' : ''} /> req
        </label>
        <button type="button" class="icon-btn danger fms-icfg-remove" data-row="${j}" title="Remove"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>`;
  }

  function intakeConfigModalBodyHTML() {
    const f = _intakeModalForm;
    return `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="font-size:11.5px;color:#94a3b8;">Leave the sheet fields below empty to use the FMS's own tracking sheet for new entries.</div>
        <div><label class="label">Form Display Name</label><input id="fms-icfg-formname" class="input" value="${esc(f.intakeFormName)}" placeholder="New Entry" /></div>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;">
          <div><label class="label">Intake Sheet URL/ID (optional)</label><input id="fms-icfg-sheetid" class="input" value="${esc(f.intakeSheetId)}" /></div>
          <div><label class="label">Intake Tab Name (optional)</label><input id="fms-icfg-sheetname" class="input" value="${esc(f.intakeSheetName)}" /></div>
          <div><label class="label">Header Row (optional)</label><input id="fms-icfg-headerrow" class="input" type="number" min="1" value="${esc(f.intakeHeaderRow || '')}" /></div>
        </div>
        <div style="border-top:1px solid #e2e8f0;padding-top:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;">Fields</div>
            <button type="button" id="fms-icfg-addfield" class="btn-secondary btn-sm">+ Add Field</button>
          </div>
          <div id="fms-icfg-fields">${f.fields.map(intakeConfigFieldHTML).join('')}</div>
        </div>
      </div>`;
  }

  function renderIntakeModal() {
    const existing = document.getElementById('fms-icfg-overlay');
    if (!_intakeModalOpen) { if (existing) existing.remove(); return; }
    const html = `
      <div id="fms-icfg-overlay" class="modal-overlay" style="display:flex;">
        <div class="modal-box" style="max-width:760px;max-height:88vh;">
          <div class="modal-header">
            <div style="flex:1;">
              <div class="modal-title">Intake Form Config</div>
              <div class="modal-subtitle">Defines the "New Entry" form users see for this FMS</div>
            </div>
            <button id="fms-icfg-close" class="icon-btn" type="button" aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-body" style="max-height:60vh;overflow-y:auto;">${_intakeModalForm ? intakeConfigModalBodyHTML() : '<div style="padding:2rem;text-align:center;color:#94a3b8;">Loading…</div>'}</div>
          <div class="modal-footer">
            <button id="fms-icfg-cancel" class="btn-secondary">Cancel</button>
            <button id="fms-icfg-save" class="btn-primary" ${_intakeModalSaving ? 'disabled' : ''}>${_intakeModalSaving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>`;
    if (existing) existing.outerHTML = html; else document.body.insertAdjacentHTML('beforeend', html);
    bindIntakeModal();
  }

  function bindIntakeModal() {
    const overlay = document.getElementById('fms-icfg-overlay');
    if (!overlay || !_intakeModalForm) return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeIntakeModal(); });
    document.getElementById('fms-icfg-close')?.addEventListener('click', closeIntakeModal);
    document.getElementById('fms-icfg-cancel')?.addEventListener('click', closeIntakeModal);
    document.getElementById('fms-icfg-save')?.addEventListener('click', saveIntakeModal);
    document.getElementById('fms-icfg-formname')?.addEventListener('input', (e) => { _intakeModalForm.intakeFormName = e.target.value; });
    document.getElementById('fms-icfg-sheetid')?.addEventListener('input', (e) => { _intakeModalForm.intakeSheetId = e.target.value; });
    document.getElementById('fms-icfg-sheetname')?.addEventListener('input', (e) => { _intakeModalForm.intakeSheetName = e.target.value; });
    document.getElementById('fms-icfg-headerrow')?.addEventListener('input', (e) => { _intakeModalForm.intakeHeaderRow = parseInt(e.target.value, 10) || null; });
    document.getElementById('fms-icfg-addfield')?.addEventListener('click', () => { _intakeModalForm.fields.push(newIntakeField()); renderIntakeModal(); });

    overlay.querySelectorAll('.fms-icfg-remove').forEach(b => b.addEventListener('click', () => {
      _intakeModalForm.fields.splice(parseInt(b.dataset.row, 10), 1);
      renderIntakeModal();
    }));
    overlay.querySelectorAll('.fms-icfg-field').forEach(el => {
      const sync = (e) => {
        _intakeModalForm.fields[parseInt(el.dataset.row, 10)][el.dataset.k] = e.target.value;
        if (el.dataset.k === 'fieldType' || el.dataset.k === 'autoFill') renderIntakeModal();
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    overlay.querySelectorAll('.fms-icfg-req').forEach(el => el.addEventListener('change', (e) => {
      _intakeModalForm.fields[parseInt(el.dataset.row, 10)].required = e.target.checked;
    }));
  }

  function closeIntakeModal() {
    _intakeModalOpen = false; _intakeModalForm = null; _intakeModalId = null; _intakeModalSaving = false;
    renderIntakeModal();
  }

  async function openIntakeModal(id) {
    _intakeModalOpen = true; _intakeModalId = id; _intakeModalForm = null;
    renderIntakeModal();
    try {
      const { sheet, fields } = await window.Utils.apiFetch(`/api/fms/${id}/intake-fields`);
      _intakeModalForm = {
        intakeFormName: sheet.intake_form_name || '', intakeSheetId: sheet.intake_sheet_id || '',
        intakeSheetName: sheet.intake_sheet_name || '', intakeHeaderRow: sheet.intake_header_row || null,
        fields: (fields || []).map(f => ({
          fieldLabel: f.field_label || '', colLetter: f.col_letter || '', fieldType: f.field_type || 'text',
          dropdownOptions: f.dropdown_options || '', required: !!f.required,
          autoFill: f.auto_fill || '', autoFillValue: f.auto_fill_value || '',
        })),
      };
      renderIntakeModal();
    } catch (e) {
      window.Utils.showToast(e.message || 'Failed to load intake config', 'error');
      closeIntakeModal();
    }
  }

  async function saveIntakeModal() {
    const f = _intakeModalForm;
    _intakeModalSaving = true;
    renderIntakeModal();
    try {
      await window.Utils.apiFetch(`/api/fms/${_intakeModalId}/intake-fields`, {
        method: 'PUT',
        body: JSON.stringify(f),
      });
      window.Utils.showToast('Intake form saved');
      closeIntakeModal();
      await loadList();
      if (_view === 'detail') await loadDetail(_detailId);
      renderPage();
    } catch (e) {
      _intakeModalSaving = false;
      renderIntakeModal();
      window.Utils.showToast(e.message || 'Failed to save', 'error');
    }
  }

  /* ── page render ───────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const user = window.currentUser;
    const admin = isAdmin(user);
    if (_view === 'detail') renderDetail(el, user, admin);
    else renderList(el, user, admin);
  }

  /* ── public entry point ───────────────────────────────────────────── */
  return {
    async render() {
      const el = document.getElementById('main-content');
      if (!el) return;
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;"><div style="text-align:center;"><div style="width:40px;height:40px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);animation:spin .7s linear infinite;margin:0 auto 14px;"></div><div style="font-size:13px;color:#94a3b8;font-weight:500;">Loading…</div></div></div>';
      _view = 'list';
      await Promise.all([loadList(), loadUsers()]);
      renderPage();
    },
  };
})();
