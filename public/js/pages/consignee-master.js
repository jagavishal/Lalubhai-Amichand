window.Pages = window.Pages || {};

// ── Consignee Master ─────────────────────────────────────────────────────────
// The export department's buyer list — the same master the Proforma Invoice
// create form's Consignee Name typeahead reads, given its own page so a new
// buyer is entered once here instead of being re-typed (address, ports and
// all) into every PI.
//
// It is NOT an app table: it lives in the export team's own "PI Export
// (Final)" workbook, fetch_consignee tab. Adding writes straight back into
// that sheet, which is why it is permission-gated the same way adding a
// product is. Contact No. / Email ID are shown but not editable — those two
// columns come from a second workbook this app only reads through the sheet's
// own IMPORTRANGE (see CONSIGNEE_SOURCE in backend/lib/pi-format.js).
window.Pages['consignee-master'] = (() => {
  /* ── permission helper — same hasFeature() shape as client-master.js /
     proforma-invoice.js, scoped to this page's one feature key ─────────── */
  function _hasFeature(feat) {
    const roles = window.currentUser?.roles || [];
    const isAdmin = Array.isArray(roles)
      ? (roles.includes('Admin') || roles.includes('HOD'))
      : (String(roles).includes('Admin') || String(roles).includes('HOD'));
    if (isAdmin) return true;
    const perms = window.currentUser?.permissions;
    if (!perms || !perms.features) return true;
    const pageFeats = perms.features['consignee-master'];
    if (!pageFeats) return false;
    return pageFeats.includes(feat);
  }

  /* ── state ──────────────────────────────────────────────────── */
  let _view = 'add';        // 'add' | 'list'
  let _rows = [];
  let _loaded = false;
  let _loadError = '';
  let _q = '';              // list search
  let _saving = false;

  const esc = Utils.esc;

  /* ── field helpers (same cards as the PI create form, so the two pages
     read as one department) ───────────────────────────────────────────── */
  function _fieldWrap(label, innerHtml) {
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;">'
      + '<div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:8px;">' + esc(label) + '</div>'
      + innerHtml
      + '</div>';
  }
  const _inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b;outline:none;';
  function _textField(id, label, opts) {
    opts = opts || {};
    return _fieldWrap(label + (opts.required ? ' *' : ''),
      '<input type="text" id="' + id + '" autocomplete="off" placeholder="' + esc(opts.placeholder || '') + '" style="' + _inputStyle + '" />'
      + (opts.hint ? '<div style="font-size:11px;color:#94a3b8;margin-top:5px;">' + esc(opts.hint) + '</div>' : ''));
  }
  const _grid = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;';

  /* ── data ───────────────────────────────────────────────────── */
  async function _load() {
    try {
      const data = await Utils.apiFetch('/api/consignee-master');
      if (!data) return;
      _rows = data.rows || [];
      _loadError = '';
    } catch (e) {
      _loadError = e.message || 'Failed to load the consignee master';
    } finally {
      _loaded = true;
    }
  }

  /* ── tabs ───────────────────────────────────────────────────── */
  function _tabBtn(label, active, cls) {
    return '<button type="button" class="' + cls + '" style="'
      + 'padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:700;'
      + 'color:' + (active ? 'var(--color-primary)' : '#94a3b8') + ';'
      + 'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';margin-bottom:-1px;'
      + '">' + esc(label) + '</button>';
  }

  function _tabsHtml() {
    const canAdd = _hasFeature('add');
    return '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">'
      + (canAdd ? _tabBtn('Add Consignee', _view === 'add', 'cm-add-tab') : '')
      + _tabBtn('Consignee List' + (_loaded ? ' (' + _rows.length + ')' : ''), _view === 'list', 'cm-list-tab')
    + '</div>';
  }

  /* ── Add form ───────────────────────────────────────────────── */
  function _addHtml() {
    return '<form id="cm-form" autocomplete="off">'
      + '<div style="' + _grid + '">'
        + _textField('cm-name', 'Consignee Name', { required: true, placeholder: 'M/s. …' })
        + _textField('cm-place', 'Place of Delivery', { required: true, placeholder: 'e.g. RIYADH' })
        + _textField('cm-port-loading', 'Port of Loading', { required: true, placeholder: 'e.g. MUNDRA' })
        + _textField('cm-port-discharge', 'Port of Discharge', { required: true, placeholder: 'e.g. DAMMAM' })
        + _textField('cm-terms', 'Terms of Payment', { placeholder: 'e.g. 30% ADVANCE AND BALANCE AGT. B/L COPY' })
      + '</div>'
      + '<div style="margin-top:14px;">'
        + _fieldWrap('Address', '<input type="text" id="cm-address" autocomplete="off" placeholder="P.O. Box, street, city, country" style="' + _inputStyle + '" />'
            + '<div style="font-size:11px;color:#94a3b8;margin-top:5px;">Printed on the PI. A long address is split across the invoice’s two address lines automatically.</div>')
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:12px;margin-top:18px;">'
        + '<button type="submit" id="cm-submit" style="padding:10px 22px;border:none;border-radius:9px;background:var(--color-primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer;">' + (_saving ? 'Saving…' : 'Add Consignee') + '</button>'
        + '<span style="font-size:12px;color:#94a3b8;">Saves into the export team’s fetch_consignee sheet, and is pickable on the very next PI.</span>'
      + '</div>'
    + '</form>';
  }

  /* ── List ───────────────────────────────────────────────────── */
  function _filtered() {
    const q = _q.trim().toLowerCase();
    if (!q) return _rows;
    return _rows.filter(r => [r.name, r.placeOfDelivery, r.portOfLoading, r.portOfDischarge, r.address1, r.address2, r.contact].join(' ').toLowerCase().includes(q));
  }

  function _tableHtml() {
    const rows = _filtered();
    const owner = Utils.isOwner();
    const head = ['Consignee', 'Place of Delivery', 'Port of Loading', 'Port of Discharge', 'Address', 'Contact / Email'].concat(owner ? [''] : [])
      .map(h => '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">' + esc(h) + '</th>').join('');

    const body = rows.length
      ? rows.map(r => '<tr style="border-top:1px solid #f1f5f9;">'
          + '<td style="padding:8px 10px;font-size:12.5px;color:#1e293b;">' + esc(r.name) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;color:#475569;white-space:nowrap;">' + esc(r.placeOfDelivery) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;color:#475569;white-space:nowrap;">' + esc(r.portOfLoading) + '</td>'
          + '<td style="padding:8px 10px;font-size:12.5px;color:#475569;white-space:nowrap;">' + esc(r.portOfDischarge) + '</td>'
          + '<td style="padding:8px 10px;font-size:12px;color:#64748b;">' + esc([r.address1, r.address2].filter(Boolean).join(', ')) + '</td>'
          + '<td style="padding:8px 10px;font-size:12px;color:#64748b;">' + esc(r.contact) + '</td>'
          + (owner ? '<td style="padding:8px 10px;white-space:nowrap;">' + Utils.ownerDeleteBtn('cm-delete-btn', 'name', r.name) + '</td>' : '')
        + '</tr>').join('')
      : '<tr><td colspan="' + (owner ? 7 : 6) + '" style="padding:26px;text-align:center;font-size:13px;color:#94a3b8;">No consignee matches “' + esc(_q) + '”.</td></tr>';

    return '<div id="cm-table" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:auto;">'
        + '<table style="width:100%;border-collapse:collapse;min-width:900px;"><thead><tr style="background:#f8fafc;">' + head + '</tr></thead>'
        + '<tbody>' + body + '</tbody></table>'
      + '</div>';
  }

  function _listHtml() {
    if (!_loaded) return '<div style="padding:26px;text-align:center;font-size:13px;color:#94a3b8;">Loading…</div>';
    if (_loadError) return '<div style="padding:16px;border:1px solid #fecaca;background:#fef2f2;border-radius:10px;font-size:13px;color:#b91c1c;">' + esc(_loadError) + '</div>';
    return '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">'
        + '<input type="text" id="cm-search" value="' + esc(_q) + '" placeholder="Search consignee, port, address…" style="' + _inputStyle + 'max-width:340px;" />'
        + '<span id="cm-count" style="font-size:12px;color:#94a3b8;">' + _filtered().length + ' of ' + _rows.length + '</span>'
      + '</div>'
      + _tableHtml();
  }

  /* ── submit ─────────────────────────────────────────────────── */
  async function _submit(e) {
    e.preventDefault();
    if (_saving) return;
    const val = (id) => document.getElementById(id).value.trim();
    const payload = {
      name: val('cm-name'),
      placeOfDelivery: val('cm-place'),
      portOfLoading: val('cm-port-loading'),
      portOfDischarge: val('cm-port-discharge'),
      paymentTerms: val('cm-terms'),
      address: val('cm-address'),
    };
    // Mirrors the server's own check, so a missing port is caught before the
    // round trip rather than after it.
    if (!payload.name) { Utils.showToast('Consignee Name is required', 'error'); return; }
    if (!payload.placeOfDelivery || !payload.portOfLoading || !payload.portOfDischarge) {
      Utils.showToast('Place of Delivery, Port of Loading and Port of Discharge are required', 'error'); return;
    }

    _saving = true;
    const btn = document.getElementById('cm-submit');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      const data = await Utils.apiFetch('/api/consignee-master', { method: 'POST', body: JSON.stringify(payload) });
      if (!data) return;
      Utils.showToast(payload.name + ' added to the consignee master', 'success');
      // Straight into the list, filtered to the new row — cheaper than a
      // reload and it shows exactly what landed in the sheet.
      _rows = _rows.concat([data.consignee]).sort((a, b) => a.name.localeCompare(b.name));
      _q = payload.name;
      _view = 'list';
      render();
    } catch (err) {
      Utils.showToast(err.message || 'Failed to add the consignee', 'error');
    } finally {
      _saving = false;
      const b2 = document.getElementById('cm-submit');
      if (b2) { b2.textContent = 'Add Consignee'; b2.disabled = false; }
    }
  }

  /* ── render ─────────────────────────────────────────────────── */
  function render() {
    const canAdd = _hasFeature('add');
    if (_view === 'add' && !canAdd) _view = 'list';

    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = '<div style="padding:22px 24px 40px;">'
      + '<div style="margin-bottom:16px;">'
        + '<h2 style="margin:0;font-size:20px;font-weight:800;color:#0f172a;">Consignee Master</h2>'
        + '<p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">The export buyer list behind the Proforma Invoice consignee field. Contact No. and Email ID are maintained in the source sheet, so they are shown here but not editable.</p>'
      + '</div>'
      + _tabsHtml()
      + (_view === 'add' ? _addHtml() : _listHtml())
    + '</div>';

    const addTab = mc.querySelector('.cm-add-tab');
    if (addTab) addTab.addEventListener('click', () => { _view = 'add'; render(); });
    const listTab = mc.querySelector('.cm-list-tab');
    if (listTab) listTab.addEventListener('click', () => { _view = 'list'; render(); });

    const form = document.getElementById('cm-form');
    if (form) form.addEventListener('submit', _submit);

    // Bound to the wrapper render() just created — a fresh element every time,
    // so there is nothing to de-duplicate — and delegated, so it survives the
    // table being swapped out on every keystroke of the search box.
    const page = mc.firstElementChild;
    if (Utils.isOwner() && page) {
      page.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cm-delete-btn');
        if (!btn) return;
        const name = btn.dataset.name;
        if (!(await Utils.ownerDeleteConfirm(name))) return;
        try {
          await Utils.apiFetch('/api/consignee-master?name=' + encodeURIComponent(name), { method: 'DELETE' });
          Utils.showToast(name + ' deleted', 'success');
          _rows = _rows.filter(r => r.name !== name);
          render();
        } catch (err) {
          Utils.showToast(err.message || 'Failed to delete', 'error');
        }
      });
    }

    const search = document.getElementById('cm-search');
    if (search) {
      search.addEventListener('input', (e) => {
        _q = e.target.value;
        // Swap the table alone — a full re-render would take the caret out of
        // the search box on every keystroke.
        const table = document.getElementById('cm-table');
        const count = document.getElementById('cm-count');
        if (!table) { render(); return; }
        const fresh = document.createElement('div');
        fresh.innerHTML = _tableHtml();
        table.replaceWith(fresh.firstElementChild);
        if (count) count.textContent = _filtered().length + ' of ' + _rows.length;
      });
    }

    // First paint shows the form immediately; the list loads behind it. Only
    // the list view is repainted when it arrives — repainting the Add tab
    // would wipe whatever the user has already typed into the form.
    if (!_loaded) {
      _load().then(() => {
        if (_view === 'list') { render(); return; }
        const tab = document.querySelector('.cm-list-tab');
        if (tab) tab.textContent = 'Consignee List (' + _rows.length + ')';
      });
    }
  }

  return { render };
})();
