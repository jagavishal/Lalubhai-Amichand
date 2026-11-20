/* =====================================================================
   MIS Financials (route 'mis-finance', Admin Section)
   ---------------------------------------------------------------------
   Each division's Tally Trial Balance, exported to Excel, is uploaded
   for a period; the server maps every ledger / group to a report head
   and returns P&L, Cash Flow and Ratios per division + consolidated,
   which this page shows and downloads as one Excel workbook.
   Server side: backend/mis-finance.js.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['mis-finance'] = (() => {
  const H = window.HR;
  const esc = H.esc;

  let D = null;            // /api/mis-finance/data
  let R = null;            // last report
  let M = null;            // mapping list
  let _tab = 'reports';
  // Opens on Profit & Loss: the Profitability view is hidden (Jayesh, 20 Nov
  // 2026: "same as Profit and Loss") — still in the Excel download.
  let _stmt = 'P';
  const HIDDEN_STMT = ['F'];
  let _period = '';        // "from|to"
  let _div = '';           // '' = all divisions side by side; a name = that division vs last year
  let _mapQ = '';
  let _mapOnlyOpen = false;
  let _split = {};         // ledger name → [{ h, p }] split not saved yet ('' = back to one head)

  const STMT = { F: 'Profitability', P: 'Profit & Loss', C: 'Cash Flow', R: 'Ratios' };
  const headLabel = (k) => D.heads.find((h) => h.key === k)?.label || '';
  const splitText = (list) => list.map((x) => `${x.p}% ${headLabel(x.h) || '?'}`).join(' + ');
  const periodLabel = (from, to) => `${H.fmtDate(from)} → ${H.fmtDate(to)}`;

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function load() {
    D = await H.api('/api/mis-finance/data');
    const periods = periodList();
    if (!_period || !periods.some((p) => p.key === _period)) _period = periods[0]?.key || '';
  }
  async function refresh() { try { await load(); R = null; M = null; await render(); } catch (e) { H.fail(e); } }

  function periodList() {
    const seen = new Map();
    for (const u of D.uploads) {
      const key = `${u.from}|${u.to}`;
      if (!seen.has(key)) seen.set(key, { key, from: u.from, to: u.to, divisions: [] });
      seen.get(key).divisions.push(u.division);
    }
    return [...seen.values()].sort((a, b) => (b.to + b.from).localeCompare(a.to + a.from));
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  async function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    let body = '';
    if (_tab === 'reports') body = await reportsTab();
    else if (_tab === 'uploads') body = uploadsTab();
    else if (_tab === 'mapping') body = await mappingTab();
    else body = divisionsTab();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        .mf-tbl { width:100%; border-collapse:collapse; font-size:12.5px; }
        .mf-tbl th { position:sticky; top:0; background:#f8fafc; color:#475569; font-size:11px; text-transform:uppercase; letter-spacing:.05em;
                     padding:9px 10px; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap; }
        .mf-tbl th:first-child, .mf-tbl td:first-child { text-align:left; position:sticky; left:0; background:#fff; z-index:1; min-width:260px; }
        .mf-tbl th:first-child { background:#f8fafc; z-index:2; }
        .mf-tbl td { padding:7px 10px; border-bottom:1px solid #f1f5f9; text-align:right; white-space:nowrap; color:#334155; font-variant-numeric:tabular-nums; }
        .mf-tbl tr.h td { font-weight:700; color:var(--color-primary); background:#f8fafc; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; }
        .mf-tbl tr.h td:first-child { background:#f8fafc; }
        .mf-tbl tr.t td { font-weight:700; border-top:1px solid #e2e8f0; }
        .mf-tbl tr.T td { font-weight:800; color:#0f172a; background:#f1f5f9; border-top:1.5px solid #cbd5e1; }
        .mf-tbl tr.T td:first-child { background:#f1f5f9; }
        .mf-tbl tr.pct td { color:#64748b; font-style:italic; font-size:12px; }
        .mf-tbl tr.warn td { color:#b45309; font-weight:600; background:#fffbeb; }
        .mf-tbl tr.warn td:first-child { background:#fffbeb; }
        .mf-tbl td.neg { color:#dc2626; }
        .mf-pf td { padding-top:4px; padding-bottom:4px; border-bottom:none; }
        .mf-pf tr.H td { font-weight:800; color:#0f172a; padding-top:8px; }
        .mf-pf tr.l td:first-child { padding-left:22px; }
        .mf-pf tr.ll td:first-child { padding-left:40px; }
        .mf-pf tr.l td, .mf-pf tr.ll td { color:#334155; }
        .mf-pf tr.G td { font-weight:800; color:#0f172a; border-top:1.5px solid #0f172a; border-bottom:1.5px solid #0f172a; background:#f8fafc; }
        .mf-pf tr.G td:first-child { background:#f8fafc; }
        .mf-pf tr.memo td { font-style:italic; color:#64748b; }
        .mf-pf tr.sec td { font-weight:800; color:#0f172a; padding-top:10px; text-align:left; }
        .mf-pf tr.chk td { color:#64748b; font-size:12px; }
        .mf-pf tr.chk td.bad { color:#dc2626; font-weight:700; }
        .mf-pf tr.sp td { height:8px; padding:0; }
        .mf-tbl tr.d td { color:#64748b; font-size:12px; padding-top:4px; padding-bottom:4px; }
        .mf-tbl tr.d td:first-child { padding-left:28px; }
        .mf-seg { display:inline-flex; border:1.5px solid #e2e8f0; border-radius:9px; overflow:hidden; }
        .mf-seg button { border:none; background:#fff; padding:7px 14px; font-size:12.5px; font-weight:600; color:#64748b; cursor:pointer; }
        .mf-seg button.on { background:var(--color-primary); color:#fff; }
        .mf-note { background:#eff6ff; border:1px solid #bfdbfe; color:#1e3a8a; border-radius:10px; padding:10px 14px; font-size:12.5px; margin-bottom:12px; }
        .mf-warn { background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:10px; padding:10px 14px; font-size:12.5px; margin-bottom:12px; }
      </style>
      ${H.header('MIS Financials', 'P&L, Cash Flow and Ratios from each division\'s Tally Trial Balance (Excel)',
        '<button id="mf-up" class="btn-primary btn-sm">+ Upload Trial Balance</button>')}
      ${H.tabs('mf', [
        { key: 'reports', label: 'Reports' },
        { key: 'uploads', label: 'Uploads', count: D.uploads.length },
        { key: 'mapping', label: 'Ledger Mapping' },
        { key: 'divisions', label: 'Divisions' },
      ], _tab)}
      ${body}
    </div>`;
    bind();
  }

  /* ── Reports ──────────────────────────────────────────────────────── */

  const fmtVal = (kind, v) => {
    if (v == null) return '—';
    if (kind === 'pct') return v.toFixed(1) + '%';
    if (kind === 'x') return v.toFixed(2);
    if (kind === 'days') return Math.round(v) + ' d';
    return H.inr0(v);
  };

  async function reportsTab() {
    const periods = periodList();
    if (!periods.length) {
      return `<div class="mf-note">
        <b>Nothing uploaded yet.</b> For each division, in Tally open <b>Display → Trial Balance</b>, set the period (Alt+F2),
        press <b>F12</b> and turn on <i>Opening Balance</i> and <i>Closing Balance</i> (needed for the Cash Flow), expand the groups
        you want split (Ctrl+F1 / Alt+F1 detailed), then <b>Export (Alt+E) → Excel</b>, and upload the file here.</div>`;
    }
    const [from, to] = _period.split('|');
    const here = periods.find((p) => p.key === _period);
    if (_div && !here.divisions.includes(_div)) _div = '';
    if (!R || R.from !== from || R.to !== to || (R.division || '') !== _div) {
      try { R = await H.api(`/api/mis-finance/report?from=${from}&to=${to}${_div ? '&division=' + encodeURIComponent(_div) : ''}`); } catch (e) { R = { error: e.message, from, to, division: _div }; }
    }
    if (R.error) return `<div class="mf-warn">${esc(R.error)}</div>`;
    const cols = [...R.columns.filter((c) => !c.missing), ...(R.consolidated ? [R.consolidated] : [])];
    const missing = R.columns.filter((c) => c.missing).map((c) => c.division);
    const notes = [];
    if (R.division && !R.compare) notes.push(`No upload of ${esc(R.division)} for the same months last year — upload that Trial Balance (Tally exports it alongside when you add a comparative period) to see the comparison.`);
    if (missing.length) notes.push(`Not uploaded for this period: <b>${esc(missing.join(', '))}</b>${R.consolidated ? ' — the consolidated column leaves them out' : ''}.`);
    const unm = R.columns.filter((c) => c.unmapped);
    if (unm.length) notes.push(`Ledgers with no report head: ${unm.map((c) => `<b>${esc(c.division)}</b> (${c.unmapped})`).join(', ')} — map them on the Ledger Mapping tab.`);
    const borrowed = R.columns.filter((c) => c.openingFrom && c.openingFrom !== 'file');
    if (borrowed.length) notes.push(`Opening balances taken from the previous upload for ${borrowed.map((c) => esc(c.division)).join(', ')}.`);
    const lines = cols[0][_stmt];
    let table;
    if (_stmt === 'C' && cols.some((c) => !c.C)) {
      const no = cols.filter((c) => !c.C).map((c) => c.division);
      table = `<div class="mf-warn">The Cash Flow needs opening balances. ${esc(no.join(', '))}: upload the Trial Balance with the Opening Balance column turned on (F12 in Tally), or upload the previous period too so its closing is used as the opening.</div>`;
      const ok = cols.filter((c) => c.C);
      if (ok.length) table += stmtTable(ok, ok[0].C, 'C');
    } else if (_stmt === 'F') {
      table = profitTable(cols);
    } else {
      table = stmtTable(cols, lines, _stmt);
    }
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
        <select id="mf-period" style="${H.CONTROL}max-width:330px;">
          ${periods.map((p) => `<option value="${esc(p.key)}"${p.key === _period ? ' selected' : ''}>${esc(periodLabel(p.from, p.to))} · ${p.divisions.length} division${p.divisions.length === 1 ? '' : 's'}</option>`).join('')}
        </select>
        <select id="mf-div" style="${H.CONTROL}max-width:260px;">
          <option value="">All divisions${here.divisions.length > 1 ? ' + consolidated' : ''}</option>
          ${here.divisions.map((d) => `<option value="${esc(d)}"${d === _div ? ' selected' : ''}>${esc(d)} — vs last year</option>`).join('')}
        </select>
        <div class="mf-seg">${Object.entries(STMT).filter(([k]) => !HIDDEN_STMT.includes(k)).map(([k, l]) => `<button data-stmt="${k}" class="${k === _stmt ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
        <button class="btn-secondary btn-sm" id="mf-xlsx" style="margin-left:auto;">Download Excel</button>
      </div>
      ${notes.length ? `<div class="mf-note">${notes.join('<br>')}</div>` : ''}
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:auto;max-height:72vh;">${table}</div>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${R.days} days · amounts in ₹ · ratios use closing balances; day counts use the period's ${R.days} days</div>`;
  }

  // As the books print it: no decimals, a loss in brackets, nil as "-".
  const acct = (v) => {
    if (v == null) return '';
    // Half away from zero, as Excel rounds (−2,320,781.5 → (2,320,782)).
    const n = Math.sign(v) * Math.round(Math.abs(v));
    if (n === 0) return '-';
    return n < 0 ? `(${H.inr0(-n)})` : H.inr0(n);
  };
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const endMonth = (iso) => { const [y, m] = iso.split('-').map(Number); return `${MON3[m - 1]}'${String(y).slice(2)}`; };
  const profitTitle = () => `Profitability Statement for the period ended ${endMonth(R.to)}${R.division ? ` - ${R.division} Division` : ''}`;

  function profitTable(cols) {
    const lines = cols[0].F;
    return `<div style="padding:14px 16px 4px;font-size:16px;font-weight:800;color:#0f172a;">${esc(profitTitle())}</div>
      <table class="mf-tbl mf-pf"><thead><tr><th>Particulars</th>${cols.map((c) => `<th>${esc(c.division)}</th>`).join('')}</tr></thead><tbody>
      ${lines.map((ln, i) => {
        const [kind, label] = ln;
        if (kind === 'sp') return `<tr class="sp"><td colspan="${cols.length + 1}"></td></tr>`;
        if (kind === 'sec') return `<tr class="sec"><td colspan="${cols.length + 1}">${esc(label)}</td></tr>`;
        const cells = cols.map((c) => {
          const v = c.F?.[i]?.[2];
          if (kind === 'chk' && c.change) return '<td></td>';
          const bad = kind === 'chk' && v != null && Math.abs(v) > 0.5;
          return `<td class="${bad ? 'bad' : ''}">${acct(v)}</td>`;
        }).join('');
        return `<tr class="${kind}"><td>${esc(label)}</td>${cells}</tr>`;
      }).join('')}
    </tbody></table>`;
  }

  function stmtTable(cols, lines, key) {
    return `<table class="mf-tbl"><thead><tr><th>${esc(STMT[key])}</th>${cols.map((c) => `<th>${esc(c.division)}</th>`).join('')}</tr></thead><tbody>
      ${lines.map((ln, i) => {
        const [kind, label] = ln;
        if (kind === 'h') return `<tr class="h"><td colspan="${cols.length + 1}">${esc(label)}</td></tr>`;
        const cls = ['t', 'T', 'pct', 'warn', 'd'].includes(kind) ? kind : '';
        const cells = cols.map((c) => {
          const row = c[key]?.[i];
          const v = row ? row[2] : null;
          const f = key === 'R' ? kind : kind === 'pct' ? 'pct' : '';
          if (kind === 'warn' && v == null) return '<td></td>';
          const txt = c.change && v != null && v > 0 ? '+' + fmtVal(f, v) : fmtVal(f, v);
          return `<td class="${v != null && v < 0 && f !== 'pct' ? 'neg' : ''}">${txt}</td>`;
        }).join('');
        return `<tr class="${cls}"><td>${esc(label)}</td>${cells}</tr>`;
      }).join('')}
    </tbody></table>`;
  }

  async function downloadXlsx() {
    const XLSX = await Utils.loadXlsx();
    if (!XLSX) return H.fail(new Error('Could not load the Excel library — check the internet connection'));
    const cols = [...R.columns.filter((c) => !c.missing), ...(R.consolidated ? [R.consolidated] : [])];
    const wb = XLSX.utils.book_new();
    const title = `${R.division ? R.division + ' — ' : ''}${H.fmtDate(R.from)} to ${H.fmtDate(R.to)}`;
    {
      const withData = cols.filter((c) => c.F);
      const lines = withData[0].F;
      const aoa = [[profitTitle()], [], ['Particulars', ...withData.map((c) => c.division)]];
      lines.forEach((ln, i) => {
        if (ln[0] === 'sp') { aoa.push([]); return; }
        if (ln[0] === 'sec') { aoa.push([ln[1]]); return; }
        const pad = ln[0] === 'l' ? '   ' : ln[0] === 'll' ? '      ' : '';
        aoa.push([pad + ln[1], ...withData.map((c) => {
          const v = c.F[i]?.[2];
          return v == null || (ln[0] === 'chk' && c.change) ? '' : Math.sign(v) * Math.round(Math.abs(v));
        })]);
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 52 }, ...withData.map(() => ({ wch: 16 }))];
      // Excel shows these like the old sheet: 1,234 · (1,234) · -
      for (const addr of Object.keys(ws)) if (!addr.startsWith('!') && typeof ws[addr].v === 'number') ws[addr].z = '#,##0;(#,##0);"-"';
      XLSX.utils.book_append_sheet(wb, ws, 'Profitability');
    }
    for (const key of ['P', 'C', 'R']) {
      const withData = cols.filter((c) => c[key]);
      if (!withData.length) continue;
      const lines = withData[0][key];
      const aoa = [[`${STMT[key]} — ${title}`], [], ['Particulars', ...withData.map((c) => c.division)]];
      lines.forEach((ln, i) => {
        if (ln[0] === 'h') { aoa.push([ln[1]]); return; }
        aoa.push([(ln[0] === 'd' ? '    ' : '') + ln[1], ...withData.map((c) => {
          const v = c[key][i]?.[2];
          if (v == null) return '';
          return (key === 'R' || ln[0] === 'pct') ? Math.round(v * 100) / 100 : Math.round(v);
        })]);
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 50 }, ...withData.map(() => ({ wch: 16 }))];
      XLSX.utils.book_append_sheet(wb, ws, STMT[key].replace(/[&]/g, 'and'));
    }
    XLSX.writeFile(wb, `MIS Financials ${R.division ? R.division + ' ' : ''}${R.from} to ${R.to}.xlsx`);
  }

  /* ── Uploads ──────────────────────────────────────────────────────── */

  function uploadsTab() {
    return `${H.table(['Division', 'Period', 'File', 'Tally Company', 'Opening', 'Opening Stock', 'Closing Stock', 'Uploaded', { label: '', m: 'actions' }],
      D.uploads.map((u) => [
        `<b>${esc(u.division)}</b>`, esc(periodLabel(u.from, u.to)), esc(u.file_name || '—'), esc(u.company || '—'),
        u.has_opening ? H.pill('In file', 'success') : H.pill('No', 'neutral'),
        u.opening_stock == null ? '<span style="color:#94a3b8;">from Tally</span>' : '₹ ' + H.inr0(u.opening_stock),
        u.closing_stock == null ? '—' : '₹ ' + H.inr0(u.closing_stock),
        `${esc(u.uploaded_by)}<div style="font-size:11px;color:#94a3b8;">${H.fmtDate(u.at)}</div>`,
        `<button class="btn-secondary btn-sm" data-stock="${u.id}">Edit Stock</button> <button class="btn-secondary btn-sm" data-del="${u.id}" style="color:#dc2626;">Delete</button>`,
      ]), { empty: 'No Trial Balance uploaded yet', cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Uploading the same division and period again replaces it.</div>`;
  }

  let _sheet = null;      // rows of the chosen file
  let _sheetName = '';    // which worksheet, when the workbook has several
  let _preview = null;
  let _picks = {};        // ledger → head chosen in this upload panel
  let _pickRows = [];     // those ledgers, so they stay listed once mapped

  function uploadForm() {
    _sheet = null; _preview = null; _picks = {}; _pickRows = [];
    H.openModal({
      id: 'mf-form', width: 900, title: 'Upload Tally Trial Balance',
      subtitle: 'Exported from Tally to Excel — one division, one period',
      bodyHTML: `${H.grid(
        H.select('mu-div', 'Division', D.divisions[0], D.divisions, { required: true })
        + `<div><label style="${H.LABEL}">Trial Balance file (.xlsx / .xls) <span style="color:#ef4444">*</span></label>
            <input id="mu-file" type="file" accept=".xlsx,.xls,.xlsm,.csv" style="${H.CONTROL}padding:6px;" /></div>`
        + H.field('mu-from', 'Period From', '', { type: 'date', required: true })
        + H.field('mu-to', 'Period To', '', { type: 'date', required: true })
        + H.field('mu-ostock', 'Opening Stock (₹) — for this period', '', { type: 'number', step: '0.01', hint: 'Leave blank to take it from Tally. Type it when your own stock summary differs (Export).' })
        + H.field('mu-stock', 'Closing Stock (₹) — for this period', '', { type: 'number', step: '0.01', hint: 'Tally\'s Trial Balance shows only the Opening Stock — type the closing stock (as in the old “Closing Stock (INPUT)”)' })
        + `<div id="mu-stock2-wrap" style="display:none;grid-column:span 2;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;" class="m-grid-1">
            ${H.field('mu-ostock2', 'Opening Stock (₹) — comparative period', '', { type: 'number', step: '0.01', hint: 'Last-year columns in the same file · blank = from Tally' })}
            ${H.field('mu-stock2', 'Closing Stock (₹) — comparative period', '', { type: 'number', step: '0.01', hint: 'For the last-year columns in the same file' })}</div></div>`,
      )}
      <div id="mu-preview" style="margin-top:14px;"></div>`,
      confirmText: 'Save Upload',
      onOpen: () => {
        document.getElementById('mu-file').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          const box = document.getElementById('mu-preview');
          if (!f) return;
          box.innerHTML = H.spinner('Reading the file…');
          try {
            const XLSX = await Utils.loadXlsx();
            if (!XLSX) throw new Error('Could not load the Excel library — check the internet connection');
            const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
            // raw:false keeps the cell text as Tally formats it — "2,63,711.00 Cr" —
            // which is where the Dr / Cr side lives.
            const sheets = wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) }));
            const has = (rows, re) => rows.slice(0, 15).some((r) => (r || []).some((c) => re.test(String(c ?? '').trim())));
            const pick = sheets.find((x) => has(x.rows, /^particulars$/i) && (has(x.rows, /^trial balance$/i) || /trial|tb\b/i.test(x.name)))
              || sheets.find((x) => has(x.rows, /^particulars$/i));
            if (!pick) throw new Error('No sheet in this file has a “Particulars” column — is it the Trial Balance export?');
            _sheet = pick.rows;
            _sheetName = wb.SheetNames.length > 1 ? pick.name : '';
            await runPreview();
          } catch (err) { box.innerHTML = `<div class="mf-warn">${esc(err.message)}</div>`; _sheet = null; }
        });
      },
      onConfirm: async () => {
        if (!_sheet) throw new Error('Choose the Trial Balance file');
        if (_preview?.needsClosingStock && !H.val('mu-stock')
          && !(await Utils.showConfirm('The Trial Balance has no closing stock. Save without it? The Gross Profit will be wrong until you upload again with the closing stock.', { title: 'Closing stock', confirmText: 'Save anyway' }))) return;
        const body = {
          division: H.val('mu-div'), from: H.val('mu-from'), to: H.val('mu-to'), closing_stock: H.val('mu-stock'), closing_stock_prev: H.val('mu-stock2'),
          opening_stock: H.val('mu-ostock'), opening_stock_prev: H.val('mu-ostock2'),
          file_name: document.getElementById('mu-file').files[0]?.name || '', sheet: _sheet, mappings: pickedMappings(),
        };
        if (!body.from || !body.to) throw new Error('Enter the period');
        const r = await H.post('/api/mis-finance/uploads', body);
        H.closeModal('mf-form');
        H.toast(`${body.division} Trial Balance saved${r.comparative === 'saved' ? ` — the comparative ${periodLabel(r.comparativePeriod.from, r.comparativePeriod.to)} too` : ''}`);
        _period = `${body.from}|${body.to}`;
        _tab = 'reports';
        await refresh();
      },
    });
  }

  function pickedMappings() {
    document.querySelectorAll('#mu-preview select[data-map]').forEach((s) => {
      const name = s.getAttribute('data-map');
      if (s.value && s.value !== NEW) _picks[name] = s.value; else delete _picks[name];
    });
    return { ..._picks };
  }
  const headOptions = (value) => {
    const opt = (h) => `<option value="${h.key}"${h.key === value ? ' selected' : ''}>${esc(h.label)}${h.pl ? ' (P&L)' : ''}</option>`;
    const own = D.heads.filter((h) => h.custom);
    return D.heads.filter((h) => !h.custom).map(opt).join('')
      + (own.length ? `<optgroup label="Your heads">${own.map(opt).join('')}</optgroup>` : '');
  };
  const NEW = '__new';
  const newOpt = `<option value="${NEW}">+ New head…</option>`;
  const headSelect = (attr, name, value, blank = '— choose head —') => `<select ${attr}="${esc(name)}" data-prev="${esc(value || '')}" style="${H.CONTROL}padding:5px 8px;font-size:12px;">
      <option value="">${esc(blank)}</option>${headOptions(value)}${newOpt}</select>`;

  /* "+ New head…" in any head dropdown: make the head right there, then
     pick it in that dropdown. Capture phase, so the dropdown's own change
     handler never sees the placeholder value. Every head dropdown on the
     screen gets the new head too. */
  let _newBound = false;
  function bindNewHead() {
    if (_newBound) return;
    _newBound = true;
    document.addEventListener('change', (e) => {
      const sel = e.target;
      if (!(sel instanceof HTMLSelectElement) || sel.dataset.prev === undefined) return;
      if (sel.value !== NEW) { sel.dataset.prev = sel.value; return; }
      e.stopImmediatePropagation();
      sel.value = sel.dataset.prev || '';
      headForm(null, async (key) => {
        await load();
        document.querySelectorAll('select[data-prev]').forEach((x) => {
          const keep = x === sel ? key : x.value;
          const blank = x.querySelector('option[value=""]')?.outerHTML || '';
          x.innerHTML = blank + headOptions(keep) + newOpt;
          x.value = keep;
          x.dataset.prev = keep;
        });
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }, true);
  }

  // "Put the ticked ledgers under one head" — the bar above a ledger list.
  const bulkBar = (id, what) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin:6px 0 8px;">
      <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;font-weight:600;"><input type="checkbox" id="${id}-all"/> Tick all</label>
      <span style="font-size:12px;color:#64748b;">then put the ticked ${what} under</span>
      <select id="${id}-h" data-prev="" style="${H.CONTROL}padding:5px 8px;font-size:12px;max-width:260px;width:auto;"><option value="">— choose head —</option>${headOptions('')}${newOpt}</select>
      <button class="btn-primary btn-sm" id="${id}-go">Apply to ticked</button>
      <span id="${id}-n" style="font-size:11.5px;color:#94a3b8;"></span></div>`;
  function wireBulk(id, boxSel, apply) {
    const $ = (x) => document.getElementById(x);
    const boxes = () => [...document.querySelectorAll(boxSel)];
    const count = () => { const n = boxes().filter((b) => b.checked).length; const el = $(`${id}-n`); if (el) el.textContent = n ? `${n} ticked` : ''; };
    $(`${id}-all`)?.addEventListener('change', (e) => { boxes().forEach((b) => { b.checked = e.target.checked; }); count(); });
    boxes().forEach((b) => b.addEventListener('change', count));
    $(`${id}-go`)?.addEventListener('click', async (e) => {
      const head = $(`${id}-h`).value;
      const names = boxes().filter((b) => b.checked).map((b) => b.value);
      if (!names.length) return H.fail(new Error('Tick the ledgers first'));
      if (!head || head === NEW) return H.fail(new Error('Choose the head'));
      e.target.disabled = true;
      try { await apply(names, head); } catch (err) { H.fail(err); } finally { e.target.disabled = false; }
    });
  }

  async function runPreview() {
    const box = document.getElementById('mu-preview');
    const keep = pickedMappings();
    _preview = await H.post('/api/mis-finance/preview', { sheet: _sheet, mappings: keep });
    const p = _preview;
    for (const u of p.unmapped) if (!_pickRows.some((x) => x.name === u.name)) _pickRows.push(u);
    const toMap = _pickRows.filter((u) => keep[u.name] || p.unmapped.some((x) => x.name === u.name));
    const open = toMap.filter((u) => !keep[u.name]).length;
    if (p.period) {
      if (!H.val('mu-from')) document.getElementById('mu-from').value = p.period.from;
      if (!H.val('mu-to')) document.getElementById('mu-to').value = p.period.to;
    }
    const SRC = { saved: 'saved', rule: 'by name', tally: 'Tally group', group: 'from group' };
    const warn = [];
    if (Math.abs(p.diffClose) > 0.5) warn.push(`The rows read do not tally: closing Dr − Cr = ₹ ${H.inr0(p.diffClose)}. A row may be counted twice or missing — check the tree below.`);
    const tsNote = p.tallyStock && Math.abs(p.tallyStock.close) > 0.5
      ? `Tally's Current Assets total includes its own closing-stock figure of ₹ ${H.inr0(p.tallyStock.close)} (not on any ledger). It is left out — the Closing Stock you type is used instead.` : '';
    if (!p.hasOpening) warn.push('No opening balance column — the Cash Flow will use the previous period\'s upload for this division if there is one.');
    if (p.needsClosingStock) warn.push('This Trial Balance shows only the Opening Stock — enter the Closing Stock above.');
    const w2 = document.getElementById('mu-stock2-wrap');
    if (w2) w2.style.display = p.comparative ? '' : 'none';
    box.innerHTML = `
      <div class="mf-note">${p.company ? `<b>${esc(p.company)}</b> · ` : ''}${p.rows.length} rows · ${p.rows.filter((r) => r.leaf).length} ledgers counted
        ${p.period ? ` · period ${esc(periodLabel(p.period.from, p.period.to))}` : ''}${p.hasOpening ? ' · opening + closing' : ' · closing only'}${_sheetName ? ` · sheet “${esc(_sheetName)}”` : ''}
        ${p.comparative ? `<br>Also has <b>${esc(periodLabel(p.comparative.period.from, p.comparative.period.to))}</b> — saved as that period too (if it is not uploaded yet), for the last-year comparison.${p.comparative.period.assumed ? ' <i>(The file shows no date for these columns, so they are taken as the same months last year.)</i>' : ''}` : ''}</div>
      ${warn.map((w) => `<div class="mf-warn">${esc(w)}</div>`).join('')}
      ${tsNote ? `<div class="mf-note">${esc(tsNote)}</div>` : ''}
      ${toMap.length ? `<div style="font-weight:700;font-size:12.5px;margin:6px 0;">Map these ${toMap.length} ledger${toMap.length === 1 ? '' : 's'} (remembered for next time)
          <span style="font-weight:400;color:${open ? '#b45309' : '#15803d'};">· ${open ? `${open} still to map` : 'all mapped'}</span></div>
        ${toMap.length > 1 ? bulkBar('mu-bulk', 'ledgers') : ''}
        ${H.table(['', 'Ledger', { label: 'Closing (Dr − Cr)', align: 'right' }, 'Report head'],
          toMap.map((u) => [`<input type="checkbox" class="mu-tick" value="${esc(u.name)}"/>`, esc(u.name), H.inr0(u.close), headSelect('data-map', u.name, keep[u.name] || '')]), { cards: true })}` : ''}
      <details style="margin-top:10px;"><summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--color-primary);">Show how every row was read</summary>
        <div style="max-height:340px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;margin-top:6px;">
          <table class="mf-tbl"><thead><tr><th>Particulars</th><th>Opening</th><th>Closing</th><th style="text-align:left;">Head</th></tr></thead><tbody>
          ${p.rows.map((r) => `<tr><td style="padding-left:${10 + r.depth * 16}px;${r.leaf ? '' : 'font-weight:700;'}">${esc(r.name)}</td>
            <td>${H.inr0(r.open)}</td><td>${H.inr0(r.close)}</td>
            <td style="text-align:left;color:${r.head ? '#334155' : '#dc2626'};">${r.leaf ? esc(r.headText || headLabel(r.head) || 'not mapped') + (r.src ? ` <span style="color:#94a3b8;font-size:11px;">(${esc(SRC[r.src] || r.src)})</span>` : '') : '<span style="color:#94a3b8;">group total</span>'}</td></tr>`).join('')}
          </tbody></table></div></details>`;
    box.querySelectorAll('select[data-map]').forEach((s) => s.addEventListener('change', () => { if (s.value) runPreview().catch(H.fail); }));
    bindNewHead();
    wireBulk('mu-bulk', '#mu-preview .mu-tick', async (names, head) => {
      box.querySelectorAll('select[data-map]').forEach((s) => { if (names.includes(s.getAttribute('data-map'))) s.value = head; });
      await runPreview();
      H.toast(`${names.length} ledger${names.length === 1 ? '' : 's'} put under ${headLabel(head)}`);
    });
  }

  /* ── Mapping ──────────────────────────────────────────────────────── */

  async function mappingTab() {
    if (!M) M = (await H.api('/api/mis-finance/mapping')).names;
    const n = _mapQ.trim().toLowerCase();
    const list = M.filter((x) => (!n || x.name.toLowerCase().includes(n)) && (!_mapOnlyOpen || !x.head));
    const SRC = { saved: 'Saved', rule: 'By name rule', tally: 'Tally group', group: 'From its group' };
    const own = D.heads.filter((h) => h.custom);
    const headCell = (x) => {
      const pending = Object.prototype.hasOwnProperty.call(_split, x.name) ? _split[x.name] : undefined;
      const split = pending !== undefined ? (pending || null) : (x.src === 'saved' ? x.split : null);
      if (split) {
        return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:12px;color:#0f172a;font-weight:600;">${esc(splitText(split))}</span>${pending !== undefined ? ' <span style="font-size:11px;color:#b45309;">(not saved)</span>' : ''}
          <button class="btn-secondary btn-sm" data-msplit="${esc(x.name)}" style="padding:3px 8px;font-size:11.5px;">Edit split</button></div>`;
      }
      return `<div style="display:flex;gap:6px;align-items:center;">
        ${headSelect('data-mrow', x.name, x.src === 'saved' && !x.split ? x.head : '', x.src === 'saved' ? '— back to automatic —' : x.head ? `Auto: ${x.split ? splitText(x.split) : headLabel(x.head)}` : '— not mapped —')}
        <button class="btn-secondary btn-sm" data-msplit="${esc(x.name)}" title="Divide this ledger over two or more heads by %" style="padding:3px 8px;font-size:11.5px;white-space:nowrap;">Split %</button></div>`;
    };
    return `
      <div class="br-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <div style="font-weight:700;font-size:13px;color:#0f172a;">Your heads</div>
          <div style="font-size:11.5px;color:#94a3b8;">Add your own head (e.g. “Office &amp; Admin Expenses”) — it works like the head you base it on and shows as its own line in the reports.</div>
          <button class="btn-primary btn-sm" id="mf-hadd" style="margin-left:auto;white-space:nowrap;">+ Add Head</button>
        </div>
        ${own.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">${own.map((h) => `
          <div style="border:1px solid #e2e8f0;border-radius:9px;padding:6px 10px;font-size:12.5px;display:flex;gap:8px;align-items:center;background:#f8fafc;">
            <b>${esc(h.label)}</b><span style="color:#94a3b8;font-size:11.5px;">works like ${esc(headLabel(h.base))}</span>
            <button class="btn-secondary btn-sm" data-hedit="${esc(h.key)}" style="padding:2px 8px;font-size:11px;">Edit</button>
            <button class="btn-secondary btn-sm" data-hdel="${esc(h.key)}" style="padding:2px 8px;font-size:11px;color:#dc2626;">Delete</button>
          </div>`).join('')}</div>` : '<div style="font-size:12px;color:#94a3b8;">None yet — the built-in heads are used.</div>'}
      </div>
      <div class="mf-note">Every ledger / group seen in the uploads. A ledger follows its group unless you set it here (e.g. move “Director Remuneration” to Salary &amp; Staff Cost). <b>Split %</b> divides one ledger over several heads (e.g. Rent 60% Office &amp; Admin + 40% Selling). Changes apply to every report straight away.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <input id="mf-mq" value="${esc(_mapQ)}" placeholder="Search ledger / group…" style="${H.CONTROL}max-width:300px;" />
        <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;"><input type="checkbox" id="mf-monly"${_mapOnlyOpen ? ' checked' : ''}/> Only unmapped</label>
        <button class="btn-primary btn-sm" id="mf-msave" style="margin-left:auto;">Save Mapping</button>
      </div>
      ${list.length ? bulkBar('mf-bulk', 'ledgers on this page') : ''}
      ${H.table(['', 'Ledger / Group', 'Type', 'Divisions', 'Report Head', 'How'],
        list.map((x) => [`<input type="checkbox" class="mf-tick" value="${esc(x.name)}"/>`, esc(x.name), x.leaf ? 'Ledger' : 'Group', esc(x.divisions.join(', ')), headCell(x), esc(SRC[x.src] || '—')]),
        { empty: 'Upload a Trial Balance first', cards: true, page: { key: 'mf-map', sig: [_mapQ, _mapOnlyOpen], onPage: render } })}`;
  }

  function headForm(h, onAdded) {
    const bases = D.heads.filter((x) => !x.custom && x.key !== 'ignore');
    H.openModal({
      id: 'mf-head', width: 520, title: h ? 'Edit head' : 'Add head',
      subtitle: 'Your own line in the reports',
      bodyHTML: `${H.field('mh-label', 'Head name', h?.label || '', { required: true, placeholder: 'e.g. Office & Admin Expenses' })}
        <div style="margin-top:10px;"><label style="${H.LABEL}">Works like <span style="color:#ef4444">*</span></label>
          <select id="mh-base" style="${H.CONTROL}">${bases.map((x) => `<option value="${x.key}"${x.key === (h?.base || 'indirect_exp') ? ' selected' : ''}>${esc(x.label)}${x.pl ? ' (P&L)' : ''}</option>`).join('')}</select>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:4px;">Decides where it counts — e.g. an expense head based on “Other Indirect Expenses” comes before EBITDA in the P&amp;L.</div></div>`,
      confirmText: h ? 'Save' : 'Add Head',
      onConfirm: async () => {
        const label = H.val('mh-label').trim();
        const r = await H.post('/api/mis-finance/heads', { key: h?.key, label, base: H.val('mh-base') });
        H.closeModal('mf-head');
        if (onAdded) { await onAdded(r.key); H.toast(`Head “${label}” added and picked`); return; }
        H.toast(h ? 'Head saved' : 'Head added — pick it for ledgers below');
        await refresh();
      },
    });
  }

  function splitForm(x) {
    const pending = Object.prototype.hasOwnProperty.call(_split, x.name) ? _split[x.name] : undefined;
    const start = pending || (x.src === 'saved' && x.split) || [{ h: x.head || '', p: 100 }, { h: '', p: '' }];
    const rowHTML = (r) => `<div class="mf-srow" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <select class="ms-h" data-prev="${esc(r.h || '')}" style="${H.CONTROL}flex:1;"><option value="">— choose head —</option>${headOptions(r.h)}${newOpt}</select>
        <input class="ms-p" type="number" min="0" max="100" step="0.01" value="${esc(r.p)}" placeholder="%" style="${H.CONTROL}width:90px;text-align:right;" />
        <span style="font-size:12px;color:#64748b;">%</span>
        <button class="btn-secondary btn-sm ms-x" style="color:#dc2626;padding:4px 9px;">✕</button></div>`;
    const sum = () => [...document.querySelectorAll('#ms-rows .ms-p')].reduce((a, i) => a + (Number(i.value) || 0), 0);
    const showSum = () => {
      const t = Math.round(sum() * 100) / 100;
      const el = document.getElementById('ms-sum');
      if (el) { el.textContent = `Total ${t}%`; el.style.color = Math.abs(t - 100) < 0.001 ? '#15803d' : '#dc2626'; }
    };
    const wire = () => {
      document.querySelectorAll('#ms-rows .ms-p').forEach((i) => { i.oninput = showSum; });
      document.querySelectorAll('#ms-rows .ms-x').forEach((b) => { b.onclick = () => { b.closest('.mf-srow').remove(); showSum(); }; });
      showSum();
    };
    H.openModal({
      id: 'mf-split', width: 620, title: 'Split ledger over heads',
      subtitle: x.name,
      bodyHTML: `<div class="mf-note" style="margin-bottom:10px;">The ledger's amount is divided by these shares — the shares must add up to 100%.</div>
        <div id="ms-rows">${start.map(rowHTML).join('')}</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="btn-secondary btn-sm" id="ms-add">+ Add another head</button>
          <span id="ms-sum" style="margin-left:auto;font-weight:700;font-size:13px;"></span></div>
        ${(x.src === 'saved' && x.split) || pending ? '<div style="margin-top:12px;"><button class="btn-secondary btn-sm" id="ms-clear">Remove split (one head again)</button></div>' : ''}`,
      confirmText: 'Use this split',
      onOpen: () => {
        wire();
        document.getElementById('ms-add').onclick = () => { document.getElementById('ms-rows').insertAdjacentHTML('beforeend', rowHTML({ h: '', p: '' })); wire(); };
        const c = document.getElementById('ms-clear');
        if (c) c.onclick = () => { _split[x.name] = ''; H.closeModal('mf-split'); render(); };
      },
      onConfirm: async () => {
        const list = [...document.querySelectorAll('#ms-rows .mf-srow')].map((r) => ({ h: r.querySelector('.ms-h').value, p: Number(r.querySelector('.ms-p').value) || 0 }))
          .filter((r) => r.h || r.p);
        if (list.some((r) => !r.h)) throw new Error('Choose the head on every line');
        if (list.some((r) => r.p <= 0)) throw new Error('Every head needs a share above 0%');
        if (new Set(list.map((r) => r.h)).size !== list.length) throw new Error('The same head is chosen twice');
        const t = Math.round(list.reduce((a, r) => a + r.p, 0) * 100) / 100;
        if (Math.abs(t - 100) > 0.001) throw new Error(`The shares add up to ${t}% — make them 100%`);
        _split[x.name] = list;   // one head at 100% is saved as a plain mapping
        H.closeModal('mf-split');
        await render();
        H.toast('Split ready — press Save Mapping');
      },
    });
  }

  /* ── Divisions ────────────────────────────────────────────────────── */

  function divisionsTab() {
    return `<div class="br-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;max-width:560px;">
      <div style="font-size:12px;color:#64748b;margin-bottom:8px;">One per line. Renaming a line keeps its uploads (same position).</div>
      <textarea id="mf-divs" rows="6" style="${H.CONTROL}resize:vertical;">${esc(D.divisions.join('\n'))}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn-primary btn-sm" id="mf-dsave">Save Divisions</button></div>
    </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    bindNewHead();
    document.querySelectorAll('[data-mf-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-mf-tab'); render(); }));
    $('mf-up')?.addEventListener('click', uploadForm);
    $('mf-period')?.addEventListener('change', (e) => { _period = e.target.value; render(); });
    $('mf-div')?.addEventListener('change', (e) => { _div = e.target.value; render(); });
    document.querySelectorAll('[data-stmt]').forEach((b) => b.addEventListener('click', () => { _stmt = b.getAttribute('data-stmt'); render(); }));
    $('mf-xlsx')?.addEventListener('click', () => downloadXlsx().catch(H.fail));
    document.querySelectorAll('[data-stock]').forEach((b) => b.addEventListener('click', () => {
      const u = D.uploads.find((x) => String(x.id) === b.getAttribute('data-stock'));
      H.openModal({
        id: 'mf-stock', width: 520, title: 'Stock for this upload', subtitle: `${u.division} · ${periodLabel(u.from, u.to)}`,
        bodyHTML: H.grid(
          H.field('ms-open', 'Opening Stock (₹)', u.opening_stock ?? '', { type: 'number', step: '0.01', hint: 'Blank = from Tally' })
          + H.field('ms-close', 'Closing Stock (₹)', u.closing_stock ?? '', { type: 'number', step: '0.01' })),
        confirmText: 'Save',
        onConfirm: async () => {
          await H.patch(`/api/mis-finance/uploads/${u.id}`, { opening_stock: H.val('ms-open'), closing_stock: H.val('ms-close') });
          H.closeModal('mf-stock'); H.toast('Stock saved'); await refresh();
        },
      });
    }));
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const u = D.uploads.find((x) => String(x.id) === b.getAttribute('data-del'));
      if (!(await Utils.showConfirm(`Delete the ${u.division} Trial Balance for ${periodLabel(u.from, u.to)}?`, { title: 'Delete upload', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(`/api/mis-finance/uploads/${u.id}`); H.toast('Deleted'); M = null; await refresh(); } catch (e) { H.fail(e); }
    }));
    let t;
    $('mf-mq')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        _mapQ = e.target.value; await render();
        const again = $('mf-mq'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    });
    $('mf-monly')?.addEventListener('change', (e) => { _mapOnlyOpen = e.target.checked; render(); });
    async function saveMapping(btn) {
      const set = {};
      document.querySelectorAll('select[data-mrow]').forEach((s) => {
        const name = s.getAttribute('data-mrow');
        if (Object.prototype.hasOwnProperty.call(_split, name)) return;
        const x = M.find((m) => m.name === name);
        const was = x && x.src === 'saved' && !x.split ? x.head : '';
        if (s.value !== was) set[name] = s.value;
      });
      for (const [name, v] of Object.entries(_split)) set[name] = Array.isArray(v) && v.length === 1 ? v[0].h : v;
      if (!Object.keys(set).length) return H.toast('Nothing changed');
      if (btn) btn.disabled = true;
      try { await H.post('/api/mis-finance/mapping', { set }); H.toast('Mapping saved'); _split = {}; M = null; R = null; await render(); }
      catch (err) { if (btn) btn.disabled = false; H.fail(err); }
    }
    $('mf-msave')?.addEventListener('click', (e) => saveMapping(e.target));
    // Ticked rows → one head, saved straight away (with any other unsaved edits).
    wireBulk('mf-bulk', '.mf-tick', async (names, head) => {
      for (const name of names) {
        const sel = [...document.querySelectorAll('select[data-mrow]')].find((x) => x.getAttribute('data-mrow') === name);
        if (sel && !Object.prototype.hasOwnProperty.call(_split, name)) sel.value = head;
        else _split[name] = head;   // a split row becomes one head again
      }
      await saveMapping(null);
    });
    document.querySelectorAll('[data-msplit]').forEach((b) => b.addEventListener('click', () => {
      const x = M.find((m) => m.name === b.getAttribute('data-msplit'));
      if (x) splitForm(x);
    }));
    $('mf-hadd')?.addEventListener('click', () => headForm(null));
    document.querySelectorAll('[data-hedit]').forEach((b) => b.addEventListener('click', () => headForm(D.heads.find((h) => h.key === b.getAttribute('data-hedit')))));
    document.querySelectorAll('[data-hdel]').forEach((b) => b.addEventListener('click', async () => {
      const h = D.heads.find((x) => x.key === b.getAttribute('data-hdel'));
      if (!(await Utils.showConfirm(`Delete the head “${h.label}”? Ledgers on it go back to ${headLabel(h.base)} — the totals stay the same.`, { title: 'Delete head', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(`/api/mis-finance/heads/${encodeURIComponent(h.key)}`); H.toast('Head deleted'); await refresh(); } catch (e) { H.fail(e); }
    }));
    $('mf-dsave')?.addEventListener('click', async (e) => {
      const divisions = H.val('mf-divs').split('\n').map((x) => x.trim()).filter(Boolean);
      e.target.disabled = true;
      try { await H.post('/api/mis-finance/divisions', { divisions }); H.toast('Divisions saved'); await refresh(); }
      catch (err) { e.target.disabled = false; H.fail(err); }
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening MIS Financials…');
      M = null; R = null;
      try { await load(); await render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load MIS Financials', e.message); }
    },
  };
})();
