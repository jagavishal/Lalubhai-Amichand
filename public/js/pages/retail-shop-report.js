/* =====================================================================
   Shop Daily Report (route 'retail-shop-report', Retail section)
   ---------------------------------------------------------------------
   Was the "Retail shop Daily report" Google Sheet — a month per tab, the
   days across. The shop enters a day (cash sales, returns, card & credit
   sales, purchases, bank deposit, cash from H.O., cash expense) and the
   month grid is drawn exactly like the sheet, with totals, month-to-date,
   cumulative from 1 April and the running cash balance. A separate system
   from the "as per Tally" report, with its own users. Server side:
   backend/retail-shop-report.js.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['retail-shop-report'] = (() => {
  const H = window.HR;
  const esc = H.esc;
  const API = '/api/retail-shop-report';

  let M = null;
  let _tab = 'entry';
  let _branch = '';
  let _month = '';
  let _date = '';
  let MONTH = null;
  let DAY = null;
  let _saved = false;      // show the big "saved" banner once after a save

  const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const n0 = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  const money = (v) => (v == null ? '—' : '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  const dd = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
  const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };

  // The entry form, in the order the shop counts its day. Every label in
  // English, Hindi and Gujarati — the people filling it read those.
  const GROUPS = [
    { group: ['Sales', 'बिक्री', 'વેચાણ'], colour: '#16a34a', items: [
      ['cash_sales', 'Cash sale', 'नकद बिक्री', 'રોકડ વેચાણ'],
      ['card_credit_sales', 'Card + Udhaar sale', 'कार्ड + उधार बिक्री', 'કાર્ડ + ઉધાર વેચાણ'],
      ['sales_return', 'Return (money given back)', 'वापसी (पैसा वापस दिया)', 'પરત (પૈસા પાછા આપ્યા)'],
    ] },
    { group: ['Purchase', 'खरीदी', 'ખરીદી'], colour: '#7c3aed', items: [
      ['purchases', 'Purchase (goods came)', 'खरीदी (माल आया)', 'ખરીદી (માલ આવ્યો)'],
      ['purchase_return', 'Purchase return', 'खरीदी वापसी', 'ખરીદી પરત'],
    ] },
    { group: ['Cash', 'नकद', 'રોકડ'], colour: '#d97706', items: [
      ['cash_deposit', 'Cash deposited in bank', 'बैंक में जमा किया', 'બેંકમાં જમા કર્યા'],
      ['cash_received', 'Cash received (H.O. / party)', 'नकद आया (H.O. / पार्टी)', 'રોકડ આવી (H.O. / પાર્ટી)'],
      ['cash_expense', 'Cash expense', 'नकद खर्च', 'રોકડ ખર્ચ'],
    ] },
  ];
  const BRANCH_KEY = 'sr-branch';
  const remember = (b) => { try { localStorage.setItem(BRANCH_KEY, b); } catch { /* private window */ } };
  const recalled = () => { try { return localStorage.getItem(BRANCH_KEY) || ''; } catch { return ''; } };
  const dayLabel = (iso) => {
    const t = istToday();
    const y = new Date(t + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
    if (iso === t) return 'Today · आज · આજે';
    if (iso === y.toISOString().slice(0, 10)) return 'Yesterday · कल · ગઈકાલે';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
  };

  // The sheet's rows, top to bottom.
  const LINES = [
    ['h', 'Sales'],
    ['cash_sales', 'Cash Sales'],
    ['sales_return', '(−) Returns'],
    ['card_credit_sales', '(+) Cr. Card Sales & Cr. Sales'],
    ['total_sales', 'Total Sales', 't'],
    ['mtd_sales', 'From 1st of the month'],
    ['fy_sales', 'Cumulative Sales (from 1 April)'],
    ['h', 'Purchases'],
    ['purchases', 'Purchases'],
    ['purchase_return', '(−) Returns'],
    ['net_purchases', 'Net Purchases', 't'],
    ['mtd_purchases', 'From 1st of the month'],
    ['fy_purchases', 'Cumulative Purchases (from 1 April)'],
    ['h', 'Cash Balance'],
    ['cash_open', 'Op. Balance'],
    ['cash_sales', '(+) Cash Sales'],
    ['cash_deposit', '(−) Cash Deposit in Bank'],
    ['cash_received', '(+) Cash recd from H.O. & Party Payment'],
    ['cash_expense', '(−) Cash Expense'],
    ['cash_close', 'Closing Balance', 't'],
  ];
  const ALWAYS = new Set(['mtd_sales', 'fy_sales', 'mtd_purchases', 'fy_purchases', 'cash_open', 'cash_close']);
  const LAST = new Set(['mtd_sales', 'fy_sales', 'mtd_purchases', 'fy_purchases', 'cash_close']);
  const cellOf = (d, k) => (d.entered || ALWAYS.has(k) ? d[k] : null);
  const monthTotal = (m, k) => (LAST.has(k) ? m.days[m.days.length - 1][k] : k === 'cash_open' ? m.days[0].cash_open : m.totals[k]);

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function loadMeta() {
    M = await H.api(`${API}/meta`);
    if (!_branch) _branch = recalled();
    if (!_branch || !M.branches.includes(_branch)) _branch = M.branches[0] || '';
    if (!_month) _month = istToday().slice(0, 7);
    if (!_date) _date = istToday();
  }
  async function loadTab() {
    if (!_branch) return;
    if (_tab === 'entry') DAY = await H.api(`${API}/day?branch=${encodeURIComponent(_branch)}&date=${_date}`);
    if (_tab === 'report') MONTH = await H.api(`${API}/month?branch=${encodeURIComponent(_branch)}&month=${_month}`);
  }
  async function show() { try { await loadTab(); render(); } catch (e) { H.fail(e); } }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const tabs = [{ key: 'entry', label: 'Daily Entry · एंट्री' }, { key: 'report', label: 'Monthly Report · रिपोर्ट' }];
    if (M.admin) tabs.push({ key: 'settings', label: 'Settings' });
    const body = !_branch ? H.empty('No branches yet', 'Add the branches on Retail Dashboard → Manage Lists.')
      : _tab === 'entry' ? entryTab() : _tab === 'report' ? reportTab() : settingsTab();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        .sr-bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
        .sr-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; }
        .sr-card h3 { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--color-primary); margin:0 0 10px; }
        .sr-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
        .sr-f { display:grid; grid-template-columns:1fr 150px; gap:8px; align-items:center; padding:4px 0; }
        .sr-f label { font-size:12.5px; color:#334155; }
        .sr-f .hint { font-size:10.5px; color:#94a3b8; display:block; }
        .sr-f input { text-align:right; }
        .sr-calc { display:flex; justify-content:space-between; font-size:12.5px; padding:5px 0; border-top:1px dashed #e2e8f0; color:#475569; }
        .sr-calc b { color:#0f172a; }
        .sr-tbl { border-collapse:collapse; font-size:12px; width:max-content; min-width:100%; }
        .sr-tbl th, .sr-tbl td { padding:6px 8px; border-bottom:1px solid #f1f5f9; white-space:nowrap; text-align:right; font-variant-numeric:tabular-nums; }
        .sr-tbl th { position:sticky; top:0; background:#f8fafc; color:#475569; font-size:10.5px; z-index:1; cursor:pointer; }
        .sr-tbl td:first-child, .sr-tbl th:first-child { text-align:left; position:sticky; left:0; background:#fff; z-index:2; }
        .sr-tbl th:first-child { background:#f8fafc; z-index:3; cursor:default; }
        .sr-tbl tr.t td { font-weight:700; background:#f8fafc; }
        .sr-tbl tr.t td:first-child { background:#f8fafc; }
        .sr-tbl tr.h td { font-weight:700; color:var(--color-primary); text-transform:uppercase; font-size:10.5px; letter-spacing:.06em; text-align:left; }
        .sr-tbl td.blank { color:#cbd5e1; }
        .sr-tbl td.adj { background:#fffbeb; }
        .sr-tbl .bl { border-left:2px solid #e2e8f0; }
        .sr-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:auto; max-height:74vh; }
        @media (max-width: 767px) { .sr-f { grid-template-columns:1fr 120px; } }
        /* The simple entry — big, one column, three languages. */
        .se { max-width:620px; }
        .se-branches { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
        .se-branches button { flex:1; min-width:120px; padding:12px; font-size:16px; font-weight:700; border-radius:12px; border:2px solid #e2e8f0; background:#fff; color:#475569; cursor:pointer; }
        .se-branches button.on { border-color:var(--color-primary); background:var(--color-primary); color:#fff; }
        .se-date { display:flex; align-items:center; gap:8px; background:#fff; border:2px solid #e2e8f0; border-radius:12px; padding:8px; margin-bottom:12px; }
        .se-date button { width:48px; height:48px; border-radius:10px; border:none; background:#f1f5f9; font-size:22px; font-weight:700; cursor:pointer; color:#334155; }
        .se-date button:disabled { opacity:.3; cursor:default; }
        .se-date .mid { flex:1; text-align:center; }
        .se-date .big { font-size:18px; font-weight:800; color:#0f172a; }
        .se-date .small { font-size:12.5px; color:#64748b; }
        .se-date input { border:none; font:inherit; font-size:12.5px; color:#64748b; background:transparent; text-align:center; }
        .se-note { border-radius:12px; padding:12px 14px; font-size:14px; margin-bottom:12px; }
        .se-group { background:#fff; border:2px solid #e2e8f0; border-left-width:6px; border-radius:12px; padding:10px 14px; margin-bottom:12px; }
        .se-group h3 { margin:2px 0 8px; font-size:15px; font-weight:800; }
        .se-group h3 span { font-weight:600; color:#94a3b8; font-size:13px; }
        .se-row { display:grid; grid-template-columns:1fr 170px; gap:10px; align-items:center; padding:7px 0; border-top:1px solid #f1f5f9; }
        .se-row:first-of-type { border-top:none; }
        .se-row label { font-size:15px; font-weight:700; color:#1e293b; line-height:1.25; }
        .se-row label small { display:block; font-size:12.5px; font-weight:500; color:#64748b; }
        .se-row input { width:100%; box-sizing:border-box; height:50px; font-size:20px; font-weight:700; text-align:right; padding:0 12px; border:2px solid #cbd5e1; border-radius:10px; color:#0f172a; background:#fff; }
        .se-row input:focus { outline:none; border-color:var(--color-primary); }
        .se-sum { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:4px 0 12px; }
        .se-sum div { background:#0f172a; color:#fff; border-radius:12px; padding:12px 14px; }
        .se-sum div.cash { background:#b45309; }
        .se-sum small { display:block; font-size:12px; opacity:.85; }
        .se-sum b { display:block; font-size:24px; margin-top:4px; }
        .se-save { width:100%; padding:16px; font-size:18px; font-weight:800; border:none; border-radius:12px; background:#16a34a; color:#fff; cursor:pointer; }
        .se-save:disabled { opacity:.6; }
        .se-admin { margin-top:14px; font-size:13px; }
        @media (max-width: 560px) {
          .se-row { grid-template-columns:1fr; gap:6px; }
          .se-save { position:sticky; bottom:76px; box-shadow:0 6px 20px rgba(0,0,0,.18); }
        }
      </style>
      ${H.header('Shop Daily Report', 'Sales, purchases and the cash balance, day by day — the shop\'s monthly sheet')}
      ${H.tabs('sr', tabs, _tab)}
      ${_branch && _tab === 'report' ? `<div class="sr-bar">
        <select id="sr-branch" style="${H.CONTROL}max-width:200px;">${M.branches.map((b) => `<option${b === _branch ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
        ${_tab === 'report' ? `<input id="sr-month" type="month" value="${esc(_month)}" style="${H.CONTROL}max-width:170px;" />
          <button class="btn-secondary btn-sm" id="sr-xlsx" style="margin-left:auto;">Download Excel</button>` : ''}
        ${M.lastDay[_branch] ? `<span style="font-size:11.5px;color:#94a3b8;">Last entry: ${H.fmtDate(M.lastDay[_branch])}</span>` : ''}
      </div>` : ''}
      ${body}
    </div>`;
    bind();
  }

  /* ── Daily entry ──────────────────────────────────────────────────── */

  function entryTab() {
    const d = DAY;
    const e = d.entry || {};
    const val = (k) => (e.entered ? (e[k] || '') : (k === 'cash_expense' && d.logged_cash_expense ? d.logged_cash_expense : ''));
    const today = istToday();
    return `<div class="se">
      ${M.branches.length > 1 ? `<div class="se-branches">${M.branches.map((b) => `<button type="button" data-branch="${esc(b)}" class="${b === _branch ? 'on' : ''}">${esc(b)}</button>`).join('')}</div>` : ''}
      <div class="se-date">
        <button type="button" id="sr-prev" title="Previous day">◀</button>
        <div class="mid"><div class="big">${esc(dayLabel(_date))}</div>
          <input id="sr-date" type="date" value="${esc(_date)}" max="${today}" /></div>
        <button type="button" id="sr-next" title="Next day" ${_date >= today ? 'disabled' : ''}>▶</button>
      </div>
      ${_saved ? `<div class="se-note" style="background:#dcfce7;border:2px solid #16a34a;color:#14532d;font-weight:800;font-size:17px;text-align:center;">✓ Saved · सेव हो गया · સેવ થઈ ગયું</div>` : ''}
      ${!_saved && e.entered ? `<div class="se-note" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;">This day is already filled. Change a number and press Save again.<br><small>यह दिन भर दिया है — बदलना हो तो बदलकर फिर से Save दबाएँ · આ દિવસ ભરાઈ ગયો છે — બદલવું હોય તો બદલીને ફરી Save દબાવો</small></div>` : ''}
      ${d.before_opening ? `<div class="se-note" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;">Before the opening balance date — this day does not change the cash.</div>` : ''}
      <div id="sr-entry">
        ${GROUPS.map((g) => `<div class="se-group" style="border-left-color:${g.colour};">
          <h3 style="color:${g.colour};">${esc(g.group[0])} <span>· ${esc(g.group[1])} · ${esc(g.group[2])}</span></h3>
          ${g.items.map(([k, en, hi, gu]) => `<div class="se-row"><label for="sr-${k}">${esc(en)}<small>${esc(hi)} · ${esc(gu)}</small></label>
            <input id="sr-${k}" data-f="${k}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${esc(val(k))}" /></div>`).join('')}
        </div>`).join('')}
        <div class="se-sum" id="sr-calc"></div>
        <button type="button" class="se-save" id="sr-save">Save · सेव करें · સેવ કરો</button>
        ${M.admin ? `<details class="se-admin"><summary style="cursor:pointer;color:#64748b;">Admin options</summary>
          <div class="sr-card" style="margin-top:8px;">
            <div class="sr-f"><label for="sr-op">Op. Balance<span class="hint">Carried from the day before: ${money(d.cash_carried)}. Type a figure only to adjust the cash.</span></label>
              <input id="sr-op" type="number" step="0.01" value="${esc(e.cash_open_override ?? '')}" placeholder="${esc(n0(d.cash_carried))}" style="${H.CONTROL}" /></div>
            ${H.textarea('sr-note', 'Note', e.note || '', { rows: 2 })}
            ${e.entered ? '<button class="btn-secondary btn-sm" id="sr-del" style="color:#dc2626;margin-top:8px;">Delete this day</button>' : ''}
          </div></details>` : ''}
      </div>
    </div>`;
  }
  function readEntry() {
    const out = {};
    document.querySelectorAll('#sr-entry [data-f]').forEach((i) => { out[i.getAttribute('data-f')] = i.value; });
    // The Op. balance adjustment is an Admin option; everyone else keeps
    // whatever is saved for the day.
    const op = document.getElementById('sr-op');
    out.cash_open_override = op ? op.value : (DAY.entry?.cash_open_override ?? '');
    const note = document.getElementById('sr-note');
    out.note = note ? note.value.trim() : (DAY.entry?.note || '');
    return out;
  }
  function paintCalc() {
    const box = document.getElementById('sr-calc');
    if (!box) return;
    const x = readEntry();
    const v = (k) => Number(x[k]) || 0;
    const total = v('cash_sales') - v('sales_return') + v('card_credit_sales');
    const open = x.cash_open_override !== '' && x.cash_open_override != null ? Number(x.cash_open_override) || 0 : DAY.cash_carried;
    const close = open + v('cash_sales') - v('cash_deposit') + v('cash_received') - v('cash_expense');
    box.innerHTML = `<div><small>Total sale · कुल बिक्री · કુલ વેચાણ</small><b>${money(total)}</b></div>
      <div class="cash"><small>Cash in drawer · गल्ले में नकद · ગલ્લામાં રોકડ</small><b>${money(close)}</b></div>`;
  }

  /* ── Monthly report (the sheet's tab) ─────────────────────────────── */

  function reportTab() {
    const m = MONTH;
    return `<div class="sr-wrap"><table class="sr-tbl">
      <thead><tr><th>${esc(monthName(m.month))}</th>${m.days.map((d) => `<th data-open="${d.day}" title="Open in Daily Entry">${dd(d.day)}</th>`).join('')}<th class="bl">Month</th></tr></thead>
      <tbody>${LINES.map(([k, l, cls]) => (k === 'h' ? `<tr class="h"><td colspan="${m.days.length + 2}">${esc(l)}</td></tr>`
        : `<tr class="${cls || ''}"><td>${esc(l)}</td>${m.days.map((d) => {
          const v = cellOf(d, k);
          const adj = k === 'cash_open' && d.cash_open_override != null;
          return `<td class="${v == null ? 'blank' : ''}${adj ? ' adj' : ''}"${adj ? ` title="Adjusted (carried ${n0(d.cash_carried)})"` : ''}>${v == null ? '·' : n0(v)}</td>`;
        }).join('')}<td class="bl"><b>${n0(monthTotal(m, k))}</b></td></tr>`)).join('')}
      </tbody></table></div>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Blank days (·) have no entry; balances carry across them. A shaded Op. Balance was adjusted by hand. Click a date to open it.</div>`;
  }

  async function downloadXlsx() {
    const XLSX = await Utils.loadXlsx();
    if (!XLSX) return H.fail(new Error('Could not load the Excel library — check the internet connection'));
    const m = MONTH;
    const aoa = [[`${_branch} — Shop Daily Report — ${monthName(m.month)}`], [], ['', ...m.days.map((d) => d.day), 'Month']];
    for (const [k, l] of LINES) {
      if (k === 'h') { aoa.push([l]); continue; }
      aoa.push([l, ...m.days.map((d) => { const v = cellOf(d, k); return v == null ? '' : v; }), monthTotal(m, k)]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 38 }, ...m.days.map(() => ({ wch: 11 })), { wch: 13 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthName(m.month).slice(0, 30));
    XLSX.writeFile(wb, `Shop Daily Report ${_branch} ${m.month}.xlsx`);
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  function settingsTab() {
    return `<div class="sr-grid">
      <div class="sr-card"><h3>Opening cash</h3>
        <div style="font-size:12px;color:#64748b;margin-bottom:10px;">The cash at the END of the date — the running balance starts the next day.</div>
        ${M.branches.map((b) => { const o = M.opening[b] || {}; return `<div style="border-top:1px solid #f1f5f9;padding:10px 0;">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">${esc(b)}</div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) auto;gap:6px;align-items:end;">
            <div><label style="${H.LABEL}">As at</label><input type="date" data-ob="${esc(b)}" data-k="date" value="${esc(o.date || '')}" style="${H.CONTROL}" /></div>
            <div><label style="${H.LABEL}">Cash ₹</label><input type="number" step="0.01" data-ob="${esc(b)}" data-k="cash" value="${esc(o.cash ?? '')}" style="${H.CONTROL}" /></div>
            <button class="btn-primary btn-sm" data-ob-save="${esc(b)}">Save</button>
          </div></div>`; }).join('')}
      </div>
      <div class="sr-card"><h3>Import from the Google Sheet</h3>
        <div style="font-size:12.5px;color:#475569;line-height:1.55;">
          Brings every month tab of <a href="https://docs.google.com/spreadsheets/d/${esc(M.sheet)}" target="_blank" rel="noopener">Retail shop Daily report</a> into the branch below
          — sales, purchases and the cash block; where the sheet's Op. Balance was adjusted by hand, the adjustment comes too.
          Days already saved here are left alone unless you tick below. Safe to run again.</div>
        <div style="display:flex;gap:8px;align-items:end;margin:10px 0;flex-wrap:wrap;">
          <div><label style="${H.LABEL}">Into branch</label><select id="sr-imp-branch" style="${H.CONTROL}min-width:160px;">${M.branches.map((b) => `<option${/satel/i.test(b) ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
          <label style="display:flex;gap:6px;align-items:center;font-size:12.5px;"><input type="checkbox" id="sr-overwrite" /> Also overwrite days saved in the ERP</label>
        </div>
        <button class="btn-primary btn-sm" id="sr-import">Import now</button>
        <div id="sr-import-out" style="font-size:12.5px;color:#334155;margin-top:10px;"></div>
      </div>
    </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-sr-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-sr-tab'); _saved = false; show(); }));
    $('sr-branch')?.addEventListener('change', (e) => { _branch = e.target.value; remember(_branch); show(); });
    document.querySelectorAll('[data-branch]').forEach((b) => b.addEventListener('click', () => { _branch = b.getAttribute('data-branch'); remember(_branch); _saved = false; show(); }));
    $('sr-date')?.addEventListener('change', (e) => { if (e.target.value) { _date = e.target.value; _saved = false; show(); } });
    const shift = (n) => { const d = new Date(_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= istToday()) { _date = iso; _saved = false; show(); } };
    $('sr-prev')?.addEventListener('click', () => shift(-1));
    $('sr-next')?.addEventListener('click', () => shift(1));
    $('sr-month')?.addEventListener('change', (e) => { if (e.target.value) { _month = e.target.value; show(); } });
    $('sr-xlsx')?.addEventListener('click', () => downloadXlsx().catch(H.fail));
    document.querySelectorAll('[data-open]').forEach((th) => th.addEventListener('click', () => { _date = th.getAttribute('data-open'); _tab = 'entry'; show(); }));

    if (_tab === 'entry' && DAY) {
      $('sr-entry')?.addEventListener('input', (e) => { if (e.target.matches('[data-f],#sr-op')) { _saved = false; paintCalc(); } });
      paintCalc();
      $('sr-save')?.addEventListener('click', async (e) => {
        const btn = e.target;
        try {
          const body = { branch: _branch, date: _date, ...readEntry() };
          btn.disabled = true; btn.textContent = 'Saving… · सेव हो रहा है…';
          await H.api(`${API}/day`, { method: 'PUT', body: JSON.stringify(body) });
          if (!M.lastDay[_branch] || _date > M.lastDay[_branch]) M.lastDay[_branch] = _date;
          _saved = true;
          await show();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) { btn.disabled = false; btn.textContent = 'Save · सेव करें · સેવ કરો'; H.fail(err); }
      });
      $('sr-del')?.addEventListener('click', async () => {
        if (!(await Utils.showConfirm(`Delete ${_branch}'s entry for ${H.fmtDate(_date)}? Balances after it will change.`, { title: 'Delete day', confirmText: 'Delete', danger: true }))) return;
        try { await H.del(`${API}/day?branch=${encodeURIComponent(_branch)}&date=${_date}`); H.toast('Deleted'); await show(); } catch (err) { H.fail(err); }
      });
    }

    document.querySelectorAll('[data-ob-save]').forEach((b) => b.addEventListener('click', async () => {
      const br = b.getAttribute('data-ob-save');
      const get = (k) => document.querySelector(`[data-ob="${CSS.escape(br)}"][data-k="${k}"]`).value;
      try {
        if (!get('date')) throw new Error('Enter the date');
        b.disabled = true;
        await H.post(`${API}/opening`, { branch: br, date: get('date'), cash: get('cash') });
        H.toast(`${br} opening saved`);
        M = await H.api(`${API}/meta`); render();
      } catch (err) { b.disabled = false; H.fail(err); }
    }));
    $('sr-import')?.addEventListener('click', async (e) => {
      const btn = e.target;
      const out = $('sr-import-out');
      btn.disabled = true; out.textContent = 'Importing — this takes a few seconds…';
      try {
        const r = await H.post(`${API}/import`, { branch: H.val('sr-imp-branch'), overwrite: $('sr-overwrite').checked });
        out.innerHTML = `<b>${esc(r.branch)}</b>: ${r.days} days (${H.fmtDate(r.from)} → ${H.fmtDate(r.to)})${r.keptErp ? `, ${r.keptErp} kept as saved in the ERP` : ''}; ${r.adjustments} hand adjustments of the Op. Balance kept; opening ${money(r.opening?.cash)} as at ${H.fmtDate(r.opening?.date)}.`;
        H.toast('Import done');
        M = await H.api(`${API}/meta`);
        btn.disabled = false;
      } catch (err) { btn.disabled = false; out.textContent = ''; H.fail(err); }
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Shop Daily Report…');
      try { await loadMeta(); await loadTab(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load the Shop Daily Report', e.message); }
    },
  };
})();
