/* =====================================================================
   Retail Daily Sales (route 'retail-sales', Retail section)
   ---------------------------------------------------------------------
   A shop enters its day once — card, UPI, cash, returns, expense, bank
   deposit, credit sales, purchases — and the page draws both layouts the
   shops kept in Google Sheets: the monthly "Daily report" (days across)
   and the "As Per Tally" register (a row per day), with the running cash
   and credit balances, month-to-date and financial-year totals worked
   out. Server side: backend/retail-sales.js.
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

  const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const n0 = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  const money = (v) => (v == null ? '—' : '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  const dd = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}`; };
  const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };

  const FIELDS = [
    { group: 'Sales', items: [
      ['tally_sales', 'Total Sales as per Tally', 'Optional — the day\'s sales figure from Tally'],
    ] },
    { group: 'Credit Card', items: [
      ['card_sales', 'Card Sales'],
      ['card_received', 'Amount Received in Bank', 'Leave 0 until it reaches the bank'],
    ] },
    { group: 'Paytm / UPI', items: [
      ['upi_sales', 'UPI Sales'],
      ['upi_received', 'Amount Received in Bank'],
    ] },
    { group: 'Cash', items: [
      ['cash_sales', 'Cash Sales'],
      ['cash_received', 'Cash Received (H.O. / Party Payment)'],
      ['sales_return', 'Sales Return (cash paid back)'],
      ['cash_expense', 'Cash Expense'],
      ['cash_deposit', 'Cash Deposited in Bank'],
    ] },
    { group: 'Purchases', items: [
      ['purchases', 'Purchases'],
      ['purchase_return', 'Purchase Return'],
    ] },
  ];

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function loadMeta() {
    M = await H.api('/api/retail-sales/meta');
    if (!_branch || !M.branches.includes(_branch)) _branch = M.branches[0] || '';
    if (!_month) _month = istToday().slice(0, 7);
    if (!_date) _date = istToday();
  }
  async function loadTab() {
    if (!_branch) return;
    if (_tab === 'entry') DAY = await H.api(`/api/retail-sales/day?branch=${encodeURIComponent(_branch)}&date=${_date}`);
    if (_tab === 'report' || _tab === 'register') MONTH = await H.api(`/api/retail-sales/month?branch=${encodeURIComponent(_branch)}&month=${_month}`);
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
      { key: 'entry', label: 'Daily Entry' },
      { key: 'report', label: 'Monthly Report' },
      { key: 'register', label: 'As per Tally' },
      { key: 'credit', label: 'Credit Parties' },
    ];
    if (M.admin) tabs.push({ key: 'settings', label: 'Settings' });
    const body = !_branch ? H.empty('No branches yet', 'Add the branches on Retail Dashboard → Manage Lists.')
      : _tab === 'entry' ? entryTab() : _tab === 'report' ? reportTab() : _tab === 'register' ? registerTab() : _tab === 'credit' ? creditTab() : settingsTab();
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
      </style>
      ${H.header('Daily Sales Report', 'Each shop\'s day: sales, cash, credit and purchases — the two daily sheets in one place')}
      ${H.tabs('rs', tabs, _tab)}
      ${_branch && _tab !== 'settings' ? `<div class="rs-bar">
        <select id="rs-branch" style="${H.CONTROL}max-width:200px;">${M.branches.map((b) => `<option${b === _branch ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
        ${_tab === 'entry' ? `<input id="rs-date" type="date" value="${esc(_date)}" max="${istToday()}" style="${H.CONTROL}max-width:170px;" />
          <button class="btn-secondary btn-sm" id="rs-prev">‹ Prev day</button><button class="btn-secondary btn-sm" id="rs-next">Next day ›</button>` : ''}
        ${_tab === 'report' || _tab === 'register' ? `<input id="rs-month" type="month" value="${esc(_month)}" style="${H.CONTROL}max-width:170px;" />
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
    const val = (k) => (e.entered || (e.credit && e.credit.length) ? (k === 'tally_sales' ? (e[k] ?? '') : (e[k] || '')) : (k === 'cash_expense' && d.logged_cash_expense ? d.logged_cash_expense : ''));
    const lines = (e.credit && e.credit.length ? e.credit : []);
    return `
      ${d.before_opening ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        This date is on or before the opening balance date (${H.fmtDate(M.opening[_branch]?.date)}) — it does not change any balance.</div>` : ''}
      ${e.entered ? `<div style="font-size:11.5px;color:#64748b;margin-bottom:8px;">Saved${e.updated_by ? ' by ' + esc(e.updated_by) : ''}${e.source === 'sheet' ? ' (imported from the Google Sheet)' : ''} — change anything and Save again.</div>` : ''}
      <div class="rs-grid" id="rs-entry">
        ${FIELDS.map((g) => `<div class="rs-card"><h3>${esc(g.group)}</h3>
          ${g.items.map(([k, l, hint]) => `<div class="rs-f"><label for="rs-${k}">${esc(l)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>
            <input id="rs-${k}" data-f="${k}" type="number" step="0.01" min="0" value="${esc(val(k))}" style="${H.CONTROL}" /></div>`).join('')}
          ${g.group === 'Cash' && d.logged_cash_expense ? `<div style="font-size:11px;color:#94a3b8;">Cash expenses logged on Retail Dashboard for this day: ${money(d.logged_cash_expense)}</div>` : ''}
        </div>`).join('')}
        <div class="rs-card" style="grid-column:1 / -1;">
          <h3>Credit Sales</h3>
          <datalist id="rs-parties">${(d.parties || []).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
          <div id="rs-credit">${(lines.length ? lines : []).map(creditRow).join('')}</div>
          <button type="button" class="btn-secondary btn-sm" id="rs-add-credit">+ Add credit line</button>
          <div style="font-size:11px;color:#94a3b8;margin-top:6px;">One line per party: what was sold on credit today and/or what they paid today.</div>
        </div>
        <div class="rs-card" style="grid-column:1 / -1;">
          <h3>Worked out</h3>
          <div id="rs-calc"></div>
          ${H.textarea('rs-note', 'Note (optional)', e.note || '', { rows: 2 })}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;flex-wrap:wrap;">
            ${M.admin && e.entered ? '<button class="btn-secondary btn-sm" id="rs-del" style="color:#dc2626;margin-right:auto;">Delete this day</button>' : ''}
            <button class="btn-primary btn-sm" id="rs-save">Save ${esc(_branch)} · ${H.fmtDate(_date)}</button>
          </div>
        </div>
      </div>`;
  }
  const creditRow = (c = {}) => `<div class="rs-cr" style="display:grid;grid-template-columns:2fr 1fr 1fr 32px;gap:6px;margin-bottom:6px;">
      <input list="rs-parties" value="${esc(c.party || '')}" placeholder="Party name" style="${H.CONTROL}" data-c="party" />
      <input type="number" step="0.01" min="0" value="${esc(c.sale || '')}" placeholder="Credit sale ₹" style="${H.CONTROL}text-align:right;" data-c="sale" />
      <input type="number" step="0.01" min="0" value="${esc(c.received || '')}" placeholder="Received ₹" style="${H.CONTROL}text-align:right;" data-c="received" />
      <button type="button" class="btn-secondary btn-sm" data-del-credit title="Remove" style="padding:0;">×</button></div>`;

  function readEntry() {
    const out = {};
    document.querySelectorAll('[data-f]').forEach((i) => { out[i.getAttribute('data-f')] = i.value; });
    out.credit = [...document.querySelectorAll('#rs-credit .rs-cr')].map((r) => ({
      party: r.querySelector('[data-c="party"]').value.trim(), sale: r.querySelector('[data-c="sale"]').value, received: r.querySelector('[data-c="received"]').value,
    })).filter((c) => c.party || Number(c.sale) || Number(c.received));
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
    const row = (l, n, strong) => `<div class="rs-calc"><span>${esc(l)}</span>${strong ? `<b>${money(n)}</b>` : `<span>${money(n)}</span>`}</div>`;
    box.innerHTML = `<div class="rs-grid" style="gap:0 24px;">
      <div>${row('Total Sales (cash + card + UPI + credit − return)', total, true)}
        ${x.tally_sales !== '' ? row('Difference from Tally sales', total - cs - v('tally_sales') + v('sales_return')) : ''}
        ${row('Card bank charge', v('card_sales') - v('card_received'))}${row('UPI bank charge', v('upi_sales') - v('upi_received'))}</div>
      <div>${row('Opening physical cash', DAY.cash_open)}${row('Closing physical cash', close, true)}
        ${row('Credit outstanding after today', DAY.credit_open + cs - cr, true)}${row('Net purchases', v('purchases') - v('purchase_return'))}</div>
    </div>`;
  }

  /* ── Monthly report (the "Daily report" sheet, days across) ────────── */

  function monthLines() {
    return [
      ['h', 'Sales'],
      ['cash_sales', 'Cash Sales'],
      ['sales_return', '(−) Returns'],
      ['card_upi_credit', '(+) Card, UPI & Credit Sales'],
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
      ['sales_return', '(−) Sales Return'],
      ['cash_close', 'Closing Balance', 't'],
    ];
  }
  const ALWAYS = new Set(['mtd_sales', 'fy_sales', 'mtd_purchases', 'fy_purchases', 'cash_open', 'cash_close']);
  const cellOf = (d, k) => (d.entered || d.credit.length || ALWAYS.has(k) ? d[k] : null);

  function reportTab() {
    const m = MONTH;
    const days = m.days;
    const totalOf = (k) => (['mtd_sales', 'fy_sales', 'mtd_purchases', 'fy_purchases', 'cash_close'].includes(k) ? days[days.length - 1][k]
      : k === 'cash_open' ? days[0].cash_open : k === 'card_upi_credit' ? m.totals.card_sales + m.totals.upi_sales + m.totals.credit_sales : m.totals[k]);
    return `<div class="rs-wrap"><table class="rs-tbl">
      <thead><tr><th>${esc(monthName(m.month))}</th>${days.map((d) => `<th>${dd(d.day)}</th>`).join('')}<th class="bl">Month</th></tr></thead>
      <tbody>${monthLines().map(([k, l, cls]) => (k === 'h' ? `<tr class="h"><td colspan="${days.length + 2}">${esc(l)}</td></tr>`
        : `<tr class="${cls || ''}"><td>${esc(l)}</td>${days.map((d) => { const v = cellOf(d, k); return `<td class="${v == null ? 'blank' : ''}">${v == null ? '·' : n0(v)}</td>`; }).join('')}<td class="bl"><b>${n0(totalOf(k))}</b></td></tr>`)).join('')}
      </tbody></table></div>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Blank days (·) have no entry yet; balances carry across them.</div>`;
  }

  /* ── As per Tally register (a row per day) ─────────────────────────── */

  const REG = [
    { g: 'Sales', cols: [['tally_sales', 'Amount (Tally)'], ['total_sales', 'Total']] },
    { g: 'Credit Card', cols: [['card_sales', 'Sales'], ['card_received', 'Recd in Bank'], ['card_charge', 'Bal / Charge']] },
    { g: 'Paytm / UPI', cols: [['upi_sales', 'Sales'], ['upi_received', 'Recd in Bank'], ['upi_charge', 'Bal / Charge']] },
    { g: 'Cash', cols: [['cash_sales', 'Sales'], ['cash_received', 'Cash Recd'], ['sales_return', 'Return'], ['cash_expense', 'Expense'], ['cash_deposit', 'Deposited'], ['cash_close', 'Balance (Physical)']] },
    { g: 'Credit Sales', cols: [['party', 'Party'], ['credit_sales', 'Sales'], ['credit_received', 'Received'], ['credit_close', 'Balance']] },
    { g: 'Purchases', cols: [['purchases', 'Purchases'], ['purchase_return', 'Return']] },
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
    const rep = [[`${_branch} — Daily Report — ${monthName(m.month)}`], [], ['', ...m.days.map((d) => d.day), 'Month']];
    for (const [k, l] of monthLines()) {
      if (k === 'h') { rep.push([l]); continue; }
      const last = m.days[m.days.length - 1];
      const total = ['mtd_sales', 'fy_sales', 'mtd_purchases', 'fy_purchases', 'cash_close'].includes(k) ? last[k] : k === 'cash_open' ? m.days[0].cash_open
        : k === 'card_upi_credit' ? m.totals.card_sales + m.totals.upi_sales + m.totals.credit_sales : m.totals[k];
      rep.push([l, ...m.days.map((d) => { const v = cellOf(d, k); return v == null ? '' : v; }), total]);
    }
    const ws1 = XLSX.utils.aoa_to_sheet(rep);
    ws1['!cols'] = [{ wch: 38 }, ...m.days.map(() => ({ wch: 11 })), { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Daily Report');
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
    XLSX.writeFile(wb, `Daily Sales ${_branch} ${m.month}.xlsx`);
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
          • <a href="https://docs.google.com/spreadsheets/d/${esc(M.sheets.tally)}" target="_blank" rel="noopener">Retail Shop Daily Report (As Per Tally)</a> — every branch tab, every day, credit lines and the opening cash<br>
          • <a href="https://docs.google.com/spreadsheets/d/${esc(M.sheets.daily)}" target="_blank" rel="noopener">Retail shop Daily report</a> — Satellite's purchases<br>
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
    document.querySelectorAll('[data-rs-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-rs-tab'); show(); }));
    $('rs-branch')?.addEventListener('change', (e) => { _branch = e.target.value; show(); });
    $('rs-date')?.addEventListener('change', (e) => { if (e.target.value) { _date = e.target.value; show(); } });
    const shift = (n) => { const d = new Date(_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= istToday()) { _date = iso; show(); } };
    $('rs-prev')?.addEventListener('click', () => shift(-1));
    $('rs-next')?.addEventListener('click', () => shift(1));
    $('rs-month')?.addEventListener('change', (e) => { if (e.target.value) { _month = e.target.value; show(); } });
    $('rs-xlsx')?.addEventListener('click', () => downloadXlsx().catch(H.fail));
    document.querySelectorAll('[data-open]').forEach((r) => r.addEventListener('click', () => { _date = r.getAttribute('data-open'); _tab = 'entry'; show(); }));

    if (_tab === 'entry' && DAY) {
      const box = $('rs-credit');
      $('rs-add-credit')?.addEventListener('click', () => { box.insertAdjacentHTML('beforeend', creditRow()); paintCalc(); });
      box?.addEventListener('click', (e) => { if (e.target.closest('[data-del-credit]')) { e.target.closest('.rs-cr').remove(); paintCalc(); } });
      $('rs-entry')?.addEventListener('input', (e) => { if (e.target.matches('[data-f],[data-c]')) paintCalc(); });
      paintCalc();
      $('rs-save')?.addEventListener('click', async (e) => {
        const btn = e.target;
        try {
          const body = { branch: _branch, date: _date, note: H.val('rs-note').trim(), ...readEntry() };
          if (body.credit.some((c) => !c.party)) throw new Error('Each credit line needs the party name');
          btn.disabled = true;
          await H.api('/api/retail-sales/day', { method: 'PUT', body: JSON.stringify(body) });
          H.toast(`${_branch} · ${H.fmtDate(_date)} saved`);
          M.lastDay[_branch] = !M.lastDay[_branch] || _date > M.lastDay[_branch] ? _date : M.lastDay[_branch];
          await show();
        } catch (err) { btn.disabled = false; H.fail(err); }
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
          + (r.purchases ? `<br><b>${esc(r.purchases.branch)}</b> purchases: ${r.purchases.days} days` : '')
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
