/* =====================================================================
   Production Norms — piece-rate norms per department, the daily
   production booked against them, and the worker-wise report.
   Server side: backend/production-norms.js (/api/production-norms/*).

   Was the "PRODUCTION NORMS ..." workbooks: item, size, pieces in 8
   hours, day rate, per-piece rate = day rate / pieces. Here those are the
   Norms tab (imported from the same workbooks), and a day sheet per
   department books each worker's pieces: target for the hours worked,
   efficiency %, and the amount at the per-piece rate.

   Built on window.HR (hr-common.js) like Circle Requirement.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['production-norms'] = (() => {
  const H = window.HR;
  const esc = H.esc;
  const BASE = '/api/production-norms';

  let N = [];            // norm rows
  let byId = new Map();
  let manage = false;
  let workerNames = [];  // suggestions: past entries + HR employees + norm operators
  let _tab = 'entry';
  const today = () => H.todayISO();
  const monthStart = () => today().slice(0, 8) + '01';

  const D = { date: today(), dept: '', lines: [], loaded: '', dirty: false };   // day sheet
  const R = { from: monthStart(), to: today(), dept: '', q: '', lines: null, worker: '' };  // report
  const F = { dept: '', q: '' };   // norms filter

  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const n0 = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
  const rs = (n) => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rate = (n) => (Number(n) || 0).toFixed(3).replace(/0$/, '');
  const effPill = (e) => {
    if (!(e > 0)) return '<span style="color:#cbd5e1;">—</span>';
    const c = e >= 100 ? '#16a34a' : e >= 80 ? '#d97706' : '#dc2626';
    return `<b style="color:${c};">${Math.round(e)}%</b>`;
  };
  const pcRateOf = (m) => (m.norm_pcs > 0 && m.day_rate > 0 ? m.day_rate / m.norm_pcs : Number(m.pc_rate) || 0);

  const depts = () => [...new Set(N.map((r) => r.dept))];

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function loadNorms() {
    const d = await H.api(`${BASE}/norms`);
    N = d.norms || [];
    manage = !!d.manage;
    byId = new Map(N.map((r) => [r.id, r]));
    const names = new Set([...(d.workers || []), ...N.map((r) => r.worker)].filter(Boolean));
    try {
      const hr = await H.api('/api/hr/masters');
      (hr.employees || []).forEach((e) => { if (e?.name && !/inactive|exit|left/i.test(e.status || '')) names.add(String(e.name).toUpperCase()); });
    } catch { /* HR not set up here — past entries are enough */ }
    workerNames = [...names].sort();
    if (!D.dept || !depts().includes(D.dept)) D.dept = depts()[0] || '';
  }

  /* ── Matching a line to its norm ──────────────────────────────────── */

  // Rows of this department for an item. Where the norms keep an operator's
  // own rate (Rolling & cutting, Pressing), that operator gets those; anyone
  // else gets the general rows, or — if there are none — every operator's.
  function candidates(item, worker) {
    const all = N.filter((r) => r.dept === D.dept && norm(r.item) === norm(item));
    const own = all.filter((r) => r.worker && norm(r.worker) === norm(worker));
    if (own.length) return own;
    const gen = all.filter((r) => !r.worker);
    return gen.length ? gen : all;
  }
  const itemsOf = (dept) => [...new Set(N.filter((r) => r.dept === dept).map((r) => r.item))];

  function applyNorm(l, m) {
    // No norm = time work: a ₹/day typed on the line itself survives a
    // worker or item change; one carried over from a norm does not.
    if (!m) { Object.assign(l, { day_rate: l.norm_id ? 0 : (l.day_rate || 0), norm_id: '', norm_pcs: 0, norm_hours: 8, pc_rate: 0, section: '' }); return; }
    Object.assign(l, {
      norm_id: m.id, item: m.item, size: m.size, section: m.section || '',
      norm_pcs: Number(m.norm_pcs) || 0, norm_hours: Number(m.hours) || 8, day_rate: Number(m.day_rate) || 0, pc_rate: pcRateOf(m),
    });
    if (!l.hours) l.hours = Number(m.hours) || 8;
  }
  // After the worker or item changes: keep the same size if the new set of
  // rows has it, take the only row if there is one, else leave it to pick.
  function resolve(l) {
    const c = candidates(l.item, l.worker);
    const same = c.find((r) => norm(r.size) === norm(l.size)) || (c.length === 1 ? c[0] : null);
    applyNorm(l, same);
    if (!same) l.size = c.some((r) => norm(r.size) === norm(l.size)) ? l.size : '';
  }

  const blankLine = (worker = '') => ({ worker, item: '', size: '', hours: '', qty: '', remark: '', norm_id: '', norm_pcs: 0, norm_hours: 8, day_rate: 0, pc_rate: 0, section: '' });
  const lineCalc = (l) => {
    const hours = Number(l.hours) || Number(l.norm_hours) || 8;
    const target = l.norm_pcs ? l.norm_pcs * hours / (l.norm_hours || 8) : 0;
    const qty = Number(l.qty) || 0;
    // Time work (no norm): paid for the hours at the day rate of 8 hours.
    const amount = l.norm_id ? qty * (Number(l.pc_rate) || 0) : (Number(l.day_rate) || 0) * hours / 8;
    return { target, eff: target ? qty / target * 100 : 0, amount };
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const tabs = [
      { key: 'entry', label: 'Daily Entry' },
      { key: 'report', label: 'Report' },
      { key: 'norms', label: 'Norms', count: N.length },
    ];
    const body = { entry: entryTab, report: reportTab, norms: normsTab }[_tab]();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        .pn-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px; }
        .pn-grid { width:100%;border-collapse:collapse;min-width:980px; }
        .pn-grid th { padding:8px 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:#64748b;text-align:left;background:#f8fafc;border-bottom:1px solid #e2e8f0;white-space:nowrap; }
        .pn-grid td { padding:5px 6px;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#334155;vertical-align:middle; }
        .pn-grid input, .pn-grid select { width:100%;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:7px;font-size:12.5px;box-sizing:border-box;background:#fff;font-family:inherit; }
        .pn-grid input:focus, .pn-grid select:focus { border-color:var(--color-primary);outline:none; }
        .pn-grid .num { text-align:right;white-space:nowrap; }
        .pn-sub { font-size:11px;color:#94a3b8;white-space:nowrap; }
        .pn-ico { border:none;background:#f1f5f9;border-radius:7px;width:28px;height:28px;cursor:pointer;color:#475569;font-size:14px; }
        .pn-ico:hover { background:#e2e8f0; }
        .pn-bar { display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px; }
        .pn-bar label { display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px; }
        .pn-bar input, .pn-bar select { padding:8px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fff;font-family:inherit; }
        .pn-tot { display:flex;gap:18px;flex-wrap:wrap;align-items:baseline;padding:10px 16px;border-top:1px solid #f1f5f9;font-size:12.5px;color:#64748b; }
        .pn-tot b { color:#0f172a;font-size:15px; }
        tr.pn-pick td { cursor:pointer; }
        tr.pn-pick:hover td { background:#f8fafc; }
      </style>
      ${H.header('Production Norms', 'Department ke norms, roz ka production aur worker-wise kamaai',
        _tab === 'entry' && N.length ? '<button id="pn-save" class="btn-primary btn-sm">Save day</button>'
          : _tab === 'report' && R.lines?.length ? '<button id="pr-xls" class="btn-secondary btn-sm">Excel</button>'
            : _tab === 'norms' && N.length ? '<button id="pnm-xls" class="btn-secondary btn-sm">Excel</button>' : '')}
      ${H.tabs('pn', tabs, _tab)}
      ${body}
    </div>`;
    bind();
  }

  /* ── Daily entry tab ──────────────────────────────────────────────── */

  function entryTab() {
    if (!N.length) {
      return H.empty('Norms abhi khaali hain', manage
        ? 'Norms tab kholo aur “Upload norms Excel” se PRODUCTION NORMS wali files daalo.'
        : 'Admin se kaho ki Norms tab mein norms ki Excel upload kare.');
    }
    const rows = D.lines.map((l, i) => {
      const c = candidates(l.item, l.worker);
      const c2 = lineCalc(l);
      const known = itemsOf(D.dept).some((x) => norm(x) === norm(l.item));
      const sizeCtl = c.length
        ? `<select data-size="${i}"><option value="">${c.length > 1 ? 'size…' : ''}</option>
            ${c.map((r) => `<option value="${esc(r.id)}"${r.id === l.norm_id ? ' selected' : ''}>${esc(r.size || 'ALL')}${r.worker && norm(r.worker) !== norm(l.worker) ? ` · ${esc(r.worker)} rate` : ''}</option>`).join('')}</select>`
        : `<input data-f="size" data-i="${i}" value="${esc(l.size)}" placeholder="size" />`;
      const timeWork = l.item && !l.norm_id && (!known || !c.length);
      const warn = timeWork ? '<div class="pn-sub" style="color:#2563eb;">norm nahi — time work: hours + ₹/day bharo</div>'
        : l.item && !l.norm_id ? '<div class="pn-sub" style="color:#d97706;">size chuno</div>'
          : l.section ? `<div class="pn-sub">${esc(l.section)}</div>` : '';
      return `<tr>
        <td style="width:26px;color:#94a3b8;">${i + 1}</td>
        <td style="min-width:150px;"><input data-f="worker" data-i="${i}" value="${esc(l.worker)}" list="pn-workers" placeholder="naam type karo" title="List mein na ho to bhi naam type kar do — save hone ke baad list mein aa jayega" /></td>
        <td style="min-width:230px;"><input data-f="item" data-i="${i}" value="${esc(l.item)}" list="pn-items" placeholder="item…" />${warn}</td>
        <td style="width:130px;">${sizeCtl}</td>
        <td style="width:66px;"><input data-f="hours" data-i="${i}" value="${esc(l.hours)}" type="number" min="0" max="24" step="0.5" placeholder="${l.norm_hours || 8}" title="Ghante kaam kiya" /></td>
        <td style="width:84px;"><input data-f="qty" data-i="${i}" value="${esc(l.qty)}" type="number" min="0" step="1" placeholder="0" /></td>
        <td class="num" data-c="target-${i}">${c2.target ? n0(c2.target) : '—'}</td>
        <td class="num" data-c="eff-${i}">${effPill(c2.eff)}</td>
        <td class="num">${timeWork
          ? `<input data-f="day_rate" data-i="${i}" value="${esc(l.day_rate || '')}" type="number" min="0" step="1" placeholder="₹/day" title="Time work: 8 ghante ka rate" style="width:84px;text-align:right;" />`
          : `${l.pc_rate ? rate(l.pc_rate) : '—'}${l.day_rate ? `<div class="pn-sub">₹${n0(l.day_rate)}/day</div>` : ''}`}</td>
        <td class="num" data-c="amt-${i}"><b>${c2.amount ? rs(c2.amount) : '—'}</b></td>
        <td style="width:36px;"><button class="pn-ico" data-del="${i}" title="Line hatao">✕</button></td>
      </tr>`;
    }).join('');

    return `
      <div class="pn-bar">
        <div><label>Date</label><input id="pn-date" type="date" value="${esc(D.date)}" max="${today()}"></div>
        <div><label>Department</label><select id="pn-dept">${depts().map((d) => `<option${d === D.dept ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
        <span style="flex:1;"></span>
        <button id="pn-prev" class="btn-secondary btn-sm" title="Pichhle din ke workers aur items (qty khaali)">Copy last day</button>
      </div>
      <div class="pn-card" style="padding:0;overflow:hidden;">
        <div style="overflow-x:auto;">
          <table class="pn-grid">
            <thead><tr><th>#</th><th>Worker</th><th>Item</th><th>Size</th><th>Hours</th><th>Qty (pcs)</th><th class="num">Target</th><th class="num">Eff.</th><th class="num">Rate / pc</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="11" style="padding:34px;text-align:center;color:#94a3b8;">“+ Line” dabao — worker, item, size aur qty daalo. Target, efficiency aur amount apne aap.</td></tr>`}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;padding:10px 16px;border-top:1px solid #f1f5f9;"><button id="pn-add" class="btn-primary btn-sm">+ Line</button></div>
        <div class="pn-tot" id="pn-tot"></div>
        <datalist id="pn-workers">${workerNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <datalist id="pn-items">${itemsOf(D.dept).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </div>
      <div id="pn-wsum"></div>`;
  }

  function refreshTotals() {
    let qty = 0, amt = 0;
    const per = new Map();
    D.lines.forEach((l, i) => {
      const c = lineCalc(l);
      qty += Number(l.qty) || 0; amt += c.amount;
      const t = document.querySelector(`[data-c="target-${i}"]`); if (t) t.textContent = c.target ? n0(c.target) : '—';
      const e = document.querySelector(`[data-c="eff-${i}"]`); if (e) e.innerHTML = effPill(c.eff);
      const a = document.querySelector(`[data-c="amt-${i}"]`); if (a) a.innerHTML = `<b>${c.amount ? rs(c.amount) : '—'}</b>`;
      if (!l.worker) return;
      const w = per.get(l.worker) || { qty: 0, amt: 0, target: 0, items: 0 };
      w.qty += Number(l.qty) || 0; w.amt += c.amount; w.items++;
      // Day efficiency = pcs made / the sum of each line's own target.
      w.target += c.target;
      per.set(l.worker, w);
    });
    const tot = document.getElementById('pn-tot');
    if (tot) tot.innerHTML = `<span>Lines <b>${D.lines.length}</b></span><span>Pcs <b>${n0(qty)}</b></span><span>Amount <b>${rs(amt)}</b></span>${D.dirty ? '<span style="color:#d97706;">● save nahi hua</span>' : D.loaded ? '<span style="color:#16a34a;">✓ saved</span>' : ''}`;
    const ws = document.getElementById('pn-wsum');
    if (ws) {
      ws.innerHTML = per.size > 1 ? H.table(['Worker', { label: 'Lines', align: 'right' }, { label: 'Pcs', align: 'right' }, { label: 'Target', align: 'right' }, { label: 'Eff.', align: 'right' }, { label: 'Amount', align: 'right' }],
        [...per.entries()].map(([w, x]) => [`<b>${esc(w)}</b>`, x.items, n0(x.qty), x.target ? n0(x.target) : '—', effPill(x.target ? x.qty / x.target * 100 : 0), `<b>${rs(x.amt)}</b>`]), { cards: true }) : '';
    }
  }

  async function loadDay() {
    try {
      const d = await H.api(`${BASE}/day?date=${encodeURIComponent(D.date)}&dept=${encodeURIComponent(D.dept)}`);
      D.lines = (d.lines || []).map((l) => ({ ...blankLine(), ...l, hours: l.hours === (l.norm_hours || 8) ? '' : l.hours }));
      D.loaded = d.lines?.length ? `${D.date}|${D.dept}` : '';
      D.dirty = false;
    } catch (e) { H.fail(e); }
  }

  async function confirmLeave() {
    return !D.dirty || Utils.showConfirm('Is din ki entry save nahi hui. Chhod dein?', { title: 'Unsaved', confirmText: 'Chhod do' });
  }

  function bindEntry() {
    if (!N.length) return;
    refreshTotals();
    const $ = (id) => document.getElementById(id);
    $('pn-date')?.addEventListener('change', async (e) => {
      if (!(await confirmLeave())) { e.target.value = D.date; return; }
      D.date = e.target.value || today(); await loadDay(); render();
    });
    $('pn-dept')?.addEventListener('change', async (e) => {
      if (!(await confirmLeave())) { e.target.value = D.dept; return; }
      D.dept = e.target.value; await loadDay(); render();
    });
    $('pn-add')?.addEventListener('click', () => {
      D.lines.push(blankLine(''));
      D.dirty = true; render();
      document.querySelector(`[data-f="worker"][data-i="${D.lines.length - 1}"]`)?.focus();
    });
    $('pn-prev')?.addEventListener('click', copyLastDay);
    $('pn-save')?.addEventListener('click', (e) => saveDay(e.target));

    document.querySelectorAll('[data-f]').forEach((inp) => {
      const i = +inp.getAttribute('data-i');
      const f = inp.getAttribute('data-f');
      const l = D.lines[i];
      if (f === 'worker' || f === 'item') {
        inp.addEventListener('change', () => {
          l[f] = inp.value.trim().toUpperCase();
          resolve(l);
          D.dirty = true; render();
          const next = f === 'worker' ? `[data-f="item"][data-i="${i}"]` : (l.norm_id ? `[data-f="qty"][data-i="${i}"]` : `[data-size="${i}"]`);
          document.querySelector(next)?.focus();
        });
      } else {
        inp.addEventListener('input', () => { l[f] = inp.value; D.dirty = true; refreshTotals(); });
      }
      // Enter in Qty: next line, same worker (one worker, several items).
      if (f === 'qty') inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i === D.lines.length - 1) { D.lines.push(blankLine(l.worker)); D.dirty = true; render(); }
        document.querySelector(`[data-f="item"][data-i="${i + 1}"]`)?.focus();
      });
    });
    document.querySelectorAll('[data-size]').forEach((sel) => sel.addEventListener('change', () => {
      const i = +sel.getAttribute('data-size');
      applyNorm(D.lines[i], byId.get(sel.value));
      D.dirty = true; render();
      document.querySelector(`[data-f="qty"][data-i="${i}"]`)?.focus();
    }));
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      D.lines.splice(+b.getAttribute('data-del'), 1); D.dirty = true; render();
    }));
  }

  // The latest earlier day this department has lines for, within a week.
  async function copyLastDay() {
    if (D.lines.some((l) => l.qty) && !(await Utils.showConfirm('Abhi ki lines hata ke pichhle din ki lines laayein?', { title: 'Copy last day', confirmText: 'Haan' }))) return;
    const d = new Date(D.date + 'T00:00:00');
    const to = new Date(d); to.setDate(d.getDate() - 1);
    const from = new Date(d); from.setDate(d.getDate() - 7);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    try {
      const r = await H.api(`${BASE}/entries?from=${iso(from)}&to=${iso(to)}&dept=${encodeURIComponent(D.dept)}`);
      const lines = r.lines || [];
      if (!lines.length) { H.toast('Pichhle 7 din mein is department ki koi entry nahi', 'error'); return; }
      const last = lines.reduce((m, l) => (l.entry_date > m ? l.entry_date : m), '');
      D.lines = lines.filter((l) => l.entry_date === last).map((l) => {
        const n = { ...blankLine(l.worker), item: l.item, size: l.size };
        // Today's norm, not the copied day's.
        applyNorm(n, byId.get(l.norm_id) || null);
        if (!n.norm_id) resolve(n);
        return n;
      });
      D.dirty = true; render();
      H.toast(`${H.fmtDate(last)} ki ${D.lines.length} lines aa gayi — ab qty bharo`);
    } catch (e) { H.fail(e); }
  }

  async function saveDay(btn) {
    const lines = D.lines.filter((l) => l.worker || l.item || l.qty);
    // A norm line needs its pieces; a time-work line (no norm) only the hours.
    const bad = lines.findIndex((l) => !l.worker || !l.item || (l.norm_id && !(Number(l.qty) > 0)));
    if (bad >= 0) { H.toast(`Line ${D.lines.indexOf(lines[bad]) + 1}: worker, item aur qty teeno chahiye`, 'error'); return; }
    const noRate = lines.filter((l) => !l.norm_id && !(Number(l.day_rate) > 0)).length;
    if (noRate && !(await Utils.showConfirm(`${noRate} time-work line${noRate > 1 ? 's' : ''} (bina norm) mein ₹/day nahi bhara — unka amount ₹0 rahega. Phir bhi save karein?`, { title: 'Rate missing', confirmText: 'Save' }))) return;
    btn.disabled = true;
    try {
      const r = await H.post(`${BASE}/day`, { date: D.date, dept: D.dept, lines: lines.map((l) => ({ ...l, hours: Number(l.hours) || l.norm_hours || 8 })) });
      await loadDay();
      // Names typed today show up in tomorrow's suggestions.
      lines.forEach((l) => { if (!workerNames.includes(l.worker)) workerNames.push(l.worker); });
      R.lines = null;
      H.toast(r.saved ? `${r.saved} lines saved` : 'Is din ki entry hata di');
      render();
    } catch (e) { btn.disabled = false; H.fail(e); }
  }

  /* ── Report tab ───────────────────────────────────────────────────── */

  function reportRows() {
    const q = norm(R.q);
    return (R.lines || []).filter((l) => (!q || norm(l.worker).includes(q)) && (!R.worker || l.worker === R.worker));
  }
  function bySummary(lines) {
    const per = new Map();
    for (const l of lines) {
      const w = per.get(l.worker) || { worker: l.worker, days: new Set(), depts: new Set(), qty: 0, target: 0, amount: 0, lines: 0 };
      w.days.add(l.entry_date); w.depts.add(l.dept);
      w.qty += Number(l.qty) || 0; w.target += Number(l.target) || 0; w.amount += Number(l.amount) || 0; w.lines++;
      per.set(l.worker, w);
    }
    return [...per.values()].sort((a, b) => b.amount - a.amount);
  }

  function reportTab() {
    const bar = `<div class="pn-bar">
        <div><label>From</label><input id="pr-from" type="date" value="${esc(R.from)}"></div>
        <div><label>To</label><input id="pr-to" type="date" value="${esc(R.to)}"></div>
        <div><label>Department</label><select id="pr-dept"><option value="">All</option>${depts().map((d) => `<option${d === R.dept ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
        <div><label>Worker</label><input id="pr-q" value="${esc(R.q)}" placeholder="search…" style="width:160px;"></div>
        <button id="pr-go" class="btn-primary btn-sm">Show</button>
      </div>`;
    if (!R.lines) return bar + H.spinner();
    const lines = reportRows();
    const sum = bySummary(lines);
    // The worker list ignores the clicked worker, so another one can be picked.
    const all = bySummary((R.lines || []).filter((l) => !norm(R.q) || norm(l.worker).includes(norm(R.q))));
    const tq = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const tt = lines.reduce((s, l) => s + (Number(l.target) || 0), 0);
    const ta = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const tiles = H.stats([
      { label: 'Workers', value: sum.length },
      { label: 'Pieces', value: n0(tq) },
      { label: 'Efficiency', value: tt ? `${Math.round(tq / tt * 100)}%` : '—' },
      { label: 'Amount', value: rs(ta) },
    ]);
    const summary = H.table(['Worker', 'Department', { label: 'Days', align: 'right' }, { label: 'Pcs', align: 'right' }, { label: 'Target', align: 'right' }, { label: 'Eff.', align: 'right' }, { label: 'Amount', align: 'right' }],
      all.map((w) => [`<a href="#" data-w="${esc(w.worker)}" style="font-weight:700;color:${R.worker === w.worker ? 'var(--color-primary)' : '#0f172a'};">${esc(w.worker)}</a>`,
        `<span class="pn-sub" style="white-space:normal;">${esc([...w.depts].join(', '))}</span>`, w.days.size, n0(w.qty), w.target ? n0(w.target) : '—',
        effPill(w.target ? w.qty / w.target * 100 : 0), `<b>${rs(w.amount)}</b>`]),
      { empty: 'Is period mein koi entry nahi', cards: true });
    const detail = H.table(['Date', 'Department', 'Worker', 'Item', 'Size', { label: 'Hrs', align: 'right' }, { label: 'Qty', align: 'right' }, { label: 'Target', align: 'right' }, { label: 'Eff.', align: 'right' }, { label: 'Rate/pc', align: 'right' }, { label: 'Amount', align: 'right' }],
      lines.map((l) => [esc(H.fmtDate(l.entry_date)), esc(l.dept), `<b>${esc(l.worker)}</b>`, esc(l.item), esc(l.size || ''), l.hours, n0(l.qty), l.target ? n0(l.target) : '—',
        effPill(l.target ? l.qty / l.target * 100 : 0), l.pc_rate ? rate(l.pc_rate) : '—', rs(l.amount)]),
      { empty: 'Koi line nahi', maxHeight: '560px' });
    return `${bar}${tiles}
      <div class="pn-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <b style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">Worker-wise</b>
        ${R.worker ? `<a href="#" id="pr-clear" style="font-size:12px;color:var(--color-primary);">${esc(R.worker)} ✕ — sab dikhao</a>` : '<span class="pn-sub">naam pe click karo — sirf uski lines</span>'}</div>${summary}</div>
      <details class="pn-card"${R.worker ? ' open' : ''}><summary style="cursor:pointer;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">Line by line (${lines.length})</summary><div style="margin-top:10px;">${detail}</div></details>`;
  }

  async function loadReport() {
    R.lines = null; render();
    try { R.lines = (await H.api(`${BASE}/entries?from=${R.from}&to=${R.to}&dept=${encodeURIComponent(R.dept)}`)).lines || []; }
    catch (e) { R.lines = []; H.fail(e); }
    render();
  }

  function bindReport() {
    const $ = (id) => document.getElementById(id);
    $('pr-go')?.addEventListener('click', () => {
      R.from = $('pr-from').value || monthStart(); R.to = $('pr-to').value || today(); R.dept = $('pr-dept').value; R.q = $('pr-q').value; R.worker = '';
      loadReport();
    });
    $('pr-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pr-go').click(); });
    document.querySelectorAll('[data-w]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); const w = a.getAttribute('data-w'); R.worker = R.worker === w ? '' : w; render();
    }));
    $('pr-clear')?.addEventListener('click', (e) => { e.preventDefault(); R.worker = ''; render(); });
    $('pr-xls')?.addEventListener('click', exportReport);
  }

  async function loadXlsx() {
    if (window.XLSX) return;
    await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = '/vendor/xlsx.full.min.js'; sc.onload = ok; sc.onerror = () => no(new Error('Could not load the Excel library')); document.head.appendChild(sc); });
  }
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const fileSafe = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim();

  async function exportReport() {
    const lines = reportRows();
    if (!lines.length) { H.toast('Export ke liye kuch nahi', 'error'); return; }
    try {
      await loadXlsx();
      const sum = bySummary(lines);
      const title = `PRODUCTION REPORT ${H.fmtDate(R.from)} TO ${H.fmtDate(R.to)}${R.dept ? ` — ${R.dept}` : ''}`;
      const ws1 = XLSX.utils.aoa_to_sheet([[title], [],
        ['WORKER', 'DEPARTMENT', 'DAYS', 'PCS', 'TARGET PCS', 'EFFICIENCY %', 'AMOUNT (Rs.)'],
        ...sum.map((w) => [w.worker, [...w.depts].join(', '), w.days.size, w.qty, Math.round(w.target), w.target ? Math.round(w.qty / w.target * 100) : '', r2(w.amount)]),
        [], ['TOTAL', '', '', sum.reduce((s, w) => s + w.qty, 0), Math.round(sum.reduce((s, w) => s + w.target, 0)), '', r2(sum.reduce((s, w) => s + w.amount, 0))]]);
      ws1['!cols'] = [24, 30, 7, 10, 11, 12, 14].map((w) => ({ wch: w }));
      const ws2 = XLSX.utils.aoa_to_sheet([[title], [],
        ['DATE', 'DEPARTMENT', 'WORKER', 'ITEM', 'SIZE', 'HOURS', 'QTY (PCS)', '8 HRS NORM', 'TARGET', 'EFFICIENCY %', 'RATE PER DAY', 'PER PCS RATE', 'AMOUNT (Rs.)', 'REMARK'],
        ...lines.map((l) => [l.entry_date, l.dept, l.worker, l.item, l.size, l.hours, l.qty, l.norm_pcs || '', l.target ? Math.round(l.target) : '', l.target ? Math.round(l.qty / l.target * 100) : '',
          l.day_rate || '', l.pc_rate ? Math.round(l.pc_rate * 10000) / 10000 : '', r2(l.amount), l.remark || ''])]);
      ws2['!cols'] = [11, 26, 20, 34, 10, 7, 10, 11, 9, 11, 11, 11, 12, 20].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Worker-wise');
      XLSX.utils.book_append_sheet(wb, ws2, 'Detail');
      XLSX.writeFile(wb, fileSafe(`Production report ${R.from} to ${R.to}${R.dept ? ' ' + R.dept : ''}.xlsx`));
    } catch (e) { H.fail(e); }
  }

  /* ── Norms tab ────────────────────────────────────────────────────── */

  function normsShown() {
    const q = norm(F.q);
    return N.filter((r) => (!F.dept || r.dept === F.dept) && (!q || norm(`${r.section} ${r.item} ${r.size} ${r.worker}`).includes(q)));
  }

  function normsTab() {
    const tools = manage ? `<div class="pn-card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <label class="btn-primary btn-sm" style="cursor:pointer;">Upload norms Excel<input id="pnm-file" type="file" accept=".xlsx,.xls" multiple style="display:none;"></label>
        <button id="pnm-add" class="btn-secondary btn-sm">+ Add norm</button>
        <span id="pnm-out" style="font-size:12px;color:#64748b;"></span>
        <div style="flex-basis:100%;font-size:11.5px;color:#94a3b8;">“PRODUCTION NORMS …” wali Excel files (ek ya sab ek saath) chuno. Same department + item + size + worker wali row update hoti hai; yahan add ki hui rows bachi rehti hain. Per pc rate = day rate ÷ 8 hrs norm.</div>
      </div>` : '';
    const shown = normsShown();
    const rows = [];
    let last = '';
    for (const r of shown) {
      const grp = `${r.dept}${r.section ? ' — ' + r.section : ''}${r.worker ? ' — ' + r.worker : ''}`;
      if (grp !== last) {
        rows.push([`<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-primary);">${esc(grp)}</span>`, '', '', '', '', '', '', '']);
        last = grp;
      }
      rows.push([`<b>${esc(r.item)}</b>`, esc(r.size || ''), r.worker ? esc(r.worker) : '<span class="pn-sub">sab</span>',
        r.norm_pcs ? `${n0(r.norm_pcs)}${r.hours && r.hours !== 8 ? ` <span class="pn-sub">/ ${r.hours} hrs</span>` : ''}` : '—',
        r.day_rate ? `₹${n0(r.day_rate)}` : '—', `<b>${rate(pcRateOf(r))}</b>`, esc(r.eff_date ? H.fmtDate(r.eff_date) : ''),
        manage ? `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn-secondary btn-sm" data-nedit="${esc(r.id)}">Edit</button><button class="btn-secondary btn-sm" data-ndel="${esc(r.id)}" style="color:#dc2626;">✕</button></div>` : '']);
    }
    return `${tools}
      <div class="pn-bar">
        <div><label>Department</label><select id="pnm-dept"><option value="">All (${N.length})</option>${depts().map((d) => `<option value="${esc(d)}"${d === F.dept ? ' selected' : ''}>${esc(d)} (${N.filter((r) => r.dept === d).length})</option>`).join('')}</select></div>
        <div style="flex:1;min-width:200px;max-width:360px;"><label>Search</label><input id="pnm-q" value="${esc(F.q)}" placeholder="item, size, worker…" style="width:100%;box-sizing:border-box;"></div>
      </div>
      ${H.table(['Item', 'Size', 'Worker', { label: '8 hrs norm (pcs)', align: 'right' }, { label: 'Rate / day', align: 'right' }, { label: 'Per pc (₹)', align: 'right' }, 'Date', { label: '', m: 'actions' }], rows,
        { empty: N.length ? 'Kuch match nahi hua' : 'Norms khaali hain — Excel upload karo', maxHeight: '640px' })}`;
  }

  function bindNorms() {
    const $ = (id) => document.getElementById(id);
    $('pnm-dept')?.addEventListener('change', (e) => { F.dept = e.target.value; render(); });
    $('pnm-q')?.addEventListener('input', (e) => {
      F.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const n = $('pnm-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    });
    $('pnm-xls')?.addEventListener('click', exportNorms);
    $('pnm-add')?.addEventListener('click', () => normModal(F.dept ? { dept: F.dept } : null));
    $('pnm-file')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      if (!files.length) return;
      $('pnm-out').textContent = 'Uploading…';
      try {
        const read = (f) => new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok({ name: f.name, file: rd.result }); rd.onerror = () => no(new Error(`Could not read ${f.name}`)); rd.readAsDataURL(f); });
        const r = await H.post(`${BASE}/norms/upload`, { files: await Promise.all(files.map(read)) });
        await loadNorms(); render();
        const msg = `${r.added} new, ${r.updated} updated${r.dup ? `, ${r.dup} duplicate rows merged` : ''} — total ${r.total}${r.skipped?.length ? ` · skipped: ${r.skipped.join(', ')} (purana draft)` : ''}`;
        const out = $('pnm-out'); if (out) out.textContent = msg;
        H.toast('Norms imported');
      } catch (err) { const out = $('pnm-out'); if (out) out.textContent = ''; H.fail(err); }
    });
    document.querySelectorAll('[data-nedit]').forEach((b) => b.addEventListener('click', () => normModal(byId.get(b.getAttribute('data-nedit')))));
    document.querySelectorAll('[data-ndel]').forEach((b) => b.addEventListener('click', async () => {
      const r = byId.get(b.getAttribute('data-ndel'));
      if (!(await Utils.showConfirm(`${r.dept}: ${r.item} ${r.size}${r.worker ? ` (${r.worker})` : ''} delete karein? Purani entries apna rate rakhti hain.`, { title: 'Delete norm', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(`${BASE}/norms/${encodeURIComponent(r.id)}`); await loadNorms(); render(); } catch (e) { H.fail(e); }
    }));
  }

  function normModal(r) {
    const isNew = !r || !r.id;
    const m = { hours: 8, ...(r || {}) };
    H.openModal({
      id: 'pn-m', width: 620,
      title: isNew ? 'Add norm' : `Edit ${m.item} ${m.size || ''}`,
      subtitle: 'Per pc rate = rate per day ÷ norm pcs (agar sirf per pc rate pata hai to norm khaali chhodo)',
      bodyHTML: `${H.grid(`
        ${H.field('nm-dept', 'Department', m.dept || '', { required: true, placeholder: 'SPINNING' })}
        ${H.field('nm-section', 'Section (optional)', m.section || '', { placeholder: 'MILK CAN' })}
        ${H.field('nm-item', 'Item name', m.item || '', { required: true, span: 2 })}
        ${H.field('nm-size', 'Size', m.size || '', { placeholder: '10 TO 16' })}
        ${H.field('nm-worker', 'Worker (sirf uska rate ho to)', m.worker || '', { placeholder: 'blank = sab ke liye' })}
        ${H.field('nm-pcs', 'Norm pcs', m.norm_pcs || '', { type: 'number', step: '1' })}
        ${H.field('nm-hours', 'In hours', m.hours || 8, { type: 'number', step: '0.5' })}
        ${H.field('nm-rate', 'Rate per day (₹)', m.day_rate || '', { type: 'number', step: '1' })}
        ${H.field('nm-pc', 'Per pc rate (₹)', m.norm_pcs && m.day_rate ? '' : (m.pc_rate || ''), { type: 'number', step: '0.0001', hint: 'sirf jab norm/day rate nahi' })}
        ${H.field('nm-date', 'Effective date', m.eff_date || today(), { type: 'date' })}
        ${H.field('nm-remarks', 'Remarks', m.remarks || '')}`)}
        <datalist id="nm-depts">${depts().map((d) => `<option value="${esc(d)}">`).join('')}</datalist>`,
      onConfirm: async () => {
        const res = await H.post(`${BASE}/norms`, {
          id: isNew ? '' : m.id, dept: H.val('nm-dept'), section: H.val('nm-section'), item: H.val('nm-item'), size: H.val('nm-size'),
          worker: H.val('nm-worker'), norm_pcs: H.val('nm-pcs'), hours: H.val('nm-hours'), day_rate: H.val('nm-rate'), pc_rate: H.val('nm-pc'),
          eff_date: H.val('nm-date'), remarks: H.val('nm-remarks'),
        });
        H.closeModal('pn-m');
        await loadNorms();
        render();
        H.toast(`Norm saved (${res.id})`);
      },
    });
    document.getElementById('nm-dept')?.setAttribute('list', 'nm-depts');
  }

  async function exportNorms() {
    const rows = normsShown();
    try {
      await loadXlsx();
      const ws = XLSX.utils.aoa_to_sheet([['LALLUBHAI AMICHAND LIMITED — PRODUCTION NORMS'], [],
        ['DEPARTMENT', 'SECTION', 'ITEMS NAME', 'SIZE', 'WORKER', 'PROD. NORMS (PCS)', 'HOURS', 'RATE PER DAY (Rs.)', 'PER PCS RATE (Rs.)', 'DATE', 'REMARKS'],
        ...rows.map((r) => [r.dept, r.section || '', r.item, r.size || '', r.worker || '', r.norm_pcs || '', r.hours || 8, r.day_rate || '', Math.round(pcRateOf(r) * 10000) / 10000, r.eff_date || '', r.remarks || ''])]);
      ws['!cols'] = [30, 26, 44, 11, 18, 12, 7, 12, 12, 11, 20].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Norms');
      XLSX.writeFile(wb, fileSafe(`Production norms${F.dept ? ' ' + F.dept : ''}.xlsx`));
    } catch (e) { H.fail(e); }
  }

  /* ── Binding ──────────────────────────────────────────────────────── */

  function bind() {
    document.querySelectorAll('[data-pn-tab]').forEach((b) => b.addEventListener('click', async () => {
      _tab = b.getAttribute('data-pn-tab');
      if (_tab === 'report' && !R.lines) { loadReport(); return; }
      render();
    }));
    if (_tab === 'entry') bindEntry();
    if (_tab === 'report') bindReport();
    if (_tab === 'norms') bindNorms();
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Production Norms…');
      try {
        await loadNorms();
        if (!N.length && manage) _tab = 'norms';
        else if (D.dept && !D.dirty) await loadDay();
        render();
      } catch (e) { if (el) el.innerHTML = H.empty('Could not load Production Norms', e.message); }
    },
  };
})();
