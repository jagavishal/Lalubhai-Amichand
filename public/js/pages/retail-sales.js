/* =====================================================================
   Daily Report as per Tally (route 'retail-sales', Retail section)
   ---------------------------------------------------------------------
   Was the "Retail Shop Daily Report (As Per Tally)" Google Sheet. A day
   is entered once per branch — card and UPI sales vs what reached the
   bank, cash sales / received / return / expense / deposit, credit sales
   by party — and the register (a row per day) shows the bank charges and
   the running physical cash and credit balances. Its own users; the
   shop's own sheet is a separate page (retail-shop-report.js). Server
   side: backend/retail-sales.js.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['retail-sales'] = (() => {
  const H = window.HR;
  const esc = H.esc;

  let M = null;            // /meta
  let _tab = 'entry';
  let _branch = '';
  let _month = '';
  let _date = '';
  let MONTH = null;        // /month for _branch + _month
  let DAY = null;          // /day for _branch + _date
  let CREDIT = null;       // /credit for _branch
  let _saved = false;      // show the big "saved" banner once after a save

  const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const n0 = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  const money = (v) => (v == null ? '—' : '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };

  // The entry form, in the order the day is counted. Every label in
  // English, Hindi and Gujarati — the people filling it read those.
  const FIELDS = [
    { group: ['Card', 'कार्ड', 'કાર્ડ'], colour: '#2563eb', items: [
      ['card_sales', 'Card sale', 'कार्ड बिक्री', 'કાર્ડ વેચાણ'],
      ['card_received', 'Card money came in bank', 'कार्ड का पैसा बैंक में आया', 'કાર્ડના પૈસા બેંકમાં આવ્યા'],
    ] },
    { group: ['Paytm / UPI', 'पेटीएम / UPI', 'પેટીએમ / UPI'], colour: '#0891b2', items: [
      ['upi_sales', 'Paytm / UPI sale', 'पेटीएम / UPI बिक्री', 'પેટીએમ / UPI વેચાણ'],
      ['upi_received', 'Paytm / UPI money came in bank', 'UPI का पैसा बैंक में आया', 'UPIના પૈસા બેંકમાં આવ્યા'],
    ] },
    { group: ['Cash', 'नकद', 'રોકડ'], colour: '#d97706', items: [
      ['cash_sales', 'Cash sale', 'नकद बिक्री', 'રોકડ વેચાણ'],
      ['sales_return', 'Return (money given back)', 'वापसी (पैसा वापस दिया)', 'પરત (પૈસા પાછા આપ્યા)'],
      ['cash_expense', 'Cash expense', 'नकद खर्च', 'રોકડ ખર્ચ'],
      ['cash_deposit', 'Cash deposited in bank', 'बैंक में जमा किया', 'બેંકમાં જમા કર્યા'],
      ['cash_received', 'Cash received (H.O. / party)', 'नकद आया (H.O. / पार्टी)', 'રોકડ આવી (H.O. / પાર્ટી)'],
    ] },
    { group: ['Tally', 'टैली', 'ટેલી'], colour: '#64748b', items: [
      ['tally_sales', 'Total sale in Tally (if known)', 'टैली में कुल बिक्री', 'ટેલીમાં કુલ વેચાણ'],
    ] },
  ];
  const BRANCH_KEY = 'rs-branch';
  const remember = (b) => { try { localStorage.setItem(BRANCH_KEY, b); } catch { /* private window */ } };
  const recalled = () => { try { return localStorage.getItem(BRANCH_KEY) || ''; } catch { return ''; } };
  const dayLabel = (iso) => {
    const t = istToday();
    const y = new Date(t + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
    if (iso === t) return 'Today · आज · આજે';
    if (iso === y.toISOString().slice(0, 10)) return 'Yesterday · कल · ગઈકાલે';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
  };

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function loadMeta() {
    M = await H.api('/api/retail-sales/meta');
    if (!_branch) _branch = recalled();
    if (!_branch || !M.branches.includes(_branch)) _branch = M.branches[0] || '';
    if (!_month) _month = istToday().slice(0, 7);
    if (!_date) _date = istToday();
  }
  async function loadTab() {
    if (!_branch) return;
    if (_tab === 'entry') DAY = await H.api(`/api/retail-sales/day?branch=${encodeURIComponent(_branch)}&date=${_date}`);
    if (_tab === 'register') MONTH = await H.api(`/api/retail-sales/month?branch=${encodeURIComponent(_branch)}&month=${_month}`);
    if (_tab === 'credit') CREDIT = await H.api(`/api/retail-sales/credit?branch=${encodeURIComponent(_branch)}`);
  }
  async function show() {
    const el = document.getElementById('main-content');
    try { await loadTab(); render(); } catch (e) { H.fail(e); if (el && !el.innerHTML.trim()) el.innerHTML = H.empty('Could not load', e.message); }
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const tabs = [
      { key: 'entry', label: 'Daily Entry · एंट्री' },
      { key: 'register', label: 'Register · रजिस्टर' },
      { key: 'credit', label: 'Udhaar · उधार' },
    ];
    if (M.admin) tabs.push({ key: 'settings', label: 'Settings' });
    const body = !_branch ? H.empty('No branches yet', 'Add the branches on Retail Dashboard → Manage Lists.')
      : _tab === 'entry' ? entryTab() : _tab === 'register' ? registerTab() : _tab === 'credit' ? creditTab() : settingsTab();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        .rs-bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
        .rs-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; }
        .rs-card h3 { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--color-primary); margin:0 0 10px; }
        .rs-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; }
        .rs-f { display:grid; grid-template-columns:1fr 150px; gap:8px; align-items:center; padding:4px 0; }
        .rs-f label { font-size:12.5px; color:#334155; }
        .rs-f .hint { font-size:10.5px; color:#94a3b8; display:block; }
        .rs-f input { text-align:right; }
        .rs-calc { display:flex; justify-content:space-between; font-size:12.5px; padding:5px 0; border-top:1px dashed #e2e8f0; color:#475569; }
        .rs-calc b { color:#0f172a; }
        .rs-tbl { border-collapse:collapse; font-size:12px; width:max-content; min-width:100%; }
        .rs-tbl th, .rs-tbl td { padding:6px 8px; border-bottom:1px solid #f1f5f9; white-space:nowrap; text-align:right; font-variant-numeric:tabular-nums; }
        .rs-tbl th { position:sticky; top:0; background:#f8fafc; color:#475569; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; z-index:1; }
        .rs-tbl td:first-child, .rs-tbl th:first-child { text-align:left; position:sticky; left:0; background:#fff; z-index:2; }
        .rs-tbl th:first-child { background:#f8fafc; z-index:3; }
        .rs-tbl tr.t td { font-weight:700; background:#f8fafc; }
        .rs-tbl tr.t td:first-child { background:#f8fafc; }
        .rs-tbl tr.h td { font-weight:700; color:var(--color-primary); text-transform:uppercase; font-size:10.5px; letter-spacing:.06em; background:#fff; text-align:left; }
        .rs-tbl td.blank { color:#cbd5e1; }
        .rs-tbl tr.click { cursor:pointer; } .rs-tbl tr.click:hover td { background:#eff6ff; }
        .rs-tbl .grp { text-align:center; border-left:2px solid #e2e8f0; }
        .rs-tbl td.bl, .rs-tbl th.bl { border-left:2px solid #e2e8f0; }
        .rs-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:auto; max-height:72vh; }
        @media (max-width: 767px) { .rs-f { grid-template-columns:1fr 120px; } }
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
        .se-date input { border:none; font:inherit; font-size:12.5px; color:#64748b; background:transparent; text-align:center; }
        .se-note { border-radius:12px; padding:12px 14px; font-size:14px; margin-bottom:12px; }
        .se-group { background:#fff; border:2px solid #e2e8f0; border-left-width:6px; border-radius:12px; padding:10px 14px; margin-bottom:12px; }
        .se-group h3 { margin:2px 0 8px; font-size:15px; font-weight:800; }
        .se-group h3 span { font-weight:600; color:#94a3b8; font-size:13px; }
        .se-row { display:grid; grid-template-columns:1fr 170px; gap:10px; align-items:center; padding:7px 0; border-top:1px solid #f1f5f9; }
        .se-row:first-of-type { border-top:none; }
        .se-row label { font-size:15px; font-weight:700; color:#1e293b; line-height:1.25; }
        .se-row label small { display:block; font-size:12.5px; font-weight:500; color:#64748b; }
        .se-in { width:100%; box-sizing:border-box; height:50px; font-size:20px; font-weight:700; text-align:right; padding:0 12px; border:2px solid #cbd5e1; border-radius:10px; color:#0f172a; background:#fff; }
        .se-in.txt { text-align:left; font-size:17px; }
        .se-in:focus { outline:none; border-color:var(--color-primary); }
        .se-cr { border:2px dashed #e2e8f0; border-radius:10px; padding:10px; margin-bottom:8px; }
        .se-cr .two { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
        .se-cr small { display:block; font-size:12px; color:#64748b; margin-bottom:3px; font-weight:600; }
        .se-add { width:100%; padding:12px; font-size:15px; font-weight:700; border:2px dashed #94a3b8; border-radius:10px; background:#f8fafc; color:#334155; cursor:pointer; }
        .se-sum { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:4px 0 12px; }
        .se-sum div { background:#0f172a; color:#fff; border-radius:12px; padding:12px 14px; }
        .se-sum div.cash { background:#b45309; } .se-sum div.cred { background:#7c3aed; }
        .se-sum small { display:block; font-size:12px; opacity:.85; }
        .se-sum b { display:block; font-size:22px; margin-top:4px; }
        .se-save { width:100%; padding:16px; font-size:18px; font-weight:800; border:none; border-radius:12px; background:#16a34a; color:#fff; cursor:pointer; }
        .se-save:disabled { opacity:.6; }
        .se-admin { margin-top:14px; font-size:13px; }
        @media (max-width: 560px) {
          .se-row { grid-template-columns:1fr; gap:6px; }
          .se-sum { grid-template-columns:1fr 1fr; } .se-sum div.cred { grid-column:1 / -1; }
          .se-save { position:sticky; bottom:76px; box-shadow:0 6px 20px rgba(0,0,0,.18); }
        }
      </style>
      ${H.header('Daily Report (As per Tally)', 'Each branch\'s day as per Tally: card, UPI, cash and credit sales, bank receipts and physical cash')}
      ${H.tabs('rs', tabs, _tab)}
      ${_branch && (_tab === 'register' || _tab === 'credit') ? `<div class="rs-bar">
        <select id="rs-branch" style="${H.CONTROL}max-width:200px;">${M.branches.map((b) => `<option${b === _branch ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
        ${_tab === 'register' ? `<input id="rs-month" type="month" value="${esc(_month)}" style="${H.CONTROL}max-width:170px;" />
          <button class="btn-secondary btn-sm" id="rs-xlsx" style="margin-left:auto;">Download Excel</button>` : ''}
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
    const filled = e.entered || (e.credit && e.credit.length);
    const val = (k) => (filled ? (k === 'tally_sales' ? (e[k] ?? '') : (e[k] || '')) : (k === 'cash_expense' && d.logged_cash_expense ? d.logged_cash_expense : ''));
    const lines = e.credit && e.credit.length ? e.credit : [];
    const today = istToday();
    return `<div class="se">
      ${M.branches.length > 1 ? `<div class="se-branches">${M.branches.map((b) => `<button type="button" data-branch="${esc(b)}" class="${b === _branch ? 'on' : ''}">${esc(b)}</button>`).join('')}</div>` : ''}
      <div class="se-date">
        <button type="button" id="rs-prev" title="Previous day">◀</button>
        <div class="mid"><div class="big">${esc(dayLabel(_date))}</div>
          <input id="rs-date" type="date" value="${esc(_date)}" max="${today}" /></div>
        <button type="button" id="rs-next" title="Next day" ${_date >= today ? 'disabled' : ''}>▶</button>
      </div>
      ${_saved ? `<div class="se-note" style="background:#dcfce7;border:2px solid #16a34a;color:#14532d;font-weight:800;font-size:17px;text-align:center;">✓ Saved · सेव हो गया · સેવ થઈ ગયું</div>` : ''}
      ${!_saved && filled ? `<div class="se-note" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;">This day is already filled. Change a number and press Save again.<br><small>यह दिन भर दिया है — बदलना हो तो बदलकर फिर से Save दबाएँ · આ દિવસ ભરાઈ ગયો છે — બદલવું હોય તો બદલીને ફરી Save દબાવો</small></div>` : ''}
      ${d.before_opening ? `<div class="se-note" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;">Before the opening balance date — this day does not change the cash.</div>` : ''}
      <div id="rs-entry">
        ${FIELDS.map((g) => `<div class="se-group" style="border-left-color:${g.colour};">
          <h3 style="color:${g.colour};">${esc(g.group[0])} <span>· ${esc(g.group[1])} · ${esc(g.group[2])}</span></h3>
          ${g.items.map(([k, en, hi, gu]) => `<div class="se-row"><label for="rs-${k}">${esc(en)}<small>${esc(hi)} · ${esc(gu)}</small></label>
            <input id="rs-${k}" data-f="${k}" class="se-in" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${esc(val(k))}" /></div>`).join('')}
        </div>`).join('')}
        <div class="se-group" style="border-left-color:#7c3aed;">
          <h3 style="color:#7c3aed;">Udhaar (credit) <span>· उधार · ઉધાર</span></h3>
          <datalist id="rs-parties">${(d.parties || []).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
          <div id="rs-credit">${lines.map(creditRow).join('')}</div>
          <button type="button" class="se-add" id="rs-add-credit">+ Add party · पार्टी जोड़ें · પાર્ટી ઉમેરો</button>
        </div>
        <div class="se-sum" id="rs-calc"></div>
        <button type="button" class="se-save" id="rs-save">Save · सेव करें · સેવ કરો</button>
        ${M.admin ? `<details class="se-admin"><summary style="cursor:pointer;color:#64748b;">Admin options</summary>
          <div class="rs-card" style="margin-top:8px;">
            <div style="font-size:12.5px;color:#475569;margin-bottom:8px;">Card bank charge: <b id="rs-charge-card"></b> · UPI bank charge: <b id="rs-charge-upi"></b> · Difference from Tally: <b id="rs-tally-diff"></b></div>
            ${H.textarea('rs-note', 'Note', e.note || '', { rows: 2 })}
            ${e.entered ? '<button class="btn-secondary btn-sm" id="rs-del" style="color:#dc2626;margin-top:8px;">Delete this day</button>' : ''}
          </div></details>` : ''}
      </div>
    </div>`;
  }
  const creditRow = (c = {}) => `<div class="se-cr rs-cr">
      <div style="display:flex;gap:8px;align-items:end;">
        <div style="flex:1;"><small>Party name · पार्टी का नाम · પાર્ટીનું નામ</small>
          <input class="se-in txt" list="rs-parties" value="${esc(c.party || '')}" placeholder="Name" data-c="party" /></div>
        <button type="button" data-del-credit title="Remove" style="width:50px;height:50px;border-radius:10px;border:2px solid #fecaca;background:#fff;color:#dc2626;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <div class="two">
        <div><small>Udhaar given · उधार दिया · ઉધાર આપ્યું</small><input class="se-in" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${esc(c.sale || '')}" data-c="sale" /></div>
        <div><small>Money came back · पैसा आया · પૈસા આવ્યા</small><input class="se-in" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${esc(c.received || '')}" data-c="received" /></div>
      </div></div>`;

  function readEntry() {
    const out = {};
    document.querySelectorAll('#rs-entry [data-f]').forEach((i) => { out[i.getAttribute('data-f')] = i.value; });
    out.credit = [...document.querySelectorAll('#rs-credit .rs-cr')].map((r) => ({
      party: r.querySelector('[data-c="party"]').value.trim(), sale: r.querySelector('[data-c="sale"]').value, received: r.querySelector('[data-c="received"]').value,
    })).filter((c) => c.party || Number(c.sale) || Number(c.received));
    const note = document.getElementById('rs-note');
    out.note = note ? note.value.trim() : (DAY.entry?.note || '');
    return out;
  }
  function paintCalc() {
    const box = document.getElementById('rs-calc');
    if (!box) return;
    const x = readEntry();
    const v = (k) => Number(x[k]) || 0;
    const cs = x.credit.reduce((a, c) => a + (Number(c.sale) || 0), 0);
    const cr = x.credit.reduce((a, c) => a + (Number(c.received) || 0), 0);
    const total = v('cash_sales') + v('card_sales') + v('upi_sales') + cs - v('sales_return');
    const close = DAY.cash_open + v('cash_sales') + v('cash_received') - v('sales_return') - v('cash_expense') - v('cash_deposit');
    box.innerHTML = `<div><small>Total sale · कुल बिक्री · કુલ વેચાણ</small><b>${money(total)}</b></div>
      <div class="cash"><small>Cash in drawer · गल्ले में नकद · ગલ્લામાં રોકડ</small><b>${money(close)}</b></div>
      <div class="cred"><small>Udhaar pending · बाकी उधार · બાકી ઉધાર</small><b>${money(DAY.credit_open + cs - cr)}</b></div>`;
    const put = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = money(n); };
    put('rs-charge-card', v('card_sales') - v('card_received'));
    put('rs-charge-upi', v('upi_sales') - v('upi_received'));
    put('rs-tally-diff', x.tally_sales !== '' && x.tally_sales != null ? total - cs - v('tally_sales') + v('sales_return') : null);
  }

  /* ── As per Tally register (a row per day) ─────────────────────────── */

  const REG = [
    { g: 'Sales', cols: [['tally_sales', 'Amount (Tally)'], ['total_sales', 'Total']] },
    { g: 'Credit Card', cols: [['card_sales', 'Sales'], ['card_received', 'Recd in Bank'], ['card_charge', 'Bal / Charge']] },
    { g: 'Paytm / UPI', cols: [['upi_sales', 'Sales'], ['upi_received', 'Recd in Bank'], ['upi_charge', 'Bal / Charge']] },
    { g: 'Cash', cols: [['cash_sales', 'Sales'], ['cash_received', 'Cash Recd'], ['sales_return', 'Return'], ['cash_expense', 'Expense'], ['cash_deposit', 'Deposited'], ['cash_close', 'Balance (Physical)']] },
    { g: 'Credit Sales', cols: [['party', 'Party'], ['credit_sales', 'Sales'], ['credit_received', 'Received'], ['credit_close', 'Balance']] },
  ];
  function registerTab() {
    const m = MONTH;
    const v = (d, k) => {
      if (k === 'party') return esc(d.credit.map((c) => c.party).join(' / '));
      if (k === 'cash_close' || k === 'credit_close') return n0(d[k]);
      if (!d.entered && !d.credit.length) return '<span style="color:#cbd5e1;">·</span>';
      return n0(d[k]);
    };
    const tot = (k) => (k === 'party' ? '' : k === 'cash_close' || k === 'credit_close' ? n0(m.days[m.days.length - 1][k]) : n0(m.totals[k]));
    return `<div class="rs-wrap"><table class="rs-tbl">
      <thead><tr><th rowspan="2">Date</th>${REG.map((g) => `<th class="grp" colspan="${g.cols.length}">${esc(g.g)}</th>`).join('')}</tr>
        <tr>${REG.map((g) => g.cols.map(([, l], i) => `<th class="${i === 0 ? 'bl' : ''}" style="top:28px;">${esc(l)}</th>`).join('')).join('')}</tr></thead>
      <tbody>
        <tr><td>Opening</td>${REG.map((g) => g.cols.map(([k], i) => `<td class="${i === 0 ? 'bl' : ''}">${k === 'cash_close' ? n0(m.days[0].cash_open) : k === 'credit_close' ? n0(m.days[0].credit_open) : ''}</td>`).join('')).join('')}</tr>
        ${m.days.map((d) => `<tr class="click" data-open="${d.day}"><td>${H.fmtDate(d.day)}</td>${REG.map((g) => g.cols.map(([k], i) => `<td class="${i === 0 ? 'bl' : ''}" style="${k === 'party' ? 'text-align:left;max-width:220px;overflow:hidden;text-overflow:ellipsis;' : ''}">${v(d, k)}</td>`).join('')).join('')}</tr>`).join('')}
        <tr class="t"><td>Total</td>${REG.map((g) => g.cols.map(([k], i) => `<td class="${i === 0 ? 'bl' : ''}">${tot(k)}</td>`).join('')).join('')}</tr>
      </tbody></table></div>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Click a day to open it in Daily Entry.</div>`;
  }

  async function downloadXlsx() {
    const XLSX = await Utils.loadXlsx();
    if (!XLSX) return H.fail(new Error('Could not load the Excel library — check the internet connection'));
    const m = MONTH;
    const wb = XLSX.utils.book_new();
    const cols = REG.flatMap((g) => g.cols.map(([k, l]) => [k, `${g.g} — ${l}`]));
    const reg = [[`${_branch} — As per Tally — ${monthName(m.month)}`], [], ['Date', ...cols.map(([, l]) => l)]];
    reg.push(['Opening', ...cols.map(([k]) => (k === 'cash_close' ? m.days[0].cash_open : k === 'credit_close' ? m.days[0].credit_open : ''))]);
    for (const d of m.days) {
      reg.push([d.day, ...cols.map(([k]) => (k === 'party' ? d.credit.map((c) => c.party).join(' / ')
        : (k === 'cash_close' || k === 'credit_close' || d.entered || d.credit.length) ? (d[k] ?? '') : ''))]);
    }
    const ws2 = XLSX.utils.aoa_to_sheet(reg);
    ws2['!cols'] = [{ wch: 12 }, ...cols.map(([k]) => ({ wch: k === 'party' ? 30 : 13 }))];
    XLSX.utils.book_append_sheet(wb, ws2, 'As per Tally');
    XLSX.writeFile(wb, `As per Tally ${_branch} ${m.month}.xlsx`);
  }

  /* ── Credit parties ───────────────────────────────────────────────── */

  function creditTab() {
    const c = CREDIT;
    return `${H.stats([
      { label: 'Outstanding', value: money(c.outstanding), color: c.outstanding > 0 ? '#d97706' : undefined },
      { label: 'Parties with balance', value: c.parties.filter((p) => Math.abs(p.balance) > 0.5).length },
      ...(c.openingCredit ? [{ label: 'Opening credit balance', value: money(c.openingCredit) }] : []),
    ])}
    ${H.table(['Party', { label: 'Credit Sales', align: 'right' }, { label: 'Received', align: 'right' }, { label: 'Balance', align: 'right' }, 'First', 'Last'],
      c.parties.map((p) => [`<b>${esc(p.party)}</b><div style="font-size:11px;color:#94a3b8;">${p.lines.length} entr${p.lines.length === 1 ? 'y' : 'ies'}</div>`,
        n0(p.sale), n0(p.received), `<b style="color:${p.balance > 0.5 ? '#d97706' : '#16a34a'};">${n0(p.balance)}</b>`, H.fmtDate(p.first), H.fmtDate(p.last)]),
      { empty: 'No credit sales yet', cards: true, page: { key: 'rs-credit', sig: [_branch], onPage: render } })}
    <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Parties are grouped by the name exactly as typed — type the same name each time so a party's sales and payments meet.</div>`;
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  function settingsTab() {
    return `<div class="rs-grid">
      <div class="rs-card"><h3>Opening balances</h3>
        <div style="font-size:12px;color:#64748b;margin-bottom:10px;">The physical cash (and credit outstanding) at the END of the date — running balances start the next day.</div>
        ${M.branches.map((b) => { const o = M.opening[b] || {}; return `<div style="border-top:1px solid #f1f5f9;padding:10px 0;">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">${esc(b)}</div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:6px;align-items:end;">
            <div><label style="${H.LABEL}">As at</label><input type="date" data-ob="${esc(b)}" data-k="date" value="${esc(o.date || '')}" style="${H.CONTROL}" /></div>
            <div><label style="${H.LABEL}">Cash ₹</label><input type="number" step="0.01" data-ob="${esc(b)}" data-k="cash" value="${esc(o.cash ?? '')}" style="${H.CONTROL}" /></div>
            <div><label style="${H.LABEL}">Credit ₹</label><input type="number" step="0.01" data-ob="${esc(b)}" data-k="credit" value="${esc(o.credit ?? '')}" style="${H.CONTROL}" /></div>
            <button class="btn-primary btn-sm" data-ob-save="${esc(b)}">Save</button>
          </div></div>`; }).join('')}
      </div>
      <div class="rs-card"><h3>Import from the Google Sheets</h3>
        <div style="font-size:12.5px;color:#475569;line-height:1.55;">
          Brings the year so far over from<br>
          <a href="https://docs.google.com/spreadsheets/d/${esc(M.sheets.tally)}" target="_blank" rel="noopener">Retail Shop Daily Report (As Per Tally)</a> — every branch tab, every day, credit lines and the opening cash.<br>
          Days already saved here are left alone unless you tick below. Safe to run again.</div>
        <label style="display:flex;gap:6px;align-items:center;font-size:12.5px;margin:10px 0;"><input type="checkbox" id="rs-overwrite" /> Also overwrite days saved in the ERP</label>
        <button class="btn-primary btn-sm" id="rs-import">Import now</button>
        <div id="rs-import-out" style="font-size:12.5px;color:#334155;margin-top:10px;"></div>
      </div>
    </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-rs-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-rs-tab'); _saved = false; show(); }));
    $('rs-branch')?.addEventListener('change', (e) => { _branch = e.target.value; remember(_branch); show(); });
    document.querySelectorAll('[data-branch]').forEach((b) => b.addEventListener('click', () => { _branch = b.getAttribute('data-branch'); remember(_branch); _saved = false; show(); }));
    $('rs-date')?.addEventListener('change', (e) => { if (e.target.value) { _date = e.target.value; _saved = false; show(); } });
    const shift = (n) => { const d = new Date(_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= istToday()) { _date = iso; _saved = false; show(); } };
    $('rs-prev')?.addEventListener('click', () => shift(-1));
    $('rs-next')?.addEventListener('click', () => shift(1));
    $('rs-month')?.addEventListener('change', (e) => { if (e.target.value) { _month = e.target.value; show(); } });
    $('rs-xlsx')?.addEventListener('click', () => downloadXlsx().catch(H.fail));
    document.querySelectorAll('[data-open]').forEach((r) => r.addEventListener('click', () => { _date = r.getAttribute('data-open'); _tab = 'entry'; show(); }));

    if (_tab === 'entry' && DAY) {
      const box = $('rs-credit');
      $('rs-add-credit')?.addEventListener('click', () => { box.insertAdjacentHTML('beforeend', creditRow()); paintCalc(); });
      box?.addEventListener('click', (e) => { if (e.target.closest('[data-del-credit]')) { e.target.closest('.rs-cr').remove(); paintCalc(); } });
      $('rs-entry')?.addEventListener('input', (e) => { if (e.target.matches('[data-f],[data-c]')) { _saved = false; paintCalc(); } });
      paintCalc();
      $('rs-save')?.addEventListener('click', async (e) => {
        const btn = e.target;
        try {
          const body = { branch: _branch, date: _date, ...readEntry() };
          if (body.credit.some((c) => !c.party)) throw new Error('Write the party name · पार्टी का नाम लिखें · પાર્ટીનું નામ લખો');
          btn.disabled = true; btn.textContent = 'Saving… · सेव हो रहा है…';
          await H.api('/api/retail-sales/day', { method: 'PUT', body: JSON.stringify(body) });
          M.lastDay[_branch] = !M.lastDay[_branch] || _date > M.lastDay[_branch] ? _date : M.lastDay[_branch];
          _saved = true;
          await show();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) { btn.disabled = false; btn.textContent = 'Save · सेव करें · સેવ કરો'; H.fail(err); }
      });
      $('rs-del')?.addEventListener('click', async () => {
        if (!(await Utils.showConfirm(`Delete ${_branch}'s entry for ${H.fmtDate(_date)}? Balances after it will change.`, { title: 'Delete day', confirmText: 'Delete', danger: true }))) return;
        try { await H.del(`/api/retail-sales/day?branch=${encodeURIComponent(_branch)}&date=${_date}`); H.toast('Deleted'); await show(); } catch (err) { H.fail(err); }
      });
    }

    document.querySelectorAll('[data-ob-save]').forEach((b) => b.addEventListener('click', async () => {
      const br = b.getAttribute('data-ob-save');
      const get = (k) => document.querySelector(`[data-ob="${CSS.escape(br)}"][data-k="${k}"]`).value;
      try {
        if (!get('date')) throw new Error('Enter the date');
        b.disabled = true;
        await H.post('/api/retail-sales/opening', { branch: br, date: get('date'), cash: get('cash'), credit: get('credit') });
        H.toast(`${br} opening saved`);
        M = await H.api('/api/retail-sales/meta'); render();
      } catch (err) { b.disabled = false; H.fail(err); }
    }));
    $('rs-import')?.addEventListener('click', async (e) => {
      const btn = e.target;
      const out = $('rs-import-out');
      btn.disabled = true; out.textContent = 'Importing — this takes a few seconds…';
      try {
        const r = await H.post('/api/retail-sales/import', { overwrite: $('rs-overwrite').checked });
        out.innerHTML = Object.entries(r.branches).map(([b, x]) => `<b>${esc(b)}</b>: ${x.days} days (${H.fmtDate(x.from)} → ${H.fmtDate(x.to)})${x.keptErp ? `, ${x.keptErp} kept as saved in the ERP` : ''}; opening cash ${money(x.openingCash)}`).join('<br>')
          + (r.skipped.length ? `<br><span style="color:#b45309;">Tabs with no matching branch: ${esc(r.skipped.join(', '))}</span>` : '');
        H.toast('Import done');
        M = await H.api('/api/retail-sales/meta');
        btn.disabled = false;
      } catch (err) { btn.disabled = false; out.textContent = ''; H.fail(err); }
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Daily Sales…');
      try { await loadMeta(); await loadTab(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load Daily Sales', e.message); }
    },
  };
})();
