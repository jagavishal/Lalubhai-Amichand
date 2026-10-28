window.Pages = window.Pages || {};

/* Scheduler — one calendar for the date-bound things people already track
   elsewhere in the app: holidays and approved leaves (HR), tasks (All Tasks /
   delegations), birthdays (Employee Master), and meetings (the only thing
   this page itself creates). It reads them all from one call, GET
   /api/scheduler.

   Laid out as a month grid with a Day panel beside it: pick a day and the
   panel shows its hours (click an empty slot to schedule at that time), the
   picked meeting's details with Join / Copy invite / Cancel, and the tasks
   due that day. */
window.Pages.scheduler = (() => {
  const esc = Utils.esc;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MON = MONTH_NAMES.map(m => m.slice(0, 3));
  const HOUR_PX = 44;              // height of one hour on the Day panel's timeline
  const SCROLL_TO_HOUR = 8;        // the timeline opens at 8 AM unless something is earlier
  const KINDS = ['meeting', 'task', 'holiday', 'leave', 'birthday'];
  const KIND_LABEL = { meeting: 'Meetings', task: 'Tasks', holiday: 'Holidays', leave: 'Leaves', birthday: 'Birthdays' };
  const KIND_COLOUR = { meeting: 'var(--color-purple)', task: 'var(--color-warning)', holiday: 'var(--color-danger)', leave: 'var(--color-success)', birthday: 'var(--color-info)' };

  const _store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const _isPhone = () => window.matchMedia('(max-width: 900px)').matches;

  let _anchor = _startOfDay(new Date());   // any day of the month on show
  let _sel = _dateStr(_anchor);             // the day in the Day panel
  let _selEv = null;                        // "<kind>:<date>:<index>" shown in the panel's details
  let _hidden = new Set(String(_store.get('sch-hidden') || '').split(',').filter(k => KINDS.includes(k)));
  let _data = { weekOffs: ['0'], holidays: [], tasks: [], meetings: [], leaves: [], birthdays: [] };
  let _byDate = new Map();         // date -> { holiday, tasks:[], meetings:[], leaves:[], birthdays:[] }
  let _users = null;                // lazy-loaded for the attendee picker
  let _nowTimer = null;

  function _startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function _addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function _todayStr() { return _dateStr(new Date()); }
  function _dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // The 42-cell grid: the Sunday on/before the 1st through 6 full weeks.
  function _gridDays(view) {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = _addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => _addDays(start, i));
  }
  function _fmtTime(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h)) return hhmm;
    const ap = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
  }
  function _fmtLongDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${DOW_LONG[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  }
  function _toMins(hhmm) {
    if (!hhmm) return null;
    const [h, m] = String(hhmm).split(':').map(Number);
    return Number.isNaN(h) ? null : h * 60 + (m || 0);
  }

  function _isAdmin() {
    const r = window.currentUser?.roles || [];
    const arr = Array.isArray(r) ? r : String(r).split(',');
    return arr.some(x => x.trim() === 'Admin' || x.trim() === 'HOD');
  }
  const _canManage = (m) => { const me = window.currentUser; return !!me && (_isAdmin() || m.createdBy === me.id); };
  const _isAttendee = (m) => {
    const me = String(window.currentUser?.name || '').trim().toLowerCase();
    return !!me && String(m.attendees || '').split(',').some(n => n.trim().toLowerCase() === me);
  };

  /* ── Data loading ─────────────────────────────────────────────────── */
  async function loadData() {
    const days = _gridDays(_anchor);
    const from = _dateStr(days[0]);
    const to = _dateStr(days[days.length - 1]);
    try {
      const res = await Utils.apiFetch(`/api/scheduler?from=${from}&to=${to}`);
      _data = res || { weekOffs: ['0'], holidays: [], tasks: [], meetings: [], leaves: [], birthdays: [] };
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load scheduler', 'error');
      _data = { weekOffs: ['0'], holidays: [], tasks: [], meetings: [], leaves: [], birthdays: [] };
    }
    _reindex();
  }

  function _reindex() {
    _byDate = new Map();
    const bucket = (date) => {
      if (!_byDate.has(date)) _byDate.set(date, { holiday: null, tasks: [], meetings: [], leaves: [], birthdays: [] });
      return _byDate.get(date);
    };
    for (const h of _data.holidays || []) bucket(h.date).holiday = h;
    for (const t of _data.tasks || []) if (t.dueDate) bucket(t.dueDate).tasks.push(t);
    for (const m of _data.meetings || []) bucket(m.date).meetings.push(m);
    // A leave spans days: it sits on each one it covers (as in the office's
    // Google Calendar "Employee Leaves"), one chip per person per day.
    for (const l of _data.leaves || []) {
      for (let d = new Date(l.fromDate + 'T00:00:00'), end = new Date(l.toDate + 'T00:00:00'); d <= end; d = _addDays(d, 1)) bucket(_dateStr(d)).leaves.push(l);
    }
    for (const b of _data.birthdays || []) bucket(b.date).birthdays.push(b);
    for (const b of _byDate.values()) b.meetings.sort((a, c) => String(a.startTime || '').localeCompare(String(c.startTime || '')));
  }

  // One day's entries after the show/hide toggles.
  function _infoFor(dateStr) {
    const info = _byDate.get(dateStr) || { holiday: null, tasks: [], meetings: [], leaves: [], birthdays: [] };
    return {
      holiday: _hidden.has('holiday') ? null : info.holiday,
      tasks: _hidden.has('task') ? [] : info.tasks,
      meetings: _hidden.has('meeting') ? [] : info.meetings,
      leaves: _hidden.has('leave') ? [] : (info.leaves || []),
      birthdays: _hidden.has('birthday') ? [] : (info.birthdays || []),
    };
  }

  function _isWeekOff(d) {
    return (_data.weekOffs || []).includes(String(d.getDay()));
  }

  /* ── Event chips ──────────────────────────────────────────────────── */
  // data-ev = "<kind>:<date>:<index>" — resolved back to the entry on click.
  function _chipHTML(kind, dateStr, i, label, opts = {}) {
    const tone = kind === 'meeting'
      ? 'background:var(--color-purple-bg);color:var(--color-purple-text);border-left:3px solid var(--color-purple);'
      : kind === 'holiday'
      ? 'background:var(--color-danger-bg);color:var(--color-danger-text);border-left:3px solid var(--color-danger);'
      : kind === 'leave'
      ? 'background:var(--color-success-bg);color:var(--color-success-text);border-left:3px solid var(--color-success);'
      : kind === 'birthday'
      ? 'background:var(--color-info-bg);color:var(--color-info-text);border-left:3px solid var(--color-info);'
      : opts.muted
      ? 'background:var(--surface-alt);color:var(--text-muted);border-left:3px solid var(--border-strong);'
      : 'background:var(--color-warning-bg);color:var(--color-warning-text);border-left:3px solid var(--color-warning);';
    const on = _selEv === `${kind}:${dateStr}:${i}` ? ' sch-on' : '';
    return `<button type="button" class="sch-chip-ev${on}" data-ev="${kind}:${dateStr}:${i}" title="${esc(label)}"
        style="${tone}${opts.done ? 'text-decoration:line-through;' : ''}">${opts.time ? `<b>${esc(opts.time)}</b> ` : ''}${esc(label)}</button>`;
  }

  function _leaveLabel(l) {
    return `${l.name || 'Leave'} [${l.leaveType || 'Leave'}${l.halfDay && l.halfDay !== 'full' ? ' ½' : ''}]`;
  }

  // Meetings first (they are what the day is planned around), then the rest.
  function _dayChips(dateStr, info) {
    const out = [];
    info.meetings.forEach((m, i) => out.push(_chipHTML('meeting', dateStr, i, m.title, { time: m.startTime ? _fmtTime(m.startTime) : '' })));
    if (info.holiday) out.push(_chipHTML('holiday', dateStr, 0, info.holiday.name));
    info.birthdays.forEach((b, i) => out.push(_chipHTML('birthday', dateStr, i, '🎂 ' + b.name)));
    info.leaves.forEach((l, i) => out.push(_chipHTML('leave', dateStr, i, _leaveLabel(l))));
    info.tasks.forEach((t, i) => out.push(_chipHTML('task', dateStr, i, t.description, { done: t.status === 'done', muted: t.status === 'done' || t.status === 'leave' })));
    return out;
  }

  /* ── Month grid ───────────────────────────────────────────────────── */
  function _monthHTML() {
    const days = _gridDays(_anchor);
    const today = _todayStr();
    const header = DOW.map(d => `<div class="sch-dow">${d}</div>`).join('');
    const cells = days.map(d => {
      const ds = _dateStr(d);
      const info = _infoFor(ds);
      const raw = _byDate.get(ds);
      const off = !raw?.holiday && _isWeekOff(d);
      const chips = _dayChips(ds, info);
      const shown = chips.slice(0, 3);
      const more = chips.length - shown.length;
      const moreTasks = info.tasks.length && shown.length < chips.length
        ? chips.slice(3).filter(c => c.includes('data-ev="task:')).length : 0;
      const moreLabel = moreTasks === more ? `+ ${more} task${more > 1 ? 's' : ''}` : `+ ${more} more`;
      return `
        <div class="sch-mcell${d.getMonth() !== _anchor.getMonth() ? ' sch-out' : ''}${off ? ' sch-off' : ''}${ds === _sel ? ' sch-sel' : ''}" data-date="${ds}">
          <div class="sch-mhead">
            <span class="sch-daynum${ds === today ? ' sch-today' : ''}">${d.getDate() === 1 ? MON[d.getMonth()] + ' ' : ''}${d.getDate()}</span>
            ${off ? '<span class="sch-offtag">Off</span>' : raw?.holiday && !_hidden.has('holiday') ? '<span class="sch-offtag">Holiday</span>' : ''}
          </div>
          <div class="sch-mitems">${shown.join('')}${more > 0 ? `<span class="sch-more">${moreLabel}</span>` : ''}</div>
          <div class="sch-mdots">${chips.length ? chips.slice(0, 4).map(c => `<i class="${/data-ev="(\w+)/.exec(c)[1]}"></i>`).join('') : ''}</div>
        </div>`;
    }).join('');
    return `
      <div class="sch-month">
        <div class="sch-mgrid-head">${header}</div>
        <div class="sch-mgrid">${cells}</div>
      </div>`;
  }

  /* ── Day panel ────────────────────────────────────────────────────── */
  // Overlapping meetings share the timeline side by side: each cluster of
  // mutually overlapping meetings is split into as many lanes as it needs.
  function _layoutTimed(list) {
    const items = list.map((m, i) => {
      const s = _toMins(m.startTime);
      let e = _toMins(m.endTime);
      if (e === null || e <= s) e = s + 30;
      return { m, i, s, e: Math.min(e, 24 * 60) };
    }).sort((a, b) => a.s - b.s || b.e - a.e);
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      const lanes = [];
      for (const it of cluster) {
        let lane = lanes.findIndex(end => end <= it.s);
        if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = it.e; it.lane = lane;
      }
      for (const it of cluster) it.lanes = lanes.length;
      cluster = [];
    };
    for (const it of items) {
      if (it.s >= clusterEnd && cluster.length) flush();
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.e);
    }
    if (cluster.length) flush();
    return items;
  }

  function _nowTop() {
    const n = new Date();
    return ((n.getHours() * 60 + n.getMinutes()) / 60) * HOUR_PX;
  }

  // The panel's details default to the day's first meeting.
  function _currentEv() {
    if (_selEv && _selEv.split(':')[1] === _sel) return _selEv;
    const info = _infoFor(_sel);
    return info.meetings.length ? `meeting:${_sel}:0` : null;
  }

  function _sideHTML() {
    const ds = _sel;
    const d = new Date(ds + 'T00:00:00');
    const info = _infoFor(ds);
    const raw = _byDate.get(ds);
    const today = _todayStr();

    // All-day strip: holiday, birthdays, leaves, meetings with no start time.
    const allDay = [];
    if (info.holiday) allDay.push(_chipHTML('holiday', ds, 0, info.holiday.name));
    else if (_isWeekOff(d) && !raw?.holiday) allDay.push('<span class="sch-offtag">Week off</span>');
    info.birthdays.forEach((b, i) => allDay.push(_chipHTML('birthday', ds, i, '🎂 ' + b.name)));
    info.leaves.forEach((l, i) => allDay.push(_chipHTML('leave', ds, i, _leaveLabel(l))));
    info.meetings.forEach((m, i) => { if (_toMins(m.startTime) === null) allDay.push(_chipHTML('meeting', ds, i, m.title)); });

    const hours = Array.from({ length: 24 }, (_, h) =>
      `<div class="sch-hour" style="top:${h * HOUR_PX}px;">${h ? _fmtTime(String(h).padStart(2, '0') + ':00') : ''}</div>`).join('');
    const cur = _currentEv();
    const timed = _layoutTimed(info.meetings.map((m, i) => ({ ...m, _i: i })).filter(m => _toMins(m.startTime) !== null));
    const blocks = timed.map(it => {
      const top = (it.s / 60) * HOUR_PX;
      const h = Math.max(((it.e - it.s) / 60) * HOUR_PX - 2, 20);
      const w = 100 / it.lanes;
      const ref = `meeting:${ds}:${it.m._i}`;
      // Under ~45 minutes there is room for one line only: title, no times.
      return `<button type="button" class="sch-block${ref === cur ? ' sch-on' : ''}${h < 32 ? ' sch-short' : ''}" data-ev="${ref}"
          style="top:${top}px;height:${h}px;left:calc(${it.lane * w}% + 2px);width:calc(${w}% - 4px);">
          <b>${esc(_fmtTime(it.m.startTime))} ${esc(it.m.title)}</b>
          <span>${_fmtTime(it.m.startTime)}${it.m.endTime ? ' – ' + _fmtTime(it.m.endTime) : ''}</span>
        </button>`;
    }).join('');
    const now = ds === today ? `<div class="sch-now" data-now style="top:${_nowTop()}px;"></div>` : '';

    const tasks = info.tasks.map((t, i) => {
      const ref = `task:${ds}:${i}`;
      const status = t.status === 'done' ? 'Done' : t.status === 'leave' ? 'On leave' : 'Pending';
      return `<button type="button" class="sch-task${ref === cur ? ' sch-on' : ''}" data-ev="${ref}">
          <i class="${t.status === 'done' ? 'done' : t.status === 'leave' ? 'leave' : ''}"></i>
          <span><b${t.status === 'done' ? ' style="text-decoration:line-through;opacity:.7;"' : ''}>${esc(t.description || '')}</b>
          <small>${esc([t.doer, status, t.priority].filter(Boolean).join(' · '))}</small></span>
        </button>`;
    }).join('');

    return `
      <div class="sch-side-head">
        <div><b>Day</b> <span>${esc(_fmtLongDate(ds))}</span></div>
        <button type="button" class="sch-icon-btn" data-act="new" title="Schedule on this day" aria-label="Schedule on this day">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></button>
      </div>
      ${allDay.length ? `<div class="sch-allday">${allDay.join('')}</div>` : ''}
      <div class="sch-tscroll" id="sch-tscroll">
        <div class="sch-tbody" style="height:${24 * HOUR_PX}px;">
          <div class="sch-gutter">${hours}</div>
          <div class="sch-col${raw?.holiday || _isWeekOff(d) ? ' sch-off' : ''}" data-date="${ds}">${blocks}${now}</div>
        </div>
      </div>
      <div class="sch-detail">${cur ? _detailHTML(cur) : '<div class="sch-hint">Click a meeting or task to see its details. Click an empty time to schedule one.</div>'}</div>
      ${_hidden.has('task') ? '' : `<div class="sch-sec">Tasks due${info.tasks.length ? ` <span>${info.tasks.length}</span>` : ''}</div>
      <div class="sch-tasks">${tasks || '<div class="sch-hint" style="text-align:center;padding:18px 8px;">No tasks due on this date</div>'}</div>`}`;
  }

  /* ── Details of the picked entry (inside the Day panel) ───────────── */
  const ICON = {
    pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    people: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
    note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    flag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>',
  };
  const _row = (icon, html) => html ? `<div class="sch-pop-row">${ICON[icon]}<div>${html}</div></div>` : '';

  function _entry(ref) {
    const [kind, ds, idx] = ref.split(':');
    const info = _byDate.get(ds) || { holiday: null, tasks: [], meetings: [], leaves: [], birthdays: [] };
    const list = { meeting: info.meetings, task: info.tasks, leave: info.leaves || [], birthday: info.birthdays || [] }[kind];
    return { kind, ds, item: kind === 'holiday' ? info.holiday : (list || [])[Number(idx)] };
  }

  function _detailHTML(ref) {
    const { kind, ds, item } = _entry(ref);
    if (!item) return '';
    let title, when = _fmtLongDate(ds), body = '', actions = '';
    if (kind === 'meeting') {
      const m = item;
      title = m.title;
      if (m.startTime) when = `${_fmtTime(m.startTime)}${m.endTime ? ' – ' + _fmtTime(m.endTime) : ''} · ${when}`;
      const isLink = /^https?:\/\//i.test(m.location || '');
      if (isLink) actions += `<a href="${esc(m.location)}" target="_blank" rel="noopener" class="btn-primary sch-act">Join</a>`;
      actions += `<button type="button" class="btn-secondary sch-act" data-act="copy" data-ref="${esc(ref)}">Copy invite</button>`;
      const me = window.currentUser;
      if (_canManage(m)) actions += `<button type="button" class="btn-secondary sch-act" data-act="cancel" data-id="${esc(m.id)}" style="color:var(--color-danger-text);">Cancel</button>`;
      else if (_isAttendee(m) && m.createdBy !== me?.id) actions += `<button type="button" class="btn-secondary sch-act" data-act="decline" data-id="${esc(m.id)}">Decline</button>`;
      body = (isLink ? '' : _row('pin', esc(m.location || '')))
        + _row('people', `Team: ${m.attendees ? esc(m.attendees) : '—'}`)
        + _row('note', m.notes ? esc(m.notes) : '')
        + _row('user', m.createdByName ? `Organised by ${esc(m.createdByName)}` : '');
    } else if (kind === 'task') {
      const t = item;
      title = t.description;
      when = 'Due ' + when;
      const status = t.status === 'done' ? 'Done' : t.status === 'leave' ? 'On leave' : 'Pending';
      body = _row('user', esc(t.doer || ''))
        + _row('flag', esc([status, t.priority].filter(Boolean).join(' · ')))
        + _row('note', 'Open <b>All Tasks</b> to update it.');
    } else if (kind === 'leave') {
      const l = item;
      title = `${l.name || 'Employee'} — on leave`;
      when = l.fromDate === l.toDate ? _fmtLongDate(l.fromDate) : `${_fmtLongDate(l.fromDate)} – ${_fmtLongDate(l.toDate)}`;
      body = _row('flag', esc([l.leaveType, l.halfDay && l.halfDay !== 'full' ? l.halfDay + ' half' : ''].filter(Boolean).join(' · ')))
        + _row('note', 'Approved leave — from HR → Leave Management.');
    } else if (kind === 'birthday') {
      title = `🎂 ${item.name}'s birthday`;
      body = _row('note', 'From the Employee Master.');
    } else {
      title = item.name;
      body = _row('note', 'Company holiday — from HR → Leave Management.');
    }
    return `
      <div class="sch-detail-top">
        <div style="min-width:0;">
          <h3><i style="background:${KIND_COLOUR[kind]};"></i><span>${esc(title)}</span></h3>
          <div class="sch-pop-when">${esc(when)}</div>
        </div>
        ${actions ? `<div class="sch-detail-acts">${actions}</div>` : ''}
      </div>
      ${body}`;
  }

  // Plain-text invite for WhatsApp / mail: title, when, link, agenda.
  function _inviteText(m) {
    return [
      m.title,
      `${_fmtLongDate(m.date)}${m.startTime ? ' · ' + _fmtTime(m.startTime) + (m.endTime ? ' – ' + _fmtTime(m.endTime) : '') : ''}`,
      /^https?:\/\//i.test(m.location || '') ? `Join: ${m.location}` : (m.location ? `Where: ${m.location}` : ''),
      m.notes ? `Agenda: ${m.notes}` : '',
    ].filter(Boolean).join('\n');
  }
  async function _copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  function _titleText() {
    return `${MONTH_NAMES[_anchor.getMonth()]} ${_anchor.getFullYear()}`;
  }

  /* ── Page shell ───────────────────────────────────────────────────── */
  const CSS = `
    .sch-wrap { display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:16px; align-items:start; }
    .sch-main, .sch-side { background:var(--surface); border:1px solid var(--border-light); border-radius:12px; box-shadow:var(--shadow-xs); overflow:hidden; }
    .sch-side { position:sticky; top:8px; display:flex; flex-direction:column; max-height:calc(100vh - 120px); }
    .sch-toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
    .sch-toolbar-left { display:flex; align-items:center; gap:8px; min-width:0; }
    .sch-icon-btn { width:30px; height:30px; border-radius:8px; border:1.5px solid var(--border-base); background:var(--surface); color:var(--text-secondary);
      cursor:pointer; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
    .sch-icon-btn:hover { background:var(--surface-alt); }
    #sch-title-label { font-size:18px; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-left:4px; }
    .sch-legend { display:flex; gap:6px; flex-wrap:wrap; }
    .sch-legend button { display:inline-flex; align-items:center; gap:6px; border:1.5px solid var(--border-base); background:var(--surface); border-radius:999px;
      padding:4px 10px; font:inherit; font-size:12px; font-weight:600; color:var(--text-secondary); cursor:pointer; }
    .sch-legend button i { width:9px; height:9px; border-radius:50%; }
    .sch-legend button.off { opacity:.45; text-decoration:line-through; }

    .sch-chip-ev { display:block; width:100%; text-align:left; border:none; border-radius:4px; padding:2px 6px; font:inherit; font-size:11.5px;
      font-weight:500; line-height:1.35; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-sizing:border-box; }
    .sch-chip-ev:hover { filter:brightness(.96); }
    .sch-chip-ev.sch-on { outline:2px solid var(--color-primary); outline-offset:-1px; }
    .sch-more { font-size:11px; font-weight:600; color:var(--text-muted); padding:0 4px; }
    .sch-offtag { font-size:10.5px; font-weight:700; color:var(--color-danger-text); }

    .sch-mgrid-head, .sch-mgrid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
    .sch-dow { font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--text-muted); text-align:center; padding:9px 0 7px; border-bottom:1px solid var(--border-light); background:var(--surface-alt); }
    .sch-mcell { min-height:118px; min-width:0; padding:5px 6px 6px; border-right:1px solid var(--border-light); border-bottom:1px solid var(--border-light);
      display:flex; flex-direction:column; gap:3px; cursor:pointer; box-sizing:border-box; overflow:hidden; }
    .sch-mcell:nth-child(7n) { border-right:none; }
    .sch-mcell:hover { background:var(--surface-alt); }
    .sch-mcell.sch-off { background:color-mix(in srgb, var(--surface-alt) 55%, transparent); }
    .sch-mcell.sch-sel { background:var(--color-primary-light); box-shadow:inset 0 0 0 2px var(--color-primary); }
    .sch-mcell.sch-out .sch-daynum, .sch-mcell.sch-out .sch-mitems { opacity:.45; }
    .sch-mhead { display:flex; align-items:center; justify-content:space-between; gap:4px; }
    .sch-daynum { font-size:12px; font-weight:700; color:var(--text-primary); min-width:22px; height:22px; line-height:22px; text-align:center; padding:0 5px; border-radius:11px; }
    .sch-daynum.sch-today { background:var(--color-primary); color:var(--color-primary-text); }
    .sch-mitems { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .sch-mdots { display:none; }

    .sch-side-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:11px 14px; border-bottom:1px solid var(--border-light); }
    .sch-side-head b { font-size:15px; color:var(--text-primary); }
    .sch-side-head span { font-size:12px; color:var(--text-secondary); margin-left:6px; }
    .sch-allday { display:flex; flex-direction:column; gap:3px; padding:8px 12px; border-bottom:1px solid var(--border-light); max-height:110px; overflow-y:auto; }
    .sch-tscroll { height:300px; flex:0 0 auto; overflow-y:auto; position:relative; border-bottom:1px solid var(--border-base); }
    .sch-tbody { position:relative; display:grid; grid-template-columns:54px minmax(0,1fr); }
    .sch-gutter { position:relative; }
    .sch-hour { position:absolute; right:8px; transform:translateY(-50%); font-size:10px; color:var(--text-muted); white-space:nowrap; }
    .sch-col { position:relative; border-left:1px solid var(--border-light); cursor:pointer;
      background-image:repeating-linear-gradient(to bottom, var(--border-light) 0, var(--border-light) 1px, transparent 1px, transparent ${HOUR_PX}px); }
    .sch-col.sch-off { background-color:color-mix(in srgb, var(--surface-alt) 60%, transparent); }
    .sch-block { position:absolute; box-sizing:border-box; border:none; border-left:3px solid var(--color-purple); border-radius:6px; padding:3px 7px; text-align:left;
      background:var(--color-purple-bg); color:var(--color-purple-text); font:inherit; cursor:pointer; overflow:hidden; display:flex; flex-direction:column; gap:1px; z-index:1; }
    .sch-block:hover, .sch-block.sch-on { background:var(--color-purple); color:#fff; z-index:2; }
    .sch-block b { font-size:11.5px; font-weight:700; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sch-block span { font-size:10.5px; opacity:.85; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sch-block.sch-short { padding:1px 7px; justify-content:center; }
    .sch-block.sch-short span { display:none; }
    .sch-now { position:absolute; left:0; right:0; height:2px; background:#ea4335; z-index:3; pointer-events:none; }
    .sch-now::before { content:''; position:absolute; left:-6px; top:-5px; width:12px; height:12px; border-radius:50%; background:#ea4335; }

    .sch-detail { padding:12px 14px; border-bottom:1px solid var(--border-light); }
    .sch-detail-top { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; flex-wrap:wrap; }
    .sch-detail h3 { display:flex; gap:8px; align-items:flex-start; margin:0 0 3px; font-size:15px; font-weight:700; line-height:1.3; color:var(--text-primary); }
    .sch-detail h3 i { width:10px; height:10px; border-radius:3px; flex-shrink:0; margin-top:5px; }
    .sch-pop-when { font-size:12px; color:var(--text-secondary); margin:0 0 4px 18px; }
    .sch-detail-acts { display:flex; gap:6px; flex-wrap:wrap; }
    .sch-act { padding:5px 11px !important; font-size:12px !important; min-height:0 !important; text-decoration:none; }
    .sch-pop-row { display:flex; gap:8px; font-size:12px; color:var(--text-secondary); margin:6px 0 0 18px; line-height:1.45; }
    .sch-pop-row svg { flex-shrink:0; margin-top:2px; color:var(--text-muted); }
    .sch-pop-row div { min-width:0; overflow-wrap:anywhere; white-space:pre-wrap; }
    .sch-hint { font-size:12px; color:var(--text-muted); line-height:1.5; }
    .sch-sec { font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-secondary); padding:10px 14px 6px; }
    .sch-sec span { background:var(--color-warning-bg); color:var(--color-warning-text); border-radius:999px; padding:1px 7px; margin-left:4px; }
    .sch-tasks { overflow-y:auto; padding:0 8px 10px; flex:1 1 auto; min-height:60px; }
    .sch-task { display:flex; gap:9px; align-items:flex-start; width:100%; text-align:left; border:none; background:transparent; border-radius:8px; padding:7px 6px; font:inherit; cursor:pointer; }
    .sch-task:hover, .sch-task.sch-on { background:var(--surface-alt); }
    .sch-task i { width:9px; height:9px; border-radius:50%; background:var(--color-warning); flex-shrink:0; margin-top:4px; }
    .sch-task i.done { background:var(--color-success); }
    .sch-task i.leave { background:var(--border-strong); }
    .sch-task span { min-width:0; display:flex; flex-direction:column; gap:1px; }
    .sch-task b { font-size:12.5px; font-weight:600; color:var(--text-primary); line-height:1.35; overflow-wrap:anywhere; }
    .sch-task small { font-size:11px; color:var(--text-muted); }

    /* Narrow screens: Day panel under the month; month cells show dots. */
    @media (max-width: 900px) {
      .sch-wrap { grid-template-columns:minmax(0,1fr); }
      .sch-side { position:static; max-height:none; }
      .sch-tasks { max-height:none; }
      .sch-toolbar-left { width:100%; }
      .sch-toolbar-right { width:100%; }
      .sch-brand { display:none; }
      #sch-title-label { font-size:15px; flex:1; }
      #sch-create { min-height:38px; }
      .sch-mcell { min-height:58px; padding:3px 2px; }
      .sch-mitems { display:none; }
      .sch-mdots { display:flex; flex-wrap:wrap; gap:3px; padding-left:4px; }
      .sch-mdots i { width:6px; height:6px; border-radius:50%; }
      .sch-mdots i.meeting { background:var(--color-purple); }
      .sch-mdots i.task { background:var(--color-warning); }
      .sch-mdots i.holiday { background:var(--color-danger); }
      .sch-mdots i.leave { background:var(--color-success); }
      .sch-mdots i.birthday { background:var(--color-info); }
      .sch-offtag { font-size:8.5px; }
      #sch-meeting-modal-overlay [style*="grid-template-columns:1fr 1fr"] > div { grid-column: 1 / -1; }
      #sch-meeting-modal-overlay .modal-footer > button { flex: 1 1 0; justify-content: center; min-height: 42px; }
    }`;

  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const chev = (pts) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="${pts}"/></svg>`;

    el.innerHTML = `
      <style>${CSS}</style>
      <div style="padding:4px 0;">
        <div class="sch-toolbar">
          <div class="sch-toolbar-left">
            <svg class="sch-brand" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>
            <h1 class="sch-brand" style="font-size:18px;font-weight:700;color:var(--text-primary);letter-spacing:-0.02em;margin:0 8px 0 0;">Scheduler</h1>
            <button id="sch-today" class="btn-secondary" title="Today (T)">Today</button>
            <button id="sch-prev" class="sch-icon-btn" aria-label="Previous month" title="Previous month">${chev('15 18 9 12 15 6')}</button>
            <button id="sch-next" class="sch-icon-btn" aria-label="Next month" title="Next month">${chev('9 18 15 12 9 6')}</button>
            <div id="sch-title-label" aria-live="polite">${esc(_titleText())}</div>
          </div>
          <div class="sch-toolbar-right" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div class="sch-legend" id="sch-legend">${KINDS.map(k =>
              `<button type="button" data-kind="${k}" class="${_hidden.has(k) ? 'off' : ''}" title="Show / hide ${KIND_LABEL[k]}"><i style="background:${KIND_COLOUR[k]};"></i>${KIND_LABEL[k]}</button>`).join('')}</div>
            <button id="sch-create" class="btn-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              Schedule
            </button>
          </div>
        </div>

        <div class="sch-wrap">
          <div class="sch-main" id="sch-main"></div>
          <aside class="sch-side" id="sch-side"></aside>
        </div>
      </div>`;

    _bindPage();
    _renderBody();
  }

  // Month + Day panel only — the toolbar stays put.
  function _renderBody({ keepScroll = false } = {}) {
    const main = document.getElementById('sch-main');
    const side = document.getElementById('sch-side');
    if (!main || !side) return;
    const sc0 = document.getElementById('sch-tscroll')?.scrollTop;
    main.innerHTML = _monthHTML();
    side.innerHTML = _sideHTML();
    const sc = document.getElementById('sch-tscroll');
    if (sc) {
      if (keepScroll && sc0 != null) sc.scrollTop = sc0;
      else {
        // Open at the first meeting (an hour before), else now on today, else 8 AM.
        const first = _infoFor(_sel).meetings.map(m => _toMins(m.startTime)).filter(v => v !== null).sort((a, b) => a - b)[0];
        const hour = first != null ? Math.max(0, Math.floor(first / 60) - 1)
          : _sel === _todayStr() ? Math.max(0, new Date().getHours() - 2) : SCROLL_TO_HOUR;
        sc.scrollTop = hour * HOUR_PX;
      }
    }
    _startNowTimer();
  }

  // Keeps the red now-line moving while today is in the Day panel.
  function _startNowTimer() {
    clearInterval(_nowTimer);
    _nowTimer = setInterval(() => {
      const line = document.querySelector('.sch-now[data-now]');
      if (!line) { clearInterval(_nowTimer); return; }
      line.style.top = _nowTop() + 'px';
    }, 60 * 1000);
  }

  // Show a month (re-fetching its data) with `date` picked in the Day panel.
  function _go(date) {
    const d = _startOfDay(date);
    _anchor = d;
    _sel = _dateStr(d);
    _selEv = null;
    loadData().then(renderPage);
  }

  function _step(dir) {
    const first = new Date(_anchor.getFullYear(), _anchor.getMonth() + dir, 1);
    const now = new Date();
    _go(first.getFullYear() === now.getFullYear() && first.getMonth() === now.getMonth() ? now : first);
  }

  // Pick a day: stays on this month's data if the day is in its grid.
  function _pick(ds, ev = null) {
    const inGrid = _gridDays(_anchor).some(d => _dateStr(d) === ds);
    if (!inGrid) { _go(new Date(ds + 'T00:00:00')); return; }
    const sameDay = ds === _sel;
    _sel = ds;
    _selEv = ev;
    _renderBody({ keepScroll: sameDay });
    if (_isPhone() && !sameDay) document.getElementById('sch-side')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Per-render listeners: aborted on the next render, and with the page.
  let _bindCtl = null;
  function _bindPage() {
    _bindCtl?.abort();
    _bindCtl = new AbortController();
    const signal = _bindCtl.signal;
    const pageSignal = window.Router.pageSignal();
    if (!pageSignal.aborted) pageSignal.addEventListener('abort', () => { _bindCtl?.abort(); clearInterval(_nowTimer); }, { once: true, signal });
    document.getElementById('sch-today')?.addEventListener('click', () => _go(new Date()));
    document.getElementById('sch-prev')?.addEventListener('click', () => _step(-1));
    document.getElementById('sch-next')?.addEventListener('click', () => _step(1));
    document.getElementById('sch-create')?.addEventListener('click', () => _openMeetingModal(_sel));

    document.getElementById('sch-legend')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      const k = b.dataset.kind;
      if (_hidden.has(k)) _hidden.delete(k); else _hidden.add(k);
      _store.set('sch-hidden', [..._hidden].join(','));
      b.classList.toggle('off', _hidden.has(k));
      _renderBody({ keepScroll: true });
    });

    // Month grid: a chip picks its day and shows it in the panel; a click on
    // the cell picks the day; a double click schedules on it.
    const main = document.getElementById('sch-main');
    main?.addEventListener('click', (e) => {
      const ev = e.target.closest('[data-ev]');
      if (ev) { _pick(ev.dataset.ev.split(':')[1], ev.dataset.ev); return; }
      const cell = e.target.closest('.sch-mcell');
      if (cell) _pick(cell.dataset.date);
    });
    main?.addEventListener('dblclick', (e) => {
      const cell = e.target.closest('.sch-mcell');
      if (cell && !e.target.closest('[data-ev]')) _openMeetingModal(cell.dataset.date);
    });

    // Day panel: pick an entry, act on the picked meeting, or click an empty
    // slot on the timeline to schedule at that half hour.
    const side = document.getElementById('sch-side');
    side?.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'new') return _openMeetingModal(_sel);
        if (act.dataset.act === 'cancel') return _deleteMeeting(act.dataset.id);
        if (act.dataset.act === 'decline') return _declineMeeting(act.dataset.id);
        if (act.dataset.act === 'copy') {
          const m = _entry(act.dataset.ref).item;
          if (m) Utils.showToast(await _copy(_inviteText(m)) ? 'Invite copied — paste it in WhatsApp or mail' : 'Could not copy', 'success');
        }
        return;
      }
      const ev = e.target.closest('[data-ev]');
      if (ev) { _selEv = ev.dataset.ev; _renderBody({ keepScroll: true }); return; }
      const col = e.target.closest('.sch-col');
      if (col) {
        const y = e.clientY - col.getBoundingClientRect().top;
        const mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor((y / HOUR_PX) * 2) * 30));
        _openMeetingModal(col.dataset.date, String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'));
      }
    });

    // Keyboard: T today, J/K next/previous month, ←/→ previous/next day,
    // C schedule — never while typing or with a dialog open.
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.getElementById('sch-meeting-modal-overlay') || document.querySelector('.modal-overlay:not(.hidden)')) return;
      const k = e.key.toLowerCase();
      if (k === 't') _go(new Date());
      else if (k === 'j' || k === 'n') _step(1);
      else if (k === 'k' || k === 'p') _step(-1);
      else if (k === 'arrowleft' || k === 'arrowright') _pick(_dateStr(_addDays(new Date(_sel + 'T00:00:00'), k === 'arrowleft' ? -1 : 1)));
      else if (k === 'c') _openMeetingModal(_sel);
      else return;
      e.preventDefault();
    }, { signal });
  }

  async function _declineMeeting(id) {
    if (!await Utils.showConfirm('Decline this meeting? It will be removed from your calendar.', { title: 'Decline Meeting', confirmText: 'Decline' })) return;
    try {
      await Utils.apiFetch('/api/meetings/decline?id=' + encodeURIComponent(id), { method: 'PATCH' });
      Utils.showToast('Meeting declined');
      _selEv = null;
      await loadData();
      renderPage();
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  /* ── Schedule-a-meeting modal ─────────────────────────────────────── */
  async function _loadUsers() {
    if (_users) return _users;
    try { _users = await Utils.apiFetch('/api/users?lite=1') || []; }
    catch { _users = []; }
    return _users;
  }


  // Start Time choices: every 15 minutes, "HH:MM" values shown as 10:30 AM.
  // Pre-picks `sel`, else the next half hour from now.
  function _timeOptions(sel) {
    if (!sel) {
      const d = new Date();
      const m = Math.ceil((d.getHours() * 60 + d.getMinutes() + 1) / 30) * 30 % 1440;
      sel = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    }
    const out = [];
    for (let m = 0; m < 1440; m += 15) {
      const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
      const v = String(h).padStart(2, '0') + ':' + mm;
      out.push(`<option value="${v}"${v === sel ? ' selected' : ''}>${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}</option>`);
    }
    return out.join('');
  }

  // Outside guests: emails separated by commas, semicolons or spaces.
  // Returns { emails } or { bad } naming the first one that isn't an email.
  function _guestEmails(text) {
    const parts = String(text || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const bad = parts.find(p => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p));
    return bad ? { bad } : { emails: [...new Set(parts.map(p => p.toLowerCase()))] };
  }

  function _closeMeetingModal() {
    document.getElementById('sch-meeting-modal-overlay')?.remove();
  }

  // Minutes to add to a "HH:MM" time for the Duration-driven End Time.
  function _addMinutes(hhmm, mins) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    const total = (h * 60 + m + mins + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  // Attendees combobox: a chip box + type-to-filter dropdown, so picking more
  // than one no longer needs Ctrl/Cmd-click or scrolling a checkbox list
  // ("Attendees mai type krne ka option bhi aana chahiye"). Selection lives
  // in the DOM (one .sch-chip per pick) rather than a JS array, so collecting
  // it at submit time is just reading the chips, same discipline as the
  // checkbox version it replaces.
  function _bindAttendeesCombobox(users) {
    const box = document.getElementById('sch-attendees-box');
    const input = document.getElementById('sch-attendees-input');
    const dd = document.getElementById('sch-attendees-dd');
    const picked = () => new Set([...box.querySelectorAll('.sch-chip')].map(c => c.dataset.name.toLowerCase()));

    const addChip = (name) => {
      if (picked().has(name.toLowerCase())) return;
      const chip = document.createElement('span');
      chip.className = 'sch-chip';
      chip.dataset.name = name;
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:var(--color-primary-light,#eef4fc);color:var(--color-primary);font-size:12px;font-weight:600;padding:3px 6px 3px 10px;border-radius:999px;';
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
      dd.innerHTML = matches.map(u => `<div class="sch-attendee-opt" style="padding:7px 12px;font-size:13px;cursor:pointer;" data-name="${esc(u.name)}">
          <b>${esc(u.name)}</b>${u.department ? ` <span style="color:var(--text-muted);">— ${esc(u.department)}</span>` : ''}
        </div>`).join('');
      const r = box.getBoundingClientRect();
      dd.style.top = (r.bottom + 3) + 'px'; dd.style.left = r.left + 'px'; dd.style.width = r.width + 'px';
      dd.style.display = 'block';
    };

    input.addEventListener('input', showMatches);
    input.addEventListener('focus', showMatches);
    box.addEventListener('click', (e) => { if (e.target === box) input.focus(); });
    dd.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.sch-attendee-opt');
      if (!opt) return;
      addChip(opt.dataset.name);
      input.value = '';
      input.focus();
      showMatches();
    });
    // Backspace on an empty input pops the last chip — the usual chip-input
    // affordance, so a misclick doesn't need a mouse trip to undo.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value) box.querySelector('.sch-chip:last-of-type')?.remove();
    });
    document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== dd) dd.style.display = 'none'; }, { signal: window.Router.pageSignal() });
  }

  // startTime ("HH:MM", optional) prefills the Start Time — set when an empty
  // slot on the Day / Week grid was clicked.
  async function _openMeetingModal(dateStr, startTime) {
    _closeMeetingModal();
    const users = await _loadUsers();
    const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border-base);border-radius:8px;font-size:13px;color:var(--text-primary);background:var(--surface);outline:none;';
    const labelStyle = 'display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:5px;';
    const DURATIONS = [['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hour'], ['90', '1.5 hours'], ['120', '2 hours'], ['', 'Custom']];

    const bodyHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div style="grid-column:1/-1;">
            <label style="${labelStyle}">Title <span style="color:var(--color-danger)">*</span></label>
            <input id="sch-title" style="${inputStyle}" placeholder="e.g. Vendor review call" />
          </div>
          <div>
            <label style="${labelStyle}">Date <span style="color:var(--color-danger)">*</span></label>
            <input id="sch-date" type="date" value="${dateStr}" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">Duration</label>
            <select id="sch-duration" style="${inputStyle}background:var(--surface);">${DURATIONS.map(([v, l]) => `<option value="${v}"${v === '30' ? ' selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          <div>
            <label style="${labelStyle}">Start Time <span style="color:var(--color-danger)">*</span></label>
            <select id="sch-start" style="${inputStyle}background:var(--surface);">${_timeOptions(startTime)}</select>
          </div>
          <div>
            <label style="${labelStyle}">End Time</label>
            <input id="sch-end" type="time" disabled style="${inputStyle}background:var(--bg-subtle,#f3f4f6);color:var(--text-muted);cursor:not-allowed;" />
          </div>
        </div>
        <div>
          <label style="${labelStyle}">Attendees (Team)</label>
          <div id="sch-attendees-box" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:40px;box-sizing:border-box;padding:5px 8px;border:1.5px solid var(--border-base);border-radius:8px;background:var(--surface);cursor:text;">
            <input id="sch-attendees-input" type="text" autocomplete="off" placeholder="Select attendees…" style="flex:1;min-width:120px;border:none;outline:none;font-size:13px;background:transparent;color:var(--text-primary);" />
          </div>
          <div id="sch-attendees-dd" style="display:none;position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border-base);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;"></div>
        </div>
        <div>
          <label style="${labelStyle}">Outside guests (email)</label>
          <input id="sch-guests" type="text" autocomplete="off" placeholder="e.g. client@company.com, ca@firm.in" style="${inputStyle}" />
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Not on the ERP? Add their email — they get the same invite.</div>
        </div>
        <div>
          <label style="${labelStyle}">Agenda</label>
          <textarea id="sch-notes" rows="3" placeholder="Optional — what's the meeting about?" style="${inputStyle}resize:none;font-family:inherit;"></textarea>
        </div>
        <div>
          <div style="font-size:12px;color:var(--text-secondary);background:var(--surface-alt);border:1px solid var(--border-base);border-radius:8px;padding:8px 10px;">
            A Google Meet link is made under your account, and attendees get the invite in their email and Google Calendar.
          </div>
          <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-secondary);margin-top:7px;cursor:pointer;">
            <input type="checkbox" id="sch-nolink"> In person — no online link
          </label>
        </div>
      </div>`;
    const footerHTML = `
      <button type="button" id="sch-cancel" class="btn-secondary">Close</button>
      <button type="button" id="sch-save" class="btn-primary">Save</button>`;

    document.body.insertAdjacentHTML('beforeend', window.UI.modal({
      id: 'sch-meeting-modal-overlay',
      title: 'Schedule a Meeting',
      subtitle: 'Only you and whoever you invite will see this on their Scheduler',
      width: 480,
      closeButtonId: 'sch-close',
      hiddenByDefault: false,
      bodyHTML, footerHTML,
    }));

    const overlay = document.getElementById('sch-meeting-modal-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeMeetingModal(); });
    document.getElementById('sch-close').addEventListener('click', _closeMeetingModal);
    document.getElementById('sch-cancel').addEventListener('click', _closeMeetingModal);
    document.getElementById('sch-title').focus();
    _bindAttendeesCombobox(users);

    // Duration + the Start Time pick drive the (read-only) End
    // Time — the reference design shows End Time greyed out because it's
    // computed, not typed.
    const recomputeEnd = () => {
      const mins = parseInt(document.getElementById('sch-duration').value, 10);
      const start = document.getElementById('sch-start').value;
      document.getElementById('sch-end').value = (start && Number.isFinite(mins)) ? _addMinutes(start, mins) : '';
    };
    document.getElementById('sch-duration').addEventListener('change', recomputeEnd);
    document.getElementById('sch-start').addEventListener('change', recomputeEnd);
    recomputeEnd();

    document.getElementById('sch-save').addEventListener('click', async () => {
      const title = document.getElementById('sch-title').value.trim();
      const date = document.getElementById('sch-date').value;
      const startTime = document.getElementById('sch-start').value;
      if (!title || !date) { Utils.showToast('Title and date are required', 'error'); return; }
      const guests = _guestEmails(document.getElementById('sch-guests').value);
      if (guests.bad) { Utils.showToast(`"${guests.bad}" is not an email address`, 'error'); return; }
      const attendees = [...document.querySelectorAll('#sch-attendees-box .sch-chip')].map(c => c.dataset.name).concat(guests.emails);
      const btn = document.getElementById('sch-save');
      btn.disabled = true; btn.textContent = 'Scheduling…';
      try {
        const saved = await Utils.apiFetch('/api/meetings', {
          method: 'POST',
          body: JSON.stringify({
            title, date,
            startTime,
            endTime: document.getElementById('sch-end').value,
            attendees,
            notes: document.getElementById('sch-notes').value.trim(),
            noLink: !!document.getElementById('sch-nolink')?.checked,
          }),
        });
        _closeMeetingModal();
        // Say what actually happened: link made or not, who was mailed.
        const parts = ['Meeting scheduled'];
        if (saved?.linkMode === 'auto') parts.push(`${saved.provider} link created`);
        else if (saved?.linkMode === 'not-configured') parts.push('no Zoom/Meet account connected yet, so no link was made');
        else if (saved?.linkMode === 'failed') parts.push('the Zoom / Meet link could not be made — check the server log');
        const inv = saved?.invite || {};
        if (inv.mailed) parts.push(inv.via === 'google' ? `Google Calendar invite sent to ${inv.mailed}` : `invite mailed to ${inv.mailed}`);
        if ((inv.missing || []).length) parts.push(`no email for ${inv.missing.join(', ')}`);
        Utils.showToast(parts.join(' · '), saved?.linkMode === 'failed' || (inv.missing || []).length ? 'warning' : 'success');
        _anchor = _startOfDay(new Date(date + 'T00:00:00'));
        _sel = date;
        _selEv = null;
        await loadData();
        renderPage();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save';
        Utils.showToast(e.message || 'Failed to schedule meeting', 'error');
      }
    });
  }

  async function _deleteMeeting(id) {
    if (!await Utils.showConfirm('Cancel this meeting?', { danger: true, title: 'Cancel Meeting', confirmText: 'Cancel Meeting' })) return;
    try {
      const r = await Utils.apiFetch('/api/meetings?id=' + encodeURIComponent(id), { method: 'DELETE' });
      Utils.showToast(r?.notified === 'google' || r?.notified === 'mail' ? 'Meeting cancelled · attendees told' : r?.notified === 'failed' ? 'Meeting cancelled · could not notify attendees' : 'Meeting cancelled', r?.notified === 'failed' ? 'warning' : 'success');
      _selEv = null;
      await loadData();
      renderPage();
    } catch (e) { Utils.showToast(e.message || 'Failed', 'error'); }
  }

  return {
    async render() {
      await loadData();
      renderPage();
    },
    async refresh() {
      await loadData();
      renderPage();
    },
  };
})();
