window.Pages = window.Pages || {};

window.Pages['help-ticket'] = (() => {
  let _tickets    = [];
  let _modalOpen  = false;
  let _form       = { subject: '', description: '', priority: 'Medium' };
  let _saving     = false;

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
    if (!_form.subject.trim()) { Utils.showToast('Subject required', 'error'); return; }
    _saving = true;
    renderModal();
    try {
      await Utils.apiFetch('/api/help-tickets', {
        method: 'POST',
        body: JSON.stringify(_form),
      });
      _modalOpen = false;
      _saving    = false;
      _form      = { subject: '', description: '', priority: 'Medium' };
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
    const html = `
      <div id="ht-modal" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="text-[15px] font-semibold text-slate-900">New Help Ticket</h2>
            <button id="ht-modal-close" class="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="px-6 py-5 space-y-3">
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Subject *</label>
              <input id="ht-subject" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" placeholder="Describe the issue briefly" value="${esc(_form.subject)}" />
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Description</label>
              <textarea id="ht-desc" rows="3" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 resize-none" placeholder="Provide more details...">${esc(_form.description)}</textarea>
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Priority</label>
              <select id="ht-priority" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-primary-500">
                ${['High','Medium','Low'].map(p => `<option value="${p}" ${_form.priority===p?'selected':''}>${p}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <button id="ht-cancel" class="btn-secondary">Cancel</button>
            <button id="ht-submit" class="btn-primary" ${_saving?'disabled':''}>${_saving?'Submitting…':'Submit Ticket'}</button>
          </div>
        </div>
      </div>`;
    if (ex) ex.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('ht-modal-close')?.addEventListener('click', () => { _modalOpen = false; renderModal(); });
    document.getElementById('ht-cancel')?.addEventListener('click', () => { _modalOpen = false; renderModal(); });
    document.getElementById('ht-subject')?.addEventListener('input', e => { _form.subject = e.target.value; });
    document.getElementById('ht-desc')?.addEventListener('input', e => { _form.description = e.target.value; });
    document.getElementById('ht-priority')?.addEventListener('change', e => { _form.priority = e.target.value; });
    document.getElementById('ht-submit')?.addEventListener('click', submitTicket);
  }

  function renderPage() {
    const el = document.querySelector('[data-page="help-ticket"]');
    if (!el) return;

    const admin = isAdmin();

    const rows = _tickets.map(t => {
      const ss  = STATUS_STYLE[t.status] || STATUS_STYLE.open;
      const ps  = PRI_STYLE[t.priority]  || PRI_STYLE.Medium;
      const actions = admin ? `
        <select class="ht-status-sel text-[11px] border border-slate-200 rounded-lg px-2 py-1 cursor-pointer" data-id="${esc(t.id)}">
          ${['open','in-progress','resolved'].map(s => `<option value="${s}" ${t.status===s?'selected':''}>${STATUS_STYLE[s]?.label||s}</option>`).join('')}
        </select>` : `<span style="font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;background:${ss.bg};color:${ss.color}">${ss.label}</span>`;
      return `<tr class="table-row">
        <td class="table-td font-medium text-slate-900">${esc(t.subject||'')}</td>
        <td class="table-td text-slate-500 text-[12px]">${esc(t.submitted_by||'')}</td>
        <td class="table-td"><span style="font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;background:${ps.bg};color:${ps.color}">${esc(t.priority||'Medium')}</span></td>
        <td class="table-td text-slate-500 text-[12px]">${fmt(t.created_at)}</td>
        <td class="table-td">${actions}</td>
      </tr>
      ${t.description ? `<tr><td colspan="5" class="px-4 pb-3 text-[12px] text-slate-500">${esc(t.description)}</td></tr>` : ''}`;
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
              <thead class="bg-slate-50/80">
                <tr>
                  <th class="table-th">Subject</th>
                  <th class="table-th">Submitted By</th>
                  <th class="table-th">Priority</th>
                  <th class="table-th">Date</th>
                  <th class="table-th">Status</th>
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
