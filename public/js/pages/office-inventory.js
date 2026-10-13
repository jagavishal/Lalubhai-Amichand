/* =====================================================================
   Office Inventory — office consumables: purchases, consumption, stock.
   ---------------------------------------------------------------------
   Replaces the "Inventory Management System" Google Sheet and its Apps
   Script web app. Server side: backend/office-inventory.js
   (/api/office-inventory/*). Stock = opening + purchased − consumed,
   always computed by the server, never typed in.

   Built on window.HR (hr-common.js) for the header, tabs, tiles, modals
   and form fields, like the HR and Service Management pages.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['office-inventory'] = (() => {
  const H = window.HR;
  const esc = H.esc;
  const BASE = '/api/office-inventory';

  let D = null;
  let _tab = 'stock';
  const _f = {
    stock: { q: '', cat: 'All', show: 'all' },
    purchases: { q: '', month: 'All', vendor: 'All' },
    consumption: { q: '', month: 'All', user: 'All' },
    report: { fy: '' },
  };

  const qty = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
  const money = (n) => '₹ ' + H.inr(n, { zero: '0.00' });
  const monthOf = (iso) => (iso || '').slice(0, 7);
  const monthLabel = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const itemById = (id) => D.items.find((i) => i.id === id);
  const fyOf = (iso) => (+iso.slice(5, 7) >= 4 ? +iso.slice(0, 4) : +iso.slice(0, 4) - 1);

  async function load() { D = await H.api(`${BASE}/data`); }
  async function refresh() { try { await load(); render(); } catch (e) { H.fail(e); } }

  function tabsFor() {
    const low = D.items.filter((i) => i.active && stockState(i) !== 'ok' && stockState(i) !== 'never').length;
    const t = [
      { key: 'stock', label: 'Stock', count: low || null },
      { key: 'purchases', label: 'Purchases', count: D.purchases.length },
      { key: 'consumption', label: 'Consumption', count: D.consumption.length },
      { key: 'items', label: 'Items', count: D.items.length },
      { key: 'reports', label: 'Reports' },
    ];
    if (D.manage) t.push({ key: 'settings', label: 'Settings' });
    return t;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const body = { stock: stockTab, purchases: purchasesTab, consumption: consumptionTab, items: itemsTab, reports: reportsTab, settings: settingsTab }[_tab]();
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        @media (max-width: 767px) {
          .oi-filt { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px !important; }
          .oi-filt > input, .oi-filt > select { max-width:none !important; min-height:40px; }
          .oi-filt > input { grid-column:1 / -1; }
          .oi-two { grid-template-columns:1fr !important; }
          .oi-line { grid-template-columns:1fr 1fr !important; }
          .oi-line > .oi-item { grid-column:1 / -1; }
        }
        .oi-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px; }
        .oi-card h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:0 0 10px; }
        .oi-low { color:#d97706;font-weight:700; } .oi-out { color:#dc2626;font-weight:700; }
        .oi-line { display:grid;grid-template-columns:2.4fr 1fr 1fr 1fr 1fr auto;gap:8px;align-items:end;padding:8px 0;border-bottom:1px dotted #e2e8f0; }
      </style>
      ${H.header('Office Inventory', 'Office consumables — purchases, consumption and what is left',
        `<button id="oi-add-pur" class="btn-primary btn-sm">+ Purchase</button><button id="oi-add-con" class="btn-secondary btn-sm">+ Consumption</button>`)}
      ${H.tabs('oi', tabsFor(), _tab)}
      ${body}
    </div>`;
    bind();
  }

  const filterBar = (inner) => `<div class="oi-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">${inner}</div>`;
  const sel = (id, value, options) => `<select id="${id}" style="${H.CONTROL}max-width:210px;">
    ${options.map((o) => { const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  const search = (id, value, ph) => `<input id="${id}" value="${esc(value)}" placeholder="${esc(ph)}" style="${H.CONTROL}max-width:280px;"/>`;

  /* ── Stock ────────────────────────────────────────────────────────── */

  // 'never' = on the list but never stocked (no opening, never bought) —
  // not "out of stock", there was never any to run out of.
  const stockState = (i) => (!i.opening_qty && !i.purchased ? 'never' : i.stock <= 0 ? 'out' : i.min_qty > 0 && i.stock <= i.min_qty ? 'low' : 'ok');

  function filteredStock() {
    const f = _f.stock, n = f.q.trim().toLowerCase();
    return D.items.filter((i) => {
      if (f.show === 'active' && !i.active) return false;
      if (f.show === 'low' && !['low', 'out'].includes(stockState(i))) return false;
      if (f.cat !== 'All' && i.category !== f.cat) return false;
      if (n && !`${i.name} ${i.category}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }

  function stockTab() {
    // First open on a fresh database: offer the one-click import.
    if (!D.items.length) {
      return `<div class="oi-card" style="text-align:center;padding:36px 20px;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;">No items yet</div>
        <div style="font-size:12.5px;color:#64748b;margin:6px 0 16px;">${D.manage
          ? 'Load the item names from the old “Inventory Management System” sheet (no old stock or history), or add items from the Items tab.'
          : 'Ask an Admin to load the item list, or add an item from the Items tab.'}</div>
        ${D.manage ? '<button class="btn-primary btn-sm" id="ls-import">Load item list from the sheet</button><div id="ls-import-out" style="font-size:12px;color:#475569;margin-top:10px;"></div>' : ''}
      </div>`;
    }
    const f = _f.stock;
    const fy = fyOf(H.todayISO());
    const fySpend = D.purchases.filter((p) => p.purchase_date && fyOf(p.purchase_date) === fy).reduce((n, p) => n + p.total, 0);
    const monthUse = D.consumption.filter((c) => monthOf(c.use_date) === monthOf(H.todayISO())).length;
    const out = D.items.filter((i) => i.active && stockState(i) === 'out').length;
    const low = D.items.filter((i) => i.active && stockState(i) === 'low').length;
    const list = filteredStock();
    return `
      ${H.stats([
        { label: 'Items', value: D.items.filter((i) => i.active).length },
        { label: 'Out of Stock', value: out, color: out ? '#dc2626' : undefined },
        { label: 'Low Stock', value: low, color: low ? '#d97706' : undefined, hint: 'at or under the item’s minimum' },
        { label: `Spend FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`, value: '₹ ' + H.inr0(fySpend) },
        { label: 'Used this month', value: monthUse, hint: 'consumption entries' },
      ])}
      ${filterBar(search('st-q', f.q, 'Search item…')
        + sel('st-cat', f.cat, [{ value: 'All', label: 'All Categories' }, ...D.lists.categories])
        + sel('st-show', f.show, [{ value: 'all', label: 'All items' }, { value: 'active', label: 'Active only' }, { value: 'low', label: 'Low / out of stock' }])
        + '<button class="btn-secondary btn-sm" id="st-csv">Export CSV</button>')}
      ${H.table([{ label: 'Item', m: 'title' }, 'Category', 'Unit', { label: 'Opening', align: 'right' }, { label: 'Purchased', align: 'right' },
        { label: 'Consumed', align: 'right' }, { label: 'In Stock', align: 'right' }, 'Last Purchase', 'Last Used'],
      list.map((i) => {
        const st = stockState(i);
        return [
          `${esc(i.name)}${i.active ? '' : ' ' + H.pill('Inactive', 'neutral')}`, esc(i.category), esc(i.unit),
          qty(i.opening_qty), qty(i.purchased), qty(i.consumed),
          `<span class="${st === 'out' ? 'oi-out' : st === 'low' ? 'oi-low' : ''}" style="font-size:14px;">${qty(i.stock)}</span>`,
          i.last_purchase ? H.fmtDate(i.last_purchase) : '—', i.last_used ? H.fmtDate(i.last_used) : '—',
        ];
      }), { empty: 'No items match', cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${list.length} item${list.length === 1 ? '' : 's'} · In Stock = Opening + Purchased − Consumed</div>`;
  }

  /* ── Purchases ────────────────────────────────────────────────────── */

  function filteredPurchases() {
    const f = _f.purchases, n = f.q.trim().toLowerCase();
    return D.purchases.filter((p) => {
      if (f.month !== 'All' && monthOf(p.purchase_date) !== f.month) return false;
      if (f.vendor !== 'All' && p.vendor !== f.vendor) return false;
      if (n && !`${p.item_name} ${p.vendor} ${p.category} ${p.bill_no} ${p.branch}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }
  const months = (list, k) => [...new Set(list.map((x) => monthOf(x[k])).filter(Boolean))].sort().reverse();

  function purchasesTab() {
    const f = _f.purchases;
    const list = filteredPurchases();
    const vendors = [...new Set(D.purchases.map((p) => p.vendor).filter(Boolean))].sort();
    return `
      ${filterBar(search('pu-q', f.q, 'Search item, vendor, bill…')
        + sel('pu-month', f.month, [{ value: 'All', label: 'All Months' }, ...months(D.purchases, 'purchase_date').map((m) => ({ value: m, label: monthLabel(m) }))])
        + sel('pu-vendor', f.vendor, [{ value: 'All', label: 'All Vendors' }, ...vendors])
        + '<button class="btn-secondary btn-sm" id="pu-csv">Export CSV</button>')}
      ${H.table(['Date', { label: 'Item', m: 'title' }, 'Vendor', 'Branch', { label: 'Qty', align: 'right' }, { label: 'Rate', align: 'right' },
        { label: 'GST', align: 'right' }, { label: 'Total', align: 'right' }, 'Invoice', 'Added By', ...(D.manage ? [{ label: '', m: 'actions' }] : [])],
      list.map((p) => [
        H.fmtDate(p.purchase_date),
        `${esc(p.item_name)}<div style="font-size:11px;color:#94a3b8;">${esc(p.category)}${p.bill_no ? ' · Bill ' + esc(p.bill_no) : ''}</div>`,
        esc(p.vendor), esc(p.branch), `${qty(p.qty)} ${esc(p.unit)}`, money(p.rate), `${p.gst}%`, `<b>${money(p.total)}</b>`,
        p.has_file ? `<a href="${BASE}/purchases/${encodeURIComponent(p.id)}/invoice" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">📎 View</a>`
          : p.invoice_url ? `<a href="${esc(p.invoice_url)}" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">📎 Drive</a>` : '—',
        esc(p.added_by),
        ...(D.manage ? [`<button class="btn-secondary btn-sm" data-del-pur="${esc(p.id)}" style="color:#dc2626;">Delete</button>`] : []),
      ]), { empty: 'No purchases match', cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${list.length} line${list.length === 1 ? '' : 's'} · ${money(list.reduce((n, p) => n + p.total, 0))}</div>`;
  }

  /* ── Consumption ──────────────────────────────────────────────────── */

  function filteredConsumption() {
    const f = _f.consumption, n = f.q.trim().toLowerCase();
    return D.consumption.filter((c) => {
      if (f.month !== 'All' && monthOf(c.use_date) !== f.month) return false;
      if (f.user !== 'All' && c.used_by !== f.user) return false;
      if (n && !`${c.item_name} ${c.used_by} ${c.remarks}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }

  function consumptionTab() {
    const f = _f.consumption;
    const list = filteredConsumption();
    const users = [...new Set(D.consumption.map((c) => c.used_by).filter(Boolean))].sort();
    return `
      ${filterBar(search('co-q', f.q, 'Search item, person…')
        + sel('co-month', f.month, [{ value: 'All', label: 'All Months' }, ...months(D.consumption, 'use_date').map((m) => ({ value: m, label: monthLabel(m) }))])
        + sel('co-user', f.user, [{ value: 'All', label: 'Everyone' }, ...users])
        + '<button class="btn-secondary btn-sm" id="co-csv">Export CSV</button>')}
      ${H.table(['Date', { label: 'Item', m: 'title' }, 'Used By', { label: 'Qty', align: 'right' }, 'Remarks', 'Added By', ...(D.manage ? [{ label: '', m: 'actions' }] : [])],
      list.map((c) => [
        H.fmtDate(c.use_date), esc(c.item_name), esc(c.used_by), `${qty(c.qty)} ${esc(itemById(c.item_id)?.unit || '')}`,
        `<div style="max-width:260px;font-size:12px;color:#64748b;">${esc(c.remarks)}</div>`, esc(c.added_by),
        ...(D.manage ? [`<button class="btn-secondary btn-sm" data-del-con="${esc(c.id)}" style="color:#dc2626;">Delete</button>`] : []),
      ]), { empty: 'No consumption matches', cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${list.length} entr${list.length === 1 ? 'y' : 'ies'}</div>`;
  }

  /* ── Items ────────────────────────────────────────────────────────── */

  function itemsTab() {
    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;"><button class="btn-primary btn-sm" id="it-add">+ Add Item</button></div>
      ${H.table(['ID', { label: 'Item', m: 'title' }, 'Category', 'Unit', { label: 'Opening', align: 'right' }, { label: 'Minimum', align: 'right' },
        { label: 'In Stock', align: 'right' }, 'Status', { label: '', m: 'actions' }],
      D.items.map((i) => [
        `<b>${esc(i.id)}</b>`, esc(i.name), esc(i.category), esc(i.unit), qty(i.opening_qty), i.min_qty ? qty(i.min_qty) : '—', qty(i.stock),
        i.active ? H.pill('Active', 'success') : H.pill('Inactive', 'neutral'),
        `<div style="display:flex;gap:5px;"><button class="btn-secondary btn-sm" data-edit-item="${esc(i.id)}">Edit</button>
          ${D.manage && !i.purchased && !i.consumed ? `<button class="btn-secondary btn-sm" data-del-item="${esc(i.id)}" style="color:#dc2626;">Delete</button>` : ''}</div>`,
      ]), { empty: 'No items yet', cards: true })}`;
  }

  function itemForm(it) {
    const editing = !!it;
    it = it || { unit: 'Pcs', active: true, opening_qty: 0, min_qty: 0 };
    H.openModal({
      id: 'oi-iform', width: 560, title: editing ? `Edit ${it.id}` : 'Add Item',
      bodyHTML: H.grid(
        H.field('if-name', 'Item Name', it.name, { required: true, span: 2 })
        + H.select('if-cat', 'Category', it.category || '', D.lists.categories, { placeholder: '— Select —' })
        + H.select('if-unit', 'Unit', it.unit, D.lists.units)
        + H.field('if-open', 'Opening Stock', it.opening_qty, { type: 'number', step: 'any', hint: 'What was in the cupboard before the first purchase' })
        + H.field('if-min', 'Minimum Stock', it.min_qty || '', { type: 'number', step: 'any', hint: 'Flagged as low at or under this' })
        + (editing ? H.select('if-active', 'Status', it.active ? '1' : '0', [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]) : ''),
      ),
      confirmText: editing ? 'Save' : 'Add Item',
      onConfirm: async () => {
        const body = { name: H.val('if-name').trim(), category: H.val('if-cat'), unit: H.val('if-unit'), opening_qty: H.val('if-open'),
          min_qty: H.val('if-min'), active: editing ? H.val('if-active') === '1' : true };
        if (!body.name) throw new Error('Write the item name');
        if (editing) await H.patch(`${BASE}/items/${encodeURIComponent(it.id)}`, body); else await H.post(`${BASE}/items`, body);
        H.closeModal('oi-iform');
        H.toast(editing ? 'Item saved' : 'Item added');
        await refresh();
      },
    });
  }

  /* ── Multi-line purchase / consumption forms ──────────────────────── */

  // Item picker grouped by category, stock shown so nobody guesses.
  function itemSelect(cls, value = '') {
    const groups = {};
    for (const i of D.items.filter((x) => x.active)) (groups[i.category || 'Other'] ||= []).push(i);
    return `<select class="${cls}" style="${H.CONTROL}"><option value="">— Item —</option>
      ${Object.keys(groups).sort().map((g) => `<optgroup label="${esc(g)}">${groups[g].map((i) =>
        `<option value="${esc(i.id)}"${i.id === value ? ' selected' : ''}>${esc(i.name)} (${qty(i.stock)} ${esc(i.unit)})</option>`).join('')}</optgroup>`).join('')}
    </select>`;
  }
  const L = (t) => `<label style="${H.LABEL}">${esc(t)}</label>`;
  const datalist = (id, list) => `<datalist id="${id}">${list.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;

  function purchaseLine() {
    return `<div class="oi-line">
      <div class="oi-item">${L('Item')}${itemSelect('pl-item')}</div>
      <div>${L('Qty')}<input class="pl-qty" type="number" step="any" min="0" style="${H.CONTROL}"/></div>
      <div>${L('Rate (₹)')}<input class="pl-rate" type="number" step="any" min="0" style="${H.CONTROL}"/></div>
      <div>${L('GST %')}<select class="pl-gst" style="${H.CONTROL}">${D.lists.gst.map((g) => `<option>${esc(g)}</option>`).join('')}</select></div>
      <div>${L('Total')}<div class="pl-total" style="padding:9px 0;font-size:13px;font-weight:700;color:#0f172a;">—</div></div>
      <button type="button" class="btn-secondary btn-sm pl-del" title="Remove" style="color:#dc2626;margin-bottom:4px;">✕</button>
    </div>`;
  }

  function purchaseForm() {
    if (!D.items.some((i) => i.active)) return H.toast('Add an item first (Items tab)', 'error');
    H.openModal({
      id: 'oi-pform', width: 860, title: 'Add Purchase', subtitle: 'One bill — add every item on it',
      bodyHTML: `${H.grid(
        H.field('pf-date', 'Date of Purchase', H.todayISO(), { type: 'date', required: true })
        + H.select('pf-branch', 'Company Branch', D.lists.branches[0] || '', D.lists.branches, { required: true })
        + `<div>${L('Vendor Name *')}<input id="pf-vendor" list="pf-vendors" placeholder="Pick or type a new vendor" style="${H.CONTROL}"/>${datalist('pf-vendors', D.lists.vendors)}</div>`
        + H.field('pf-bill', 'Bill / Invoice No.', '', { placeholder: 'Optional' })
        + `<div style="grid-column:span 2;">${L('Invoice (PDF or photo)')}<input id="pf-file" type="file" accept=".pdf,image/*" style="${H.CONTROL}padding:6px;"/></div>`,
      )}
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:16px 0 4px;">Items</div>
        <div id="pf-lines">${purchaseLine()}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <button type="button" class="btn-secondary btn-sm" id="pf-more">+ Another item</button>
          <div style="font-size:14px;">Bill total: <b id="pf-sum">₹ 0.00</b></div>
        </div>`,
      confirmText: 'Save Purchase',
      onOpen: (root) => {
        const recalc = () => {
          let sum = 0;
          root.querySelectorAll('.oi-line').forEach((l) => {
            const q = Number(l.querySelector('.pl-qty').value), r = Number(l.querySelector('.pl-rate').value), g = Number(l.querySelector('.pl-gst').value) || 0;
            const t = q > 0 && r >= 0 ? q * r * (1 + g / 100) : 0;
            sum += t;
            l.querySelector('.pl-total').textContent = t ? money(t) : '—';
          });
          root.querySelector('#pf-sum').textContent = money(sum);
        };
        const wire = (l) => {
          l.querySelectorAll('input,select').forEach((x) => x.addEventListener('input', recalc));
          l.querySelector('.pl-del').addEventListener('click', () => { if (root.querySelectorAll('.oi-line').length > 1) { l.remove(); recalc(); } });
          // Last price paid for the item, as a starting point.
          l.querySelector('.pl-item').addEventListener('change', (e) => {
            const last = D.purchases.find((p) => p.item_id === e.target.value);
            if (last) { l.querySelector('.pl-rate').value = last.rate; l.querySelector('.pl-gst').value = String(last.gst); }
            recalc();
          });
        };
        root.querySelectorAll('.oi-line').forEach(wire);
        root.querySelector('#pf-more').addEventListener('click', () => {
          root.querySelector('#pf-lines').insertAdjacentHTML('beforeend', purchaseLine());
          wire(root.querySelector('#pf-lines').lastElementChild);
        });
      },
      onConfirm: async () => {
        const root = document.getElementById('oi-pform');
        const body = { purchase_date: H.val('pf-date'), branch: H.val('pf-branch'), vendor: H.val('pf-vendor').trim(), bill_no: H.val('pf-bill').trim() };
        if (!body.purchase_date) throw new Error('Pick the date of purchase');
        if (body.purchase_date > H.todayISO()) throw new Error('Purchase date cannot be in the future');
        if (!body.vendor) throw new Error('Pick or type the vendor');
        body.lines = [...root.querySelectorAll('.oi-line')].map((l) => ({
          item_id: l.querySelector('.pl-item').value, qty: l.querySelector('.pl-qty').value, rate: l.querySelector('.pl-rate').value, gst: l.querySelector('.pl-gst').value,
        })).filter((l) => l.item_id || l.qty);
        if (!body.lines.length) throw new Error('Add at least one item');
        body.lines.forEach((l, i) => {
          if (!l.item_id) throw new Error(`Line ${i + 1}: choose the item`);
          if (!(Number(l.qty) > 0)) throw new Error(`Line ${i + 1}: enter the quantity`);
          if (l.rate === '' || !(Number(l.rate) >= 0)) throw new Error(`Line ${i + 1}: enter the rate`);
        });
        const f = document.getElementById('pf-file')?.files?.[0];
        if (f) {
          if (f.size > 6 * 1024 * 1024) throw new Error('The invoice file is over 6 MB');
          body.invoice = { name: f.name, dataUrl: await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the invoice file')); r.readAsDataURL(f); }) };
        }
        const r = await H.post(`${BASE}/purchases`, body);
        H.closeModal('oi-pform');
        H.toast(`Purchase saved — ${body.lines.length} item${body.lines.length === 1 ? '' : 's'}, ${money(r.total)}`);
        await refresh();
      },
    });
  }

  function consumptionLine() {
    return `<div class="oi-line" style="grid-template-columns:3fr 1fr auto;">
      <div class="oi-item">${L('Item')}${itemSelect('cl-item')}</div>
      <div>${L('Quantity Used')}<input class="cl-qty" type="number" step="any" min="0" style="${H.CONTROL}"/></div>
      <button type="button" class="btn-secondary btn-sm cl-del" title="Remove" style="color:#dc2626;margin-bottom:4px;">✕</button>
    </div>`;
  }

  function consumptionForm() {
    H.openModal({
      id: 'oi-cform', width: 640, title: 'Record Consumption', subtitle: 'What was taken out of stock, and by whom',
      bodyHTML: `${H.grid(
        H.field('cf-date', 'Date', H.todayISO(), { type: 'date', required: true })
        + `<div>${L('Used By *')}<input id="cf-user" list="cf-users" placeholder="Pick or type a name" style="${H.CONTROL}"/>${datalist('cf-users', D.lists.users)}</div>`,
      )}
        <div id="cf-lines" style="margin-top:6px;">${consumptionLine()}</div>
        <button type="button" class="btn-secondary btn-sm" id="cf-more" style="margin-top:10px;">+ Another item</button>
        <div style="margin-top:12px;">${H.grid(H.textarea('cf-remarks', 'Remarks', '', { rows: 2, placeholder: 'Optional' }))}</div>`,
      confirmText: 'Save',
      onOpen: (root) => {
        const wire = (l) => l.querySelector('.cl-del').addEventListener('click', () => { if (root.querySelectorAll('.oi-line').length > 1) l.remove(); });
        root.querySelectorAll('.oi-line').forEach(wire);
        root.querySelector('#cf-more').addEventListener('click', () => {
          root.querySelector('#cf-lines').insertAdjacentHTML('beforeend', consumptionLine());
          wire(root.querySelector('#cf-lines').lastElementChild);
        });
      },
      onConfirm: async () => {
        const root = document.getElementById('oi-cform');
        const body = { use_date: H.val('cf-date'), used_by: H.val('cf-user').trim(), remarks: H.val('cf-remarks').trim() };
        if (!body.use_date) throw new Error('Pick the date');
        if (body.use_date > H.todayISO()) throw new Error('Date cannot be in the future');
        if (!body.used_by) throw new Error('Pick or type who used it');
        body.lines = [...root.querySelectorAll('.oi-line')].map((l) => ({ item_id: l.querySelector('.cl-item').value, qty: l.querySelector('.cl-qty').value }))
          .filter((l) => l.item_id || l.qty);
        if (!body.lines.length) throw new Error('Add at least one item');
        body.lines.forEach((l, i) => {
          if (!l.item_id) throw new Error(`Line ${i + 1}: choose the item`);
          if (!(Number(l.qty) > 0)) throw new Error(`Line ${i + 1}: enter the quantity`);
          const it = itemById(l.item_id);
          if (Number(l.qty) > it.stock) throw new Error(`Only ${qty(it.stock)} ${it.unit} of "${it.name}" is in stock`);
        });
        await H.post(`${BASE}/consumption`, body);
        H.closeModal('oi-cform');
        H.toast('Consumption recorded');
        await refresh();
      },
    });
  }

  /* ── Reports ──────────────────────────────────────────────────────── */

  function reportsTab() {
    const fys = [...new Set([...D.purchases.map((p) => p.purchase_date), ...D.consumption.map((c) => c.use_date)].filter(Boolean).map(fyOf))].sort().reverse();
    const fy = +(_f.report.fy || fys[0] || fyOf(H.todayISO()));
    const inFy = (iso) => iso && fyOf(iso) === fy;
    const pur = D.purchases.filter((p) => inFy(p.purchase_date));
    const con = D.consumption.filter((c) => inFy(c.use_date));
    const monthsList = Array.from({ length: 12 }, (_, i) => { const d = new Date(fy, 3 + i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
    const byMonth = monthsList.map((m) => [m, pur.filter((p) => monthOf(p.purchase_date) === m).reduce((n, p) => n + p.total, 0)]);
    const max = Math.max(1, ...byMonth.map((x) => x[1]));
    const sumBy = (list, key, val) => Object.entries(list.reduce((m, x) => { const k = x[key] || '—'; m[k] = (m[k] || 0) + val(x); return m; }, {})).sort((a, b) => b[1] - a[1]);
    const byCat = sumBy(pur, 'category', (p) => p.total);
    const byVendor = sumBy(pur, 'vendor', (p) => p.total);
    const byUser = sumBy(con, 'used_by', () => 1);
    const topItems = sumBy(con, 'item_name', (c) => c.qty).slice(0, 12);
    const label = (y) => `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    const rows = (pairs, fmt) => (pairs.length ? pairs.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dotted #e2e8f0;font-size:12.5px;">
        <span style="color:#334155;">${esc(k)}</span><b style="color:#0f172a;white-space:nowrap;">${fmt(v)}</b></div>`).join('')
      : '<div style="font-size:12.5px;color:#94a3b8;padding:8px 0;">Nothing in this year</div>');
    return `
      ${filterBar(sel('rp-fy', fy, (fys.length ? fys : [fy]).map((y) => ({ value: y, label: label(y) }))))}
      ${H.stats([{ label: `Spend ${label(fy)}`, value: '₹ ' + H.inr0(pur.reduce((n, p) => n + p.total, 0)) }, { label: 'Purchase lines', value: pur.length }, { label: 'Consumption entries', value: con.length }])}
      <div class="oi-card" style="margin-bottom:12px;"><h3>Monthly purchase spend</h3>
        <div style="display:flex;align-items:flex-end;gap:6px;height:150px;">
          ${byMonth.map(([m, v]) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;" title="${esc(monthLabel(m))}: ₹ ${H.inr0(v)}">
            <div style="font-size:10px;color:#64748b;margin-bottom:2px;white-space:nowrap;">${!v ? '' : v >= 1000 ? H.inr0(v / 1000) + 'k' : H.inr0(v)}</div>
            <div style="width:100%;max-width:40px;background:var(--color-primary);border-radius:4px 4px 0 0;height:${(v / max) * 115}px;min-height:${v ? 2 : 0}px;"></div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px;">${esc(monthLabel(m).split(' ')[0])}</div></div>`).join('')}
        </div></div>
      <div class="oi-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="oi-card"><h3>Spend by category</h3>${rows(byCat, money)}</div>
        <div class="oi-card"><h3>Spend by vendor</h3>${rows(byVendor, money)}</div>
        <div class="oi-card"><h3>Most used items</h3>${rows(topItems, qty)}</div>
        <div class="oi-card"><h3>Consumption entries by person</h3>${rows(byUser, String)}</div>
      </div>`;
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  const LIST_LABEL = { branches: 'Company Branches', vendors: 'Vendors', categories: 'Categories', users: 'Users (who consume)', units: 'Units', gst: 'GST %' };

  function settingsTab() {
    return `
      <div class="oi-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${Object.keys(LIST_LABEL).map((k) => `<div class="oi-card"><h3>${esc(LIST_LABEL[k])}</h3>
          <textarea id="ls-${k}" rows="6" style="${H.CONTROL}resize:vertical;">${esc(D.lists[k].join('\n'))}</textarea>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;">One per line. New names typed on a form are added here automatically.</div></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn-primary btn-sm" id="ls-save">Save Lists</button></div>
      <div class="oi-card" style="margin-top:16px;">
        <h3>Item list from the old Google Sheet</h3>
        <div style="font-size:12.5px;color:#475569;margin-bottom:10px;">Adds any item name (and vendor / user / category) from the old “Inventory Management System” sheet that isn’t here yet.
          Nothing is deleted, and no old stock or history comes over — entries start fresh from 1 Oct 2026.</div>
        <button class="btn-secondary btn-sm" id="ls-import">Load missing items from sheet</button>
        <div id="ls-import-out" style="font-size:12px;color:#475569;margin-top:10px;"></div>
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-oi-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-oi-tab'); render(); }));
    $('oi-add-pur')?.addEventListener('click', purchaseForm);
    $('oi-add-con')?.addEventListener('click', consumptionForm);

    const live = (id, obj, k) => {
      const el = $(id);
      if (!el) return;
      if (el.tagName === 'SELECT') return el.addEventListener('change', () => { obj[k] = el.value; render(); });
      let t;
      el.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { obj[k] = el.value; render(); const a = $(id); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } }, 250);
      });
    };
    live('st-q', _f.stock, 'q'); live('st-cat', _f.stock, 'cat'); live('st-show', _f.stock, 'show');
    live('pu-q', _f.purchases, 'q'); live('pu-month', _f.purchases, 'month'); live('pu-vendor', _f.purchases, 'vendor');
    live('co-q', _f.consumption, 'q'); live('co-month', _f.consumption, 'month'); live('co-user', _f.consumption, 'user');
    live('rp-fy', _f.report, 'fy');

    const stamp = H.todayISO();
    $('st-csv')?.addEventListener('click', () => H.downloadCsv(`office-stock-${stamp}.csv`,
      ['Item', 'Category', 'Unit', 'Opening', 'Purchased', 'Consumed', 'In Stock', 'Minimum', 'Last Purchase', 'Last Used'],
      filteredStock().map((i) => [i.name, i.category, i.unit, i.opening_qty, i.purchased, i.consumed, i.stock, i.min_qty, i.last_purchase || '', i.last_used || ''])));
    $('pu-csv')?.addEventListener('click', () => H.downloadCsv(`office-purchases-${stamp}.csv`,
      ['Date', 'Branch', 'Vendor', 'Bill No', 'Category', 'Item', 'Unit', 'Qty', 'Rate', 'GST %', 'Total', 'Invoice', 'Added By'],
      filteredPurchases().map((p) => [p.purchase_date, p.branch, p.vendor, p.bill_no, p.category, p.item_name, p.unit, p.qty, p.rate, p.gst, p.total,
        p.has_file ? location.origin + `${BASE}/purchases/${p.id}/invoice` : p.invoice_url, p.added_by])));
    $('co-csv')?.addEventListener('click', () => H.downloadCsv(`office-consumption-${stamp}.csv`,
      ['Date', 'Item', 'Used By', 'Qty', 'Unit', 'Remarks', 'Added By'],
      filteredConsumption().map((c) => [c.use_date, c.item_name, c.used_by, c.qty, itemById(c.item_id)?.unit || '', c.remarks, c.added_by])));

    $('it-add')?.addEventListener('click', () => itemForm(null));
    document.querySelectorAll('[data-edit-item]').forEach((b) => b.addEventListener('click', () => itemForm(itemById(b.getAttribute('data-edit-item')))));
    const del = (attr, what, url) => document.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute(attr);
      if (!(await Utils.showConfirm(`Delete this ${what} (${id})? Stock is recalculated.`, { title: `Delete ${what}`, confirmText: 'Delete', danger: true }))) return;
      try { await H.del(`${url}/${encodeURIComponent(id)}`); H.toast('Deleted'); await refresh(); } catch (e) { H.fail(e); }
    }));
    del('data-del-pur', 'purchase line', `${BASE}/purchases`);
    del('data-del-con', 'consumption entry', `${BASE}/consumption`);
    del('data-del-item', 'item', `${BASE}/items`);

    $('ls-save')?.addEventListener('click', async (e) => {
      const btn = e.target;
      const body = Object.fromEntries(Object.keys(LIST_LABEL).map((k) => [k, H.val(`ls-${k}`).split('\n').map((x) => x.trim()).filter(Boolean)]));
      btn.disabled = true;
      try { D.lists = await H.post(`${BASE}/lists`, body); H.toast('Lists saved'); render(); } catch (err) { btn.disabled = false; H.fail(err); }
    });
    $('ls-import')?.addEventListener('click', (e) => runImport(e.target));
  }

  async function runImport(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const r = await H.post(`${BASE}/import`);
      await load(); render();
      const out = document.getElementById('ls-import-out');
      if (out) out.innerHTML = `${r.added} new item${r.added === 1 ? '' : 's'} added (${r.items} in the sheet).`;
      H.toast(r.added ? `${r.added} items loaded — enter each one’s opening stock (Items tab)` : 'Every sheet item is already here');
    } catch (err) { H.fail(err); if (btn?.isConnected) { btn.disabled = false; btn.textContent = 'Try again'; } }
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Office Inventory…');
      try {
        await load(); render();
        // First Admin visit on a fresh database loads the item names.
        if (!D.items.length && D.manage && _tab === 'stock') runImport(document.getElementById('ls-import'));
      } catch (e) { if (el) el.innerHTML = H.empty('Could not load Office Inventory', e.message); }
    },
  };
})();
