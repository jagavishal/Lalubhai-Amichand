window.Pages = window.Pages || {};

window.Pages.announcements = (() => {
  let _items = [];

  const isAdmin = () => {
    const r = window.currentUser?.roles || [];
    return (Array.isArray(r) ? r : String(r).split(',')).some(x => x.trim() === 'Admin' || x.trim() === 'HOD');
  };

  const esc = Utils.esc;

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

  async function deleteAnnouncement(id) {
    if (!await Utils.showConfirm('Delete this announcement?', { danger: true })) return;
    try {
      await fetch('/api/announcements?id=' + encodeURIComponent(id), { method: 'DELETE' });
      await loadData();
      renderPage();
      Utils.showToast('Deleted');
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const admin = isAdmin();

    const cards = _items.length
      ? _items.map(a => `
        <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="display:flex;align-items:flex-start;gap:14px;">
            <div style="width:38px;height:38px;border-radius:12px;background:#fffbeb;color:#d97706;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:700;color:#0f172a;">${esc(a.title)}</div>
              ${a.message ? '<p style="font-size:13px;color:#475569;margin:6px 0 0;white-space:pre-wrap;line-height:1.5;">' + esc(a.message) + '</p>' : ''}
              <div style="font-size:11px;color:#94a3b8;margin-top:8px;">Posted by <strong style="color:#64748b;">${esc(a.posted_by)}</strong> &middot; ${fmt(a.created_at)}</div>
            </div>
            ${admin ? '<button class="ann-del" data-id="' + esc(a.id) + '" style="flex-shrink:0;width:28px;height:28px;border-radius:7px;border:none;background:#f8fafc;color:#94a3b8;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;" onmouseenter="this.style.background=\'#fef2f2\';this.style.color=\'#dc2626\';" onmouseleave="this.style.background=\'#f8fafc\';this.style.color=\'#94a3b8\';"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg></button>' : ''}
          </div>
        </div>`).join('')
      : '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:60px 20px;text-align:center;color:#94a3b8;font-size:13px;">No announcements yet</div>';

    el.innerHTML = `
      <div style="max-width:720px;margin:0 auto;padding:4px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
          <div>
            <h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">Announcements</h1>
            <p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Company-wide notices and updates</p>
          </div>
          ${admin ? '<button id="ann-new-btn" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;background:linear-gradient(135deg,#0150AA,#013D82);color:#fff;border:none;cursor:pointer;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>New Announcement</button>' : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">${cards}</div>
      </div>`;

    document.getElementById('ann-new-btn')?.addEventListener('click', () => _openModal());
    el.querySelectorAll('.ann-del').forEach(btn => {
      btn.addEventListener('click', () => deleteAnnouncement(btn.dataset.id));
    });
  }

  function _openModal() {
    const ex = document.getElementById('ann-modal');
    if (ex) ex.remove();
    let title = '', message = '', saving = false;

    const html = `
      <div id="ann-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="background:#fff;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,0.14);width:100%;max-width:440px;overflow:hidden;" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:10px;background:#fffbeb;color:#d97706;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              </div>
              <div>
                <div style="font-size:15px;font-weight:700;color:#0f172a;">Post Announcement</div>
                <div style="font-size:11.5px;color:#94a3b8;margin-top:1px;">Visible to all employees</div>
              </div>
            </div>
            <button id="ann-close" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Title <span style="color:#ef4444">*</span></label>
              <input id="ann-title" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;" placeholder="Announcement title" />
            </div>
            <div>
              <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Message <span style="color:#94a3b8;font-weight:400">(optional)</span></label>
              <textarea id="ann-message" rows="4" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;resize:none;box-sizing:border-box;font-family:inherit;" placeholder="Write the announcement details..."></textarea>
            </div>
          </div>
          <div style="padding:16px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="ann-cancel" class="btn-secondary">Cancel</button>
            <button id="ann-post" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;background:linear-gradient(135deg,#0150AA,#013D82);color:#fff;border:none;cursor:pointer;">Post Announcement</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const closeModal = () => { document.getElementById('ann-modal')?.remove(); };
    document.getElementById('ann-modal').addEventListener('click', closeModal);
    document.getElementById('ann-close').addEventListener('click', closeModal);
    document.getElementById('ann-cancel').addEventListener('click', closeModal);
    document.getElementById('ann-title').focus();

    document.getElementById('ann-title').addEventListener('input', e => { title = e.target.value; });
    document.getElementById('ann-message').addEventListener('input', e => { message = e.target.value; });

    document.getElementById('ann-post').addEventListener('click', async () => {
      if (!title.trim()) { Utils.showToast('Title is required', 'error'); return; }
      const btn = document.getElementById('ann-post');
      btn.disabled = true; btn.textContent = 'Posting…';
      try {
        await Utils.apiFetch('/api/announcements', { method: 'POST', body: JSON.stringify({ title, message }) });
        closeModal();
        await loadData();
        renderPage();
        Utils.showToast('Announcement posted!', 'success');
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Post Announcement';
        Utils.showToast(e.message || 'Failed', 'error');
      }
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
