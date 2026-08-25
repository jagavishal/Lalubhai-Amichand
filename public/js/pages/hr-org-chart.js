/* =====================================================================
   Company Tree
   ---------------------------------------------------------------------
   The reporting line, drawn from hr_employees.reporting_to — the same
   field the leave router falls back to when deciding who a request goes
   to. One source, so the chart on this page and the name on the approval
   mail can never disagree.

   Two views of the same tree. The chart is the one people ask for and
   the one worth printing; the list survives a phone and a long search,
   which a 3,000px-wide chart does not.

   The chart is hand-laid-out SVG rather than a charting library: the app
   ships no such library, and plain SVG is the one thing that rasterises
   to a PNG in the browser without one. Everything is real <text> — a
   <foreignObject> would taint the canvas and break the export.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-org-chart'] = (() => {
  const H = window.HR;

  const VIEW_KEY = 'hr_org_view';

  let _data = null;
  let _search = '';
  let _view = 'chart';
  let _zoom = 1;
  const _collapsed = new Set();

  try { _view = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'chart'; } catch (_) {}

  async function load() {
    _data = await H.api('/api/hr/org-chart');
  }

  /* The company itself crowns the chart, so the five management branches read
     as one organisation rather than five unrelated trees. Held only for the
     drawing — the server never invents this node. */
  const rooted = () => ({
    id: '__company__',
    name: _data?.company || 'Company',
    designation: '', department: '', isCompany: true,
    reports: _data?.roots || [],
  });

  /* ── Search ───────────────────────────────────────────────────────── */

  /* A node survives the filter if it matches, or if anything below it does —
     otherwise searching for a junior would hide the manager you need to see
     them under, and the result would be a list of orphans. */
  function filter(node, term) {
    const hay = [node.name, node.designation, node.department].join(' ').toLowerCase();
    const kids = (node.reports || []).map((k) => filter(k, term)).filter(Boolean);
    const hit = !node.isCompany && hay.includes(term);
    if (!hit && !kids.length) return null;
    return { ...node, reports: hit ? (node.reports || []) : kids, _hit: hit };
  }

  const visibleRoots = () => {
    const term = _search.trim().toLowerCase();
    if (!term) return _data?.roots || [];
    return (_data?.roots || []).map((r) => filter(r, term)).filter(Boolean);
  };

  const countAll = (n) => (n.reports || []).reduce((a, k) => a + 1 + countAll(k), 0);

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

  /* ══ Chart ═════════════════════════════════════════════════════════════
     Layout is one post-order walk: a leaf takes the next free column, a
     parent centres over the children it just placed. That is all a
     reporting tree needs — nobody has two managers, so the subtrees can
     never overlap and the tidier algorithms have nothing left to fix. */

  const BOX_W = 108, BOX_H = 104, GAP_X = 9, GAP_Y = 46, PAD = 24, TITLE_H = 58;

  /* Drawn on its own dark canvas rather than in the page's own light card. It
     is how everybody here already reads an org chart, and the exported PNG
     lands on a slide without being restyled.

     Every box is the same blue. The temptation is to tint them by rank or by
     person, but a chart of forty boxes in forty shades reads as forty separate
     things — the hierarchy is already drawn by the lines, and letting the
     colour say nothing is what makes the shape legible. The only box that
     differs is one the search has found. */
  const C = {
    canvas: '#111114',
    title: '#8b8b93',
    edge: '#4b5563',
    box: '#4a5cf6',
    boxLine: '#8b98fb',
    name: '#ffffff',
    role: '#cbd5ff',
    hit: '#fbbf24',
    hitLine: '#fde68a',
    hitName: '#1c1917',
    hitRole: '#57534e',
    badge: '#111114',
    badgeLine: '#8b98fb',
    badgeText: '#ffffff',
  };

  /* Text has to be wrapped before it is written, because SVG will not do it.
     Measured on a canvas with the same font so the wrap matches what renders,
     rather than guessed from a character count. */
  let _mctx = null;
  function measure(text, font) {
    if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
    _mctx.font = font;
    return _mctx.measureText(text).width;
  }
  function wrap(text, font, maxW, maxLines) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (line && measure(next, font) > maxW) { lines.push(line); line = w; }
      else line = next;
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines && words.length) {
      // Anything that did not fit is cut with an ellipsis rather than dropped
      // in silence, so a truncated name still reads as truncated.
      let last = lines[maxLines - 1];
      const used = lines.join(' ').split(/\s+/).length;
      if (used < words.length) {
        while (last && measure(last + '…', font) > maxW) last = last.slice(0, -1);
        lines[maxLines - 1] = last + '…';
      }
    }
    return lines.length ? lines : [''];
  }

  const NAME_FONT = '700 12px system-ui, -apple-system, "Segoe UI", sans-serif';
  const ROLE_FONT = '400 10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
  const NAME_LH = 14, ROLE_LH = 12.5;

  function layout(root) {
    const placed = [];
    let cursor = 0;

    const walk = (n, depth) => {
      const kids = _collapsed.has(n.id) ? [] : (n.reports || []);
      const node = {
        ref: n, depth, y: depth * (BOX_H + GAP_Y),
        kids: kids.map((k) => walk(k, depth + 1)),
      };
      if (!node.kids.length) { node.x = cursor; cursor += BOX_W + GAP_X; }
      else node.x = (node.kids[0].x + node.kids[node.kids.length - 1].x) / 2;
      placed.push(node);
      return node;
    };

    const tree = walk(root, 0);
    const width = Math.max(cursor - GAP_X, BOX_W);
    const depth = Math.max(...placed.map((p) => p.depth));
    return { tree, placed, width, height: (depth + 1) * BOX_H + depth * GAP_Y };
  }

  /* Elbow connectors: straight down out of the parent, along a shared
     horizontal rail, then straight down into each child. One rail per parent
     rather than a curve per child — it stays readable when seven peons hang
     off one box, which a fan of curves does not. */
  function edges(node) {
    if (!node.kids.length) return '';
    const px = node.x + BOX_W / 2, py = node.y + BOX_H;
    const rail = py + GAP_Y / 2;
    let d = `M${px} ${py}V${rail}`;
    const xs = node.kids.map((k) => k.x + BOX_W / 2);
    d += `M${Math.min(...xs, px)} ${rail}H${Math.max(...xs, px)}`;
    for (const k of node.kids) d += `M${k.x + BOX_W / 2} ${rail}V${k.y}`;
    return d + node.kids.map(edges).join('');
  }

  function boxSvg(p) {
    const n = p.ref;
    const direct = (n.reports || []).length;
    const shut = _collapsed.has(n.id) && direct;
    const x = p.x, y = p.y;
    const hit = !!n._hit;

    const fill = hit ? C.hit : C.box;
    const stroke = hit ? C.hitLine : C.boxLine;
    const nameFill = hit ? C.hitName : C.name;
    const roleFill = hit ? C.hitRole : C.role;

    const nameLines = wrap(n.name, NAME_FONT, BOX_W - 14, 3);
    const roleText = n.isCompany ? 'Company' : (n.designation || n.department || '');
    const roleLines = roleText ? wrap(roleText, ROLE_FONT, BOX_W - 12, 3) : [];
    const block = nameLines.length * NAME_LH + roleLines.length * ROLE_LH;
    let ty = y + (BOX_H - block) / 2 + 11;

    const F = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    let out = `<g class="ocs-node${direct ? ' is-toggle' : ''}"${direct ? ` data-toggle="${H.esc(n.id)}"` : ''}>`;
    out += `<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`;
    for (const line of nameLines) {
      out += `<text x="${x + BOX_W / 2}" y="${ty}" text-anchor="middle" font-family="${F}" font-size="12" font-weight="700" fill="${nameFill}">${H.esc(line)}</text>`;
      ty += NAME_LH;
    }
    ty += 1;
    for (const line of roleLines) {
      out += `<text x="${x + BOX_W / 2}" y="${ty}" text-anchor="middle" font-family="${F}" font-size="10.5" fill="${roleFill}">${H.esc(line)}</text>`;
      ty += ROLE_LH;
    }
    if (direct) {
      // The count doubles as the collapse handle, so a branch folds away
      // without a second control on every box. Sat on the bottom edge rather
      // than inside, where it would eat a line of the name.
      const cx = x + BOX_W - 14, cy = y + BOX_H;
      out += `<circle cx="${cx}" cy="${cy}" r="9.5" fill="${shut ? C.badgeLine : C.badge}" stroke="${C.badgeLine}" stroke-width="1.4"/>`;
      out += `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-family="${F}" font-size="9.5" font-weight="700" fill="${shut ? C.canvas : C.badgeText}">${shut ? countAll(n) : direct}</text>`;
    }
    out += `<title>${H.esc(n.name)}${n.designation ? '\n' + H.esc(n.designation) : ''}${n.department ? '\n' + H.esc(n.department) : ''}${direct ? `\n${direct} direct, ${countAll(n)} in all` : ''}</title>`;
    return out + '</g>';
  }

  function chartSvg(forExport) {
    const roots = visibleRoots();
    if (!roots.length) return null;
    const { tree, placed, width, height } = layout({ ...rooted(), reports: roots });
    const w = width + PAD * 2, h = height + PAD * 2 + TITLE_H;
    const boxes = placed.slice().sort((a, b) => a.depth - b.depth).map(boxSvg).join('');
    return {
      w, h,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${forExport ? '' : ' class="ocs-svg"'}>
        <rect width="${w}" height="${h}" fill="${C.canvas}"/>
        <text x="${w / 2}" y="38" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="21" font-weight="700" fill="${C.title}">Organization Structure</text>
        <g transform="translate(${PAD} ${PAD + TITLE_H})">
          <path d="${edges(tree)}" fill="none" stroke="${C.edge}" stroke-width="1.2" stroke-linecap="round"/>
          ${boxes}
        </g>
      </svg>`,
    };
  }

  function chartHtml() {
    const c = chartSvg(false);
    if (!c) return emptyHtml();
    return `<div class="ocs-wrap"><div class="ocs-pan" style="width:${Math.round(c.w * _zoom)}px;height:${Math.round(c.h * _zoom)}px;">
      <div class="ocs-scale" style="transform:scale(${_zoom});width:${c.w}px;height:${c.h}px;">${c.svg}</div>
    </div></div>`;
  }

  /* ══ List ══════════════════════════════════════════════════════════════ */

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

  const emptyHtml = () => (_search.trim()
    ? H.empty('Nobody by that name', 'Try part of a name, a designation or a department.')
    : H.empty('No reporting lines yet', 'Set "Reporting to" on the employee records and the tree draws itself.'));

  function listHtml() {
    const roots = visibleRoots();
    if (!roots.length) return emptyHtml();
    return `<div class="oc-wrap"><ul class="oc-ul oc-root">${roots.map(nodeHtml).join('')}</ul></div>`;
  }

  const bodyHtml = () => (!_data ? H.spinner() : _view === 'chart' ? chartHtml() : listHtml());

  /* ── Page ─────────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const n = _data ? _data.total : 0;
    const tab = (key, label) =>
      `<button class="ocv-tab${_view === key ? ' is-on' : ''}" data-view="${key}">${label}</button>`;

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Company Tree', 'Who reports to whom — and who signs off their leave',
          `<button id="oc-png" class="btn-secondary btn-sm">Download PNG</button>
           <button id="oc-export" class="btn-secondary btn-sm">Export CSV</button>`)}
        ${style()}
        <div class="oc-bar">
          <span class="ocv-tabs">${tab('chart', 'Chart')}${tab('list', 'List')}</span>
          <input id="oc-search" type="search" placeholder="Find a name, designation or department…"
                 value="${H.esc(_search)}" autocomplete="off" />
          <span class="oc-zoom"${_view === 'chart' ? '' : ' hidden'}>
            <button id="oc-out" title="Zoom out">−</button>
            <button id="oc-fit" title="Fit to width">Fit</button>
            <button id="oc-in" title="Zoom in">+</button>
          </span>
          <button id="oc-expand" class="ocv-tab">${_collapsed.size ? 'Expand all' : 'Collapse all'}</button>
          <span class="oc-total">${n} active ${n === 1 ? 'person' : 'people'}</span>
        </div>
        <div id="oc-body">${bodyHtml()}</div>
      </div>`;
    bind();
    if (_view === 'chart' && _zoom === 1) openZoom();
  }

  /* Only the tree is redrawn on a toggle or a keystroke — repainting the whole
     page would take the focus out of the search box on every character. */
  function repaint() {
    const body = document.getElementById('oc-body');
    if (!body) return;
    const wrap = body.querySelector('.ocs-wrap');
    const keep = wrap ? { l: wrap.scrollLeft, t: wrap.scrollTop, w: wrap.scrollWidth } : null;
    body.innerHTML = bodyHtml();
    bindTree();
    // Hold the viewer's place across a redraw. Zooming keeps whatever was in
    // the middle of the pane in the middle of it, instead of throwing them
    // back to the left edge of a chart several screens wide.
    const next = body.querySelector('.ocs-wrap');
    if (next && keep && keep.w) {
      const ratio = next.scrollWidth / keep.w;
      next.scrollLeft = (keep.l + next.clientWidth / 2) * ratio - next.clientWidth / 2;
      next.scrollTop = keep.t * ratio;
    }
  }

  /* The company box sits over the middle of a chart that is several screens
     wide, so on a plain left-aligned scroll the top of the tree is the one
     thing you cannot see. Open centred on it. */
  function centreOnRoot() {
    const wrap = document.querySelector('.ocs-wrap');
    if (!wrap) return;
    wrap.scrollLeft = Math.max(0, (wrap.scrollWidth - wrap.clientWidth) / 2);
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bindTree() {
    document.querySelectorAll('#oc-body [data-toggle]').forEach((node) => {
      const hit = (e) => {
        e.stopPropagation();
        const id = node.getAttribute('data-toggle');
        if (_collapsed.has(id)) _collapsed.delete(id); else _collapsed.add(id);
        repaint();
        const btn = document.getElementById('oc-expand');
        if (btn) btn.textContent = _collapsed.size ? 'Expand all' : 'Collapse all';
      };
      node.addEventListener('click', hit);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(e); }
      });
    });
  }

  /* True fit: the whole chart on screen at once. Worth having as a bird's-eye
     button even when the result is small, but never blown up past natural size
     — a company of six should not render as six billboards. */
  function fitZoom() {
    const wrap = document.querySelector('.ocs-wrap');
    const c = chartSvg(false);
    if (!wrap || !c) return null;
    return Math.max(0.2, Math.min(1, wrap.clientWidth / c.w));
  }

  function fit() {
    const z = fitZoom();
    if (z == null) return;
    _zoom = z;
    repaint();
    centreOnRoot();
  }

  /* What the page opens at. Fitting a wide tree outright would shrink 11px
     names to seven pixels. Twenty-six columns cannot be both wholly on screen
     and legible on a laptop — so the opening zoom stops where the text is still
     readable and the chart scrolls sideways instead. Pressing Fit still
     gives the whole thing at once for anyone who wants the shape rather than
     the names. */
  function openZoom() {
    const z = fitZoom();
    if (z == null) return;
    _zoom = Math.max(0.75, z);
    repaint();
    centreOnRoot();
  }

  function setZoom(z) {
    _zoom = Math.max(0.25, Math.min(2, Math.round(z * 20) / 20));
    repaint();
  }

  function bind() {
    const expandBtn = document.getElementById('oc-expand');

    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      _view = b.getAttribute('data-view');
      try { localStorage.setItem(VIEW_KEY, _view); } catch (_) {}
      _zoom = 1;
      render();
    }));

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
        // Roots stay open — collapsing them would leave a page of six names
        // and nothing to read.
        const shut = (n) => { if ((n.reports || []).length) { _collapsed.add(n.id); n.reports.forEach(shut); } };
        (_data?.roots || []).forEach((r) => (r.reports || []).forEach(shut));
        expandBtn.textContent = 'Expand all';
      }
      repaint();
    });

    document.getElementById('oc-in')?.addEventListener('click', () => setZoom(_zoom + 0.1));
    document.getElementById('oc-out')?.addEventListener('click', () => setZoom(_zoom - 0.1));
    document.getElementById('oc-fit')?.addEventListener('click', fit);
    document.getElementById('oc-png')?.addEventListener('click', downloadPng);
    document.getElementById('oc-export')?.addEventListener('click', exportTree);
    bindTree();
  }

  /* ── Export ───────────────────────────────────────────────────────── */

  /* Rasterised at 2x so the PNG survives being pasted into a document or put on
     a wall. The SVG carries no external reference — every colour and glyph is
     inline — so the canvas is never tainted and toBlob is allowed to run. */
  function downloadPng() {
    const c = chartSvg(true);
    if (!c) { H.toast('Nothing to export'); return; }
    const scale = 2;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([c.svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = c.w * scale;
      canvas.height = c.h * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = C.canvas;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { H.toast('Could not build the image'); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(_data?.company || 'Company')} — Org Chart.png`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
        H.toast('Chart downloaded');
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); H.toast('Could not build the image'); };
    img.src = url;
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
    .oc-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; background:#fff;
              border:1px solid #e2e8f0; border-radius:12px; padding:10px 13px; margin-bottom:16px; }
    .oc-bar input { flex:1; min-width:160px; padding:8px 11px; border:1.5px solid #e2e8f0;
                    border-radius:8px; font-size:13px; color:#1e293b; outline:none;
                    font-family:inherit; background:#fff; box-sizing:border-box; }
    .oc-bar input:focus { border-color:var(--color-primary); }
    .oc-total { font-size:11.5px; font-weight:600; color:#64748b; white-space:nowrap; }

    .ocv-tabs { display:inline-flex; background:#f1f5f9; border-radius:8px; padding:2px; }
    .ocv-tab { font-family:inherit; font-size:12px; font-weight:600; color:#475569; cursor:pointer;
               background:transparent; border:1px solid transparent; border-radius:7px; padding:6px 13px; }
    .ocv-tab.is-on { background:#fff; color:var(--color-primary-strong); box-shadow:0 1px 2px rgba(15,23,42,.08); }
    #oc-expand { border-color:#e2e8f0; background:#fff; white-space:nowrap; }
    #oc-expand:hover { border-color:var(--color-primary); color:var(--color-primary-strong); }

    .oc-zoom { display:inline-flex; gap:2px; background:#f1f5f9; border-radius:8px; padding:2px; }
    .oc-zoom button { font-family:inherit; font-size:12px; font-weight:700; color:#475569; cursor:pointer;
                      background:transparent; border:0; border-radius:6px; padding:5px 10px; min-width:30px; }
    .oc-zoom button:hover { background:#fff; color:var(--color-primary-strong); }

    /* ── Chart ── */
    .ocs-wrap { background:#111114; border:1px solid #26262c; border-radius:12px; padding:0;
                overflow:auto; max-height:74vh; }
    .ocs-pan { position:relative; }
    .ocs-scale { transform-origin:0 0; position:absolute; top:0; left:0; }
    .ocs-svg { display:block; }
    .ocs-node.is-toggle { cursor:pointer; }
    .ocs-node.is-toggle:hover rect { stroke:var(--color-primary); stroke-width:1.8; }

    /* ── List ── */
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
      .oc-bar input { order:9; flex-basis:100%; }
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
      _zoom = 1;
      _collapsed.clear();
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load the company tree', e.message); }
    },
  };
})();
