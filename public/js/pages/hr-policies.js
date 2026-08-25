/* =====================================================================
   HR Policies
   ---------------------------------------------------------------------
   The company's policy documents — Employee, Leave, POSH — readable by
   every employee, editable in place by an Admin. Stored as rows, not
   PDFs, so they open on a phone and a correction is one edit rather than
   a round-trip through a document.

   The body is a restricted markdown (## headings, - bullets, **bold**,
   blank-line paragraphs) rendered by the tiny converter below — the page
   never has to trust rich HTML from anywhere, including the database.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-policies'] = (() => {
  const H = window.HR;

  let _list = [];
  let _open = '';      // id of the policy being read
  let _editing = false;

  async function load() {
    _list = await H.api('/api/hr/policies') || [];
    if (!_open && _list.length) _open = _list[0].id;
  }

  /* ── Markdown-lite → HTML. Every text node passes through H.esc first. ── */
  function md(text) {
    const inline = (t) => H.esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push('</ul>'); list = null; } };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { closeList(); continue; }
      if (line.startsWith('## ')) {
        closeList();
        out.push(`<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:22px 0 8px;">${inline(line.slice(3))}</h3>`);
      } else if (line.startsWith('- ')) {
        if (!list) { out.push('<ul style="margin:6px 0 10px;padding-left:22px;">'); list = true; }
        out.push(`<li style="font-size:13px;line-height:1.65;color:#334155;margin:4px 0;">${inline(line.slice(2))}</li>`);
      } else {
        closeList();
        out.push(`<p style="font-size:13px;line-height:1.7;color:#334155;margin:0 0 10px;">${inline(line)}</p>`);
      }
    }
    closeList();
    return out.join('');
  }

  const fmtWhen = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const cur = _list.find((p) => p.id === _open) || _list[0];
    const admin = H.isAdmin();

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('HR Policies', 'The rules of the house — read them once, find them here forever',
          admin && cur && !_editing ? `<button id="hrp-edit" class="btn-secondary btn-sm">Edit this policy</button>` : '')}
        <div style="display:grid;grid-template-columns:230px 1fr;gap:14px;align-items:start;" id="hrp-grid">
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:8px;">
            ${_list.map((p) => `
              <button data-open="${H.esc(p.id)}" style="display:block;width:100%;text-align:left;font:inherit;
                  font-size:13px;font-weight:${p.id === (cur && cur.id) ? '700' : '500'};
                  color:${p.id === (cur && cur.id) ? 'var(--color-primary-strong)' : '#334155'};
                  background:${p.id === (cur && cur.id) ? '#f0f7ff' : 'transparent'};
                  border:0;border-radius:8px;padding:10px 12px;cursor:pointer;margin:2px 0;">
                ${H.esc(p.title)}
              </button>`).join('') || '<div style="padding:16px;font-size:12.5px;color:#94a3b8;">No policies yet.</div>'}
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px 28px;min-height:300px;">
            ${cur ? (_editing ? editor(cur) : reader(cur)) : ''}
          </div>
        </div>
        <style>
          @media (max-width: 700px) { #hrp-grid { grid-template-columns: 1fr; } }
        </style>
      </div>`;
    bind();
  }

  const reader = (p) => `
    <div style="font-size:17px;font-weight:800;color:#0f172a;margin-bottom:2px;">${H.esc(p.title)}</div>
    <div style="font-size:11.5px;color:#94a3b8;margin-bottom:6px;">
      ${p.updated_by ? `Last updated by ${H.esc(p.updated_by)}${fmtWhen(p.updated_at) ? ' · ' + fmtWhen(p.updated_at) : ''}` : 'Company policy'}
    </div>
    ${md(p.body)}`;

  const editor = (p) => `
    <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:10px;">Editing — ${H.esc(p.title)}</div>
    <div style="font-size:11.5px;color:#64748b;margin-bottom:10px;">
      Formatting: <code>## Heading</code>, <code>- bullet</code>, <code>**bold**</code>, blank line between paragraphs.
    </div>
    <textarea id="hrp-body" style="width:100%;min-height:420px;box-sizing:border-box;padding:12px;border:1.5px solid #e2e8f0;
        border-radius:8px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;line-height:1.6;color:#1e293b;
        outline:none;resize:vertical;">${H.esc(p.body || '')}</textarea>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button id="hrp-save" class="btn-primary btn-sm">Save Policy</button>
      <button id="hrp-cancel" class="btn-secondary btn-sm">Cancel</button>
    </div>`;

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      _open = b.getAttribute('data-open');
      _editing = false;
      render();
    }));
    document.getElementById('hrp-edit')?.addEventListener('click', () => { _editing = true; render(); });
    document.getElementById('hrp-cancel')?.addEventListener('click', () => { _editing = false; render(); });
    document.getElementById('hrp-save')?.addEventListener('click', async () => {
      const body = document.getElementById('hrp-body')?.value ?? '';
      try {
        await H.post('/api/hr/policies', { id: _open, body });
        _editing = false;
        await load();
        render();
        H.toast('Policy saved');
      } catch (e) { H.fail(e); }
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening the policy book…');
      _editing = false;
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load policies', e.message); }
    },
  };
})();
