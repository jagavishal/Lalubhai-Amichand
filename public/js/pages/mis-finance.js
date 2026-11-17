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
  let _stmt = 'P';
  let _period = '';        // "from|to"
  let _div = '';           // '' = all divisions side by side; a name = that division vs last year
  let _mapQ = '';
  let _mapOnlyOpen = false;

  const STMT = { P: 'Profit & Loss', C: 'Cash Flow', R: 'Ratios' };
  const headLabel = (k) => D.heads.find((h) => h.key === k)?.label || '';
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
        <div class="mf-seg">${Object.entries(STMT).map(([k, l]) => `<button data-stmt="${k}" class="${k === _stmt ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
        <button class="btn-secondary btn-sm" id="mf-xlsx" style="margin-left:auto;">Download Excel</button>
      </div>
      ${notes.length ? `<div class="mf-note">${notes.join('<br>')}</div>` : ''}
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:auto;max-height:72vh;">${table}</div>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${R.days} days · amounts in ₹ · ratios use closing balances; day counts use the period's ${R.days} days</div>`;
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
    return `${H.table(['Division', 'Period', 'File', 'Tally Company', 'Opening', 'Closing Stock', 'Uploaded', { label: '', m: 'actions' }],
      D.uploads.map((u) => [
        `<b>${esc(u.division)}</b>`, esc(periodLabel(u.from, u.to)), esc(u.file_name || '—'), esc(u.company || '—'),
        u.has_opening ? H.pill('In file', 'success') : H.pill('No', 'neutral'),
        u.closing_stock == null ? '—' : '₹ ' + H.inr0(u.closing_stock),
        `${esc(u.uploaded_by)}<div style="font-size:11px;color:#94a3b8;">${H.fmtDate(u.at)}</div>`,
        `<button class="btn-secondary btn-sm" data-del="${u.id}" style="color:#dc2626;">Delete</button>`,
      ]), { empty: 'No Trial Balance uploaded yet', cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Uploading the same division and period again replaces it.</div>`;
  }

  let _sheet = null;      // rows of the chosen file
  let _sheetName = '';    // which worksheet, when the workbook has several
  let _preview = null;

  function uploadForm() {
    _sheet = null; _preview = null;
    H.openModal({
      id: 'mf-form', width: 900, title: 'Upload Tally Trial Balance',
      subtitle: 'Exported from Tally to Excel — one division, one period',
      bodyHTML: `${H.grid(
        H.select('mu-div', 'Division', D.divisions[0], D.divisions, { required: true })
        + `<div><label style="${H.LABEL}">Trial Balance file (.xlsx / .xls) <span style="color:#ef4444">*</span></label>
            <input id="mu-file" type="file" accept=".xlsx,.xls,.xlsm,.csv" style="${H.CONTROL}padding:6px;" /></div>`
        + H.field('mu-from', 'Period From', '', { type: 'date', required: true })
        + H.field('mu-to', 'Period To', '', { type: 'date', required: true })
        + H.field('mu-stock', 'Closing Stock (₹) — for this period', '', { type: 'number', step: '0.01', hint: 'Tally\'s Trial Balance shows only the Opening Stock — type the closing stock (as in the old “Closing Stock (INPUT)”)' })
        + `<div id="mu-stock2-wrap" style="display:none;">${H.field('mu-stock2', 'Closing Stock (₹) — comparative period', '', { type: 'number', step: '0.01', hint: 'For the last-year columns in the same file' })}</div>`,
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
    const out = {};
    document.querySelectorAll('#mu-preview select[data-map]').forEach((s) => { if (s.value) out[s.getAttribute('data-map')] = s.value; });
    return out;
  }
  const headSelect = (attr, name, value, blank = '— choose head —') => `<select ${attr}="${esc(name)}" style="${H.CONTROL}padding:5px 8px;font-size:12px;">
      <option value="">${esc(blank)}</option>
      ${D.heads.map((h) => `<option value="${h.key}"${h.key === value ? ' selected' : ''}>${esc(h.label)}${h.pl ? ' (P&L)' : ''}</option>`).join('')}</select>`;

  async function runPreview() {
    const box = document.getElementById('mu-preview');
    _preview = await H.post('/api/mis-finance/preview', { sheet: _sheet, mappings: pickedMappings() });
    const p = _preview;
    if (p.period) {
      if (!H.val('mu-from')) document.getElementById('mu-from').value = p.period.from;
      if (!H.val('mu-to')) document.getElementById('mu-to').value = p.period.to;
    }
    const SRC = { saved: 'saved', rule: 'by name', tally: 'Tally group', group: 'from group' };
    const warn = [];
    if (Math.abs(p.diffClose) > 0.5) warn.push(`The rows read do not tally: closing Dr − Cr = ₹ ${H.inr0(p.diffClose)}. A row may be counted twice or missing — check the tree below.`);
    if (!p.hasOpening) warn.push('No opening balance column — the Cash Flow will use the previous period\'s upload for this division if there is one.');
    if (p.needsClosingStock) warn.push('This Trial Balance shows only the Opening Stock — enter the Closing Stock above.');
    const w2 = document.getElementById('mu-stock2-wrap');
    if (w2) w2.style.display = p.comparative ? '' : 'none';
    box.innerHTML = `
      <div class="mf-note">${p.company ? `<b>${esc(p.company)}</b> · ` : ''}${p.rows.length} rows · ${p.rows.filter((r) => r.leaf).length} ledgers counted
        ${p.period ? ` · period ${esc(periodLabel(p.period.from, p.period.to))}` : ''}${p.hasOpening ? ' · opening + closing' : ' · closing only'}${_sheetName ? ` · sheet “${esc(_sheetName)}”` : ''}
        ${p.comparative ? `<br>Also has <b>${esc(periodLabel(p.comparative.period.from, p.comparative.period.to))}</b> — saved as that period too (if it is not uploaded yet), for the last-year comparison.` : ''}</div>
      ${warn.map((w) => `<div class="mf-warn">${esc(w)}</div>`).join('')}
      ${p.unmapped.length ? `<div style="font-weight:700;font-size:12.5px;margin:6px 0;">Map these ${p.unmapped.length} ledger${p.unmapped.length === 1 ? '' : 's'} (remembered for next time)</div>
        ${H.table(['Ledger', { label: 'Closing (Dr − Cr)', align: 'right' }, 'Report head'],
          p.unmapped.map((u) => [esc(u.name), H.inr0(u.close), headSelect('data-map', u.name, '')]), { cards: true })}` : ''}
      <details style="margin-top:10px;"><summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--color-primary);">Show how every row was read</summary>
        <div style="max-height:340px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;margin-top:6px;">
          <table class="mf-tbl"><thead><tr><th>Particulars</th><th>Opening</th><th>Closing</th><th style="text-align:left;">Head</th></tr></thead><tbody>
          ${p.rows.map((r) => `<tr><td style="padding-left:${10 + r.depth * 16}px;${r.leaf ? '' : 'font-weight:700;'}">${esc(r.name)}</td>
            <td>${H.inr0(r.open)}</td><td>${H.inr0(r.close)}</td>
            <td style="text-align:left;color:${r.head ? '#334155' : '#dc2626'};">${r.leaf ? esc(headLabel(r.head) || 'not mapped') + (r.src ? ` <span style="color:#94a3b8;font-size:11px;">(${esc(SRC[r.src] || r.src)})</span>` : '') : '<span style="color:#94a3b8;">group total</span>'}</td></tr>`).join('')}
          </tbody></table></div></details>`;
    box.querySelectorAll('select[data-map]').forEach((s) => s.addEventListener('change', () => { if (s.value) runPreview().catch(H.fail); }));
  }

  /* ── Mapping ──────────────────────────────────────────────────────── */

  async function mappingTab() {
    if (!M) M = (await H.api('/api/mis-finance/mapping')).names;
    const n = _mapQ.trim().toLowerCase();
    const list = M.filter((x) => (!n || x.name.toLowerCase().includes(n)) && (!_mapOnlyOpen || !x.head));
    const SRC = { saved: 'Saved', rule: 'By name rule', tally: 'Tally group', group: 'From its group' };
    return `
      <div class="mf-note">Every ledger / group seen in the uploads. A ledger follows its group unless you set it here (e.g. move “Director Remuneration” to Salary & Staff Cost). Changes apply to every report straight away.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <input id="mf-mq" value="${esc(_mapQ)}" placeholder="Search ledger / group…" style="${H.CONTROL}max-width:300px;" />
        <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;"><input type="checkbox" id="mf-monly"${_mapOnlyOpen ? ' checked' : ''}/> Only unmapped</label>
        <button class="btn-primary btn-sm" id="mf-msave" style="margin-left:auto;">Save Mapping</button>
      </div>
      ${H.table(['Ledger / Group', 'Type', 'Divisions', 'Report Head', 'How'],
        list.map((x) => [esc(x.name), x.leaf ? 'Ledger' : 'Group', esc(x.divisions.join(', ')),
          headSelect('data-mrow', x.name, x.src === 'saved' ? x.head : '', x.src === 'saved' ? '— back to automatic —' : x.head ? `Auto: ${headLabel(x.head)}` : '— not mapped —'),
          esc(SRC[x.src] || '—')]),
        { empty: 'Upload a Trial Balance first', cards: true, page: { key: 'mf-map', sig: [_mapQ, _mapOnlyOpen], onPage: render } })}`;
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
    document.querySelectorAll('[data-mf-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-mf-tab'); render(); }));
    $('mf-up')?.addEventListener('click', uploadForm);
    $('mf-period')?.addEventListener('change', (e) => { _period = e.target.value; render(); });
    $('mf-div')?.addEventListener('change', (e) => { _div = e.target.value; render(); });
    document.querySelectorAll('[data-stmt]').forEach((b) => b.addEventListener('click', () => { _stmt = b.getAttribute('data-stmt'); render(); }));
    $('mf-xlsx')?.addEventListener('click', () => downloadXlsx().catch(H.fail));
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
    $('mf-msave')?.addEventListener('click', async (e) => {
      const set = {};
      document.querySelectorAll('select[data-mrow]').forEach((s) => {
        const x = M.find((m) => m.name === s.getAttribute('data-mrow'));
        const was = x && x.src === 'saved' ? x.head : '';
        if (s.value !== was) set[s.getAttribute('data-mrow')] = s.value;
      });
      if (!Object.keys(set).length) return H.toast('Nothing changed');
      e.target.disabled = true;
      try { await H.post('/api/mis-finance/mapping', { set }); H.toast('Mapping saved'); M = null; R = null; await render(); }
      catch (err) { e.target.disabled = false; H.fail(err); }
    });
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
