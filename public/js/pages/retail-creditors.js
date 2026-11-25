/* =====================================================================
   Retail Creditor List (route 'retail-creditors', Retail section)
   ---------------------------------------------------------------------
   The shops' "Creditor List" sheet (Sachin, 25 Nov 2026). Choose the shop,
   upload the bills (Party Name · Bill Date · Bill No · Amount), and the page
   works out party-wise totals, the grand total, days since each bill and
   Overdue past 60 days. Tick a party's bills → Settle with the cheque number
   and signing date; settled bills stay in the register.
   Server side: backend/retail-creditors.js.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['retail-creditors'] = (() => {
  const H = window.HR;
  const esc = H.esc;

  let M = null;          // /meta
  let B = null;          // /bills for _branch
  let _branch = '';
  let _status = 'open';  // open | overdue | settled | all
  let _month = '';       // '' = all months, else 'YYYY-MM' (bill month)
  let _q = '';
  let _ticked = new Set();

  const KEY = 'rc-branch';
  const remember = (b) => { try { localStorage.setItem(KEY, b); } catch { /* private window */ } };
  const recalled = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const amt = (v) => (v == null ? '' : (v < 0 ? '-' : '') + '₹ ' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '');
  const monName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); };

  async function loadMeta() {
    M = await H.api('/api/retail-creditors/meta');
    const r = recalled();
    _branch = M.branches.includes(_branch) ? _branch : M.branches.includes(r) ? r : (M.branches[0] || '');
  }
  async function loadBills() {
    B = _branch ? await H.api(`/api/retail-creditors/bills?branch=${encodeURIComponent(_branch)}`) : { bills: [] };
    _ticked = new Set([..._ticked].filter((id) => B.bills.some((b) => b.id === id && b.status === 'Open')));
  }

  function shown() {
    const n = _q.trim().toLowerCase();
    return B.bills.filter((b) => (!_month || b.bill_date.slice(0, 7) === _month)
      && (_status === 'all' || (_status === 'open' && b.status === 'Open') || (_status === 'settled' && b.status === 'Settled')
        || (_status === 'overdue' && b.status === 'Open' && b.overdue_days > 0))
      && (!n || b.party.toLowerCase().includes(n) || String(b.bill_no).toLowerCase().includes(n)));
  }

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const list = shown();
    const open = B.bills.filter((b) => b.status === 'Open');
    const sum = (l) => l.reduce((a, b) => a + b.amount, 0);
    const overdue = open.filter((b) => b.overdue_days > 0);
    const months = [...new Set(B.bills.map((b) => b.bill_date.slice(0, 7)))].sort().reverse();
    // Party-wise, in name order.
    const parties = new Map();
    for (const b of list) { if (!parties.has(b.party)) parties.set(b.party, []); parties.get(b.party).push(b); }
    const groups = [...parties.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const tickSum = sum(B.bills.filter((b) => _ticked.has(b.id)));

    el.innerHTML = `<div class="animate-fade-in">
      <style>
        .rc-shops { display:flex; gap:8px; flex-wrap:wrap; }
        .rc-shop { border:2px solid #e2e8f0; background:#fff; border-radius:12px; padding:9px 18px; font-size:14px; font-weight:700; color:#334155; cursor:pointer; }
        .rc-shop.on { border-color:var(--color-primary); background:var(--color-primary); color:#fff; }
        .rc-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; margin:12px 0; }
        .rc-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; }
        .rc-card .l { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#64748b; }
        .rc-card .v { font-size:19px; font-weight:800; margin-top:2px; color:#0f172a; }
        .rc-tbl { width:100%; border-collapse:collapse; font-size:12.5px; }
        .rc-tbl th { position:sticky; top:0; background:#f8fafc; color:#475569; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; padding:8px; text-align:left; border-bottom:1px solid #e2e8f0; white-space:nowrap; z-index:1; }
        .rc-tbl td { padding:7px 8px; border-bottom:1px solid #f1f5f9; white-space:nowrap; }
        .rc-tbl td.n, .rc-tbl th.n { text-align:right; font-variant-numeric:tabular-nums; }
        .rc-tbl tr.party td { background:#f8fafc; font-weight:800; color:#0f172a; border-top:1px solid #e2e8f0; }
        .rc-tbl tr.sub td { font-weight:700; color:#334155; }
        .rc-tbl tr.grand td { background:#0f172a; color:#fff; font-weight:800; }
        .rc-od { color:#dc2626; font-weight:800; }
        .rc-tag { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px; font-weight:700; }
        .rc-bar { position:sticky; bottom:10px; background:#0f172a; color:#fff; border-radius:12px; padding:10px 14px; display:flex; gap:12px; align-items:center; margin-top:10px; }
      </style>
      ${H.header('Creditor List', 'Shop bills by party — days, overdue past ' + M.dueDays + ' days, and cheque settlement',
        '<button id="rc-up" class="btn-primary btn-sm">+ Upload Bills (Excel)</button>')}
      <div class="rc-shops">${M.branches.map((b) => `<button class="rc-shop${b === _branch ? ' on' : ''}" data-shop="${esc(b)}">${esc(b)}</button>`).join('')}</div>
      <div class="rc-cards">
        <div class="rc-card"><div class="l">Outstanding</div><div class="v">${amt(sum(open))}</div><div style="font-size:11.5px;color:#64748b;">${open.length} bills · ${new Set(open.map((b) => b.party)).size} parties</div></div>
        <div class="rc-card" style="border-color:#fecaca;"><div class="l" style="color:#dc2626;">Overdue (&gt; ${M.dueDays} days)</div><div class="v" style="color:#dc2626;">${amt(sum(overdue))}</div><div style="font-size:11.5px;color:#64748b;">${overdue.length} bills</div></div>
        <div class="rc-card"><div class="l" style="color:#15803d;">Settled</div><div class="v" style="color:#15803d;">${amt(sum(B.bills.filter((b) => b.status === 'Settled')))}</div><div style="font-size:11.5px;color:#64748b;">${B.bills.filter((b) => b.status === 'Settled').length} bills</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <select id="rc-status" style="${H.CONTROL}max-width:170px;">${[['open', 'Open'], ['overdue', 'Overdue'], ['settled', 'Settled'], ['all', 'All']].map(([k, l]) => `<option value="${k}"${k === _status ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <select id="rc-month" style="${H.CONTROL}max-width:170px;"><option value="">All months</option>${months.map((m) => `<option value="${m}"${m === _month ? ' selected' : ''}>${monName(m)}</option>`).join('')}</select>
        <input id="rc-q" value="${esc(_q)}" placeholder="Search party / bill no…" style="${H.CONTROL}max-width:260px;" />
        <button class="btn-secondary btn-sm" id="rc-xlsx" style="margin-left:auto;">Download Excel</button>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:auto;max-height:66vh;">
        ${groups.length ? `<table class="rc-tbl"><thead><tr><th></th><th>Party Name</th><th>Bill Date</th><th>Bill No</th><th class="n">Amount</th><th class="n">Total Days</th><th class="n">Overdue</th><th>Status</th><th>Cheque No</th><th>Cheque Signing Date</th>${M.admin ? '<th></th>' : ''}</tr></thead><tbody>
          ${groups.map(([party, bills]) => `
            <tr class="party"><td>${bills.some((b) => b.status === 'Open') ? `<input type="checkbox" data-tickparty="${esc(party)}" title="Tick all open bills of this party" ${bills.filter((b) => b.status === 'Open').every((b) => _ticked.has(b.id)) ? 'checked' : ''}/>` : ''}</td><td colspan="${M.admin ? 10 : 9}">${esc(party)}</td></tr>
            ${bills.map((b) => `<tr>
              <td>${b.status === 'Open' ? `<input type="checkbox" data-tick="${b.id}" ${_ticked.has(b.id) ? 'checked' : ''}/>` : ''}</td>
              <td style="color:#94a3b8;"></td>
              <td>${dmy(b.bill_date)}</td><td>${esc(b.bill_no)}</td>
              <td class="n"${b.amount < 0 ? ' style="color:#dc2626;"' : ''}>${amt(b.amount)}</td>
              <td class="n">${b.total_days}</td>
              <td class="n">${b.overdue_days ? `<span class="${b.status === 'Open' ? 'rc-od' : ''}">${b.overdue_days}</span>` : '-'}</td>
              <td>${b.status === 'Settled' ? '<span class="rc-tag" style="background:#dcfce7;color:#15803d;">Settled</span>'
                : b.overdue_days ? '<span class="rc-tag" style="background:#fee2e2;color:#dc2626;">Overdue</span>' : '<span class="rc-tag" style="background:#eff6ff;color:#1d4ed8;">Due</span>'}</td>
              <td>${esc(b.cheque_no)}</td><td>${dmy(b.cheque_date)}</td>
              ${M.admin ? `<td>${b.status === 'Settled' ? `<button class="btn-secondary btn-sm" data-unsettle="${b.id}" style="padding:2px 8px;font-size:11px;">Undo</button>` : ''}
                <button class="btn-secondary btn-sm" data-edit="${b.id}" style="padding:2px 8px;font-size:11px;">Edit</button></td>` : ''}
            </tr>`).join('')}
            <tr class="sub"><td></td><td style="color:#64748b;">${esc(party)} — total</td><td colspan="2"></td><td class="n">${amt(sum(bills))}</td><td colspan="${M.admin ? 6 : 5}"></td></tr>`).join('')}
          <tr class="grand"><td></td><td>Grand Total</td><td colspan="2">${list.length} bills</td><td class="n">${amt(sum(list))}</td><td colspan="${M.admin ? 6 : 5}"></td></tr>
        </tbody></table>` : `<div style="padding:28px;text-align:center;color:#94a3b8;font-size:13px;">${B.bills.length ? 'No bills for this filter.' : `No bills for ${esc(_branch)} yet — upload the Excel (Party Name, Bill Date, Bill No, Amount).`}</div>`}
      </div>
      ${_ticked.size ? `<div class="rc-bar"><b>${_ticked.size} bill${_ticked.size > 1 ? 's' : ''} ticked</b><span>${amt(tickSum)}</span>
        <button class="btn-primary btn-sm" id="rc-settle" style="margin-left:auto;background:#16a34a;">Settle — cheque no. &amp; date</button>
        <button class="btn-secondary btn-sm" id="rc-clear">Clear</button></div>` : ''}
    </div>`;
    bind();
  }

  function uploadForm() {
    let sheet = null;
    H.openModal({
      id: 'rc-upl', width: 640, title: 'Upload Bills', subtitle: 'Excel with Party Name · Bill Date · Bill No · Amount — a bill already uploaded is skipped',
      bodyHTML: `${H.grid(H.select('rcu-shop', 'Shop', _branch, M.branches, { required: true })
        + `<div><label style="${H.LABEL}">Excel file <span style="color:#ef4444">*</span></label><input id="rcu-file" type="file" accept=".xlsx,.xls,.csv" style="${H.CONTROL}padding:6px;" /></div>`)}
        <div id="rcu-prev" style="margin-top:12px;"></div>`,
      confirmText: 'Upload',
      onOpen: () => {
        document.getElementById('rcu-file').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          const box = document.getElementById('rcu-prev');
          if (!f) return;
          box.innerHTML = H.spinner('Reading…');
          try {
            const XLSX = await Utils.loadXlsx();
            if (!XLSX) throw new Error('Could not load the Excel library — check the internet connection');
            const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
            // raw:true keeps a real date cell as its number; text dates come as typed.
            sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
            const p = await H.post('/api/retail-creditors/preview', { sheet });
            box.innerHTML = `<div style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:10px;padding:10px 14px;font-size:12.5px;">
              <b>${p.count}</b> bills · <b>${p.parties}</b> parties · total <b>${amt(p.total)}</b> · bill dates ${dmy(p.from)} to ${dmy(p.to)}</div>
              ${p.skipped.length ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:8px 12px;font-size:12px;margin-top:8px;">Left out:<br>${p.skipped.map(esc).join('<br>')}</div>` : ''}
              <table class="rc-tbl" style="margin-top:8px;"><thead><tr><th>Party</th><th>Bill Date</th><th>Bill No</th><th class="n">Amount</th></tr></thead><tbody>
              ${p.sample.map((b) => `<tr><td>${esc(b.party)}</td><td>${dmy(b.date)}</td><td>${esc(b.no)}</td><td class="n">${amt(b.amount)}</td></tr>`).join('')}</tbody></table>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">First ${p.sample.length} shown — check the dates read right.</div>`;
          } catch (err) { sheet = null; box.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:10px 14px;font-size:12.5px;">${esc(err.message)}</div>`; }
        });
      },
      onConfirm: async () => {
        if (!sheet) throw new Error('Choose the Excel file');
        const shop = H.val('rcu-shop');
        const r = await H.post('/api/retail-creditors/upload', { branch: shop, sheet, file_name: document.getElementById('rcu-file').files[0]?.name || '' });
        H.closeModal('rc-upl');
        H.toast(`${r.added} bill${r.added === 1 ? '' : 's'} added${r.duplicates ? ` · ${r.duplicates} already there, skipped` : ''}`);
        _branch = shop; remember(shop);
        await loadBills(); render();
      },
    });
  }

  function settleForm() {
    const ids = [..._ticked];
    const bills = B.bills.filter((b) => _ticked.has(b.id));
    const parties = [...new Set(bills.map((b) => b.party))];
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    H.openModal({
      id: 'rc-set', width: 520, title: 'Settle bills', subtitle: `${ids.length} bill${ids.length > 1 ? 's' : ''} · ${amt(bills.reduce((a, b) => a + b.amount, 0))} · ${parties.join(', ')}`,
      bodyHTML: H.grid(H.field('rcs-no', 'Cheque No.', '', { required: true }) + H.field('rcs-date', 'Cheque signing date', today, { type: 'date', required: true })),
      confirmText: 'Settle',
      onConfirm: async () => {
        await H.post('/api/retail-creditors/settle', { branch: _branch, ids, cheque_no: H.val('rcs-no').trim(), cheque_date: H.val('rcs-date') });
        H.closeModal('rc-set');
        H.toast(`${ids.length} bill${ids.length > 1 ? 's' : ''} settled`);
        _ticked.clear();
        await loadBills(); render();
      },
    });
  }

  function editForm(b) {
    H.openModal({
      id: 'rc-ed', width: 560, title: 'Edit bill', subtitle: _branch,
      bodyHTML: H.grid(H.field('rce-party', 'Party Name', b.party, { required: true, span: 2 }) + H.field('rce-date', 'Bill Date', b.bill_date, { type: 'date', required: true })
        + H.field('rce-no', 'Bill No', b.bill_no) + H.field('rce-amt', 'Amount', b.amount, { type: 'number', step: '0.01' })),
      confirmText: 'Save',
      onConfirm: async () => {
        await H.patch(`/api/retail-creditors/bills/${b.id}`, { party: H.val('rce-party'), bill_date: H.val('rce-date'), bill_no: H.val('rce-no'), amount: H.val('rce-amt') });
        H.closeModal('rc-ed'); H.toast('Saved'); await loadBills(); render();
      },
    });
    const foot = document.getElementById('rc-ed-ok')?.parentElement;
    if (foot) {
      const del = document.createElement('button');
      del.className = 'btn-secondary'; del.textContent = 'Delete bill'; del.style.color = '#dc2626'; del.style.marginRight = 'auto';
      del.onclick = async () => {
        if (!(await Utils.showConfirm(`Delete bill ${b.bill_no || ''} of ${b.party}?`, { title: 'Delete bill', confirmText: 'Delete', danger: true }))) return;
        try { await H.del(`/api/retail-creditors/bills/${b.id}`); H.closeModal('rc-ed'); H.toast('Deleted'); await loadBills(); render(); } catch (e) { H.fail(e); }
      };
      foot.insertBefore(del, foot.firstChild);
    }
  }

  async function downloadXlsx() {
    const XLSX = await Utils.loadXlsx();
    if (!XLSX) return H.fail(new Error('Could not load the Excel library'));
    const list = shown();
    const aoa = [[`Creditor List — ${_branch}`], [], ['Party Name', 'Bill Date', 'Bill No', 'Amount', 'Total Days', 'Overdue Days', 'Status', 'Cheque No', 'Cheque Signing Date']];
    const parties = [...new Set(list.map((b) => b.party))].sort((a, b) => a.localeCompare(b));
    for (const p of parties) {
      const bills = list.filter((b) => b.party === p);
      for (const b of bills) aoa.push([b.party, dmy(b.bill_date), b.bill_no, b.amount, b.total_days, b.overdue_days || '', b.status === 'Settled' ? 'Settled' : b.overdue_days ? 'Overdue' : 'Due', b.cheque_no, dmy(b.cheque_date)]);
      aoa.push([`${p} — total`, '', '', Math.round(bills.reduce((a, b) => a + b.amount, 0) * 100) / 100]);
    }
    aoa.push(['Grand Total', '', '', Math.round(list.reduce((a, b) => a + b.amount, 0) * 100) / 100]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 18 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Creditor List');
    XLSX.writeFile(wb, `Creditor List ${_branch}.xlsx`);
  }

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-shop]').forEach((b) => b.addEventListener('click', async () => {
      _branch = b.getAttribute('data-shop'); remember(_branch); _ticked.clear(); _month = '';
      try { await loadBills(); render(); } catch (e) { H.fail(e); }
    }));
    $('rc-up')?.addEventListener('click', uploadForm);
    $('rc-status')?.addEventListener('change', (e) => { _status = e.target.value; render(); });
    $('rc-month')?.addEventListener('change', (e) => { _month = e.target.value; render(); });
    let t;
    $('rc-q')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { _q = e.target.value; render(); const a = $('rc-q'); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } }, 250);
    });
    $('rc-xlsx')?.addEventListener('click', () => downloadXlsx().catch(H.fail));
    document.querySelectorAll('[data-tick]').forEach((c) => c.addEventListener('change', () => {
      const id = Number(c.getAttribute('data-tick'));
      if (c.checked) _ticked.add(id); else _ticked.delete(id);
      render();
    }));
    document.querySelectorAll('[data-tickparty]').forEach((c) => c.addEventListener('change', () => {
      const p = c.getAttribute('data-tickparty');
      shown().filter((b) => b.party === p && b.status === 'Open').forEach((b) => (c.checked ? _ticked.add(b.id) : _ticked.delete(b.id)));
      render();
    }));
    $('rc-settle')?.addEventListener('click', settleForm);
    $('rc-clear')?.addEventListener('click', () => { _ticked.clear(); render(); });
    document.querySelectorAll('[data-unsettle]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await Utils.showConfirm('Undo the settlement of this bill (cheque no. and date are cleared)?', { title: 'Undo settle', confirmText: 'Undo' }))) return;
      try { await H.post('/api/retail-creditors/unsettle', { id: Number(b.getAttribute('data-unsettle')) }); H.toast('Back to open'); await loadBills(); render(); } catch (e) { H.fail(e); }
    }));
    document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const bill = B.bills.find((x) => x.id === Number(b.getAttribute('data-edit')));
      if (bill) editForm(bill);
    }));
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening the Creditor List…');
      try { await loadMeta(); await loadBills(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load the Creditor List', e.message); }
    },
  };
})();
