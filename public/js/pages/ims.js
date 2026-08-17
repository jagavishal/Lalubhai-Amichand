window.Pages = window.Pages || {};

// ── IMS (Inventory Management System) ──────────────────────────────────────
// One separate IMS per stock book, each its own sidebar entry and its own
// route: IMS Stores / IMS Alu & SS / IMS Accessories / IMS Trading (see
// IMS_BOOKS below and the matching IMS_CATEGORY_TABS in server.js). The ALU
// book is labelled "Alu & SS" because stainless-steel items live in it too,
// but its stored category value is still plain 'ALU'.
//
// Each book page has the same three tabs — Inward, Outward, Report — and every
// one of them is hard-scoped to that page's book, so there is no Category
// dropdown anywhere in the forms or filter bars. The route IS the category.
// createPage() below is a factory: each book gets its own closure, so the
// three pages hold entirely separate filter/table state and can't leak rows
// into each other.
//
// Inward/Outward just mount the standalone modules that used to be separate
// sidebar pages (see inward.js/outward.js — their render() takes
// {containerId, embedded, category} for exactly this); those two ARE module
// singletons, so they re-scope themselves whenever the category they're handed
// changes. Report (this file's own code, below) is the item-master dashboard:
// catalog + live current stock (kept in sync by Inward/Outward and /api/ims/*
// in server.js — a plain SQL table, not Google-Sheets-backed like PR/PO/GRN).
// Rows at or below their Minimum Order Qty are flagged Low Stock. Add/Edit
// here only ever touches catalog fields (description/size/uom/moq/maxLevel/
// onOrderQty/vendorName) — current stock only moves via Inward/Outward
// transactions, and the category comes from the page rather than the form.
//
// Trading (TRD/Hindalco job-work) is the only book that carries a
// per-transaction Source — see inward.js/outward.js, which show that field on
// the Trading page only.
//
// Adding a fifth book means one entry in IMS_BOOKS here plus matching entries
// in IMS_CATEGORIES + IMS_CATEGORY_TABS (server.js), sidebar.js's nav list and
// users.js's ALL_PAGES.
(() => {
  // route must match sidebar.js's nav entries and users.js's ALL_PAGES keys;
  // category must be a value in server.js's IMS_CATEGORIES.
  // Alloy grades the Trading Series tab charts — display copy only; the actual
  // bucketing happens server-side and must stay in step with IMS_ALLOY_SERIES
  // in server.js.
  const SERIES_LABELS = ['6061', '6082', '7075', '2014'];

  const IMS_BOOKS = [
    { route: 'ims-stores',      category: 'Stores',      label: 'IMS Stores' },
    { route: 'ims-alu',         category: 'ALU',         label: 'IMS Alu & SS' },
    { route: 'ims-accessories', category: 'Accessories', label: 'IMS Accessories' },
    { route: 'ims-trading',     category: 'Trading',     label: 'IMS Trading' },
  ];

  // Which book page is currently on screen. All four pages render into the
  // same #main-content using the same element ids (#ims-body, #ims-history-
  // body, …), so a fetch started on one page will happily paint into another
  // one's table if it resolves after you've navigated away — showing Stores
  // rows under the "IMS Alu & SS" heading. Every DOM write below is gated on
  // this, so a late response from a page you've left is simply dropped (its
  // own closure state is still updated, so returning to that page shows the
  // right rows without re-fetching).
  let _mountedRoute = null;

  function createPage(book) {
    /* ── state ──────────────────────────────────────────────────── */
    let _rows = [];
    let _loaded = false;
    let _loadError = '';
    let _search = ''; // still used by the Day-wise Stock toolbar (see below)
    let _lowStockOnly = false;
    let _negativeOnly = false;
    // Item List's own filters — separate from _search (which the Day-wise Stock
    // tab still uses) so item code and item name can be filtered independently
    // instead of one fuzzy combined box.
    let _fItemCode = '';
    let _fItemName = '';
    let _fMinStock = '';
    let _fMaxStock = '';
    let _searchTimer = null;
    // This page's book — fixed for the life of the closure. Every fetch below is
    // scoped to it and it is never blank; "all books at once" isn't a view any
    // IMS page offers.
    const _book = book.category;

    let _formOpen = false;
    let _editingCode = null; // null = "add new item" mode

    // Day-wise Stock view: a per-item closing-stock matrix, one column per day,
    // matching the reference sheet's daily layout. Shares the same search/
    // category filters as the list view above; range defaults to 7 days with
    // 14/21/30/"3 months" as the other presets.
    // Physical Stock Log view: audit trail of every physical-stock count logged
    // via the "Physical Stock" row action below (see /api/ims/physical-stock/*
    // in server.js) — mirrors Inward/Outward List's filter+table+cancel shape.
    let _viewMode = 'list'; // 'list' | 'daywise' | 'physical'
    let _historyDays = 7;
    let _historyDayOptions = [7, 14, 21, 30, 92];
    let _historyDates = [];
    let _historyRows = [];
    let _historyLoaded = false;
    let _historyLoadError = '';

    let _physRows = [];
    let _physLoaded = false;
    let _physLoadError = '';
    let _physFItem = '';
    let _physFFrom = '';
    let _physFTo = '';

    // Series tab (Trading book only — see _isTrading below): per-alloy-grade
    // rollup of the catalog, charted as bars. Rows come pre-bucketed and
    // pre-ordered from /api/ims/series-summary.
    let _seriesRows = [];
    let _seriesMonthly = []; // [{ month:'2026-08', series:{ '6061': {inward, outward} } }]
    let _seriesLoaded = false;
    let _seriesLoadError = '';
    let _seriesFrom = '';
    let _seriesTo = '';

    function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
    // 1234.5 -> "1,234.5" — stock is stored as a decimal but is a whole number
    // most of the time, so trailing .00 is dropped rather than padded.
    function _fmtQty(n) {
      return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }
    function _today() { return new Date().toISOString().slice(0, 10); }
    // Display name of this book ("IMS Alu & SS"), vs _book which is the stored
    // category value ('ALU') everything is actually queried by.
    const _bookLabel = book.label;
    // Same thing without the "IMS " prefix, for use mid-sentence.
    const _bookName = _bookLabel.replace(/^IMS\s+/i, '');
    // Safe for a filename: "Alu & SS" -> "Alu_SS".
    const _bookSlug = _bookName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    // True only while this book's page owns #main-content — see _mountedRoute.
    function _isActive() { return _mountedRoute === book.route; }
    // The Series tab exists on the Trading book alone: alloy grade is a
    // property of Hindalco bar stock, and nothing in the Stores/ALU/Accessories
    // catalogs carries one.
    const _isTrading = _book === 'Trading';

    /* ── CSV export — quotes any cell with a comma/quote/newline (item
       descriptions and vendor names routinely have commas), unlike a bare
       join(','). Exports exactly what's on screen, so it respects whatever
       search/category/low-stock filters are currently applied. ───────────── */
    function _csvCell(v) {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function _downloadCSV(filename, headers, rows) {
      const csv = [headers, ...rows].map(r => r.map(_csvCell).join(',')).join('\r\n');
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })), // BOM so Excel shows ₹/non-ASCII correctly
        download: filename,
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    function _exportItemsCSV() {
      if (!_rows.length) { Utils.showToast('No items to export', 'warning'); return; }
      const headers = ['Item Code', 'Category', 'Description', 'Size', 'UOM', 'Current Stock', 'MOQ', 'Max Level', 'On Order Qty', 'Vendor Name'];
      const rows = _rows.map(r => [r.itemCode, r.category || _book, r.description, r.size, r.uom, r.currentStock, r.moq, r.maxLevel, r.onOrderQty, r.vendorName]);
      // Same totals the on-screen table's last row shows (Current Stock and On
      // Order only — see _itemTotalsRowHtml).
      rows.push(['Total (' + _rows.length + ' items)', '', '', '', '',
        _rows.reduce((s, r) => s + _num(r.currentStock), 0), '', '',
        _rows.reduce((s, r) => s + _num(r.onOrderQty), 0), '']);
      _downloadCSV('IMS_' + _bookSlug + '_Items_' + _todayStamp() + '.csv', headers, rows);
    }
    function _exportHistoryCSV() {
      if (!_historyRows.length) { Utils.showToast('No items to export', 'warning'); return; }
      const headers = ['Item Code', 'Description', 'Size', 'UOM', ..._historyDates.map(_dateLabel)];
      const rows = _historyRows.map(r => [r.itemCode, r.description, r.size, r.uom, ...(r.daily || [])]);
      rows.push(['Total (' + _historyRows.length + ' items)', '', '', '',
        ..._historyDates.map((_, i) => _historyRows.reduce((s, r) => s + _num((r.daily || [])[i]), 0))]);
      _downloadCSV('IMS_' + _bookSlug + '_DayWiseStock_' + _todayStamp() + '.csv', headers, rows);
    }
    function _todayStamp() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // Color coding lifted 1:1 from the reference sheet's own Apps Script
    // (getColorForStockLevel in the "Calculations" menu): buckets stock as a
    // % of Max Level into red/yellow/green/purple, same thresholds + hex values.
    // One deliberate deviation: the sheet divides by Max Level with no zero
    // guard, so an unset (0/blank) Max Level silently falls through to purple
    // there. Most items here don't have a Max Level populated yet (the opening-
    // stock import only carried stock quantities), so mirroring that literally
    // would paint almost everything purple — instead we show no color until a
    // real Max Level is set for that item.
    function _stockLevelColor(stock, maxLevel) {
      const max = _num(maxLevel);
      if (max <= 0) return null;
      const pct = (_num(stock) / max) * 100;
      if (pct <= 33) return '#ea9999';   // Red
      if (pct <= 66) return '#ffd966';   // Yellow
      if (pct <= 100) return '#b6d7a8';  // Green
      return '#b4a7d6';                  // Purple — over Max Level
    }

    function _colorLegendHtml() {
      const items = [
        ['#ea9999', '≤33% of Max Level'],
        ['#ffd966', '34–66%'],
        ['#b6d7a8', '67–100%'],
        ['#b4a7d6', '>100% (over Max)'],
      ];
      return '<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:-4px 0 14px;font-size:11.5px;color:#64748b;">'
        + items.map(([c, label]) => '<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:11px;height:11px;border-radius:3px;background:' + c + ';display:inline-block;"></span>' + esc(label) + '</span>').join('')
      + '</div>';
    }

    /* ── Helpers (styled like PO/GRN Creation, for a consistent look) ─────── */
    function _fieldWrap(label, innerHtml, extra) {
      return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;' + (extra || '') + '">'
        + '<div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:8px;">' + esc(label) + '</div>'
        + innerHtml
        + '</div>';
    }
    const _inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;';
    function _textField(id, label, opts) {
      opts = opts || {};
      return _fieldWrap(label, '<input type="' + (opts.type || 'text') + '" id="' + id + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" ' + (opts.disabled ? 'disabled style="' + _inputStyle + 'background:#f1f5f9;color:#94a3b8;"' : 'style="' + _inputStyle + '"') + ' />');
    }
    /* ── Load ───────────────────────────────────────────────────────────── */
    async function _load() {
      _loaded = false;
      _loadError = '';
      _renderTable();
      try {
        const params = new URLSearchParams();
        if (_fItemCode) params.set('itemCode', _fItemCode);
        if (_fItemName) params.set('itemName', _fItemName);
        if (_lowStockOnly) params.set('lowStock', '1');
        if (_negativeOnly) params.set('negativeStock', '1');
        if (_fMinStock !== '') params.set('minStock', _fMinStock);
        if (_fMaxStock !== '') params.set('maxStock', _fMaxStock);
        params.set('category', _book);
        _rows = await Utils.apiFetch('/api/ims/items?' + params.toString()) || [];
      } catch (e) {
        _rows = [];
        _loadError = e.message || 'Failed to load items';
      }
      _loaded = true;
      _renderTable();
    }

    async function _loadHistory() {
      _historyLoaded = false;
      _historyLoadError = '';
      _renderHistoryTable();
      try {
        const params = new URLSearchParams();
        params.set('days', String(_historyDays));
        if (_search) params.set('q', _search);
        params.set('category', _book);
        const data = await Utils.apiFetch('/api/ims/stock-history?' + params.toString());
        _historyDates = data?.dates || [];
        _historyRows = data?.items || [];
        if (Array.isArray(data?.dayOptions) && data.dayOptions.length) _historyDayOptions = data.dayOptions;
      } catch (e) {
        _historyDates = [];
        _historyRows = [];
        _historyLoadError = e.message || 'Failed to load stock history';
      }
      _historyLoaded = true;
      _renderHistoryTable();
    }

    async function _loadPhysical() {
      _physLoaded = false;
      _physLoadError = '';
      _renderPhysicalTable();
      try {
        _physRows = await Utils.apiFetch('/api/ims/physical-stock/list?category=' + encodeURIComponent(_book)) || [];
      } catch (e) {
        _physRows = [];
        _physLoadError = e.message || 'Failed to load physical stock log';
      }
      _physLoaded = true;
      _renderPhysicalTable();
    }

    function _renderTable() {
      if (!_isActive()) return;
      const body = document.getElementById('ims-body');
      const countEl = document.getElementById('ims-count');
      if (!body) return;

      if (!_loaded) {
        body.innerHTML = '<tr><td colspan="10" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }
      if (_loadError) {
        body.innerHTML = '<tr><td colspan="10" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_loadError) + '</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }
      if (countEl) countEl.textContent = _rows.length + ' item' + (_rows.length === 1 ? '' : 's');
      if (!_rows.length) {
        body.innerHTML = '<tr><td colspan="10" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">No items found</td></tr>';
        return;
      }
      body.innerHTML = _rows.map(r => {
        const negative = _num(r.currentStock) < 0;
        const low = !negative && _num(r.currentStock) <= _num(r.moq);
        const stockColor = _stockLevelColor(r.currentStock, r.maxLevel);
        return '<tr style="border-bottom:1px solid #f1f5f9;' + (negative ? 'background:#fff7ed;' : (low ? 'background:#fef2f2;' : '')) + '">'
          + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">' + esc(r.itemCode) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.description) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.size) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.uom) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;font-weight:700;' + (stockColor ? 'background:' + stockColor + ';' : '') + '">' + esc(r.currentStock)
            + (negative ? ' <span style="display:inline-flex;padding:2px 7px;border-radius:10px;background:#ffedd5;color:#c2410c;font-size:10.5px;font-weight:700;margin-left:4px;">NEGATIVE STOCK</span>' : '')
            + (low ? ' <span style="display:inline-flex;padding:2px 7px;border-radius:10px;background:#fee2e2;color:#dc2626;font-size:10.5px;font-weight:700;margin-left:4px;">LOW STOCK</span>' : '')
          + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.moq) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.maxLevel) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;">' + esc(r.onOrderQty) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.vendorName) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
            + '<button type="button" class="ims-edit-btn" data-code="' + esc(r.itemCode) + '" style="border:none;background:transparent;color:var(--color-primary);cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Edit</button>'
            + '<button type="button" class="ims-phys-btn" data-code="' + esc(r.itemCode) + '" style="border:none;background:transparent;color:#7c3aed;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Physical Stock</button>'
          + '</td>'
        + '</tr>';
      }).join('') + _itemTotalsRowHtml();
    }

    /* ── Totals row, pinned to the bottom of the Item List ────────────────────
       Only the two columns a sum actually means something for: Current Stock
       (the book's net position, negatives included) and On Order. MOQ and Max
       Level are per-item thresholds, so adding them up would be a number with
       no meaning — those cells stay blank. Reflects whatever filters are
       applied, since _rows only ever holds what the server returned for them. */
    function _itemTotalsRowHtml() {
      const stock = _rows.reduce((s, r) => s + _num(r.currentStock), 0);
      const onOrder = _rows.reduce((s, r) => s + _num(r.onOrderQty), 0);
      const cell = 'padding:10px;font-size:12.5px;font-weight:700;color:#0f172a;background:#f8fafc;';
      return '<tr style="border-top:2px solid #e2e8f0;">'
        + '<td colspan="4" style="' + cell + 'text-transform:uppercase;letter-spacing:.04em;font-size:11px;color:#64748b;">' + esc('Total · ' + _rows.length + ' item' + (_rows.length === 1 ? '' : 's')) + '</td>'
        + '<td style="' + cell + 'text-align:right;' + (stock < 0 ? 'color:#c2410c;' : '') + '">' + esc(_fmtQty(stock)) + '</td>'
        + '<td style="' + cell + '"></td>'
        + '<td style="' + cell + '"></td>'
        + '<td style="' + cell + 'text-align:right;">' + esc(_fmtQty(onOrder)) + '</td>'
        + '<td colspan="2" style="' + cell + '"></td>'
      + '</tr>';
    }

    function _dateLabel(iso) {
      // '2026-08-05' -> '05 Aug' — compact enough for ~90 columns side by side.
      const parts = String(iso).split('-');
      if (parts.length !== 3) return iso;
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const m = MONTHS[parseInt(parts[1], 10) - 1] || parts[1];
      return parts[2] + ' ' + m;
    }

    function _renderHistoryTable() {
      if (!_isActive()) return;
      const head = document.getElementById('ims-history-head');
      const body = document.getElementById('ims-history-body');
      const countEl = document.getElementById('ims-count');
      if (!body || !head) return;
      const colCount = 4 + _historyDates.length; // Item Code, Description, Size, UOM + one per day

      if (!_historyLoaded) {
        body.innerHTML = '<tr><td colspan="' + colCount + '" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }
      if (_historyLoadError) {
        body.innerHTML = '<tr><td colspan="' + colCount + '" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_historyLoadError) + '</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }
      if (countEl) countEl.textContent = _historyRows.length + ' item' + (_historyRows.length === 1 ? '' : 's') + ' · ' + _historyDates.length + ' day' + (_historyDates.length === 1 ? '' : 's');

      head.innerHTML = '<tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
        + ['Item Code', 'Description', 'Size', 'UOM'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;position:sticky;left:0;background:#f8fafc;">' + esc(h) + '</th>').join('')
        + _historyDates.map(d => '<th style="padding:8px 10px;text-align:right;font-size:10.5px;color:#94a3b8;white-space:nowrap;">' + esc(_dateLabel(d)) + '</th>').join('')
      + '</tr>';

      if (!_historyRows.length) {
        body.innerHTML = '<tr><td colspan="' + colCount + '" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">No items found</td></tr>';
        return;
      }
      body.innerHTML = _historyRows.map(r => {
        return '<tr style="border-bottom:1px solid #f1f5f9;">'
          + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;white-space:nowrap;position:sticky;left:0;background:#fff;">' + esc(r.itemCode) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">' + esc(r.description) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">' + esc(r.size) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.uom) + '</td>'
          + (r.daily || []).map(v => {
              const c = _stockLevelColor(v, r.maxLevel);
              return '<td style="padding:8px 10px;font-size:12.5px;text-align:right;' + (c ? 'background:' + c + ';' : '') + '">' + esc(v) + '</td>';
            }).join('')
        + '</tr>';
      }).join('') + _historyTotalsRowHtml();
    }

    /* ── Totals row, pinned to the bottom of the Day-wise Stock matrix —
       closing stock of every listed item added up, one total per day column,
       so the book's overall position can be read across the range. No stock-
       level colouring here: those buckets are a per-item % of that item's own
       Max Level and don't carry over to a sum. ─────────────────────────────── */
    function _historyTotalsRowHtml() {
      const totals = _historyDates.map((_, i) => _historyRows.reduce((s, r) => s + _num((r.daily || [])[i]), 0));
      const cell = 'padding:10px;font-size:12.5px;font-weight:700;color:#0f172a;background:#f8fafc;';
      return '<tr style="border-top:2px solid #e2e8f0;">'
        + '<td colspan="4" style="' + cell + 'text-transform:uppercase;letter-spacing:.04em;font-size:11px;color:#64748b;white-space:nowrap;position:sticky;left:0;">' + esc('Total · ' + _historyRows.length + ' item' + (_historyRows.length === 1 ? '' : 's')) + '</td>'
        + totals.map(t => '<td style="' + cell + 'text-align:right;' + (t < 0 ? 'color:#c2410c;' : '') + '">' + esc(_fmtQty(t)) + '</td>').join('')
      + '</tr>';
    }

    function _bindRowActions() {
      const body = document.getElementById('ims-body');
      if (!body || body.dataset.actionsBound) return;
      body.dataset.actionsBound = '1';
      body.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.ims-edit-btn');
        if (editBtn) {
          const row = _rows.find(r => String(r.itemCode) === editBtn.dataset.code);
          if (row) _openForm(row);
          return;
        }
        const physBtn = e.target.closest('.ims-phys-btn');
        if (physBtn) {
          const row = _rows.find(r => String(r.itemCode) === physBtn.dataset.code);
          if (row) _openPhysicalModal(row);
        }
      });
    }

    /* ── Physical Stock Log (view-mode 'physical') ───────────────────────── */
    function _filteredPhysicalRows() {
      return _physRows.filter(r => {
        if (_physFItem && !((r.itemCode || '') + ' ' + (r.itemName || '')).toLowerCase().includes(_physFItem.toLowerCase())) return false;
        if (_physFFrom && (r.date || '') < _physFFrom) return false;
        if (_physFTo && (r.date || '') > _physFTo) return false;
        return true;
      });
    }

    function _renderPhysicalTable() {
      if (!_isActive()) return;
      const body = document.getElementById('ims-phys-body');
      const countEl = document.getElementById('ims-count');
      if (!body) return;

      if (!_physLoaded) {
        body.innerHTML = '<tr><td colspan="7" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }
      if (_physLoadError) {
        body.innerHTML = '<tr><td colspan="7" style="padding:16px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_physLoadError) + '</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }
      const rows = _filteredPhysicalRows();
      if (countEl) countEl.textContent = rows.length + ' of ' + _physRows.length;
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' + (_physRows.length ? 'No entries match these filters' : 'No physical stock counts logged yet') + '</td></tr>';
        return;
      }
      body.innerHTML = rows.map(r => {
        const v = _num(r.variance);
        const vColor = v === 0 ? '#16a34a' : (v > 0 ? '#2563eb' : '#dc2626');
        return '<tr style="border-bottom:1px solid #f1f5f9;">'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.date) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;font-weight:700;">' + esc(r.itemCode) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.itemName) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;text-align:right;font-weight:700;color:' + vColor + ';">' + (v > 0 ? '+' : '') + esc(r.variance) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;color:#64748b;">' + esc(r.remarks) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.createdBy) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;white-space:nowrap;">'
            + (r.status === 'Cancelled'
              ? '<span style="display:inline-flex;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;">Cancelled</span>'
              : '<button type="button" class="ims-phys-cancel-btn" data-id="' + esc(r.id) + '" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px;">Cancel</button>')
          + '</td>'
        + '</tr>';
      }).join('');
    }

    function _bindPhysicalRowActions() {
      const body = document.getElementById('ims-phys-body');
      if (!body || body.dataset.actionsBound) return;
      body.dataset.actionsBound = '1';
      body.addEventListener('click', async (e) => {
        const cancelBtn = e.target.closest('.ims-phys-cancel-btn');
        if (cancelBtn) {
          const ok = await Utils.showConfirm('This physical stock entry will be marked Cancelled and its effect on current stock reversed. This can\'t be undone.', { title: 'Cancel Physical Stock Entry', confirmText: 'Cancel Entry', danger: true });
          if (!ok) return;
          try {
            await Utils.apiFetch('/api/ims/physical-stock/cancel?id=' + encodeURIComponent(cancelBtn.dataset.id), { method: 'PUT' });
            Utils.showToast('Entry cancelled', 'success');
            await _loadPhysical();
          } catch (err) {
            Utils.showToast(err.message || 'Failed to cancel', 'error');
          }
        }
      });
    }

    function _physicalFilterBarHtml() {
      return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
        + '<input type="text" id="ims-phys-f-item" placeholder="Search item code / name…" value="' + esc(_physFItem) + '" style="' + _inputStyle + 'min-width:200px;width:auto;flex:1;" />'
        + '<input type="date" id="ims-phys-f-from" value="' + esc(_physFFrom) + '" style="' + _inputStyle + 'width:auto;" />'
        + '<span style="color:#94a3b8;font-size:12px;">to</span>'
        + '<input type="date" id="ims-phys-f-to" value="' + esc(_physFTo) + '" style="' + _inputStyle + 'width:auto;" />'
        + '<button type="button" id="ims-phys-f-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
        + '<button type="button" id="ims-phys-f-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
      + '</div>';
    }

    function _bindPhysicalFilterBar() {
      document.getElementById('ims-phys-f-item').addEventListener('input', (e) => { _physFItem = e.target.value; _renderPhysicalTable(); });
      document.getElementById('ims-phys-f-from').addEventListener('change', (e) => { _physFFrom = e.target.value; _renderPhysicalTable(); });
      document.getElementById('ims-phys-f-to').addEventListener('change', (e) => { _physFTo = e.target.value; _renderPhysicalTable(); });
      document.getElementById('ims-phys-f-clear').addEventListener('click', () => {
        _physFItem = ''; _physFFrom = ''; _physFTo = '';
        document.getElementById('ims-phys-f-item').value = '';
        document.getElementById('ims-phys-f-from').value = '';
        document.getElementById('ims-phys-f-to').value = '';
        _renderPhysicalTable();
      });
      document.getElementById('ims-phys-f-refresh').addEventListener('click', _loadPhysical);
    }

    /* ── Physical Stock modal — triggered by the "Physical Stock" row action
       above; computes the variance client-side for a live preview, server does
       the authoritative computation + ledger entry (see _imsPhysicalStockUpdate
       in server.js). ─────────────────────────────────────────────────────── */
    function _openPhysicalModal(row) {
      const existing = document.getElementById('ims-phys-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'ims-phys-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:grid;place-items:center;padding:16px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);';
      overlay.innerHTML = '<div style="background:#fff;border-radius:18px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.2);animation:pop-in 200ms cubic-bezier(.16,1,.3,1);">'
        + '<div style="padding:22px 24px 4px;">'
          + '<div style="font-size:15px;font-weight:700;color:#0f172a;">Physical Stock — ' + esc(row.itemCode) + '</div>'
          + '<div style="font-size:12px;color:#64748b;margin:2px 0 14px;">' + esc(row.description) + '</div>'
        + '</div>'
        + '<form id="ims-phys-form" style="padding:0 24px 22px;display:flex;flex-direction:column;gap:12px;">'
          + _textField('ims-phys-date', 'Date', { type: 'date', value: _today() })
          + _fieldWrap('System Stock (current)', '<input type="text" value="' + esc(row.currentStock) + '" disabled style="' + _inputStyle + 'background:#f1f5f9;color:#94a3b8;" />')
          + _textField('ims-phys-count', 'Physical Stock Count')
          + _fieldWrap('Variance', '<div id="ims-phys-variance" style="font-size:13px;font-weight:700;color:#94a3b8;">Enter a count to see the variance</div>')
          + _fieldWrap('Remarks', '<textarea id="ims-phys-remarks" rows="2" style="' + _inputStyle + 'resize:vertical;"></textarea>')
          + '<div style="display:flex;gap:10px;margin-top:4px;">'
            + '<button type="submit" id="ims-phys-submit" style="padding:9px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13px;font-weight:700;cursor:pointer;">Save Physical Count</button>'
            + '<button type="button" id="ims-phys-cancel-modal" style="padding:9px 22px;border-radius:9px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
          + '</div>'
        + '</form>'
      + '</div>';
      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      document.getElementById('ims-phys-cancel-modal').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
      });

      const countInput = document.getElementById('ims-phys-count');
      const varianceEl = document.getElementById('ims-phys-variance');
      countInput.addEventListener('input', () => {
        if (countInput.value.trim() === '') { varianceEl.textContent = 'Enter a count to see the variance'; varianceEl.style.color = '#94a3b8'; return; }
        const v = Math.round((_num(countInput.value) - _num(row.currentStock)) * 100) / 100;
        varianceEl.textContent = (v > 0 ? '+' : '') + v + (v === 0 ? ' — matches system' : v > 0 ? ' — excess' : ' — shortage');
        varianceEl.style.color = v === 0 ? '#16a34a' : (v > 0 ? '#2563eb' : '#dc2626');
      });

      document.getElementById('ims-phys-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const physicalStock = countInput.value.trim();
        if (physicalStock === '' || _num(physicalStock) < 0) { Utils.showToast('Enter a valid physical stock count', 'error'); return; }
        const btn = document.getElementById('ims-phys-submit');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const result = await Utils.apiFetch('/api/ims/physical-stock', {
            method: 'POST',
            body: JSON.stringify({
              itemCode: row.itemCode,
              date: document.getElementById('ims-phys-date').value,
              physicalStock,
              remarks: document.getElementById('ims-phys-remarks').value.trim(),
            }),
          });
          Utils.showToast('Physical stock logged — variance ' + (result.variance > 0 ? '+' : '') + result.variance, 'success');
          close();
          await _load();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to log physical stock', 'error');
          btn.disabled = false; btn.textContent = 'Save Physical Count';
        }
      });
    }

    /* ── Filter bar — no category control: the active book tab already fixes
       it (see _book). ───────────────────────────────────────────────────── */
    function _filterBarHtml() {
      return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px;">'
        + '<input type="text" id="ims-f-code" placeholder="Item Code…" value="' + esc(_fItemCode) + '" style="' + _inputStyle + 'min-width:130px;width:auto;" />'
        + '<input type="text" id="ims-f-name" placeholder="Item Name…" value="' + esc(_fItemName) + '" style="' + _inputStyle + 'min-width:180px;width:auto;flex:1;" />'
        + '<input type="number" id="ims-f-minstock" placeholder="Min Stock" value="' + esc(_fMinStock) + '" style="' + _inputStyle + 'width:110px;" />'
        + '<span style="color:#94a3b8;font-size:12px;">to</span>'
        + '<input type="number" id="ims-f-maxstock" placeholder="Max Stock" value="' + esc(_fMaxStock) + '" style="' + _inputStyle + 'width:110px;" />'
      + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
        + '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#475569;cursor:pointer;">'
          + '<input type="checkbox" id="ims-lowstock" ' + (_lowStockOnly ? 'checked' : '') + ' /> Low stock only'
        + '</label>'
        + '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#475569;cursor:pointer;">'
          + '<input type="checkbox" id="ims-negstock" ' + (_negativeOnly ? 'checked' : '') + ' /> Negative stock only'
        + '</label>'
        + '<button type="button" id="ims-f-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear Filters</button>'
        + '<button type="button" id="ims-add-btn" style="padding:8px 14px;border-radius:8px;background:var(--color-primary);border:none;color:var(--color-primary-text);font-size:12.5px;font-weight:700;cursor:pointer;">+ Add ' + esc(_bookName) + ' Item</button>'
        + '<button type="button" id="ims-export-btn" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">⬇ Download CSV</button>'
        + '<button type="button" id="ims-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
      + '</div>';
    }

    function _bindFilterBar() {
      document.getElementById('ims-f-code').addEventListener('input', (e) => {
        _fItemCode = e.target.value;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(_load, 300);
      });
      document.getElementById('ims-f-name').addEventListener('input', (e) => {
        _fItemName = e.target.value;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(_load, 300);
      });
      document.getElementById('ims-f-minstock').addEventListener('input', (e) => {
        _fMinStock = e.target.value;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(_load, 400);
      });
      document.getElementById('ims-f-maxstock').addEventListener('input', (e) => {
        _fMaxStock = e.target.value;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(_load, 400);
      });
      document.getElementById('ims-lowstock').addEventListener('change', (e) => { _lowStockOnly = e.target.checked; _load(); });
      document.getElementById('ims-negstock').addEventListener('change', (e) => { _negativeOnly = e.target.checked; _load(); });
      document.getElementById('ims-f-clear').addEventListener('click', () => {
        // _book is deliberately untouched — it's the tab you're on, not a filter.
        _fItemCode = ''; _fItemName = ''; _fMinStock = ''; _fMaxStock = ''; _lowStockOnly = false; _negativeOnly = false;
        _renderReport(); // rebuilds the inputs themselves back to empty
        _load(); // filtering is server-side here (unlike Inward/Outward List), so clearing needs a real re-fetch
      });
      document.getElementById('ims-add-btn').addEventListener('click', () => _openForm(null));
      document.getElementById('ims-export-btn').addEventListener('click', _exportItemsCSV);
      document.getElementById('ims-refresh').addEventListener('click', _load);
    }

    /* ── Day-wise Stock toolbar (search shared with the list view, range
       replaces low-stock; category comes from the active book tab) ────────── */
    function _dayOptionLabel(n) { return n >= 60 ? '3 Months' : n + ' Days'; }

    function _historyToolbarHtml() {
      return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
        + '<input type="text" id="ims-h-search" placeholder="Search item code / description…" value="' + esc(_search) + '" style="' + _inputStyle + 'min-width:220px;width:auto;flex:1;" />'
        + '<div style="display:flex;gap:4px;background:#f1f5f9;padding:3px;border-radius:8px;">'
          + _historyDayOptions.map(n => '<button type="button" class="ims-h-range" data-days="' + n + '" style="padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;'
            + (n === _historyDays ? 'background:var(--color-primary);color:var(--color-primary-text);' : 'background:transparent;color:#475569;') + '">' + _dayOptionLabel(n) + '</button>').join('')
        + '</div>'
        + '<button type="button" id="ims-h-export" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">⬇ Download CSV</button>'
        + '<button type="button" id="ims-h-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
      + '</div>';
    }

    function _bindHistoryToolbar() {
      document.getElementById('ims-h-search').addEventListener('input', (e) => {
        _search = e.target.value;
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(_loadHistory, 300);
      });
      document.getElementById('ims-h-export').addEventListener('click', _exportHistoryCSV);
      document.getElementById('ims-h-refresh').addEventListener('click', _loadHistory);
      document.querySelectorAll('.ims-h-range').forEach(btn => {
        btn.addEventListener('click', () => {
          _historyDays = parseInt(btn.dataset.days, 10);
          _renderReport(); // re-render so the active-range highlight moves too
          _loadHistory();
        });
      });
    }

    /* ── Add/Edit form (inline panel, toggled open) ────────────────────── */
    function _openForm(row) {
      _editingCode = row ? row.itemCode : null;
      _formOpen = true;
      _renderReport(row);
    }

    function _closeForm() {
      _formOpen = false;
      _editingCode = null;
      _renderReport();
    }

    // Field ids are prefixed 'ims-if-' (item form), NOT 'ims-f-' — the filter bar
    // above already owns 'ims-f-code' and this panel renders above it in the same
    // document, so sharing the prefix made getElementById('ims-f-code') resolve
    // to whichever came first: typing an item code into the form re-ran the list
    // filter, and the filter box itself went dead while the form was open.
    // Trading stock is weighed, always, so its catalog UOM is a one-option
    // select rather than a free-text box — same rule the Inward/Outward forms
    // apply (see TRADING_UOM in inward.js/outward.js). Reading it back still
    // goes through getElementById('ims-if-uom').value, which works either way.
    function _uomField(value) {
      if (!_isTrading) return _textField('ims-if-uom', 'UOM', { value: value || '' });
      return _fieldWrap('UOM', '<select id="ims-if-uom" style="' + _inputStyle + '"><option value="KGS" selected>KGS</option></select>');
    }

    function _formHtml(row) {
      const isEdit = !!row;
      return '<div style="background:#fff;border:1.5px solid var(--color-primary);border-radius:12px;padding:16px;margin-bottom:16px;">'
        + '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:2px;">' + (isEdit ? 'Edit Item — ' + esc(row.itemCode) : 'Add New Item') + '</div>'
        + '<div style="font-size:11.5px;color:#64748b;margin-bottom:12px;">Goes into the <b>' + esc(_bookName) + '</b> catalog.</div>'
        + '<form id="ims-item-form" style="display:flex;flex-direction:column;gap:14px;">'
          + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">'
            + _textField('ims-if-code', 'Item Code', { value: isEdit ? row.itemCode : '', disabled: isEdit })
            + _textField('ims-if-desc', 'Description', { value: isEdit ? row.description : '' })
            + _textField('ims-if-size', 'Size', { value: isEdit ? row.size : '' })
            + _uomField(isEdit ? row.uom : '')
            + _textField('ims-if-moq', 'MOQ (Min Order Qty)', { value: isEdit ? row.moq : '' })
            + _textField('ims-if-maxlevel', 'Max Level', { value: isEdit ? row.maxLevel : '' })
            + _textField('ims-if-onorder', 'On Order Qty', { value: isEdit ? row.onOrderQty : '' })
            + _textField('ims-if-vendor', 'Vendor Name', { value: isEdit ? row.vendorName : '' })
            + (isEdit ? '' : _textField('ims-if-opening', 'Opening Stock', { value: '0' }))
          + '</div>'
          + '<div style="display:flex;gap:10px;">'
            + '<button type="submit" id="ims-if-submit" style="padding:9px 22px;border-radius:9px;background:var(--color-primary);color:var(--color-primary-text);border:none;font-size:13px;font-weight:700;cursor:pointer;">' + (isEdit ? 'Save Changes' : 'Add Item') + '</button>'
            + '<button type="button" id="ims-if-cancel" style="padding:9px 22px;border-radius:9px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
          + '</div>'
        + '</form>'
      + '</div>';
    }

    async function _submitForm(e, row) {
      e.preventDefault();
      const isEdit = !!row;
      const body = {
        category: _book, // the tab you're on, not a form field
        description: document.getElementById('ims-if-desc').value.trim(),
        size: document.getElementById('ims-if-size').value.trim(),
        uom: document.getElementById('ims-if-uom').value.trim(),
        moq: document.getElementById('ims-if-moq').value.trim(),
        maxLevel: document.getElementById('ims-if-maxlevel').value.trim(),
        onOrderQty: document.getElementById('ims-if-onorder').value.trim(),
        vendorName: document.getElementById('ims-if-vendor').value.trim(),
      };
      const btn = document.getElementById('ims-if-submit');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (isEdit) {
          await Utils.apiFetch('/api/ims/items/' + encodeURIComponent(row.itemCode), { method: 'PATCH', body: JSON.stringify(body) });
          Utils.showToast('Item updated', 'success');
        } else {
          const itemCode = document.getElementById('ims-if-code').value.trim();
          if (!itemCode) { Utils.showToast('Item Code is required', 'error'); btn.disabled = false; btn.textContent = 'Add Item'; return; }
          body.itemCode = itemCode;
          body.openingStock = document.getElementById('ims-if-opening').value.trim();
          await Utils.apiFetch('/api/ims/items', { method: 'POST', body: JSON.stringify(body) });
          Utils.showToast('Item added', 'success');
        }
        _formOpen = false;
        _editingCode = null;
        _renderReport();
        await _load();
      } catch (err) {
        Utils.showToast(err.message || 'Failed to save item', 'error');
        btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Add Item';
      }
    }

    /* ══ Series tab (Trading only) ═══════════════════════════════════════════
       Alloy grade isn't a stored column — it's parsed out of each item's
       description server-side (see _imsAlloySeries in server.js), which is why
       this reads one pre-bucketed rollup instead of grouping the item list
       here. Current stock is always "as of now" (it's the only balance the DB
       keeps); the date range applies to the Inward/Outward figures only, which
       is why the two live in separate charts rather than one mixed one. ────── */

    // Categorical slots 1 and 2 of the validated chart palette (blue/orange):
    // the only pair on screen at once, and they clear the colour-blind
    // separation floor against each other and the white card behind them.
    const _CHART_INWARD = '#2a78d6';
    const _CHART_OUTWARD = '#eb6834';
    const _CHART_STOCK = '#2a78d6';
    // One hue per grade for the monthly sales lines, in the same fixed order the
    // server returns the grades in — colour follows the alloy, not its rank, so
    // a change of date range never repaints the lines.
    const _CHART_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

    async function _loadSeries() {
      _seriesLoaded = false;
      _seriesLoadError = '';
      _renderSeriesBody();
      let rows = [], monthly = [], err = '';
      try {
        const params = new URLSearchParams({ category: _book });
        if (_seriesFrom) params.set('from', _seriesFrom);
        if (_seriesTo) params.set('to', _seriesTo);
        const data = await Utils.apiFetch('/api/ims/series-summary?' + params.toString());
        rows = (data && data.series) || [];
        monthly = (data && data.monthly) || [];
      } catch (e) {
        err = e.message || 'Failed to load the series summary';
      }
      _seriesRows = rows;
      _seriesMonthly = monthly;
      _seriesLoadError = err;
      _seriesLoaded = true;
      _renderSeriesBody();
    }

    /* ── Bar chart (inline SVG, no chart library) ─────────────────────────────
       Vertical bars on a zero baseline, one group per series. Stock in this
       book runs negative on plenty of items, so the scale always spans zero and
       bars below it hang down from the baseline rather than being clipped to 0.
       groups: [{ label, values: [{ key, label, value }] }]; colors: {key: hex}. */
    function _niceStep(range, targetTicks) {
      const raw = (range || 1) / Math.max(1, targetTicks);
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const norm = raw / mag;
      return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    }
    function _axisLabel(v) {
      return (Math.round(v * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }
    // A bar with its data-end rounded and its baseline end square, so the
    // baseline stays a straight line across the chart.
    function _barPath(x, y, w, h, negative) {
      const r = Math.max(0, Math.min(4, w / 2, h));
      if (h <= 0) return '';
      return negative
        ? 'M' + x + ',' + y + ' L' + x + ',' + (y + h - r) + ' Q' + x + ',' + (y + h) + ' ' + (x + r) + ',' + (y + h)
          + ' L' + (x + w - r) + ',' + (y + h) + ' Q' + (x + w) + ',' + (y + h) + ' ' + (x + w) + ',' + (y + h - r) + ' L' + (x + w) + ',' + y + ' Z'
        : 'M' + x + ',' + (y + h) + ' L' + x + ',' + (y + r) + ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y
          + ' L' + (x + w - r) + ',' + y + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + ' L' + (x + w) + ',' + (y + h) + ' Z';
    }
    function _barChartSvg(groups, colors, unit) {
      // Sized for one half of the two-up chart row below, so the drawing renders
      // at roughly 1:1 there and its type matches the rest of the page.
      const W = 620, H = 280;
      const padL = 72, padR = 14, padT = 22, padB = 42;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;

      const all = groups.flatMap(g => g.values.map(v => _num(v.value)));
      const lo = Math.min(0, ...all);
      const hi = Math.max(0, ...all);
      const step = _niceStep(hi - lo || 1, 4);
      const dMin = Math.floor(lo / step) * step;
      let dMax = Math.ceil(hi / step) * step;
      if (dMax === dMin) dMax = dMin + step;
      const yOf = (v) => padT + ((dMax - v) / (dMax - dMin)) * plotH;

      const ticks = [];
      for (let t = dMin; t <= dMax + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);

      const gridline = ticks.map(t => {
        const y = yOf(t);
        const zero = t === 0;
        return '<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="' + (zero ? '#cbd5e1' : '#eef2f7') + '" stroke-width="1" />'
          + '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10.5" fill="#94a3b8">' + esc(_axisLabel(t)) + '</text>';
      }).join('');

      const gw = plotW / Math.max(1, groups.length);
      const paired = !!(groups[0] && groups[0].values.length > 1);
      // ~38% of each slot is breathing room, and bars stay thin rather than
      // stretching to fill the slot when there are only four or five of them.
      const inner = Math.min(gw * 0.62, paired ? 88 : 46);
      const gap = paired ? 2 : 0;                    // 2px surface gap between paired bars
      const bars = groups.map((g, gi) => {
        const gx = padL + gi * gw + (gw - inner) / 2;
        const n = g.values.length;
        const bw = (inner - gap * (n - 1)) / n;
        const marks = g.values.map((v, vi) => {
          const val = _num(v.value);
          const x = gx + vi * (bw + gap);
          const y0 = yOf(0), y1 = yOf(val);
          const y = Math.min(y0, y1), h = Math.abs(y1 - y0);
          const label = _fmtQty(val);
          const labelY = val < 0 ? y + h + 12 : y - 6;
          return '<path d="' + _barPath(x, y, bw, h, val < 0) + '" fill="' + (colors[v.key] || _CHART_STOCK) + '">'
              + '<title>' + esc(g.label + ' · ' + v.label + ': ' + label + (unit ? ' ' + unit : '')) + '</title></path>'
            + '<text x="' + (x + bw / 2) + '" y="' + labelY + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#0f172a">' + esc(label) + '</text>';
        }).join('');
        return marks
          + '<text x="' + (gx + inner / 2) + '" y="' + (padT + plotH + 20) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#334155">' + esc(g.label) + '</text>';
      }).join('');

      // Capped rather than stretched to the card: the whole drawing scales with
      // the SVG, so a full-width chart on a wide screen blows the axis and value
      // labels up well past the type around them.
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" style="width:100%;max-width:' + W + 'px;height:auto;display:block;margin:0 auto;overflow:visible;">'
        + gridline
        + '<line x1="' + padL + '" y1="' + yOf(0) + '" x2="' + (padL + plotW) + '" y2="' + yOf(0) + '" stroke="#94a3b8" stroke-width="1" />'
        + bars
      + '</svg>';
    }

    /* ── Line chart (inline SVG) — sales per alloy over the months ───────────
       One line per grade so a grade's trend, and how it ranks against the
       others, both read off the same picture; bars would need 5 × N of them.
       Sales are never negative, so this one sits on a plain zero baseline.
       lines: [{ key, label, color, points: [] }] against months: ['2026-08'].  */
    function _monthLabel(ym) {
      const parts = String(ym).split('-');
      if (parts.length < 2) return ym;
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return (MONTHS[parseInt(parts[1], 10) - 1] || parts[1]) + ' ' + parts[0].slice(2);
    }
    function _lineChartSvg(months, lines, unit) {
      const W = 980, H = 300;
      const padL = 76, padR = 96, padT = 20, padB = 40; // padR leaves room for the end labels
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;

      const all = lines.flatMap(l => l.points.map(_num));
      const step = _niceStep(Math.max(...all, 0) || 1, 4);
      let dMax = Math.ceil(Math.max(...all, 0) / step) * step;
      if (dMax <= 0) dMax = step;
      const yOf = (v) => padT + ((dMax - v) / dMax) * plotH;
      const xOf = (i) => months.length === 1 ? padL + plotW / 2 : padL + (i / (months.length - 1)) * plotW;

      const ticks = [];
      for (let t = 0; t <= dMax + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
      const grid = ticks.map(t => {
        const y = yOf(t);
        return '<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + plotW) + '" y2="' + y + '" stroke="' + (t === 0 ? '#cbd5e1' : '#eef2f7') + '" stroke-width="1" />'
          + '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10.5" fill="#94a3b8">' + esc(_axisLabel(t)) + '</text>';
      }).join('');

      const xLabels = months.map((m, i) => '<text x="' + xOf(i) + '" y="' + (padT + plotH + 20) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#334155">' + esc(_monthLabel(m)) + '</text>').join('');

      const series = lines.map(l => {
        const pts = l.points.map((v, i) => xOf(i) + ',' + yOf(_num(v))).join(' ');
        const dots = l.points.map((v, i) => '<circle cx="' + xOf(i) + '" cy="' + yOf(_num(v)) + '" r="3.5" fill="' + l.color + '" stroke="#fff" stroke-width="1.5">'
          + '<title>' + esc(l.label + ' · ' + _monthLabel(months[i]) + ': ' + _fmtQty(v) + (unit ? ' ' + unit : '')) + '</title></circle>').join('');
        return '<polyline points="' + pts + '" fill="none" stroke="' + l.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />' + dots;
      }).join('');

      /* Direct labels at the line ends — the palette's lighter hues sit below
         3:1 on white, so identity can't rest on colour alone. Grades that sell
         next to nothing all finish on the baseline, so the labels are nudged
         apart (keeping their vertical order) instead of being drawn on top of
         each other; the leader dot stays on the line's real end point. */
      const lastX = xOf(months.length - 1);
      const placed = lines
        .map(l => ({ l, y: yOf(_num(l.points[l.points.length - 1])) }))
        .sort((a, b) => a.y - b.y);
      const GAP = 14;
      placed.forEach((p, i) => { if (i && p.y - placed[i - 1].y < GAP) p.y = placed[i - 1].y + GAP; });
      const overflow = placed.length ? Math.max(0, placed[placed.length - 1].y - (padT + plotH)) : 0;
      placed.forEach(p => { p.y -= overflow; }); // keep the stack inside the plot
      const endLabels = placed.map(p =>
        '<circle cx="' + (lastX + 12) + '" cy="' + p.y + '" r="4" fill="' + p.l.color + '" />'
        + '<text x="' + (lastX + 20) + '" y="' + (p.y + 4) + '" font-size="11" font-weight="700" fill="#334155">' + esc(p.l.label) + '</text>'
      ).join('');

      return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" style="width:100%;max-width:' + W + 'px;height:auto;display:block;margin:0 auto;overflow:visible;">'
        + grid + xLabels + series + endLabels
      + '</svg>';
    }

    function _chartCardHtml(title, subtitle, legend, svg) {
      return '<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:16px 18px 12px;">'
        + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">'
          + '<div>'
            + '<div style="font-size:13.5px;font-weight:700;color:#0f172a;">' + esc(title) + '</div>'
            + '<div style="font-size:11.5px;color:#64748b;margin-top:2px;">' + esc(subtitle) + '</div>'
          + '</div>'
          + legend
        + '</div>'
        + svg
      + '</div>';
    }

    function _legendHtml(entries) {
      return '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">'
        + entries.map(([color, label]) => '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#64748b;font-weight:600;">'
          + '<span style="width:10px;height:10px;border-radius:3px;background:' + color + ';display:inline-block;"></span>' + esc(label) + '</span>').join('')
      + '</div>';
    }

    function _seriesStatsHtml(rows) {
      const sum = (k) => rows.reduce((s, r) => s + _num(r[k]), 0);
      const tiles = [
        ['Items', rows.reduce((s, r) => s + _num(r.items), 0), '#0f172a'],
        ['Current Stock', sum('stock'), sum('stock') < 0 ? '#c2410c' : '#0f172a'],
        ['Inward', sum('inward'), '#0f172a'],
        ['Outward', sum('outward'), '#0f172a'],
      ];
      return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">'
        + tiles.map(([label, value, color]) => '<div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px 14px;">'
          + '<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:700;">' + esc(label) + '</div>'
          + '<div style="font-size:18px;font-weight:700;color:' + color + ';margin-top:2px;">' + esc(_fmtQty(value)) + '</div>'
        + '</div>').join('')
      + '</div>';
    }

    // The chart's own numbers, spelled out — the readable-without-colour view of
    // the same data, and where the per-series totals get added up.
    function _seriesTableHtml(rows) {
      const head = ['Series', 'Items', 'Current Stock', 'Inward', 'Outward'];
      const cell = 'padding:8px 10px;font-size:12.5px;';
      const total = (k) => rows.reduce((s, r) => s + _num(r[k]), 0);
      const totalCell = 'padding:10px;font-size:12.5px;font-weight:700;color:#0f172a;background:#f8fafc;';
      return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:560px;">'
          + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
            + head.map((h, i) => '<th style="padding:8px 10px;text-align:' + (i ? 'right' : 'left') + ';font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
          + '</tr></thead>'
          + '<tbody>'
            + rows.map(r => '<tr style="border-bottom:1px solid #f1f5f9;">'
              + '<td style="' + cell + 'font-weight:700;">' + esc(r.series) + '</td>'
              + '<td style="' + cell + 'text-align:right;">' + esc(_fmtQty(r.items)) + '</td>'
              + '<td style="' + cell + 'text-align:right;font-weight:700;' + (_num(r.stock) < 0 ? 'color:#c2410c;' : '') + '">' + esc(_fmtQty(r.stock)) + '</td>'
              + '<td style="' + cell + 'text-align:right;">' + esc(_fmtQty(r.inward)) + '</td>'
              + '<td style="' + cell + 'text-align:right;">' + esc(_fmtQty(r.outward)) + '</td>'
            + '</tr>').join('')
            + '<tr style="border-top:2px solid #e2e8f0;">'
              + '<td style="' + totalCell + 'text-transform:uppercase;letter-spacing:.04em;font-size:11px;color:#64748b;">Total</td>'
              + '<td style="' + totalCell + 'text-align:right;">' + esc(_fmtQty(total('items'))) + '</td>'
              + '<td style="' + totalCell + 'text-align:right;' + (total('stock') < 0 ? 'color:#c2410c;' : '') + '">' + esc(_fmtQty(total('stock'))) + '</td>'
              + '<td style="' + totalCell + 'text-align:right;">' + esc(_fmtQty(total('inward'))) + '</td>'
              + '<td style="' + totalCell + 'text-align:right;">' + esc(_fmtQty(total('outward'))) + '</td>'
            + '</tr>'
          + '</tbody>'
        + '</table>'
      + '</div>';
    }

    /* ── Monthly report: sales (Outward) per alloy, month by month ───────────
       Outward only — that's the sale; what came in is already in the movement
       chart above. Every grade keeps a line even when it sells nothing, since
       "which grades aren't moving" is half of what this is read for. ───────── */
    const _MONTHLY_MAX = 12;

    function _monthlySalesCardHtml(rows) {
      const all = _seriesMonthly;
      if (!all.length) {
        return _chartCardHtml('Monthly sales by alloy', 'No stock movement in this range yet.', '',
          '<div style="padding:28px;text-align:center;color:#94a3b8;font-size:12.5px;">Nothing to plot.</div>');
      }
      // Newest months win when the range is long — with no date filter this book
      // reaches back years, and 40+ columns is a smear rather than a report.
      const months = all.slice(-_MONTHLY_MAX);
      const trimmed = all.length - months.length;
      const lines = rows.map((r, i) => ({
        key: r.series,
        label: r.series,
        color: _CHART_SERIES[i % _CHART_SERIES.length],
        points: months.map(m => ((m.series || {})[r.series] || {}).outward || 0),
      }));
      const subtitle = 'Outward (sales) quantity per grade, ' + _monthLabel(months[0].month) + ' to ' + _monthLabel(months[months.length - 1].month)
        + (trimmed ? ' — most recent ' + months.length + ' months of ' + all.length + ', narrow the dates to see the earlier ones.' : '.');
      return _chartCardHtml('Monthly sales by alloy', subtitle,
        _legendHtml(lines.map(l => [l.color, l.label])),
        _lineChartSvg(months.map(m => m.month), lines));
    }

    // Month × grade sales, the numbers behind the lines above.
    function _exportMonthlyCSV() {
      if (!_seriesMonthly.length) { Utils.showToast('Nothing to export yet', 'warning'); return; }
      const names = _seriesRows.map(r => r.series);
      const headers = ['Month', ...names, 'Total'];
      const rows = _seriesMonthly.map(m => {
        const vals = names.map(n => _num(((m.series || {})[n] || {}).outward));
        return [m.month, ...vals, vals.reduce((s, v) => s + v, 0)];
      });
      const colTotal = (i) => rows.reduce((s, r) => s + _num(r[i + 1]), 0);
      rows.push(['Total', ...names.map((_, i) => colTotal(i)), rows.reduce((s, r) => s + _num(r[r.length - 1]), 0)]);
      _downloadCSV('IMS_' + _bookSlug + '_MonthlySalesByAlloy_' + _todayStamp() + '.csv', headers, rows);
    }

    function _exportSeriesCSV() {
      if (!_seriesRows.length) { Utils.showToast('Nothing to export yet', 'warning'); return; }
      const headers = ['Series', 'Items', 'Current Stock', 'Inward', 'Outward'];
      const rows = _seriesRows.map(r => [r.series, r.items, r.stock, r.inward, r.outward]);
      const total = (k) => _seriesRows.reduce((s, r) => s + _num(r[k]), 0);
      rows.push(['Total', total('items'), total('stock'), total('inward'), total('outward')]);
      _downloadCSV('IMS_' + _bookSlug + '_SeriesWise_' + _todayStamp() + '.csv', headers, rows);
    }

    function _seriesRangeLabel() {
      if (_seriesFrom && _seriesTo) return _dateLabel(_seriesFrom) + ' to ' + _dateLabel(_seriesTo);
      if (_seriesFrom) return 'from ' + _dateLabel(_seriesFrom);
      if (_seriesTo) return 'up to ' + _dateLabel(_seriesTo);
      return 'all time';
    }

    function _renderSeriesBody() {
      if (!_isActive()) return;
      const el = document.getElementById('ims-series-body');
      if (!el) return;

      if (!_seriesLoaded) {
        el.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</div>';
        return;
      }
      if (_seriesLoadError) {
        el.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444;font-size:12.5px;">' + esc(_seriesLoadError) + '</div>';
        return;
      }
      const rows = _seriesRows;
      if (!rows.length) {
        el.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:12.5px;">No ' + esc(_bookName) + ' items to chart yet</div>';
        return;
      }

      const stockChart = _barChartSvg(
        rows.map(r => ({ label: r.series, values: [{ key: 'stock', label: 'Current stock', value: r.stock }] })),
        { stock: _CHART_STOCK });
      const moveChart = _barChartSvg(
        rows.map(r => ({ label: r.series, values: [
          { key: 'inward', label: 'Inward', value: r.inward },
          { key: 'outward', label: 'Outward', value: r.outward },
        ] })),
        { inward: _CHART_INWARD, outward: _CHART_OUTWARD });

      // Two-up on a wide screen, stacking below ~900px — the charts are read
      // against each other (what's on hand vs what moved), so they belong side
      // by side wherever there's room for both at a legible size.
      el.innerHTML = _seriesStatsHtml(rows)
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;align-items:start;">'
          + _chartCardHtml('Current stock by series', 'Live balance as of today — bars below the line are items issued past what was received.', '', stockChart)
          + _chartCardHtml('Inward vs Outward by series', 'Stock movement logged ' + _seriesRangeLabel() + ', cancelled entries excluded.',
              _legendHtml([[_CHART_INWARD, 'Inward'], [_CHART_OUTWARD, 'Outward']]), moveChart)
        + '</div>'
        + '<div style="margin-top:14px;">' + _monthlySalesCardHtml(rows) + '</div>'
        + '<div style="margin-top:14px;">' + _seriesTableHtml(rows) + '</div>';
    }

    function _seriesFilterBarHtml() {
      return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px;">'
        + '<span style="font-size:12px;color:#64748b;font-weight:600;">Movement dates</span>'
        + '<input type="date" id="ims-ser-from" value="' + esc(_seriesFrom) + '" style="' + _inputStyle + 'width:auto;" />'
        + '<span style="color:#94a3b8;font-size:12px;">to</span>'
        + '<input type="date" id="ims-ser-to" value="' + esc(_seriesTo) + '" style="' + _inputStyle + 'width:auto;" />'
        + '<button type="button" id="ims-ser-clear" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#64748b;font-size:12.5px;font-weight:600;cursor:pointer;">Clear</button>'
        + '<button type="button" id="ims-ser-refresh" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Refresh</button>'
        + '<button type="button" id="ims-ser-export" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Export CSV</button>'
        + '<button type="button" id="ims-ser-export-monthly" style="padding:8px 14px;border-radius:8px;background:#fff;border:1.5px solid #e2e8f0;color:#1e293b;font-size:12.5px;font-weight:600;cursor:pointer;">Monthly CSV</button>'
      + '</div>';
    }

    function _bindSeriesFilterBar() {
      // Both dates go back to the server (the rollup is a SQL aggregate, not a
      // client-side filter over rows already on screen), so each change reloads.
      document.getElementById('ims-ser-from').addEventListener('change', (e) => { _seriesFrom = e.target.value; _loadSeries(); });
      document.getElementById('ims-ser-to').addEventListener('change', (e) => { _seriesTo = e.target.value; _loadSeries(); });
      document.getElementById('ims-ser-clear').addEventListener('click', () => {
        _seriesFrom = ''; _seriesTo = '';
        document.getElementById('ims-ser-from').value = '';
        document.getElementById('ims-ser-to').value = '';
        _loadSeries();
      });
      document.getElementById('ims-ser-refresh').addEventListener('click', _loadSeries);
      document.getElementById('ims-ser-export').addEventListener('click', _exportSeriesCSV);
      document.getElementById('ims-ser-export-monthly').addEventListener('click', _exportMonthlyCSV);
    }

    function _renderSeries() {
      if (!_isActive()) return;
      const el = document.getElementById('ims-tabbody');
      if (!el) return;
      el.innerHTML = '<p style="font-size:12.5px;color:#64748b;margin:0 0 14px;">Alloy grade read off each item\'s description — ' + esc(SERIES_LABELS.join(', ')) + ', anything else grouped as Other.</p>'
        + _seriesFilterBarHtml()
        + '<div id="ims-series-body"></div>';
      _bindSeriesFilterBar();
      _renderSeriesBody();
      if (!_seriesLoaded) _loadSeries();
    }

    /* ── View-mode toggle (Item List vs Day-wise Stock) ─────────────────── */
    function _viewToggleHtml() {
      function tab(mode, label) {
        const active = _viewMode === mode;
        return '<button type="button" class="ims-view-tab" data-mode="' + mode + '" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:700;'
          + (active ? 'background:var(--color-primary);color:var(--color-primary-text);' : 'background:transparent;color:#64748b;') + '">' + label + '</button>';
      }
      return '<div style="display:flex;gap:4px;background:#f1f5f9;padding:3px;border-radius:9px;width:fit-content;margin-bottom:14px;">'
        + tab('list', 'Item List') + tab('daywise', 'Day-wise Stock') + tab('physical', 'Physical Stock Log')
      + '</div>';
    }

    function _bindViewToggle() {
      document.querySelectorAll('.ims-view-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.mode === _viewMode) return;
          _viewMode = btn.dataset.mode;
          _formOpen = false; _editingCode = null;
          _renderReport();
        });
      });
    }

    /* ── Report tab body (catalog + day-wise stock) — mounts into #ims-tabbody,
       the container the top-level tab bar below owns. ─────────────────────── */
    function _renderReport(formRow) {
      if (!_isActive()) return;
      const el = document.getElementById('ims-tabbody');
      if (!el) return;
      const isDaywise = _viewMode === 'daywise';
      const isPhysical = _viewMode === 'physical';
      const isList = !isDaywise && !isPhysical;

      let bodyHtml;
      if (isDaywise) {
        bodyHtml = _historyToolbarHtml()
          + _colorLegendHtml()
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;">'
              + '<thead id="ims-history-head"></thead>'
              + '<tbody id="ims-history-body"><tr><td style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
            + '</table>'
          + '</div>';
      } else if (isPhysical) {
        bodyHtml = _physicalFilterBarHtml()
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:920px;">'
              + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
                + ['Date', 'Item Code', 'Description', 'Variance', 'Remarks', 'Logged By', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
              + '</tr></thead>'
              + '<tbody id="ims-phys-body"><tr><td colspan="7" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
            + '</table>'
          + '</div>';
      } else {
        bodyHtml = _filterBarHtml()
          + _colorLegendHtml()
          + '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">'
            + '<table style="width:100%;border-collapse:collapse;min-width:1080px;">'
              + '<thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">'
                + ['Item Code', 'Description', 'Size', 'UOM', 'Current Stock', 'MOQ', 'Max Level', 'On Order', 'Vendor', 'Actions'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">' + esc(h) + '</th>').join('')
              + '</tr></thead>'
              + '<tbody id="ims-body"><tr><td colspan="10" style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">Loading…</td></tr></tbody>'
            + '</table>'
          + '</div>';
      }

      el.innerHTML = _viewToggleHtml()
        + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:2px;flex-wrap:wrap;">'
          + '<span></span>'
          + '<span id="ims-count" style="font-size:12px;color:#94a3b8;font-weight:600;"></span>'
        + '</div>'
        + (isList && _formOpen ? _formHtml(formRow) : '')
        + bodyHtml;

      _bindViewToggle();

      if (isDaywise) {
        _bindHistoryToolbar();
        _renderHistoryTable();
        if (!_historyLoaded) _loadHistory();
        return;
      }

      if (isPhysical) {
        _bindPhysicalFilterBar();
        _bindPhysicalRowActions();
        _renderPhysicalTable();
        if (!_physLoaded) _loadPhysical();
        return;
      }

      _bindFilterBar();
      _bindRowActions();

      if (_formOpen) {
        document.getElementById('ims-item-form').addEventListener('submit', (e) => _submitForm(e, formRow));
        document.getElementById('ims-if-cancel').addEventListener('click', _closeForm);
      }

      _renderTable();
      if (!_loaded) _load(); // only the very first render needs a fetch — filter/refresh/save actions trigger their own
    }

    /* ── Tabs: Inward / Outward / Report — the three views of this page's book.
       Inward/Outward bodies are the same modules that used to be their own
       standalone pages (see inward.js/outward.js), just mounted into
       #ims-tabbody instead of #main-content directly, and locked to this
       book. ───────────────────────────────────────────────────────────────── */
    let _topTab = 'inward'; // 'inward' | 'outward' | 'report' | 'series' (Trading only)

    function _topTabsHtml() {
      const tabs = [['inward', 'Inward'], ['outward', 'Outward'], ['report', 'Report']]
        .concat(_isTrading ? [['series', 'Series Chart']] : []);
      return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">'
        + tabs.map(([key, label]) => '<button type="button" class="ims-top-tab" data-tab="' + key + '" style="'
          + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
          + 'color:' + (_topTab === key ? 'var(--color-primary)' : '#94a3b8') + ';'
          + 'border-bottom:2px solid ' + (_topTab === key ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
          + '">' + esc(label) + '</button>').join('')
      + '</div>';
    }

    /* ── Render (master) ───────────────────────────────────────────────── */
    function renderPage() {
      const el = document.getElementById('main-content');
      if (!el) return;
      // Claim the shared container before writing to it, so any request still
      // in flight from the book we're leaving stops painting (see _isActive).
      _mountedRoute = book.route;

      el.innerHTML = '<div style="max-width:1300px;margin:0 auto;padding:4px 0 40px;">'
        + '<div style="margin-bottom:14px;">'
          + '<h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">' + esc(_bookLabel) + '</h1>'
          + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">Inventory Management — log stock movement and track the live ' + esc(_bookName) + ' catalog.</p>'
        + '</div>'
        + _topTabsHtml()
        + '<div id="ims-tabbody"></div>'
      + '</div>';

      document.querySelectorAll('.ims-top-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.tab === _topTab) return;
          _topTab = btn.dataset.tab;
          renderPage();
        });
      });

      const mountOpts = { containerId: 'ims-tabbody', embedded: true, category: _book, categoryLabel: _bookName };
      if (_topTab === 'inward')  { window.Pages['inward'].render(mountOpts); return; }
      if (_topTab === 'outward') { window.Pages['outward'].render(mountOpts); return; }
      if (_topTab === 'series')  { _renderSeries(); return; }
      _renderReport();
    }

    return {
      render() { renderPage(); },
    };
  }

  IMS_BOOKS.forEach(b => { window.Pages[b.route] = createPage(b); });

  // Back-compat: '#ims' was the single combined page before the split, so old
  // bookmarks, the browser history and any saved 'ims' page-permission would
  // otherwise land on a route that no longer exists. Send them to the Stores
  // book — replace(), not navigate(), so the dead hash doesn't sit in history
  // and bounce the user again on Back.
  window.Pages['ims'] = {
    render() { window.location.replace('#' + IMS_BOOKS[0].route); },
  };
})();
