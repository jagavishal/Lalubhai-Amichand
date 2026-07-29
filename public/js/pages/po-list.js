window.Pages = window.Pages || {};

// ── PO List ──────────────────────────────────────────────────────────────────
// Read-only history of every PO created via the PO Creation tab, read straight
// from the "ERP PO Log" tab (GET /api/po-creation/list) — filterable by format,
// department, party, and date range. No local mirror; the sheet stays the
// single source of truth.
window.Pages['po-list'] = (() => {
  const FORMATS = ['PurchaseOrder', 'ENR PO', 'Diamond PO'];
  const FORMAT_LABEL = { PurchaseOrder: 'Purchase Order', 'ENR PO': 'ENR PO', 'Diamond PO': 'Diamond PO' };

  /* ── state ──────────────────────────────────────────────────── */
  let _rows = [];
  let _loaded = false;
  let _loadError = '';
  let _fFormat = '';
  let _fDept = '';
  let _fParty = '';
  let _fFrom = '';
  let _fTo = '';

  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  async function _load() {
    _loaded = false;
    _loadError = '';
    _renderTable();
    try {
      _rows = await Utils.apiFetch('/api/po-creation/list') || [];
    } catch (e) {
      _rows = [];
      _loadError = e.message || 'Failed to load POs';
    }
    _loaded = true;
    _refreshDeptOptions();
    _renderTable();
  }

  function _departmentOptions() {
    return Array.from(new Set(_rows.map(r => r.department).filter(Boolean))).sort();
  }

  function _refreshDeptOptions() {
    const sel = document.getElementById('pol-dept');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Departments</option>' + _departmentOptions().map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
    if (current) sel.value = current;
  }

  function _filteredRows() {
    return _rows.filter(r => {
      if (_fFormat && r.format !== _fFormat) return false;
      if (_fDept && r.department !== _fDept) return false;
      if (_fParty && !(r.party || '').toLowerCase().includes(_fParty.toLowerCase())) return false;
      if (_fFrom && (r.date || '') < _fFrom) return false;
      if (_fTo && (r.date || '') > _fTo) return false;
      return true;
    });
  }

  function _renderTable() {
    const body = document.getElementById('pol-body');
    const countEl = document.getElementById('pol-count');
    if (!body) return;

    if (!_loaded) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (_loadError) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_loadError) + '</td></tr>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = _filteredRows();
    if (countEl) countEl.textContent = rows.length + ' of ' + _rows.length;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_rows.length ? 'No POs match these filters' : 'No POs created yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">#' + esc(r.poNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;"><span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:600;">' + esc(FORMAT_LABEL[r.format] || r.format) + '</span></td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.party) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.department) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.total) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.createdBy) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + (r.pdfLink ? '<a href="' + esc(r.pdfLink) + '" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">View PDF</a>' : '<span style="color:#cbd5e1;">—</span>') + '</td>'
      + '</tr>').join('');
  }

  function _filterBarHtml() {
    const _inputStyle = 'box-sizing:border-box;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#1e293b;outline:none;background:#fff;';
    const formatOptions = '<option value="">All Formats</option>' + FORMATS.map(f => '<option value="' + esc(f) + '">' + esc(FORMAT_LABEL[f]) + '</option>').join('');
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<select id="pol-format" style="' + _inputStyle + 'min-width:140px;">' + formatOptions + '</select>'
      + '<select id="pol-dept" style="' + _inputStyle + 'min-width:160px;"><option value="">All Departments</option></select>'
      + '<input type="text" id="pol-party" placeholder="Search customer/vendor…" style="' + _inputStyle + 'min-width:200px;flex:1;" />'
      + '<input type="date" id="pol-from" style="' + _inputStyle + '" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="pol-to" style="' + _inputStyle + '" />'
      + '<button type="button" id="pol-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="pol-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _bindFilterBar() {
    document.getElementById('pol-format').addEventListener('change', (e) => { _fFormat = e.target.value; _renderTable(); });
    document.getElementById('pol-dept').addEventListener('change', (e) => { _fDept = e.target.value; _renderTable(); });
    document.getElementById('pol-party').addEventListener('input', (e) => { _fParty = e.target.value; _renderTable(); });
    document.getElementById('pol-from').addEventListener('change', (e) => { _fFrom = e.target.value; _renderTable(); });
    document.getElementById('pol-to').addEventListener('change', (e) => { _fTo = e.target.value; _renderTable(); });
    document.getElementById('pol-clear').addEventListener('click', () => {
      _fFormat = ''; _fDept = ''; _fParty = ''; _fFrom = ''; _fTo = '';
      document.getElementById('pol-format').value = '';
      document.getElementById('pol-dept').value = '';
      document.getElementById('pol-party').value = '';
      document.getElementById('pol-from').value = '';
      document.getElementById('pol-to').value = '';
      _renderTable();
    });
    document.getElementById('pol-refresh').addEventListener('click', _load);
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    el.innerHTML = '<div style="max-width:1200px;margin:0 auto;padding:4px 0 40px;">'
      + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<div>'
          + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">PO List</h1>'
          + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Every PO created via PO Creation, read live from the sheet\'s ERP PO Log.</p>'
        + '</div>'
        + '<span id="pol-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _filterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:920px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['PO No','Format','Date','Party','Department','Total (INR)','Created By','PDF'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + h + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="pol-body"><tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
        + '</table>'
      + '</div>'
    + '</div>';

    _bindFilterBar();
    _load();
  }

  return {
    render() { renderPage(); },
  };
})();
