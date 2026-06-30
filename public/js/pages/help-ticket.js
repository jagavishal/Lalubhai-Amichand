window.Pages = window.Pages || {};

window.Pages['help-ticket'] = (() => {
  let _tickets    = [];
  let _modalOpen  = false;
  let _form       = { name: '', subject: '', description: '', date: '', priority: 'Medium' };
  let _saving     = false;

  function todayISO() { const d = new Date(); return d.toISOString().slice(0,10); }

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

  const STATUS_STYLE = {
    open:        { bg: '#fee2e2', color: '#991b1b', label: 'Open' },
    'in-progress':{ bg: '#fef3c7', color: '#92400e', label: 'In Progress' },
    resolved:    { bg: '#d1fae5', color: '#065f46', label: 'Resolved' },
  };

  const PRI_STYLE = {
    High:   { bg: '#fef2f2', color: '#dc2626' },
    Medium: { bg: '#fefce8', color: '#ca8a04' },
    Low:    { bg: '#f0fdf4', color: '#16a34a' },
  };

  async function loadData() {
    try {
      const res = await fetch('/api/help-tickets');
      _tickets = res.ok ? await res.json() : [];
    } catch { _tickets = []; }
  }

  async function updateStatus(id, status) {
    try {
      await Utils.apiFetch('/api/help-tickets', {
        method: 'PATCH',
        body: JSON.stringify({ id, status }),
      });
      await loadData();
      renderPage();
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  async function submitTicket() {
    if (!_form.subject.trim()) { Utils.showToast('Issue required', 'error'); return; }
    if (!_form.date) { Utils.showToast('Date required', 'error'); return; }
    _saving = true;
    renderModal();
    try {
      await Utils.apiFetch('/api/help-tickets', {
        method: 'POST',
        body: JSON.stringify(_form),
      });
      _modalOpen = false;
      _saving    = false;
      _form      = { name: '', subject: '', description: '', date: '', priority: 'Medium' };
      await loadData();
      renderPage();
      Utils.showToast('Ticket submitted');
    } catch (e) {
      _saving = false;
      renderModal();
      Utils.showToast(e.message || 'Failed', 'error');
    }
  }

  function renderModal() {
    const ex = document.getElementById('ht-modal');
    if (!_modalOpen) { if (ex) ex.remove(); return; }
    const userName = window.currentUser?.name || '';
    if (!_form.name) _form.name = userName;
    if (!_form.date) _form.date = todayISO();
    const html = `
      <div id="ht-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:440px;overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:10px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;color:#0f172a;">Raise Help Ticket</div>
                <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">Submit your issue to the admin team</div>
              </div>
            </div>
            <button id="ht-modal-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Your Name</label>
              <input id="ht-name" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;" value="${esc(_form.name)}" placeholder="Your name" />
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Issue <span style="color:#ef4444">*</span></label>
              <textarea id="ht-subject" rows="3" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;resize:none;box-sizing:border-box;" placeholder="Describe your issue clearly...">${esc(_form.subject)}</textarea>
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Date <span style="color:#ef4444">*</span></label>
              <input id="ht-date" type="date" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;" value="${esc(_form.date)}" />
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Priority</label>
              <select id="ht-priority" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;">
                ${['High','Medium','Low'].map(p => `<option value="${p}" ${_form.priority===p?'selected':''}>${p}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="padding:16px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="ht-cancel" class="btn-secondary">Cancel</button>
            <button id="ht-submit" class="btn-primary" ${_saving?'disabled':''}>${_saving?'Submitting…':'Submit Ticket'}</button>
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
    document.getElementById('ht-submit')?.addEventListener('click', submitTicket);
    /* focus on issue field */
    setTimeout(() => document.getElementById('ht-subject')?.focus(), 50);
  }

  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const admin = isAdmin();

    const rows = _tickets.map(t => {
      const ss  = STATUS_STYLE[t.status] || STATUS_STYLE.open;
      const ps  = PRI_STYLE[t.priority]  || PRI_STYLE.Medium;
      const displayName = t.name || t.submitted_by || '—';
      const displayDate = t.date ? fmt(t.date) : fmt(t.created_at);
      const actions = admin ? `
        <select class="ht-status-sel" data-id="${esc(t.id)}" style="font-size:11px;border:1.5px solid #e2e8f0;border-radius:7px;padding:3px 8px;cursor:pointer;background:#fff;">
          ${['open','in-progress','resolved'].map(s => `<option value="${s}" ${t.status===s?'selected':''}>${STATUS_STYLE[s]?.label||s}</option>`).join('')}
        </select>` : `<span style="font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;background:${ss.bg};color:${ss.color}">${ss.label}</span>`;
      return `<tr style="transition:background .1s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td style="padding:11px 14px;font-size:13px;font-weight:600;color:#0f172a;">${esc(displayName)}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;max-width:260px;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(t.subject||'')}">${esc(t.subject||'—')}</div></td>
        <td style="padding:11px 14px;font-size:12px;color:#64748b;white-space:nowrap;">${displayDate}</td>
        <td style="padding:11px 14px;"><span style="font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;background:${ps.bg};color:${ps.color}">${esc(t.priority||'Medium')}</span></td>
        <td style="padding:11px 14px;">${actions}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold text-slate-900">Help Tickets</h1>
            <p class="text-[12px] text-slate-500 mt-0.5">Submit issues or requests to the admin team</p>
          </div>
          <button id="ht-new-btn" class="btn-primary flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            New Ticket
          </button>
        </div>
        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;">Name</th>
                  <th style="padding:10px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;">Issue</th>
                  <th style="padding:10px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;">Date</th>
                  <th style="padding:10px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;">Priority</th>
                  <th style="padding:10px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;">Status</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="5" class="table-td text-center text-slate-400 py-10">No tickets yet</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    document.getElementById('ht-new-btn')?.addEventListener('click', () => { _modalOpen = true; renderModal(); });
    el.querySelectorAll('.ht-status-sel').forEach(sel => {
      sel.addEventListener('change', () => updateStatus(sel.dataset.id, sel.value));
    });
  }

  return {
    async render() {
      await loadData();
      renderPage();
    },
    async refresh() {
      await loadData();
      renderPage();
    },
  };
})();
