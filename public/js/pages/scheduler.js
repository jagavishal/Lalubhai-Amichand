window.Pages = window.Pages || {};

/* Scheduler — one calendar for the three date-bound things people already
   track elsewhere in the app: holidays (HR → Leave Management), tasks (All
   Tasks / delegations), and meetings (new here — the only thing this page
   itself creates). It reads all three from one call, GET /api/scheduler.

   Laid out like Google Calendar: Day / Week / Month views, a mini month and
   show/hide toggles on the left, an hour grid with a now-line, click an empty
   slot to schedule a meeting at that time, click anything to see its details. */
window.Pages.scheduler = (() => {
  const esc = Utils.esc;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MON = MONTH_NAMES.map(m => m.slice(0, 3));
  const HOUR_PX = 48;              // height of one hour on the Day / Week grid
  const SCROLL_TO_HOUR = 8;        // the grid opens at 8 AM unless now is later
  const KINDS = ['meeting', 'task', 'holiday', 'leave', 'birthday'];

  const _store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const _isPhone = () => window.matchMedia('(max-width: 767px)').matches;

  let _mode = ['day', 'week', 'month'].includes(_store.get('sch-mode')) ? _store.get('sch-mode') : (_isPhone() ? 'day' : 'week');
  let _anchor = _startOfDay(new Date());   // the focused day; the view is built around it
  let _mini = new Date(_anchor.getFullYear(), _anchor.getMonth(), 1);   // month on the mini calendar
  let _hidden = new Set(String(_store.get('sch-hidden') || '').split(',').filter(k => KINDS.includes(k)));
  let _data = { weekOffs: ['0'], holidays: [], tasks: [], meetings: [], leaves: [], birthdays: [] };
  let _byDate = new Map();         // date -> { holiday, tasks:[], meetings:[] }
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
  // The days the current view shows, in order.
  function _visibleDays() {
    if (_mode === 'day') return [_anchor];
    if (_mode === 'week') { const s = _addDays(_anchor, -_anchor.getDay()); return Array.from({ length: 7 }, (_, i) => _addDays(s, i)); }
    return _gridDays(_anchor);
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
    const days = _visibleDays();
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

  /* ── Event chips (shared by every view) ───────────────────────────── */
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
    return `<button type="button" class="sch-chip-ev" data-ev="${kind}:${dateStr}:${i}" title="${esc(label)}"
        style="${tone}${opts.done ? 'text-decoration:line-through;' : ''}">${opts.time ? `<b>${esc(opts.time)}</b> ` : ''}${esc(label)}</button>`;
  }

  function _leaveLabel(l) {
    return `${l.name || 'Leave'} [${l.leaveType || 'Leave'}${l.halfDay && l.halfDay !== 'full' ? ' ½' : ''}]`;
  }

  function _dayChips(dateStr, info) {
    const out = [];
    if (info.holiday) out.push(_chipHTML('holiday', dateStr, 0, info.holiday.name));
    info.birthdays.forEach((b, i) => out.push(_chipHTML('birthday', dateStr, i, '🎂 ' + b.name)));
    info.leaves.forEach((l, i) => out.push(_chipHTML('leave', dateStr, i, _leaveLabel(l))));
    info.meetings.forEach((m, i) => out.push(_chipHTML('meeting', dateStr, i, m.title, { time: m.startTime ? _fmtTime(m.startTime) : '' })));
    info.tasks.forEach((t, i) => out.push(_chipHTML('task', dateStr, i, t.description, { done: t.status === 'done', muted: t.status === 'done' || t.status === 'leave' })));
    return out;
  }

  /* ── Month view ───────────────────────────────────────────────────── */
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
      return `
        <div class="sch-mcell${d.getMonth() !== _anchor.getMonth() ? ' sch-out' : ''}${off ? ' sch-off' : ''}" data-date="${ds}">
          <div class="sch-mhead">
            <button type="button" class="sch-daynum${ds === today ? ' sch-today' : ''}" data-goto="${ds}" title="Open ${_fmtLongDate(ds)}">${d.getDate() === 1 ? MON[d.getMonth()] + ' ' : ''}${d.getDate()}</button>
            ${off ? '<span class="sch-offtag">Off</span>' : ''}
          </div>
          <div class="sch-mitems">${shown.join('')}${more > 0 ? `<button type="button" class="sch-more" data-goto="${ds}">+${more} more</button>` : ''}</div>
          <div class="sch-mdots">${chips.length ? chips.slice(0, 4).map(c => `<i class="${/data-ev="(\w+)/.exec(c)[1]}"></i>`).join('') : ''}</div>
        </div>`;
    }).join('');
    return `
      <div class="sch-month">
        <div class="sch-mgrid-head">${header}</div>
        <div class="sch-mgrid">${cells}</div>
      </div>`;
  }

  /* ── Day / Week time grid ─────────────────────────────────────────── */
  // Overlapping meetings share the column side by side, Google-style: each
  // cluster of mutually overlapping meetings is split into as many lanes as
  // it needs at its busiest.
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

  function _timeGridHTML() {
    const days = _visibleDays();
    const today = _todayStr();
    const cols = `56px repeat(${days.length}, minmax(0,1fr))`;
    const isDay = _mode === 'day';

    const head = days.map(d => {
      const ds = _dateStr(d);
      return `<button type="button" class="sch-colhead${ds === today ? ' sch-today' : ''}" data-goto="${ds}" title="Open ${_fmtLongDate(ds)}">
          <span>${DOW[d.getDay()]}</span><b>${d.getDate()}</b></button>`;
    }).join('');

    // All-day strip: holidays, tasks (they carry a due date, not a time) and
    // meetings saved without a start time.
    const allDay = days.map(d => {
      const ds = _dateStr(d);
      const info = _infoFor(ds);
      const raw = _byDate.get(ds);
      const chips = [];
      if (info.holiday) chips.push(_chipHTML('holiday', ds, 0, info.holiday.name));
      else if (_isWeekOff(d) && !raw?.holiday) chips.push('<span class="sch-offtag" style="padding:2px 4px;">Week off</span>');
      info.birthdays.forEach((b, i) => chips.push(_chipHTML('birthday', ds, i, '🎂 ' + b.name)));
      info.leaves.forEach((l, i) => chips.push(_chipHTML('leave', ds, i, _leaveLabel(l))));
      info.meetings.forEach((m, i) => { if (_toMins(m.startTime) === null) chips.push(_chipHTML('meeting', ds, i, m.title)); });
      info.tasks.forEach((t, i) => chips.push(_chipHTML('task', ds, i, t.description, { done: t.status === 'done', muted: t.status === 'done' || t.status === 'leave' })));
      const cap = isDay ? chips.length : 3;
      const more = chips.length - cap;
      return `<div class="sch-allday-col">${chips.slice(0, cap).join('')}${more > 0 ? `<button type="button" class="sch-more" data-goto="${ds}">+${more} more</button>` : ''}</div>`;
    }).join('');

    const hours = Array.from({ length: 24 }, (_, h) =>
      `<div class="sch-hour" style="top:${h * HOUR_PX}px;">${h ? _fmtTime(String(h).padStart(2, '0') + ':00') : ''}</div>`).join('');

    const columns = days.map(d => {
      const ds = _dateStr(d);
      const info = _infoFor(ds);
      const raw = _byDate.get(ds);
      const shade = raw?.holiday || _isWeekOff(d);
      const timed = _layoutTimed(info.meetings.map((m, i) => ({ ...m, _i: i })).filter(m => _toMins(m.startTime) !== null));
      const blocks = timed.map(it => {
        const top = (it.s / 60) * HOUR_PX;
        const h = Math.max(((it.e - it.s) / 60) * HOUR_PX - 2, 18);
        const w = 100 / it.lanes;
        return `<button type="button" class="sch-block" data-ev="meeting:${ds}:${it.m._i}"
            style="top:${top}px;height:${h}px;left:calc(${it.lane * w}% + 1px);width:calc(${w}% - 3px);">
            <b>${esc(it.m.title)}</b>
            <span>${_fmtTime(it.m.startTime)}${it.m.endTime ? ' – ' + _fmtTime(it.m.endTime) : ''}${it.m.location && !/^https?:/i.test(it.m.location) ? ', ' + esc(it.m.location) : ''}</span>
          </button>`;
      }).join('');
      const now = ds === today ? `<div class="sch-now" data-now style="top:${_nowTop()}px;"></div>` : '';
      return `<div class="sch-col${shade ? ' sch-off' : ''}" data-date="${ds}">${blocks}${now}</div>`;
    }).join('');

    return `
      <div class="sch-tgrid">
        <div class="sch-thead" style="grid-template-columns:${cols};">
          <div class="sch-tz">IST</div>${head}
        </div>
        <div class="sch-allday" style="grid-template-columns:${cols};">
          <div class="sch-allday-label">All day</div>${allDay}
        </div>
        <div class="sch-tscroll" id="sch-tscroll">
          <div class="sch-tbody" style="grid-template-columns:${cols};height:${24 * HOUR_PX}px;">
            <div class="sch-gutter">${hours}</div>${columns}
          </div>
        </div>
      </div>`;
  }

  function _nowTop() {
    const n = new Date();
    return ((n.getHours() * 60 + n.getMinutes()) / 60) * HOUR_PX;
  }

  /* ── Left rail: mini month + show/hide ────────────────────────────── */
  function _miniHTML() {
    const days = _gridDays(_mini);
    const today = _todayStr();
    const sel = _dateStr(_anchor);
    const weekStart = _dateStr(_addDays(_anchor, -_anchor.getDay()));
    const weekEnd = _dateStr(_addDays(_anchor, 6 - _anchor.getDay()));
    const cells = days.map(d => {
      const ds = _dateStr(d);
      const cls = [
        d.getMonth() !== _mini.getMonth() ? 'out' : '',
        ds === today ? 'today' : '',
        ds === sel ? 'sel' : '',
        _mode === 'week' && ds >= weekStart && ds <= weekEnd ? 'wk' : '',
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-mini="${ds}">${d.getDate()}</button>`;
    }).join('');
    const toggle = (k, label, colour) => `
      <label class="sch-toggle"><input type="checkbox" data-kind="${k}"${_hidden.has(k) ? '' : ' checked'} style="accent-color:${colour};"> ${label}</label>`;
    return `
      <div class="sch-mini">
        <div class="sch-mini-head">
          <b>${MONTH_NAMES[_mini.getMonth()]} ${_mini.getFullYear()}</b>
          <span>
            <button type="button" class="sch-icon-btn" data-mini-nav="-1" aria-label="Previous month"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
            <button type="button" class="sch-icon-btn" data-mini-nav="1" aria-label="Next month"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
          </span>
        </div>
        <div class="sch-mini-grid">${DOW.map(d => `<i>${d[0]}</i>`).join('')}${cells}</div>
      </div>
      <div class="sch-toggles">
        <div class="sch-rail-title">My calendars</div>
        ${toggle('meeting', 'Meetings', 'var(--color-purple)')}
        ${toggle('task', 'Tasks due', 'var(--color-warning)')}
        ${toggle('holiday', 'Holidays', 'var(--color-danger)')}
        ${toggle('leave', 'Employee Leaves', 'var(--color-success)')}
        ${toggle('birthday', 'Birthdays', 'var(--color-info)')}
      </div>`;
  }

  function _titleText() {
    if (_mode === 'month') return `${MONTH_NAMES[_anchor.getMonth()]} ${_anchor.getFullYear()}`;
    if (_mode === 'day') return _fmtLongDate(_dateStr(_anchor));
    const days = _visibleDays();
    const a = days[0], b = days[6];
    if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
    if (a.getFullYear() === b.getFullYear()) return `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
    return `${a.getDate()} ${MON[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
  }

  /* ── Page shell ───────────────────────────────────────────────────── */
  const CSS = `
    .sch-wrap { display:flex; gap:16px; align-items:flex-start; }
    .sch-rail { flex:0 0 228px; display:flex; flex-direction:column; gap:18px; position:sticky; top:8px; }
    .sch-main { flex:1 1 auto; min-width:0; background:var(--surface); border:1px solid var(--border-light); border-radius:12px; box-shadow:var(--shadow-xs); overflow:hidden; }
    .sch-toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
    .sch-toolbar-left { display:flex; align-items:center; gap:8px; min-width:0; }
    .sch-icon-btn { width:30px; height:30px; border-radius:50%; border:none; background:transparent; color:var(--text-secondary);
      cursor:pointer; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
    .sch-icon-btn:hover { background:var(--surface-alt); }
    #sch-title-label { font-size:18px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sch-seg { display:inline-flex; border:1.5px solid var(--border-base); border-radius:8px; overflow:hidden; }
    .sch-seg button { border:none; background:transparent; padding:6px 14px; font:inherit; font-size:13px; font-weight:600; color:var(--text-secondary); cursor:pointer; }
    .sch-seg button + button { border-left:1.5px solid var(--border-base); }
    .sch-seg button.on { background:var(--color-primary-light); color:var(--color-primary-strong); }

    .sch-mini { background:var(--surface); border:1px solid var(--border-light); border-radius:12px; padding:12px; box-shadow:var(--shadow-xs); }
    .sch-mini-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; font-size:13px; color:var(--text-primary); }
    .sch-mini-head .sch-icon-btn { width:26px; height:26px; }
    .sch-mini-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:1px; text-align:center; }
    .sch-mini-grid i { font-style:normal; font-size:10px; font-weight:700; color:var(--text-muted); padding:3px 0; }
    .sch-mini-grid button { border:none; background:transparent; font:inherit; font-size:11.5px; color:var(--text-primary); height:26px; border-radius:50%; cursor:pointer; padding:0; }
    .sch-mini-grid button:hover { background:var(--surface-alt); }
    .sch-mini-grid button.out { color:var(--text-muted); }
    .sch-mini-grid button.wk { background:var(--color-primary-light); border-radius:0; }
    .sch-mini-grid button.today { color:var(--color-primary); font-weight:800; }
    .sch-mini-grid button.sel { background:var(--color-primary); color:var(--color-primary-text); border-radius:50%; font-weight:700; }
    .sch-toggles { display:flex; flex-direction:column; gap:6px; padding:0 4px; }
    .sch-rail-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--text-secondary); margin-bottom:2px; }
    .sch-toggle { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-primary); cursor:pointer; }
    .sch-toggle input { width:15px; height:15px; cursor:pointer; }

    .sch-chip-ev { display:block; width:100%; text-align:left; border:none; border-radius:4px; padding:2px 6px; font:inherit; font-size:11.5px;
      font-weight:500; line-height:1.35; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-sizing:border-box; }
    .sch-chip-ev:hover { filter:brightness(.96); }
    .sch-more { align-self:flex-start; border:none; background:transparent; padding:1px 4px; border-radius:4px; font:inherit; font-size:11px;
      font-weight:700; color:var(--text-secondary); cursor:pointer; }
    .sch-more:hover { background:var(--surface-alt); color:var(--text-primary); }
    .sch-offtag { font-size:10.5px; font-weight:700; color:var(--color-danger-text); }

    .sch-mgrid-head, .sch-mgrid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
    .sch-dow { font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--text-muted); text-align:center; padding:8px 0 6px; border-bottom:1px solid var(--border-light); }
    .sch-mcell { min-height:112px; min-width:0; padding:4px 5px 6px; border-right:1px solid var(--border-light); border-bottom:1px solid var(--border-light);
      display:flex; flex-direction:column; gap:3px; cursor:pointer; box-sizing:border-box; overflow:hidden; }
    .sch-mcell:nth-child(7n) { border-right:none; }
    .sch-mcell:hover { background:var(--surface-alt); }
    .sch-mcell.sch-off { background:color-mix(in srgb, var(--surface-alt) 55%, transparent); }
    .sch-mcell.sch-out .sch-daynum, .sch-mcell.sch-out .sch-mitems { opacity:.45; }
    .sch-mhead { display:flex; align-items:center; justify-content:space-between; gap:4px; }
    .sch-daynum { border:none; background:transparent; font:inherit; font-size:12px; font-weight:600; color:var(--text-primary); min-width:24px; height:24px;
      padding:0 6px; border-radius:12px; cursor:pointer; }
    .sch-daynum:hover { background:var(--border-light); }
    .sch-daynum.sch-today { background:var(--color-primary); color:var(--color-primary-text); }
    .sch-mitems { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .sch-mdots { display:none; }

    .sch-thead, .sch-allday, .sch-tbody { display:grid; }
    .sch-thead { border-bottom:1px solid var(--border-light); }
    .sch-tz { font-size:10px; color:var(--text-muted); align-self:end; text-align:right; padding:0 8px 6px 0; }
    .sch-colhead { border:none; background:transparent; font:inherit; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:2px; padding:8px 0 6px; color:var(--text-secondary); }
    .sch-colhead span { font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .sch-colhead b { font-size:22px; font-weight:500; color:var(--text-primary); width:40px; height:40px; line-height:40px; border-radius:50%; }
    .sch-colhead:hover b { background:var(--surface-alt); }
    .sch-colhead.sch-today span { color:var(--color-primary); }
    .sch-colhead.sch-today b { background:var(--color-primary); color:var(--color-primary-text); }
    .sch-allday { border-bottom:1px solid var(--border-base); }
    .sch-allday-label { font-size:10px; color:var(--text-muted); text-align:right; padding:6px 8px 0 0; }
    .sch-allday-col { display:flex; flex-direction:column; gap:2px; padding:3px 3px 4px; min-width:0; border-left:1px solid var(--border-light); max-height:190px; overflow-y:auto; }
    .sch-tscroll { height:calc(100vh - 290px); min-height:420px; overflow-y:auto; position:relative; }
    .sch-tbody { position:relative; }
    .sch-gutter { position:relative; }
    .sch-hour { position:absolute; right:8px; transform:translateY(-50%); font-size:10px; color:var(--text-muted); white-space:nowrap; }
    .sch-col { position:relative; border-left:1px solid var(--border-light); cursor:pointer;
      background-image:repeating-linear-gradient(to bottom, var(--border-light) 0, var(--border-light) 1px, transparent 1px, transparent ${HOUR_PX}px); }
    .sch-col.sch-off { background-color:color-mix(in srgb, var(--surface-alt) 60%, transparent); }
    .sch-block { position:absolute; box-sizing:border-box; border:1px solid var(--surface); border-radius:6px; padding:3px 6px; text-align:left;
      background:var(--color-purple); color:#fff; font:inherit; cursor:pointer; overflow:hidden; display:flex; flex-direction:column; gap:1px; z-index:1; }
    .sch-block:hover { filter:brightness(1.08); box-shadow:var(--shadow-md); z-index:2; }
    .sch-block b { font-size:11.5px; font-weight:700; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sch-block span { font-size:10.5px; opacity:.9; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sch-now { position:absolute; left:0; right:0; height:2px; background:#ea4335; z-index:3; pointer-events:none; }
    .sch-now::before { content:''; position:absolute; left:-6px; top:-5px; width:12px; height:12px; border-radius:50%; background:#ea4335; }

    .sch-pop { position:fixed; z-index:9998; width:340px; max-width:calc(100vw - 32px); background:var(--surface); color:var(--text-primary);
      border:1px solid var(--border-light); border-radius:12px; box-shadow:var(--shadow-xl); padding:14px 16px 16px; }
    .sch-pop-top { display:flex; justify-content:flex-end; gap:2px; margin:-6px -8px 2px 0; }
    .sch-pop h3 { display:flex; gap:10px; align-items:flex-start; margin:0 0 4px; font-size:17px; font-weight:600; line-height:1.3; }
    .sch-pop h3 i { width:12px; height:12px; border-radius:3px; flex-shrink:0; margin-top:5px; }
    .sch-pop-when { font-size:12.5px; color:var(--text-secondary); margin:0 0 10px 22px; }
    .sch-pop-row { display:flex; gap:10px; font-size:12.5px; color:var(--text-secondary); margin:6px 0 0; line-height:1.45; }
    .sch-pop-row svg { flex-shrink:0; margin-top:2px; color:var(--text-muted); }
    .sch-pop-row div { min-width:0; overflow-wrap:anywhere; white-space:pre-wrap; }
    .sch-pop-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:14px; }

    /* Phone: no rail, compact month (dots), full-width toolbar. */
    @media (max-width: 767px) {
      .sch-rail { display:none; }
      .sch-toolbar-left { width:100%; }
      .sch-toolbar-right { width:100%; flex-wrap:nowrap !important; }
      .sch-brand { display:none; }
      #sch-title-label { font-size:15px; flex:1; }
      .sch-seg { flex:1; }
      .sch-seg button { flex:1; padding:8px 0; }
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
      .sch-colhead b { font-size:15px; width:28px; height:28px; line-height:28px; }
      .sch-tscroll { height:calc(100vh - 300px); min-height:360px; }
      .sch-block span { display:none; }
      .sch-block { padding:2px 3px; }
      #sch-meeting-modal-overlay [style*="grid-template-columns:1fr 1fr"] > div:nth-child(1),
      #sch-meeting-modal-overlay [style*="grid-template-columns:1fr 1fr"] > div:nth-child(2),
      #sch-meeting-modal-overlay [style*="grid-template-columns:1fr 1fr"] > div:nth-child(5),
      #sch-meeting-modal-overlay [style*="grid-template-columns:1fr 1fr"] > div:nth-child(6) { grid-column: 1 / -1; }
      #sch-meeting-modal-overlay .modal-footer > button { flex: 1 1 0; justify-content: center; min-height: 42px; }
    }`;

  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;
    _closePopover();
    const chev = (pts) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="${pts}"/></svg>`;
    const unit = _mode === 'month' ? 'month' : _mode === 'week' ? 'week' : 'day';

    el.innerHTML = `
      <style>${CSS}</style>
      <div style="padding:4px 0;">
        <div class="sch-toolbar">
          <div class="sch-toolbar-left">
            <svg class="sch-brand" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>
            <h1 class="sch-brand" style="font-size:18px;font-weight:700;color:var(--text-primary);letter-spacing:-0.02em;margin:0 8px 0 0;">Scheduler</h1>
            <button id="sch-today" class="btn-secondary" title="Today (T)">Today</button>
            <button id="sch-prev" class="sch-icon-btn" aria-label="Previous ${unit}" title="Previous ${unit}">${chev('15 18 9 12 15 6')}</button>
            <button id="sch-next" class="sch-icon-btn" aria-label="Next ${unit}" title="Next ${unit}">${chev('9 18 15 12 9 6')}</button>
            <div id="sch-title-label" aria-live="polite">${esc(_titleText())}</div>
          </div>
          <div class="sch-toolbar-right" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div class="sch-seg" role="tablist" aria-label="View">
              ${[['day', 'Day', 'D'], ['week', 'Week', 'W'], ['month', 'Month', 'M']].map(([k, l, key]) =>
                `<button type="button" data-mode="${k}" class="${_mode === k ? 'on' : ''}" role="tab" aria-selected="${_mode === k}" title="${l} (${key})">${l}</button>`).join('')}
            </div>
            <button id="sch-create" class="btn-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              Create
            </button>
          </div>
        </div>

        <div class="sch-wrap">
          <aside class="sch-rail" id="sch-rail">${_miniHTML()}</aside>
          <div class="sch-main" id="sch-main">${_mode === 'month' ? _monthHTML() : _timeGridHTML()}</div>
        </div>
      </div>`;

    _bindPage();
    if (_mode !== 'month') {
      const sc = document.getElementById('sch-tscroll');
      const showsToday = _visibleDays().some(d => _dateStr(d) === _todayStr());
      const hour = showsToday ? Math.max(0, new Date().getHours() - 2) : SCROLL_TO_HOUR;
      if (sc) sc.scrollTop = Math.min(hour, SCROLL_TO_HOUR + 4) * HOUR_PX;
      _startNowTimer();
    }
  }

  // Keeps the red now-line moving while a Day / Week view is open.
  function _startNowTimer() {
    clearInterval(_nowTimer);
    _nowTimer = setInterval(() => {
      const line = document.querySelector('.sch-now[data-now]');
      if (!line) { clearInterval(_nowTimer); return; }
      line.style.top = _nowTop() + 'px';
    }, 60 * 1000);
  }

  function _go(date, mode) {
    _anchor = _startOfDay(date);
    if (mode) { _mode = mode; _store.set('sch-mode', mode); }
    _mini = new Date(_anchor.getFullYear(), _anchor.getMonth(), 1);
    loadData().then(renderPage);
  }

  function _step(dir) {
    if (_mode === 'month') _go(new Date(_anchor.getFullYear(), _anchor.getMonth() + dir, 1));
    else _go(_addDays(_anchor, dir * (_mode === 'week' ? 7 : 1)));
  }

  // Per-render listeners: aborted on the next render, and with the page.
  let _bindCtl = null;
  function _bindPage() {
    _bindCtl?.abort();
    _bindCtl = new AbortController();
    const signal = _bindCtl.signal;
    const pageSignal = window.Router.pageSignal();
    if (!pageSignal.aborted) pageSignal.addEventListener('abort', () => { _bindCtl?.abort(); clearInterval(_nowTimer); _closePopover(); }, { once: true, signal });
    document.getElementById('sch-today')?.addEventListener('click', () => _go(new Date()));
    document.getElementById('sch-prev')?.addEventListener('click', () => _step(-1));
    document.getElementById('sch-next')?.addEventListener('click', () => _step(1));
    document.querySelectorAll('.sch-seg [data-mode]').forEach(b => b.addEventListener('click', () => _go(_anchor, b.dataset.mode)));
    document.getElementById('sch-create')?.addEventListener('click', () => _openMeetingModal(_dateStr(_anchor)));

    const rail = document.getElementById('sch-rail');
    rail?.addEventListener('click', (e) => {
      const day = e.target.closest('[data-mini]');
      if (day) { _go(new Date(day.dataset.mini + 'T00:00:00')); return; }
      const nav = e.target.closest('[data-mini-nav]');
      if (nav) {
        _mini = new Date(_mini.getFullYear(), _mini.getMonth() + Number(nav.dataset.miniNav), 1);
        rail.innerHTML = _miniHTML();
      }
    });
    rail?.addEventListener('change', (e) => {
      const k = e.target.dataset?.kind;
      if (!k) return;
      if (e.target.checked) _hidden.delete(k); else _hidden.add(k);
      _store.set('sch-hidden', [..._hidden].join(','));
      document.getElementById('sch-main').innerHTML = _mode === 'month' ? _monthHTML() : _timeGridHTML();
      if (_mode !== 'month') { _startNowTimer(); }
    });

    // One delegated handler for the whole calendar body (it is re-rendered
    // by the show/hide toggles, so per-element listeners would be lost).
    const main = document.getElementById('sch-main');
    main?.addEventListener('click', (e) => {
      const ev = e.target.closest('[data-ev]');
      if (ev) { e.stopPropagation(); _openPopover(ev.dataset.ev, ev); return; }
      // With details open, a click elsewhere only closes them (as in Google Calendar).
      if (document.getElementById('sch-pop')) { e.stopPropagation(); _closePopover(); return; }
      const go = e.target.closest('[data-goto]');
      if (go) { _go(new Date(go.dataset.goto + 'T00:00:00'), 'day'); return; }
      // Empty month cell → schedule that day. On a phone the cells hold only
      // dots, so a tap opens the day instead.
      const cell = e.target.closest('.sch-mcell');
      if (cell) {
        if (_isPhone()) _go(new Date(cell.dataset.date + 'T00:00:00'), 'day');
        else _openMeetingModal(cell.dataset.date);
        return;
      }
      // Empty slot on the hour grid → schedule at that half hour.
      const col = e.target.closest('.sch-col');
      if (col) {
        const y = e.clientY - col.getBoundingClientRect().top;
        const mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor((y / HOUR_PX) * 2) * 30));
        _openMeetingModal(col.dataset.date, String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'));
      }
    });

    // Keyboard shortcuts, as in Google Calendar — never while typing or with a dialog open.
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') { _closePopover(); return; }
      if (document.getElementById('sch-meeting-modal-overlay') || document.querySelector('.modal-overlay:not(.hidden)')) return;
      const k = e.key.toLowerCase();
      if (k === 't') _go(new Date());
      else if (k === 'd') _go(_anchor, 'day');
      else if (k === 'w') _go(_anchor, 'week');
      else if (k === 'm') _go(_anchor, 'month');
      else if (k === 'j' || k === 'n') _step(1);
      else if (k === 'k' || k === 'p') _step(-1);
      else if (k === 'c') _openMeetingModal(_dateStr(_anchor));
      else return;
      e.preventDefault();
    }, { signal });
    document.addEventListener('click', (e) => {
      const pop = document.getElementById('sch-pop');
      if (pop && !pop.contains(e.target)) _closePopover();
    }, { signal });
  }

  /* ── Event details popover ────────────────────────────────────────── */
  function _closePopover() { document.getElementById('sch-pop')?.remove(); }

  const ICON = {
    clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    video: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3z"/></svg>',
    people: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
    note: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    user: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    flag: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  };
  const _row = (icon, html) => html ? `<div class="sch-pop-row">${ICON[icon]}<div>${html}</div></div>` : '';

  function _openPopover(ref, anchorEl) {
    _closePopover();
    const [kind, ds, idx] = ref.split(':');
    const info = _byDate.get(ds) || { holiday: null, tasks: [], meetings: [], leaves: [], birthdays: [] };
    let colour, title, body = '', actions = '', when = _fmtLongDate(ds);
    if (kind === 'meeting') {
      const m = info.meetings[Number(idx)];
      if (!m) return;
      colour = 'var(--color-purple)'; title = m.title;
      if (m.startTime) when += ` · ${_fmtTime(m.startTime)}${m.endTime ? ' – ' + _fmtTime(m.endTime) : ''}`;
      const isLink = /^https?:\/\//i.test(m.location || '');
      body = (isLink ? _row('video', `<a href="${esc(m.location)}" target="_blank" rel="noopener" class="btn-primary" style="display:inline-flex;padding:6px 14px;font-size:12.5px;text-decoration:none;">Join meeting</a>`) : _row('pin', esc(m.location || '')))
        + _row('people', m.attendees ? esc(m.attendees) : '')
        + _row('note', m.notes ? esc(m.notes) : '')
        + _row('user', m.createdByName ? `Organised by ${esc(m.createdByName)}` : '');
      const me = window.currentUser;
      if (_canManage(m)) actions += `<button type="button" class="btn-secondary" data-act="cancel" data-id="${esc(m.id)}" style="color:var(--color-danger-text);">Cancel meeting</button>`;
      else if (_isAttendee(m) && m.createdBy !== me?.id) actions += `<button type="button" class="btn-secondary" data-act="decline" data-id="${esc(m.id)}">Decline</button>`;
    } else if (kind === 'task') {
      const t = info.tasks[Number(idx)];
      if (!t) return;
      colour = 'var(--color-warning)'; title = t.description;
      when = 'Due ' + when;
      const status = t.status === 'done' ? 'Done' : t.status === 'leave' ? 'On leave' : 'Pending';
      body = _row('user', esc(t.doer || ''))
        + _row('flag', esc([status, t.priority].filter(Boolean).join(' · ')))
        + _row('note', 'Open <b>All Tasks</b> to update it.');
    } else if (kind === 'leave') {
      const l = (info.leaves || [])[Number(idx)];
      if (!l) return;
      colour = 'var(--color-success)'; title = `${l.name || 'Employee'} — on leave`;
      when = l.fromDate === l.toDate ? _fmtLongDate(l.fromDate) : `${_fmtLongDate(l.fromDate)} – ${_fmtLongDate(l.toDate)}`;
      body = _row('flag', esc([l.leaveType, l.halfDay && l.halfDay !== 'full' ? l.halfDay + ' half' : ''].filter(Boolean).join(' · ')))
        + _row('note', 'Approved leave — from HR → Leave Management.');
    } else if (kind === 'birthday') {
      const b = (info.birthdays || [])[Number(idx)];
      if (!b) return;
      colour = 'var(--color-info)'; title = `🎂 ${b.name}'s birthday`;
      body = _row('note', 'From the Employee Master.');
    } else {
      if (!info.holiday) return;
      colour = 'var(--color-danger)'; title = info.holiday.name;
      body = _row('note', 'Company holiday — from HR → Leave Management.');
    }

    document.body.insertAdjacentHTML('beforeend', `
      <div class="sch-pop" id="sch-pop" role="dialog" aria-label="${esc(title)}">
        <div class="sch-pop-top"><button type="button" class="sch-icon-btn" data-act="close" aria-label="Close">${ICON.close}</button></div>
        <h3><i style="background:${colour};"></i><span>${esc(title)}</span></h3>
        <div class="sch-pop-when">${when}</div>
        ${body}
        ${actions ? `<div class="sch-pop-actions">${actions}</div>` : ''}
      </div>`);
    const pop = document.getElementById('sch-pop');
    // Beside the clicked item, flipped / clamped to stay on screen.
    const r = anchorEl.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = r.right + 8;
    if (left + pw > vw - 12) left = r.left - pw - 8;
    if (left < 12) left = Math.max(12, Math.min(vw - pw - 12, r.left));
    let top = Math.min(Math.max(12, r.top), vh - ph - 12);
    if (left === Math.max(12, Math.min(vw - pw - 12, r.left)) && r.bottom + ph + 8 < vh) top = r.bottom + 6;
    pop.style.left = left + 'px'; pop.style.top = Math.max(12, top) + 'px';

    pop.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') return _closePopover();
      _closePopover();
      if (b.dataset.act === 'cancel') return _deleteMeeting(b.dataset.id);
      if (b.dataset.act === 'decline') return _declineMeeting(b.dataset.id);
    });
  }

  async function _declineMeeting(id) {
    if (!await Utils.showConfirm('Decline this meeting? It will be removed from your calendar.', { title: 'Decline Meeting', confirmText: 'Decline' })) return;
    try {
      await Utils.apiFetch('/api/meetings/decline?id=' + encodeURIComponent(id), { method: 'PATCH' });
      Utils.showToast('Meeting declined');
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


  // "10:00" + "PM" -> "22:00". Returns '' on anything that doesn't parse as
  // a 1-12 hour, 0-59 minute clock time (the Start Time field is free text,
  // matching the reference design, so it needs real validation before use).
  // "10", "10:30", "10.30", "1030", "10:30 pm", or 24-hour "14:30" (which
  // overrides the AM/PM pick). '' when it can't be read.
  function _to24Hour(text, ampm) {
    let t = String(text || '').trim().toLowerCase();
    const suffix = t.match(/\s*([ap])\.?m?\.?$/);
    if (suffix) { ampm = suffix[1] === 'p' ? 'PM' : 'AM'; t = t.slice(0, suffix.index).trim(); }
    const m = t.match(/^(\d{1,2})(?:\s*[:.\-\s]\s*(\d{2})|(\d{2}))?$/);
    if (!m) return '';
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2] || m[3] || '0', 10);
    if (h > 23 || min > 59) return '';
    if (h === 0 || h > 12) return h <= 23 && !suffix ? String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') : '';
    if (ampm === 'AM') h = (h === 12) ? 0 : h;
    else h = (h === 12) ? 12 : h + 12;
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
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
    _closePopover();
    _closeMeetingModal();
    const users = await _loadUsers();
    const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border-base);border-radius:8px;font-size:13px;color:var(--text-primary);background:var(--surface);outline:none;';
    const labelStyle = 'display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:5px;';
    const DURATIONS = [['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hour'], ['90', '1.5 hours'], ['120', '2 hours'], ['', 'Custom']];
    const FREQUENCIES = [['', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];

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
            <div style="display:flex;gap:6px;">
              <input id="sch-start-text" type="text" autocomplete="off" placeholder="e.g. 10:30" style="${inputStyle}" />
              <select id="sch-start-ampm" style="${inputStyle}width:76px;flex:0 0 76px;background:var(--surface);">
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
          <div>
            <label style="${labelStyle}">End Time</label>
            <input id="sch-end" type="time" disabled style="${inputStyle}background:var(--bg-subtle,#f3f4f6);color:var(--text-muted);cursor:not-allowed;" />
          </div>
        </div>
        <div>
          <label style="${labelStyle}">Frequency</label>
          <select id="sch-frequency" style="${inputStyle}background:var(--surface);">${FREQUENCIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
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

    // Duration + the Start Time text/AM-PM pair drive the (read-only) End
    // Time — the reference design shows End Time greyed out because it's
    // computed, not typed.
    const recomputeEnd = () => {
      const mins = parseInt(document.getElementById('sch-duration').value, 10);
      const start = _to24Hour(document.getElementById('sch-start-text').value, document.getElementById('sch-start-ampm').value);
      document.getElementById('sch-end').value = (start && Number.isFinite(mins)) ? _addMinutes(start, mins) : '';
    };
    document.getElementById('sch-duration').addEventListener('change', recomputeEnd);
    document.getElementById('sch-start-text').addEventListener('input', recomputeEnd);
    document.getElementById('sch-start-ampm').addEventListener('change', recomputeEnd);
    if (startTime) {
      const [h, m] = startTime.split(':').map(Number);
      document.getElementById('sch-start-text').value = `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
      document.getElementById('sch-start-ampm').value = h >= 12 ? 'PM' : 'AM';
      recomputeEnd();
    }

    document.getElementById('sch-save').addEventListener('click', async () => {
      const title = document.getElementById('sch-title').value.trim();
      const date = document.getElementById('sch-date').value;
      const startTime = _to24Hour(document.getElementById('sch-start-text').value, document.getElementById('sch-start-ampm').value);
      if (!title || !date) { Utils.showToast('Title and date are required', 'error'); return; }
      if (document.getElementById('sch-start-text').value.trim() && !startTime) { Utils.showToast('Start time should look like 10:30 (or 10.30)', 'error'); return; }
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
            frequency: document.getElementById('sch-frequency').value,
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
        _mini = new Date(_anchor.getFullYear(), _anchor.getMonth(), 1);
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
