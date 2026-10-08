/* Task Forms — the "+ Delegate Task" and "+ Add Checklist Task" popups.
   Dashboard and All Tasks each used to carry their own copy of both forms,
   and the copies drifted: different look, different labels and buttons,
   different required fields ("All task aur Dashboard page pe checklist aur
   delegation ke form alag alag aa rahe hai, same karo"). Both pages now open
   these, so there is one form to change.

   TaskForms.openDelegate({ users, onSaved, edit })
   TaskForms.openChecklist({ users, onSaved, edit })
     users   — the page's user list ({ id, name, email, active })
     onSaved — awaited after a save or CSV upload, to refresh the page
     edit    — optional; opens the same full form filled in, to change an
               existing task ("all task se edit krne jaye to pura form
               khulna chahiye"): { values, onSubmit(values), series }.
               The caller's onSubmit does the PATCH; no CSV section. */
window.TaskForms = (function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CHECKLIST_FREQ_OPTIONS = [
    ['daily', 'Daily (365 tasks/year)'],
    ['alternative_week', 'Alternative Week (26 tasks/year)'],
    ['weekly', 'Weekly (52 tasks/year)'],
    ['monthly', 'Monthly (12 tasks/year)'],
    ['quarterly', 'Quarterly (4 tasks/year)'],
    ['yearly', 'Yearly (1 task/year)'],
  ];
  const freqOptionsHtml = (selected) => CHECKLIST_FREQ_OPTIONS
    .map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`).join('');

  // /api/users returns inactive rows too, and two rows can share a display
  // name ("Sarvan, susil, jayash ka name 2-2 baar aa rha hai") — keep the
  // active ones, one per name.
  function pickableUsers(users) {
    const seen = new Set();
    return (users || [])
      .filter(u => u.active !== false)
      .filter(u => {
        const key = String(u.name || '').trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  /* ── CSV ─────────────────────────────────────────────────────────── */
  function parseCsvLine(line) {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  async function readCsvRows(file, headerAliases = {}) {
    const text = (await file.text()).replace(/^﻿/, '');
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines[0] || '').map(h => { const k = h.trim().toLowerCase(); return headerAliases[k] || k; });
    return lines.slice(1).map(row => {
      const cols = parseCsvLine(row).map(c => c.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || '');
      return obj;
    });
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseFlexibleDate(s) {
    if (!s) return null;
    s = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    let m = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/);
    if (m) {
      const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (mon) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }

  function csvSection(prefix, sampleHref, formatText) {
    return `<div style="border-top:1px solid var(--border-light);padding:12px 20px 16px;background:var(--surface-alt, #fafafa);flex-shrink:0;">
      <p style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;text-align:center;margin:0 0 10px;">Or Bulk Upload CSV</p>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <input type="file" id="${prefix}-csv-file" accept=".csv" style="font-size:12px;flex:1;min-width:0;" />
        <button type="button" id="${prefix}-csv-upload" style="padding:6px 14px;border-radius:7px;background:#10b981;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;">+ Upload CSV</button>
        <a href="${sampleHref}" download style="padding:6px 14px;border-radius:7px;background:#fff;color:#374151;border:1.5px solid #e2e8f0;font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap;">↓ Sample</a>
      </div>
      <p style="font-size:10.5px;color:#94a3b8;margin:8px 0 0;">${formatText}</p>
    </div>`;
  }

  /* ── Modal shell (style.css .modal-* classes) ────────────────────── */
  function openShell(id, title, bodyHtml, footerHtml, csvHtml) {
    document.getElementById(id)?.remove();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'modal-overlay';
    div.style.zIndex = '9000';
    div.innerHTML = `
      <div class="modal-box" style="max-width:520px;">
        <div class="modal-header">
          <h2 style="font-size:15px;font-weight:700;margin:0;flex:1;">${esc(title)}</h2>
          <button type="button" data-tf-close aria-label="Close" style="width:28px;height:28px;border-radius:50%;background:var(--border-light);border:none;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto;">${bodyHtml}</div>
        <div class="modal-footer" style="justify-content:space-between;">${footerHtml}</div>
        ${csvHtml}
      </div>`;
    const close = () => div.remove();
    div.addEventListener('click', e => { if (e.target === div) close(); });
    div.querySelectorAll('[data-tf-close]').forEach(b => b.addEventListener('click', close));
    document.body.appendChild(div);
    return { div, close };
  }

  const optional = '<span style="font-size:10px;color:#94a3b8;font-weight:400;text-transform:none;">(OPTIONAL)</span>';

  function showError(el, msg) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }

  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  // The doer dropdown, with the task's current person selected — kept in the
  // list even if they have since been deactivated, so editing an old task
  // never silently reassigns it.
  function userOptionsHtml(list, { id, name } = {}) {
    let found = false;
    const opts = list.map(u => {
      const sel = (id && String(u.id) === String(id)) || (!id && name && sameName(u.name, name));
      if (sel) found = true;
      return `<option value="${esc(u.id)}"${sel ? ' selected' : ''}>${esc(u.name)}</option>`;
    }).join('');
    const keep = !found && name ? `<option value="__keep__" selected>${esc(name)}</option>` : '';
    return keep + opts;
  }

  /* ── + Delegate Task ─────────────────────────────────────────────── */
  function openDelegate({ users = [], onSaved, edit } = {}) {
    const list = pickableUsers(users);
    const v = (edit && edit.values) || {};
    const opt = (val, cur) => `<option value="${esc(val)}"${val === cur ? ' selected' : ''}>${esc(val)}</option>`;
    const userOpts = userOptionsHtml(list, { id: v.doerId, name: v.doerName });
    const { div, close } = openShell('tf-delegate-modal', edit ? 'Edit Delegated Task' : '+ Delegate Task', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="label">DOER (ASSIGN TO) *</label>
          <select id="tfd-doer" class="input"><option value="">Select Doer</option>${userOpts}</select>
        </div>
        <div>
          <label class="label">DUE DATE *</label>
          <input type="date" id="tfd-due" class="input" value="${esc(edit ? String(v.dueDate || '').split('T')[0] : Utils.todayISO())}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="label">PRIORITY</label>
          <select id="tfd-priority" class="input">${['Low', 'Medium', 'High'].map(p => opt(p, v.priority || 'Low')).join('')}</select>
        </div>
        <div>
          <label class="label">APPROVAL REQUIRED</label>
          <select id="tfd-approval" class="input">
            ${['No Approval', 'Approval Required'].map(a => opt(a, v.approval || 'No Approval')).join('')}
          </select>
        </div>
      </div>
      <div>
        <label class="label">DESCRIPTION *</label>
        <textarea id="tfd-desc" rows="3" class="input" style="resize:vertical;height:auto;" placeholder="Enter task description...">${esc(v.description || '')}</textarea>
      </div>
      <div>
        <label class="label">URL ${optional}</label>
        <input type="url" id="tfd-url" class="input" placeholder="https://docs.google.com/..." value="${esc(v.url || '')}" />
      </div>
      <div>
        <label class="label">REMARKS</label>
        <textarea id="tfd-remarks" rows="2" class="input" style="resize:vertical;height:auto;" placeholder="Any remarks...">${esc(v.remarks || '')}</textarea>
      </div>
      <p id="tfd-err" style="color:#dc2626;font-size:12px;display:none;margin:0;"></p>`,
      `<button type="button" data-tf-close class="btn-secondary">Close</button>
       <button type="button" id="tfd-save" class="btn-primary">${edit ? 'Save Changes' : 'Assign'}</button>`,
      edit ? '' : csvSection('tfd', '/api/samples/delegation', 'Format: doer_email, approver_email, due_date, priority, approval, description, remarks, client_name'));

    const q = (sel) => div.querySelector(sel);

    q('#tfd-save').addEventListener('click', async () => {
      const btn      = q('#tfd-save');
      const errEl    = q('#tfd-err');
      const doerId   = q('#tfd-doer').value;
      const keep     = doerId === '__keep__';
      const doerName = keep ? (v.doerName || '') : (list.find(u => String(u.id) === doerId)?.name || '');
      const dueDate  = q('#tfd-due').value;
      const desc     = q('#tfd-desc').value.trim();
      if (!doerId)  return showError(errEl, 'Please select a doer.');
      if (!dueDate) return showError(errEl, 'Due date is required.');
      if (!desc)    return showError(errEl, 'Description is required.');
      showError(errEl, '');
      if (edit) {
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await edit.onSubmit({
            // __keep__ = the original (now inactive) doer: leave the assignee alone.
            ...(keep ? {} : { doerId, doerName }),
            dueDate, description: desc,
            priority: q('#tfd-priority').value || 'Low',
            approval: q('#tfd-approval').value || 'No Approval',
            url: q('#tfd-url').value.trim(),
            remarks: q('#tfd-remarks').value.trim(),
          });
          close();
          if (onSaved) await onSaved();
        } catch (e) {
          showError(errEl, e.message || 'Failed to save.');
          btn.disabled = false; btn.textContent = 'Save Changes';
        }
        return;
      }
      btn.disabled = true; btn.textContent = 'Assigning…';
      try {
        await Utils.apiFetch('/api/delegations', {
          method: 'POST',
          body: JSON.stringify({
            description: desc, doerId, doerName,
            delegatedBy: window.currentUser?.id,
            dueDate,
            priority: q('#tfd-priority').value || 'Low',
            approval: q('#tfd-approval').value || 'No Approval',
            url: q('#tfd-url').value.trim(),
            remarks: q('#tfd-remarks').value.trim(),
          }),
        });
        close();
        Utils.showToast('Task delegated successfully!');
        if (onSaved) await onSaved();
      } catch (e) {
        showError(errEl, e.message || 'Failed to add task.');
        btn.disabled = false; btn.textContent = 'Assign';
      }
    });

    q('#tfd-csv-upload')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      const file = q('#tfd-csv-file').files?.[0];
      if (!file) { Utils.showToast('Please choose a CSV file first.', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Uploading…';
      let ok = 0, fail = 0;
      for (const obj of await readCsvRows(file)) {
        const email = (obj['doer_email'] || '').toLowerCase();
        const doer = email && users.find(u => (u.email || '').toLowerCase() === email);
        if (!doer) { fail++; continue; }
        try {
          await Utils.apiFetch('/api/delegations', {
            method: 'POST',
            body: JSON.stringify({
              description: obj['description'] || '',
              doerId: doer.id, doerName: doer.name,
              delegatedBy: window.currentUser?.id,
              dueDate: obj['due_date'] || Utils.todayISO(),
              priority: obj['priority'] || 'Low',
              approval: obj['approval'] === 'yes' ? 'Approval Required' : 'No Approval',
              client: obj['client_name'] || '',
              remarks: obj['remarks'] || '',
              url: '',
            }),
          });
          ok++;
        } catch { fail++; }
      }
      close();
      Utils.showToast(`${ok} tasks uploaded${fail ? `, ${fail} failed` : ''}`, fail ? 'warning' : 'success');
      if (onSaved) await onSaved();
    });
  }

  /* ── + Add Checklist Task ────────────────────────────────────────── */
  // Due Date matters: without it the server creates one bare, undated task
  // instead of running generateChecklistDates() to lay out the series.
  function openChecklist({ users = [], onSaved, edit } = {}) {
    const list = pickableUsers(users);
    const v = (edit && edit.values) || {};
    const series = (edit && edit.series) || 1;
    const userOpts = userOptionsHtml(list, { name: v.assignedTo });
    // Stored frequencies are lowercase keys ('quarterly'); an older row may
    // hold one this list doesn't know — keep it rather than snap to Daily.
    const freq = String(v.frequency || 'daily').trim().toLowerCase().replace(/\s+/g, '_');
    const known = CHECKLIST_FREQ_OPTIONS.some(([k]) => k === freq);
    const freqOpts = (known ? '' : `<option value="${esc(v.frequency)}" selected>${esc(v.frequency)}</option>`) + freqOptionsHtml(known ? freq : '');
    const title = edit ? (series > 1 ? `Edit Checklist Task (${series} occurrences)` : 'Edit Checklist Task') : '+ Add Checklist Task';
    const { div, close } = openShell('tf-checklist-modal', title, `
      <div>
        <label class="label">SELECT EMPLOYEE *</label>
        <select id="tfc-assigned" class="input"><option value="">Select Employee</option>${userOpts}</select>
      </div>
      <div>
        <label class="label">FREQUENCY</label>
        <select id="tfc-freq" class="input">${freqOpts}</select>
        ${edit ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">Changes the label only — dates already laid out stay as they are. To change the schedule, delete the task and add it again.</div>' : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="label">DUE DATE *</label>
          ${edit && series > 1
            ? `<input type="text" class="input" value="Each occurrence keeps its own date" disabled style="color:var(--text-muted);" />`
            : `<input type="date" id="tfc-start" class="input" value="${esc(edit ? String(v.startDate || '').split('T')[0] : Utils.todayISO())}" />`}
        </div>
        <div>
          <label class="label">END DATE ${optional}</label>
          <input type="date" id="tfc-end" class="input" value="${esc(String(v.endDate || '').split('T')[0])}" />
        </div>
      </div>
      <div>
        <label class="label">TASK NAME / DESCRIPTION *</label>
        <input type="text" id="tfc-task" class="input" placeholder="Enter task name..." value="${esc(v.task || '')}" />
      </div>
      <div>
        <label class="label">REMARKS</label>
        <input type="text" id="tfc-remarks" class="input" placeholder="Any remarks..." value="${esc(v.remarks || '')}" />
      </div>
      <p id="tfc-err" style="color:#dc2626;font-size:12px;display:none;margin:0;"></p>`,
      `<button type="button" data-tf-close class="btn-secondary">Close</button>
       <button type="button" id="tfc-save" class="btn-primary">${edit ? 'Save Changes' : 'Generate Tasks'}</button>`,
      edit ? '' : csvSection('tfc', '/api/samples/checklist-bulk', 'Format: user_email, frequency (daily/weekly/monthly/yearly/quarterly/alternative_week), start_date, description, remarks — tasks auto-generate!'));

    const q = (sel) => div.querySelector(sel);

    q('#tfc-save').addEventListener('click', async () => {
      const btn        = q('#tfc-save');
      const errEl      = q('#tfc-err');
      const assignedId = q('#tfc-assigned').value;
      const assignedTo = assignedId === '__keep__' ? (v.assignedTo || '') : (list.find(u => String(u.id) === assignedId)?.name || '');
      const task       = q('#tfc-task').value.trim();
      if (!assignedTo) return showError(errEl, 'Please select an employee.');
      if (!task)       return showError(errEl, 'Task name is required.');
      showError(errEl, '');
      if (edit) {
        const startEl = q('#tfc-start');
        if (startEl && !startEl.value) return showError(errEl, 'Due date is required.');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await edit.onSubmit({
            task, assignedTo,
            frequency: q('#tfc-freq').value || freq,
            ...(startEl ? { startDate: startEl.value } : {}),
            endDate: q('#tfc-end').value || '',
            remarks: q('#tfc-remarks').value.trim(),
          });
          close();
          if (onSaved) await onSaved();
        } catch (e) {
          showError(errEl, e.message || 'Failed to save.');
          btn.disabled = false; btn.textContent = 'Save Changes';
        }
        return;
      }
      btn.disabled = true; btn.textContent = 'Generating…';
      try {
        const result = await Utils.apiFetch('/api/masters', {
          method: 'POST',
          body: JSON.stringify({
            task, assignedTo,
            frequency: q('#tfc-freq').value || 'daily',
            startDate: q('#tfc-start').value || Utils.todayISO(),
            endDate: q('#tfc-end').value || null,
            remarks: q('#tfc-remarks').value.trim(),
          }),
        });
        close();
        Utils.showToast(result?.count > 1 ? `${result.count} checklist tasks generated!` : 'Checklist task added!');
        if (onSaved) await onSaved();
      } catch (e) {
        showError(errEl, e.message || 'Failed to generate tasks.');
        btn.disabled = false; btn.textContent = 'Generate Tasks';
      }
    });

    q('#tfc-csv-upload')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      const file = q('#tfc-csv-file').files?.[0];
      if (!file) { Utils.showToast('Please choose a CSV file first.', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Uploading…';
      const HEADER_ALIASES = {
        email: 'user_email', 'user email': 'user_email',
        task: 'description', 'task name': 'description', 'task name / description': 'description', 'task/description': 'description',
        'next due date': 'start_date', 'due date': 'start_date', 'start date': 'start_date',
      };
      const FREQUENCY_ALIASES = { y: 'yearly', m: 'monthly', q: 'quarterly', w: 'weekly', d: 'daily', aw: 'alternative_week' };
      const rows = await readCsvRows(file, HEADER_ALIASES);
      let ok = 0, fail = 0;
      const failures = [];
      for (let i = 0; i < rows.length; i++) {
        const obj = rows[i];
        const rowLabel = `Row ${i + 2} (${obj['user_email'] || 'no email'})`;
        const email = (obj['user_email'] || '').toLowerCase();
        const user = email && users.find(u => (u.email || '').toLowerCase() === email);
        if (!user) { fail++; failures.push(`${rowLabel}: email not found in Users list`); continue; }
        if (!obj['description']) { fail++; failures.push(`${rowLabel}: description/task is empty`); continue; }
        const freqRaw = (obj['frequency'] || 'daily').trim().toLowerCase();
        try {
          await Utils.apiFetch('/api/masters', {
            method: 'POST',
            body: JSON.stringify({
              task: obj['description'],
              assignedTo: user.name,
              frequency: FREQUENCY_ALIASES[freqRaw] || freqRaw,
              startDate: parseFlexibleDate(obj['start_date']),
              remarks: obj['remarks'] || '',
              department: obj['department'] || '',
            }),
          });
          ok++;
        } catch (e) { fail++; failures.push(`${rowLabel}: ${e.message || 'server error'}`); }
      }
      close();
      Utils.showToast(`${ok} checklist(s) created${fail ? `, ${fail} failed` : ''}`, fail ? 'warning' : 'success');
      if (failures.length) alert(`${failures.length} row(s) failed to upload:\n\n${failures.join('\n')}`);
      if (onSaved) await onSaved();
    });
  }

  return { openDelegate, openChecklist, CHECKLIST_FREQ_OPTIONS, freqOptionsHtml };
})();
