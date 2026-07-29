window.Pages = window.Pages || {};

// ── GRN List ─────────────────────────────────────────────────────────────────
// Read-only history of every GRN created via the GRN Creation tab, read straight
// from the "ERP GRN Log" tab (GET /api/grn-creation/list) — filterable by vendor
// and date range. No local mirror; the sheet stays the single source of truth.
window.Pages['grn-list'] = (() => {
  /* ── state ──────────────────────────────────────────────────── */
  let _rows = [];
  let _loaded = false;
  let _loadError = '';
  let _fVendor = '';
  let _fFrom = '';
  let _fTo = '';

  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  async function _load() {
    _loaded = false;
    _loadError = '';
    _renderTable();
    try {
      _rows = await Utils.apiFetch('/api/grn-creation/list') || [];
    } catch (e) {
      _rows = [];
      _loadError = e.message || 'Failed to load GRNs';
    }
    _loaded = true;
    _renderTable();
  }

  function _filteredRows() {
    return _rows.filter(r => {
      if (_fVendor && !(r.vendorName || '').toLowerCase().includes(_fVendor.toLowerCase())) return false;
      if (_fFrom && (r.date || '') < _fFrom) return false;
      if (_fTo && (r.date || '') > _fTo) return false;
      return true;
    });
  }

  function _renderTable() {
    const body = document.getElementById('grnl-body');
    const countEl = document.getElementById('grnl-count');
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
      body.innerHTML = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_rows.length ? 'No GRNs match these filters' : 'No GRNs created yet') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => ''
      + '<tr style="border-bottom:1px solid #f1f5f9;">'
        + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">#' + esc(r.grNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.vendorName) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.prNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.poNo) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.total) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.createdBy) + '</td>'
        + '<td style="padding:8px 10px;font-size:12.5px;">' + (r.pdfLink ? '<a href="' + esc(r.pdfLink) + '" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">View PDF</a>' : '<span style="color:#cbd5e1;">—</span>') + '</td>'
      + '</tr>').join('');
  }

  function _filterBarHtml() {
    const _inputStyle = 'box-sizing:border-box;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#1e293b;outline:none;background:#fff;';
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
      + '<input type="text" id="grnl-vendor" placeholder="Search vendor…" style="' + _inputStyle + 'min-width:200px;flex:1;" />'
      + '<input type="date" id="grnl-from" style="' + _inputStyle + '" />'
      + '<span style="color:#94a3b8;font-size:12px;">to</span>'
      + '<input type="date" id="grnl-to" style="' + _inputStyle + '" />'
      + '<button type="button" id="grnl-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
      + '<button type="button" id="grnl-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
    + '</div>';
  }

  function _bindFilterBar() {
    document.getElementById('grnl-vendor').addEventListener('input', (e) => { _fVendor = e.target.value; _renderTable(); });
    document.getElementById('grnl-from').addEventListener('change', (e) => { _fFrom = e.target.value; _renderTable(); });
    document.getElementById('grnl-to').addEventListener('change', (e) => { _fTo = e.target.value; _renderTable(); });
    document.getElementById('grnl-clear').addEventListener('click', () => {
      _fVendor = ''; _fFrom = ''; _fTo = '';
      document.getElementById('grnl-vendor').value = '';
      document.getElementById('grnl-from').value = '';
      document.getElementById('grnl-to').value = '';
      _renderTable();
    });
    document.getElementById('grnl-refresh').addEventListener('click', _load);
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    el.innerHTML = '<div style="max-width:1200px;margin:0 auto;padding:4px 0 40px;">'
      + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">'
        + '<div>'
          + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">GRN List</h1>'
          + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Every GRN created via GRN Creation, read live from the sheet\'s ERP GRN Log.</p>'
        + '</div>'
        + '<span id="grnl-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
      + '</div>'
      + _filterBarHtml()
      + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:920px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + ['GR No', 'Date', 'Vendor', 'PR No', 'PO No', 'Total (INR)', 'Created By', 'PDF'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody id="grnl-body"><tr><td colspan="8" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
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
