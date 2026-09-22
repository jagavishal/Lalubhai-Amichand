window.Pages = window.Pages || {};

/* Scheduler — one calendar for the three date-bound things people already
   track elsewhere in the app: holidays (HR → Leave Management), tasks (All
   Tasks / delegations), and meetings (new here — the only thing this page
   itself creates). It reads all three from one call, GET /api/scheduler, and
   shows them on a month grid with a per-day detail panel next to it. */
window.Pages.scheduler = (() => {
  const esc = Utils.esc;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_START_HOUR = 8;   // the day panel's timeline rail — 8 AM to 7 PM
  const DAY_END_HOUR   = 19;

  let _view = new Date();          // month currently shown (day is ignored)
  let _selected = _todayStr();     // 'YYYY-MM-DD' of the day panel on the right
  let _data = { weekOffs: ['0'], holidays: [], tasks: [], meetings: [] };
  let _byDate = new Map();         // date -> { holiday, tasks:[], meetings:[] }
  let _users = null;                // lazy-loaded for the attendee picker

  function _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function _dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // The 42-cell grid: the Sunday on/before the 1st through 6 full weeks.
  function _gridDays(view) {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }
  function _fmtTime(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h)) return hhmm;
    const ap = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return `${h12}:${String(m || 0).padStart(2, '0')} ${ap}`;
  }
  function _fmtDayShort(dateStr) {
    const [y, m, day] = dateStr.split('-');
    return `${day}-${m}-${y}`;
  }

  function _isAdmin() {
    const r = window.currentUser?.roles || [];
    const arr = Array.isArray(r) ? r : String(r).split(',');
    return arr.some(x => x.trim() === 'Admin' || x.trim() === 'HOD');
  }

  /* ── Data loading ─────────────────────────────────────────────────── */
  async function loadData() {
    const days = _gridDays(_view);
    const from = _dateStr(days[0]);
    const to = _dateStr(days[days.length - 1]);
    try {
      const res = await Utils.apiFetch(`/api/scheduler?from=${from}&to=${to}`);
      _data = res || { weekOffs: ['0'], holidays: [], tasks: [], meetings: [] };
    } catch (e) {
      Utils.showToast(e.message || 'Failed to load scheduler', 'error');
      _data = { weekOffs: ['0'], holidays: [], tasks: [], meetings: [] };
    }
    _reindex();
  }

  function _reindex() {
    _byDate = new Map();
    const bucket = (date) => {
      if (!_byDate.has(date)) _byDate.set(date, { holiday: null, tasks: [], meetings: [] });
      return _byDate.get(date);
    };
    for (const h of _data.holidays || []) bucket(h.date).holiday = h;
    for (const t of _data.tasks || []) if (t.dueDate) bucket(t.dueDate).tasks.push(t);
    for (const m of _data.meetings || []) bucket(m.date).meetings.push(m);
  }

  function _isWeekOff(d) {
    return (_data.weekOffs || []).includes(String(d.getDay()));
  }

  /* ── Month grid ──────────────────────────────────────────────────────
     A flush, hairline-bordered table (not individually-boxed cards) — every
     cell carries its own right/bottom border, and the wrapper's top/left
     border closes the rectangle, so no index math is needed to skip the
     outer edges. */
  const ITEM_DOT = { task: 'var(--color-warning)', meeting: 'var(--color-purple)' };
  function _dayCellHTML(d) {
    const dateStr = _dateStr(d);
    const inMonth = d.getMonth() === _view.getMonth();
    const isToday = dateStr === _todayStr();
    const isSelected = dateStr === _selected;
    const info = _byDate.get(dateStr) || { holiday: null, tasks: [], meetings: [] };
    const off = !info.holiday && _isWeekOff(d);

    const items = [
      ...info.meetings.map(m => ({ kind: 'meeting', label: m.title, muted: false })),
      // 'leave': the doer's approved leave covers this checklist occurrence —
      // muted like done, but not struck through (it was never completed).
      ...info.tasks.map(t => ({ kind: 'task', label: t.description, done: t.status === 'done', muted: t.status === 'done' || t.status === 'leave' })),
    ];
    const shown = items.slice(0, 3);
    const more = items.length - shown.length;

    const itemHTML = shown.map(it => {
      const color = it.muted ? 'var(--text-muted)' : (it.kind === 'meeting' ? 'var(--color-purple-text)' : 'var(--color-warning-text)');
      return `<div style="display:flex;align-items:center;gap:4px;overflow:hidden;">
          <span style="width:5px;height:5px;border-radius:50%;flex-shrink:0;background:${ITEM_DOT[it.kind]};opacity:${it.muted ? '.4' : '1'};"></span>
          <span style="font-size:10.5px;font-weight:500;color:${color};text-decoration:${it.done ? 'line-through' : 'none'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(it.label)}">${esc(it.label)}</span>
        </div>`;
    }).join('');
    const moreHTML = more > 0 ? `<div style="font-size:10px;font-weight:600;color:var(--text-muted);padding-left:9px;">+ ${more} more</div>` : '';

    const tagHTML = info.holiday
      ? `<span style="font-size:10px;font-weight:700;color:var(--color-danger);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:64px;" title="${esc(info.holiday.name)}">${esc(info.holiday.name)}</span>`
      : off
      ? `<span style="font-size:10px;font-weight:700;color:var(--color-danger);">Off</span>`
      : '';

    const numHTML = (isSelected || isToday)
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;border-radius:50%;background:${isSelected ? 'var(--color-primary)' : 'transparent'};color:${isSelected ? 'var(--color-primary-text)' : 'var(--color-primary)'};border:${isSelected ? 'none' : '1.5px solid var(--color-primary)'};">${d.getDate()}</span>`
      : d.getDate();

    return `
      <div class="sch-cell" data-date="${dateStr}"
        style="
          min-height:96px;padding:6px 7px;cursor:pointer;
          background:${isSelected ? 'var(--color-primary-light)' : 'var(--surface)'};
          border-right:1px solid var(--border-light);border-bottom:1px solid var(--border-light);
          opacity:${inMonth ? '1' : '0.4'};
          display:flex;flex-direction:column;gap:4px;transition:background .12s;
        ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
          <span style="font-size:12.5px;font-weight:600;color:var(--text-primary);">${numHTML}</span>
          ${tagHTML}
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;overflow:hidden;">${itemHTML}${moreHTML}</div>
      </div>`;
  }

  function _gridHTML() {
    const days = _gridDays(_view);
    const header = DOW.map(d => `<div style="font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);text-align:center;padding:4px 0 8px;">${d}</div>`).join('');
    const cells = days.map(_dayCellHTML).join('');
    return `
      <div style="display:grid;grid-template-columns:repeat(7,1fr);">${header}</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--border-light);border-left:1px solid var(--border-light);border-radius:8px 8px 0 0;overflow:hidden;">${cells}</div>`;
  }

  /* ── Day panel ────────────────────────────────────────────────────── */
  function _dayPanelHTML() {
    const info = _byDate.get(_selected) || { holiday: null, tasks: [], meetings: [] };
    const d = new Date(_selected + 'T00:00:00');
    const off = !info.holiday && _isWeekOff(d);
    const me = window.currentUser;

    const banner = info.holiday
      ? `<div style="padding:8px 12px;border-radius:8px;background:var(--color-danger-bg);color:var(--color-danger-text);font-size:12px;font-weight:600;">${esc(info.holiday.name)}</div>`
      : off
      ? `<div style="padding:8px 12px;border-radius:8px;background:var(--surface-alt);color:var(--text-muted);font-size:12px;font-weight:600;">Week off</div>`
      : '';

    const tasksHTML = info.tasks.length
      ? info.tasks.map(t => {
        const dotColor = t.status === 'done' ? 'var(--color-success)' : t.status === 'leave' ? 'var(--text-muted)' : 'var(--color-warning)';
        return `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;background:var(--surface-alt);">
          <div style="width:7px;height:7px;border-radius:50%;margin-top:4px;flex-shrink:0;background:${dotColor};"></div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:12.5px;font-weight:600;color:var(--text-primary);text-decoration:${t.status === 'done' ? 'line-through' : 'none'};">${esc(t.description)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${esc(t.doer || '')}${t.status === 'leave' ? ' · On Leave' : (t.priority ? ' · ' + esc(t.priority) : '')}</div>
          </div>
        </div>`;
      }).join('')
      : `<div style="font-size:12px;color:var(--text-muted);padding:4px 2px;">No tasks due</div>`;

    // Timeline rail for meetings — an hour label column plus a relative box per
    // meeting, positioned by its start time. Meetings outside DAY_START/END are
    // still listed below the rail so nothing silently disappears off-screen.
    const rangeMins = (DAY_END_HOUR - DAY_START_HOUR) * 60;
    const toMins = (hhmm) => {
      if (!hhmm) return null;
      const [h, m] = hhmm.split(':').map(Number);
      return Number.isNaN(h) ? null : h * 60 + (m || 0);
    };
    const inRange = info.meetings.filter(m => {
      const start = toMins(m.startTime);
      return start !== null && start >= DAY_START_HOUR * 60 && start < DAY_END_HOUR * 60;
    });
    const hourLabels = [];
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) hourLabels.push(h);
    const railHTML = hourLabels.map((h, i) => `
      <div style="position:absolute;left:0;right:0;top:${(i / (hourLabels.length - 1)) * 100}%;border-top:1px solid var(--border-light);">
        <span style="position:relative;top:-7px;left:0;font-size:9.5px;color:var(--text-muted);background:var(--surface);padding-right:4px;">${_fmtTime(`${String(h).padStart(2, '0')}:00`)}</span>
      </div>`).join('');
    const canManage = (m) => me && (_isAdmin() || m.createdBy === me.id);
    const meetingBlocks = inRange.map(m => {
      const start = toMins(m.startTime);
      const end = toMins(m.endTime) ?? (start + 30);
      const top = ((start - DAY_START_HOUR * 60) / rangeMins) * 100;
      const height = Math.max(((end - start) / rangeMins) * 100, 4);
      return `
        <div class="sch-meeting-block" data-id="${esc(m.id)}"
          style="position:absolute;left:52px;right:4px;top:${top}%;height:${height}%;min-height:20px;
            background:var(--color-purple-bg);border-left:3px solid var(--color-purple);border-radius:0 6px 6px 0;
            padding:3px 8px;overflow:hidden;box-sizing:border-box;">
          <div style="font-size:11.5px;font-weight:700;color:var(--color-purple-text);line-height:1.25;">${esc(m.title)}</div>
          <div style="font-size:10px;color:var(--color-purple-text);opacity:.8;">${_fmtTime(m.startTime)}${m.endTime ? ' – ' + _fmtTime(m.endTime) : ''}</div>
        </div>`;
    }).join('');

    // The timeline above is a purely visual aid (position by start time); every
    // meeting still gets a real row here too, so Cancel is always reachable —
    // a block on the rail has no room for a delete button of its own.
    const allRowsHTML = info.meetings.map(m => _meetingRowHTML(m, canManage(m))).join('');

    return `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);">
            Day <span style="color:var(--text-muted);font-weight:500;">·</span> ${_fmtDayShort(_selected)}
          </div>
          <button id="sch-add-btn" title="Schedule a meeting on this day" style="width:26px;height:26px;border-radius:7px;border:none;background:var(--color-primary-light);color:var(--color-primary-strong);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        ${banner}

        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">Tasks Due</div>
          <div style="display:flex;flex-direction:column;gap:6px;">${tasksHTML}</div>
        </div>

        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">Meetings</div>
          ${info.meetings.length ? '' : '<div style="font-size:12px;color:var(--text-muted);padding:4px 2px;">Nothing scheduled</div>'}
          ${inRange.length ? `
            <div style="position:relative;height:280px;border-top:1px solid var(--border-light);">
              ${railHTML}
              ${meetingBlocks}
            </div>` : ''}
          ${allRowsHTML}
        </div>
      </div>`;
  }

  function _meetingRowHTML(m, canManage) {
    return `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:8px;background:var(--color-purple-bg);margin-top:6px;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:12px;font-weight:700;color:var(--color-purple-text);">${esc(m.title)}</div>
          <div style="font-size:10.5px;color:var(--color-purple-text);opacity:.8;">
            ${m.startTime ? _fmtTime(m.startTime) + (m.endTime ? ' – ' + _fmtTime(m.endTime) : '') : 'No time set'}
            ${m.location ? ' · ' + esc(m.location) : ''}
          </div>
          ${m.attendees ? `<div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">With ${esc(m.attendees)}</div>` : ''}
        </div>
        ${canManage ? `<button class="sch-meeting-del" data-id="${esc(m.id)}" title="Cancel meeting" style="flex-shrink:0;width:22px;height:22px;border-radius:6px;border:none;background:transparent;color:var(--color-purple-text);cursor:pointer;display:flex;align-items:center;justify-content:center;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>` : ''}
      </div>`;
  }

  /* ── Page shell ───────────────────────────────────────────────────── */
  function renderPage() {
    const el = document.getElementById('main-content');
    if (!el) return;

    el.innerHTML = `
      <div style="max-width:1280px;margin:0 auto;padding:4px 0;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>
          <h1 style="font-size:18px;font-weight:700;color:var(--text-primary);letter-spacing:-0.02em;margin:0;">Scheduler</h1>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <button id="sch-today" class="btn-secondary" style="padding:7px 12px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;">Today</button>
            <div style="display:flex;align-items:center;gap:2px;border:1.5px solid var(--border-base);border-radius:8px;padding:2px;">
              <button id="sch-prev" style="width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
              <button id="sch-next" style="width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
            </div>
            <div id="sch-month-label" style="font-size:16px;font-weight:700;color:var(--text-primary);min-width:150px;">${MONTH_NAMES[_view.getMonth()]} ${_view.getFullYear()}</div>
          </div>
          <button id="sch-schedule-btn" class="btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:9px;font-size:13px;font-weight:600;border:none;cursor:pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            Schedule
          </button>
        </div>

        <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
          <div id="sch-grid-wrap" style="flex:1 1 640px;min-width:0;background:var(--surface);border:1px solid var(--border-light);border-radius:12px;padding:14px;box-shadow:var(--shadow-xs);">
            <div id="sch-grid">${_gridHTML()}</div>
          </div>
          <div id="sch-day-panel" style="flex:1 1 300px;max-width:340px;min-width:280px;background:var(--surface);border:1px solid var(--border-light);border-radius:12px;padding:16px;box-shadow:var(--shadow-xs);">
            ${_dayPanelHTML()}
          </div>
        </div>
      </div>`;

    _bindPage();
  }

  function _bindPage() {
    document.getElementById('sch-today')?.addEventListener('click', () => {
      _view = new Date();
      _selected = _todayStr();
      loadData().then(renderPage);
    });
    document.getElementById('sch-prev')?.addEventListener('click', () => _changeMonth(-1));
    document.getElementById('sch-next')?.addEventListener('click', () => _changeMonth(1));

    document.querySelectorAll('.sch-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        _selected = cell.dataset.date;
        renderPage();
      });
    });

    document.getElementById('sch-schedule-btn')?.addEventListener('click', () => _openMeetingModal(_selected));
    document.getElementById('sch-add-btn')?.addEventListener('click', () => _openMeetingModal(_selected));
    document.querySelectorAll('.sch-meeting-del').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); _deleteMeeting(btn.dataset.id); });
    });
  }

  function _changeMonth(delta) {
    _view = new Date(_view.getFullYear(), _view.getMonth() + delta, 1);
    // Keep the selection inside the newly visible month so the day panel
    // doesn't keep showing a date that has scrolled off the grid.
    const inView = new Date(_selected + 'T00:00:00').getMonth() === _view.getMonth()
      && new Date(_selected + 'T00:00:00').getFullYear() === _view.getFullYear();
    if (!inView) _selected = _dateStr(new Date(_view.getFullYear(), _view.getMonth(), 1));
    loadData().then(renderPage);
  }

  /* ── Schedule-a-meeting modal ─────────────────────────────────────── */
  async function _loadUsers() {
    if (_users) return _users;
    try { _users = await Utils.apiFetch('/api/users?lite=1') || []; }
    catch { _users = []; }
    return _users;
  }

  function _closeMeetingModal() {
    document.getElementById('sch-meeting-modal-overlay')?.remove();
  }

  async function _openMeetingModal(dateStr) {
    _closeMeetingModal();
    const users = await _loadUsers();
    const userOptions = users.map(u => `<option value="${esc(u.name)}">${esc(u.name)}${u.department ? ' — ' + esc(u.department) : ''}</option>`).join('');
    const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid var(--border-base);border-radius:8px;font-size:13px;color:var(--text-primary);background:var(--surface);outline:none;';
    const labelStyle = 'display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:5px;';

    const bodyHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="${labelStyle}">Title <span style="color:var(--color-danger)">*</span></label>
          <input id="sch-title" style="${inputStyle}" placeholder="e.g. Vendor review call" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div>
            <label style="${labelStyle}">Date <span style="color:var(--color-danger)">*</span></label>
            <input id="sch-date" type="date" value="${dateStr}" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">Start Time</label>
            <input id="sch-start" type="time" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">End Time</label>
            <input id="sch-end" type="time" style="${inputStyle}" />
          </div>
        </div>
        <div>
          <label style="${labelStyle}">Attendees</label>
          <select id="sch-attendees" multiple size="5" style="${inputStyle}">${userOptions}</select>
          <div style="font-size:10.5px;color:var(--text-muted);margin-top:3px;">Ctrl/Cmd-click to select more than one</div>
        </div>
        <div>
          <label style="${labelStyle}">Location <span style="color:var(--text-muted);font-weight:400;text-transform:none;">(optional)</span></label>
          <input id="sch-location" style="${inputStyle}" placeholder="Meeting room / link" />
        </div>
        <div>
          <label style="${labelStyle}">Notes <span style="color:var(--text-muted);font-weight:400;text-transform:none;">(optional)</span></label>
          <textarea id="sch-notes" rows="3" style="${inputStyle}resize:none;font-family:inherit;"></textarea>
        </div>
      </div>`;
    const footerHTML = `
      <button type="button" id="sch-cancel" class="btn-secondary">Cancel</button>
      <button type="button" id="sch-save" class="btn-primary">Schedule Meeting</button>`;

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

    document.getElementById('sch-save').addEventListener('click', async () => {
      const title = document.getElementById('sch-title').value.trim();
      const date = document.getElementById('sch-date').value;
      if (!title || !date) { Utils.showToast('Title and date are required', 'error'); return; }
      const attendees = [...document.getElementById('sch-attendees').selectedOptions].map(o => o.value);
      const btn = document.getElementById('sch-save');
      btn.disabled = true; btn.textContent = 'Scheduling…';
      try {
        await Utils.apiFetch('/api/meetings', {
          method: 'POST',
          body: JSON.stringify({
            title, date,
            startTime: document.getElementById('sch-start').value,
            endTime: document.getElementById('sch-end').value,
            attendees,
            location: document.getElementById('sch-location').value.trim(),
            notes: document.getElementById('sch-notes').value.trim(),
          }),
        });
        _closeMeetingModal();
        Utils.showToast('Meeting scheduled', 'success');
        _selected = date;
        await loadData();
        renderPage();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Schedule Meeting';
        Utils.showToast(e.message || 'Failed to schedule meeting', 'error');
      }
    });
  }

  async function _deleteMeeting(id) {
    if (!await Utils.showConfirm('Cancel this meeting?', { danger: true, title: 'Cancel Meeting', confirmText: 'Cancel Meeting' })) return;
    try {
      await Utils.apiFetch('/api/meetings?id=' + encodeURIComponent(id), { method: 'DELETE' });
      Utils.showToast('Meeting cancelled');
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
