/* =====================================================================
   HR — shared building blocks
   ---------------------------------------------------------------------
   The five HR pages (Employees, Attendance, Leave, Payroll, Reports) are
   the same handful of shapes repeated: a page header with filters, a card
   holding a table, a modal with a grid of labelled fields, a row of stat
   tiles. Those live here once so the pages carry only what is actually
   different about them, and so a change to how an HR table looks is one
   edit rather than five.

   Everything renders as an HTML string, matching the rest of the app's
   pages — no framework, no build step.
   ===================================================================== */
window.HR = (function () {

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const num = (v) => {
    const n = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // Money is always shown Indian-grouped with two decimals; a zero shows as
  // a dash so a dense salary table reads as figures rather than noise.
  const inr = (v, { zero = '—' } = {}) => {
    const n = num(v);
    if (!n) return zero;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const inr0 = (v) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtTime = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const isAdmin = () => {
    const r = window.currentUser?.roles || [];
    return (Array.isArray(r) ? r : String(r).split(',')).some((x) => ['Admin', 'HOD'].includes(String(x).trim()));
  };
  const isOwner = () => !!window.currentUser?.isSuperAdmin;

  const api = (url, opts) => Utils.apiFetch(url, opts);
  const post = (url, body) => Utils.apiFetch(url, { method: 'POST', body: JSON.stringify(body || {}) });
  const patch = (url, body) => Utils.apiFetch(url, { method: 'PATCH', body: JSON.stringify(body || {}) });
  const del = (url) => Utils.apiFetch(url, { method: 'DELETE' });

  const toast = (m, t) => Utils.showToast(m, t);
  // Every failed HR call surfaces the server's own message rather than a
  // generic one — "This month is finalised" is worth reading.
  const fail = (e) => toast(e?.message || 'Something went wrong', 'error');

  /* ── Page chrome ──────────────────────────────────────────────────── */

  function header(title, subtitle, actionsHtml = '') {
    return `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
          <h1 style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;margin:0;">${esc(title)}</h1>
          <p style="font-size:12.5px;color:#64748b;margin:3px 0 0;">${esc(subtitle)}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${actionsHtml}</div>
      </div>`;
  }

  // Horizontal tab strip. `id` prefixes the data attribute the page binds to.
  function tabs(id, items, active) {
    return `<div style="display:flex;gap:2px;border-bottom:1.5px solid #e2e8f0;margin-bottom:16px;overflow-x:auto;">
      ${items.map((t) => {
        const on = t.key === active;
        return `<button data-${id}-tab="${esc(t.key)}" style="border:none;background:none;cursor:pointer;padding:9px 15px;
          font-size:13px;font-weight:${on ? '700' : '500'};color:${on ? 'var(--color-primary)' : '#64748b'};
          border-bottom:2.5px solid ${on ? 'var(--color-primary)' : 'transparent'};margin-bottom:-1.5px;white-space:nowrap;">
          ${esc(t.label)}${t.count != null ? ` <span style="font-size:11px;opacity:.7;">(${t.count})</span>` : ''}</button>`;
      }).join('')}
    </div>`;
  }

  // A row of headline figures. Kept deliberately plain — these sit above
  // dense tables and must not compete with them for attention.
  function stats(pairs, { accent = 'var(--color-primary)' } = {}) {
    const entries = Array.isArray(pairs) ? pairs : Object.entries(pairs).map(([label, value]) => ({ label, value }));
    if (!entries.length) return '';
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px;">
      ${entries.map((s) => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:11px;padding:13px 15px;">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;">${esc(s.label)}</div>
          <div style="font-size:20px;font-weight:700;color:${esc(s.color || accent)};margin-top:5px;letter-spacing:-.02em;">${esc(s.value)}</div>
          ${s.hint ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${esc(s.hint)}</div>` : ''}
        </div>`).join('')}
    </div>`;
  }

  const TH = 'padding:10px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;'
           + 'color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0;background:#f8fafc;';
  const TD = 'padding:10px 12px;font-size:12.5px;color:#334155;border-bottom:1px solid #f1f5f9;';

  /* A table inside the app's standard card. `columns` may be plain strings or
     { label, align } objects; `rows` is an array of arrays of ready HTML. */
  function table(columns, rows, { empty = 'Nothing to show yet', maxHeight = '' } = {}) {
    const cols = columns.map((c) => (typeof c === 'string' ? { label: c } : c));
    const body = rows.length
      ? rows.map((r) => `<tr style="transition:background .1s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
          ${r.map((cell, i) => `<td style="${TD}${cols[i]?.align === 'right' ? 'text-align:right;' : ''}${cols[i]?.nowrap ? 'white-space:nowrap;' : ''}">${cell == null ? '—' : cell}</td>`).join('')}
        </tr>`).join('')
      : `<tr><td colspan="${cols.length}" style="padding:44px;text-align:center;color:#94a3b8;font-size:13px;">${esc(empty)}</td></tr>`;
    return `<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <div style="overflow:auto;${maxHeight ? `max-height:${maxHeight};` : ''}">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>${cols.map((c) => `<th style="${TH}${c.align === 'right' ? 'text-align:right;' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  }

  const pill = (text, variant = 'neutral') => `<span class="pill pill-${variant} pill-sm">${esc(text)}</span>`;

  // Status wording is not uniform across the HR tables (a leave is
  // "Approved", a payroll run is "finalised"), so the mapping is one place.
  const STATUS_VARIANT = {
    Active: 'success', Approved: 'success', done: 'success', finalised: 'success', paid: 'success',
    Inactive: 'neutral', Cancelled: 'neutral', 'Week Off': 'neutral', Holiday: 'neutral',
    pending: 'warning', Pending: 'warning', draft: 'warning', 'Pending Level 1': 'warning', 'Half Day': 'warning',
    Rejected: 'danger', Absent: 'danger',
    Present: 'success', Remote: 'info', Leave: 'purple', 'On Leave': 'purple',
  };
  const statusPill = (s) => (s ? pill(s, STATUS_VARIANT[s] || 'neutral') : '—');

  /* ── Form fields ──────────────────────────────────────────────────── */

  const LABEL = 'display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;'
              + 'letter-spacing:.06em;color:#64748b;margin-bottom:5px;';
  const CONTROL = 'width:100%;padding:8px 11px;border:1.5px solid #e2e8f0;border-radius:8px;'
                + 'font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;font-family:inherit;';

  function field(id, label, value = '', opts = {}) {
    const { type = 'text', required = false, placeholder = '', readonly = false, span = 1, hint = '', step = '' } = opts;
    return `<div style="grid-column:span ${span};">
      <label style="${LABEL}">${esc(label)}${required ? ' <span style="color:#ef4444">*</span>' : ''}</label>
      <input id="${esc(id)}" type="${esc(type)}" ${step ? `step="${esc(step)}"` : ''} value="${esc(value)}"
        placeholder="${esc(placeholder)}" ${readonly ? 'readonly' : ''}
        style="${CONTROL}${readonly ? 'background:#f8fafc;color:#64748b;' : ''}" />
      ${hint ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">${esc(hint)}</div>` : ''}
    </div>`;
  }

  function select(id, label, value, options, opts = {}) {
    const { required = false, span = 1, placeholder = null, hint = '' } = opts;
    const list = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
    return `<div style="grid-column:span ${span};">
      <label style="${LABEL}">${esc(label)}${required ? ' <span style="color:#ef4444">*</span>' : ''}</label>
      <select id="${esc(id)}" style="${CONTROL}">
        ${placeholder != null ? `<option value="">${esc(placeholder)}</option>` : ''}
        ${list.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      ${hint ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">${esc(hint)}</div>` : ''}
    </div>`;
  }

  function textarea(id, label, value = '', opts = {}) {
    const { rows = 3, span = 2, placeholder = '' } = opts;
    return `<div style="grid-column:span ${span};">
      <label style="${LABEL}">${esc(label)}</label>
      <textarea id="${esc(id)}" rows="${rows}" placeholder="${esc(placeholder)}"
        style="${CONTROL}resize:vertical;">${esc(value)}</textarea>
    </div>`;
  }

  // Read-only label/value pair, for profile panels.
  function readout(label, value) {
    return `<div style="padding:7px 0;border-bottom:1px dotted #e2e8f0;display:flex;justify-content:space-between;gap:12px;">
      <span style="font-size:11.5px;color:#94a3b8;">${esc(label)}</span>
      <span style="font-size:12.5px;color:#1e293b;font-weight:600;text-align:right;word-break:break-word;">${value == null || value === '' ? '—' : esc(value)}</span>
    </div>`;
  }

  /* ── Modal ────────────────────────────────────────────────────────
     Built and torn down per open rather than kept hidden in the DOM, so a
     stale value from a previous open can never leak into the next one. ── */

  function openModal({ id, title, subtitle = '', bodyHTML, width = 560, confirmText = 'Save',
                       cancelText = 'Cancel', onConfirm, onOpen, saving = false, hideConfirm = false }) {
    closeModal(id);
    const html = `
      <div id="${id}" style="position:fixed;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);
           z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto;">
        <div id="${id}-box" style="background:#fff;border-radius:18px;box-shadow:0 22px 52px rgba(0,0,0,.16);
             width:100%;max-width:${width}px;overflow:hidden;margin:auto;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:17px 22px;border-bottom:1px solid #f1f5f9;">
            <div>
              <div style="font-size:15px;font-weight:700;color:#0f172a;">${esc(title)}</div>
              ${subtitle ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:2px;">${esc(subtitle)}</div>` : ''}
            </div>
            <button id="${id}-x" style="width:28px;height:28px;border-radius:8px;border:none;background:#f1f5f9;
              color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style="padding:20px 22px;">${bodyHTML}</div>
          <div style="padding:15px 22px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">
            <button id="${id}-cancel" class="btn-secondary">${esc(cancelText)}</button>
            ${hideConfirm ? '' : `<button id="${id}-ok" class="btn-primary" ${saving ? 'disabled' : ''}>${esc(saving ? 'Saving…' : confirmText)}</button>`}
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById(id);
    const close = () => closeModal(id);
    document.getElementById(`${id}-x`)?.addEventListener('click', close);
    document.getElementById(`${id}-cancel`)?.addEventListener('click', close);
    // Clicking the backdrop closes; clicking inside the card must not.
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    if (onConfirm) {
      document.getElementById(`${id}-ok`)?.addEventListener('click', async () => {
        const btn = document.getElementById(`${id}-ok`);
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try { await onConfirm(); }
        catch (e) { fail(e); if (btn) { btn.disabled = false; btn.textContent = confirmText; } }
      });
    }
    if (onOpen) onOpen(root);
    return root;
  }

  function closeModal(id) { document.getElementById(id)?.remove(); }

  const grid = (inner, cols = 2) =>
    `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:13px;">${inner}</div>`;

  const sectionTitle = (t) =>
    `<div style="grid-column:1/-1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
      color:var(--color-primary);margin:6px 0 -2px;padding-top:8px;border-top:1px solid #f1f5f9;">${esc(t)}</div>`;

  const val = (id) => document.getElementById(id)?.value ?? '';
  const spinner = (msg = 'Loading…') =>
    `<div style="display:flex;align-items:center;justify-content:center;min-height:50vh;"><div style="text-align:center;">
      <div style="width:38px;height:38px;border-radius:50%;border:3px solid #f1f5f9;border-top-color:var(--color-primary);
        animation:spin .7s linear infinite;margin:0 auto 13px;"></div>
      <div style="font-size:13px;color:#94a3b8;font-weight:500;">${esc(msg)}</div></div></div>`;

  const empty = (title, hint = '') =>
    `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:52px 24px;text-align:center;">
      <div style="font-size:14px;font-weight:600;color:#475569;">${esc(title)}</div>
      ${hint ? `<div style="font-size:12.5px;color:#94a3b8;margin-top:6px;max-width:420px;margin-left:auto;margin-right:auto;line-height:1.55;">${esc(hint)}</div>` : ''}
    </div>`;

  /* Month / year pickers, used identically by Attendance, Payroll and
     Reports. Years run from 2020 to next year so a new financial year is
     never blocked by a hardcoded list. */
  function monthYearPicker(idPrefix, month, year) {
    const thisYear = new Date().getFullYear();
    const years = [];
    for (let y = thisYear + 1; y >= 2020; y--) years.push(y);
    return select(`${idPrefix}-month`, 'Month', month, MONTHS.map((m, i) => ({ value: i + 1, label: m })))
         + select(`${idPrefix}-year`, 'Year', year, years);
  }

  // Downloads an array of rows as a CSV the browser saves locally. Used by
  // the reports and the bank sheet — nothing leaves the machine.
  function downloadCsv(filename, columns, rows) {
    const cell = (v) => {
      const s = String(v == null ? '' : v).replace(/<[^>]*>/g, '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  }

  return {
    MONTHS, esc, num, inr, inr0, fmtDate, fmtTime, todayISO, isAdmin, isOwner,
    api, post, patch, del, toast, fail,
    header, tabs, stats, table, pill, statusPill, TH, TD,
    field, select, textarea, readout, grid, sectionTitle,
    openModal, closeModal, val, spinner, empty, monthYearPicker, downloadCsv,
    LABEL, CONTROL,
  };
})();
