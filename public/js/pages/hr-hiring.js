/* =====================================================================
   Hiring & Exit FMS (route 'hr-hiring')
   ---------------------------------------------------------------------
   1. Hiring: job request → HR sends the JD to agencies (CV upload link)
      → CVs to the requester → shortlist → interview on the Scheduler →
      interviewer selects / rejects.
   2. Onboarding: appointment letter → management approves → signed letter
      to the candidate (Accept / with changes / Decline) → login, laptop,
      buddy before joining → joining-day steps.
   3. Exit: notice → last working day → final dues (Jayesh, Mahendrabhai,
      manager) → signed leave contract uploaded.
   Server side and the full flow: backend/hiring.js.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-hiring'] = (() => {
  const H = window.HR;
  const esc = H.esc;

  let D = null;
  let _tab = 'action';
  const _f = { q: '', cand: 'Active', exit: 'Open', req: 'Open' };

  const VARIANT = {
    Open: 'info', Sourcing: 'info', 'On Hold': 'warning', Closed: 'neutral', Cancelled: 'neutral',
    'CV Received': 'info', Shortlisted: 'purple', 'CV Rejected': 'neutral', 'Interview Scheduled': 'warning',
    Selected: 'success', 'Not Selected': 'danger', 'Offer Pending Approval': 'warning', 'Offer Revision': 'purple',
    'Offer Approved': 'info', 'Offer Sent': 'info', 'Candidate Asked Changes': 'warning', 'Offer Declined': 'danger',
    'Offer Accepted': 'success', Joined: 'success', Onboarded: 'success', Dropped: 'neutral',
    'Notice Received': 'warning', 'Dues Clearance': 'warning', 'Leave Contract Pending': 'info', Completed: 'success', Withdrawn: 'neutral',
  };
  const pill = (s) => (s ? H.pill(s, VARIANT[s] || 'neutral') : '—');
  const docHref = (kind, id, n) => `/api/hiring/${kind}/${encodeURIComponent(id)}/documents/${n}`;
  const KIND = { jd: 'Job description', cv: 'CV', other: 'Other', offer: 'Appointment letter (draft)', signed: 'Signed appointment letter',
    notice: 'Notice / resignation', contract: 'Leave contract (sent)', signed_contract: 'Signed leave contract' };
  const userName = (id) => D.users.find((u) => u.id === id)?.name || '';
  const reqOf = (c) => D.requests.find((r) => r.id === c.request_id);
  const money = (n) => (n == null ? '' : '₹' + Number(n).toLocaleString('en-IN'));
  const salary = (r) => (r.salary_min != null || r.salary_max != null ? [money(r.salary_min), money(r.salary_max)].filter(Boolean).join(' – ') : '');
  const fmtWall = (w) => {
    if (!w) return '';
    const [d, t] = w.split(' ');
    const [h, m] = (t || '0:0').split(':').map(Number);
    return `${H.fmtDate(d)} ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };

  const reqNeeds = (r) => r.can.agencies && r.status === 'Open';
  const candNeeds = (c) => c.can.screen || c.can.result || c.can.offer || c.can.offerDecide || c.can.sendOffer
    || c.can.changesDecide || c.can.joined || (c.can.checklist && c.status === 'Joined')
    || (c.can.schedule && c.status === 'Shortlisted');
  const exitNeeds = (x) => x.can.confirm || x.can.myDue || x.can.complete;

  /* ── Load ─────────────────────────────────────────────────────────── */

  async function load() {
    D = await H.api('/api/hiring/data');
    if (!tabsFor().some((t) => t.key === _tab)) _tab = 'action';
  }
  async function refresh() {
    try { await load(); render(); } catch (e) { H.fail(e); }
  }

  function tabsFor() {
    const act = D.requests.filter(reqNeeds).length + D.candidates.filter(candNeeds).length + D.exits.filter(exitNeeds).length;
    const open = (list, closed) => list.filter((x) => !closed.includes(x.status)).length;
    const t = [{ key: 'action', label: 'Needs My Action', count: act }];
    t.push({ key: 'requests', label: 'Job Requests', count: open(D.requests, ['Closed', 'Cancelled']) });
    if (D.candidates.length || D.me.all) t.push({ key: 'candidates', label: 'Candidates', count: D.candidates.filter((c) => D.lists.C_HIRING.includes(c.status)).length });
    if (D.me.all || D.candidates.some((c) => D.lists.C_ONBOARD.includes(c.status))) {
      t.push({ key: 'onboarding', label: 'Onboarding', count: D.candidates.filter((c) => D.lists.C_ONBOARD.includes(c.status)).length });
    }
    t.push({ key: 'exit', label: 'Exit', count: D.exits.filter((x) => D.lists.X_OPEN.includes(x.status)).length });
    if (D.me.staff) t.push({ key: 'agencies', label: 'Agencies' });
    if (D.me.manager) t.push({ key: 'settings', label: 'Settings' });
    return t;
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const actions = [
      '<button id="hh-new" class="btn-primary btn-sm">+ Job Request</button>',
      D.me.staff ? '<button id="hh-exit" class="btn-secondary btn-sm">+ Record Exit</button>'
        : D.self ? '<button id="hh-notice" class="btn-secondary btn-sm">Submit My Notice</button>' : '',
    ].join(' ');
    el.innerHTML = `<div class="animate-fade-in">
      <style>
        @media (max-width: 767px) {
          .hh-filt { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px !important; }
          .hh-filt > input, .hh-filt > select { max-width:none !important; min-height:40px; }
          .hh-filt > input { grid-column:1 / -1; }
          .hh-two { grid-template-columns:1fr !important; }
        }
        .hh-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px; }
        .hh-card h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:0 0 10px; }
        .hh-act { border-radius:12px;padding:14px 16px;margin-bottom:14px;border:1px solid #bfdbfe;background:#eff6ff; }
        .hh-act.warn { border-color:#fde68a;background:#fffbeb; }
        .hh-act.good { border-color:#bbf7d0;background:#f0fdf4; }
        .hh-act h3 { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#334155;margin:0 0 10px; }
        .hh-link { color:var(--color-primary);cursor:pointer;font-weight:600;background:none;border:none;padding:0;font:inherit;text-align:left; }
        .hh-link:hover { text-decoration:underline; }
        .hh-doc { display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--color-primary);font-weight:600;word-break:break-all;padding:3px 0;text-decoration:none; }
        .hh-doc:hover { text-decoration:underline; }
        .hh-btns { display:flex;gap:8px;flex-wrap:wrap;margin-top:10px; }
        .hh-flow { display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:11px;color:#64748b;margin:-4px 0 14px; }
        .hh-flow b { background:#f1f5f9;border-radius:999px;padding:3px 9px;font-weight:600;color:#334155; }
        .hh-ck { display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px dashed #e2e8f0; }
        .hh-ck:last-child { border-bottom:0; }
        .hh-ck .dot { width:20px;height:20px;border-radius:50%;flex:0 0 20px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-top:1px; }
        .hh-chk { display:flex;flex-wrap:wrap;gap:4px 14px;max-height:150px;overflow:auto;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 10px; }
        .hh-chk label { display:flex;gap:6px;align-items:center;font-size:12.5px;cursor:pointer; }
      </style>
      ${H.header('Hiring & Exit FMS', 'Job request → agencies → CVs → interview → offer → onboarding · Exit formality', actions)}
      ${H.tabs('hh', tabsFor(), _tab)}
      ${body()}
    </div>`;
    bind();
  }

  function body() {
    switch (_tab) {
      case 'requests': return requestsTab();
      case 'candidates': return candidatesTab();
      case 'onboarding': return onboardingTab();
      case 'exit': return exitTab();
      case 'agencies': return agenciesTab();
      case 'settings': return settingsTab();
      default: return actionTab();
    }
  }

  const flow = (steps) => `<div class="hh-flow">${steps.map((s) => `<b>${esc(s)}</b>`).join('<span>→</span>')}</div>`;
  const search = (ph) => `<input id="hh-q" value="${esc(_f.q)}" placeholder="${esc(ph)}" style="${H.CONTROL}max-width:280px;" />`;
  const matches = (parts) => { const n = _f.q.trim().toLowerCase(); return !n || parts.join(' ').toLowerCase().includes(n); };
  const viewBtn = (kind, id, label, primary) => `<button class="${primary ? 'btn-primary' : 'btn-secondary'} btn-sm" data-${kind}="${esc(id)}">${esc(label)}</button>`;

  /* ── Needs my action ──────────────────────────────────────────────── */

  function candAction(c) {
    const k = c.can;
    if (k.screen) return 'Review CV';
    if (k.result) return 'Record Interview Result';
    if (k.schedule && c.status === 'Shortlisted') return 'Schedule Interview';
    if (k.offer) return c.status === 'Offer Revision' ? 'Upload Revised Letter' : 'Prepare Appointment Letter';
    if (k.offerDecide) return 'Approve Letter';
    if (k.sendOffer) return 'Send Signed Letter';
    if (k.changesDecide) return 'Decide on Changes';
    if (k.joined) return 'Pre-joining Checklist';
    if (k.checklist) return 'Joining-day Checklist';
    return 'Open';
  }
  const exitAction = (x) => (x.can.confirm ? 'Confirm Last Day' : x.can.myDue ? 'Clear My Dues' : x.can.complete ? 'Upload Signed Contract' : 'Open');

  function actionTab() {
    const rows = [
      ...D.requests.filter(reqNeeds).map((r) => ({ at: r.updated_at, row: [
        'Job Request', `<button class="hh-link" data-req="${esc(r.id)}">${esc(r.id)}</button>`,
        `${esc(r.position)}<div style="font-size:11px;color:#94a3b8;">${esc([r.division, r.location].join(' · '))}</div>`,
        pill(r.status), viewBtn('req', r.id, 'Send to Agencies', true)] })),
      ...D.candidates.filter(candNeeds).map((c) => ({ at: c.updated_at, row: [
        D.lists.C_ONBOARD.includes(c.status) ? 'Onboarding' : 'Candidate', `<button class="hh-link" data-cand="${esc(c.id)}">${esc(c.id)}</button>`,
        `${esc(c.name)}<div style="font-size:11px;color:#94a3b8;">${esc(c.designation || c.position)}${c.interview_at && c.status === 'Interview Scheduled' ? ' · ' + esc(fmtWall(c.interview_at)) : ''}</div>`,
        pill(c.status), viewBtn('cand', c.id, candAction(c), true)] })),
      ...D.exits.filter(exitNeeds).map((x) => ({ at: x.updated_at, row: [
        'Exit', `<button class="hh-link" data-exit="${esc(x.id)}">${esc(x.id)}</button>`,
        `${esc(x.employee_name)}<div style="font-size:11px;color:#94a3b8;">${esc(x.department)}${x.last_working_day ? ' · last day ' + H.fmtDate(x.last_working_day) : ''}</div>`,
        pill(x.status), viewBtn('exit', x.id, exitAction(x), true)] })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const C = D.candidates;
    const tiles = D.me.all ? [
      { label: 'Open Positions', value: D.requests.filter((r) => D.lists.R_OPEN.includes(r.status)).length },
      { label: 'In Interview', value: C.filter((c) => c.status === 'Interview Scheduled').length, color: '#d97706' },
      { label: 'Offers Out', value: C.filter((c) => ['Offer Pending Approval', 'Offer Approved', 'Offer Sent', 'Candidate Asked Changes'].includes(c.status)).length, color: '#7c3aed' },
      { label: 'Joining Soon', value: C.filter((c) => c.status === 'Offer Accepted').length, color: '#16a34a' },
      { label: 'Exits in Progress', value: D.exits.filter((x) => D.lists.X_OPEN.includes(x.status)).length, color: '#dc2626' },
    ] : [];
    return `${H.stats(tiles)}
      ${H.table(['Type', 'No.', { label: 'Details', m: 'title' }, 'Status', { label: '', m: 'actions' }], rows.map((x) => x.row),
        { empty: 'Nothing is waiting on you', cards: true })}
      <div style="font-size:11.5px;color:#94a3b8;margin-top:8px;">HR: ${esc(D.people.hr.join(', ') || 'Admins')} · Approving management: ${esc(D.people.mgmt.join(', ') || '—')} · Final dues: ${esc(D.people.dues.join(', ') || '—')} · Inquiry mailbox: ${esc(D.people.inquiry)}</div>`;
  }

  /* ── Job requests ─────────────────────────────────────────────────── */

  function requestsTab() {
    const list = D.requests.filter((r) => {
      if (_f.req === 'Open' && !D.lists.R_OPEN.includes(r.status)) return false;
      if (_f.req !== 'Open' && _f.req !== 'All' && r.status !== _f.req) return false;
      return matches([r.id, r.position, r.division, r.location, r.requested_by_name]);
    });
    const cvs = (r) => D.candidates.filter((c) => c.request_id === r.id);
    return `
      ${flow(['Raise request', 'HR → agencies', 'CVs to requester', 'Shortlist', 'Interview (Scheduler)', 'Select / Reject'])}
      <div class="hh-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        ${search('Search JR no., position, location…')}
        <select id="hh-req-status" style="${H.CONTROL}max-width:200px;">
          ${[['Open', 'All open'], ['All', 'All statuses'], ['Sourcing', 'Sourcing'], ['On Hold', 'On Hold'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled']]
            .map(([v, l]) => `<option value="${v}"${_f.req === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      ${H.table(['JR No.', 'Date', { label: 'Position', m: 'title' }, 'Openings', 'Salary', 'CVs', 'Status', { label: '', m: 'actions' }],
        list.map((r) => {
          const all = cvs(r);
          return [
            `<button class="hh-link" data-req="${esc(r.id)}">${esc(r.id)}</button>`, H.fmtDate(r.created_at),
            `${esc(r.position)}<div style="font-size:11px;color:#94a3b8;">${esc([r.division, r.location, r.requested_by_name].filter(Boolean).join(' · '))}</div>`,
            String(r.openings), esc(salary(r)),
            `${all.length}${all.length ? ` <span style="font-size:11px;color:#94a3b8;">(${all.filter((c) => !['CV Received', 'CV Rejected'].includes(c.status)).length} shortlisted)</span>` : ''}`,
            pill(r.status), viewBtn('req', r.id, reqNeeds(r) ? 'Send to Agencies' : 'Open', reqNeeds(r)),
          ];
        }), { empty: 'No job requests yet — raise one with “+ Job Request”', cards: true, page: { key: 'hh-req', sig: [_f.q, _f.req], onPage: render } })}`;
  }

  /* ── Candidates (hiring pipeline) ─────────────────────────────────── */

  function candidatesTab() {
    const groups = { Active: D.lists.C_HIRING, Selected: ['Selected'], Rejected: ['CV Rejected', 'Not Selected'] };
    const list = D.candidates.filter((c) => {
      if (_f.cand !== 'All' && groups[_f.cand] && !groups[_f.cand].includes(c.status)) return false;
      if (_f.cand !== 'All' && !groups[_f.cand] && c.status !== _f.cand) return false;
      return matches([c.id, c.name, c.position, c.source, c.phone, c.email, c.request_id]);
    });
    return `
      ${flow(['CV Received', 'Shortlisted', 'Interview Scheduled', 'Selected → Onboarding'])}
      <div class="hh-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        ${search('Search name, position, agency…')}
        <select id="hh-cand-status" style="${H.CONTROL}max-width:220px;">
          ${[['Active', 'In the pipeline'], ['All', 'All candidates'], ['CV Received', 'CV Received'], ['Shortlisted', 'Shortlisted'], ['Interview Scheduled', 'Interview Scheduled'], ['Selected', 'Selected'], ['Rejected', 'Rejected']]
            .map(([v, l]) => `<option value="${v}"${_f.cand === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        ${D.requests.some((r) => r.can.addCv) ? '<button class="btn-secondary btn-sm" id="hh-addcv">+ Add CV</button>' : ''}
      </div>
      ${H.table(['ID', { label: 'Candidate', m: 'title' }, 'Position', 'Source', 'Interview', 'Status', { label: '', m: 'actions' }],
        list.map((c) => [
          `<button class="hh-link" data-cand="${esc(c.id)}">${esc(c.id)}</button>`,
          `${esc(c.name)}<div style="font-size:11px;color:#94a3b8;">${esc([c.experience, c.expected_ctc ? 'exp. ' + c.expected_ctc : ''].filter(Boolean).join(' · '))}</div>`,
          `${esc(c.position)}<div style="font-size:11px;color:#94a3b8;">${esc(c.request_id)}</div>`, esc(c.source),
          c.interview_at ? `${esc(fmtWall(c.interview_at))}<div style="font-size:11px;color:#94a3b8;">Round ${c.interview_round}</div>` : '—',
          pill(c.status), viewBtn('cand', c.id, candAction(c), candNeeds(c)),
        ]), { empty: 'No candidates here', cards: true, page: { key: 'hh-cand', sig: [_f.q, _f.cand], onPage: render } })}`;
  }

  /* ── Onboarding ───────────────────────────────────────────────────── */

  function onboardingTab() {
    const list = D.candidates.filter((c) => (D.lists.C_ONBOARD.includes(c.status) || (_f.cand === 'All' && ['Onboarded', 'Offer Declined', 'Dropped'].includes(c.status) && c.offer_version))
      && matches([c.id, c.name, c.designation, c.position]));
    const ckDone = (c) => D.lists.CHECKLIST.filter((x) => c.checklist[x.key]?.done).length;
    return `
      ${flow(['Letter → management', 'Approved', 'Signed letter → candidate', 'Accept / changes / decline', 'Login · laptop · buddy', 'Joining day'])}
      <div class="hh-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        ${search('Search name, designation…')}
        <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;"><input type="checkbox" id="hh-ob-all"${_f.cand === 'All' ? ' checked' : ''}/> Show finished / declined</label>
      </div>
      ${H.table(['ID', { label: 'New Joiner', m: 'title' }, 'Designation', 'CTC', 'Joining', 'Checklist', 'Status', { label: '', m: 'actions' }],
        list.map((c) => [
          `<button class="hh-link" data-cand="${esc(c.id)}">${esc(c.id)}</button>`,
          `${esc(c.name)}<div style="font-size:11px;color:#94a3b8;">${esc(c.position)}</div>`,
          esc(c.designation || '—'), esc(c.ctc || '—'), c.joined_on ? `${H.fmtDate(c.joined_on)} ✓` : c.doj ? H.fmtDate(c.doj) : '—',
          ['Offer Accepted', 'Joined', 'Onboarded'].includes(c.status) ? `${ckDone(c)} / ${D.lists.CHECKLIST.length}` : '—',
          pill(c.status), viewBtn('cand', c.id, candAction(c), candNeeds(c)),
        ]), { empty: 'Nobody in onboarding — a candidate lands here once an interviewer selects them', cards: true })}`;
  }

  /* ── Exit ─────────────────────────────────────────────────────────── */

  function exitTab() {
    const list = D.exits.filter((x) => {
      if (_f.exit === 'Open' && !D.lists.X_OPEN.includes(x.status)) return false;
      return matches([x.id, x.employee_name, x.department, x.designation]);
    });
    const dues = (x) => (x.dues.length ? `${x.dues.filter((d) => d.status === 'cleared').length} / ${x.dues.length}` : '—');
    return `
      ${flow(['Notice', 'Last working day', 'Final dues (Accounts + manager)', 'Leave contract signed', 'Uploaded → Completed'])}
      <div class="hh-filt" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        ${search('Search employee, department…')}
        <select id="hh-exit-status" style="${H.CONTROL}max-width:180px;">
          ${[['Open', 'In progress'], ['All', 'All']].map(([v, l]) => `<option value="${v}"${_f.exit === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      ${H.table(['Exit No.', { label: 'Employee', m: 'title' }, 'Type', 'Notice', 'Last Day', 'Dues Cleared', 'Status', { label: '', m: 'actions' }],
        list.map((x) => [
          `<button class="hh-link" data-exit="${esc(x.id)}">${esc(x.id)}</button>`,
          `${esc(x.employee_name)}<div style="font-size:11px;color:#94a3b8;">${esc([x.designation, x.department].filter(Boolean).join(' · '))}</div>`,
          esc(x.exit_type), H.fmtDate(x.notice_date), x.last_working_day ? H.fmtDate(x.last_working_day) : '—', dues(x),
          pill(x.status), viewBtn('exit', x.id, exitAction(x), exitNeeds(x)),
        ]), { empty: 'No exits', cards: true, page: { key: 'hh-exit', sig: [_f.q, _f.exit], onPage: render } })}`;
  }

  /* ── Files ────────────────────────────────────────────────────────── */

  const ACCEPT_ANY = '.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx,application/pdf,image/*';
  const ACCEPT_DOC = '.pdf,.doc,.docx,application/pdf';
  async function readFiles(input, label, max = 5) {
    const files = [...(input?.files || [])];
    if (files.length > max) throw new Error(`${label}: at most ${max} file${max === 1 ? '' : 's'}`);
    let total = 0;
    for (const f of files) { if (f.size > 4 * 1024 * 1024) throw new Error(`${label}: "${f.name}" is over 4 MB`); total += f.size; }
    if (total > 8 * 1024 * 1024) throw new Error('Attachments together must be under 8 MB');
    return Promise.all(files.map((f) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, dataUrl: r.result });
      r.onerror = () => rej(new Error(`Could not read "${f.name}"`));
      r.readAsDataURL(f);
    })));
  }
  const fileInput = (id, label, accept, { multiple = false, required = false, hint = '', span = 2 } = {}) => `<div style="grid-column:span ${span};">
      <label style="${H.LABEL}">${esc(label)}${required ? ' <span style="color:#ef4444">*</span>' : ''}</label>
      <input id="${id}" type="file" ${multiple ? 'multiple' : ''} accept="${accept}" style="${H.CONTROL}padding:6px;" />
      ${hint ? `<div style="font-size:10.5px;color:#94a3b8;margin-top:3px;">${esc(hint)}</div>` : ''}</div>`;
  const sub = (t) => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:18px 0 8px;">${esc(t)}</div>`;
  const datalist = (id, items) => `<datalist id="${id}">${items.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
  const userChecks = (id, selected, list = D.users) => `<div class="hh-chk" id="${id}">${list.map((u) =>
    `<label><input type="checkbox" value="${esc(u.id)}"${selected.includes(u.id) ? ' checked' : ''}/> ${esc(u.name)}</label>`).join('')}</div>`;
  const picked = (id) => [...document.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);
  // Interviewer ticks: only the Settings list (plus anyone already ticked on
  // this record, so an older choice is never silently dropped).
  const ivList = (selected = []) => {
    const ok = new Set([...(D.interviewerIds || D.users.map((u) => u.id)), ...selected]);
    return D.users.filter((u) => ok.has(u.id));
  };
  const userOptions = (sel = '', list = D.users) => list.map((u) => ({ value: u.id, label: `${u.name}${u.department ? ' · ' + u.department : ''}` }));
  function timeOptions(sel = '10:00') {
    const out = [];
    for (let m = 7 * 60; m <= 21 * 60; m += 15) {
      const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
      out.push({ value: `${String(h).padStart(2, '0')}:${mm}`, label: `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}` });
    }
    return out;
  }
  const docList = (kind, id, docs, kinds) => {
    const list = docs.filter((d) => !kinds || kinds.includes(d.kind));
    return list.map((d) => `<div><a class="hh-doc" href="${docHref(kind, id, d.n)}" target="_blank" rel="noopener">📎 ${esc(d.name)}</a>
      <span style="font-size:11px;color:#94a3b8;">${esc(KIND[d.kind] || d.kind)}${d.v ? ' v' + d.v : ''} · ${esc(d.by)} · ${H.fmtDate(d.at)}</span></div>`).join('');
  };
  async function history(kind, id, docs) {
    let log = [];
    try { log = await H.api(`/api/hiring/${kind}/${encodeURIComponent(id)}/log`); } catch { /* shown empty */ }
    const colour = (a) => (/Rejected|Not Selected|Declined|Dropped|Withdrawn|Cancelled/.test(a) ? '#dc2626'
      : /Selected|Approved|Accepted|Joined|Onboarded|Completed|Cleared|✓/.test(a) ? '#16a34a' : /Back|Changes|Revis|Round/.test(a) ? '#d97706' : '#0150AA');
    return log.map((n) => `<div style="border-left:3px solid ${colour(n.action)};padding:4px 0 4px 10px;margin:6px 0;">
      <div style="font-size:12.5px;color:#1e293b;"><b>${esc(n.action)}</b> · ${esc(n.by)}</div>
      ${n.note ? `<div style="font-size:12.5px;color:#475569;white-space:pre-wrap;">${esc(n.note)}</div>` : ''}
      ${(n.docs || []).map((k) => docs.find((x) => x.n === k)).filter(Boolean).map((x) => `<a class="hh-doc" href="${docHref(kind, id, x.n)}" target="_blank" rel="noopener">📎 ${esc(x.name)}</a>`).join(' ')}
      <div style="font-size:11px;color:#94a3b8;">${H.fmtDate(n.at)} ${H.fmtTime(n.at)}</div></div>`).join('') || '<div style="font-size:12px;color:#94a3b8;">No history yet</div>';
  }
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { await fn(); } catch (e) { if (btn) btn.disabled = false; H.fail(e); } };
  const after = async (modalId, msg) => { H.closeModal(modalId); if (msg) H.toast(msg); await refresh(); };

  /* ── Job request form ─────────────────────────────────────────────── */

  function requestForm(r = null) {
    const edit = !!r;
    H.openModal({
      id: 'hh-rf', width: 760, title: edit ? `Edit ${r.id}` : 'Raise a Job Request',
      subtitle: edit ? r.position : `Goes to HR (${D.people.hr.join(', ') || 'Admins'}) to send to hiring agencies`,
      bodyHTML: H.grid(
        H.field('rf-pos', 'Position', r?.position || '', { required: true, span: 2, placeholder: 'e.g. Export Documentation Executive' })
        + `<div><label style="${H.LABEL}">Division / Department <span style="color:#ef4444">*</span></label><input id="rf-div" list="rf-divs" value="${esc(r?.division || '')}" style="${H.CONTROL}" />${datalist('rf-divs', D.divisions || [])}</div>`
        + `<div><label style="${H.LABEL}">Location <span style="color:#ef4444">*</span></label><input id="rf-loc" list="rf-locs" value="${esc(r?.location || '')}" style="${H.CONTROL}" />${datalist('rf-locs', D.locations || [])}</div>`
        + H.field('rf-min', 'Salary from (₹ / month)', r?.salary_min ?? '', { type: 'number', required: true })
        + H.field('rf-max', 'Salary to (₹ / month)', r?.salary_max ?? '', { type: 'number' })
        + H.field('rf-open', 'Openings', r?.openings || 1, { type: 'number' })
        + H.field('rf-exp', 'Experience', r?.experience || '', { placeholder: 'e.g. 2–5 years' })
        + `<div style="grid-column:span 2;"><label style="${H.LABEL}">Interviewer(s) <span style="color:#ef4444">*</span></label>
            <input id="rf-iv-q" placeholder="Filter people…" style="${H.CONTROL}margin-bottom:6px;" />
            ${userChecks('rf-iv', r?.interviewers || [], ivList(r?.interviewers || []))}</div>`
        + H.textarea('rf-desc', 'Job description / details', r?.description || '', { rows: 4, placeholder: 'Role, responsibilities, skills — or upload the JD below' })
        + fileInput('rf-jd', edit ? 'Add / replace job description' : 'Upload the job description', ACCEPT_ANY, { multiple: true, hint: 'PDF / Word · up to 5 files, 4 MB each' }),
      ),
      confirmText: edit ? 'Save' : 'Submit Request',
      onOpen: () => {
        document.getElementById('rf-pos')?.focus();
        document.getElementById('rf-iv-q')?.addEventListener('input', (e) => {
          const n = e.target.value.trim().toLowerCase();
          document.querySelectorAll('#rf-iv label').forEach((l) => { l.style.display = !n || l.textContent.toLowerCase().includes(n) ? 'flex' : 'none'; });
        });
      },
      onConfirm: async () => {
        const body = {
          position: H.val('rf-pos').trim(), division: H.val('rf-div').trim(), location: H.val('rf-loc').trim(),
          salary_min: H.val('rf-min'), salary_max: H.val('rf-max'), openings: H.val('rf-open'), experience: H.val('rf-exp').trim(),
          interviewers: picked('rf-iv'), description: H.val('rf-desc').trim(),
        };
        if (!body.position) throw new Error('Write the position');
        if (!body.interviewers.length) throw new Error('Tick at least one interviewer');
        body.documents = await readFiles(document.getElementById('rf-jd'), 'Job description');
        if (edit) {
          await H.patch(`/api/hiring/requests/${encodeURIComponent(r.id)}`, body);
          await after('hh-rf', 'Saved');
          return viewRequest(r.id);
        }
        if (!body.documents.length && !body.description) throw new Error('Upload the job description or write it');
        const out = await H.post('/api/hiring/requests', body);
        H.closeModal('hh-rf');
        H.toast(`${out.id} raised — HR has been emailed`);
        _tab = 'requests';
        await refresh();
        viewRequest(out.id);
      },
    });
  }

  /* ── Job request drawer ───────────────────────────────────────────── */

  async function viewRequest(id) {
    const r = D.requests.find((x) => x.id === id);
    if (!r) return H.fail(new Error('Job request not found'));
    const cands = D.candidates.filter((c) => c.request_id === r.id);
    const c = r.can;
    const active = D.agencies.filter((a) => a.active);
    let act = '';
    if (c.agencies) {
      act = `<div class="hh-act${r.status === 'Open' ? ' warn' : ''}">
        <h3>${r.agencies.length ? 'Send to more agencies' : 'Send the JD to hiring agencies'}</h3>
        ${active.length ? `<div class="hh-chk" id="ra-ag">${active.map((a) => {
          const sent = r.agencies.find((s) => s.id === a.id);
          return `<label><input type="checkbox" value="${esc(a.id)}"${sent ? '' : ''}/> ${esc(a.name)}${sent ? ` <span style="font-size:10.5px;color:#16a34a;">sent ${H.fmtDate(sent.at)}</span>` : ''}</label>`;
        }).join('')}</div>
        ${H.grid(H.textarea('ra-note', 'Note for the agencies (optional)', '', { rows: 2 }))}
        <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;margin-top:8px;"><input type="checkbox" id="ra-sal" checked/> Show the salary bracket to agencies</label>
        <div style="font-size:11.5px;color:#64748b;margin-top:6px;">Each agency gets its own mail with the JD and a link to upload CVs. Replies go to ${esc(D.people.inquiry)}.</div>
        <div class="hh-btns"><button class="btn-primary btn-sm" id="ra-send">Send to Agencies</button></div>`
        : `<div style="font-size:12.5px;color:#92400e;">No agencies yet — add them on the <b>Agencies</b> tab first.</div>`}
      </div>`;
    }
    const ivNames = r.interviewers.map(userName).filter(Boolean).join(', ');
    H.openModal({
      id: 'hh-rv', variant: 'drawer', width: 820, hideConfirm: true, cancelText: 'Close',
      title: `${r.id} · ${r.position}`, subtitle: `Raised by ${r.requested_by_name} on ${H.fmtDate(r.created_at)}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${pill(r.status)} ${H.pill(r.division, 'neutral')} ${H.pill(r.location, 'neutral')}</div>
        ${act}
        ${sub('Request')}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Division', r.division)}${H.readout('Location', r.location)}
          ${H.readout('Salary Bracket', salary(r) + (salary(r) ? ' / month' : ''))}${H.readout('Openings', String(r.openings))}
          ${H.readout('Experience', r.experience)}${H.readout('Interviewer(s)', ivNames)}
        </div>
        ${r.description ? `<div style="font-size:12.5px;color:#334155;margin-top:10px;white-space:pre-wrap;">${esc(r.description)}</div>` : ''}
        ${r.docs.length ? sub('Job Description') + docList('requests', r.id, r.docs) : ''}
        ${r.agencies.length ? sub('Sent to Agencies') + `<div style="font-size:12.5px;">${r.agencies.map((a) => `${esc(a.name)} <span style="color:#94a3b8;font-size:11px;">${H.fmtDate(a.at)} · ${esc(a.by || '')}</span>`).join('<br>')}</div>` : ''}
        ${sub(`Candidates (${cands.length})`)}
        ${cands.length ? H.table(['ID', 'Name', 'Source', 'Status', ''], cands.map((x) => [
          esc(x.id), esc(x.name), esc(x.source), pill(x.status), viewBtn('cand', x.id, candAction(x), candNeeds(x))])) : '<div style="font-size:12px;color:#94a3b8;">No CVs yet</div>'}
        <div class="hh-btns">
          ${c.addCv ? '<button class="btn-secondary btn-sm" id="rv-addcv">+ Add CV</button>' : ''}
          ${c.edit ? '<button class="btn-secondary btn-sm" id="rv-edit">Edit</button>' : ''}
          ${c.status ? `<select id="rv-status" style="${H.CONTROL}max-width:200px;padding:5px 8px;">
              <option value="">Change status…</option>
              ${['Open', 'On Hold', 'Closed', 'Cancelled'].filter((s) => s !== r.status && !(s === 'Open' && r.status === 'Sourcing')).map((s) => `<option value="${s}">${s === 'Open' ? 'Reopen' : s}</option>`).join('')}
            </select>` : c.cancel ? '<button class="btn-secondary btn-sm" id="rv-cancel">Cancel request</button>' : ''}
          ${c.del ? '<button class="btn-secondary btn-sm" id="rv-del" style="color:#dc2626;">Delete</button>' : ''}
        </div>
        ${sub('History')}<div id="rv-log">${H.spinner('')}</div>`,
      onOpen: async () => {
        const $ = (x) => document.getElementById(x);
        const base = `/api/hiring/requests/${encodeURIComponent(r.id)}`;
        $('ra-send')?.addEventListener('click', (e) => busy(e.target, async () => {
          const ids = picked('ra-ag');
          if (!ids.length) throw new Error('Tick at least one agency');
          const out = await H.post(`${base}/agencies`, { agency_ids: ids, note: H.val('ra-note').trim(), show_salary: !!$('ra-sal')?.checked });
          await after('hh-rv', `Sent to ${out.sent.join(', ')}${out.failed.length ? ' · failed: ' + out.failed.join(', ') : ''}`);
        }));
        $('rv-addcv')?.addEventListener('click', () => cvForm(r.id));
        $('rv-edit')?.addEventListener('click', () => { H.closeModal('hh-rv'); requestForm(r); });
        $('rv-status')?.addEventListener('change', async (e) => {
          const status = e.target.value;
          if (!status) return;
          const note = await promptText(`${status === 'Open' ? 'Reopen' : status} ${r.id}`, 'Note (optional)', false);
          if (note === null) { e.target.value = ''; return; }
          try { await H.post(`${base}/status`, { status, note }); await after('hh-rv', `${r.id} → ${status}`); } catch (err) { H.fail(err); }
        });
        $('rv-cancel')?.addEventListener('click', async () => {
          if (!(await Utils.showConfirm(`Cancel ${r.id}?`, { title: 'Cancel request', confirmText: 'Cancel it', danger: true }))) return;
          try { await H.post(`${base}/status`, { status: 'Cancelled' }); await after('hh-rv', 'Cancelled'); } catch (err) { H.fail(err); }
        });
        $('rv-del')?.addEventListener('click', async () => {
          if (!(await Utils.showConfirm(`Delete ${r.id} with all its candidates and files? This cannot be undone.`, { title: 'Delete', confirmText: 'Delete', danger: true }))) return;
          try { await H.del(base); await after('hh-rv', 'Deleted'); } catch (err) { H.fail(err); }
        });
        bindViews(document.getElementById('hh-rv'));
        const log = $('rv-log'); if (log) log.innerHTML = await history('requests', r.id, r.docs);
      },
    });
  }

  // A small "write a note" modal that resolves with the text (or null).
  function promptText(title, label, required = true, placeholder = '') {
    return new Promise((resolve) => {
      let done = false;
      H.openModal({
        id: 'hh-prompt', title, bodyHTML: H.grid(H.textarea('hp-note', label, '', { rows: 3, placeholder })), confirmText: 'OK',
        onOpen: () => {
          document.getElementById('hp-note')?.focus();
          const obs = new MutationObserver(() => { if (!document.getElementById('hh-prompt')) { obs.disconnect(); if (!done) resolve(null); } });
          obs.observe(document.body, { childList: true, subtree: true });
        },
        onConfirm: async () => {
          const v = H.val('hp-note').trim();
          if (required && !v) throw new Error(`Write the ${label.toLowerCase()}`);
          done = true;
          H.closeModal('hh-prompt');
          resolve(v);
        },
      });
    });
  }

  /* ── Add a CV (HR / requester) ────────────────────────────────────── */

  function cvForm(requestId) {
    const open = D.requests.filter((r) => r.can.addCv);
    if (!open.length) return H.fail(new Error('There is no open job request to add a CV to'));
    H.openModal({
      id: 'hh-cv', width: 680, title: 'Add a CV', subtitle: 'For CVs that came by mail, walk-ins or references — agencies use their own link',
      bodyHTML: H.grid(
        H.select('cv-req', 'Job request', requestId || open[0].id, open.map((r) => ({ value: r.id, label: `${r.id} · ${r.position} (${r.location})` })), { required: true, span: 2 })
        + H.field('cv-name', 'Candidate name', '', { required: true })
        + H.field('cv-phone', 'Phone', '')
        + H.field('cv-email', 'Email', '', { type: 'email' })
        + H.field('cv-exp', 'Experience', '')
        + H.field('cv-cur', 'Current CTC', '')
        + H.field('cv-expct', 'Expected CTC', '')
        + H.field('cv-np', 'Notice period', '')
        + H.select('cv-src', 'Source', '', [{ value: '', label: 'Direct / walk-in' }, { value: 'ref', label: 'Employee reference' }, ...D.agencies.filter((a) => a.active).map((a) => ({ value: 'ag:' + a.id, label: a.name }))])
        + H.textarea('cv-notes', 'Notes', '', { rows: 2 })
        + fileInput('cv-file', 'CV', '.pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/*', { required: true, hint: 'PDF / Word / scan · 4 MB max' }),
      ),
      confirmText: 'Add CV',
      onOpen: () => document.getElementById('cv-name')?.focus(),
      onConfirm: async () => {
        const src = H.val('cv-src');
        const body = {
          request_id: H.val('cv-req'), name: H.val('cv-name').trim(), phone: H.val('cv-phone').trim(), email: H.val('cv-email').trim(),
          experience: H.val('cv-exp').trim(), current_ctc: H.val('cv-cur').trim(), expected_ctc: H.val('cv-expct').trim(),
          notice_period: H.val('cv-np').trim(), notes: H.val('cv-notes').trim(),
          source: src === 'ref' ? 'Employee reference' : src ? '' : 'Direct', agency_id: src.startsWith('ag:') ? src.slice(3) : null,
        };
        if (!body.name) throw new Error('Write the candidate\'s name');
        body.documents = await readFiles(document.getElementById('cv-file'), 'CV', 1);
        if (!body.documents.length) throw new Error('Attach the CV');
        const out = await H.post('/api/hiring/candidates', body);
        H.closeModal('hh-cv');
        H.closeModal('hh-rv');
        H.toast(`${out.id} added — the requester has been emailed the CV`);
        await refresh();
        viewCand(out.id);
      },
    });
  }

  /* ── Candidate drawer ─────────────────────────────────────────────── */

  function candActionCard(c, r) {
    const k = c.can;
    const lastIv = c.interviewers.length ? c.interviewers : r?.interviewers || [];
    if (k.screen) {
      return `<div class="hh-act warn"><h3>Review the CV</h3>
        ${H.grid(H.textarea('cs-note', 'Note (required to reject)', '', { rows: 2 }))}
        <div class="hh-btns"><button class="btn-primary btn-sm" data-screen="shortlist">Shortlist</button>
          <button class="btn-secondary btn-sm" data-screen="reject" style="color:#dc2626;">Reject CV</button></div></div>`;
    }
    if (k.result) {
      return `<div class="hh-act warn"><h3>Interview result — round ${c.interview_round}</h3>
        ${H.grid(H.textarea('ci-rem', 'Remarks', '', { rows: 3, placeholder: 'Optional to select · required to reject or call for another round' }))}
        <div class="hh-btns"><button class="btn-primary btn-sm" data-result="select">Select</button>
          <button class="btn-secondary btn-sm" data-result="next" style="color:#b45309;">Next Round</button>
          <button class="btn-secondary btn-sm" data-result="reject" style="color:#dc2626;">Reject</button></div></div>`;
    }
    if (k.offer) {
      return `<div class="hh-act${c.status === 'Offer Revision' ? ' warn' : ''}"><h3>${c.status === 'Offer Revision' ? 'Revise the appointment letter' : 'Appointment letter → approving management'}</h3>
        ${c.status === 'Offer Revision' && c.offer_remarks ? `<div style="font-size:12.5px;color:#92400e;margin-bottom:8px;white-space:pre-wrap;"><b>${esc(c.offer_by)}:</b> ${esc(c.offer_remarks)}${c.response_note ? `\n<b>Candidate asked:</b> ${esc(c.response_note)}` : ''}</div>` : ''}
        ${H.grid(H.field('co-desig', 'Designation', c.designation || r?.position || '', { required: true })
          + H.field('co-ctc', 'CTC offered', c.ctc || c.expected_ctc || '', { required: true, placeholder: 'e.g. ₹4.2 LPA / ₹35,000 pm' })
          + H.field('co-doj', 'Date of joining', c.doj || '', { type: 'date', required: true })
          + `<div></div>`
          + fileInput('co-file', 'Appointment letter', ACCEPT_DOC, { required: true, hint: 'PDF / Word — mailed to management with Approve / Send Back' })
          + H.textarea('co-note', 'Note for management (optional)', '', { rows: 2 }))}
        <div class="hh-btns"><button class="btn-secondary btn-sm" data-letter="offer">📝 Generate Offer Letter</button>
          <button class="btn-secondary btn-sm" data-letter="appointment">📝 Generate Appointment Letter</button>
          <button class="btn-primary btn-sm" id="co-send">Send for Approval</button></div>
        <div style="font-size:11.5px;color:#64748b;margin-top:4px;">Generate fills HR's Word format, downloads it and puts it in the box above — edit in Word if needed and attach again.</div>
        <div style="font-size:11.5px;color:#64748b;margin-top:6px;">Goes to: ${esc(D.people.mgmt.join(', ') || '—')}</div></div>`;
    }
    if (k.offerDecide) {
      const letter = [...c.docs].reverse().find((d) => d.kind === 'offer');
      return `<div class="hh-act warn"><h3>Approve the appointment letter (v${c.offer_version})</h3>
        ${letter ? `<div style="margin-bottom:8px;"><a class="hh-doc" href="${docHref('candidates', c.id, letter.n)}" target="_blank" rel="noopener">📎 ${esc(letter.name)}</a></div>` : ''}
        <div style="font-size:12.5px;margin-bottom:8px;">${esc(c.designation)} · ${esc(c.ctc)} · joining ${H.fmtDate(c.doj)}</div>
        ${H.grid(H.textarea('cd-rem', 'Remarks', '', { rows: 2, placeholder: 'Required to send back' }))}
        <div class="hh-btns"><button class="btn-primary btn-sm" data-offer="approve">Approve</button>
          <button class="btn-secondary btn-sm" data-offer="changes" style="color:#b45309;">Send Back</button></div></div>`;
    }
    if (k.sendOffer) {
      return `<div class="hh-act good"><h3>Approved — send the digitally signed letter to the candidate</h3>
        ${H.grid(H.field('cs-email', 'Candidate email', c.email, { type: 'email', required: true })
          + fileInput('cs-file', 'Digitally signed appointment letter (PDF)', 'application/pdf,.pdf', { required: true, span: 1 })
          + H.textarea('cs-msg', 'Message (optional)', '', { rows: 2 }))}
        <div style="font-size:11.5px;color:#64748b;margin-top:6px;">The candidate gets the letter with a link to Accept / Accept with changes / Decline. Their answer is mailed to ${esc(D.people.inquiry)}, HR and management.</div>
        <div class="hh-btns"><button class="btn-primary btn-sm" id="cs-send">Send to Candidate</button></div></div>`;
    }
    if (k.record) {
      return `<div class="hh-act"><h3>Waiting for the candidate's answer</h3>
        <div style="font-size:12.5px;color:#334155;margin-bottom:8px;">The offer link went to ${esc(c.email)}. If they answered by phone or mail, record it here.</div>
        ${H.grid(H.select('cr-resp', 'Answer', '', [{ value: 'accept', label: 'Accepted' }, { value: 'changes', label: 'Accepted with changes' }, { value: 'decline', label: 'Declined' }], { placeholder: 'Choose…' })
          + H.textarea('cr-note', 'Their message', '', { rows: 2, span: 1 }))}
        <div class="hh-btns"><button class="btn-secondary btn-sm" id="cr-save">Record Answer</button></div></div>`;
    }
    if (k.changesDecide) {
      return `<div class="hh-act warn"><h3>The candidate asked for changes</h3>
        <div style="font-size:12.5px;color:#92400e;margin-bottom:8px;white-space:pre-wrap;">${esc(c.response_note)}</div>
        ${H.grid(H.textarea('cc-rem', 'Remarks (what to change)', '', { rows: 2 }))}
        <div class="hh-btns"><button class="btn-primary btn-sm" data-changes="revise">Revise the Offer</button>
          <button class="btn-secondary btn-sm" data-changes="drop" style="color:#dc2626;">Drop Candidate</button></div></div>`;
    }
    if (k.checklist) return checklistCard(c);
    if (k.schedule) {
      const now = H.todayISO();
      return `<div class="hh-act${c.status === 'Shortlisted' ? ' warn' : ''}"><h3>${c.status === 'Interview Scheduled' ? 'Reschedule the interview' : `Schedule the interview${c.interview_round ? ` — round ${c.interview_round + 1}` : ''}`}</h3>
        ${c.status === 'Shortlisted' && c.result_remarks ? `<div style="font-size:12.5px;color:#92400e;margin-bottom:8px;">Next round wanted: ${esc(c.result_remarks)}</div>` : ''}
        ${H.grid(H.field('ci-date', 'Date', now, { type: 'date', required: true })
          + H.select('ci-time', 'Time', '11:00', timeOptions(), { required: true })
          + H.select('ci-dur', 'Duration', '30', [{ value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '1 hour' }, { value: '90', label: '1.5 hours' }])
          + H.select('ci-mode', 'Mode', 'online', [{ value: 'online', label: 'Online (Meet link)' }, { value: 'in-person', label: 'In person' }])
          + H.field('ci-venue', 'Venue (in person)', '', { span: 2, placeholder: 'e.g. Andheri office, conference room' })
          + `<div style="grid-column:span 2;"><label style="${H.LABEL}">Interviewer(s)</label>${userChecks('ci-iv', lastIv, ivList(lastIv))}</div>`
          + H.textarea('ci-note', 'Note (optional)', '', { rows: 2 }))}
        <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;margin-top:8px;"><input type="checkbox" id="ci-inv"${c.email ? ' checked' : ' disabled'}/> Invite the candidate too${c.email ? ` (${esc(c.email)})` : ' (no email on file)'}</label>
        <div style="font-size:11.5px;color:#64748b;margin-top:6px;">Creates the meeting on the Scheduler. The interviewers get the CV with Select / Next Round / Reject buttons.</div>
        <div class="hh-btns"><button class="btn-primary btn-sm" id="ci-go">${c.status === 'Interview Scheduled' ? 'Reschedule' : 'Schedule Interview'}</button></div></div>`;
    }
    return '';
  }

  function checklistCard(c) {
    const ck = c.checklist;
    const item = (x) => {
      const e = ck[x.key];
      const done = !!e?.done;
      let ctl = '';
      if (!done) {
        const doj = x.stage === 'doj' && c.status !== 'Joined';
        if (doj) ctl = '<span style="font-size:11px;color:#94a3b8;">On the joining day</span>';
        else if (x.key === 'employee') ctl = `<button class="btn-secondary btn-sm" data-ck-employee>Create in Employee Master</button> <button class="btn-secondary btn-sm" data-ck-link="employee">Link existing…</button>`;
        else if (x.key === 'login') ctl = `<button class="btn-secondary btn-sm" data-ck-login>Create ERP login</button> <button class="btn-secondary btn-sm" data-ck-link="login">Link existing…</button>`;
        else if (x.key === 'laptop') ctl = c.employee_id ? '<button class="btn-secondary btn-sm" data-ck-laptop>Assign laptop…</button>' : '<span style="font-size:11px;color:#94a3b8;">Create the employee record first</span>';
        else if (x.key === 'buddy') ctl = '<button class="btn-secondary btn-sm" data-ck-link="buddy">Pick buddy…</button>';
        else if (x.key === 'letter') ctl = '<button class="btn-secondary btn-sm" data-ck-letter>Email signed letter…</button> <button class="btn-secondary btn-sm" data-ck-tick="letter">Given by hand</button>';
        else ctl = `<button class="btn-secondary btn-sm" data-ck-tick="${x.key}">Mark done</button>`;
      } else {
        ctl = `<button class="hh-link" style="font-size:11px;color:#94a3b8;" data-ck-untick="${x.key}">undo</button>`;
      }
      const extra = x.key === 'buddy_month' && c.buddy_name ? ` — ${esc(c.buddy_name)}${c.joined_on ? ` until ${H.fmtDate(addMonth(c.joined_on))}` : ''}` : '';
      return `<div class="hh-ck">
        <div class="dot" style="background:${done ? '#dcfce7' : '#f1f5f9'};color:${done ? '#16a34a' : '#94a3b8'};">${done ? '✓' : '•'}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12.5px;font-weight:600;color:#1e293b;">${esc(x.label)}${extra}</div>
          ${done ? `<div style="font-size:11px;color:#64748b;">${esc([e.ref_name, e.note, `${e.by} · ${H.fmtDate(e.at)}`].filter(Boolean).join(' · '))}</div>` : ''}
          <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;">${ctl}</div>
        </div></div>`;
    };
    const before = D.lists.CHECKLIST.filter((x) => x.stage === 'before');
    const doj = D.lists.CHECKLIST.filter((x) => x.stage === 'doj');
    return `<div class="hh-act good">
      <h3>${c.status === 'Joined' ? `Joined ${H.fmtDate(c.joined_on)} — joining-day steps` : `Offer accepted — before joining on ${H.fmtDate(c.doj)}`}</h3>
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Before the joining date</div>
      ${before.map(item).join('')}
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:10px;">Date of joining</div>
      ${doj.map(item).join('')}
      ${c.can.joined ? `<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:12px;border-top:1px solid #bbf7d0;padding-top:12px;">
        <div style="max-width:180px;">${H.field('cj-date', 'Joined on', c.doj && c.doj <= H.todayISO() ? c.doj : H.todayISO(), { type: 'date' })}</div>
        <button class="btn-primary btn-sm" id="cj-go">Mark as Joined</button></div>` : ''}
    </div>`;
  }
  const addMonth = (iso) => { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };

  async function viewCand(id) {
    const c = D.candidates.find((x) => x.id === id);
    if (!c) return H.fail(new Error('Candidate not found'));
    const r = reqOf(c);
    const k = c.can;
    H.openModal({
      id: 'hh-cv-view', variant: 'drawer', width: 840, hideConfirm: true, cancelText: 'Close',
      title: `${c.id} · ${c.name}`, subtitle: `${c.position} (${c.request_id}) · ${c.source} · added ${H.fmtDate(c.created_at)}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${pill(c.status)} ${c.interview_round ? H.pill('Round ' + c.interview_round, 'neutral') : ''} ${c.offer_version ? H.pill('Letter v' + c.offer_version, 'neutral') : ''}</div>
        ${candActionCard(c, r)}
        ${sub('Candidate')}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Phone', c.phone)}${H.readout('Email', c.email)}
          ${H.readout('Experience', c.experience)}${H.readout('Notice Period', c.notice_period)}
          ${H.readout('Current CTC', c.current_ctc)}${H.readout('Expected CTC', c.expected_ctc)}
          ${H.readout('Source', c.source)}${H.readout('Salary Bracket', r ? salary(r) : '')}
          ${c.interview_at ? H.readout('Interview', `${fmtWall(c.interview_at)} (round ${c.interview_round})`) + H.readout('Interviewer(s)', c.interviewers.map(userName).join(', ')) : ''}
          ${c.result_by ? H.readout('Interview Result By', c.result_by) + H.readout('Result Remarks', c.result_remarks) : ''}
          ${c.designation ? H.readout('Designation', c.designation) + H.readout('CTC Offered', c.ctc) : ''}
          ${c.doj ? H.readout('Date of Joining', H.fmtDate(c.doj)) + H.readout('Joined On', c.joined_on ? H.fmtDate(c.joined_on) : '') : ''}
          ${c.response ? H.readout('Candidate Answer', { accept: 'Accepted', changes: 'Accepted with changes', decline: 'Declined' }[c.response]) + H.readout('Answered', c.response_at ? `${H.fmtDate(c.response_at)} ${H.fmtTime(c.response_at)}` : '') : ''}
          ${c.employee_id ? H.readout('Employee Code', c.employee_id) : ''}${c.buddy_name ? H.readout('Buddy', c.buddy_name) : ''}
        </div>
        ${c.meeting_link && /^https?:/.test(c.meeting_link) ? `<div style="margin-top:8px;"><a class="hh-doc" href="${esc(c.meeting_link)}" target="_blank" rel="noopener">Join the interview meeting ↗</a></div>` : ''}
        ${c.notes ? `<div style="font-size:12.5px;color:#334155;margin-top:10px;white-space:pre-wrap;">${esc(c.notes)}</div>` : ''}
        ${c.response_note ? `<div style="font-size:12.5px;color:#334155;margin-top:8px;white-space:pre-wrap;"><b>Candidate's message:</b> ${esc(c.response_note)}</div>` : ''}
        ${c.docs.length ? sub('Documents') + docList('candidates', c.id, c.docs) : ''}
        <div class="hh-btns">
          ${k.drop ? '<button class="btn-secondary btn-sm" id="cv-drop">Drop candidate</button>' : ''}
          ${k.del ? '<button class="btn-secondary btn-sm" id="cv-del" style="color:#dc2626;">Delete</button>' : ''}
          ${r ? `<button class="btn-secondary btn-sm" data-req="${esc(r.id)}">Open ${esc(r.id)}</button>` : ''}
        </div>
        ${k.schedule && c.status === 'Interview Scheduled' && k.result ? `<details style="margin-top:12px;"><summary style="font-size:12.5px;cursor:pointer;color:var(--color-primary);">Reschedule instead…</summary>${candActionCard({ ...c, can: { schedule: true } }, r)}</details>` : ''}
        ${sub('History')}<div id="cv-log">${H.spinner('')}</div>`,
      onOpen: async () => {
        bindCand(c, r);
        bindViews(document.getElementById('hh-cv-view'));
        const log = document.getElementById('cv-log'); if (log) log.innerHTML = await history('candidates', c.id, c.docs);
      },
    });
  }

  function bindCand(c, r) {
    const $ = (x) => document.getElementById(x);
    const base = `/api/hiring/candidates/${encodeURIComponent(c.id)}`;
    const done = (msg) => after('hh-cv-view', msg).then(() => { if (D.candidates.some((x) => x.id === c.id)) viewCand(c.id); });
    const root = document.getElementById('hh-cv-view');

    root.querySelectorAll('[data-screen]').forEach((b) => b.addEventListener('click', (e) => busy(e.target, async () => {
      const decision = b.getAttribute('data-screen');
      await H.post(`${base}/screen`, { decision, note: H.val('cs-note').trim() });
      await done(decision === 'shortlist' ? `${c.name} shortlisted — schedule the interview` : 'CV rejected');
    })));
    $('ci-go')?.addEventListener('click', (e) => busy(e.target, async () => {
      const body = {
        date: H.val('ci-date'), time: H.val('ci-time'), duration: H.val('ci-dur'), mode: H.val('ci-mode'), venue: H.val('ci-venue').trim(),
        interviewers: picked('ci-iv'), note: H.val('ci-note').trim(), invite_candidate: !!$('ci-inv')?.checked,
      };
      if (!body.interviewers.length) throw new Error('Tick at least one interviewer');
      const out = await H.post(`${base}/interview`, body);
      await done(out.meeting_error ? `Interview saved, but the Scheduler meeting failed: ${out.meeting_error}` : `Interview scheduled${out.link ? ' with a meeting link' : ''} — interviewers mailed`);
    }));
    root.querySelectorAll('[data-result]').forEach((b) => b.addEventListener('click', (e) => busy(e.target, async () => {
      const decision = b.getAttribute('data-result');
      const remarks = H.val('ci-rem').trim();
      if (decision !== 'select' && !remarks) throw new Error('Write your remarks');
      await H.post(`${base}/result`, { decision, remarks });
      await done({ select: `${c.name} selected — HR will prepare the offer`, next: 'Sent back for another round', reject: 'Recorded as not selected' }[decision]);
    })));
    root.querySelectorAll('[data-letter]').forEach((b) => b.addEventListener('click', () => letterForm(b.getAttribute('data-letter'), c, r)));
    $('co-send')?.addEventListener('click', (e) => busy(e.target, async () => {
      const documents = await readFiles($('co-file'), 'Appointment letter', 1);
      if (!documents.length) throw new Error('Attach the appointment letter');
      await H.post(`${base}/offer`, { designation: H.val('co-desig').trim(), ctc: H.val('co-ctc').trim(), doj: H.val('co-doj'), note: H.val('co-note').trim(), documents });
      await done('Sent to management for approval');
    }));
    root.querySelectorAll('[data-offer]').forEach((b) => b.addEventListener('click', (e) => busy(e.target, async () => {
      const decision = b.getAttribute('data-offer');
      const remarks = H.val('cd-rem').trim();
      if (decision === 'changes' && !remarks) throw new Error('Write what should change');
      await H.post(`${base}/offer-decision`, { decision, remarks });
      await done(decision === 'approve' ? 'Approved — HR will send the signed letter' : 'Sent back to HR');
    })));
    $('cs-send')?.addEventListener('click', (e) => busy(e.target, async () => {
      const documents = await readFiles($('cs-file'), 'Signed letter', 1);
      if (!documents.length) throw new Error('Attach the digitally signed letter');
      await H.post(`${base}/send-offer`, { email: H.val('cs-email').trim(), note: H.val('cs-msg').trim(), documents });
      await done(`Offer mailed to ${c.name}`);
    }));
    $('cr-save')?.addEventListener('click', (e) => busy(e.target, async () => {
      const response = H.val('cr-resp');
      if (!response) throw new Error('Choose the answer');
      await H.post(`${base}/response`, { response, note: H.val('cr-note').trim() });
      await done('Answer recorded — inquiry mailbox, HR and management mailed');
    }));
    root.querySelectorAll('[data-changes]').forEach((b) => b.addEventListener('click', (e) => busy(e.target, async () => {
      const decision = b.getAttribute('data-changes');
      if (decision === 'drop' && !(await Utils.showConfirm(`Drop ${c.name}?`, { title: 'Drop candidate', confirmText: 'Drop', danger: true }))) { e.target.disabled = false; return; }
      await H.post(`${base}/changes-decision`, { decision, remarks: H.val('cc-rem').trim() });
      await done(decision === 'revise' ? 'HR will upload a revised letter' : 'Dropped');
    })));
    $('cj-go')?.addEventListener('click', (e) => busy(e.target, async () => {
      const joined_on = H.val('cj-date');
      try { await H.post(`${base}/joined`, { joined_on }); }
      catch (err) {
        if (!/Still to do/.test(err.message)) throw err;
        if (!(await Utils.showConfirm(`${err.message}\n\nMark as joined anyway?`, { title: 'Pre-joining steps pending', confirmText: 'Mark joined' }))) { e.target.disabled = false; return; }
        await H.post(`${base}/joined`, { joined_on, force: true });
      }
      await done(`${c.name} has joined`);
    }));
    $('cv-drop')?.addEventListener('click', async () => {
      const note = await promptText(`Drop ${c.name}`, 'Reason');
      if (note === null) return;
      try { await H.post(`${base}/drop`, { note }); await done('Dropped'); } catch (err) { H.fail(err); }
    });
    $('cv-del')?.addEventListener('click', async () => {
      if (!(await Utils.showConfirm(`Delete ${c.id} and its files? This cannot be undone.`, { title: 'Delete', confirmText: 'Delete', danger: true }))) return;
      try { await H.del(base); await after('hh-cv-view', 'Deleted'); } catch (err) { H.fail(err); }
    });

    // ── checklist actions ──
    const tick = (key, extra = {}) => H.post(`${base}/checklist`, { key, done: true, ...extra });
    root.querySelectorAll('[data-ck-tick]').forEach((b) => b.addEventListener('click', (e) => busy(e.target, async () => {
      const out = await tick(b.getAttribute('data-ck-tick'));
      await done(out.onboarded ? `${c.name} is fully onboarded 🎉` : 'Done');
    })));
    root.querySelectorAll('[data-ck-untick]').forEach((b) => b.addEventListener('click', (e) => busy(e.target, async () => {
      await H.post(`${base}/checklist`, { key: b.getAttribute('data-ck-untick'), done: false });
      await done('Unticked');
    })));
    root.querySelector('[data-ck-employee]')?.addEventListener('click', () => createEmployee(c, r, base, done));
    root.querySelector('[data-ck-login]')?.addEventListener('click', () => createLogin(c, r, base, done));
    root.querySelector('[data-ck-laptop]')?.addEventListener('click', () => assignLaptop(c, base, done));
    root.querySelector('[data-ck-letter]')?.addEventListener('click', () => {
      H.openModal({
        id: 'hh-ck', title: 'Email the signed appointment letter', subtitle: 'Sends the signed letter on file; copy to the inquiry mailbox',
        bodyHTML: H.grid(H.field('ck-email', 'Send to', c.email, { type: 'email', span: 2, hint: 'Their new office email, if they have one now' })),
        confirmText: 'Send',
        onConfirm: async () => {
          await tick('letter', { send: true, email: H.val('ck-email').trim() });
          H.closeModal('hh-ck');
          await done('Signed letter mailed');
        },
      });
    });
    root.querySelectorAll('[data-ck-link]').forEach((b) => b.addEventListener('click', () => {
      const key = b.getAttribute('data-ck-link');
      const opts = key === 'employee'
        ? (D.employees || []).map((e) => ({ value: e.id, label: `${e.id} · ${e.name}${e.designation ? ' · ' + e.designation : ''}` }))
        : userOptions();
      const guess = key === 'employee' ? (D.employees || []).find((e) => e.name.toLowerCase() === c.name.toLowerCase())?.id
        : key === 'login' ? D.users.find((u) => u.name.toLowerCase() === c.name.toLowerCase())?.id : '';
      H.openModal({
        id: 'hh-ck', title: { employee: 'Link the employee record', login: 'Link the ERP login', buddy: 'Pick a buddy' }[key],
        subtitle: key === 'buddy' ? 'They get a mail asking them to look after the new joiner for the first month' : '',
        bodyHTML: H.grid(H.select('ck-ref', { employee: 'Employee', login: 'Login', buddy: 'Buddy' }[key], guess || '', opts, { placeholder: 'Choose…', span: 2 })
          + H.field('ck-note', 'Note (optional)', '', { span: 2 })),
        confirmText: 'Save',
        onConfirm: async () => {
          const ref = H.val('ck-ref');
          if (!ref) throw new Error('Choose one');
          await tick(key, { ref, note: H.val('ck-note').trim() });
          H.closeModal('hh-ck');
          await done(key === 'buddy' ? 'Buddy assigned and mailed' : 'Linked');
        },
      });
    }));
  }

  /* Pre-joining helpers — these call the Employee Master, Users and Assets
     APIs directly (same rules as those pages), then tick the checklist. */
  function createEmployee(c, r, base, done) {
    H.openModal({
      id: 'hh-ck', width: 640, title: 'Create the employee record', subtitle: 'Adds them to Employee Master (status Active)',
      bodyHTML: H.grid(
        H.field('ce-name', 'Name', c.name, { required: true })
        + H.field('ce-desig', 'Designation', c.designation)
        + `<div><label style="${H.LABEL}">Department</label><input id="ce-dept" list="ce-depts" value="${esc(r?.division || '')}" style="${H.CONTROL}" />${datalist('ce-depts', D.divisions || [])}</div>`
        + `<div><label style="${H.LABEL}">Branch</label><input id="ce-branch" list="ce-brs" value="${esc(r?.location || '')}" style="${H.CONTROL}" />${datalist('ce-brs', D.locations || [])}</div>`
        + H.field('ce-doj', 'Date of joining', c.doj || '', { type: 'date' })
        + H.field('ce-phone', 'Phone', c.phone)
        + H.field('ce-email', 'Email', c.email, { type: 'email' })
        + H.select('ce-rep', 'Reporting to', r ? userName(r.requested_by_id) : '', D.users.map((u) => u.name), { placeholder: '—' }),
      ),
      confirmText: 'Create',
      onConfirm: async () => {
        const body = { name: H.val('ce-name').trim(), designation: H.val('ce-desig').trim(), department: H.val('ce-dept').trim(), branch: H.val('ce-branch').trim(),
          doj: H.val('ce-doj'), phone: H.val('ce-phone').trim(), email: H.val('ce-email').trim(), reporting_to: H.val('ce-rep'), status: 'Active', emp_type: 'Staff' };
        if (!body.name) throw new Error('Write the name');
        const out = await H.post('/api/hr/employees', body);
        await H.post(`${base}/checklist`, { key: 'employee', done: true, ref: out.id });
        H.closeModal('hh-ck');
        await done(`Employee ${out.id} created`);
      },
    });
  }

  function createLogin(c, r, base, done) {
    H.openModal({
      id: 'hh-ck', width: 600, title: 'Create the ERP (dashboard) login', subtitle: 'Role User — change roles and page access later in Users',
      bodyHTML: H.grid(
        H.field('cl-name', 'Name', c.name, { required: true })
        + H.field('cl-email', 'Login email', c.email, { type: 'email', required: true, hint: 'Their office address, if made' })
        + `<div><label style="${H.LABEL}">Department</label><input id="cl-dept" list="cl-depts" value="${esc(r?.division || '')}" style="${H.CONTROL}" />${datalist('cl-depts', D.divisions || [])}</div>`
        + H.field('cl-phone', 'Phone', c.phone)
        + H.field('cl-pass', 'Temporary password', '', { span: 2, hint: 'Leave blank to have them sign in with Google' }),
      ),
      confirmText: 'Create Login',
      onConfirm: async () => {
        const body = { name: H.val('cl-name').trim(), email: H.val('cl-email').trim(), department: H.val('cl-dept').trim(), phone: H.val('cl-phone').trim(), roles: ['User'] };
        if (H.val('cl-pass')) body.password = H.val('cl-pass');
        if (!body.name || !body.email) throw new Error('Name and email are needed');
        const out = await H.post('/api/users', body);
        await H.post(`${base}/checklist`, { key: 'login', done: true, ref: out.id });
        H.closeModal('hh-ck');
        await done(`Login created for ${body.email}`);
      },
    });
  }

  async function assignLaptop(c, base, done) {
    let assets = [];
    try { assets = (await H.api('/api/hr/assets?status=Available')).assets || []; } catch (e) { return H.fail(e); }
    const laptops = assets.filter((a) => /laptop|notebook|macbook/i.test(`${a.asset_type} ${a.name} ${a.category}`));
    const list = laptops.length ? laptops : assets;
    H.openModal({
      id: 'hh-ck', title: 'Assign a laptop', subtitle: `To ${c.employee_id} · ${c.name} — from Assets (Available)`,
      bodyHTML: list.length ? H.grid(H.select('ck-asset', laptops.length ? 'Laptop' : 'Asset (no laptops free — showing all available)', '', list.map((a) => ({ value: a.id, label: `${a.id} · ${a.name}${a.serial_no ? ' · ' + a.serial_no : ''}` })), { placeholder: 'Choose…', span: 2 }))
        : H.empty('No available assets', 'Add the laptop on the Assets page first'),
      confirmText: 'Assign', hideConfirm: !list.length,
      onConfirm: async () => {
        const id = H.val('ck-asset');
        if (!id) throw new Error('Choose the laptop');
        await H.post(`/api/hr/assets/${encodeURIComponent(id)}/assign`, { employee_id: c.employee_id });
        await H.post(`${base}/checklist`, { key: 'laptop', done: true, ref: id });
        H.closeModal('hh-ck');
        await done('Laptop assigned');
      },
    });
  }

  /* ── Exit ─────────────────────────────────────────────────────────── */

  function exitForm(self) {
    const emps = D.employees || [];
    H.openModal({
      id: 'hh-xf', width: 640, title: self ? 'Submit My Notice' : 'Record an Exit',
      subtitle: self ? `${D.self.name} · goes to HR` : 'Starts the exit formality',
      bodyHTML: H.grid(
        (self ? '' : H.select('xf-emp', 'Employee', '', emps.map((e) => ({ value: e.id, label: `${e.name} · ${e.id}${e.department ? ' · ' + e.department : ''}` })), { required: true, placeholder: 'Choose…', span: 2 }))
        + H.select('xf-type', 'Type', 'Resignation', self ? ['Resignation', 'Retirement'] : D.lists.EXIT_TYPES)
        + H.field('xf-notice', 'Notice date', H.todayISO(), { type: 'date' })
        + H.field('xf-lwd', self ? 'Proposed last working day' : 'Last working day (if known)', '', { type: 'date' })
        + '<div></div>'
        + H.textarea('xf-reason', 'Reason', '', { rows: 3 })
        + fileInput('xf-doc', self ? 'Resignation letter (optional)' : 'Notice / resignation letter (optional)', ACCEPT_ANY),
      ),
      confirmText: 'Submit',
      onConfirm: async () => {
        const body = { self: !!self, employee_id: self ? undefined : H.val('xf-emp'), exit_type: H.val('xf-type'), notice_date: H.val('xf-notice'),
          last_working_day: H.val('xf-lwd'), reason: H.val('xf-reason').trim() };
        if (!self && !body.employee_id) throw new Error('Choose the employee');
        body.documents = await readFiles(document.getElementById('xf-doc'), 'Letter', 1);
        const out = await H.post('/api/hiring/exits', body);
        H.closeModal('hh-xf');
        H.toast(`${out.id} recorded — HR has been emailed`);
        _tab = 'exit';
        await refresh();
        viewExit(out.id);
      },
    });
  }

  function exitActionCard(x) {
    const k = x.can;
    if (k.confirm) {
      const emp = (D.employees || []).find((e) => e.id === x.employee_id);
      const mgrGuess = x.manager_id || D.users.find((u) => emp?.reporting_to && u.name.toLowerCase() === emp.reporting_to.toLowerCase())?.id || '';
      return `<div class="hh-act warn"><h3>Confirm the last working day</h3>
        ${H.grid(H.field('xc-lwd', 'Last working day', x.last_working_day || '', { type: 'date', required: true })
          + H.select('xc-mgr', 'Concerned management', mgrGuess, userOptions(), { placeholder: '—' })
          + H.textarea('xc-note', 'Note for the dues clearance (optional)', '', { rows: 2 }))}
        <div style="font-size:11.5px;color:#64748b;margin-top:6px;">Final dues will be asked from: ${esc([...D.people.dues, 'the concerned manager'].join(', '))}.</div>
        <div class="hh-btns"><button class="btn-primary btn-sm" id="xc-go">Confirm & Start Dues Clearance</button></div></div>`;
    }
    if (k.clear) {
      const pending = x.dues.filter((d) => d.status === 'pending');
      const mine = pending.find((d) => d.id === D.me.id);
      return `<div class="hh-act warn"><h3>${mine ? 'Clarify your part of the final dues' : 'Record a clearance (on behalf)'}</h3>
        ${H.grid((mine ? '' : H.select('xd-who', 'Cleared by', '', pending.map((d) => ({ value: d.id, label: `${d.name} (${d.role})` })), { placeholder: 'Choose…', span: 2 }))
          + H.select('xd-dir', 'Final dues', '', [{ value: 'payable', label: 'Payable to the employee' }, { value: 'recoverable', label: 'To recover from the employee' }, { value: 'nil', label: 'Nil — nothing due' }], { placeholder: 'Choose…' })
          + H.field('xd-amt', 'Amount (₹)', '', { type: 'number' })
          + H.textarea('xd-note', 'Details', '', { rows: 2, placeholder: 'Salary days, advance, loan, notice shortfall, assets…' }))}
        <div class="hh-btns"><button class="btn-primary btn-sm" id="xd-go">Mark Cleared</button></div></div>`;
    }
    if (k.complete) {
      return `<div class="hh-act good"><h3>Dues cleared — final leave contract</h3>
        <div style="font-size:12.5px;color:#334155;margin-bottom:8px;">1) Optional: mail the contract to the employee to sign. 2) Upload the signed contract to close the exit.</div>
        ${H.grid(fileInput('xk-file', 'Leave contract to sign', ACCEPT_DOC, { span: 1 })
          + H.field('xk-email', 'Employee email', x.email, { type: 'email' }))}
        <div class="hh-btns"><button class="btn-secondary btn-sm" id="xk-send">Mail Contract to Employee</button></div>
        <div style="border-top:1px solid #bbf7d0;margin:12px 0;"></div>
        ${H.grid(fileInput('xs-file', 'Signed leave contract', ACCEPT_ANY, { required: true })
          + H.textarea('xs-note', 'Note (optional)', '', { rows: 2 }))}
        <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;margin-top:8px;"><input type="checkbox" id="xs-deact" checked/> Mark the employee Inactive and switch off their ERP login (after the last working day)</label>
        <div class="hh-btns"><button class="btn-primary btn-sm" id="xs-go">Upload & Complete</button></div></div>`;
    }
    return '';
  }

  async function viewExit(id) {
    const x = D.exits.find((e) => e.id === id);
    if (!x) return H.fail(new Error('Exit not found'));
    const dues = x.dues.length ? H.table(['Cleared By', 'Role', 'Status', 'Dues', 'Details'], x.dues.map((d) => [
      esc(d.name), esc(d.role), d.status === 'cleared' ? H.pill('Cleared', 'success') : H.pill('Pending', 'warning'),
      d.status === 'cleared' ? (d.direction === 'nil' ? 'Nil' : `${money(d.amount)} ${d.direction === 'payable' ? 'payable' : 'recover'}`) : '—',
      esc([d.note, d.at ? `${d.by || ''} ${H.fmtDate(d.at)}` : ''].filter(Boolean).join(' · ')),
    ])) : '';
    const net = x.dues.reduce((s, d) => s + (d.direction === 'payable' ? Number(d.amount || 0) : d.direction === 'recoverable' ? -Number(d.amount || 0) : 0), 0);
    H.openModal({
      id: 'hh-xv', variant: 'drawer', width: 820, hideConfirm: true, cancelText: 'Close',
      title: `${x.id} · ${x.employee_name}`, subtitle: `${x.exit_type} · recorded by ${x.created_by_name} on ${H.fmtDate(x.created_at)}`,
      bodyHTML: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${pill(x.status)} ${H.pill(x.exit_type, 'neutral')}</div>
        ${exitActionCard(x)}
        ${sub('Employee')}
        <div class="m-grid-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">
          ${H.readout('Employee Code', x.employee_id)}${H.readout('Email', x.email)}
          ${H.readout('Designation', x.designation)}${H.readout('Department', x.department)}
          ${H.readout('Notice Date', H.fmtDate(x.notice_date))}${H.readout('Last Working Day', x.last_working_day ? H.fmtDate(x.last_working_day) : '')}
          ${H.readout('Concerned Manager', x.manager_name)}${x.dues.length ? H.readout('Net Final Dues', `${money(Math.abs(net))} ${net >= 0 ? 'payable' : 'to recover'}`) : ''}
        </div>
        ${x.reason ? `<div style="font-size:12.5px;color:#334155;margin-top:10px;white-space:pre-wrap;">${esc(x.reason)}</div>` : ''}
        ${dues ? sub('Final Dues') + dues : ''}
        ${x.docs.length ? sub('Documents') + docList('exits', x.id, x.docs) : ''}
        <div class="hh-btns">
          ${x.can.withdraw ? '<button class="btn-secondary btn-sm" id="xv-wd">Withdraw</button>' : ''}
          ${x.can.del ? '<button class="btn-secondary btn-sm" id="xv-del" style="color:#dc2626;">Delete</button>' : ''}
        </div>
        ${sub('History')}<div id="xv-log">${H.spinner('')}</div>`,
      onOpen: async () => {
        const $ = (i) => document.getElementById(i);
        const base = `/api/hiring/exits/${encodeURIComponent(x.id)}`;
        const done = (msg) => after('hh-xv', msg).then(() => { if (D.exits.some((e) => e.id === x.id)) viewExit(x.id); });
        $('xc-go')?.addEventListener('click', (e) => busy(e.target, async () => {
          await H.post(`${base}/confirm`, { last_working_day: H.val('xc-lwd'), manager_id: H.val('xc-mgr'), note: H.val('xc-note').trim() });
          await done('Dues clearance started — everyone mailed');
        }));
        $('xd-go')?.addEventListener('click', (e) => busy(e.target, async () => {
          const body = { direction: H.val('xd-dir'), amount: H.val('xd-amt'), note: H.val('xd-note').trim() };
          if ($('xd-who')) { body.clearer_id = H.val('xd-who'); if (!body.clearer_id) throw new Error('Choose who cleared'); }
          if (!body.direction) throw new Error('Choose payable, recoverable or nil');
          const out = await H.post(`${base}/dues`, body);
          await done(out.allClear ? 'All dues cleared — HR mailed for the leave contract' : 'Cleared');
        }));
        $('xk-send')?.addEventListener('click', (e) => busy(e.target, async () => {
          const documents = await readFiles($('xk-file'), 'Leave contract', 1);
          if (!documents.length) throw new Error('Attach the contract to send');
          await H.post(`${base}/contract`, { documents, email: H.val('xk-email').trim() });
          await done('Contract mailed to the employee');
        }));
        $('xs-go')?.addEventListener('click', (e) => busy(e.target, async () => {
          const documents = await readFiles($('xs-file'), 'Signed contract', 1);
          if (!documents.length) throw new Error('Attach the signed leave contract');
          const out = await H.post(`${base}/complete`, { documents, note: H.val('xs-note').trim(), deactivate: !!$('xs-deact')?.checked });
          await done(`Exit completed${out.notes?.length ? ' — ' + out.notes.join(', ') : ''}`);
        }));
        $('xv-wd')?.addEventListener('click', async () => {
          const note = await promptText(`Withdraw ${x.id}`, 'Reason', false);
          if (note === null) return;
          try { await H.post(`${base}/withdraw`, { note }); await done('Withdrawn'); } catch (err) { H.fail(err); }
        });
        $('xv-del')?.addEventListener('click', async () => {
          if (!(await Utils.showConfirm(`Delete ${x.id} and its files? This cannot be undone.`, { title: 'Delete', confirmText: 'Delete', danger: true }))) return;
          try { await H.del(base); await after('hh-xv', 'Deleted'); } catch (err) { H.fail(err); }
        });
        const log = $('xv-log'); if (log) log.innerHTML = await history('exits', x.id, x.docs);
      },
    });
  }

  /* ── Agencies ─────────────────────────────────────────────────────── */

  function agenciesTab() {
    return `
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <div style="font-size:12.5px;color:#64748b;">Hiring agencies the JD is sent to. Each gets its own CV upload link per job request; their replies go to ${esc(D.people.inquiry)}.</div>
        <button class="btn-primary btn-sm" id="ag-new">+ Add Agency</button>
      </div>
      ${H.table(['Agency', 'Contact', 'Email', 'Phone', 'CVs Sent', 'Status', ''], D.agencies.map((a) => [
        `<b>${esc(a.name)}</b>`, esc(a.contact_person), esc(a.email), esc(a.phone),
        String(D.candidates.filter((c) => c.agency_id === a.id).length),
        a.active ? H.pill('Active', 'success') : H.pill('Inactive', 'neutral'),
        `<button class="btn-secondary btn-sm" data-ag="${esc(a.id)}">Edit</button>`,
      ]), { empty: 'No agencies yet', cards: true })}`;
  }

  function agencyForm(a = null) {
    H.openModal({
      id: 'hh-ag', title: a ? `Edit ${a.name}` : 'Add a Hiring Agency',
      bodyHTML: H.grid(
        H.field('ag-name', 'Agency name', a?.name || '', { required: true, span: 2 })
        + H.field('ag-person', 'Contact person', a?.contact_person || '')
        + H.field('ag-phone', 'Phone', a?.phone || '')
        + H.field('ag-email', 'Email', a?.email || '', { type: 'email', required: true, span: 2 })
        + (a ? H.select('ag-active', 'Status', a.active ? '1' : '0', [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive (link stops working)' }], { span: 2 }) : ''),
      ),
      confirmText: 'Save',
      onConfirm: async () => {
        await H.post('/api/hiring/agencies', { id: a?.id, name: H.val('ag-name').trim(), contact_person: H.val('ag-person').trim(), phone: H.val('ag-phone').trim(),
          email: H.val('ag-email').trim(), active: a ? H.val('ag-active') === '1' : true });
        await after('hh-ag', 'Saved');
      },
    });
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  function picker(id, label, selected, hint) {
    return `<div class="hh-card">
      <h3>${esc(label)}</h3>
      <div style="font-size:12px;color:#64748b;margin-bottom:8px;">${esc(hint)}</div>
      <input id="${id}-q" placeholder="Filter people…" style="${H.CONTROL}margin-bottom:6px;"/>
      <div id="${id}" style="max-height:240px;overflow:auto;border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;">
        ${D.users.map((u) => `<label data-row="${esc((u.name + ' ' + u.department).toLowerCase())}" style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0;cursor:pointer;">
          <input type="checkbox" value="${esc(u.id)}"${selected.includes(u.id) ? ' checked' : ''}/> ${esc(u.name)}
          <span style="color:#94a3b8;font-size:11px;">${esc(u.department)}</span></label>`).join('')}
      </div></div>`;
  }

  function settingsTab() {
    const s = D.settings;
    const unset = ['hr', 'mgmt', 'dues'].filter((k) => !s.set[k]);
    return `
      ${unset.length ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:12px;">
        Using the default people (matched by name) until you press Save. Check the ticks below.</div>` : ''}
      <div class="hh-two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${picker('hs-hr', 'HR', s.hr, 'Gets every job request, sends JDs to agencies, prepares and sends appointment letters, runs onboarding and exits.')}
        ${picker('hs-mgmt', 'Approving management', s.mgmt, 'Approve the appointment letter (from the mail or here) and get the candidate\'s answer.')}
        ${picker('hs-dues', 'Final dues (exit)', s.dues, 'Clarify an exiting employee\'s final dues, along with their concerned manager.')}
        ${picker('hs-iv', 'Interviewers', s.interviewers || [], 'Only these people are offered as interviewers on a job request or interview.')}
        <div class="hh-card">
          <h3>Inquiry mailbox</h3>
          <input id="hs-inq" value="${esc(s.inquiry)}" style="${H.CONTROL}" />
          <div style="font-size:11.5px;color:#94a3b8;margin-top:4px;">Agencies and candidates reply to this address; the candidate's answer to the offer is mailed here.</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <span style="font-size:11.5px;color:#64748b;align-self:center;margin-right:auto;">Anyone can raise a job request, interview, and submit their own notice. Seeing everything: HR, management, Admins and anyone given “Hiring & Exit FMS (admin)” in Users → Access.</span>
        <button class="btn-primary btn-sm" id="hs-save">Save Settings</button>
      </div>`;
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  function bindViews(root) {
    (root || document).querySelectorAll('[data-req]').forEach((b) => b.addEventListener('click', () => { H.closeModal('hh-cv-view'); viewRequest(b.getAttribute('data-req')); }));
    (root || document).querySelectorAll('[data-cand]').forEach((b) => b.addEventListener('click', () => { H.closeModal('hh-rv'); viewCand(b.getAttribute('data-cand')); }));
    (root || document).querySelectorAll('[data-exit]').forEach((b) => b.addEventListener('click', () => viewExit(b.getAttribute('data-exit'))));
  }

  function bind() {
    const $ = (id) => document.getElementById(id);
    document.querySelectorAll('[data-hh-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.getAttribute('data-hh-tab'); _f.q = ''; render(); }));
    $('hh-new')?.addEventListener('click', () => requestForm());
    $('hh-exit')?.addEventListener('click', () => exitForm(false));
    $('hh-notice')?.addEventListener('click', () => exitForm(true));
    $('hh-addcv')?.addEventListener('click', () => cvForm());
    let t;
    $('hh-q')?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        _f.q = e.target.value; render();
        const again = $('hh-q'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    });
    $('hh-req-status')?.addEventListener('change', (e) => { _f.req = e.target.value; render(); });
    $('hh-cand-status')?.addEventListener('change', (e) => { _f.cand = e.target.value; render(); });
    $('hh-ob-all')?.addEventListener('change', (e) => { _f.cand = e.target.checked ? 'All' : 'Active'; render(); });
    $('hh-exit-status')?.addEventListener('change', (e) => { _f.exit = e.target.value; render(); });
    bindViews(document.getElementById('main-content'));

    $('ag-new')?.addEventListener('click', () => agencyForm());
    document.querySelectorAll('[data-ag]').forEach((b) => b.addEventListener('click', () => agencyForm(D.agencies.find((a) => a.id === b.getAttribute('data-ag')))));

    ['hs-hr', 'hs-mgmt', 'hs-dues', 'hs-iv'].forEach((id) => $(`${id}-q`)?.addEventListener('input', (e) => {
      const n = e.target.value.trim().toLowerCase();
      document.querySelectorAll(`#${id} [data-row]`).forEach((row) => { row.style.display = !n || row.getAttribute('data-row').includes(n) ? 'flex' : 'none'; });
    }));
    $('hs-save')?.addEventListener('click', (e) => busy(e.target, async () => {
      await H.post('/api/hiring/settings', { hr: picked('hs-hr'), mgmt: picked('hs-mgmt'), dues: picked('hs-dues'), interviewers: picked('hs-iv'), inquiry: H.val('hs-inq').trim() });
      H.toast('Settings saved');
      await refresh();
    }));
  }


  /* Offer / Appointment letter in HR's Word format (25 Nov 2026). The form
     starts from what was typed last time for this candidate, else from the
     candidate and the job request. */
  function letterForm(type, c, r) {
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const last = c.letter_fields || {};
    const v = (k, d) => (last[k] != null && last[k] !== '' ? last[k] : d);
    const firstName = String(c.name || '').trim().split(/\s+/)[0] || '';
    const money = (id, label, val) => H.field(id, label, val ?? '', { type: 'number', step: '1' });
    const appt = type === 'appointment';
    H.openModal({
      id: 'hh-letter', width: 760, title: appt ? 'Appointment Letter' : 'Offer Letter',
      subtitle: `${c.name} — filled into HR's Word format`,
      bodyHTML: `${H.grid(
        H.field('lt-date', 'Letter date', v('date', today), { type: 'date', required: true })
        + (appt ? H.field('lt-ref', 'Ref No. (after LA/PRS/)', v('ref', ''), { placeholder: 'e.g. 25-26/014' }) : '<div></div>')
        + H.field('lt-name', 'Candidate name', v('name', c.name), { required: true })
        + H.field('lt-sal', 'Salutation (Dear …)', v('salutation', firstName))
        + H.textarea('lt-addr', 'Address', v('address', ''), { rows: 3, span: 2, placeholder: 'One line per row' })
        + H.field('lt-pos', 'Position', v('position', c.designation || r?.position || ''), { required: true })
        + H.field('lt-start', 'Joining date', v('start', c.doj || ''), { type: 'date', required: appt })
        + (appt ? '' : H.field('lt-dept', 'Department', v('department', r?.division || '')) + H.field('lt-mgr', 'Reporting Manager', v('manager', r?.requested_by_name || '')))
        + (appt ? '' : H.field('lt-loc', 'Location', v('location', r?.location || '')))
        + H.field('lt-hours', 'Work hours', v('hours', ''), { span: appt ? 2 : 1, placeholder: '9:30 am to 6:00 pm, Monday to Friday and 1st, 3rd and 5th Saturday of the month' })
        + (appt ? H.field('lt-focus', 'Work area (…excel in ___ / responsible for ___)', v('focus', ''), { span: 2, placeholder: 'e.g. accounting and documentation' }) : ''),
      )}
      <div style="font-weight:700;font-size:13px;margin:14px 0 4px;">Salary per month</div>
      ${H.grid(
        money('lt-basic', 'Basic', v('basic', '')) + money('lt-hra', 'HRA', v('hra', ''))
        + money('lt-conv', 'Conveyance', v('conveyance', '')) + money('lt-med', 'Medical', v('medical', ''))
        + money('lt-tel', 'Telephone', v('telephone', '')) + `<div><label style="${H.LABEL}">Gross</label><div id="lt-gross" style="${H.CONTROL}background:#f8fafc;font-weight:700;">—</div></div>`
        + (appt ? H.field('lt-prob', 'Probation (months)', v('probation', 3), { type: 'number', step: '1' })
          + `<div><label style="${H.LABEL}">Provident Fund & ESIC</label><label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:8px;"><input type="checkbox" id="lt-pf"${last.pf ? ' checked' : ''}/> Eligible for PF & ESIC</label></div>` : ''),
      )}`,
      confirmText: 'Generate & Download',
      onOpen: () => {
        const ids = ['lt-basic', 'lt-hra', 'lt-conv', 'lt-med', 'lt-tel'];
        const sum = () => {
          const g = ids.reduce((a, id) => a + (Number(document.getElementById(id)?.value) || 0), 0);
          const el = document.getElementById('lt-gross');
          if (el) el.textContent = g ? '₹ ' + g.toLocaleString('en-IN') : '—';
        };
        ids.forEach((id) => document.getElementById(id)?.addEventListener('input', sum));
        sum();
      },
      onConfirm: async () => {
        const g = (id) => (document.getElementById(id) ? H.val(id) : '');
        const fields = {
          date: g('lt-date'), ref: g('lt-ref'), name: g('lt-name').trim(), salutation: g('lt-sal').trim(), address: g('lt-addr').trim(),
          position: g('lt-pos').trim(), start: g('lt-start'), department: g('lt-dept').trim(), manager: g('lt-mgr').trim(), location: g('lt-loc').trim(),
          hours: g('lt-hours').trim(), focus: g('lt-focus').trim(),
          basic: g('lt-basic'), hra: g('lt-hra'), conveyance: g('lt-conv'), medical: g('lt-med'), telephone: g('lt-tel'),
          probation: g('lt-prob'), pf: !!document.getElementById('lt-pf')?.checked,
        };
        const out = await H.post(`/api/hiring/candidates/${c.id}/letter`, { type, fields });
        const blob = await (await fetch(out.dataUrl)).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = out.fileName;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        // The appointment letter goes straight into the "send for approval" box.
        const input = document.getElementById('co-file');
        if (appt && input && window.DataTransfer) {
          try { const dt = new DataTransfer(); dt.items.add(new File([blob], out.fileName, { type: blob.type })); input.files = dt.files; input.dispatchEvent(new Event('change')); } catch { /* the download is enough */ }
        }
        c.letter_fields = fields;
        H.closeModal('hh-letter');
        H.toast(appt ? 'Appointment letter downloaded and attached below — check it, then Send for Approval' : 'Offer letter downloaded');
      },
    });
  }
  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Opening Hiring & Exit FMS…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load the Hiring & Exit FMS', e.message); }
    },
  };
})();
