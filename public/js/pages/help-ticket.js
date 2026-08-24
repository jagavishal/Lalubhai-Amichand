window.Pages = window.Pages || {};

window.Pages['help-ticket'] = (() => {
  let _tickets   = [];
  let _users     = [];
  // The expense/leave authority matrices, as served by /api/approval-authority.
  // The Category dropdown is built from them, so an admin adding a row on the
  // authority screen adds a category here without a code change.
  let _authority = { expense: [], leave: [] };
  let _modalOpen = false;
  let _form      = { name: '', filedBy: '', subject: '', description: '', date: '', priority: 'Medium', category: '', amount: '' };
  let _saving    = false;
  // Which list is on screen. They share a table, a status flow and a transfer,
  // but not a queue: an issue for the admin team and a request for money are
  // read by different people looking for different things.
  let _tab       = 'ticket';   // 'ticket' | 'payment'

  /* Rows raised before the split carry no kind. A category was only ever set by
     the payment form, so it is the honest fallback for those. */
  const kindOf = (t) => t.kind || (t.category ? 'payment' : 'ticket');

  const isAdmin = () => {
    const r = window.currentUser?.roles || [];
    return (Array.isArray(r) ? r : String(r).split(',')).some(x => x.trim() === 'Admin' || x.trim() === 'HOD');
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  const STATUS_STYLE = {
    open:          { bg: '#fef2f2', color: '#991b1b', label: 'Open' },
    'in-progress': { bg: '#fef3c7', color: '#92400e', label: 'In Progress' },
    resolved:      { bg: '#d1fae5', color: '#065f46', label: 'Resolved' },
  };

  const PRI_STYLE = {
    High:   { bg: '#fef2f2', color: '#dc2626' },
    Medium: { bg: '#fefce8', color: '#ca8a04' },
    Low:    { bg: '#f0fdf4', color: '#16a34a' },
  };

  /* Mirrors toAmount() on the server, and for the same reason: Number('') is 0,
     so an untouched amount box would read as a genuine ₹0 and preview a route
     nobody asked for. */
  function toAmount(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function money(v) {
    const n = toAmount(v);
    return n === null ? '' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  const catRow = (category) => (_authority.expense || [])
    .find(r => String(r.category || '').toLowerCase() === String(category || '').trim().toLowerCase());

  // A category with a threshold cannot be routed without a figure — the server
  // refuses one without it, so the form asks for it rather than letting the
  // submit fail.
  const needsAmount = (category) => !!(catRow(category) && Number(catRow(category).inquiryBelow));

  /* Who this will go to, shown under the form so nobody is surprised by where
     their ticket landed. Display only — the server routes it again on write and
     that result is the one stored. */
  function routePreview(category, amount) {
    const row = catRow(category);
    if (!row) return null;
    const below = Number(row.inquiryBelow) || 0;
    if (!below) return { owner: row.owner || '', kind: 'approval', threshold: 0 };
    const amt = toAmount(amount);
    if (amt === null) return null;
    return amt >= below
      ? { owner: row.aboveOwner || '', kind: 'approval', threshold: below }
      : { owner: row.owner || '',      kind: 'inquiry',  threshold: below };
  }

  async function loadData() {
    try {
      const [tRes, uRes, aRes] = await Promise.all([
        fetch('/api/help-tickets'),
        fetch('/api/users'),
        fetch('/api/approval-authority'),
      ]);
      _tickets = tRes.ok ? await tRes.json() : [];
      _users   = uRes.ok ? await uRes.json() : [];
      // Categories are optional furniture — a failure here must still leave a
      // usable ticket form, just without the dropdown.
      _authority = aRes.ok ? await aRes.json() : { expense: [], leave: [] };
    } catch { _tickets = []; _users = []; _authority = { expense: [], leave: [] }; }
  }

  async function updateStatus(id, status) {
    try {
      await Utils.apiFetch('/api/help-tickets', { method: 'PATCH', body: JSON.stringify({ id, status }) });
      const t = _tickets.find(x => x.id === id);
      if (t) t.status = status;
      renderPage();
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  async function reopenTicket(id) {
    if (!await Utils.showConfirm('This will reopen the ticket and set its status back to Open.', { title: 'Reopen Ticket', confirmText: 'Reopen' })) return;
    await updateStatus(id, 'open');
    Utils.showToast('Ticket reopened');
  }

  async function transferTicket(id, toName) {
    try {
      await Utils.apiFetch('/api/help-tickets', { method: 'PATCH', body: JSON.stringify({ id, transferred_to: toName }) });
      const t = _tickets.find(x => x.id === id);
      if (t) t.transferred_to = toName;
      renderPage();
      Utils.showToast('Ticket transferred to ' + toName);
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  async function submitTicket() {
    if (!_form.subject.trim()) { Utils.showToast('Issue required', 'error'); return; }
    if (!_form.date)           { Utils.showToast('Date required', 'error'); return; }
    if (_tab === 'payment' && !String(_form.category).trim()) {
      Utils.showToast('Pick a category — it decides who approves this', 'error'); return;
    }
    if (needsAmount(_form.category) && toAmount(_form.amount) === null) {
      Utils.showToast(`A valid amount is required for ${_form.category} — it decides who approves it`, 'error');
      return;
    }
    _saving = true; renderModal();
    try {
      const r = await Utils.apiFetch('/api/help-tickets', {
        method: 'POST', body: JSON.stringify({ ..._form, kind: _tab }),
      });
      _modalOpen = false; _saving = false;
      _form = { name: '', filedBy: '', subject: '', description: '', date: '', priority: 'Medium', category: '', amount: '' };
      renderModal();
      await loadData(); renderPage();
      Utils.showToast(
        r?.routedTo
          ? `Sent to ${r.routedTo}${r.routing === 'inquiry' ? ' as an inquiry' : ' for approval'}`
          : (_tab === 'payment' ? 'Payment request submitted' : 'Ticket submitted'),
      );
    } catch (e) {
      _saving = false; renderModal();
      Utils.showToast(e.message || 'Failed', 'error');
    }
  }

  /* ── Transfer modal ─────────────────────────────────────────────── */
  function openTransferModal(ticketId) {
    const ex = document.getElementById('ht-transfer-modal');
    if (ex) ex.remove();
    const userOpts = _users
      .filter(u => u.active !== false)
      .sort((a, b) => (a.name||'').localeCompare(b.name||''))
      .map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`)
      .join('');

    const html = `
      <div id="ht-transfer-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:380px;overflow:hidden;" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:10px;background:#eff6ff;color:#3b82f6;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;color:#0f172a;">Transfer Ticket</div>
                <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">Assign this ticket to another user</div>
              </div>
            </div>
            <button id="ht-tr-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;">
            <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Transfer To <span style="color:#ef4444">*</span></label>
            <select id="ht-tr-user" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;background:#fff;box-sizing:border-box;">
              <option value="">— Select user —</option>
              ${userOpts}
            </select>
          </div>
          <div style="padding:16px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="ht-tr-cancel" class="btn-secondary">Cancel</button>
            <button id="ht-tr-confirm" class="btn-primary">Transfer</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const close = () => document.getElementById('ht-transfer-modal')?.remove();
    document.getElementById('ht-transfer-modal').addEventListener('click', close);
    document.getElementById('ht-tr-close').addEventListener('click', close);
    document.getElementById('ht-tr-cancel').addEventListener('click', close);
    document.getElementById('ht-tr-confirm').addEventListener('click', async () => {
      const toName = document.getElementById('ht-tr-user')?.value;
      if (!toName) { Utils.showToast('Please select a user', 'error'); return; }
      close();
      await transferTicket(ticketId, toName);
    });
  }

  /* The line under the Category/Amount row that says where this is going. Silent
     for a general ticket, and for a tiered category with no amount yet — there
     is genuinely nothing to say until the figure decides it. */
  function routeHintHtml() {
    if (!_form.category) return '';
    const row = catRow(_form.category);
    // A category the matrix no longer has — it was removed while this form was
    // open. Nothing truthful to say about where it goes, so say nothing.
    if (!row) return '';
    const r = routePreview(_form.category, _form.amount);
    if (!r) {
      return `<div style="font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 11px;">
        Enter the amount — under ${money(row?.inquiryBelow)} this is an inquiry to ${esc(row?.owner||'—')}, at ${money(row?.inquiryBelow)} and above it needs ${esc(row?.aboveOwner||'management')} approval.
      </div>`;
    }
    const inq = r.kind === 'inquiry';
    return `<div style="font-size:11.5px;color:${inq?'#0f766e':'#1d4ed8'};background:${inq?'#f0fdfa':'#eff6ff'};border:1px solid ${inq?'#99f6e4':'#bfdbfe'};border-radius:8px;padding:8px 11px;">
      ${inq ? 'Inquiry mail to' : 'Goes for approval to'} <b>${esc(r.owner || '—')}</b>${inq ? ' — no approval needed' : ''}.
    </div>`;
  }

  /* ── New Ticket modal ───────────────────────────────────────────── */
  function renderModal() {
    const ex = document.getElementById('ht-modal');
    if (!_modalOpen) { if (ex) ex.remove(); return; }
    const userName = window.currentUser?.name || '';
    if (!_form.name)    _form.name    = userName;
    if (!_form.filedBy) _form.filedBy = userName;
    if (!_form.date)    _form.date    = todayISO();
    const html = `
      <div id="ht-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:440px;overflow:hidden;" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:10px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;color:#0f172a;">${_tab === 'payment' ? 'Raise Payment Request' : 'Raise Help Ticket'}</div>
                <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">${_tab === 'payment' ? 'Goes to whoever holds that approval authority' : 'Submit your issue to the admin team'}</div>
              </div>
            </div>
            <button id="ht-modal-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Ticket For</label>
                <select id="ht-name" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;">
                  ${_users.filter(u=>u.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(u=>`<option value="${esc(u.name||u.email)}" ${(_form.name||window.currentUser?.name)===u.name?'selected':''}>${esc(u.name||u.email)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Filed By</label>
                <input id="ht-filed-by" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#64748b;outline:none;box-sizing:border-box;background:#f8fafc;" value="${esc(_form.filedBy)}" placeholder="Raised by" readonly />
              </div>
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Issue <span style="color:#ef4444">*</span></label>
              <textarea id="ht-subject" rows="3" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;resize:none;box-sizing:border-box;font-family:inherit;" placeholder="Describe your issue clearly...">${esc(_form.subject)}</textarea>
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Date <span style="color:#ef4444">*</span></label>
              <input id="ht-date" type="date" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;" value="${esc(_form.date)}" />
            </div>
            ${_tab !== 'payment' ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Category <span style="color:#ef4444">*</span></label>
                <select id="ht-category" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;">
                  <option value="">— Select —</option>
                  ${(_authority.expense||[]).map(r => `<option value="${esc(r.category)}" ${_form.category===r.category?'selected':''}>${esc(r.category)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Amount (₹)${needsAmount(_form.category)?' <span style="color:#ef4444">*</span>':''}</label>
                <input id="ht-amount" type="number" min="0" step="1" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;" value="${esc(_form.amount)}" placeholder="${needsAmount(_form.category)?'Required':'Optional'}" />
              </div>
            </div>
            ${routeHintHtml()}`}
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Priority</label>
              <select id="ht-priority" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;">
                ${['High','Medium','Low'].map(p => `<option value="${p}" ${_form.priority===p?'selected':''}>${p}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="padding:16px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="ht-cancel" class="btn-secondary">Cancel</button>
            <button id="ht-submit" class="btn-primary" ${_saving?'disabled':''}>${_saving?'Submitting…':(_tab === 'payment' ? 'Submit Request' : 'Submit Ticket')}</button>
          </div>
        </div>
      </div>`;
    if (ex) ex.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('ht-modal-close')?.addEventListener('click', () => { _modalOpen = false; renderModal(); });
    document.getElementById('ht-cancel')?.addEventListener('click',      () => { _modalOpen = false; renderModal(); });
    document.getElementById('ht-name')?.addEventListener('input',     e => { _form.name     = e.target.value; });
    document.getElementById('ht-subject')?.addEventListener('input',  e => { _form.subject  = e.target.value; });
    document.getElementById('ht-date')?.addEventListener('change',    e => { _form.date     = e.target.value; });
    document.getElementById('ht-priority')?.addEventListener('change',e => { _form.priority = e.target.value; });
    // Both re-render: the hint under them, and whether Amount is starred, are
    // both answers to what these two now hold.
    document.getElementById('ht-category')?.addEventListener('change', e => { _form.category = e.target.value; renderModal(); });
    document.getElementById('ht-amount')?.addEventListener('change',   e => { _form.amount   = e.target.value; renderModal(); });
    document.getElementById('ht-submit')?.addEventListener('click', submitTicket);
    // Only when the modal is first opened. It re-renders on every category and
    // amount change now, and pulling the caret back into Issue each time would
    // make the form unusable.
    if (!ex) setTimeout(() => document.getElementById('ht-subject')?.focus(), 50);
  }

  /* ── Approval Authority editor (admin) ──────────────────────────────
     The two matrices behind every routing decision, editable in one place so a
     staffing change is an edit here and never a deploy. Rows are read out of
     the DOM into the draft before every re-render, so adding or removing one
     does not throw away what has been typed into the others. */
  let _authDraft = null;

  const AU_INPUT = 'width:100%;padding:7px 9px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12.5px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;';
  const AU_TH    = 'font-size:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:#94a3b8;text-align:left;padding:0 0 4px;';

  function _readAuthDraft() {
    const box = document.getElementById('ht-auth-body');
    if (!box) return;
    _authDraft.expense = [...box.querySelectorAll('[data-exp-row]')].map(tr => ({
      category:     tr.querySelector('[data-f="category"]').value,
      owner:        tr.querySelector('[data-f="owner"]').value,
      inquiryBelow: tr.querySelector('[data-f="inquiryBelow"]').value,
      aboveOwner:   tr.querySelector('[data-f="aboveOwner"]').value,
    }));
    _authDraft.leave = [...box.querySelectorAll('[data-lv-row]')].map(tr => ({
      department:         tr.querySelector('[data-f="department"]').value,
      withinTeamApprover: tr.querySelector('[data-f="withinTeamApprover"]').value,
      escalateFromDays:   tr.querySelector('[data-f="escalateFromDays"]').value,
      escalateTo:         tr.querySelector('[data-f="escalateTo"]').value,
    }));
  }

  function _authBodyHtml() {
    const names = _users.filter(u => u.active !== false)
      .map(u => `<option value="${esc(u.name || '')}"></option>`).join('');
    const cell = (f, v, extra = '') => `<td style="padding:3px 4px;"><input data-f="${f}" style="${AU_INPUT}" value="${esc(v ?? '')}" ${extra}/></td>`;
    const kill = (kind, i) => `<td style="padding:3px 0 3px 4px;width:26px;"><button data-kill="${kind}" data-i="${i}" title="Remove" style="width:24px;height:24px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;cursor:pointer;line-height:1;font-size:13px;">×</button></td>`;

    return `
      <datalist id="ht-auth-names">${names}</datalist>

      <div style="font-size:12px;font-weight:700;color:#0f172a;margin:0 0 2px;">Expense &amp; work authority</div>
      <div style="font-size:11.5px;color:#94a3b8;margin-bottom:8px;">Who a help ticket in each category goes to. Leave the threshold blank for a category with one owner; set it and the ticket becomes an inquiry to the owner below that amount, and an approval by the second name at or above it.</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="${AU_TH}">Category</th><th style="${AU_TH}">Owner</th>
          <th style="${AU_TH}">Threshold ₹</th><th style="${AU_TH}">At / above goes to</th><th></th>
        </tr></thead>
        <tbody>${(_authDraft.expense || []).map((r, i) => `<tr data-exp-row>
          ${cell('category', r.category)}
          ${cell('owner', r.owner, 'list="ht-auth-names"')}
          ${cell('inquiryBelow', Number(r.inquiryBelow) ? r.inquiryBelow : '', 'type="number" min="0" step="1" placeholder="—"')}
          ${cell('aboveOwner', r.aboveOwner, 'list="ht-auth-names" placeholder="—"')}
          ${kill('exp', i)}
        </tr>`).join('') || '<tr><td colspan="5" style="padding:10px 4px;font-size:12px;color:#94a3b8;">No categories — every ticket stays general.</td></tr>'}</tbody>
      </table>
      <button data-add="exp" style="margin-top:6px;padding:5px 11px;border-radius:7px;border:1px dashed #cbd5e1;background:#f8fafc;color:#475569;font-size:11.5px;font-weight:600;cursor:pointer;">+ Add category</button>

      <div style="height:1px;background:#f1f5f9;margin:18px 0 14px;"></div>

      <div style="font-size:12px;font-weight:700;color:#0f172a;margin:0 0 2px;">Leave escalation by department</div>
      <div style="font-size:11.5px;color:#94a3b8;margin-bottom:8px;">A request of this many days or more must go to the named person, whatever approver the applicant has set. Shorter requests keep their usual approver, and fall back to the within-team name only when none is set. Department is matched loosely — “Accounts” catches “Accounts Dept.”</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="${AU_TH}">Department</th><th style="${AU_TH}">Within team</th>
          <th style="${AU_TH}">Escalate from (days)</th><th style="${AU_TH}">Escalate to</th><th></th>
        </tr></thead>
        <tbody>${(_authDraft.leave || []).map((r, i) => `<tr data-lv-row>
          ${cell('department', r.department)}
          ${cell('withinTeamApprover', r.withinTeamApprover, 'list="ht-auth-names"')}
          ${cell('escalateFromDays', Number(r.escalateFromDays) ? r.escalateFromDays : '', 'type="number" min="0" step="1" placeholder="—"')}
          ${cell('escalateTo', r.escalateTo, 'list="ht-auth-names"')}
          ${kill('lv', i)}
        </tr>`).join('') || '<tr><td colspan="5" style="padding:10px 4px;font-size:12px;color:#94a3b8;">No department rules — every request uses its usual approver.</td></tr>'}</tbody>
      </table>
      <button data-add="lv" style="margin-top:6px;padding:5px 11px;border-radius:7px;border:1px dashed #cbd5e1;background:#f8fafc;color:#475569;font-size:11.5px;font-weight:600;cursor:pointer;">+ Add department</button>`;
  }

  function _renderAuthBody() {
    const box = document.getElementById('ht-auth-body');
    if (!box) return;
    box.innerHTML = _authBodyHtml();
    box.querySelectorAll('[data-kill]').forEach(btn => btn.addEventListener('click', () => {
      _readAuthDraft();
      const list = btn.dataset.kill === 'exp' ? _authDraft.expense : _authDraft.leave;
      list.splice(Number(btn.dataset.i), 1);
      _renderAuthBody();
    }));
    box.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
      _readAuthDraft();
      if (btn.dataset.add === 'exp') _authDraft.expense.push({ category: '', owner: '', inquiryBelow: '', aboveOwner: '' });
      else _authDraft.leave.push({ department: '', withinTeamApprover: '', escalateFromDays: '', escalateTo: '' });
      _renderAuthBody();
    }));
  }

  async function saveAuthority() {
    _readAuthDraft();
    const expense = _authDraft.expense.filter(r => String(r.category).trim());
    const leave   = _authDraft.leave.filter(r => String(r.department).trim());
    // Caught here as well as on the server, so the person editing sees which
    // category they duplicated rather than a bare error toast.
    const seen = new Set();
    for (const r of expense) {
      const k = String(r.category).trim().toLowerCase();
      if (seen.has(k)) { Utils.showToast(`Duplicate category: ${r.category}`, 'error'); return; }
      seen.add(k);
    }
    try {
      await Utils.apiFetch('/api/approval-authority', { method: 'PUT', body: JSON.stringify({ expense, leave }) });
      document.getElementById('ht-auth-modal')?.remove();
      await loadData(); renderPage();
      Utils.showToast('Approval authority saved');
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  function openAuthorityModal() {
    document.getElementById('ht-auth-modal')?.remove();
    // A copy, so cancelling leaves the loaded matrices untouched.
    _authDraft = JSON.parse(JSON.stringify({
      expense: _authority.expense || [], leave: _authority.leave || [],
    }));
    document.body.insertAdjacentHTML('beforeend', `
      <div id="ht-auth-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:720px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;">
            <div>
              <div style="font-size:15px;font-weight:700;color:#0f172a;">Approval Authority</div>
              <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">Who signs off what. Changes apply to tickets and leave raised from now on.</div>
            </div>
            <button id="ht-auth-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;font-size:15px;line-height:1;">×</button>
          </div>
          <div id="ht-auth-body" style="padding:18px 22px;overflow-y:auto;"></div>
          <div style="padding:14px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="ht-auth-cancel" class="btn-secondary">Cancel</button>
            <button id="ht-auth-save" class="btn-primary">Save</button>
          </div>
        </div>
      </div>`);
    const close = () => document.getElementById('ht-auth-modal')?.remove();
    document.getElementById('ht-auth-modal').addEventListener('click', close);
    document.getElementById('ht-auth-close').addEventListener('click', close);
    document.getElementById('ht-auth-cancel').addEventListener('click', close);
    document.getElementById('ht-auth-save').addEventListener('click', saveAuthority);
    _renderAuthBody();
  }

  /* ── Page render ────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const admin = isAdmin();

    const pay = _tab === 'payment';
    const visible = _tickets.filter(t => kindOf(t) === _tab);

    const rows = visible.map(t => {
      const ss  = STATUS_STYLE[t.status] || STATUS_STYLE.open;
      const ps  = PRI_STYLE[t.priority]  || PRI_STYLE.Medium;
      // Two different people: who the ticket is about, and who typed it in.
      // They are usually the same and the row says so once; when an admin
      // raises one on somebody's behalf, both names have to be readable.
      const forName   = t.name || t.submitted_by || '—';
      const filedBy   = t.submitted_by || '';
      const displayDate = t.ticket_date ? fmt(t.ticket_date) : fmt(t.created_at);
      const transferredBadge = t.transferred_to
        ? `<div style="font-size:10px;color:#3b82f6;margin-top:2px;">→ ${esc(t.transferred_to)}${t.routing === 'inquiry' ? ' (inquiry)' : ''}</div>` : '';
      const categoryCell = t.category
        ? `<div style="font-size:11.5px;font-weight:600;color:#334155;">${esc(t.category)}</div>${
            money(t.amount) ? `<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:2px;">${money(t.amount)}</div>` : ''}`
        : '<span style="font-size:11.5px;color:#cbd5e1;">—</span>';

      const statusCell = (admin && t.status !== 'resolved')
        ? `<select class="ht-status-sel" data-id="${esc(t.id)}" style="font-size:11px;font-weight:600;border:1.5px solid ${ss.color}33;border-radius:7px;padding:3px 8px;cursor:pointer;background:${ss.bg};color:${ss.color};">
            ${['open','in-progress','resolved'].map(s => `<option value="${s}" ${t.status===s?'selected':''}>${STATUS_STYLE[s]?.label||s}</option>`).join('')}
           </select>`
        : `<span style="font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;background:${ss.bg};color:${ss.color}">${ss.label}</span>`;

      const transferBtn = admin
        ? `<button class="ht-transfer-btn" data-id="${esc(t.id)}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;background:#eff6ff;color:#3b82f6;border:1px solid #bfdbfe;cursor:pointer;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            Transfer
           </button>` : '';

      const reopenBtn = (admin && t.status === 'resolved')
        ? `<button class="ht-reopen-btn" data-id="${esc(t.id)}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;cursor:pointer;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/></svg>
            Reopen
           </button>` : '';

      const rowBg = t.status === 'resolved' ? '#f0fdf4' : '';

      return `<tr style="transition:background .1s;background:${rowBg};" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='${rowBg}'">
        <td style="padding:11px 14px;font-size:13px;font-weight:600;color:#0f172a;vertical-align:top;">
          ${esc(forName)}${transferredBadge}
        </td>
        <td style="padding:11px 14px;font-size:12.5px;color:#64748b;vertical-align:top;">${esc(filedBy || '—')}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;vertical-align:top;min-width:280px;">
          <div style="white-space:pre-wrap;overflow-wrap:anywhere;">${esc(t.subject||'—')}</div>
          ${t.description ? `<div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#64748b;margin-top:3px;">${esc(t.description)}</div>` : ''}
        </td>
        ${pay ? `<td style="padding:11px 14px;white-space:nowrap;vertical-align:top;">${categoryCell}</td>` : ''}
        <td style="padding:11px 14px;font-size:12px;color:#64748b;white-space:nowrap;">${displayDate}</td>
        <td style="padding:11px 14px;">
          <span style="font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;background:${ps.bg};color:${ps.color}">${esc(t.priority||'Medium')}</span>
        </td>
        <td style="padding:11px 14px;">${statusCell}</td>
        ${admin ? `<td style="padding:11px 14px;"><div style="display:flex;align-items:center;gap:6px;">${transferBtn}${reopenBtn}</div></td>` : ''}
      </tr>`;
    }).join('');

    const thStyle = 'padding:10px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;background:#f8fafc;';

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">${pay ? 'Payment Requests' : 'Help Tickets'}</h1>
            <p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">${pay
              ? 'Spend that needs an approval, routed to whoever holds that authority'
              : 'Submit issues or requests to the admin team'}</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
          ${admin ? `<button id="ht-authority-btn" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;cursor:pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
            Approval Authority
          </button>` : ''}
          <button id="ht-new-btn" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;background:linear-gradient(135deg,#0150AA,#013D82);color:#fff;border:none;cursor:pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            ${pay ? 'New Payment Request' : 'New Ticket'}
          </button>
          </div>
        </div>
        <div style="display:flex;gap:4px;border-bottom:1px solid #e2e8f0;">
          ${[['ticket', 'Help Tickets'], ['payment', 'Payment Requests']].map(([k, label]) => {
            const on = _tab === k;
            const n = _tickets.filter(t => kindOf(t) === k).length;
            return `<button class="ht-tab" data-tab="${k}" style="position:relative;padding:9px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:${on?700:600};color:${on?'#0150AA':'#64748b'};border-bottom:2.5px solid ${on?'#0150AA':'transparent'};margin-bottom:-1px;">
              ${label}<span style="margin-left:6px;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:${on?'#e0ecfb':'#f1f5f9'};color:${on?'#0150AA':'#94a3b8'};">${n}</span>
            </button>`;
          }).join('')}
        </div>
        <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="${thStyle}">Name</th>
                  <th style="${thStyle}">Filed By</th>
                  <th style="${thStyle}">${pay ? 'Request' : 'Issue'}</th>
                  ${pay ? `<th style="${thStyle}">Category / Amount</th>` : ''}
                  <th style="${thStyle}">Date</th>
                  <th style="${thStyle}">Priority</th>
                  <th style="${thStyle}">Status</th>
                  ${admin ? '<th style="' + thStyle + '">Action</th>' : ''}
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="' + (6 + (pay?1:0) + (admin?1:0)) + '" style="padding:48px;text-align:center;color:#94a3b8;">'
                + (pay ? 'No payment requests yet' : 'No tickets yet') + '</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    document.getElementById('ht-new-btn')?.addEventListener('click', () => { _modalOpen = true; renderModal(); });
    document.getElementById('ht-authority-btn')?.addEventListener('click', openAuthorityModal);
    el.querySelectorAll('.ht-tab').forEach(btn => btn.addEventListener('click', () => {
      if (_tab === btn.dataset.tab) return;
      _tab = btn.dataset.tab;
      // A category picked on the payment form means nothing on the other tab.
      _form.category = ''; _form.amount = '';
      renderPage();
    }));
    el.querySelectorAll('.ht-status-sel').forEach(sel => {
      sel.addEventListener('change', () => updateStatus(sel.dataset.id, sel.value));
    });
    el.querySelectorAll('.ht-transfer-btn').forEach(btn => {
      btn.addEventListener('click', () => openTransferModal(btn.dataset.id));
    });
    el.querySelectorAll('.ht-reopen-btn').forEach(btn => {
      btn.addEventListener('click', () => reopenTicket(btn.dataset.id));
    });
  }

  return {
    async render() { await loadData(); renderPage(); },
    async refresh() { await loadData(); renderPage(); },
  };
})();
