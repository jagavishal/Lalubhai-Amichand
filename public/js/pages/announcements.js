window.Pages = window.Pages || {};

window.Pages.announcements = (() => {
  let _items     = [];
  let _modalOpen = false;
  let _form      = { title: '', message: '' };
  let _saving    = false;

  const isAdmin = () => {
    const r = window.currentUser?.roles || [];
    return (Array.isArray(r) ? r : String(r).split(',')).some(x => x.trim() === 'Admin' || x.trim() === 'HOD');
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmt(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function loadData() {
    try {
      const res = await fetch('/api/announcements');
      _items = res.ok ? await res.json() : [];
    } catch { _items = []; }
  }

  async function postAnnouncement() {
    if (!_form.title.trim()) { Utils.showToast('Title required', 'error'); return; }
    _saving = true;
    renderModal();
    try {
      await Utils.apiFetch('/api/announcements', {
        method: 'POST',
        body: JSON.stringify(_form),
      });
      _modalOpen = false;
      _saving    = false;
      _form      = { title: '', message: '' };
      await loadData();
      renderPage();
      Utils.showToast('Announcement posted');
    } catch (e) {
      _saving = false;
      renderModal();
      Utils.showToast(e.message || 'Failed', 'error');
    }
  }

  async function deleteAnnouncement(id) {
    if (!await Utils.showConfirm('Delete this announcement?', { danger: true })) return;
    try {
      await fetch(`/api/announcements?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadData();
      renderPage();
      Utils.showToast('Deleted');
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  function renderModal() {
    const ex = document.getElementById('ann-modal');
    if (!_modalOpen) { if (ex) ex.remove(); return; }
    const html = `
      <div id="ann-modal" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="text-[15px] font-semibold text-slate-900">Post Announcement</h2>
            <button id="ann-close" class="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="px-6 py-5 space-y-3">
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Title *</label>
              <input id="ann-title" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" placeholder="Announcement title" value="${esc(_form.title)}" />
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Message</label>
              <textarea id="ann-message" rows="4" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 resize-none" placeholder="Write the announcement...">${esc(_form.message)}</textarea>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <button id="ann-cancel" class="btn-secondary">Cancel</button>
            <button id="ann-post" class="btn-primary" ${_saving?'disabled':''}>${_saving?'Posting…':'Post Announcement'}</button>
          </div>
        </div>
      </div>`;
    if (ex) ex.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('ann-close')?.addEventListener('click', () => { _modalOpen = false; renderModal(); });
    document.getElementById('ann-cancel')?.addEventListener('click', () => { _modalOpen = false; renderModal(); });
    document.getElementById('ann-title')?.addEventListener('input', e => { _form.title = e.target.value; });
    document.getElementById('ann-message')?.addEventListener('input', e => { _form.message = e.target.value; });
    document.getElementById('ann-post')?.addEventListener('click', postAnnouncement);
  }

  function renderPage() {
    const el = document.querySelector('[data-page="announcements"]');
    if (!el) return;
    const admin = isAdmin();

    const cards = _items.length
      ? _items.map(a => `
          <div class="card p-5">
            <div class="flex items-start justify-between gap-3">
              <div class="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 grid place-items-center shrink-0" style="margin-top:1px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-slate-900 text-[14px]">${esc(a.title)}</div>
                ${a.message ? `<p class="text-[13px] text-slate-600 mt-1 whitespace-pre-wrap">${esc(a.message)}</p>` : ''}
                <div class="text-[11px] text-slate-400 mt-2">Posted by <strong>${esc(a.posted_by)}</strong> · ${fmt(a.created_at)}</div>
              </div>
              ${admin ? `<button class="ann-del shrink-0 w-7 h-7 rounded-lg grid place-items-center text-slate-300 hover:text-red-500 hover:bg-red-50" data-id="${esc(a.id)}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
              </button>` : ''}
            </div>
          </div>`).join('')
      : `<div class="card p-10 text-center text-slate-400 text-[13px]">No announcements yet</div>`;

    el.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold text-slate-900">Announcements</h1>
            <p class="text-[12px] text-slate-500 mt-0.5">Company-wide notices and updates</p>
          </div>
          ${admin ? `<button id="ann-new-btn" class="btn-primary flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            New Announcement
          </button>` : ''}
        </div>
        <div class="space-y-3">${cards}</div>
      </div>`;

    document.getElementById('ann-new-btn')?.addEventListener('click', () => { _modalOpen = true; renderModal(); });
    el.querySelectorAll('.ann-del').forEach(btn => {
      btn.addEventListener('click', () => deleteAnnouncement(btn.dataset.id));
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
