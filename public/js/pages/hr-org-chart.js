/* =====================================================================
   Company Tree
   ---------------------------------------------------------------------
   The reporting line, drawn from hr_employees.reporting_to — the same
   field the leave router falls back to when deciding who a request goes
   to. One source, so the chart on this page and the name on the approval
   mail can never disagree.

   Drawn as an indented list rather than the usual boxes-and-lines chart:
   the company is wider than it is deep (one manager carries seven), and
   an indented list stays readable at that shape and on a phone, which a
   horizontal chart does not.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-org-chart'] = (() => {
  const H = window.HR;

  let _data = null;
  let _search = '';
  const _collapsed = new Set();

  async function load() {
    _data = await H.api('/api/hr/org-chart');
  }

  /* ── Search ───────────────────────────────────────────────────────── */

  /* A node survives the filter if it matches, or if anything below it does —
     otherwise searching for a junior would hide the manager you need to see
     them under, and the result would be a list of orphans. */
  function filter(node, term) {
    const hay = [node.name, node.designation, node.department].join(' ').toLowerCase();
    const kids = (node.reports || []).map((k) => filter(k, term)).filter(Boolean);
    const hit = hay.includes(term);
    if (!hit && !kids.length) return null;
    return { ...node, reports: hit ? (node.reports || []) : kids, _hit: hit };
  }

  const countAll = (n) => (n.reports || []).reduce((a, k) => a + 1 + countAll(k), 0);

  /* ── Render ───────────────────────────────────────────────────────── */

  const initials = (name) => String(name || '?').trim().split(/\s+/)
    .filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

  /* A stable colour per person, so the same face keeps the same badge on every
     visit. Hue derived from the name rather than picked at random. */
  function hue(name) {
    const s = String(name || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function nodeHtml(n) {
    const team = countAll(n);
    const direct = (n.reports || []).length;
    const shut = _collapsed.has(n.id) && direct;
    const av = n.avatar_url
      ? `<img src="${H.esc(n.avatar_url)}" alt="" class="oc-av" onerror="this.style.display='none';" />`
      : `<span class="oc-av" style="background:hsl(${hue(n.name)} 62% 94%);color:hsl(${hue(n.name)} 55% 32%);">${H.esc(initials(n.name))}</span>`;

    return `
      <li class="oc-li${n._hit ? ' is-hit' : ''}">
        <div class="oc-node${n.loginOnly ? ' is-mgmt' : ''}"${direct ? ` data-toggle="${H.esc(n.id)}" role="button" tabindex="0"` : ''}>
          ${direct
            ? `<span class="oc-caret${shut ? ' is-shut' : ''}" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>`
            : '<span class="oc-caret is-leaf" aria-hidden="true"></span>'}
          ${av}
          <span class="oc-who">
            <span class="oc-name">${H.esc(n.name)}</span>
            <span class="oc-role">${H.esc(n.designation || '—')}${n.department && n.department !== n.designation ? ' · ' + H.esc(n.department) : ''}</span>
          </span>
          ${n.loginOnly ? '<span class="oc-tag oc-tag-mgmt">Management</span>' : ''}
          ${n.cycle ? '<span class="oc-tag oc-tag-warn" title="This reporting line loops back on itself — fix it in Employee Master">Loop</span>' : ''}
          ${direct ? `<span class="oc-count" title="${direct} direct, ${team} in all">${direct}${team > direct ? ` <i>/ ${team}</i>` : ''}</span>` : ''}
        </div>
        ${direct && !shut ? `<ul class="oc-ul">${n.reports.map(nodeHtml).join('')}</ul>` : ''}
      </li>`;
  }

  function treeHtml() {
    if (!_data) return H.spinner();
    const term = _search.trim().toLowerCase();
    const roots = term
      ? (_data.roots || []).map((r) => filter(r, term)).filter(Boolean)
      : (_data.roots || []);
    if (!roots.length) {
      return term
        ? H.empty('Nobody by that name', 'Try part of a name, a designation or a department.')
        : H.empty('No reporting lines yet', 'Set "Reporting to" on the employee records and the tree draws itself.');
    }
    return `<div class="oc-wrap"><ul class="oc-ul oc-root">${roots.map(nodeHtml).join('')}</ul></div>`;
  }

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const n = _data ? _data.total : 0;
    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Company Tree', 'Who reports to whom — and who signs off their leave',
          `<button id="oc-expand" class="btn-secondary btn-sm">Collapse all</button>
           <button id="oc-export" class="btn-secondary btn-sm">Export CSV</button>`)}
        ${style()}
        <div class="oc-bar">
          <input id="oc-search" type="search" placeholder="Find a name, designation or department…"
                 value="${H.esc(_search)}" autocomplete="off" />
          <span class="oc-total">${n} active ${n === 1 ? 'person' : 'people'}</span>
        </div>
        <div id="oc-body">${treeHtml()}</div>
      </div>`;
    bind();
  }

  /* Only the tree is redrawn on a toggle or a keystroke — repainting the whole
     page would take the focus out of the search box on every character. */
  function repaint() {
    const body = document.getElementById('oc-body');
    if (body) { body.innerHTML = treeHtml(); bindTree(); }
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bindTree() {
    document.querySelectorAll('#oc-body [data-toggle]').forEach((node) => {
      const hit = () => {
        const id = node.getAttribute('data-toggle');
        if (_collapsed.has(id)) _collapsed.delete(id); else _collapsed.add(id);
        repaint();
      };
      node.addEventListener('click', hit);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(); }
      });
    });
  }

  function bind() {
    const expandBtn = document.getElementById('oc-expand');

    document.getElementById('oc-search')?.addEventListener('input', (e) => {
      _search = e.target.value;
      // A hit inside a collapsed branch would be invisible, so searching opens
      // the tree back up.
      if (_search.trim() && _collapsed.size) {
        _collapsed.clear();
        if (expandBtn) expandBtn.textContent = 'Collapse all';
      }
      repaint();
    });

    expandBtn?.addEventListener('click', () => {
      if (_collapsed.size) { _collapsed.clear(); expandBtn.textContent = 'Collapse all'; }
      else {
        // Roots stay open — collapsing them would leave a page of seven names
        // and nothing to read.
        const shut = (n) => { if ((n.reports || []).length) { _collapsed.add(n.id); n.reports.forEach(shut); } };
        (_data?.roots || []).forEach((r) => (r.reports || []).forEach(shut));
        expandBtn.textContent = 'Expand all';
      }
      repaint();
    });

    document.getElementById('oc-export')?.addEventListener('click', exportTree);
    bindTree();
  }

  function exportTree() {
    if (!_data) return;
    const rows = [];
    const walk = (n, mgr, depth) => {
      rows.push([depth, n.name, n.designation || '', n.department || '',
        n.branch || '', mgr || '', (n.reports || []).length]);
      (n.reports || []).forEach((k) => walk(k, n.name, depth + 1));
    };
    (_data.roots || []).forEach((r) => walk(r, '', 1));
    H.downloadCsv('Company Tree.csv',
      ['Level', 'Name', 'Designation', 'Department', 'Branch', 'Reports to', 'Direct reports'], rows);
    H.toast('Company tree exported');
  }

  /* ── Styles ───────────────────────────────────────────────────────── */

  const style = () => `<style>
    .oc-bar { display:flex; gap:12px; align-items:center; background:#fff; border:1px solid #e2e8f0;
              border-radius:12px; padding:11px 14px; margin-bottom:16px; }
    .oc-bar input { flex:1; min-width:0; padding:8px 11px; border:1.5px solid #e2e8f0; border-radius:8px;
                    font-size:13px; color:#1e293b; outline:none; font-family:inherit; background:#fff;
                    box-sizing:border-box; }
    .oc-bar input:focus { border-color:var(--color-primary); }
    .oc-total { font-size:11.5px; font-weight:600; color:#64748b; white-space:nowrap; }

    .oc-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:12px;
               padding:14px 18px 18px; overflow-x:auto; }
    .oc-ul { list-style:none; margin:0; padding:0; }
    /* Every level below the first is indented and carries the spine its children
       hang off. The last child paints over the tail of that spine so it stops at
       the bottom of the branch instead of running past it. */
    .oc-ul:not(.oc-root) { margin-left:19px; padding-left:20px; border-left:1px solid #e2e8f0; }
    .oc-li { position:relative; }
    .oc-ul:not(.oc-root) > .oc-li::before {
      content:''; position:absolute; left:-20px; top:20px; width:14px; height:1px; background:#e2e8f0;
    }
    .oc-ul:not(.oc-root) > .oc-li:last-child::after {
      content:''; position:absolute; left:-21px; top:21px; bottom:0; width:1px; background:#fff;
    }

    .oc-node { display:flex; align-items:center; gap:10px; padding:6px 9px; margin:2px 0;
               border-radius:9px; border:1px solid transparent; }
    .oc-node[data-toggle] { cursor:pointer; }
    .oc-node[data-toggle]:hover { background:#f8fafc; border-color:#e2e8f0; }
    .oc-node[data-toggle]:focus-visible { outline:2px solid var(--color-primary); outline-offset:1px; }
    .oc-node.is-mgmt { background:#f5f3ff; border-color:#ddd6fe; }
    .oc-node.is-mgmt[data-toggle]:hover { background:#ede9fe; }
    .is-hit > .oc-node { background:#fef9c3; border-color:#fde68a; }

    .oc-caret { width:11px; flex:none; display:flex; align-items:center; justify-content:center;
                color:#94a3b8; transition:transform .15s; }
    .oc-caret.is-shut { transform:rotate(-90deg); }

    .oc-av { width:28px; height:28px; flex:none; border-radius:50%; object-fit:cover;
             display:flex; align-items:center; justify-content:center;
             font-size:10.5px; font-weight:700; letter-spacing:.02em; }

    .oc-who { display:flex; flex-direction:column; min-width:0; }
    .oc-name { font-size:13px; font-weight:600; color:#0f172a; white-space:nowrap;
               overflow:hidden; text-overflow:ellipsis; }
    .oc-role { font-size:11px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    .oc-tag { flex:none; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
              padding:2px 7px; border-radius:99px; white-space:nowrap; }
    .oc-tag-mgmt { background:#ede9fe; color:#6d28d9; }
    .oc-tag-warn { background:#fee2e2; color:#b91c1c; }

    .oc-count { margin-left:auto; flex:none; font-size:11px; font-weight:700; color:#475569;
                background:#f1f5f9; border-radius:99px; padding:2px 9px; }
    .oc-count i { font-style:normal; font-weight:600; color:#94a3b8; }

    @media (max-width: 640px) {
      .oc-wrap { padding:10px 12px 14px; }
      .oc-ul:not(.oc-root) { margin-left:11px; padding-left:14px; }
      .oc-ul:not(.oc-root) > .oc-li::before { left:-14px; width:9px; }
      .oc-ul:not(.oc-root) > .oc-li:last-child::after { left:-15px; }
      .oc-role { display:none; }
    }
  </style>`;

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Drawing the company tree…');
      _data = null;
      _search = '';
      _collapsed.clear();
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load the company tree', e.message); }
    },
  };
})();
