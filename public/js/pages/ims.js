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

    function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
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
      _downloadCSV('IMS_' + _bookSlug + '_Items_' + _todayStamp() + '.csv', headers, rows);
    }
    function _exportHistoryCSV() {
      if (!_historyRows.length) { Utils.showToast('No items to export', 'warning'); return; }
      const headers = ['Item Code', 'Description', 'UOM', ..._historyDates.map(_dateLabel)];
      const rows = _historyRows.map(r => [r.itemCode, r.description, r.uom, ...(r.daily || [])]);
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
      }).join('');
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
      const colCount = 3 + _historyDates.length; // Item Code, Description, UOM + one per day

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
        + ['Item Code', 'Description', 'UOM'].map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;position:sticky;left:0;background:#f8fafc;">' + esc(h) + '</th>').join('')
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
          + '<td style="padding:8px 10px;font-size:12.5px;">' + esc(r.uom) + '</td>'
          + (r.daily || []).map(v => {
              const c = _stockLevelColor(v, r.maxLevel);
              return '<td style="padding:8px 10px;font-size:12.5px;text-align:right;' + (c ? 'background:' + c + ';' : '') + '">' + esc(v) + '</td>';
            }).join('')
        + '</tr>';
      }).join('');
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
            + _textField('ims-if-uom', 'UOM', { value: isEdit ? row.uom : '' })
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
    let _topTab = 'inward'; // 'inward' | 'outward' | 'report'

    function _topTabsHtml() {
      const tabs = [['inward', 'Inward'], ['outward', 'Outward'], ['report', 'Report']];
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
