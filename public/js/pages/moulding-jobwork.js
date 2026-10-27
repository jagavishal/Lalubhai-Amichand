/* =====================================================================
   Moulding & Job Work — the bhatti's daily DPR and the job-work lots
   sent to outside parties.
   Server side: backend/moulding-jobwork.js (/api/moulding-jobwork/*).

   Was two Google workbooks:
   - "MOULDING IN OUT": a DPR tab a month, a row a day — scrap in, scrap
     left, parts out, chhay, melting loss %. Actual input and loss % are
     computed here from the weights, never typed.
   - "VAKHARIA-2026-2027": a tab per party, a block per lot (job work 5 %,
     ingot 4 %, purchase 0 % at a rate) — material sent OUT, bills coming
     IN against it, the AVAILABLE QUANTITY left with the party.

   Built on window.HR (hr-common.js) like Production Norms.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['moulding-jobwork'] = (() => {
  const H = window.HR;
  const esc = H.esc;
  const BASE = '/api/moulding-jobwork';

  let _tab = 'dpr';
  let manage = false;
  const today = () => H.todayISO();
  const monthOf = (iso) => String(iso || today()).slice(0, 7);
  const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };

  const M = { month: monthOf(), rows: null };                       // moulding DPR
  const J = { entries: null, lots: [], parties: [], party: '', lot: '' };  // job work

  const LOT_TYPES = [
    { value: 'JOB WORK', label: 'Job work — 5% loss', loss: 5 },
    { value: 'INGOT', label: 'Ingot — 4% loss', loss: 4 },
    { value: 'PURCHASE', label: 'Purchase — 0% loss (rate per kg)', loss: 0 },
  ];
  const GOODS = ['ALU. SCRAP', 'ALU. WIRE SCRAP', 'INGOTS', 'ALU. CIRCLES'];

  const kg = (n, dp = 3) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const n0 = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
  const pct = (n) => `${(Number(n) || 0).toFixed(2)}%`;
  const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const lossPill = (p) => {
    if (!(p > 0)) return '<span style="color:#cbd5e1;">—</span>';
    const c = p <= 6 ? '#16a34a' : p <= 9 ? '#d97706' : '#dc2626';
    return `<b style="color:${c};">${pct(p)}</b>`;
  };
  const STATUS = { OPEN: ['Open', 'info'], DONE: ['Done', 'success'], SHORT: ['Done — short', 'warning'], EXCESS: ['Excess received', 'danger'] };
  const statusPill = (s) => H.pill((STATUS[s] || [s])[0], (STATUS[s] || [0, 'neutral'])[1]);

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const tabs = [
      { key: 'dpr', label: 'Moulding (DPR)' },
      { key: 'jw', label: 'Job Work IN-OUT', count: J.parties.length || null },
    ];
    const actions = [
      manage ? '<button id="mj-import" class="btn-secondary btn-sm" title="Dono Google sheets se data laao (pichhla import replace hota hai, ERP ki entries bachi rehti hain)">Import from sheets</button>' : '',
      _tab === 'dpr' ? '<button id="md-xls" class="btn-secondary btn-sm">Excel</button><button id="md-add" class="btn-primary btn-sm">+ Day entry</button>' : '',
      _tab === 'jw' ? '<button id="jw-xls" class="btn-secondary btn-sm">Excel</button><button id="jw-in" class="btn-secondary btn-sm">+ Maal aaya (IN)</button><button id="jw-out" class="btn-primary btn-sm">+ Maal bheja (OUT)</button>' : '',
    ].join('');
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        .mj-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px; }
        .mj-bar { display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px; }
        .mj-bar label { display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px; }
        .mj-bar input, .mj-bar select { padding:8px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fff;font-family:inherit; }
        .mj-sub { font-size:11px;color:#94a3b8; }
        .mj-parties { display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-bottom:14px; }
        .mj-party { text-align:left;background:#fff;border:1.5px solid #e2e8f0;border-radius:11px;padding:12px 14px;cursor:pointer;font-family:inherit; }
        .mj-party.on { border-color:var(--color-primary);box-shadow:0 0 0 3px rgba(1,80,170,.08); }
        .mj-party b { display:block;font-size:13px;color:#0f172a; }
        .mj-party .big { font-size:19px;font-weight:700;color:var(--color-primary);margin-top:4px;letter-spacing:-.02em; }
        .mj-calc { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px;padding:12px;background:#f8fafc;border-radius:10px; }
        .mj-calc div { font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8; }
        .mj-calc b { display:block;font-size:16px;color:#0f172a;margin-top:3px;text-transform:none;letter-spacing:0; }
        a.mj-lot { font-weight:700;color:#0f172a;text-decoration:none; }
        a.mj-lot.on { color:var(--color-primary); }
      </style>
      ${H.header('Moulding & Job Work', 'Bhatti ka roz ka DPR, aur job work / purchase lots ka IN-OUT', actions)}
      ${H.tabs('mj', tabs, _tab)}
      ${_tab === 'dpr' ? dprTab() : jwTab()}
    </div>`;
    bind();
  }

  /* ── Moulding (DPR) tab ───────────────────────────────────────────── */

  function dprTotals(rows) {
    const t = rows.reduce((s, r) => {
      s.input += +r.input_wt || 0; s.balance += +r.balance_wt || 0; s.actual += +r.actual_wt || 0;
      s.output += +r.output_wt || 0; s.qty += +r.qty_pcs || 0; s.chhay += +r.chhay_wt || 0;
      return s;
    }, { input: 0, balance: 0, actual: 0, output: 0, qty: 0, chhay: 0 });
    t.loss = t.actual > 0 ? ((t.actual - t.output) / t.actual) * 100 : 0;
    return t;
  }

  function dprTab() {
    const bar = `<div class="mj-bar">
      <div><label>Month</label><input id="md-month" type="month" value="${esc(M.month)}" max="${monthOf()}"></div>
      <span class="mj-sub" style="padding-bottom:9px;">Actual input = input − balance scrap · Melting loss = (actual − output) ÷ actual</span>
    </div>`;
    if (!M.rows) return bar + H.spinner();
    const rows = M.rows;
    const t = dprTotals(rows);
    const tiles = H.stats([
      { label: 'Days run', value: rows.length },
      { label: 'Actual input', value: `${kg(t.actual)} kg`, hint: `input ${kg(t.input)} − balance ${kg(t.balance)}` },
      { label: 'Output (parts)', value: `${kg(t.output)} kg`, hint: `${n0(t.qty)} pcs` },
      { label: 'Chhay', value: `${kg(t.chhay)} kg` },
      { label: 'Melting loss', value: pct(t.loss), color: t.loss <= 6 ? '#16a34a' : t.loss <= 9 ? '#d97706' : '#dc2626' },
    ]);
    const body = rows.map((r) => [
      `<b>${esc(H.fmtDate(r.entry_date))}</b>${r.source === 'sheet' ? '<div class="mj-sub">sheet</div>' : ''}`,
      kg(r.input_wt), kg(r.balance_wt), `<b>${kg(r.actual_wt)}</b>`, `<b>${kg(r.output_wt)}</b>`, n0(r.qty_pcs),
      `<span style="white-space:normal;">${esc(r.parts || '')}</span>`, kg(r.chhay_wt), lossPill(r.loss_pct),
      esc(r.operators || ''), `<span class="mj-sub" style="white-space:normal;">${esc(r.remarks || '')}</span>`,
      `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn-secondary btn-sm" data-dedit="${esc(r.id)}">Edit</button>${manage ? `<button class="btn-secondary btn-sm" data-ddel="${esc(r.id)}" style="color:#dc2626;">✕</button>` : ''}</div>`,
    ]);
    if (rows.length) {
      body.push(['<b>TOTAL</b>', `<b>${kg(t.input)}</b>`, `<b>${kg(t.balance)}</b>`, `<b>${kg(t.actual)}</b>`, `<b>${kg(t.output)}</b>`, `<b>${n0(t.qty)}</b>`, '', `<b>${kg(t.chhay)}</b>`, lossPill(t.loss), '', '', '']);
    }
    const R = { align: 'right', nowrap: true };
    return `${bar}${tiles}${H.table([
      { label: 'Date', m: 'title' }, { label: 'Input (kg)', ...R }, { label: 'Balance scrap', ...R }, { label: 'Actual input', ...R },
      { label: 'Output (kg)', ...R }, { label: 'Qty (pcs)', ...R }, 'Name of the parts', { label: 'Chhay (kg)', ...R },
      { label: 'Melting loss', ...R }, 'Operators', 'Remarks', { label: '', m: 'actions' },
    ], body, { empty: 'Is mahine ki koi entry nahi — “+ Day entry” dabao', cards: true, maxHeight: '640px' })}`;
  }

  async function loadDpr() {
    M.rows = null; render();
    try {
      const d = await H.api(`${BASE}/dpr?from=${M.month}-01&to=${monthEnd(M.month)}`);
      manage = !!d.manage;
      M.rows = (d.entries || []).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    } catch (e) { M.rows = []; H.fail(e); }
    render();
  }

  function dprModal(r) {
    const isNew = !r;
    const m = r || { entry_date: today(), process: 'ALUM. SHEET CUTTING' };
    H.openModal({
      id: 'md-m', width: 640,
      title: isNew ? 'Moulding — day entry' : `Edit ${H.fmtDate(m.entry_date)}`,
      subtitle: 'Actual input aur melting loss apne aap nikalte hain',
      bodyHTML: `${H.grid(`
        ${H.field('md-date', 'Date', m.entry_date, { type: 'date', required: true })}
        ${H.field('md-process', 'Item name', m.process || '', { placeholder: 'ALUM. SHEET CUTTING' })}
        ${H.field('md-input', 'Input wt. — alum. scrap (kg)', m.input_wt ?? '', { type: 'number', step: 'any', required: true })}
        ${H.field('md-balance', 'Balance scrap at end of shift (kg)', m.balance_wt ?? '', { type: 'number', step: 'any' })}
        ${H.field('md-output', 'Output wt. — parts (kg)', m.output_wt ?? '', { type: 'number', step: 'any' })}
        ${H.field('md-qty', 'Qty of parts (nos)', m.qty_pcs ?? '', { type: 'number', step: '1' })}
        ${H.field('md-parts', 'Name of the parts', m.parts || '', { span: 2, placeholder: 'Moden Keetle Pipe NO.4,5' })}
        ${H.field('md-chhay', 'Chhay wt. (kg)', m.chhay_wt ?? '', { type: 'number', step: 'any' })}
        ${H.field('md-ops', 'Name of operators', m.operators || '', { placeholder: 'Pradip, Ravjibhai' })}
        ${H.field('md-rem', 'Remarks', m.remarks || '', { span: 2, placeholder: 'Bhati folt, vati repairing…' })}`)}
        <div class="mj-calc"><div>Actual input<b id="md-c-actual">—</b></div><div>Output − actual<b id="md-c-diff">—</b></div><div>Melting loss<b id="md-c-loss">—</b></div></div>`,
      onOpen: () => {
        const calc = () => {
          const input = num(H.val('md-input')), bal = num(H.val('md-balance')), out = num(H.val('md-output'));
          const actual = Math.max(0, input - bal);
          document.getElementById('md-c-actual').textContent = input ? `${kg(actual)} kg` : '—';
          document.getElementById('md-c-diff').textContent = input ? `${kg(actual - out)} kg` : '—';
          document.getElementById('md-c-loss').innerHTML = actual > 0 && out ? lossPill(((actual - out) / actual) * 100) : '—';
        };
        ['md-input', 'md-balance', 'md-output'].forEach((id) => document.getElementById(id)?.addEventListener('input', calc));
        calc();
      },
      onConfirm: async () => {
        await H.post(`${BASE}/dpr`, {
          id: isNew ? '' : m.id, entry_date: H.val('md-date'), process: H.val('md-process'),
          input_wt: H.val('md-input'), balance_wt: H.val('md-balance'), output_wt: H.val('md-output'), qty_pcs: H.val('md-qty'),
          parts: H.val('md-parts'), chhay_wt: H.val('md-chhay'), operators: H.val('md-ops'), remarks: H.val('md-rem'),
        });
        H.closeModal('md-m');
        M.month = monthOf(H.val('md-date') || M.month);
        H.toast('Saved');
        loadDpr();
      },
    });
  }

  async function exportDpr() {
    const rows = M.rows || [];
    if (!rows.length) { H.toast('Export ke liye kuch nahi', 'error'); return; }
    try {
      await loadXlsx();
      const t = dprTotals(rows);
      const [y, mo] = M.month.split('-');
      const title = `DPR ${new Date(+y, +mo - 1, 1).toLocaleString('en-IN', { month: 'short' }).toUpperCase()}-${y}`;
      const ws = XLSX.utils.aoa_to_sheet([[`LALLUBHAI AMICHAND LTD. — MOULDING ${title}`], [],
        ['DATE', 'ITEM NAME', 'INPUT WT. (Kg) ALUM. SCRAP', 'BALANCE SCRAP AT THE END OF SHIFT (Kg)', 'ACTUAL INPUT WT. (Kg) ALUM. SCRAP', 'OUT PUT WT. (Kg) PARTS', 'QTY. OF PARTS (NOS)', 'NAME OF THE PARTS', 'CHHAY WT. (Kg)', 'MELTING LOSS PERCENTAGE', 'NAME OF OPERATORS', 'REMARKS'],
        ['', 'TOTAL', r3(t.input), r3(t.balance), r3(t.actual), r3(t.output), t.qty, '', r3(t.chhay), `${t.loss.toFixed(2)}%`],
        ...rows.map((r) => [r.entry_date, r.process, r.input_wt, r.balance_wt, r.actual_wt, r.output_wt, r.qty_pcs, r.parts || '', r.chhay_wt, `${(+r.loss_pct || 0).toFixed(2)}%`, r.operators || '', r.remarks || ''])]);
      ws['!cols'] = [11, 22, 12, 14, 14, 12, 10, 40, 10, 11, 22, 24].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, title);
      XLSX.writeFile(wb, `Moulding ${title}.xlsx`);
    } catch (e) { H.fail(e); }
  }

  /* ── Job work tab ─────────────────────────────────────────────────── */

  const lotsOf = (party) => J.lots.filter((l) => l.party === party);
  const lotLabel = (l) => `${l.lot_no} · ${l.lot_type}${l.rate ? ` @ ₹${l.rate}` : ''}${l.docs?.length ? ` · ${l.docs.join(', ')}` : ''} — ${kg(l.balance)} kg left`;

  function jwTab() {
    if (!J.entries) return H.spinner();
    if (!J.parties.length) {
      return H.empty('Abhi koi job work entry nahi', manage
        ? '“Import from sheets” se VAKHARIA / SUBHASH METAL ka data laao, ya “+ Maal bheja (OUT)” se naya lot kholo.'
        : '“+ Maal bheja (OUT)” se pehla lot kholo.');
    }
    const cards = `<div class="mj-parties">${J.parties.map((p) => `
      <button class="mj-party${p.party === J.party ? ' on' : ''}" data-party="${esc(p.party)}">
        <b>${esc(p.party)}</b>
        <div class="big">${kg(p.balance)} kg</div>
        <div class="mj-sub">party ke paas · ${p.openLots} open lot${p.openLots === 1 ? '' : 's'} of ${p.lots}</div>
      </button>`).join('')}</div>`;

    const lots = lotsOf(J.party);
    const R = { align: 'right', nowrap: true };
    const lotTable = H.table([
      { label: 'Lot', m: 'title' }, 'Type', 'Goods', 'Challan / PO', { label: 'Sent (kg)', ...R }, { label: 'Loss', ...R },
      { label: 'Final wt.', ...R }, { label: 'Received', ...R }, { label: 'Balance', ...R }, 'Status', 'Dates',
    ], lots.map((l) => [
      `<a href="#" class="mj-lot${J.lot === l.lot_no ? ' on' : ''}" data-lot="${esc(l.lot_no)}">${esc(l.lot_no)}</a>`,
      `${esc(l.lot_type)}${l.rate ? `<div class="mj-sub">₹${esc(l.rate)}/kg</div>` : ''}`,
      esc(l.description || ''), esc((l.docs || []).join(', ')), kg(l.sent), `${l.loss_pct || 0}%`, kg(l.final), kg(l.received),
      `<b>${kg(l.balance)}</b>`, statusPill(l.status),
      `<span class="mj-sub">${esc(H.fmtDate(l.first_date))} → ${esc(H.fmtDate(l.last_date))}</span>`,
    ]), { empty: 'Koi lot nahi', cards: true });

    const ledger = J.entries.filter((e) => e.party === J.party && (!J.lot || e.lot_no === J.lot));
    const ledgerTable = H.table([
      { label: 'Date', m: 'title' }, 'Lot', 'Challan no.', 'Goods', { label: 'Weight', ...R }, { label: 'Loss', ...R }, { label: 'Final wt.', ...R },
      'Bill no.', { label: 'Received', ...R }, { label: 'Lot balance', ...R }, { label: 'Party balance', ...R }, 'Remark', { label: '', m: 'actions' },
    ], ledger.map((e) => {
      const out = e.type !== 'IN';
      return [
        `<b>${esc(H.fmtDate(e.entry_date))}</b>`,
        `${esc(e.lot_no)}${e.type === 'OPENING' ? '<div class="mj-sub">opening</div>' : ''}`,
        out ? esc(e.doc_no || '') : '', out ? esc(e.description || '') : '',
        e.type === 'OUT' ? kg(e.weight) : e.type === 'OPENING' ? kg(e.qty) : '',
        e.type === 'OUT' ? `${kg(e.loss_wt)}<div class="mj-sub">${e.loss_pct}%</div>` : '',
        e.type === 'OUT' ? `<b>${kg(e.final_wt)}</b>` : e.type === 'OPENING' ? `<b>${kg(e.qty)}</b>` : '',
        out ? '' : esc(e.doc_no || ''), out ? '' : `<b>${kg(e.qty)}</b>`,
        kg(e.lot_balance), `<b>${kg(e.balance)}</b>`,
        `<span class="mj-sub" style="white-space:normal;">${esc(e.remarks || '')}${Math.abs(e.lot_balance) < 0.005 && !out ? ' <b style="color:#16a34a;">DONE</b>' : ''}</span>`,
        `<div style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn-secondary btn-sm" data-jedit="${esc(e.id)}">Edit</button>${manage ? `<button class="btn-secondary btn-sm" data-jdel="${esc(e.id)}" style="color:#dc2626;">✕</button>` : ''}</div>`,
      ];
    }), { empty: 'Koi entry nahi', cards: true, maxHeight: '620px' });

    return `${cards}
      <div class="mj-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap;">
        <b style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">${esc(J.party)} — lots</b>
        <span style="display:flex;gap:10px;align-items:center;">
          ${J.lot ? `<a href="#" id="jw-lot-clear" style="font-size:12px;color:var(--color-primary);">Lot ${esc(J.lot)} ✕ — sab dikhao</a>` : '<span class="mj-sub">lot pe click karo — sirf uski entries</span>'}
          <button id="jw-open" class="btn-secondary btn-sm" title="Pichhle saal se party ke paas bacha maal">+ Opening balance</button>
        </span>
      </div>${lotTable}</div>
      <div class="mj-card"><b style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:8px;">Ledger${J.lot ? ` — lot ${esc(J.lot)}` : ''} (${ledger.length})</b>${ledgerTable}</div>`;
  }

  async function loadJw() {
    try {
      const d = await H.api(`${BASE}/jw`);
      manage = !!d.manage;
      J.entries = d.entries || [];
      J.lots = d.lots || [];
      J.parties = d.parties || [];
      if (!J.parties.some((p) => p.party === J.party)) { J.party = J.parties[0]?.party || ''; J.lot = ''; }
      if (J.lot && !lotsOf(J.party).some((l) => l.lot_no === J.lot)) J.lot = '';
    } catch (e) { J.entries = []; H.fail(e); }
  }

  // OUT / Opening: send material — a new lot, or more into an open one.
  function outModal(e, type = 'OUT') {
    const isNew = !e;
    const m = e || { type, party: J.party, entry_date: today(), lot_type: 'JOB WORK', loss_pct: 5, description: 'ALU. SCRAP' };
    const opening = m.type === 'OPENING';
    const partyLots = (p) => lotsOf(p).filter((l) => l.status === 'OPEN' || l.lot_no === m.lot_no);
    const lotOptions = (p) => [{ value: '', label: '+ New lot' }, ...partyLots(p).map((l) => ({ value: l.lot_no, label: `Add to ${lotLabel(l)}` }))];
    H.openModal({
      id: 'jw-m', width: 640,
      title: opening ? (isNew ? 'Opening balance' : 'Edit opening') : (isNew ? 'Maal bheja (OUT)' : `Edit OUT ${m.doc_no || ''}`),
      subtitle: opening ? 'Pichhle saal se party ke paas bacha hua maal — ek naya lot' : 'Final wt. = weight − melting loss; party itna wapas degi',
      bodyHTML: `${H.grid(`
        ${H.field('jw-party', 'Party', m.party || '', { required: true, placeholder: 'VAKHARIA' })}
        ${H.field('jw-date', 'Date', m.entry_date || today(), { type: 'date', required: true })}
        ${H.select('jw-lot', 'Lot', m.lot_no || '', lotOptions(m.party || ''))}
        ${H.select('jw-type', 'Lot type', m.lot_type || 'JOB WORK', LOT_TYPES)}
        ${opening ? '' : H.field('jw-doc', 'Challan no. / PO no.', m.doc_no || '', { placeholder: 'LJ/15' })}
        ${H.field('jw-goods', 'Description of goods', m.description || '', { placeholder: 'ALU. SCRAP' })}
        ${H.field('jw-weight', opening ? 'Quantity with party (kg)' : 'Weight sent (kg)', opening ? (m.qty ?? '') : (m.weight ?? ''), { type: 'number', step: 'any', required: true })}
        ${opening ? '' : H.field('jw-loss', 'Melting loss %', m.loss_pct ?? 5, { type: 'number', step: 'any' })}
        ${H.field('jw-rate', 'Rate per kg (purchase)', m.rate || '', { type: 'number', step: 'any', placeholder: 'sirf purchase lot' })}
        ${H.field('jw-rem', 'Remark', m.remarks || '')}`)}
        ${opening ? '' : '<div class="mj-calc"><div>Weight<b id="jw-c-w">—</b></div><div>Melting loss<b id="jw-c-l">—</b></div><div>Final wt. (wapas aayega)<b id="jw-c-f">—</b></div></div>'}
        <datalist id="jw-parties">${J.parties.map((p) => `<option value="${esc(p.party)}">`).join('')}</datalist>
        <datalist id="jw-goodslist">${GOODS.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>`,
      onOpen: () => {
        document.getElementById('jw-party')?.setAttribute('list', 'jw-parties');
        document.getElementById('jw-goods')?.setAttribute('list', 'jw-goodslist');
        const calc = () => {
          if (opening) return;
          const w = num(H.val('jw-weight')), lp = num(H.val('jw-loss'));
          document.getElementById('jw-c-w').textContent = w ? `${kg(w)} kg` : '—';
          document.getElementById('jw-c-l').textContent = w ? `${kg((w * lp) / 100)} kg` : '—';
          document.getElementById('jw-c-f').textContent = w ? `${kg(w - (w * lp) / 100)} kg` : '—';
        };
        // Picking a lot type sets its usual loss; adding to a lot takes that lot's.
        document.getElementById('jw-type')?.addEventListener('change', (ev) => {
          const t = LOT_TYPES.find((x) => x.value === ev.target.value);
          const loss = document.getElementById('jw-loss');
          if (t && loss) { loss.value = t.loss; calc(); }
        });
        document.getElementById('jw-lot')?.addEventListener('change', (ev) => {
          const l = J.lots.find((x) => x.party === H.val('jw-party').trim().toUpperCase() && x.lot_no === ev.target.value);
          if (!l) return;
          document.getElementById('jw-type').value = l.lot_type;
          const loss = document.getElementById('jw-loss'); if (loss) loss.value = l.loss_pct;
          if (l.rate) document.getElementById('jw-rate').value = l.rate;
          calc();
        });
        document.getElementById('jw-party')?.addEventListener('change', (ev) => {
          const sel = document.getElementById('jw-lot');
          if (sel) sel.innerHTML = lotOptions(ev.target.value.trim().toUpperCase()).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
        });
        ['jw-weight', 'jw-loss'].forEach((id) => document.getElementById(id)?.addEventListener('input', calc));
        calc();
      },
      onConfirm: async () => {
        const body = {
          id: isNew ? '' : m.id, type: opening ? 'OPENING' : 'OUT', party: H.val('jw-party'), entry_date: H.val('jw-date'),
          lot_no: H.val('jw-lot'), lot_type: H.val('jw-type'), rate: H.val('jw-rate'), description: H.val('jw-goods'), remarks: H.val('jw-rem'),
        };
        if (opening) body.qty = H.val('jw-weight');
        else Object.assign(body, { doc_no: H.val('jw-doc'), weight: H.val('jw-weight'), loss_pct: H.val('jw-loss') });
        await H.post(`${BASE}/jw`, body);
        H.closeModal('jw-m');
        J.party = body.party.trim().toUpperCase();
        H.toast('Saved');
        await loadJw(); render();
      },
    });
  }

  // IN: goods back from the party, against one of its lots.
  function inModal(e) {
    const isNew = !e;
    const m = e || { party: J.party, entry_date: today(), lot_no: J.lot || '' };
    const lotOptions = (p) => {
      const ls = lotsOf(p);
      const open = ls.filter((l) => l.status === 'OPEN');
      const rest = ls.filter((l) => l.status !== 'OPEN');
      return [{ value: '', label: open.length ? 'Sabse purana open lot (auto)' : '— pehle OUT se lot kholo —' },
        ...open.map((l) => ({ value: l.lot_no, label: lotLabel(l) })),
        ...rest.map((l) => ({ value: l.lot_no, label: `${lotLabel(l)} (${(STATUS[l.status] || [l.status])[0]})` }))];
    };
    H.openModal({
      id: 'jw-m', width: 560,
      title: isNew ? 'Maal aaya (IN)' : `Edit IN bill ${m.doc_no || ''}`,
      subtitle: 'Party ka bill / challan — jis lot ke against aaya',
      bodyHTML: `${H.grid(`
        ${H.field('jw-party', 'Party', m.party || '', { required: true })}
        ${H.field('jw-date', 'Bill date', m.entry_date || today(), { type: 'date', required: true })}
        ${H.select('jw-lot', 'Against lot', m.lot_no || '', lotOptions(m.party || ''), { span: 2 })}
        ${H.field('jw-doc', 'Bill no. / challan no.', m.doc_no || '', { placeholder: '144' })}
        ${H.field('jw-qty', 'Received quantity (kg)', m.qty ?? '', { type: 'number', step: 'any', required: true })}
        ${H.field('jw-rem', 'Remark', m.remarks || '', { span: 2 })}`)}
        <div class="mj-calc"><div>Lot balance abhi<b id="jw-c-b">—</b></div><div>Is bill ke baad<b id="jw-c-a">—</b></div><div>Party ke paas<b id="jw-c-p">—</b></div></div>
        <datalist id="jw-parties">${J.parties.map((p) => `<option value="${esc(p.party)}">`).join('')}</datalist>`,
      onOpen: () => {
        document.getElementById('jw-party')?.setAttribute('list', 'jw-parties');
        const calc = () => {
          const p = H.val('jw-party').trim().toUpperCase();
          const ls = lotsOf(p);
          const lotNo = H.val('jw-lot') || (ls.find((l) => l.status === 'OPEN') || {}).lot_no;
          const l = ls.find((x) => x.lot_no === lotNo);
          // Editing: this bill is already inside the lot's balance.
          const mine = !isNew && l && m.lot_no === l.lot_no ? num(m.qty) : 0;
          const q = num(H.val('jw-qty'));
          const party = J.parties.find((x) => x.party === p);
          document.getElementById('jw-c-b').textContent = l ? `${kg(l.balance + mine)} kg` : '—';
          document.getElementById('jw-c-a').innerHTML = l ? `<span style="color:${l.balance + mine - q < -0.005 ? '#dc2626' : '#0f172a'};">${kg(l.balance + mine - q)} kg</span>` : '—';
          document.getElementById('jw-c-p').textContent = party ? `${kg(party.balance + (isNew ? 0 : num(m.qty)) - q)} kg` : '—';
        };
        document.getElementById('jw-party')?.addEventListener('change', (ev) => {
          const sel = document.getElementById('jw-lot');
          if (sel) sel.innerHTML = lotOptions(ev.target.value.trim().toUpperCase()).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
          calc();
        });
        ['jw-lot', 'jw-qty'].forEach((id) => document.getElementById(id)?.addEventListener('input', calc));
        document.getElementById('jw-lot')?.addEventListener('change', calc);
        calc();
      },
      onConfirm: async () => {
        const body = { id: isNew ? '' : m.id, type: 'IN', party: H.val('jw-party'), entry_date: H.val('jw-date'), lot_no: H.val('jw-lot'),
          doc_no: H.val('jw-doc'), qty: H.val('jw-qty'), remarks: H.val('jw-rem') };
        await H.post(`${BASE}/jw`, body);
        H.closeModal('jw-m');
        J.party = body.party.trim().toUpperCase();
        H.toast('Saved');
        await loadJw(); render();
      },
    });
  }

  async function exportJw() {
    const ledger = (J.entries || []).filter((e) => e.party === J.party);
    if (!ledger.length) { H.toast('Export ke liye kuch nahi', 'error'); return; }
    try {
      await loadXlsx();
      const lots = lotsOf(J.party);
      const ws1 = XLSX.utils.aoa_to_sheet([[`${J.party} JOB WORK / PURCHASE — LOTS`], [],
        ['LOT', 'TYPE', 'RATE', 'GOODS', 'CHALLAN / PO', 'SENT (Kg)', 'MELTING LOSS %', 'FINAL WT.', 'RECEIVED', 'BALANCE', 'STATUS', 'FROM', 'TO'],
        ...lots.map((l) => [l.lot_no, l.lot_type, l.rate || '', l.description || '', (l.docs || []).join(', '), l.sent, l.loss_pct || 0, l.final, l.received, l.balance, (STATUS[l.status] || [l.status])[0], l.first_date, l.last_date]),
        [], ['TOTAL', '', '', '', '', r3(lots.reduce((s, l) => s + l.sent, 0)), '', r3(lots.reduce((s, l) => s + l.final, 0)), r3(lots.reduce((s, l) => s + l.received, 0)), r3(lots.reduce((s, l) => s + l.balance, 0))]]);
      ws1['!cols'] = [6, 11, 8, 16, 18, 11, 9, 11, 11, 11, 14, 11, 11].map((w) => ({ wch: w }));
      const ws2 = XLSX.utils.aoa_to_sheet([[`${J.party} JOB WORK - IN - OUT`], [],
        ['DATE', 'LOT', 'CHALLAN NO.', 'DESCRIPTION OF GOODS', 'WEIGHT', 'MELTING LOSS', 'FINAL WT.', '', 'BILL NO.', 'BILL DATE', 'RECIVED QUANTITY', 'LOT AVAILABLE QUANTITY', 'PARTY BALANCE', 'REMARK'],
        ...ledger.map((e) => (e.type === 'IN'
          ? ['', e.lot_no, '', '', '', '', '', '', e.doc_no || '', e.entry_date, e.qty, e.lot_balance, e.balance, e.remarks || '']
          : [e.entry_date, e.lot_no, e.doc_no || '', e.description || '', e.type === 'OUT' ? e.weight : e.qty, e.type === 'OUT' ? e.loss_wt : 0, e.type === 'OUT' ? e.final_wt : e.qty, '', '', '', '', e.lot_balance, e.balance, e.type === 'OPENING' ? 'OPP. BALANCE' : (e.remarks || '')]))]);
      ws2['!cols'] = [11, 6, 12, 18, 10, 10, 10, 2, 9, 11, 11, 12, 12, 18].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Lots');
      XLSX.utils.book_append_sheet(wb, ws2, 'Ledger');
      XLSX.writeFile(wb, `${J.party.replace(/[\\/:*?"<>|]+/g, ' ')} job work ${today()}.xlsx`);
    } catch (e) { H.fail(e); }
  }

  /* ── Shared ───────────────────────────────────────────────────────── */

  const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
  async function loadXlsx() {
    if (window.XLSX) return;
    await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = '/vendor/xlsx.full.min.js'; sc.onload = ok; sc.onerror = () => no(new Error('Could not load the Excel library')); document.head.appendChild(sc); });
  }

  async function runImport(btn) {
    if (!(await Utils.showConfirm('Dono Google sheets (MOULDING IN OUT aur VAKHARIA-2026-2027) se data laayein? Pichhli baar import hua data replace hoga; ERP mein daali entries bachi rahengi.', { title: 'Import from sheets', confirmText: 'Import' }))) return;
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const r = await H.post(`${BASE}/import`, { what: 'both' });
      const jw = (r.jw?.parties || []).map((p) => `${p.party}: ${p.lots} lots, ${kg(p.balance)} kg${p.mismatched?.length ? ` (sheet se alag: ${p.mismatched.join(', ')})` : ' ✓ sheet se match'}`).join(' · ');
      H.toast(`DPR: ${r.dpr?.days || 0} din (${r.dpr?.tabs || 0} tabs) · Job work: ${r.jw?.entries || 0} entries — ${jw}`);
      M.rows = null; J.entries = null;
      await loadJw();
      if (_tab === 'dpr') loadDpr(); else render();
    } catch (e) { H.fail(e); btn.disabled = false; btn.textContent = 'Import from sheets'; }
  }

  /* ── Binding ──────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-mj-tab]').forEach((b) => b.addEventListener('click', async () => {
      _tab = b.getAttribute('data-mj-tab');
      if (_tab === 'dpr' && !M.rows) { loadDpr(); return; }
      if (_tab === 'jw' && !J.entries) { render(); await loadJw(); }
      render();
    }));
    $('mj-import')?.addEventListener('click', (e) => runImport(e.currentTarget));

    if (_tab === 'dpr') {
      $('md-month')?.addEventListener('change', (e) => { M.month = e.target.value || monthOf(); loadDpr(); });
      $('md-add')?.addEventListener('click', () => dprModal(null));
      $('md-xls')?.addEventListener('click', exportDpr);
      document.querySelectorAll('[data-dedit]').forEach((b) => b.addEventListener('click', () => dprModal((M.rows || []).find((r) => r.id === b.getAttribute('data-dedit')))));
      document.querySelectorAll('[data-ddel]').forEach((b) => b.addEventListener('click', async () => {
        const r = (M.rows || []).find((x) => x.id === b.getAttribute('data-ddel'));
        if (!r || !(await Utils.showConfirm(`${H.fmtDate(r.entry_date)} ki moulding entry delete karein?`, { title: 'Delete entry', confirmText: 'Delete', danger: true }))) return;
        try { await H.del(`${BASE}/dpr/${encodeURIComponent(r.id)}`); loadDpr(); } catch (e) { H.fail(e); }
      }));
    }

    if (_tab === 'jw') {
      $('jw-out')?.addEventListener('click', () => outModal(null));
      $('jw-in')?.addEventListener('click', () => inModal(null));
      $('jw-open')?.addEventListener('click', () => outModal(null, 'OPENING'));
      $('jw-xls')?.addEventListener('click', exportJw);
      $('jw-lot-clear')?.addEventListener('click', (e) => { e.preventDefault(); J.lot = ''; render(); });
      document.querySelectorAll('[data-party]').forEach((b) => b.addEventListener('click', () => { J.party = b.getAttribute('data-party'); J.lot = ''; render(); }));
      document.querySelectorAll('[data-lot]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault(); const l = a.getAttribute('data-lot'); J.lot = J.lot === l ? '' : l; render();
      }));
      document.querySelectorAll('[data-jedit]').forEach((b) => b.addEventListener('click', () => {
        const e = (J.entries || []).find((x) => x.id === b.getAttribute('data-jedit'));
        if (!e) return;
        if (e.type === 'IN') inModal(e); else outModal(e, e.type);
      }));
      document.querySelectorAll('[data-jdel]').forEach((b) => b.addEventListener('click', async () => {
        const e = (J.entries || []).find((x) => x.id === b.getAttribute('data-jdel'));
        if (!e || !(await Utils.showConfirm(`${e.party} — ${e.type} ${e.doc_no || ''} (${H.fmtDate(e.entry_date)}) delete karein? Lot ka balance badal jaayega.`, { title: 'Delete entry', confirmText: 'Delete', danger: true }))) return;
        try { await H.del(`${BASE}/jw/${encodeURIComponent(e.id)}`); await loadJw(); render(); } catch (err) { H.fail(err); }
      }));
    }
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Moulding & Job Work…');
      M.rows = null; J.entries = null;
      // The job-work list also tells us whether this person can manage.
      await loadJw();
      if (_tab === 'dpr') loadDpr(); else render();
    },
  };
})();
