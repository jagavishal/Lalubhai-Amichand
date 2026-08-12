window.Pages['daily-task'] = (function () {

  /* ── state ─────────────────────────────────────────────────── */
  let rows       = [blankRow()];
  let entryDate  = todayISO();
  let past       = [];
  let users      = [];
  let clients    = [];
  let saving     = false;
  let msg        = '';

  // Quick-delegate form state
  let dlg = {
    open:        false,
    description: '',
    doerId:      '',
    dueDate:     '',
    priority:    'Low',
    approval:    'No Approval',
    url:         '',
    remarks:     '',
    saving:      false,
    msg:         '',
  };

  /* ── helpers ───────────────────────────────────────────────── */
  function blankRow() {
    return { client: '', department: '', description: '', minutes: '' };
  }

  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB').replaceAll('/', '-');
  }

  function totalMinutes() {
    return rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0);
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function user() {
    return window.currentUser || {};
  }

  function isAdmin() {
    const r = user().roles;
    if (!r) return false;
    if (Array.isArray(r)) return r.includes('Admin') || r.includes('HOD');
    return String(r).includes('Admin') || String(r).includes('HOD');
  }

  /* ── data loading ──────────────────────────────────────────── */
  async function loadPast() {
    const doerId = user().id;
    if (!doerId) return;
    try {
      const res = await fetch('/api/daily-tasks?doerId=' + encodeURIComponent(doerId));
      const data = await res.json();
      past = Array.isArray(data) ? data : [];
    } catch (_) { past = []; }
  }

  async function loadUsers() {
    try {
      const data = await fetch('/api/users').then(r => r.json());
      if (Array.isArray(data)) {
        users = data.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }
    } catch (_) { /* ignore */ }
  }

  async function loadClients() {
    try {
      const data = await fetch('/api/clients').then(r => r.json());
      if (Array.isArray(data)) {
        clients = data.map(c => c.name).filter(Boolean).sort();
      }
    } catch (_) { /* ignore */ }
  }

  /* ── render ────────────────────────────────────────────────── */
  function renderRows() {
    return rows.map((r, i) => `
      <tr data-row="${i}" class="border-t border-slate-100 align-top">
        <td class="table-td">
          <input class="input row-client" list="dt-clients" placeholder="--select--"
            value="${esc(r.client)}" data-field="client" data-i="${i}" />
        </td>
        <td class="table-td">
          <select class="input row-dept" data-field="department" data-i="${i}">
            ${Utils.deptOptionsHtml(r.department, { placeholder: '--select--' })}
          </select>
        </td>
        <td class="table-td">
          <textarea class="input min-h-[40px] row-desc" rows="1" placeholder="What did you do?"
            data-field="description" data-i="${i}">${esc(r.description)}</textarea>
        </td>
        <td class="table-td w-24">
          <input type="number" min="0" class="input row-min" value="${esc(r.minutes)}"
            data-field="minutes" data-i="${i}" />
        </td>
        <td class="table-td">
          <div class="flex gap-1 justify-end">
            <button class="btn-success btn-dup" data-i="${i}">DUP</button>
            <button class="btn-danger btn-del" data-i="${i}">DEL</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderPast() {
    // group by date
    const g = {};
    for (const e of past) {
      const k = (e.entryDate || '').split('T')[0];
      if (!g[k]) g[k] = [];
      g[k].push(e);
    }
    const grouped = Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]));

    if (!grouped.length) {
      return '<p class="text-[12.5px] text-slate-400">No submissions yet.</p>';
    }

    return `<div class="space-y-3">
      ${grouped.map(([date, entries]) => {
        const dayTotal = entries.reduce((s, e) => s + (Number(e.minutes) || 0), 0);
        return `
          <div class="border border-slate-200 rounded-lg p-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-[13px] font-semibold text-slate-800">&#128197; ${fmtDate(date)}</span>
              <span class="pill bg-slate-100 text-slate-600">${entries.length} task${entries.length === 1 ? '' : 's'}</span>
              <span class="pill bg-amber-50 text-amber-600">${dayTotal} min total</span>
            </div>
            ${entries.map(e => `
              <div class="flex items-start gap-2 text-[12.5px] py-1">
                ${e.client    ? `<span class="pill bg-orange-50 text-orange-600 shrink-0">${esc(e.client)}</span>`     : ''}
                ${e.department ? `<span class="pill bg-primary-50 text-primary-700 shrink-0">${esc(e.department)}</span>` : ''}
                <span class="text-slate-700">${esc(e.description)}</span>
                <span class="ml-auto pill bg-amber-50 text-amber-600 shrink-0">${e.minutes} min</span>
              </div>
            `).join('')}
          </div>
        `;
      }).join('')}
    </div>`;
  }

  function renderDelegateModal() {
    if (!dlg.open) return '';
    return `
      <div id="dlg-overlay" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div id="dlg-box" class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
          <!-- header -->
          <div class="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 grid place-items-center">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 11 2 2 4-4"/></svg>
            </div>
            <div class="flex-1">
              <h2 class="text-base font-semibold text-slate-900">+ Delegate Task</h2>
              <p class="text-[12px] text-slate-500 mt-0.5">Assign new work to a team member</p>
            </div>
            <button id="dlg-close" class="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- body -->
          <div class="p-6 space-y-4 overflow-y-auto">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label">Doer (Assign To) *</label>
                <select id="dlg-doerId" class="input">
                  <option value="">Select Doer</option>
                  ${users.map(u => `<option value="${esc(u.id)}" ${dlg.doerId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="label">Due Date *</label>
                <input type="date" id="dlg-dueDate" class="input" value="${esc(dlg.dueDate)}"
                  min="${todayISO()}" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label">Priority</label>
                <select id="dlg-priority" class="input">
                  <option ${dlg.priority === 'Low'    ? 'selected' : ''}>Low</option>
                  <option ${dlg.priority === 'Medium' ? 'selected' : ''}>Medium</option>
                  <option ${dlg.priority === 'High'   ? 'selected' : ''}>High</option>
                </select>
              </div>
              <div>
                <label class="label">Approval Required</label>
                <select id="dlg-approval" class="input">
                  <option ${dlg.approval === 'No Approval'       ? 'selected' : ''}>No Approval</option>
                  <option ${dlg.approval === 'Approval Required' ? 'selected' : ''}>Approval Required</option>
                </select>
              </div>
            </div>

            <div>
              <label class="label">Description *</label>
              <textarea id="dlg-description" rows="3" class="input resize-none"
                placeholder="Enter task description...">${esc(dlg.description)}</textarea>
            </div>

            <div>
              <label class="label">URL <span class="text-slate-400 font-normal">(optional)</span></label>
              <input id="dlg-url" class="input" value="${esc(dlg.url)}" placeholder="https://..." />
            </div>

            <div>
              <label class="label">Remarks</label>
              <textarea id="dlg-remarks" rows="2" class="input resize-none"
                placeholder="Any remarks...">${esc(dlg.remarks)}</textarea>
            </div>

            ${dlg.msg ? `<div class="text-[12px] text-slate-600">${esc(dlg.msg)}</div>` : ''}
          </div>

          <!-- footer -->
          <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <button id="dlg-cancel" class="btn-secondary">Close</button>
            <button id="dlg-save" class="btn-primary" ${dlg.saving ? 'disabled' : ''}>
              ${dlg.saving ? 'Assigning&#8230;' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderPage() {
    const u = user();
    const total = totalMinutes();
    return `
      <div class="space-y-4">

        <!-- Daily task entry card -->
        <div class="card p-5">
          <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <div class="text-[15px] font-semibold text-slate-900">Daily Task</div>
              <div class="text-[12px] text-slate-500">Welcome <b>${esc(u.name || 'User')}</b></div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              ${isAdmin() ? `
                <button id="btn-delegate" class="btn-primary flex items-center gap-1.5">
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                  Delegate Task
                </button>
              ` : ''}
              <div class="text-[12px] text-slate-500">${new Date().toLocaleString('en-GB')}</div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 max-w-md">
            <div>
              <label class="label">Entry Date</label>
              <input type="date" id="entry-date" class="input" value="${esc(entryDate)}" />
            </div>
            <div>
              <label class="label">Doer</label>
              <input class="input bg-slate-50" value="${esc(u.name || '')}" disabled />
            </div>
          </div>

          <div class="overflow-x-auto rounded-lg border border-slate-200">
            <table class="w-full" id="rows-table">
              <thead class="bg-slate-900 text-white">
                <tr>
                  <th class="table-th !text-white">Client</th>
                  <th class="table-th !text-white">Department</th>
                  <th class="table-th !text-white">Task Description</th>
                  <th class="table-th !text-white">Time (min)</th>
                  <th class="table-th !text-white text-right pr-3">Actions</th>
                </tr>
              </thead>
              <tbody id="task-rows">
                ${renderRows()}
              </tbody>
            </table>
            <datalist id="dt-clients">
              ${clients.map(c => `<option value="${esc(c)}" />`).join('')}
            </datalist>
          </div>

          <div class="flex items-center justify-between mt-3 px-3 py-2 bg-slate-50 rounded-lg">
            <span class="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Total Duration</span>
            <span id="total-display" class="text-[18px] font-bold text-amber-500">
              ${total} <span class="text-[12px] text-slate-400">min</span>
            </span>
          </div>

          <div class="flex items-center justify-end gap-2 mt-4">
            ${msg ? `<span id="submit-msg" class="text-[12px] mr-auto">${esc(msg)}</span>` : '<span id="submit-msg" class="text-[12px] mr-auto"></span>'}
            <button id="btn-add-row" class="btn-secondary">+ Add Row</button>
            <button id="btn-submit" class="btn-warn" ${saving ? 'disabled' : ''}>
              ${saving ? 'Submitting&#8230;' : 'Submit All &#8594;'}
            </button>
          </div>
        </div>

        <!-- Past submissions card -->
        <div class="card p-5">
          <div class="text-[14px] font-semibold text-slate-900 mb-3">&#128210; My Past Submissions</div>
          <div id="past-container">
            ${renderPast()}
          </div>
        </div>

      </div>

      ${renderDelegateModal()}
    `;
  }

  /* ── partial updates ───────────────────────────────────────── */
  function refreshRows() {
    const tbody = document.getElementById('task-rows');
    if (tbody) tbody.innerHTML = renderRows();
    refreshTotal();
    bindRowEvents();
  }

  function refreshTotal() {
    const el = document.getElementById('total-display');
    if (el) el.innerHTML = `${totalMinutes()} <span class="text-[12px] text-slate-400">min</span>`;
  }

  function refreshPast() {
    const el = document.getElementById('past-container');
    if (el) el.innerHTML = renderPast();
  }

  function setMsg(text) {
    msg = text;
    const el = document.getElementById('submit-msg');
    if (el) el.textContent = text;
  }

  /* ── row mutations ─────────────────────────────────────────── */
  function addRow() {
    rows.push(blankRow());
    refreshRows();
  }

  function dupRow(i) {
    rows.splice(i + 1, 0, { ...rows[i] });
    refreshRows();
  }

  function delRow(i) {
    if (rows.length === 1) { rows = [blankRow()]; }
    else { rows.splice(i, 1); }
    refreshRows();
  }

  /* ── submit ────────────────────────────────────────────────── */
  async function submitAll() {
    const clean = rows.filter(r => r.description.trim() || r.client || Number(r.minutes) > 0);
    if (!clean.length) { setMsg('Add at least one task row.'); return; }
    saving = true;
    setMsg('');
    const btn = document.getElementById('btn-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
      const u = user();
      const res = await fetch('/api/daily-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryDate, doerId: u.id, doer: u.name, rows: clean }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed');
      }
      setMsg('✅ Submitted!');
      rows = [blankRow()];
      refreshRows();
      await loadPast();
      refreshPast();
    } catch (e) {
      setMsg('❌ ' + e.message);
    } finally {
      saving = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Submit All →'; }
    }
  }

  /* ── delegate modal logic ──────────────────────────────────── */
  function openDelegateModal() {
    dlg = {
      open:        true,
      description: '',
      doerId:      '',
      dueDate:     '',
      priority:    'Low',
      approval:    'No Approval',
      url:         '',
      remarks:     '',
      saving:      false,
      msg:         '',
    };
    rerenderModal();
  }

  function closeDelegateModal() {
    dlg.open = false;
    const overlay = document.getElementById('dlg-overlay');
    if (overlay) overlay.remove();
  }

  function rerenderModal() {
    // Remove existing overlay if any
    const existing = document.getElementById('dlg-overlay');
    if (existing) existing.remove();

    if (!dlg.open) return;

    // Append fresh modal HTML
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderDelegateModal();
    const overlay = wrapper.firstElementChild;
    document.body.appendChild(overlay);

    bindModalEvents();
  }

  async function saveDelegation() {
    // Read current field values from DOM
    dlg.description = (document.getElementById('dlg-description')?.value || '').trim();
    dlg.doerId      = document.getElementById('dlg-doerId')?.value      || '';
    dlg.dueDate     = document.getElementById('dlg-dueDate')?.value     || '';
    dlg.priority    = document.getElementById('dlg-priority')?.value    || 'Low';
    dlg.approval    = document.getElementById('dlg-approval')?.value    || 'No Approval';
    dlg.url         = document.getElementById('dlg-url')?.value         || '';
    dlg.remarks     = document.getElementById('dlg-remarks')?.value     || '';

    if (!dlg.description || !dlg.doerId || !dlg.dueDate) {
      dlg.msg = 'Description, Doer and Due Date are required.';
      updateModalMsg(dlg.msg);
      return;
    }

    dlg.saving = true;
    dlg.msg    = '';
    updateModalSaving(true);

    try {
      const u   = user();
      const res = await fetch('/api/delegations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: dlg.description,
          doerId:      dlg.doerId,
          dueDate:     dlg.dueDate,
          priority:    dlg.priority,
          approval:    dlg.approval,
          url:         dlg.url,
          remarks:     dlg.remarks,
          delegatedBy: u.id,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed');
      }
      Utils.showToast('Task delegated successfully!');
      closeDelegateModal();
    } catch (e) {
      dlg.saving = false;
      dlg.msg    = '❌ ' + e.message;
      updateModalSaving(false);
      updateModalMsg(dlg.msg);
    }
  }

  function updateModalMsg(text) {
    // Find or create msg element inside modal body
    const body = document.querySelector('#dlg-box .overflow-y-auto');
    if (!body) return;
    let msgEl = body.querySelector('.dlg-msg');
    if (!msgEl) {
      msgEl = document.createElement('div');
      msgEl.className = 'dlg-msg text-[12px] text-slate-600';
      body.appendChild(msgEl);
    }
    msgEl.textContent = text;
  }

  function updateModalSaving(isSaving) {
    const btn = document.getElementById('dlg-save');
    if (!btn) return;
    btn.disabled    = isSaving;
    btn.textContent = isSaving ? 'Assigning…' : 'Assign';
  }

  /* ── event binding ─────────────────────────────────────────── */
  function bindRowEvents() {
    const tbody = document.getElementById('task-rows');
    if (!tbody) return;

    // Input / select / textarea change. The Department select's "+ Add new
    // department" row is a sentinel, not a value — Utils.bindDeptSelect below
    // handles it (and writes the real department back into the row), so it must
    // never be stored here as if it were a department name.
    tbody.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', (e) => {
        const i     = Number(e.target.dataset.i);
        const field = e.target.dataset.field;
        if (e.target.value === Utils.DEPT_ADD_NEW) return;
        rows[i][field] = e.target.value;
        if (field === 'minutes') refreshTotal();
      });
      el.addEventListener('change', (e) => {
        const i     = Number(e.target.dataset.i);
        const field = e.target.dataset.field;
        if (e.target.value === Utils.DEPT_ADD_NEW) return;
        rows[i][field] = e.target.value;
      });
    });

    // Department dropdowns — one master list for the whole app, and adding one
    // here makes it available everywhere else too.
    tbody.querySelectorAll('.row-dept').forEach(sel => {
      Utils.bindDeptSelect(sel, (value) => { rows[Number(sel.dataset.i)].department = value; }, { placeholder: '--select--' });
    });

    // DUP / DEL buttons
    tbody.querySelectorAll('.btn-dup').forEach(btn => {
      btn.addEventListener('click', () => dupRow(Number(btn.dataset.i)));
    });
    tbody.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => delRow(Number(btn.dataset.i)));
    });
  }

  function bindModalEvents() {
    document.getElementById('dlg-close')?.addEventListener('click',  closeDelegateModal);
    document.getElementById('dlg-cancel')?.addEventListener('click', closeDelegateModal);
    document.getElementById('dlg-save')?.addEventListener('click',   saveDelegation);

    // Close on overlay click (outside the box)
    document.getElementById('dlg-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'dlg-overlay') closeDelegateModal();
    });
  }

  function bindPageEvents() {
    // Entry date
    document.getElementById('entry-date')?.addEventListener('change', (e) => {
      entryDate = e.target.value;
    });

    // Add row
    document.getElementById('btn-add-row')?.addEventListener('click', addRow);

    // Submit
    document.getElementById('btn-submit')?.addEventListener('click', submitAll);

    // Open delegate modal (Admin only)
    document.getElementById('btn-delegate')?.addEventListener('click', openDelegateModal);

    // Row-level events
    bindRowEvents();
  }

  /* ── public render ─────────────────────────────────────────── */
  return {
    async render() {
      const el = document.getElementById('main-content');
      if (!el) return;

      // Reset state on each navigation to this page
      rows      = [blankRow()];
      entryDate = todayISO();
      past      = [];
      saving    = false;
      msg       = '';
      dlg.open  = false;

      // Show skeleton while data loads
      el.innerHTML = `
        <div class="space-y-4">
          <div class="card p-5 animate-pulse h-64"></div>
          <div class="card p-5 animate-pulse h-32"></div>
        </div>
      `;

      // Load data in parallel — departments included, because renderPage()
      // builds every row's Department dropdown straight out of Utils' cache.
      await Promise.all([loadPast(), loadUsers(), loadClients(), Utils.getDepartments()]);

      // Full render
      el.innerHTML = renderPage();
      bindPageEvents();
    },
  };
})();
