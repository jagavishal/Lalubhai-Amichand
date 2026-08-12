/* PO Pending — live read-only view of the Stores approval FMS.
 *
 * The PR→PO approval chain lives in the "FMS (Stores)" workbook, not in this
 * app's own DB, so this page is a pure mirror: /api/fms-po-pending does all
 * the reading and step-resolution, and nothing here ever writes back. It
 * re-polls on a timer so a screen left open on the shop floor stays current.
 */
window.Pages['po-pending'] = (() => {

  const POLL_MS = 45000;   // matches the server-side cache TTL — polling
                           // faster would only ever re-serve the same payload.
  const TICK_MS = 1000;

  let _data = null;
  let _loading = false;
  let _error = '';
  let _lastAt = 0;         // ms epoch of the last successful load
  let _poll = null;
  let _tick = null;
  let _onlyPending = true;

  // opts.containerId / opts.embedded let the FMS page (see fms.js) mount this
  // whole module inside its "Stores Approval FMS Report" tab instead of
  // #main-content — same embed contract inward.js/outward.js use for IMS.
  let _opts = {};

  // Bumped on every render(). A timer only keeps running while it belongs to
  // the newest mount: the router (and the FMS tab bar) replace their container
  // outright with no unmount hook, so leaving and re-entering quickly would
  // otherwise leave the previous mount's interval polling forever alongside
  // the new one.
  let _gen = 0;

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const alive = myGen => myGen === _gen && !!document.getElementById('pop-root');

  function stopTimers() {
    if (_poll) { clearInterval(_poll); _poll = null; }
    if (_tick) { clearInterval(_tick); _tick = null; }
  }

  async function load(force) {
    if (_loading) return;
    const myGen = _gen;
    _loading = true;
    paintStatus();
    try {
      const res = await fetch('/api/fms-po-pending' + (force ? '?refresh=1' : ''));
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      _data = json;
      _error = json.stale ? ('Sheet read failed — showing last good data. ' + (json.error || '')) : '';
      _lastAt = Date.now();
    } catch (e) {
      _error = e.message || String(e);
    } finally {
      _loading = false;
      if (alive(myGen)) paint();
    }
  }

  // ── timers ───────────────────────────────────────────────────────────────
  // Neither the router nor the FMS tab bar gives pages an unmount hook, so
  // every tick re-checks that this mount is still the one on screen and tears
  // its own timers down if not. Polling also pauses while the browser tab is
  // hidden — a dashboard left open in the background shouldn't keep spending
  // Sheets read quota.
  function startTimers(myGen) {
    stopTimers();
    _poll = setInterval(() => {
      if (!alive(myGen)) { stopTimers(); return; }
      if (document.hidden) return;
      load(false);
    }, POLL_MS);
    _tick = setInterval(() => {
      if (!alive(myGen)) { stopTimers(); return; }
      paintStatus();
    }, TICK_MS);
  }

  function agoLabel() {
    if (!_lastAt) return '';
    const s = Math.max(0, Math.round((Date.now() - _lastAt) / 1000));
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    return m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago';
  }

  function paintStatus() {
    const el = document.getElementById('pop-status');
    if (!el) return;
    el.innerHTML = _loading
      ? '<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:9px;height:9px;border-radius:50%;border:2px solid var(--border-light);border-top-color:var(--color-primary);display:inline-block;animation:spin .7s linear infinite;"></span>Refreshing…</span>'
      : (_lastAt
        ? `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--color-success);box-shadow:0 0 0 3px rgba(5,150,105,.15);"></span>Live &middot; updated ${esc(agoLabel())}</span>`
        : '');
  }

  // ── pieces ───────────────────────────────────────────────────────────────

  function tiles() {
    const s = _data.summary;
    const bn = s.bottleneck;
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;">
        ${window.UI.statTile({ label: 'PRs Pending', value: s.pending, sub: `${s.tracked} tracked in FMS`, color: 'brand' })}
        ${window.UI.statTile({ label: 'Overdue', value: s.overdue, sub: 'past planned date', color: 'danger' })}
        ${window.UI.statTile({ label: 'Stuck at PO Stage', value: s.atPoSteps, sub: 'Create PO / Issue PO to Vendor', color: 'warning' })}
        ${window.UI.statTile({ label: 'Bottleneck', value: bn ? bn.count : 0, sub: bn ? `${bn.label} — ${bn.owner}` : 'none', color: 'warning' })}
      </div>`;
  }

  function byStepCard() {
    const list = _data.byStep;
    if (!list.length) return '';
    const max = Math.max(...list.map(s => s.count));
    const rows = list.map(s => {
      const pct = Math.round((s.count / max) * 100);
      const isPo = ['S5', 'S6'].includes(s.key);
      const bar = s.overdue > 0 ? 'var(--color-danger)' : 'var(--color-primary)';
      return `
        <div style="display:grid;grid-template-columns:minmax(150px,220px) 1fr auto;align-items:center;gap:12px;">
          <div style="min-width:0;">
            <div style="font-size:12.5px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${isPo ? '<span title="PO stage" style="color:var(--color-warning);margin-right:4px;">&#9679;</span>' : ''}${esc(s.label)}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.owner)}</div>
          </div>
          <div style="height:20px;background:var(--surface-alt);border-radius:5px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${bar};border-radius:5px;transition:width .5s ease;"></div>
          </div>
          <div style="min-width:110px;text-align:right;font-size:11.5px;color:var(--text-secondary);">
            <b style="color:var(--text-primary);font-size:13px;">${s.count}</b> PR${s.count > 1 ? 's' : ''}
            ${s.overdue ? `<span style="color:var(--color-danger);font-weight:600;"> &middot; ${s.overdue} late</span>` : ''}
          </div>
        </div>`;
    }).join('');
    return `
      <div class="card" style="padding:20px;">
        <div style="font-size:13.5px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">Kahan atka hai</div>
        <div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:16px;">Har PR apne pehle adhoore step pe gina gaya hai.</div>
        <div style="display:flex;flex-direction:column;gap:12px;">${rows}</div>
      </div>`;
  }

  function stepTrack(row) {
    return _data.steps.map(st => {
      const s = row.steps.find(x => x.key === st.key) || {};
      const isPending = row.pendingAt && row.pendingAt.key === st.key;
      const isBypassed = row.bypassed.some(b => b.key === st.key);
      const bg = s.done ? 'var(--color-success)'
        : isBypassed ? 'var(--color-danger)'
        : isPending ? 'var(--color-warning)'
        : 'var(--border-light)';
      const ring = isPending ? 'box-shadow:0 0 0 3px var(--color-warning-bg);' : '';
      const state = s.done ? `Done ${s.actual || ''}${s.by ? ' — ' + s.by : ''}`
        : isBypassed ? 'SKIPPED — chain aage badh gayi'
        : isPending ? `Pending${s.planned ? ' — planned ' + s.planned : ''}`
        : 'Not reached';
      return `<span title="${esc(st.key + ': ' + st.label + ' (' + st.owner + ')\n' + state)}"
        style="width:11px;height:11px;border-radius:50%;background:${bg};${ring}display:inline-block;flex-shrink:0;"></span>`;
    }).join('<span style="width:5px;height:1px;background:var(--border-light);flex-shrink:0;"></span>');
  }

  function lateBadge(pendingAt) {
    if (!pendingAt) return window.UI.pill('Complete', { variant: 'success' });
    const d = pendingAt.daysLate;
    if (d == null) return `<span class="pill pill-neutral">no due date</span>`;
    if (d > 0) return `<span class="pill" style="background:var(--color-danger-bg);color:var(--color-danger-text);">${d} din late</span>`;
    if (d === 0) return `<span class="pill" style="background:var(--color-warning-bg);color:var(--color-warning-text);">aaj due</span>`;
    return `<span class="pill" style="background:var(--color-info-bg);color:var(--color-info-text);">${-d} din baaki</span>`;
  }

  function tableCard() {
    let rows = _data.rows.slice();
    if (_onlyPending) rows = rows.filter(r => r.pendingAt);
    // Most overdue first; PRs with no due date sink to the bottom.
    rows.sort((a, b) => {
      const av = a.pendingAt && a.pendingAt.daysLate != null ? a.pendingAt.daysLate : -9999;
      const bv = b.pendingAt && b.pendingAt.daysLate != null ? b.pendingAt.daysLate : -9999;
      return bv - av;
    });

    const th = 'padding:9px 12px;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);white-space:nowrap;';
    const td = 'padding:11px 12px;font-size:12.5px;color:var(--text-primary);vertical-align:middle;';

    const body = rows.map(r => {
      const flags = [
        r.bypassed.length ? `<span class="pill" style="background:var(--color-danger-bg);color:var(--color-danger-text);" title="${esc(r.bypassed.map(b => b.label + ' (' + b.owner + ')').join(', '))}">${r.bypassed.length} step skipped</span>` : '',
        r.poMismatch ? `<span class="pill" style="background:var(--color-purple-bg);color:var(--color-purple-text);" title="PO ${esc(r.erpPoNo)} ERP mein bana hai par FMS ka Create PO step khaali hai">ERP/FMS mismatch</span>` : '',
      ].filter(Boolean).join(' ');

      return `
        <tr class="table-row" style="border-top:1px solid var(--border-light);">
          <td style="${td}">
            <div style="font-weight:700;">${esc(r.prNo)}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${esc(r.raisedOn)}</div>
          </td>
          <td style="${td}">
            <div style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.vendor) || '<span style="color:var(--text-muted);">—</span>'}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${esc(r.department)}${r.requestedBy ? ' &middot; ' + esc(r.requestedBy) : ''}</div>
          </td>
          <td style="${td}">
            <div style="display:flex;align-items:center;gap:0;">${stepTrack(r)}</div>
          </td>
          <td style="${td}">
            ${r.pendingAt
              ? `<div style="font-weight:600;">${esc(r.pendingAt.label)}</div>
                 <div style="font-size:11px;color:var(--text-secondary);">${esc(r.pendingAt.owner)}</div>`
              : '<span style="color:var(--color-success);font-weight:600;">Chain poori</span>'}
          </td>
          <td style="${td};white-space:nowrap;">
            ${r.pendingAt && r.pendingAt.planned ? `<div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:3px;">plan ${esc(r.pendingAt.planned)}</div>` : ''}
            ${lateBadge(r.pendingAt)}
          </td>
          <td style="${td};white-space:nowrap;">
            ${r.erpPoNo ? `<span style="font-weight:600;">${esc(r.erpPoNo)}</span><div style="font-size:11px;color:var(--text-secondary);">${esc(r.erpPoDate)}</div>` : '<span style="color:var(--text-muted);">—</span>'}
          </td>
          <td style="${td}">${flags || '<span style="color:var(--text-muted);">—</span>'}</td>
        </tr>`;
    }).join('');

    return `
      <div class="card" style="padding:0;overflow:hidden;">
        <div style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-size:13.5px;font-weight:700;color:var(--text-primary);">PR-wise status</div>
            <div style="font-size:11.5px;color:var(--text-secondary);">Har dot ek step hai — hover karke detail dekhein.</div>
          </div>
          <label style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
            <input type="checkbox" id="pop-only-pending" ${_onlyPending ? 'checked' : ''} style="cursor:pointer;" />
            Sirf pending dikhao
          </label>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;min-width:960px;">
            <thead style="background:var(--surface-alt);">
              <tr>
                <th style="${th}">PR</th><th style="${th}">Vendor / Dept</th>
                <th style="${th}">Progress (12 steps)</th><th style="${th}">Pending At</th>
                <th style="${th}">Due</th><th style="${th}">ERP PO</th><th style="${th}">Flags</th>
              </tr>
            </thead>
            <tbody>${body || `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px;">Kuch pending nahi hai.</td></tr>`}</tbody>
          </table>
        </div>
        <div style="padding:12px 20px;border-top:1px solid var(--border-light);display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary);">
          <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--color-success);margin-right:5px;"></span>Done</span>
          <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--color-warning);margin-right:5px;"></span>Pending yahin</span>
          <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--color-danger);margin-right:5px;"></span>Skip ho gaya</span>
          <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--border-light);margin-right:5px;"></span>Abhi pahuncha nahi</span>
        </div>
      </div>`;
  }

  function gapsCard() {
    const s = _data.summary;
    if (!s.notInFms && !s.bypassed && !s.mismatched) return '';
    const items = [];
    if (s.notInFms) {
      items.push(`<li style="margin-bottom:6px;"><b>${s.notInFms} PR approval chain mein hai hi nahi</b> — ERP PR Log mein hain par FMS Monitoring mein entry nahi:
        <span style="color:var(--text-secondary);">${esc(_data.notInFms.map(x => x.prNo + (x.poNo ? ' → ' + x.poNo : '')).join(', '))}</span></li>`);
    }
    if (s.mismatched) {
      const m = _data.rows.filter(r => r.poMismatch).map(r => `${r.prNo} → ${r.erpPoNo}`);
      items.push(`<li style="margin-bottom:6px;"><b>${s.mismatched} PO ERP mein bana hai par FMS ka "Create PO" step khaali hai</b>: <span style="color:var(--text-secondary);">${esc(m.join(', '))}</span></li>`);
    }
    if (s.bypassed) {
      const b = _data.rows.filter(r => r.bypassed.length).map(r => `${r.prNo} (${r.bypassed.map(x => x.label).join(', ')})`);
      items.push(`<li><b>${s.bypassed} PR mein step skip hua</b> — baad ke step complete hain par ye khaali: <span style="color:var(--text-secondary);">${esc(b.join('; '))}</span></li>`);
    }
    return `
      <div class="card" style="padding:18px 20px;border-left:3px solid var(--color-warning);">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">Gaps &amp; mismatches</div>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--text-primary);">${items.join('')}</ul>
      </div>`;
  }

  function header() {
    return `
      <div class="card" style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);">PO Pending — Stores Approval FMS</div>
          <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px;">
            Source: FMS (Stores) 2026-2027 &rsaquo; Monitoring &middot; read-only
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span id="pop-status" style="font-size:11.5px;color:var(--text-secondary);"></span>
          <button id="pop-refresh" class="btn-secondary" style="font-size:12px;">Refresh</button>
        </div>
      </div>`;
  }

  function paint() {
    const root = document.getElementById('pop-root');
    if (!root) return;
    if (_error && !_data) {
      root.innerHTML = header() + `
        <div class="card" style="padding:40px;text-align:center;">
          <div style="font-size:13px;color:var(--color-danger-text);font-weight:600;">${esc(_error)}</div>
        </div>`;
    } else if (!_data) {
      root.innerHTML = header();
    } else {
      root.innerHTML = header()
        + (_error ? `<div class="card" style="padding:12px 18px;border-left:3px solid var(--color-warning);font-size:12px;color:var(--color-warning-text);">${esc(_error)}</div>` : '')
        + tiles() + byStepCard() + gapsCard() + tableCard();
    }
    paintStatus();
    bind();
  }

  function bind() {
    const btn = document.getElementById('pop-refresh');
    if (btn) btn.onclick = () => load(true);
    const chk = document.getElementById('pop-only-pending');
    if (chk) chk.onchange = e => { _onlyPending = e.target.checked; paint(); };
  }

  return {
    async render(opts) {
      if (opts) _opts = opts;
      const el = document.getElementById(_opts.containerId || 'main-content');
      if (!el) return;
      const myGen = ++_gen;   // claims the page; any older mount's timers stop
      el.innerHTML = `<div id="pop-root" class="space-y-4 animate-fade-in"></div>`;
      paint();
      startTimers(myGen);
      await load(false);
    },
  };
})();
