window.Pages = window.Pages || {};

// ── CEO Dashboard (route: company-overview) ─────────────────────────────────
// Admin-only rollup: tasks the admins have handed out, meetings, urgent
// payments, leave, and the MIS chart. PO/PR are deliberately not here ("PO, PR
// CEO ke liye jaruri nahi hai"). Data: GET /api/company-overview + GET /api/mis
// (so the MIS chart always matches the MIS Report page). Charts are plain
// inline SVG/HTML — no chart library — with a hover tooltip on every mark.
window.Pages['company-overview'] = (() => {
  const esc = Utils.esc;

  /* ── formatting ──────────────────────────────────────────────────────── */
  const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const inrShort = (n) => {
    n = Number(n) || 0;
    if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' Cr';
    if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' L';
    if (n >= 1e3) return '₹' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return '₹' + Math.round(n);
  };
  const dayMon = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  const monName = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();
  // Clean axis: a 1/2/5×10^k step (never below 1 — counts are whole), and a
  // max that is a whole number of steps, so ticks read 0 / 2 / 4 / 6 / 8.
  const niceScale = (v, target = 4) => {
    if (v <= 0) return { max: target, step: 1 };
    const raw = v / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    const step = Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p);
    return { max: Math.ceil(v / step) * step, step };
  };
  const tipAttr = (lines) => ' data-tip="' + esc(lines.join('\n')) + '"';

  /* ── state ───────────────────────────────────────────────────────────── */
  let _data = null;
  let _error = '';
  let _mis = null;          // { rows, error }
  let _misPeriod = 'month'; // 'week' | 'month'
  let _showAllTeam = false;
  let _leaveReq = null;     // { rows, error } — pending leave requests THIS admin approves

  function _isoOffset(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function _misRange(today) {
    if (_misPeriod === 'week') {
      const dow = new Date(today + 'T00:00:00Z').getUTCDay();
      return { start: _isoOffset(today, -((dow + 6) % 7)), end: today };
    }
    return { start: today.slice(0, 8) + '01', end: today };
  }

  async function _load() {
    _error = '';
    try { _data = await Utils.apiFetch('/api/company-overview'); }
    catch (e) { _error = e.message || 'Failed to load'; }
    _render();
    if (_data) { _loadMis(); _loadLeaveRequests(); }
  }
  async function _loadMis() {
    _mis = null; _render();
    const { start, end } = _misRange(_data.today);
    try {
      const res = await Utils.apiFetch('/api/mis?start=' + start + '&end=' + end + '&type=' + encodeURIComponent('Delegation MIS'));
      _mis = { rows: (res && res.rows) || [] };
    } catch (e) { _mis = { rows: [], error: e.message || 'Failed to load MIS' }; }
    _render();
  }
  // "jo leave jis admin ko approve krni hai vo hi aani chahiye" — reuses the
  // Approvals page's own forApprover=me scoping (backend/hrms.js), so this
  // card only ever shows requests THIS logged-in admin (or their leave
  // substitute) is actually the one to decide — never the whole company's.
  async function _loadLeaveRequests() {
    _leaveReq = null; _render();
    // "vohi leave aani chahiye jo mujhe approve krni hai" — always the
    // logged-in admin's own approval queue (GET /api/hr/leaves's own
    // forApprover=me, the same match the Approvals page already trusts),
    // never a company-wide fallback.
    try {
      const rows = await Utils.apiFetch('/api/hr/leaves?forApprover=me&status=Pending');
      _leaveReq = { rows: Array.isArray(rows) ? rows : [] };
    } catch (e) { _leaveReq = { rows: [], error: e.message || 'Failed to load leave requests' }; }
    _render();
  }

  /* ── icons ───────────────────────────────────────────────────────────── */
  const ICON = {
    tasks: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
    meet: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    pay: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    leave: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/>',
  };
  const icon = (k) => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>';

  /* ── building blocks ─────────────────────────────────────────────────── */
  const card = (title, sub, right, body, extraCls) => `<section class="ceo-card ${extraCls || ''}">
      <header class="ceo-card-h"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${right || ''}</header>${body}</section>`;
  const link = (href, text) => `<a class="ceo-link" href="${href}">${text} →</a>`;
  const empty = (t) => `<div class="ceo-empty">${esc(t)}</div>`;
  const legend = (items) => `<div class="ceo-legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>`;

  function _tile(key, label, value, sub, tone, href) {
    return `<a class="ceo-tile" href="${href}">
      <div class="ceo-tile-ic ceo-tone-${tone}">${icon(key)}</div>
      <div class="ceo-tile-body"><div class="ceo-tile-l">${esc(label)}</div><div class="ceo-tile-v">${value}</div><div class="ceo-tile-s">${sub}</div></div>
    </a>`;
  }

  // Donut: segments [{label, value, color}], 2px surface gap between them.
  function _donut(segs, centerValue, centerLabel) {
    const total = segs.reduce((s, x) => s + x.value, 0);
    const r = 56, C = 2 * Math.PI * r, gap = total && segs.filter(s => s.value).length > 1 ? 3 : 0;
    let off = 0;
    const arcs = total ? segs.filter(s => s.value).map(s => {
      const len = s.value / total * C;
      const arc = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${s.color}" stroke-width="16"
        stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"
        ${tipAttr([s.label + ': ' + s.value, Math.round(s.value / total * 100) + '% of ' + total])} class="ceo-hit"/>`;
      off += len;
      return arc;
    }).join('') : `<circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--ceo-grid)" stroke-width="16"/>`;
    return `<svg viewBox="0 0 140 140" class="ceo-donut" role="img" aria-label="${esc(centerLabel)}">
      ${arcs}
      <text x="70" y="68" text-anchor="middle" class="ceo-donut-v">${centerValue}</text>
      <text x="70" y="86" text-anchor="middle" class="ceo-donut-l">${esc(centerLabel)}</text></svg>`;
  }

  // Column chart. series: [{name, color, values}], one axis only.
  function _columns({ labels, series, fmt, tipLabels, height = 200 }) {
    // Drawn in a 440-unit-wide box: these charts sit in ~400-450px cards, so
    // one SVG unit ≈ one CSS px and the 12px axis text stays 12px on screen.
    const W = 440, H = height, pl = 46, pr = 4, pt = 12, pb = 26;
    const { max, step } = niceScale(Math.max(0, ...series.flatMap(s => s.values)));
    const iw = W - pl - pr, ih = H - pt - pb, n = labels.length;
    const band = iw / n;
    const bw = Math.min(22, (band * 0.72 - (series.length - 1) * 2) / series.length);
    const groupW = bw * series.length + (series.length - 1) * 2;
    const y = (v) => pt + ih - (v / max) * ih;
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    const grid = ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" class="${t ? 'ceo-gridl' : 'ceo-base'}"/>
      <text x="${pl - 6}" y="${y(t) + 3.5}" text-anchor="end" class="ceo-axis">${fmt(t)}</text>`).join('');
    const bars = labels.map((lab, i) => {
      const x0 = pl + band * i + (band - groupW) / 2;
      const cols = series.map((s, j) => {
        const v = s.values[i] || 0, x = x0 + j * (bw + 2), top = y(v), h = pt + ih - top;
        const rr = Math.min(4, h, bw / 2);
        const d = h <= 0 ? '' : `M${x},${pt + ih} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${pt + ih} Z`;
        return d ? `<path d="${d}" fill="${s.color}"/>` : '';
      }).join('');
      const tip = tipAttr([tipLabels ? tipLabels[i] : lab, ...series.map(s => s.name + ': ' + (s.tipFmt || fmt)(s.values[i] || 0))]);
      return `<g>${cols}<rect x="${pl + band * i}" y="${pt}" width="${band}" height="${ih}" fill="transparent" class="ceo-hit"${tip}/>
        <text x="${pl + band * i + band / 2}" y="${H - 8}" text-anchor="middle" class="ceo-axis">${esc(lab)}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="ceo-chart" role="img">${grid}${bars}</svg>`;
  }

  /* ── sections ────────────────────────────────────────────────────────── */
  function _taskStatus(t) {
    const onTime = Math.max(0, t.pending - t.overdue);
    const segs = [
      { label: 'Done', value: t.done, color: 'var(--ceo-good)' },
      { label: 'Pending (on time)', value: onTime, color: 'var(--ceo-warn)' },
      { label: 'Overdue', value: t.overdue, color: 'var(--ceo-crit)' },
    ];
    const pct = t.total ? Math.round(t.done / t.total * 100) : 0;
    const rows = segs.map(s => `<div class="ceo-srow"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${s.value}</b><em>${t.total ? Math.round(s.value / t.total * 100) : 0}%</em></div>`).join('');
    return card('Task status', 'All tasks given by admins', link('#all-tasks', 'All Tasks'),
      `<div class="ceo-donut-wrap">${_donut(segs, pct + '%', 'completed')}<div class="ceo-srows">${rows}
        <div class="ceo-srow ceo-srow-total"><span>Total</span><b>${t.total}</b></div></div></div>`);
  }

  function _team(t) {
    const pending = t.byAssignee.filter(r => r.pending > 0);
    const list = _showAllTeam ? pending : pending.slice(0, 8);
    const body = list.length ? `<div class="ceo-tablewrap"><table class="ceo-table">
      <thead><tr><th>Employee</th><th class="r">Pending</th><th class="r">Overdue</th><th class="r">Revise</th><th>Given By</th></tr></thead>
      <tbody>${list.map(r => `<tr>
          <td><div class="ceo-person"><span class="ceo-av">${esc(initials(r.name))}</span><b>${esc(r.name)}</b></div></td>
          <td class="r num">${r.pending}</td>
          <td class="r num">${r.overdue ? `<span class="ceo-badge ceo-badge-crit">${r.overdue}</span>` : '<span class="ceo-dim">0</span>'}</td>
          <td class="r num">${r.revise ? `<span class="ceo-badge ceo-badge-warn">${r.revise}</span>` : '<span class="ceo-dim">0</span>'}</td>
          <td><small>${esc(r.givenBy.join(', ') || '—')}</small></td>
        </tr>`).join('')}</tbody></table></div>
      ${pending.length > 8 ? `<button class="ceo-more" id="ceo-team-more">${_showAllTeam ? 'Show less' : 'Show all ' + pending.length + ' employees'}</button>` : ''}`
      : empty('Nobody has a pending task from an admin right now.');
    return card('Team tasks', 'Employees with pending tasks — sorted by overdue, then pending', link('#all-tasks', 'All Tasks'), body);
  }

  function _meetings(m, today) {
    const byDay = {};
    for (const x of m.upcoming) (byDay[x.date] = byDay[x.date] || []).push(x);
    const days = Object.keys(byDay).sort();
    const myName = (window.currentUser?.name || '').trim().toLowerCase();
    // Location is free text ("Zoom: https://...", "Board room", a bare link,
    // trailing punctuation from a pasted sentence) — pull a link out of it
    // wherever it sits instead of requiring the whole field to be one.
    const findUrl = (s) => {
      const str = String(s || '');
      let m = str.match(/https?:\/\/[^\s,;'"]+/i);
      if (m) return m[0].replace(/[.,;:)\]]+$/, '');
      m = str.match(/\bwww\.[^\s,;'"]+/i);
      return m ? 'https://' + m[0].replace(/[.,;:)\]]+$/, '') : null;
    };
    const body = days.length ? `<div class="ceo-timeline">${days.map(d => `
        <div class="ceo-tday"><div class="ceo-tday-h">${d === today ? 'Today' : esc(new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }))}</div>
        ${byDay[d].map(x => {
          const attendees = String(x.attendees || '').split(',').map(s => s.trim());
          const amInvited = attendees.some(a => a.toLowerCase() === myName);
          const joinUrl = findUrl(x.location);
          const actions = (joinUrl || amInvited) ? `<div class="ceo-tev-actions">
              ${joinUrl ? `<a href="${esc(joinUrl)}" target="_blank" rel="noopener" class="ceo-mini-btn ceo-mini-btn-primary">Join</a>` : ''}
              ${amInvited ? `<button type="button" class="ceo-mini-btn" data-decline-meeting="${esc(x.id)}">Can't attend</button>` : ''}
            </div>` : '';
          return `<div class="ceo-tev">
            <div class="ceo-tev-t">${esc(x.startTime || '—')}${x.endTime ? '<small>' + esc(x.endTime) + '</small>' : ''}</div>
            <div class="ceo-tev-b"><b>${esc(x.title)}</b><small>${esc([x.organizer ? 'by ' + x.organizer : '', !joinUrl ? x.location : ''].filter(Boolean).join(' · ') || '—')}</small>${actions}</div>
          </div>`;
        }).join('')}</div>`).join('')}</div>`
      : empty('No meetings scheduled in the next 7 days.');
    const right = `<div style="display:flex;align-items:center;gap:10px;">
        <button type="button" id="ceo-add-meeting" class="ceo-mini-btn ceo-mini-btn-primary">+ Add Meeting</button>
        ${link('#scheduler', 'Scheduler')}
      </div>`;
    return card('Meetings', m.today + ' today · ' + m.next7Days + ' in the next 7 days', right, body);
  }

  /* ── Add Meeting modal — same fields/behavior as the Scheduler page's own
     "Schedule a Meeting" modal (checkbox attendees, POST /api/meetings), so a
     CEO doesn't have to leave the dashboard to put something on the calendar. */
  let _meetingUsers = null;

  function _addMinutes(hhmm, mins) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    const total = (h * 60 + m + mins + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  // Same chip-box + type-to-filter combobox as Scheduler's own Add Meeting
  // modal ("Attendees mai type krne ka option bhi aana chahiye") — selection
  // lives as .ceo-chip elements in the DOM, read straight off at submit time.
  function _bindAttendeesCombobox(users) {
    const box = document.getElementById('ceo-mtg-attendees-box');
    const input = document.getElementById('ceo-mtg-attendees-input');
    const dd = document.getElementById('ceo-mtg-attendees-dd');
    const picked = () => new Set([...box.querySelectorAll('.ceo-chip')].map(c => c.dataset.name.toLowerCase()));

    const addChip = (name) => {
      if (picked().has(name.toLowerCase())) return;
      const chip = document.createElement('span');
      chip.className = 'ceo-chip';
      chip.dataset.name = name;
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:var(--ceo-tone-bg);color:var(--ceo-accent);font-size:12px;font-weight:600;padding:3px 6px 3px 10px;border-radius:999px;';
      chip.innerHTML = `${esc(name)}<button type="button" style="border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;">×</button>`;
      chip.querySelector('button').addEventListener('click', () => chip.remove());
      box.insertBefore(chip, input);
    };

    const showMatches = () => {
      const q = input.value.trim().toLowerCase();
      const already = picked();
      const matches = users.filter(u => !already.has(u.name.toLowerCase())
        && (!q || u.name.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q)));
      if (!matches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = matches.map(u => `<div class="ceo-attendee-opt" style="padding:7px 12px;font-size:13px;cursor:pointer;" data-name="${esc(u.name)}">
          <b>${esc(u.name)}</b>${u.department ? ` <span style="color:var(--ceo-muted);">— ${esc(u.department)}</span>` : ''}
        </div>`).join('');
      const r = box.getBoundingClientRect();
      dd.style.top = (r.bottom + 3) + 'px'; dd.style.left = r.left + 'px'; dd.style.width = r.width + 'px';
      dd.style.display = 'block';
    };

    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    box.addEventListener('click', (e) => { if (e.target === box) input.focus(); });
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.ceo-attendee-opt');
      if (!opt) return;
      addChip(opt.dataset.name);
      input.value = '';
      input.focus();
      showMatches();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value) box.querySelector('.ceo-chip:last-of-type')?.remove();
    });
    document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== dd) dd.style.display = 'none'; });
  }

  async function _openAddMeetingModal() {
    document.getElementById('ceo-meeting-modal-overlay')?.remove();
    if (!_meetingUsers) { try { _meetingUsers = await Utils.apiFetch('/api/users?lite=1') || []; } catch { _meetingUsers = []; } }
    const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--ceo-border);border-radius:8px;font-size:13px;color:var(--ceo-ink);background:var(--ceo-surface);outline:none;';
    const labelStyle = 'display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ceo-ink2);margin-bottom:5px;';
    const DURATIONS = [['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hour'], ['90', '1.5 hours'], ['120', '2 hours'], ['', 'Custom']];
    const bodyHTML = `<div class="ceo" style="max-width:none;padding:0;"><div style="display:flex;flex-direction:column;gap:14px;">
        <div><label style="${labelStyle}">Title <span style="color:var(--ceo-crit);">*</span></label>
          <input id="ceo-mtg-title" style="${inputStyle}" placeholder="e.g. Vendor review call" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><label style="${labelStyle}">Date <span style="color:var(--ceo-crit);">*</span></label>
            <input id="ceo-mtg-date" type="date" value="${_data.today}" style="${inputStyle}" /></div>
          <div><label style="${labelStyle}">Duration</label>
            <select id="ceo-mtg-duration" style="${inputStyle}background:var(--ceo-surface);">${DURATIONS.map(([v, l]) => `<option value="${v}"${v === '30' ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label style="${labelStyle}">Start Time</label><input id="ceo-mtg-start" type="time" style="${inputStyle}" /></div>
          <div><label style="${labelStyle}">End Time</label><input id="ceo-mtg-end" type="time" style="${inputStyle}" /></div>
        </div>
        <div><label style="${labelStyle}">Attendees</label>
          <div id="ceo-mtg-attendees-box" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:40px;box-sizing:border-box;padding:5px 8px;border:1.5px solid var(--ceo-border);border-radius:8px;background:var(--ceo-surface);cursor:text;">
            <input id="ceo-mtg-attendees-input" type="text" autocomplete="off" placeholder="Select attendees…" style="flex:1;min-width:120px;border:none;outline:none;font-size:13px;background:transparent;color:var(--ceo-ink);" /></div>
          <div id="ceo-mtg-attendees-dd" style="display:none;position:fixed;z-index:9999;background:var(--ceo-surface);border:1px solid var(--ceo-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;"></div></div>
        <div><label style="${labelStyle}">Agenda <span style="color:var(--ceo-muted);font-weight:400;text-transform:none;">(optional)</span></label>
          <textarea id="ceo-mtg-notes" rows="3" placeholder="What's the meeting about?" style="${inputStyle}resize:none;font-family:inherit;"></textarea></div>
        <div><label style="${labelStyle}">Location / Link <span style="color:var(--ceo-muted);font-weight:400;text-transform:none;">(optional)</span></label>
          <input id="ceo-mtg-location" style="${inputStyle}" placeholder="Meeting room, or a Zoom/Meet link" /></div>
      </div></div>`;
    const footerHTML = `<button type="button" id="ceo-mtg-cancel" class="btn-secondary">Cancel</button>
      <button type="button" id="ceo-mtg-save" class="btn-primary">Schedule Meeting</button>`;
    document.body.insertAdjacentHTML('beforeend', window.UI.modal({
      id: 'ceo-meeting-modal-overlay', title: 'Schedule a Meeting',
      subtitle: 'Only you and whoever you invite will see this on their Scheduler',
      width: 480, closeButtonId: 'ceo-mtg-close', hiddenByDefault: false, bodyHTML, footerHTML,
    }));
    const overlay = document.getElementById('ceo-meeting-modal-overlay');
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('ceo-mtg-close').addEventListener('click', close);
    document.getElementById('ceo-mtg-cancel').addEventListener('click', close);
    document.getElementById('ceo-mtg-title').focus();
    _bindAttendeesCombobox(_meetingUsers);
    const recomputeEnd = () => {
      const mins = parseInt(document.getElementById('ceo-mtg-duration').value, 10);
      const start = document.getElementById('ceo-mtg-start').value;
      if (start && Number.isFinite(mins)) document.getElementById('ceo-mtg-end').value = _addMinutes(start, mins);
    };
    document.getElementById('ceo-mtg-duration').addEventListener('change', recomputeEnd);
    document.getElementById('ceo-mtg-start').addEventListener('change', recomputeEnd);
    document.getElementById('ceo-mtg-save').addEventListener('click', async () => {
      const title = document.getElementById('ceo-mtg-title').value.trim();
      const date = document.getElementById('ceo-mtg-date').value;
      if (!title || !date) { Utils.showToast('Title and date are required', 'error'); return; }
      const attendees = [...document.querySelectorAll('#ceo-mtg-attendees-box .ceo-chip')].map(c => c.dataset.name);
      const btn = document.getElementById('ceo-mtg-save');
      btn.disabled = true; btn.textContent = 'Scheduling…';
      try {
        await Utils.apiFetch('/api/meetings', {
          method: 'POST',
          body: JSON.stringify({
            title, date,
            startTime: document.getElementById('ceo-mtg-start').value,
            endTime: document.getElementById('ceo-mtg-end').value,
            attendees,
            location: document.getElementById('ceo-mtg-location').value.trim(),
            notes: document.getElementById('ceo-mtg-notes').value.trim(),
          }),
        });
        close();
        Utils.showToast('Meeting scheduled', 'success');
        await _load();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Schedule Meeting';
        Utils.showToast(e.message || 'Failed to schedule meeting', 'error');
      }
    });
  }

  function _leave(l) {
    const item = (x, when) => `<div class="ceo-lrow"><span class="ceo-av">${esc(initials(x.name))}</span>
      <div><b>${esc(x.name)}</b><small>${esc(when)}</small></div><span class="ceo-chip">${esc(x.type)}${x.halfDay ? ' · ½' : ''}</span></div>`;
    const today = l.onLeaveToday.length ? l.onLeaveToday.map(x => item(x, x.to && x.to !== x.from ? 'till ' + dayMon(x.to) : 'today')).join('') : empty('Nobody is on leave today.');
    const up = l.upcoming.length ? `<div class="ceo-subh">Coming up this week</div>` + l.upcoming.map(x => item(x, dayMon(x.from) + (x.to !== x.from ? ' – ' + dayMon(x.to) : ''))).join('') : '';
    return card('On leave today', l.onLeaveToday.length + ' out today', link('#hr-leave', 'Leave'), today + up);
  }

  function _leaveRequests() {
    const item = (x) => `<div class="ceo-lrow"><span class="ceo-av">${esc(initials(x.name))}</span>
      <div><b>${esc(x.name)}</b><small>${esc(dayMon(x.from))}${x.to !== x.from ? ' – ' + esc(dayMon(x.to)) : ''}</small></div><span class="ceo-chip">${esc(x.type)}</span></div>`;
    let body, count = '';
    if (!_leaveReq) body = empty('Loading…');
    else if (_leaveReq.error) body = empty('Could not load: ' + _leaveReq.error);
    else {
      const rows = _leaveReq.rows.map(r => ({ name: r.employee_name || r.user_name || '—', type: r.leave_type || r.type || 'Leave', from: r.from_date, to: r.to_date }));
      body = rows.length ? rows.map(item).join('') : empty('No leave requests waiting on your decision.');
      count = rows.length + ' waiting on your decision';
    }
    return card('Leave requests', count, link('#hr-leave', 'Leave'), body);
  }

  function _misChart() {
    const toggle = `<div class="ceo-seg">${[['week', 'This week'], ['month', 'This month']].map(([k, l]) =>
      `<button data-mis-period="${k}" class="${_misPeriod === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let body;
    if (!_mis) body = empty('Loading MIS…');
    else if (_mis.error) body = empty('Could not load MIS: ' + _mis.error);
    else if (!_mis.rows.length) body = empty('No tasks were due in this period.');
    else {
      const rows = _mis.rows.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      body = legend([['var(--ceo-good)', 'Completed'], ['var(--ceo-warn)', 'Pending'], ['var(--ceo-crit)', 'Delayed']])
        + `<div class="ceo-mis">${rows.map(r => {
          const total = r.total || 0, delayed = r.delayed || 0;
          const pending = Math.max(0, (r.pending || 0) - delayed);
          const seg = (v, c) => v ? `<div style="flex:${v};background:${c}"></div>` : '';
          const score = r.score ?? 0;
          const band = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'crit';
          return `<div class="ceo-misrow"${tipAttr([r.name, r.completed + ' completed · ' + pending + ' pending · ' + delayed + ' delayed', 'of ' + total + ' tasks · score ' + score + '%'])}>
            <div class="ceo-misname">${esc(r.name)}</div>
            <div class="ceo-stack">${seg(r.completed, 'var(--ceo-good)')}${seg(pending, 'var(--ceo-warn)')}${seg(delayed, 'var(--ceo-crit)')}</div>
            <div class="ceo-misscore"><span class="ceo-dot ceo-dot-${band}"></span>${score}%</div>
          </div>`;
        }).join('')}</div><p class="ceo-foot">Score = completed% − ½ × delayed%. ${link('#mis', 'Full MIS report')}</p>`;
    }
    return card('Team performance (MIS)', 'Delegation tasks due in the period', toggle, body);
  }

  function _payments(p) {
    const has = p.monthly.some(m => m.approvedAmount);
    const chart = has ? _columns({
      labels: p.monthly.map(m => monName(m.month)),
      tipLabels: p.monthly.map(m => new Date(m.month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })),
      series: [{ name: 'Approved', color: 'var(--ceo-s1)', values: p.monthly.map(m => m.approvedAmount), tipFmt: inr }],
      fmt: inrShort, height: 170,
    }) : empty('No approved urgent payments in the last 6 months.');
    const stat = (label, count, amount, tone) => `<div class="ceo-mini"><div class="ceo-mini-v">${count}</div><div class="ceo-mini-l"><span class="ceo-dot ceo-dot-${tone}"></span>${esc(label)}</div>${amount ? `<div class="ceo-mini-a">${amount}</div>` : ''}</div>`;
    return card('Urgent payments', 'Approved amount by month — last 6 months', link('#approvals', 'Approvals'),
      `<div class="ceo-minis">${stat('Pending', p.pendingCount, inr(p.pendingAmount), 'warn')}${stat('Approved this month', p.approvedMonthCount, inr(p.approvedMonthAmount), 'good')}${stat('Rejected this month', p.rejectedMonthCount, '', 'crit')}</div>
       ${chart}`);
  }

  function _paymentRequests(p) {
    const pill = (s) => {
      const t = s === 'Approved' ? 'good' : s === 'Rejected' ? 'crit' : 'warn';
      return `<span class="ceo-badge ceo-badge-${t}">${esc(s === 'pending' ? 'Pending' : s)}</span>`;
    };
    const body = p.recent.length ? `<div class="ceo-tablewrap"><table class="ceo-table">
      <thead><tr><th>Payee</th><th class="r">Amount</th><th>Status</th></tr></thead>
      <tbody>${p.recent.map(r => `<tr><td><b>${esc(r.payee)}</b><small>${esc(r.requestedBy || '—')} · ${esc(dayMon(r.createdAt))}</small></td>
        <td class="r num">${inr(r.amount)}</td><td>${pill(r.status)}</td></tr>`).join('')}</tbody></table></div>` : empty('No urgent payment requests yet.');
    return card('Latest payment requests', 'Urgent payments, newest first', link('#approvals', 'Approvals'), body);
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  const STYLE = `<style>
    .ceo { --ceo-surface:#ffffff; --ceo-page:transparent; --ceo-ink:#0b0b0b; --ceo-ink2:#52514e; --ceo-muted:#898781;
      --ceo-grid:#e9e8e3; --ceo-base:#c3c2b7; --ceo-border:rgba(11,11,11,.09); --ceo-hover:#f6f6f3;
      --ceo-s1:#2a78d6; --ceo-s2:#eb6834; --ceo-good:#0ca30c; --ceo-warn:#fab219; --ceo-crit:#d03b3b; --ceo-accent:#2a78d6;
      --ceo-tone-bg:#eef4fc; font-family:inherit; color:var(--ceo-ink); max-width:1440px; margin:0 auto; padding:4px 0 40px; }
    :root[data-theme="dark"] .ceo { --ceo-surface:#1a1a19; --ceo-ink:#ffffff; --ceo-ink2:#c3c2b7; --ceo-muted:#898781;
      --ceo-grid:#2c2c2a; --ceo-base:#383835; --ceo-border:rgba(255,255,255,.10); --ceo-hover:#232322;
      --ceo-s1:#3987e5; --ceo-s2:#d95926; --ceo-accent:#3987e5; --ceo-tone-bg:#1f2a38; }
    .ceo-top { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
    .ceo-top h1 { font-size:22px; font-weight:700; letter-spacing:-.02em; margin:0; color:var(--ceo-ink); }
    .ceo-top p { font-size:13px; color:var(--ceo-ink2); margin:4px 0 0; }
    .ceo-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:9px; border:1px solid var(--ceo-border);
      background:var(--ceo-surface); color:var(--ceo-ink); font-size:13px; font-weight:600; cursor:pointer; }
    .ceo-btn:hover { background:var(--ceo-hover); }
    .ceo-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:16px; }
    .ceo-tile { display:flex; gap:12px; align-items:flex-start; padding:16px; border-radius:14px; background:var(--ceo-surface);
      border:1px solid var(--ceo-border); text-decoration:none; color:inherit; transition:transform .12s, box-shadow .12s; }
    .ceo-tile:hover { transform:translateY(-1px); box-shadow:0 6px 18px rgba(0,0,0,.06); }
    .ceo-tile-ic { width:38px; height:38px; border-radius:10px; display:grid; place-items:center; flex-shrink:0; background:var(--ceo-tone-bg); color:var(--ceo-accent); }
    .ceo-tone-crit { color:var(--ceo-crit); } .ceo-tone-warn { color:#b77b00; } .ceo-tone-good { color:var(--ceo-good); }
    .ceo-tile-l { font-size:12px; font-weight:600; color:var(--ceo-ink2); }
    .ceo-tile-v { font-size:28px; font-weight:700; letter-spacing:-.02em; line-height:1.15; margin-top:2px; color:var(--ceo-ink); }
    .ceo-tile-s { font-size:12px; color:var(--ceo-muted); margin-top:2px; }
    .ceo-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; align-items:stretch; }
    .ceo-col { display:flex; flex-direction:column; gap:16px; min-width:0; } .ceo-col > .ceo-card:last-child { flex:1; }
    .ceo-span2 { grid-column:span 2; }
    @media (max-width:1100px) { .ceo-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:720px) { .ceo-grid { grid-template-columns:minmax(0,1fr); } .ceo-span2 { grid-column:auto; } }
    .ceo-card { background:var(--ceo-surface); border:1px solid var(--ceo-border); border-radius:14px; padding:18px; min-width:0; }
    .ceo-card-h { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:14px; }
    .ceo-card-h h2 { font-size:15px; font-weight:700; margin:0; color:var(--ceo-ink); }
    .ceo-card-h p { font-size:12px; color:var(--ceo-muted); margin:3px 0 0; }
    .ceo-link { font-size:12.5px; font-weight:600; color:var(--ceo-accent); text-decoration:none; white-space:nowrap; }
    .ceo-link-warn { color:#b77b00; }
    .ceo-empty { font-size:13px; color:var(--ceo-muted); padding:18px 0; text-align:center; }
    .ceo-legend { display:flex; flex-wrap:wrap; gap:14px; font-size:12px; color:var(--ceo-ink2); margin-bottom:8px; }
    .ceo-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
    .ceo-chart { width:100%; height:auto; display:block; overflow:visible; }
    .ceo-gridl { stroke:var(--ceo-grid); stroke-width:1; } .ceo-base { stroke:var(--ceo-base); stroke-width:1; }
    .ceo-axis { font-size:12px; fill:var(--ceo-muted); font-variant-numeric:tabular-nums; }
    .ceo-hit { cursor:default; } rect.ceo-hit:hover { fill:var(--ceo-ink); fill-opacity:.04; }
    .ceo-donut-wrap { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
    .ceo-donut { width:150px; height:150px; flex-shrink:0; }
    .ceo-donut circle.ceo-hit:hover { stroke-width:19; }
    .ceo-donut-v { font-size:24px; font-weight:700; fill:var(--ceo-ink); }
    .ceo-donut-l { font-size:11px; fill:var(--ceo-muted); }
    .ceo-srows { flex:1; min-width:170px; display:flex; flex-direction:column; gap:9px; }
    .ceo-srow { display:grid; grid-template-columns:12px 1fr auto 40px; gap:8px; align-items:center; font-size:13px; color:var(--ceo-ink2); }
    .ceo-srow i { width:10px; height:10px; border-radius:3px; }
    .ceo-srow b { color:var(--ceo-ink); font-variant-numeric:tabular-nums; } .ceo-srow em { font-style:normal; color:var(--ceo-muted); text-align:right; font-size:12px; }
    .ceo-srow-total { border-top:1px solid var(--ceo-grid); padding-top:9px; grid-template-columns:1fr auto 40px; }
    .ceo-srow-total span { grid-column:1; } .ceo-srow-total b { grid-column:2; }
    .ceo-tablewrap { overflow-x:auto; }
    .ceo-table { width:100%; border-collapse:collapse; font-size:13px; }
    .ceo-table th { font-size:11px; font-weight:600; color:var(--ceo-muted); text-align:left; padding:0 10px 8px; border-bottom:1px solid var(--ceo-grid); white-space:nowrap; }
    .ceo-table td { padding:10px; border-bottom:1px solid var(--ceo-grid); color:var(--ceo-ink); vertical-align:middle; }
    .ceo-table tr:last-child td { border-bottom:none; }
    .ceo-table tbody tr:hover td { background:var(--ceo-hover); }
    .ceo-table .r { text-align:right; } .ceo-table .num { font-variant-numeric:tabular-nums; }
    .ceo-table small, .ceo-person small, .ceo-lrow small, .ceo-tev small { display:block; font-size:11.5px; color:var(--ceo-muted); font-weight:400; }
    .ceo-dim { color:var(--ceo-muted); }
    .ceo-person { display:flex; align-items:center; gap:10px; }
    .ceo-av { width:30px; height:30px; border-radius:50%; display:grid; place-items:center; flex-shrink:0; font-size:11px; font-weight:700;
      background:var(--ceo-tone-bg); color:var(--ceo-accent); }
    .ceo-meter { display:inline-block; width:90px; height:8px; border-radius:4px; background:var(--ceo-grid); overflow:hidden; vertical-align:middle; }
    .ceo-meter div { height:100%; background:var(--ceo-good); border-radius:0 4px 4px 0; }
    .ceo-meter-l { display:inline !important; margin-left:8px; font-variant-numeric:tabular-nums; }
    .ceo-badge { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11.5px; font-weight:600; }
    .ceo-badge-crit { background:rgba(208,59,59,.12); color:#b42f2f; } .ceo-badge-good { background:rgba(12,163,12,.12); color:#0a7a0a; }
    .ceo-badge-warn { background:rgba(250,178,25,.18); color:#8a5d00; }
    :root[data-theme="dark"] .ceo-badge-crit { color:#f08a8a; } :root[data-theme="dark"] .ceo-badge-good { color:#5fd35f; } :root[data-theme="dark"] .ceo-badge-warn { color:#f7c75a; }
    .ceo-more { margin-top:10px; border:none; background:transparent; color:var(--ceo-accent); font-size:12.5px; font-weight:600; cursor:pointer; padding:0; }
    .ceo-timeline { display:flex; flex-direction:column; gap:12px; }
    .ceo-tday-h { font-size:11.5px; font-weight:700; color:var(--ceo-ink2); text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }
    .ceo-tev { display:flex; gap:12px; padding:8px 10px; border-radius:10px; border-left:3px solid var(--ceo-s1); background:var(--ceo-hover); margin-bottom:6px; }
    .ceo-tev-t { width:52px; flex-shrink:0; font-size:12.5px; font-weight:700; color:var(--ceo-ink); font-variant-numeric:tabular-nums; }
    .ceo-tev-b { min-width:0; font-size:13px; } .ceo-tev-b b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ceo-tev-actions { display:flex; gap:6px; margin-top:6px; }
    .ceo-mini-btn { display:inline-flex; align-items:center; border:1px solid var(--ceo-border); background:var(--ceo-surface); color:var(--ceo-ink2);
      font-size:11.5px; font-weight:600; padding:3px 10px; border-radius:7px; cursor:pointer; text-decoration:none; }
    .ceo-mini-btn:hover { background:var(--ceo-hover); }
    .ceo-mini-btn-primary { background:var(--ceo-accent); border-color:var(--ceo-accent); color:#fff; }
    .ceo-mini-btn-primary:hover { filter:brightness(1.08); background:var(--ceo-accent); }
    .ceo-mini-btn[disabled] { opacity:.6; cursor:default; }
    .ceo-lrow { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--ceo-grid); font-size:13px; }
    .ceo-lrow:last-child { border-bottom:none; } .ceo-lrow > div { flex:1; min-width:0; }
    .ceo-chip { font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:999px; background:var(--ceo-tone-bg); color:var(--ceo-accent); white-space:nowrap; }
    .ceo-subh { font-size:11.5px; font-weight:700; color:var(--ceo-ink2); text-transform:uppercase; letter-spacing:.05em; margin:14px 0 6px; }
    .ceo-seg { display:inline-flex; border:1px solid var(--ceo-border); border-radius:9px; overflow:hidden; }
    .ceo-seg button { border:none; background:transparent; padding:5px 11px; font-size:12px; font-weight:600; color:var(--ceo-ink2); cursor:pointer; }
    .ceo-seg button.on { background:var(--ceo-accent); color:#fff; }
    .ceo-mis { display:flex; flex-direction:column; gap:10px; margin-top:4px; }
    .ceo-misrow { display:grid; grid-template-columns:minmax(90px,150px) 1fr 58px; gap:10px; align-items:center; }
    .ceo-misname { font-size:12.5px; font-weight:600; color:var(--ceo-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ceo-stack { display:flex; gap:2px; height:14px; border-radius:0 4px 4px 0; overflow:hidden; }
    .ceo-misrow:hover .ceo-stack { filter:brightness(1.06); }
    .ceo-misscore { font-size:12.5px; font-weight:700; text-align:right; font-variant-numeric:tabular-nums; color:var(--ceo-ink); }
    .ceo-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:0; }
    .ceo-dot-good { background:var(--ceo-good); } .ceo-dot-warn { background:var(--ceo-warn); } .ceo-dot-crit { background:var(--ceo-crit); }
    .ceo-foot { font-size:11.5px; color:var(--ceo-muted); margin:12px 0 0; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    .ceo-minis { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-bottom:14px; }
    .ceo-mini { background:var(--ceo-hover); border-radius:10px; padding:10px 12px; }
    .ceo-mini-v { font-size:20px; font-weight:700; color:var(--ceo-ink); }
    .ceo-mini-l { font-size:11.5px; color:var(--ceo-ink2); } .ceo-mini-a { font-size:12.5px; font-weight:600; color:var(--ceo-ink); margin-top:2px; font-variant-numeric:tabular-nums; }
    .ceo-tip { position:fixed; z-index:9999; pointer-events:none; background:#0b0b0b; color:#fff; font-size:12px; line-height:1.45;
      padding:7px 10px; border-radius:8px; white-space:pre; box-shadow:0 6px 18px rgba(0,0,0,.18); display:none; }
    .ceo-tip b { font-weight:700; }
    .ceo-updated { font-size:11.5px; color:var(--ceo-muted); text-align:right; margin-top:14px; }
  </style>`;

  function _render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const hour = new Date().getHours();
    const hello = (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening') + (window.currentUser?.name ? ', ' + window.currentUser.name.split(' ')[0] : '');

    let body;
    if (_error) {
      body = `<div class="ceo-card" style="color:var(--ceo-crit);">Could not load: ${esc(_error)} <button id="co-retry" class="ceo-btn" style="margin-left:8px;">Retry</button></div>`;
    } else if (!_data) {
      body = `<div class="ceo-empty" style="padding:80px 0;">Loading dashboard…</div>`;
    } else {
      const d = _data, t = d.tasks.totals;
      body = `<div class="ceo-tiles">
          ${_tile('tasks', 'Open tasks', t.pending, t.total + ' given by admins', 'accent', '#all-tasks')}
          ${_tile('alert', 'Overdue', t.overdue, 'past due, not done', t.overdue ? 'crit' : 'good', '#all-tasks')}
          ${_tile('meet', 'Meetings today', d.meetings.today, d.meetings.next7Days + ' in the next 7 days', 'accent', '#scheduler')}
          ${_tile('pay', 'Payments pending', d.payments.pendingCount, inr(d.payments.pendingAmount) + ' awaiting approval', d.payments.pendingCount ? 'warn' : 'good', '#approvals')}
          ${_tile('leave', 'On leave today', d.leave.onLeaveToday.length, d.leave.pendingRequests + ' leave request' + (d.leave.pendingRequests === 1 ? '' : 's') + ' pending', 'accent', '#hr-leave')}
        </div>
        <div class="ceo-grid">
          ${_leave(d.leave)}
          ${_leaveRequests()}
          ${_meetings(d.meetings, d.today)}
          ${_team(d.tasks)}
          ${_taskStatus(t)}
          ${_misChart()}
          ${_paymentRequests(d.payments)}
          ${_payments(d.payments)}
        </div>
        <div class="ceo-updated">Updated ${new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>`;
    }

    el.innerHTML = STYLE + `<div class="ceo">
      <div class="ceo-top"><div><h1>${esc(hello)}</h1><p>CEO Dashboard · ${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p></div>
        <button id="co-refresh" class="ceo-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>Refresh</button></div>
      ${body}<div class="ceo-tip" id="ceo-tip"></div></div>`;

    const root = el.querySelector('.ceo');
    document.getElementById('co-refresh')?.addEventListener('click', _load);
    document.getElementById('ceo-add-meeting')?.addEventListener('click', _openAddMeetingModal);
    document.getElementById('co-retry')?.addEventListener('click', _load);
    document.getElementById('ceo-team-more')?.addEventListener('click', () => { _showAllTeam = !_showAllTeam; _render(); });
    root.querySelectorAll('[data-mis-period]').forEach(b => b.addEventListener('click', () => {
      if (_misPeriod === b.dataset.misPeriod) return;
      _misPeriod = b.dataset.misPeriod;
      _loadMis();
    }));
    root.querySelectorAll('[data-decline-meeting]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.declineMeeting;
      if (!(await Utils.showConfirm('You\'ll be taken off the attendee list for this meeting.', { title: 'Decline meeting', confirmText: 'Decline', danger: true }))) return;
      b.disabled = true; b.textContent = '…';
      try {
        await Utils.apiFetch('/api/meetings/decline?id=' + encodeURIComponent(id), { method: 'PATCH' });
        await _load();
      } catch (e) {
        Utils.showToast(e.message || 'Failed to decline', 'error');
        b.disabled = false; b.textContent = "Can't attend";
      }
    }));

    // One tooltip for every mark carrying data-tip; first line bold.
    const tip = document.getElementById('ceo-tip');
    root.addEventListener('mousemove', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tip.style.display = 'none'; return; }
      const lines = t.getAttribute('data-tip').split('\n');
      tip.innerHTML = '<b>' + esc(lines[0]) + '</b>' + (lines.length > 1 ? '\n' + lines.slice(1).map(esc).join('\n') : '');
      tip.style.display = 'block';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    root.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  function render() {
    _render();
    _load();
  }

  return { render };
})();
