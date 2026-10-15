/* =====================================================================
   Circle Requirement — kg of aluminium circle to order for an export
   order. Server side: backend/circle-requirement.js
   (/api/circle-requirement/*).

   Was a hand-made sheet per order ("ORDER NO. P00664, P00665 PLANNING"):
   look each item up in the master, copy its body and cover circle and
   per-piece weight, x qty, +10 % and round off, then add up a summary
   per circle size and gauge by hand. Here a line is only order no., item,
   size and qty; everything after that is worked out below (calc) and
   recomputed on every keystroke. A set (Busrai Tope 9X15 (7Pcs)) opens
   into one line per size.

   Built on window.HR (hr-common.js) for the header, tabs, tiles, modals
   and form fields, like Office Inventory.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['circle-requirement'] = (() => {
  const H = window.HR;
  const esc = H.esc;
  const BASE = '/api/circle-requirement';

  let M = [];            // master rows
  let byId = new Map();
  let manage = false;
  let plans = null;      // saved plan list (loaded on first visit to that tab)
  let P = blankPlan();   // the plan being edited
  let dirty = false;
  let _tab = 'plan';
  const _mf = { q: '', kind: 'All' };

  function blankPlan() {
    return { id: '', title: '', extra_pct: 10, round_step: 10, round_mode: 'up', lines: [], extras: [] };
  }

  /* ── Circle maths ─────────────────────────────────────────────────── */

  // Standard wire gauge in mm, as the master writes thicknesses.
  const SWG = [[3.25, 10], [2.64, 12], [2.34, 13], [2.03, 14], [1.83, 15], [1.63, 16], [1.42, 17], [1.22, 18], [1.01, 19], [0.91, 20], [0.81, 21], [0.71, 22], [0.61, 23], [0.56, 24]];
  const gaugeOf = (t) => {
    const g = SWG.find(([mm]) => Math.abs(mm - t) < 0.015);
    return g ? `${g[1]}G` : `${fmtN(t)}MM`;
  };
  const gaugeLong = (t) => {
    const g = SWG.find(([mm]) => Math.abs(mm - t) < 0.015);
    return g ? `${g[1]} SWG (${t} mm)` : `${fmtN(t)} mm`;
  };
  const fmtN = (n) => String(Math.round(Number(n || 0) * 1000) / 1000);
  const kg3 = (n) => (Math.round(n * 1000) / 1000).toFixed(3);
  const kg0 = (n) => (Math.round(n * 1000) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  function circleLabel(p) {
    if (!(p.dia > 0)) return '';
    if (p.unit === 'mm') return `${fmtN(p.dia)}MM${p.w > 0 ? ` X ${fmtN(p.w)}MM` : ''} X ${gaugeOf(p.t)}`;
    return `${fmtN(p.dia)}${p.w > 0 ? ` X ${fmtN(p.w)}` : ''} X ${gaugeOf(p.t)}`;
  }
  // Same rule the master's weights follow: area x thickness x 2.8 g/cm3.
  function formulaWt(p) {
    if (!(p.dia > 0) || !(p.t > 0)) return 0;
    const k = p.unit === 'mm' ? 1 : 25.4;
    const area = p.w > 0 ? p.dia * k * p.w * k : Math.PI / 4 * (p.dia * k) ** 2;
    return Math.round(area * p.t * 2.8 / 1e6 * 1000) / 1000;
  }
  const wtOf = (p) => (p.wt > 0 ? p.wt : formulaWt(p));

  function roundReq(kg) {
    if (!(kg > 0)) return 0;
    const x = kg * (1 + (Number(P.extra_pct) || 0) / 100);
    const s = Number(P.round_step) || 0;
    if (P.round_mode === 'none' || !s) return Math.round(x * 1000) / 1000;
    if (P.round_mode === 'nearest') return Math.max(s, Math.round(x / s) * s);
    return Math.ceil(x / s - 1e-9) * s;
  }

  const partFrom = (m, which) => ({
    mode: 'need', unit: m.unit || 'in',
    dia: Number(m[`${which}_dia`]) || 0, w: Number(m[`${which}_w`]) || 0, t: Number(m[`${which}_t`]) || 0, wt: Number(m[`${which}_wt`]) || 0,
  });
  const emptyPart = () => ({ mode: 'need', unit: 'in', dia: 0, w: 0, t: 0, wt: 0 });
  const blankLine = (order_no = '') => ({ order_no, master_id: '', grp: '', item: '', size: '', qty: '', remark: '', body: emptyPart(), cover: emptyPart() });

  const partsOf = (setId) => M.filter((r) => r.kind === 'part' && r.parent_id === setId);

  /* The work: one detail row per body / cover circle, then the summary per
     circle size inside each gauge, thickest gauge first (the order the
     planning sheets' TOTAL SUMMARY used: 14, 16, 18, 19, 20 SWG). */
  function calc() {
    const rows = [];
    const issues = [];
    P.lines.forEach((l, i) => {
      const qty = Number(l.qty) || 0;
      if (!l.item) return;
      let any = false;
      for (const which of ['body', 'cover']) {
        const p = l[which];
        if (p.mode === 'skip' || !(p.dia > 0)) continue;
        any = true;
        const wt = wtOf(p);
        const kg = p.mode === 'stock' ? 0 : qty * wt;
        rows.push({
          line: i, which, order_no: l.order_no, item: which === 'body' ? l.item : 'COVER', size: l.size,
          t: p.t, label: circleLabel(p), key: `${p.unit}|${p.dia}|${p.w}|${p.t}`, unit: p.unit, dia: p.dia, w: p.w,
          qty, wt, kg, req: roundReq(kg), remark: p.mode === 'stock' ? 'AVAILABLE' : (which === 'body' ? l.remark : ''),
        });
      }
      if (!any && l.body.mode !== 'skip') issues.push(i);
      else if (!qty) issues.push(i);
    });
    for (const x of P.extras) {
      if (!(x.kg > 0)) continue;
      const p = { unit: x.unit, dia: x.dia, w: x.w, t: x.t };
      rows.push({ extra: true, item: x.note || 'Extra', size: '', order_no: '', t: x.t, label: circleLabel(p) || x.note, key: `${x.unit}|${x.dia}|${x.w}|${x.t}`, unit: x.unit, dia: x.dia, w: x.w, qty: 0, wt: 0, kg: 0, req: Number(x.kg), remark: 'Direct kg' });
    }
    const groups = new Map();
    for (const r of rows) {
      if (!(r.req > 0)) continue;
      const g = groups.get(r.t) || { t: r.t, items: new Map(), total: 0 };
      const it = g.items.get(r.key) || { label: r.label, dia: r.dia, w: r.w, unit: r.unit, kg: 0, net: 0, qty: 0, n: 0, used: new Set() };
      it.kg += r.req;
      it.net += r.kg;
      it.qty += r.qty;
      it.n += 1;
      it.used.add(r.which === 'cover' ? `${P.lines[r.line].item} cover` : r.item);
      g.total += r.req;
      g.items.set(r.key, it);
      groups.set(r.t, g);
    }
    const summary = [...groups.values()].sort((a, b) => b.t - a.t).map((g) => ({
      t: g.t, total: g.total,
      items: [...g.items.values()].sort((a, b) => (a.unit === b.unit ? 0 : a.unit === 'mm' ? 1 : -1) || a.dia - b.dia || a.w - b.w),
    }));
    return {
      rows, summary, issues,
      net: rows.reduce((s, r) => s + r.kg, 0),
      order: summary.reduce((s, g) => s + g.total, 0),
    };
  }

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function loadMaster() {
    const d = await H.api(`${BASE}/master`);
    M = d.master || [];
    manage = !!d.manage;
    byId = new Map(M.map((r) => [r.id, r]));
  }
  async function loadPlans() { plans = (await H.api(`${BASE}/plans`)).plans || []; }

  // Names offered in the Item box: everything that can be ordered (items and
  // sets — a set's sizes come with it).
  const itemNames = () => [...new Set(M.filter((r) => r.kind !== 'part').map((r) => r.item))].sort((a, b) => a.localeCompare(b));
  const choicesFor = (name) => M.filter((r) => r.kind !== 'part' && norm(r.item) === norm(name));
  const choiceLabel = (r, all) => {
    const twin = all.filter((x) => norm(x.size) === norm(r.size)).length > 1;
    return `${r.size}${twin && r.swg ? ` · ${r.swg}` : ''}${r.kind === 'set' ? ' (set)' : ''}`;
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const tabs = [
      { key: 'plan', label: P.id ? `Plan ${P.id}` : 'New plan' },
      { key: 'plans', label: 'Saved', count: plans ? plans.length : null },
      { key: 'master', label: 'Master', count: M.filter((r) => r.kind !== 'part').length },
    ];
    const body = { plan: planTab, plans: plansTab, master: masterTab }[_tab]();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        .cr-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px; }
        .cr-card h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:0 0 10px; }
        .cr-grid { width:100%;border-collapse:collapse;min-width:820px; }
        .cr-grid th { padding:8px 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:#64748b;text-align:left;background:#f8fafc;border-bottom:1px solid #e2e8f0;white-space:nowrap; }
        .cr-grid td { padding:5px 6px;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#334155;vertical-align:middle; }
        .cr-grid input, .cr-grid select { width:100%;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12.5px;box-sizing:border-box;background:#fff;font-family:inherit; }
        .cr-grid input:focus, .cr-grid select:focus { border-color:var(--color-primary);outline:none; }
        .cr-grid tr.cr-bad td { background:#fff7ed; }
        .cr-circ { font-weight:600;color:#0f172a;white-space:nowrap; }
        .cr-sub { font-size:11px;color:#94a3b8;white-space:nowrap; }
        .cr-mode { width:auto !important;padding:3px 4px !important;font-size:11px !important;margin-top:3px; }
        .cr-ico { border:none;background:#f1f5f9;border-radius:7px;width:28px;height:28px;cursor:pointer;color:#475569;font-size:14px; }
        .cr-ico:hover { background:#e2e8f0; }
        .cr-sum { display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px; }
        .cr-sum table { width:100%;border-collapse:collapse; }
        .cr-sum td { padding:4px 6px;font-size:12.5px;border-bottom:1px dotted #e2e8f0; }
        .cr-sum tr.tot td { font-weight:700;border-top:1.5px solid #cbd5e1;border-bottom:none; }
        .cr-set { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:end; }
        @media (max-width: 767px) { .cr-set { grid-template-columns:1fr 1fr; } }
      </style>
      ${H.header('Circle Requirement', 'Item, size aur qty daalo — circle ka kg apne aap nikalta hai',
        _tab === 'plan' ? `<button id="cr-new" class="btn-secondary btn-sm">New</button>
          <button id="cr-xls" class="btn-secondary btn-sm">Excel</button>
          <button id="cr-save" class="btn-primary btn-sm">Save</button>` : '')}
      ${H.tabs('cr', tabs, _tab)}
      ${body}
    </div>`;
    bind();
  }

  /* ── Plan tab ─────────────────────────────────────────────────────── */

  function planTab() {
    if (!M.length) {
      return H.empty('The master is empty', manage
        ? 'Open the Master tab and press “Import from master sheet” to load the items, sizes and circles.'
        : 'Ask an Admin to import the master sheet (Master tab) first.');
    }
    const circleCell = (l) => {
      const one = (p, tag) => {
        if (p.mode === 'skip' || !(p.dia > 0)) return '';
        return `<div class="cr-circ">${esc(circleLabel(p))}${p.mode === 'stock' ? ' <span class="cr-sub" style="color:#16a34a;">stock</span>' : ''} <span class="cr-sub">${tag}</span></div>`;
      };
      const html = one(l.body, 'body') + one(l.cover, 'cover');
      return html || '<span style="color:#cbd5e1;">—</span>';
    };
    const rows = P.lines.map((l, i) => {
      const choices = choicesFor(l.item);
      const m = byId.get(l.master_id);
      const setPart = l.grp ? `<div class="cr-sub" title="Part of a set — qty changes apply to the whole set">${esc(l.remark || 'set')}</div>` : '';
      const sizeCtl = l.grp || (!choices.length && l.item)
        ? `<input data-f="size" data-i="${i}" value="${esc(l.size)}" placeholder="size" />`
        : `<select data-pick="${i}"><option value="">${choices.length ? 'size…' : '—'}</option>
            ${choices.map((r) => `<option value="${esc(r.id)}"${r.id === l.master_id ? ' selected' : ''}>${esc(choiceLabel(r, choices))}</option>`).join('')}</select>`;
      const guess = l.pasted ? `<div class="cr-sub" style="color:#2563eb;" title="Pasted as: ${esc(l.pasted)}">pasted as “${esc(l.pasted)}” — check</div>` : '';
      const noMaster = l.item && !m && !l.grp && l.src !== 'file' ? `<div class="cr-sub" style="color:#d97706;">not in master — set circles with ✎${manage ? ` · <a href="#" data-tomaster="${i}" style="color:var(--color-primary);">add to master</a>` : ''}</div>` : '';
      // A line still on a set (not opened into sizes): sizes not there yet, or there and waiting to be opened.
      const nParts = m && m.kind === 'set' ? partsOf(m.id).length : 0;
      const addSize = manage ? ` · <a href="#" data-addsize="${i}" style="color:var(--color-primary);">+ add a size</a>` : '';
      const emptySet = m && m.kind === 'set'
        ? (nParts
          ? `<div class="cr-sub" style="color:#2563eb;">${nParts} size${nParts > 1 ? 's' : ''} in master · <a href="#" data-expand="${i}" style="color:var(--color-primary);font-weight:700;">open into sizes</a>${addSize}</div>`
          : `<div class="cr-sub" style="color:#d97706;">set sizes not in master${manage ? addSize : ' — ask an Admin, or ✎'}</div>`)
        : '';
      return `<tr data-row="${i}">
        <td style="width:28px;color:#94a3b8;">${i + 1}</td>
        <td style="width:100px;"><input data-f="order_no" data-i="${i}" value="${esc(l.order_no)}" placeholder="P00664" /></td>
        <td style="min-width:220px;" title="${l.src === 'file' ? 'Circle from the uploaded sheet' : ''}"><input data-f="item" data-i="${i}" value="${esc(l.item)}" list="cr-items" placeholder="type item name…" />${setPart}${guess}${noMaster}${emptySet}</td>
        <td style="width:150px;">${sizeCtl}</td>
        <td style="width:84px;"><input data-f="qty" data-i="${i}" value="${esc(l.qty)}" type="number" min="0" step="1" placeholder="0" /></td>
        <td style="min-width:150px;">${circleCell(l)}</td>
        <td style="text-align:right;white-space:nowrap;" data-kg="${i}"></td>
        <td style="width:70px;white-space:nowrap;">
          <button class="cr-ico" data-edit="${i}" title="Circle badlo / stock / cover nahi chahiye">✎</button>
          <button class="cr-ico" data-del="${i}" title="Remove line">✕</button></td>
      </tr>`;
    }).join('');
    const extras = P.extras.map((x, k) => `<tr>
        <td>${k + 1}</td><td colspan="2"><b>${esc(x.note || 'Extra')}</b></td>
        <td colspan="3">${esc(circleLabel({ ...x }) || '')}</td>
        <td style="text-align:right;"><b>${kg0(x.kg)}</b> kg</td>
        <td><button class="cr-ico" data-xedit="${k}" title="Edit">✎</button> <button class="cr-ico" data-xdel="${k}" title="Remove">✕</button></td></tr>`).join('');

    return `
      <div class="cr-card" style="padding:0;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #f1f5f9;">
          <input id="cr-title" value="${esc(P.title)}" placeholder="Order no. — e.g. P00664, P00665" style="flex:1;min-width:200px;max-width:380px;padding:8px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13.5px;font-weight:600;">
          <span style="flex:1;"></span>
          <button id="cr-add" class="btn-primary btn-sm">+ Line</button>
          <label class="btn-secondary btn-sm" style="cursor:pointer;">Upload Excel<input id="cr-upload" type="file" accept=".xlsx,.xls,.csv" style="display:none;"></label>
          <button id="cr-paste" class="btn-secondary btn-sm">Paste from Excel</button>
          ${manage ? '<button id="cr-madd" class="btn-secondary btn-sm">+ Add item / set</button>' : ''}
        </div>
        <div style="overflow-x:auto;">
          <table class="cr-grid">
            <thead><tr><th>#</th><th>Order No</th><th>Item</th><th>Size</th><th>Qty</th><th>Circle</th><th style="text-align:right;">Kg</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="8" style="padding:34px;text-align:center;color:#94a3b8;">“+ Line” dabao, ya order ki Excel “Upload Excel” karo (columns: Order No · Item · Size · Qty).</td></tr>`}
            ${extras ? `<tr><td colspan="8" style="background:#f8fafc;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">Direct kg</td></tr>${extras}` : ''}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-top:1px solid #f1f5f9;font-size:12px;color:#64748b;">
          <span id="cr-set-lab">${esc(setLabel())}</span>
          <a href="#" id="cr-set-toggle" style="color:var(--color-primary);">change</a>
          <a href="#" id="cr-extra" style="color:var(--color-primary);">+ direct kg (sheet etc.)</a>
        </div>
        <div id="cr-set" class="cr-set" style="display:none;padding:0 16px 14px;">
          ${H.field('cr-pct', 'Extra %', P.extra_pct, { type: 'number', step: '0.5' })}
          ${H.field('cr-step', 'Round off to (kg)', P.round_step, { type: 'number', step: '1' })}
          ${H.select('cr-rmode', 'Round off', P.round_mode, [{ value: 'up', label: 'Up to next' }, { value: 'nearest', label: 'Nearest' }, { value: 'none', label: 'No rounding' }])}
        </div>
        <datalist id="cr-items">${itemNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </div>
      <div id="cr-results"></div>`;
  }

  const setLabel = () => P.round_mode === 'none' ? `${P.extra_pct}% extra · no rounding`
    : `${P.extra_pct}% extra · ${P.round_mode === 'nearest' ? 'round' : 'round up'} to ${P.round_step} kg`;

  function resultsHTML() {
    const R = calc();
    if (!R.rows.length) return '';
    const pct = Number(P.extra_pct) || 0;
    const warn = R.issues.length
      ? `<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:9px 13px;font-size:12.5px;margin-bottom:12px;">
          Line${R.issues.length > 1 ? 's' : ''} ${R.issues.map((i) => i + 1).join(', ')}: no quantity or no circle yet — not counted.</div>` : '';
    const sum = R.summary.map((g) => `<div class="cr-card" style="margin:0;">
        <h3>${esc(gaugeLong(g.t))}</h3>
        <table>${g.items.map((it) => `<tr><td>${esc(it.label)}</td><td style="text-align:right;">${kg0(it.kg)}</td></tr>`).join('')}
        <tr class="tot"><td>TOTAL</td><td style="text-align:right;">${kg0(g.total)} kg</td></tr></table></div>`).join('');
    const totals = `<div class="cr-card" style="margin:0;"><h3>Total summary</h3><table>
        ${R.summary.map((g) => `<tr><td>${esc(gaugeOf(g.t).replace('G', ' SWG'))}</td><td style="text-align:right;">${kg0(g.total)}</td></tr>`).join('')}
        <tr class="tot"><td>G. TOTAL</td><td style="text-align:right;">${kg0(R.order)} kg</td></tr></table></div>`;
    const detail = H.table(
      ['#', 'Order No', 'Item', 'Size', 'SWG (mm)', 'Circle size', { label: 'Qty', align: 'right' }, { label: 'Per pc wt', align: 'right' }, { label: 'Total wt (kg)', align: 'right' }, { label: `${pct}% add + R.off`, align: 'right' }, 'Remark'],
      R.rows.map((r, k) => [k + 1, esc(r.order_no || ''), r.which === 'cover' ? '<span style="color:#64748b;">COVER</span>' : `<b>${esc(r.item)}</b>`, esc(r.size), r.t ? fmtN(r.t) : '', `<b>${esc(r.label)}</b>`,
        r.qty ? r.qty.toLocaleString('en-IN') : '', r.wt ? kg3(r.wt) : '', r.kg ? kg3(r.kg) : '', r.req ? `<b>${kg0(r.req)}</b>` : '', r.remark ? esc(r.remark) : '']),
      { maxHeight: '520px' });
    return `${warn}
      <div class="cr-card" style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">Circle order karna hai</span>
        <span style="font-size:26px;font-weight:800;color:var(--color-primary);letter-spacing:-.02em;">${kg0(R.order)} kg</span>
        <span style="font-size:12px;color:#94a3b8;">net ${kg0(Math.round(R.net * 1000) / 1000)} kg + ${pct}% + round off</span>
      </div>
      <div class="cr-sum" style="margin-bottom:14px;">${totals}${sum}</div>
      <details class="cr-card" style="padding:12px 16px;"><summary style="cursor:pointer;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">Line by line dekho</summary><div style="margin-top:10px;">${detail}</div></details>`;
  }

  // Cheap refresh after a qty / mode / setting change: the per-line kg and
  // the results, without rebuilding the inputs (keeps focus and caret).
  function refreshCalc() {
    const R = calc();
    document.querySelectorAll('[data-kg]').forEach((td) => {
      const i = +td.getAttribute('data-kg');
      const kg = R.rows.filter((r) => r.line === i).reduce((s, r) => s + r.req, 0);
      td.innerHTML = kg ? `<b>${kg0(kg)}</b>` : '<span style="color:#cbd5e1;">—</span>';
      td.closest('tr')?.classList.toggle('cr-bad', R.issues.includes(i));
    });
    const out = document.getElementById('cr-results');
    if (out) {
      const open = !!out.querySelector('details[open]');
      out.innerHTML = resultsHTML();
      if (open) out.querySelector('details')?.setAttribute('open', '');
    }
    const lab = document.getElementById('cr-set-lab');
    if (lab) lab.textContent = setLabel();
  }

  /* ── Picking an item ──────────────────────────────────────────────── */

  // Fill line i from master row m. A set with sizes opens into one line per
  // size, all sharing the set's qty (grp).
  function applyPick(i, m) {
    const l = P.lines[i];
    const parts = m.kind === 'set' ? partsOf(m.id) : [];
    if (parts.length) {
      const grp = 'g' + Date.now().toString(36) + i;
      const lines = parts.map((p) => ({
        order_no: l.order_no, master_id: p.id, grp, item: m.item, size: p.size, qty: l.qty,
        remark: `Set ${m.size}${p.auto ? ' (auto sizes)' : ''}`, body: partFrom(p, 'body'), cover: partFrom(p, 'cover'),
      }));
      P.lines.splice(i, 1, ...lines);
      return lines.length;
    }
    Object.assign(l, { master_id: m.id, item: m.item, size: m.size, body: partFrom(m, 'body'), cover: partFrom(m, 'cover') });
    return 1;
  }

  function findMaster(item, size) {
    const all = M.filter((r) => r.kind !== 'part');
    const ni = norm(item), ns = norm(size);
    let hit = all.filter((r) => norm(r.item) === ni && norm(r.size) === ns);
    if (!hit.length) {
      // "KETTLE ( S SPOUT )" vs "Kettle (S Spout)", "KADI DABBA NAXI" vs
      // "Kadi Dabba - Naxi 14": same words, so compare the words.
      const words = ni.split(' ').filter(Boolean);
      const sameSize = all.filter((r) => norm(r.size) === ns || norm(r.size) === `${ns} CM`);
      // First word must agree too: “SEED” is not “Moglai Date Bowl … seed Bowl”.
      hit = sameSize.filter((r) => { const w = norm(r.item).split(' '); return w[0] === words[0] && words.every((x) => w.includes(x)); });
      // Several fit ("Kettle (S Spout) - Bright" and "Kettle S Spout (Naxi
      // design)" for "KETTLE ( S SPOUT )"): the one with the fewest extra
      // words, if only one is closest. Marked so the planner checks it.
      if (hit.length > 1) {
        const extra = (r) => norm(r.item).split(' ').filter((x) => !words.includes(x) && !/^\d+$/.test(x)).length;
        const min = Math.min(...hit.map(extra));
        hit = hit.filter((r) => extra(r) === min);
      }
      if (hit.length === 1) return { ...hit[0], _guess: true };
    }
    return hit.length === 1 ? hit[0] : null;
  }

  /* ── Binding ──────────────────────────────────────────────────────── */

  const $ = (id) => document.getElementById(id);
  const touch = () => { dirty = true; };

  function bind() {
    document.querySelectorAll('[data-cr-tab]').forEach((b) => b.addEventListener('click', async () => {
      readSettings();
      _tab = b.getAttribute('data-cr-tab');
      if (_tab === 'plans' && !plans) { try { await loadPlans(); } catch (e) { H.fail(e); } }
      render();
    }));
    if (_tab === 'plan') bindPlan();
    if (_tab === 'plans') bindPlans();
    if (_tab === 'master') bindMaster();
  }

  function readSettings() {
    if (!$('cr-title')) return;
    P.title = H.val('cr-title').trim();
    P.extra_pct = Number(H.val('cr-pct')) || 0;
    P.round_step = Number(H.val('cr-step')) || 0;
    P.round_mode = H.val('cr-rmode') || 'up';
  }

  function bindPlan() {
    if (!M.length) return;
    refreshCalc();
    $('cr-set-toggle')?.addEventListener('click', (e) => { e.preventDefault(); const d = $('cr-set'); d.style.display = d.style.display === 'none' ? 'grid' : 'none'; });
    ['cr-pct', 'cr-step', 'cr-rmode', 'cr-title'].forEach((id) => $(id)?.addEventListener('input', () => { readSettings(); touch(); refreshCalc(); }));
    $('cr-rmode')?.addEventListener('change', () => { readSettings(); touch(); refreshCalc(); });

    $('cr-add')?.addEventListener('click', () => {
      const last = P.lines[P.lines.length - 1];
      P.lines.push(blankLine(last?.order_no || ''));
      touch(); render();
      document.querySelector(`[data-f="item"][data-i="${P.lines.length - 1}"]`)?.focus();
    });
    $('cr-paste')?.addEventListener('click', pasteModal);
    $('cr-madd')?.addEventListener('click', () => masterModal(null));
    // Saved to the master, the line takes it at once (a set opens into its sizes).
    document.querySelectorAll('[data-tomaster]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const i = +a.getAttribute('data-tomaster');
      const l = P.lines[i];
      masterModal({ item: l.item, size: l.size, unit: l.body.unit || 'in',
        body_dia: l.body.dia, body_w: l.body.w, body_t: l.body.t, body_wt: l.body.wt,
        cover_dia: l.cover.dia, cover_w: l.cover.w, cover_t: l.cover.t, cover_wt: l.cover.wt }, (id) => {
        const m = byId.get(id);
        if (m && P.lines[i] === l) { l.pasted = ''; applyPick(i, m); touch(); }
      });
    }));
    document.querySelectorAll('[data-expand]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const i = +a.getAttribute('data-expand');
      const set = byId.get(P.lines[i].master_id);
      if (set) { applyPick(i, set); touch(); render(); }
    }));
    document.querySelectorAll('[data-addsize]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const i = +a.getAttribute('data-addsize');
      const l = P.lines[i];
      const set = byId.get(l.master_id);
      if (!set) return;
      masterModal({ kind: 'part', parent_id: set.id, item: set.item, size: '', unit: 'in', swg: set.swg });
    }));
    $('cr-upload')?.addEventListener('change', (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) uploadExcel(file); });
    $('cr-extra')?.addEventListener('click', (e) => { e.preventDefault(); extraModal(-1); });
    $('cr-save')?.addEventListener('click', (e) => savePlan(e.target));
    $('cr-new')?.addEventListener('click', async () => {
      if (dirty && !(await Utils.showConfirm('Discard the changes to this plan and start a new one?', { title: 'New plan', confirmText: 'Discard' }))) return;
      P = blankPlan(); dirty = false; render();
    });
    $('cr-xls')?.addEventListener('click', exportExcel);

    document.querySelectorAll('[data-f]').forEach((inp) => {
      const i = +inp.getAttribute('data-i');
      const f = inp.getAttribute('data-f');
      const l = P.lines[i];
      if (f === 'item') {
        inp.addEventListener('change', () => {
          l.item = inp.value.trim();
          l.master_id = ''; l.grp = ''; l.pasted = ''; l.src = '';
          const ch = choicesFor(l.item);
          // One size only (e.g. a single Dallah set): take it straight away.
          if (ch.length === 1) applyPick(i, ch[0]);
          else { l.body = emptyPart(); l.cover = emptyPart(); }
          touch(); render();
          (document.querySelector(`[data-pick="${i}"]`) || document.querySelector(`[data-f="qty"][data-i="${i}"]`))?.focus();
        });
      } else {
        inp.addEventListener('input', () => {
          if (f === 'qty') {
            l.qty = inp.value;
            // A set's sizes move together.
            if (l.grp) P.lines.forEach((x, k) => { if (x.grp === l.grp && k !== i) { x.qty = inp.value; const o = document.querySelector(`[data-f="qty"][data-i="${k}"]`); if (o) o.value = inp.value; } });
          } else l[f] = inp.value;
          touch(); refreshCalc();
        });
        if (f === 'order_no' && l.grp) inp.addEventListener('change', () => { P.lines.forEach((x) => { if (x.grp === l.grp) x.order_no = l.order_no; }); render(); });
      }
      // Enter in Qty adds the next line — quick keyboard entry.
      if (f === 'qty') inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && i === P.lines.length - 1) { e.preventDefault(); $('cr-add')?.click(); } });
    });
    document.querySelectorAll('[data-pick]').forEach((sel) => sel.addEventListener('change', () => {
      const i = +sel.getAttribute('data-pick');
      const m = byId.get(sel.value);
      if (!m) return;
      applyPick(i, m);
      touch(); render();
      document.querySelector(`[data-f="qty"][data-i="${i}"]`)?.focus();
    }));
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const i = +b.getAttribute('data-del');
      const l = P.lines[i];
      if (l.grp) {
        const n = P.lines.filter((x) => x.grp === l.grp).length;
        if (n > 1 && await Utils.showConfirm(`This line is one size of a set (${n} lines). Remove the whole set?`, { title: 'Remove', confirmText: 'Whole set', cancelText: 'Only this size' })) {
          P.lines = P.lines.filter((x) => x.grp !== l.grp);
          touch(); return render();
        }
      }
      P.lines.splice(i, 1);
      touch(); render();
    }));
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => lineModal(+b.getAttribute('data-edit'))));
    document.querySelectorAll('[data-xedit]').forEach((b) => b.addEventListener('click', () => extraModal(+b.getAttribute('data-xedit'))));
    document.querySelectorAll('[data-xdel]').forEach((b) => b.addEventListener('click', () => { P.extras.splice(+b.getAttribute('data-xdel'), 1); touch(); render(); }));
  }

  /* ── Modals ───────────────────────────────────────────────────────── */

  const partFields = (pre, p, title) => `${H.sectionTitle(title)}
    ${H.field(`${pre}-dia`, 'Dia / length', p.dia || '', { type: 'number', step: '0.01', hint: p.unit === 'mm' ? 'mm' : 'inch' })}
    ${H.field(`${pre}-w`, 'Width (rectangle only)', p.w || '', { type: 'number', step: '0.01', hint: 'blank = round circle' })}
    ${H.field(`${pre}-t`, 'Thickness (mm)', p.t || '', { type: 'number', step: '0.01', hint: '1.22 = 18G · 0.91 = 20G · 2.03 = 14G' })}
    ${H.field(`${pre}-wt`, 'Wt per pc (kg)', p.wt || '', { type: 'number', step: '0.001', hint: 'blank = worked out from size' })}`;
  const readPart = (pre, old) => ({
    mode: H.val(`${pre}-mode`) || old.mode, unit: H.val(`${pre}-unit`) || old.unit || 'in',
    dia: Number(H.val(`${pre}-dia`)) || 0, w: Number(H.val(`${pre}-w`)) || 0, t: Number(H.val(`${pre}-t`)) || 0, wt: Number(H.val(`${pre}-wt`)) || 0,
  });

  const MODES = [{ value: 'need', label: 'Order karna hai' }, { value: 'stock', label: 'Stock mein hai (AVAILABLE)' }, { value: 'skip', label: 'Nahi chahiye (skip)' }];

  function lineModal(i) {
    const l = P.lines[i];
    H.openModal({
      id: 'cr-line', title: `Line ${i + 1} — ${l.item || 'item'} ${l.size || ''}`, subtitle: 'Sirf is order ke liye — master nahi badlega', width: 620,
      bodyHTML: H.grid(`
        ${H.field('cl-item', 'Item', l.item)}
        ${H.field('cl-size', 'Size', l.size)}
        ${H.select('cl-b-unit', 'Sizes in', l.body.unit, [{ value: 'in', label: 'Inch' }, { value: 'mm', label: 'mm' }])}
        ${H.field('cl-remark', 'Remark', l.remark)}
        ${H.select('cl-b-mode', 'Body', l.body.mode, MODES)}
        ${H.select('cl-c-mode', 'Cover', l.cover.mode, MODES)}
        ${partFields('cl-b', l.body, 'Body circle')}
        ${partFields('cl-c', l.cover, 'Cover circle (blank = no cover)')}`),
      confirmText: 'Apply',
      onConfirm: async () => {
        l.item = H.val('cl-item').trim(); l.size = H.val('cl-size').trim(); l.remark = H.val('cl-remark').trim();
        l.body = readPart('cl-b', l.body);
        l.cover = { ...readPart('cl-c', l.cover), unit: l.body.unit };
        touch(); H.closeModal('cr-line'); render();
      },
    });
  }

  function extraModal(k) {
    const x = k >= 0 ? P.extras[k] : { note: '', unit: 'in', dia: 0, w: 0, t: 0, kg: 0 };
    H.openModal({
      id: 'cr-x', title: k >= 0 ? 'Edit direct kg' : 'Direct kg', subtitle: 'Material ordered straight by weight — e.g. a 24 x 36 x 20G sheet for kettle covers', width: 560,
      bodyHTML: H.grid(`
        ${H.field('cx-note', 'For', x.note, { placeholder: 'FOR KETTLE COVER', span: 2 })}
        ${H.field('cx-dia', 'Length / dia (inch)', x.dia || '', { type: 'number', step: '0.01' })}
        ${H.field('cx-w', 'Width (inch)', x.w || '', { type: 'number', step: '0.01', hint: 'blank for a circle' })}
        ${H.field('cx-t', 'Thickness (mm)', x.t || '', { type: 'number', step: '0.01', hint: '0.91 = 20G' })}
        ${H.field('cx-kg', 'Kg to order', x.kg || '', { type: 'number', step: '1', required: true })}`),
      confirmText: k >= 0 ? 'Apply' : 'Add',
      onConfirm: async () => {
        const n = { note: H.val('cx-note').trim(), unit: 'in', dia: Number(H.val('cx-dia')) || 0, w: Number(H.val('cx-w')) || 0, t: Number(H.val('cx-t')) || 0, kg: Number(H.val('cx-kg')) || 0 };
        if (!(n.kg > 0)) throw new Error('Enter the kg to order');
        if (k >= 0) P.extras[k] = n; else P.extras.push(n);
        touch(); H.closeModal('cr-x'); render();
      },
    });
  }

  /* Order lines from a paste or an uploaded sheet. Header rows, rows with
     no qty, and the old planning sheets' own COVER rows are skipped — covers
     come with their item. */
  const isCoverRow = (item) => { const w = norm(item).split(' '); return w[0] === 'COVER' || (w.length === 2 && w[1] === 'COVER'); };
  function addRows(rows) {
    let found = 0, missing = 0, covers = 0;
    for (const r of rows) {
      const item = String(r.item ?? '').trim();
      const size = String(r.size ?? '').trim();
      const qty = String(r.qty ?? '').replace(/,/g, '').trim();
      if (!item || /^item/i.test(item) || !(Number(qty) > 0)) continue;
      const l = blankLine(String(r.order_no ?? '').trim());
      l.item = item; l.size = size; l.qty = qty;
      if (r.circle) {
        // The sheet says which circle: use it as it stands.
        l.src = 'file';
        l.body = { mode: r.stock ? 'stock' : 'need', ...r.circle, wt: r.wt || 0 };
        l.cover = { ...emptyPart(), mode: 'skip' };
        P.lines.push(l);
        found++;
        continue;
      }
      if (isCoverRow(item)) { covers++; continue; }
      P.lines.push(l);
      const m = findMaster(item, size);
      if (m) {
        const at = P.lines.length - 1;
        const n = applyPick(at, m);
        // Matched by words, not exactly: say what it was entered as.
        if (m._guess) for (let k = at; k < at + n; k++) P.lines[k].pasted = item;
        found++;
      } else missing++;
    }
    touch(); render();
    return { found, missing, covers };
  }
  function doneToast({ found, missing, covers }) {
    const extra = covers ? ` · ${covers} COVER rows skipped (covers come with the item)` : '';
    if (P.lines.some((l) => l.src === 'file')) { H.toast(`${found} lines added with the circle sizes from the file`, 'success'); return; }
    if (!found && !missing) H.toast('No item lines with a qty were found' + extra, 'error');
    else H.toast(missing ? `${found} matched, ${missing} not in master (orange) — pick by hand${extra}` : `${found} lines added${extra}`, missing ? 'warning' : 'success');
  }

  async function loadXlsx() {
    if (window.XLSX) return;
    await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = '/vendor/xlsx.full.min.js'; sc.onload = ok; sc.onerror = () => no(new Error('Could not load the Excel library')); document.head.appendChild(sc); });
  }

  // Columns are found by their heading (Order No / Item / Size / Qty or
  // Quantity) in the first rows of the first sheet that has them; a sheet
  // without headings is read as Order No, Item, Size, Qty.
  // "10 X 18G", "13.75 X 17 X 18G", "360 X 410 X 4MM", "7.5 X 20" (= 20G).
  function parseCircle(text) {
    const parts = String(text || '').toUpperCase().replace(/SWG/g, 'G').split(/\s*[X×*]\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return null;
    const last = parts.pop();
    let t = 0, unit = 'in';
    const g = /^(\d+(?:\.\d+)?)\s*G?$/.exec(last);
    const mm = /^(\d+(?:\.\d+)?)\s*MM$/.exec(last);
    if (mm) { t = +mm[1]; if (parts.some((x) => /MM$/.test(x))) unit = 'mm'; }
    else if (g) { const row = SWG.find(([, n]) => n === +g[1]); if (!row) return null; t = row[0]; }
    else return null;
    const n = parts.map((x) => parseFloat(x));
    if (n.some((x) => !(x > 0))) return null;
    return { unit, dia: n[0], w: n[1] || 0, t };
  }

  async function uploadExcel(file) {
    try {
      await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      let rows = null;
      for (const name of wb.SheetNames) {
        const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        const hi = grid.slice(0, 15).findIndex((r) => r.some((c) => /item/i.test(c)) && r.some((c) => /qty|quantity/i.test(c)));
        if (hi < 0) continue;
        const h = grid[hi].map((c) => String(c).trim());
        const col = (re) => h.findIndex((c) => re.test(c));
        const C = { order_no: col(/order/i), item: col(/item/i), size: col(/^size/i), qty: col(/qty|quantity/i),
          circle: col(/circle/i), wt: col(/per\s*pc|pc\s*wt/i), remark: col(/remark/i) };
        rows = grid.slice(hi + 1).map((r) => ({
          order_no: C.order_no >= 0 ? r[C.order_no] : '', item: r[C.item], size: C.size >= 0 ? r[C.size] : '', qty: r[C.qty],
          circle: C.circle >= 0 ? parseCircle(r[C.circle]) : null, wt: C.wt >= 0 ? Number(String(r[C.wt]).replace(/,/g, '')) || 0 : 0,
          stock: C.remark >= 0 && /AVAIL|STOCK/i.test(r[C.remark] || ''),
        }));
        break;
      }
      if (!rows) {
        const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
        rows = grid.map((r) => { const [order_no, item, size, qty] = r.length >= 4 ? r : ['', ...r]; return { order_no, item, size, qty }; });
      }
      if (!P.title) {
        const orders = [...new Set(rows.map((r) => String(r.order_no || '').trim()).filter(Boolean))];
        if (orders.length && orders.length <= 6) P.title = orders.join(', ');
      }
      doneToast(addRows(rows));
    } catch (e) { H.fail(e); }
  }

  function pasteModal() {
    H.openModal({
      id: 'cr-paste-m', title: 'Paste lines from Excel', width: 640,
      subtitle: 'Copy the columns Order No · Item · Size · Qty (or just Item · Size · Qty) and paste below. Covers come automatically — paste the items only.',
      bodyHTML: `${H.textarea('cp-text', 'Rows', '', { rows: 12, placeholder: 'P00664\tKETTLE ( S SPOUT )\t10\t2400\nP00664\tDEGDA\t12\t120' })}
        <div style="font-size:11.5px;color:#94a3b8;margin-top:8px;">Item names are matched to the master by their words; anything not found is added in orange to pick by hand.</div>`,
      confirmText: 'Add lines',
      onConfirm: async () => {
        const text = H.val('cp-text');
        const rows = text.split(/\r?\n/).map((r) => r.split('\t').map((c) => c.trim())).filter((r) => r.some(Boolean));
        if (!rows.length) throw new Error('Paste at least one row');
        const out = addRows(rows.map((r) => { const [order_no, item, size, qty] = r.length >= 4 ? r : ['', ...r]; return { order_no, item, size, qty }; }));
        H.closeModal('cr-paste-m');
        doneToast(out);
      },
    });
  }

  /* ── Save / export / print ────────────────────────────────────────── */

  async function savePlan(btn) {
    readSettings();
    if (!P.title) { H.toast('Give the plan a title (e.g. the order nos.)', 'error'); $('cr-title')?.focus(); return; }
    btn.disabled = true;
    try {
      const r = await H.post(`${BASE}/plans`, P);
      P.id = r.id; dirty = false; plans = null;
      H.toast(`Saved as ${r.id}`);
      render();
    } catch (e) { btn.disabled = false; H.fail(e); }
  }

  async function openPlan(id) {
    if (dirty && !(await Utils.showConfirm('Discard the changes to the current plan?', { title: 'Open plan', confirmText: 'Discard' }))) return;
    try {
      const d = await H.api(`${BASE}/plans/${encodeURIComponent(id)}`);
      P = { id: d.id, title: d.title, ...blankPlan(), ...d.data, id: d.id, title: d.title };
      P.lines = (P.lines || []).map((l) => ({ ...blankLine(), ...l }));
      dirty = false; _tab = 'plan'; render();
    } catch (e) { H.fail(e); }
  }

  function sheetRows() {
    const R = calc();
    const pct = Number(P.extra_pct) || 0;
    const head = ['SR NO.', 'ORDER NO.', 'ITEM NAME', 'SIZE', 'SWG', 'CIRCLE SIZE', 'QUANTITY', 'PER PC WT.', 'TOTAL WEIGHT (KGS)', `${pct}% ADD+R.OFF`, 'REMARK'];
    const detail = R.rows.map((r, k) => [k + 1, r.order_no || '', r.item, r.size, r.t || '', r.label, r.qty || '', r.wt ? Number(kg3(r.wt)) : '', r.kg ? Number(kg3(r.kg)) : '', r.req || '', r.remark || '']);
    const r2 = (n) => Math.round(n * 100) / 100;
    const summary = [['GAUGE', 'CIRCLE SIZE', 'NO. OF LINES', 'TOTAL QTY (PCS)', 'TOTAL WT (KG)', `FINAL WT (${pct}% ADD+R.OFF)`, 'USED FOR']];
    const all = { n: 0, qty: 0, net: 0 };
    for (const g of R.summary) {
      const gName = gaugeOf(g.t);
      summary.push([`${gaugeLong(g.t).toUpperCase()}`]);
      const sub = { n: 0, qty: 0, net: 0 };
      g.items.forEach((it) => {
        summary.push([gName, it.label, it.n, it.qty, r2(it.net), it.kg, [...it.used].sort().join(', ')]);
        sub.n += it.n; sub.qty += it.qty; sub.net += it.net;
      });
      summary.push([`Sub-total ${gName}`, '', sub.n, sub.qty, r2(sub.net), g.total], []);
      all.n += sub.n; all.qty += sub.qty; all.net += sub.net;
    }
    summary.push(['GRAND TOTAL', '', all.n, all.qty, r2(all.net), R.order]);
    return { R, head, detail, summary };
  }

  async function exportExcel() {
    readSettings();
    const { R, head, detail, summary } = sheetRows();
    if (!R.rows.length) { H.toast('Nothing to export yet', 'error'); return; }
    try {
      await loadXlsx();
      const title = (P.title || 'CIRCLE REQUIREMENT').toUpperCase();
      const ws1 = XLSX.utils.aoa_to_sheet([[`${title} — CIRCLE REQUIREMENT`], [], head, ...detail]);
      ws1['!cols'] = [6, 11, 34, 10, 7, 18, 10, 10, 14, 14, 14].map((w) => ({ wch: w }));
      const ws2 = XLSX.utils.aoa_to_sheet([[`${title} — SUMMARY (KGS)`], [], ...summary]);
      ws2['!cols'] = [12, 20, 12, 15, 14, 22, 60].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Requirement');
      XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
      XLSX.writeFile(wb, `${(P.title || 'Circle requirement').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - circle requirement.xlsx`);
    } catch (e) { H.fail(e); }
  }

  /* ── Saved plans tab ──────────────────────────────────────────────── */

  function plansTab() {
    if (!plans) return H.spinner();
    return H.table(
      ['Plan', 'Title', { label: 'Lines', align: 'right' }, 'Created by', 'Updated', { label: '', m: 'actions' }],
      plans.map((p) => [`<b>${esc(p.id)}</b>`, esc(p.title), p.lines, esc(p.created_by || ''), esc(H.fmtDate((p.updated_at || '').slice(0, 10))),
        `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn-secondary btn-sm" data-open="${esc(p.id)}">Open</button>
         <button class="btn-secondary btn-sm" data-copy="${esc(p.id)}" title="Start a new plan from this one">Copy</button>
         <button class="btn-secondary btn-sm" data-pdel="${esc(p.id)}" style="color:#dc2626;">Delete</button></div>`]),
      { empty: 'No saved plans yet', cards: true });
  }

  function bindPlans() {
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPlan(b.getAttribute('data-open'))));
    document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      await openPlan(b.getAttribute('data-copy'));
      if (_tab !== 'plan') return;
      P.id = ''; P.title = `${P.title} (copy)`; dirty = true; render();
    }));
    document.querySelectorAll('[data-pdel]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-pdel');
      if (!(await Utils.showConfirm(`Delete plan ${id}?`, { title: 'Delete plan', confirmText: 'Delete', danger: true }))) return;
      try {
        await H.del(`${BASE}/plans/${encodeURIComponent(id)}`);
        if (P.id === id) { P = blankPlan(); dirty = false; }
        await loadPlans(); render();
      } catch (e) { H.fail(e); }
    }));
  }

  /* ── Master tab ───────────────────────────────────────────────────── */

  const circ = (r, which) => {
    const p = partFrom(r, which);
    const lab = circleLabel(p);
    return lab ? `${esc(lab)}<div class="cr-sub">${kg3(wtOf(p))} kg${p.wt > 0 ? '' : ' (calc)'}</div>` : '<span style="color:#cbd5e1;">—</span>';
  };

  function masterTab() {
    const qn = norm(_mf.q);
    const tops = M.filter((r) => r.kind !== 'part');
    const show = tops.filter((r) => (_mf.kind === 'All' || r.kind === _mf.kind.toLowerCase())
      && (!qn || norm(`${r.item} ${r.size} ${r.code}`).includes(qn)));
    const rows = [];
    for (const r of show) {
      const parts = r.kind === 'set' ? partsOf(r.id) : [];
      const tag = r.kind === 'set' ? H.pill(parts.length ? `set · ${parts.length} sizes` : 'set · no sizes', parts.length ? 'info' : 'warning') : '';
      rows.push([esc(r.code || ''), `<b>${esc(r.item)}</b> ${tag}`, esc(r.size), esc(r.swg || ''), r.kind === 'set' ? '' : circ(r, 'body'), r.kind === 'set' ? '' : circ(r, 'cover'),
        manage ? `<div style="display:flex;gap:6px;justify-content:flex-end;">${r.kind === 'set' ? `<button class="btn-secondary btn-sm" data-madd="${esc(r.id)}">+ Size</button>` : ''}
          <button class="btn-secondary btn-sm" data-medit="${esc(r.id)}">Edit</button><button class="btn-secondary btn-sm" data-mdel="${esc(r.id)}" style="color:#dc2626;">✕</button></div>` : '']);
      for (const p of parts) {
        rows.push(['', `<span style="color:#94a3b8;padding-left:14px;">↳ size ${esc(p.size)}</span>${p.auto ? ' ' + H.pill('auto — check', 'warning') : ''}`, esc(p.size), '', circ(p, 'body'), circ(p, 'cover'),
          manage ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn-secondary btn-sm" data-medit="${esc(p.id)}">Edit</button><button class="btn-secondary btn-sm" data-mdel="${esc(p.id)}" style="color:#dc2626;">✕</button></div>` : '']);
      }
    }
    const tools = manage ? `<div class="cr-card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button id="cm-import" class="btn-primary btn-sm">Import from master sheet</button>
        <label class="btn-secondary btn-sm" style="cursor:pointer;">Upload master .xlsx<input id="cm-file" type="file" accept=".xlsx,.xls" style="display:none;"></label>
        <button id="cm-add" class="btn-secondary btn-sm">+ Add item / set</button>
        <span id="cm-out" style="font-size:12px;color:#64748b;"></span>
        <div style="flex-basis:100%;font-size:11.5px;color:#94a3b8;">Import reads “MASTER DATA SAIF PLUS” from Drive (or the file you upload) and updates matching rows by code + size; rows added here are kept. Sets the sheet has no sizes for get them from the same size in another set — marked “auto — check”.</div>
      </div>` : '';
    return `${tools}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="cm-q" value="${esc(_mf.q)}" placeholder="Search item, size or code…" style="flex:1;min-width:200px;max-width:360px;padding:8px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;">
        <select id="cm-kind" style="padding:8px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;">${['All', 'Item', 'Set'].map((k) => `<option${k === _mf.kind ? ' selected' : ''}>${k}</option>`).join('')}</select>
      </div>
      ${H.table(['Code', 'Item', 'Size', 'SWG', 'Body circle', 'Cover circle', { label: '', m: 'actions' }], rows, { empty: M.length ? 'Nothing matches' : 'The master is empty — import the master sheet', maxHeight: '640px' })}`;
  }

  function bindMaster() {
    $('cm-q')?.addEventListener('input', (e) => {
      _mf.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const n = $('cm-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    });
    $('cm-kind')?.addEventListener('change', (e) => { _mf.kind = e.target.value; render(); });
    $('cm-import')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true; btn.textContent = 'Importing…';
      try { importDone(await H.post(`${BASE}/master/import`)); }
      catch (err) { H.fail(err); btn.disabled = false; btn.textContent = 'Import from master sheet'; }
    });
    $('cm-file')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = async () => {
        $('cm-out').textContent = 'Uploading…';
        try { importDone(await H.post(`${BASE}/master/upload`, { name: f.name, file: rd.result })); }
        catch (err) { $('cm-out').textContent = ''; H.fail(err); }
      };
      rd.readAsDataURL(f);
    });
    $('cm-add')?.addEventListener('click', () => masterModal(null));
    document.querySelectorAll('[data-medit]').forEach((b) => b.addEventListener('click', () => masterModal(byId.get(b.getAttribute('data-medit')))));
    document.querySelectorAll('[data-madd]').forEach((b) => b.addEventListener('click', () => {
      const set = byId.get(b.getAttribute('data-madd'));
      masterModal({ kind: 'part', parent_id: set.id, item: set.item, size: '', unit: 'in', swg: set.swg });
    }));
    document.querySelectorAll('[data-mdel]').forEach((b) => b.addEventListener('click', async () => {
      const r = byId.get(b.getAttribute('data-mdel'));
      const n = partsOf(r.id).length;
      if (!(await Utils.showConfirm(`Delete ${r.item} ${r.size} from the master${n ? ` with its ${n} sizes` : ''}? Saved plans keep their own copy of the circles.`, { title: 'Delete', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(`${BASE}/master/${encodeURIComponent(r.id)}`); await loadMaster(); render(); } catch (e) { H.fail(e); }
    }));
  }

  async function importDone(r) {
    await loadMaster();
    render();
    const msg = `${r.added} new, ${r.updated} updated${r.kept ? `, ${r.kept} ERP-only kept` : ''} (sheet “${r.sheet}”)${r.derived ? ` · ${r.derived} set sizes filled in automatically — marked “auto — check”` : ''}`;
    const out = $('cm-out'); if (out) out.textContent = msg;
    H.toast('Master imported');
  }

  function masterModal(r, onSaved) {
    const isNew = !r || !r.id;
    const m = { kind: 'item', unit: 'in', ...(r || {}) };
    const isPart = m.kind === 'part';
    const parent = isPart ? byId.get(m.parent_id) : null;
    const pf = (which, title) => `${H.sectionTitle(title)}
      ${H.field(`mm-${which}-dia`, 'Dia / length', m[`${which}_dia`] || '', { type: 'number', step: '0.01' })}
      ${H.field(`mm-${which}-w`, 'Width (rectangle)', m[`${which}_w`] || '', { type: 'number', step: '0.01', hint: 'blank = round' })}
      ${H.field(`mm-${which}-t`, 'Thickness (mm)', m[`${which}_t`] || '', { type: 'number', step: '0.01' })}
      ${H.field(`mm-${which}-wt`, 'Wt per pc (kg)', m[`${which}_wt`] || '', { type: 'number', step: '0.001', hint: 'blank = worked out' })}`;
    H.openModal({
      id: 'cr-m', width: 640,
      title: isNew ? (isPart ? `Add a size to ${parent?.item} ${parent?.size}` : 'Add to master') : `Edit ${m.item} ${m.size}`,
      bodyHTML: H.grid(`
        ${isPart ? '' : H.select('mm-kind', 'Type', m.kind, [{ value: 'item', label: 'Item (own circles)' }, { value: 'set', label: 'Set (sizes added separately)' }])}
        ${isPart ? '' : H.field('mm-item', 'Item name', m.item, { required: true })}
        ${H.field('mm-size', 'Size', m.size, { required: true })}
        ${isPart ? '' : H.field('mm-code', 'Product code', m.code)}
        ${H.field('mm-swg', 'SWG (as written)', m.swg, { placeholder: '1.22' })}
        ${H.select('mm-unit', 'Sizes in', m.unit, [{ value: 'in', label: 'Inch' }, { value: 'mm', label: 'mm' }])}
        ${H.field('mm-remarks', 'Remarks', m.remarks, { span: 2 })}
        ${pf('body', 'Body circle')}
        ${pf('cover', 'Cover circle (blank = none)')}`),
      onConfirm: async () => {
        const n = (id) => Number(H.val(id)) || 0;
        const body = {
          id: isNew ? '' : m.id, kind: isPart ? 'part' : H.val('mm-kind'), parent_id: m.parent_id || '',
          item: isPart ? m.item : H.val('mm-item').trim(), size: H.val('mm-size').trim(), code: isPart ? '' : H.val('mm-code').trim(),
          swg: H.val('mm-swg').trim(), unit: H.val('mm-unit'), remarks: H.val('mm-remarks').trim(), pcs_box: m.pcs_box, net_wt: m.net_wt,
          body_dia: n('mm-body-dia'), body_w: n('mm-body-w'), body_t: n('mm-body-t'), body_wt: n('mm-body-wt'),
          cover_dia: n('mm-cover-dia'), cover_w: n('mm-cover-w'), cover_t: n('mm-cover-t'), cover_wt: n('mm-cover-wt'),
          auto: false,
        };
        // Store the worked-out weight so the master reads like the sheet.
        for (const w of ['body', 'cover']) if (!body[`${w}_wt`]) body[`${w}_wt`] = formulaWt({ unit: body.unit, dia: body[`${w}_dia`], w: body[`${w}_w`], t: body[`${w}_t`] });
        const res = await H.post(`${BASE}/master`, body);
        H.closeModal('cr-m');
        await loadMaster();
        if (onSaved) onSaved(res.id);
        render();
        H.toast('Master saved');
      },
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Circle Requirement…');
      try {
        await loadMaster();
        if (!M.length && manage) _tab = 'master';
        render();
      } catch (e) { if (el) el.innerHTML = H.empty('Could not load Circle Requirement', e.message); }
    },
  };
})();
