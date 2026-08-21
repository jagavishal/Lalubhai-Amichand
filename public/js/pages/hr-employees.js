/* =====================================================================
   Employee Master
   ---------------------------------------------------------------------
   The record of everyone the company employs, and the anchor for the rest
   of the HR module: attendance, leave, payroll and every HR report key off
   the employee code shown here.

   Deliberately separate from Users (the login list). Most of the factory
   staff have no login at all, and one shared department mailbox can sit
   behind several logins — so an employee is its own record, optionally
   linked to a user account (Link Logins, and hr_employees.user_id).
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages['hr-employees'] = (() => {
  const H = window.HR;

  let _list = [];
  let _masters = { departments: [], designations: [], branches: [], leaveTypes: [], earnings: [], deductions: [] };
  let _filters = { status: 'Active', branch: 'All', department: 'All', q: '' };
  let _profile = null;      // the loaded 360° view of one employee
  let _profileTab = 'overview';

  const STATUSES = ['Active', 'Inactive', 'Probation', 'Notice Period'];
  const EMP_TYPES = ['Staff', 'Worker', 'Director', 'Contract', 'Intern'];
  const GENDERS = ['Male', 'Female', 'Other'];
  const MARITAL = ['Single', 'Married', 'Widowed', 'Divorced'];
  const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

  /* Whole years between a date and today — how tenure and age are spoken
     about, and what the headcount reports use. */
  function years(iso) {
    if (!iso) return null;
    const d = new Date(String(iso).slice(0, 10));
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  }

  async function load() {
    const params = new URLSearchParams();
    if (_filters.status !== 'All') params.set('status', _filters.status);
    if (_filters.branch !== 'All') params.set('branch', _filters.branch);
    if (_filters.department !== 'All') params.set('department', _filters.department);
    if (_filters.q) params.set('q', _filters.q);
    const [list, masters] = await Promise.all([
      H.api('/api/hr/employees?' + params.toString()),
      _masters.branches.length ? Promise.resolve(_masters) : H.api('/api/hr/masters'),
    ]);
    _list = Array.isArray(list) ? list : [];
    if (masters) _masters = masters;
  }

  /* ── List view ────────────────────────────────────────────────────── */

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const admin = H.isAdmin();

    const actions = admin ? `
      <button id="hre-import" class="btn-secondary btn-sm">Import from Sheet</button>
      <button id="hre-link" class="btn-secondary btn-sm">Link Logins</button>
      <button id="hre-add" class="btn-primary btn-sm">+ Add Employee</button>` : '';

    const active = _list.filter((e) => e.status === 'Active');
    const statTiles = H.stats([
      { label: 'Employees Shown', value: _list.length },
      { label: 'Active', value: active.length, color: '#16a34a' },
      { label: 'Departments', value: new Set(active.map((e) => e.department).filter(Boolean)).size },
      { label: 'Branches', value: new Set(active.map((e) => e.branch).filter(Boolean)).size },
    ]);

    const filterBar = `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:13px 15px;margin-bottom:14px;
           display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px;align-items:end;">
        ${H.select('hre-f-status', 'Status', _filters.status, ['All', ...STATUSES])}
        ${H.select('hre-f-branch', 'Branch', _filters.branch, ['All', ...(_masters.branches || [])])}
        ${H.select('hre-f-dept', 'Department', _filters.department, ['All', ...(_masters.departments || [])])}
        ${H.field('hre-f-q', 'Search', _filters.q, { placeholder: 'Name, code or designation' })}
      </div>`;

    const rows = _list.map((e) => {
      const tenure = years(e.doj);
      return [
        `<span style="font-weight:700;color:var(--color-primary);">${H.esc(e.id)}</span>`,
        `<div style="display:flex;align-items:center;gap:9px;">
           ${UI.avatar(e.name, { size: 30 })}
           <div style="min-width:0;">
             <div style="font-weight:600;color:#0f172a;">${H.esc(e.name)}</div>
             <div style="font-size:11px;color:#94a3b8;">${H.esc(e.designation || '—')}</div>
           </div>
         </div>`,
        H.esc(e.department || '—'),
        H.esc(e.branch || '—'),
        H.fmtDate(e.doj),
        tenure == null ? '—' : `${tenure} yr${tenure === 1 ? '' : 's'}`,
        H.statusPill(e.status),
        `<div style="display:flex;gap:6px;white-space:nowrap;">
           <button class="btn-ghost btn-xs hre-view" data-id="${H.esc(e.id)}">View</button>
           ${admin ? `<button class="btn-ghost btn-xs hre-edit" data-id="${H.esc(e.id)}">Edit</button>` : ''}
         </div>`,
      ];
    });

    el.innerHTML = `
      <div class="animate-fade-in">
        ${H.header('Employee Master', 'Everyone on the rolls — personal details, salary structure, leave and documents', actions)}
        ${statTiles}
        ${filterBar}
        ${H.table(
          ['Code', 'Employee', 'Department', 'Branch', 'Joined', 'Tenure', 'Status', { label: 'Actions', nowrap: true }],
          rows,
          { empty: _filters.q || _filters.status !== 'Active'
              ? 'No employee matches these filters'
              : 'No employees yet — add one, or import the old HRMS sheet' },
        )}
      </div>`;

    bindList();
  }

  function bindList() {
    const reload = async () => { try { await load(); render(); } catch (e) { H.fail(e); } };
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

    on('hre-f-status', 'change', (e) => { _filters.status = e.target.value; reload(); });
    on('hre-f-branch', 'change', (e) => { _filters.branch = e.target.value; reload(); });
    on('hre-f-dept', 'change', (e) => { _filters.department = e.target.value; reload(); });

    // Search waits for a pause in typing rather than firing per keystroke —
    // the list query hits the database on every call.
    let timer = null;
    const q = document.getElementById('hre-f-q');
    q?.addEventListener('input', (e) => {
      _filters.q = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await load();
        render();
        const box = document.getElementById('hre-f-q');
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }, 350);
    });

    on('hre-add', 'click', () => openEmployeeForm(null));
    on('hre-link', 'click', linkLogins);
    on('hre-import', 'click', openImport);
    document.querySelectorAll('.hre-view').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.id)));
    document.querySelectorAll('.hre-edit').forEach((b) => b.addEventListener('click', () => {
      openEmployeeForm(_list.find((x) => x.id === b.dataset.id));
    }));
  }

  /* ── Add / edit ───────────────────────────────────────────────────── */

  function openEmployeeForm(emp) {
    const isNew = !emp;
    const e = emp || {};
    const peers = (_masters.employees || []).filter((p) => p.id !== e.id)
      .map((p) => ({ value: p.id, label: `${p.name} (${p.id})` }));

    const body = H.grid(`
      ${H.sectionTitle('Identity')}
      ${H.field('hre-id', 'Employee Code', e.id || '',
        { placeholder: 'Auto (e.g. MUM030)', readonly: !isNew,
          hint: isNew ? 'Leave blank to generate from the branch' : 'A code cannot be changed once issued' })}
      ${H.field('hre-name', 'Full Name', e.name || '', { required: true })}
      ${H.field('hre-email', 'Email', e.email || '', { type: 'email' })}
      ${H.field('hre-phone', 'Contact No', e.phone || '')}

      ${H.sectionTitle('Job')}
      ${H.field('hre-designation', 'Designation', e.designation || '')}
      ${H.select('hre-department', 'Department', e.department || '', _masters.departments || [], { placeholder: 'Select…' })}
      ${H.select('hre-branch', 'Branch', e.branch || '', _masters.branches || [], { placeholder: 'Select…' })}
      ${H.select('hre-emp_type', 'Employment Type', e.emp_type || 'Staff', EMP_TYPES)}
      ${H.field('hre-doj', 'Date of Joining', e.doj || '', { type: 'date' })}
      ${H.select('hre-status', 'Status', e.status || 'Active', STATUSES)}
      ${H.select('hre-reporting_to', 'Reports To', e.reporting_to || '', peers, { placeholder: '— None —' })}
      ${H.field('hre-probation_months', 'Probation (months)', e.probation_months || 0, { type: 'number' })}
      ${H.field('hre-confirmed_on', 'Confirmed On', e.confirmed_on || '', { type: 'date' })}
      ${H.field('hre-dol', 'Date of Leaving', e.dol || '', { type: 'date', hint: 'Set from the Exit tab, normally' })}

      ${H.sectionTitle('Personal')}
      ${H.field('hre-dob', 'Date of Birth', e.dob || '', { type: 'date' })}
      ${H.select('hre-gender', 'Gender', e.gender || '', GENDERS, { placeholder: '—' })}
      ${H.select('hre-marital_status', 'Marital Status', e.marital_status || '', MARITAL, { placeholder: '—' })}
      ${H.select('hre-blood_group', 'Blood Group', e.blood_group || '', BLOOD, { placeholder: '—' })}
      ${H.field('hre-qualification', 'Qualification', e.qualification || '')}
      ${H.field('hre-experience', 'Prior Experience', e.experience || '', { placeholder: 'e.g. 4 years' })}
      ${H.textarea('hre-address', 'Address', e.address || '', { rows: 2 })}
      ${H.field('hre-emergency_name', 'Emergency Contact', e.emergency_name || '')}
      ${H.field('hre-emergency_phone', 'Emergency Contact No', e.emergency_phone || '')}

      ${H.sectionTitle('Statutory & Bank')}
      ${H.field('hre-uan', 'UAN', e.uan || '')}
      ${H.field('hre-aadhar_no', 'Aadhar No', e.aadhar_no || '')}
      ${H.field('hre-pan_no', 'PAN', e.pan_no || '')}
      ${H.field('hre-bank_name', 'Bank Name', e.bank_name || '')}
      ${H.field('hre-account_no', 'Account No', e.account_no || '')}
      ${H.field('hre-ifsc', 'IFSC Code', e.ifsc || '')}
      ${H.field('hre-aadhar_url', 'Aadhar Document Link', e.aadhar_url || '', { span: 2 })}
      ${H.field('hre-pan_url', 'PAN Document Link', e.pan_url || '', { span: 2 })}
      ${H.field('hre-avatar_url', 'Photo Link', e.avatar_url || '', { span: 2 })}
      ${H.textarea('hre-notes', 'Notes', e.notes || '', { rows: 2 })}
    `);

    const FIELDS = ['name', 'email', 'phone', 'designation', 'department', 'branch', 'emp_type', 'doj', 'status',
      'reporting_to', 'probation_months', 'confirmed_on', 'dol', 'dob', 'gender', 'marital_status', 'blood_group',
      'qualification', 'experience', 'address', 'emergency_name', 'emergency_phone', 'uan', 'aadhar_no', 'pan_no',
      'bank_name', 'account_no', 'ifsc', 'aadhar_url', 'pan_url', 'avatar_url', 'notes'];

    H.openModal({
      id: 'hre-form',
      title: isNew ? 'Add Employee' : `Edit ${e.name}`,
      subtitle: isNew ? 'A code is generated from the branch unless you set one' : `Employee code ${e.id}`,
      width: 720,
      confirmText: isNew ? 'Add Employee' : 'Save Changes',
      onConfirm: async () => {
        const payload = Object.fromEntries(FIELDS.map((f) => [f, H.val('hre-' + f)]));
        if (!payload.name.trim()) { H.toast('Employee name is required', 'error'); throw new Error('validation'); }
        if (isNew) payload.id = H.val('hre-id').trim();
        else payload.id = e.id;
        await (isNew ? H.post('/api/hr/employees', payload) : H.patch('/api/hr/employees', payload));
        H.closeModal('hre-form');
        H.toast(isNew ? 'Employee added' : 'Employee updated');
        await load();
        render();
      },
    });
  }

  /* ── Profile ──────────────────────────────────────────────────────── */

  async function openProfile(id) {
    H.openModal({ id: 'hre-profile', title: 'Loading…', width: 840, bodyHTML: H.spinner(), hideConfirm: true, cancelText: 'Close' });
    try {
      _profile = await H.api(`/api/hr/employees/${encodeURIComponent(id)}`);
      _profileTab = 'overview';
      renderProfile();
    } catch (e) {
      H.closeModal('hre-profile');
      H.fail(e);
    }
  }

  function renderProfile() {
    const p = _profile;
    if (!p) return;
    const e = p.employee;
    const admin = H.isAdmin();

    const TABS = [
      { key: 'overview', label: 'Overview' },
      { key: 'salary', label: 'Salary', count: p.structures.length },
      { key: 'leave', label: 'Leave' },
      { key: 'payslips', label: 'Payslips', count: p.payslips.length },
      { key: 'documents', label: 'Documents', count: p.documents.length },
      { key: 'joining', label: 'Joining', count: p.onboarding.length },
      { key: 'exit', label: 'Exit' },
    ];

    const body = `
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:16px;">
        <div style="position:relative;width:52px;height:52px;flex-shrink:0;">
          ${UI.avatar(e.name, { size: 52, shape: 'square' })}
          ${e.avatar_url
            // Sits on top of the initials tile, so a Drive link that has gone
            // private (several on the old sheet have) simply falls back
            // instead of leaving a broken-image box.
            ? `<img src="${H.esc(e.avatar_url)}" alt="" onerror="this.remove()"
                 style="position:absolute;inset:0;width:52px;height:52px;border-radius:var(--radius-md);object-fit:cover;" />`
            : ''}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${H.esc(e.name)}</div>
          <div style="font-size:12.5px;color:#64748b;">${H.esc(e.designation || '—')} · ${H.esc(e.department || '—')} · ${H.esc(e.branch || '—')}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:700;color:var(--color-primary);">${H.esc(e.id)}</div>
          <div style="margin-top:4px;">${H.statusPill(e.status)}</div>
        </div>
      </div>
      ${H.tabs('hrep', TABS, _profileTab)}
      <div id="hrep-body">${profileTabBody(admin)}</div>`;

    H.openModal({
      id: 'hre-profile', title: `${e.name} — Employee Record`, subtitle: `Joined ${H.fmtDate(e.doj)}`,
      width: 880, bodyHTML: body, hideConfirm: true, cancelText: 'Close',
    });
    bindProfile();
  }

  function profileTabBody(admin) {
    const p = _profile;
    const e = p.employee;

    if (_profileTab === 'overview') {
      return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:8px;">Job</div>
          ${H.readout('Employee Code', e.id)}
          ${H.readout('Designation', e.designation)}
          ${H.readout('Department', e.department)}
          ${H.readout('Branch', e.branch)}
          ${H.readout('Employment Type', e.emp_type)}
          ${H.readout('Date of Joining', H.fmtDate(e.doj))}
          ${H.readout('Tenure', years(e.doj) == null ? '—' : years(e.doj) + ' years')}
          ${H.readout('Reports To', reportingName(e.reporting_to))}
          ${e.dol ? H.readout('Date of Leaving', H.fmtDate(e.dol)) : ''}
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:16px 0 8px;">Contact</div>
          ${H.readout('Email', e.email)}
          ${H.readout('Phone', e.phone)}
          ${H.readout('Emergency', [e.emergency_name, e.emergency_phone].filter(Boolean).join(' · '))}
          ${H.readout('Address', e.address)}
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:8px;">Personal</div>
          ${H.readout('Date of Birth', H.fmtDate(e.dob))}
          ${H.readout('Age', years(e.dob) == null ? '—' : years(e.dob) + ' years')}
          ${H.readout('Gender', e.gender)}
          ${H.readout('Marital Status', e.marital_status)}
          ${H.readout('Blood Group', e.blood_group)}
          ${H.readout('Qualification', e.qualification)}
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:16px 0 8px;">Statutory & Bank</div>
          ${H.readout('UAN', e.uan)}
          ${H.readout('Aadhar', e.aadhar_no)}
          ${H.readout('PAN', e.pan_no)}
          ${H.readout('Bank', e.bank_name)}
          ${H.readout('Account No', e.account_no)}
          ${H.readout('IFSC', e.ifsc)}
          ${H.readout('Linked Login', e.user_id ? 'Yes' : 'Not linked')}
        </div>
      </div>`;
    }

    if (_profileTab === 'salary') {
      const cur = p.current;
      const head = cur
        ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:14px 16px;margin-bottom:14px;
              display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;">
             <div><div style="font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Gross / Month</div>
               <div style="font-size:18px;font-weight:700;color:#0f172a;">₹ ${H.inr0(cur.gross)}</div></div>
             <div><div style="font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Deductions</div>
               <div style="font-size:18px;font-weight:700;color:#b91c1c;">₹ ${H.inr0(cur.deductions)}</div></div>
             <div><div style="font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Net / Month</div>
               <div style="font-size:18px;font-weight:700;color:#15803d;">₹ ${H.inr0(cur.gross - cur.deductions)}</div></div>
             <div><div style="font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Annual CTC</div>
               <div style="font-size:18px;font-weight:700;color:#0f172a;">₹ ${H.inr0(cur.gross * 12)}</div></div>
             <div><div style="font-size:10.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">In Force Since</div>
               <div style="font-size:14px;font-weight:600;color:#0f172a;margin-top:3px;">${H.fmtDate(cur.effective_from)}</div></div>
           </div>`
        : `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:12px 14px;margin-bottom:14px;
              font-size:12.5px;color:#92400e;">No salary structure on record — payroll will generate a zero payslip for this employee until one is added.</div>`;

      const cols = ['Effective From', ...(_masters.earnings || []).map((x) => x.label), 'Gross',
        ...(_masters.deductions || []).map((x) => x.label), 'Deductions', 'Net', 'Remarks'];
      const rows = p.structures.map((s) => [
        `<b>${H.fmtDate(s.effective_from)}</b>`,
        ...(_masters.earnings || []).map((x) => H.inr(s[x.key])),
        `<b>${H.inr(s.gross)}</b>`,
        ...(_masters.deductions || []).map((x) => H.inr(s[x.key])),
        H.inr(s.deductions),
        `<b>${H.inr(s.gross - s.deductions)}</b>`,
        H.esc(s.remarks || '—'),
      ]);
      return `${head}
        ${admin ? '<div style="margin-bottom:12px;"><button id="hrep-add-salary" class="btn-primary btn-sm">+ Add Salary Revision</button></div>' : ''}
        ${H.table(cols.map((c, i) => (i === 0 ? c : { label: c, align: 'right' })), rows,
          { empty: 'No salary structure recorded yet', maxHeight: '340px' })}
        <div style="font-size:11.5px;color:#94a3b8;margin-top:9px;line-height:1.5;">
          A revision never overwrites the previous one — each row stays as the basis for the payslips issued while it was in force.
        </div>`;
    }

    if (_profileTab === 'leave') {
      const rows = p.balances.map((b) => [
        `<b>${H.esc(b.code)}</b> <span style="color:#94a3b8;">${H.esc(b.name)}</span>`,
        H.num(b.opening), H.num(b.accrued), H.num(b.used),
        `<b style="color:${H.num(b.balance) > 0 ? '#15803d' : '#b91c1c'};">${H.num(b.balance)}</b>`,
      ]);
      const hist = p.leaves.map((l) => [
        H.esc(l.leave_type || '—'),
        `${H.fmtDate(l.from_date)} → ${H.fmtDate(l.to_date)}`,
        H.num(l.total_days) + (l.half_day && l.half_day !== 'full' ? ' (half)' : ''),
        H.esc(l.reason || '—'),
        H.statusPill(l.status),
        H.esc(l.approver_name || '—'),
      ]);
      return `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin-bottom:8px;">
          Balances for ${p.year}</div>
        ${H.table(['Leave Type', { label: 'Opening', align: 'right' }, { label: 'Entitled', align: 'right' },
          { label: 'Used', align: 'right' }, { label: 'Balance', align: 'right' }], rows)}
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-primary);margin:18px 0 8px;">
          Leave History</div>
        ${H.table(['Type', 'Period', { label: 'Days', align: 'right' }, 'Reason', 'Status', 'Approver'], hist,
          { empty: 'No leave taken yet', maxHeight: '280px' })}`;
    }

    if (_profileTab === 'payslips') {
      const rows = p.payslips.map((s) => [
        `<b>${H.esc(s.id)}</b>`,
        `${H.MONTHS[s.month - 1]} ${s.year}`,
        H.inr(s.total_gross), H.inr(s.total_deductions), H.inr(s.leave_deduction),
        `<b>${H.inr(s.net_salary)}</b>`,
        `<a href="/api/hr/payslip/${encodeURIComponent(s.id)}/print" target="_blank" rel="noopener"
            class="btn-ghost btn-xs" style="text-decoration:none;">Print</a>`,
      ]);
      return H.table(['Slip No', 'Period', { label: 'Gross', align: 'right' }, { label: 'Deductions', align: 'right' },
        { label: 'LOP', align: 'right' }, { label: 'Net', align: 'right' }, 'Slip'], rows,
        { empty: 'No payslips generated for this employee yet', maxHeight: '400px' });
    }

    if (_profileTab === 'documents') {
      const rows = p.documents.map((d) => [
        H.esc(d.doc_type), H.esc(d.doc_no || '—'),
        d.url ? `<a href="${H.esc(d.url)}" target="_blank" rel="noopener" style="color:var(--color-primary);">Open</a>` : '—',
        H.fmtDate(d.issued_on),
        d.expires_on
          ? `<span style="color:${d.expires_on < H.todayISO() ? '#b91c1c' : '#334155'};">${H.fmtDate(d.expires_on)}</span>`
          : '—',
        H.esc(d.remarks || '—'),
        admin ? `<button class="btn-ghost btn-xs hrep-doc-del" data-id="${H.esc(d.id)}" style="color:#b91c1c;">Remove</button>` : '',
      ]);
      const onFile = [
        e.aadhar_url ? { doc_type: 'Aadhar Card', doc_no: e.aadhar_no, url: e.aadhar_url } : null,
        e.pan_url ? { doc_type: 'PAN Card', doc_no: e.pan_no, url: e.pan_url } : null,
      ].filter(Boolean);
      return `
        ${admin ? '<div style="margin-bottom:12px;"><button id="hrep-add-doc" class="btn-primary btn-sm">+ Add Document</button></div>' : ''}
        ${onFile.length ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;margin-bottom:13px;
             font-size:12.5px;color:#475569;">On the master record:
             ${onFile.map((d) => `<a href="${H.esc(d.url)}" target="_blank" rel="noopener" style="color:var(--color-primary);margin-right:12px;">${H.esc(d.doc_type)}</a>`).join('')}</div>` : ''}
        ${H.table(['Type', 'Number', 'File', 'Issued', 'Expires', 'Remarks', ''], rows, { empty: 'No documents recorded' })}`;
    }

    if (_profileTab === 'joining') {
      if (!p.onboarding.length) {
        return `${H.empty('No joining checklist started',
          'Start the standard checklist — offer letter, documents, PF and ESIC registration, assets, induction — and tick items off as they are done.')}
          ${admin ? '<div style="text-align:center;margin-top:14px;"><button id="hrep-seed-onb" class="btn-primary btn-sm">Start Joining Checklist</button></div>' : ''}`;
      }
      const done = p.onboarding.filter((o) => o.status === 'done').length;
      const rows = p.onboarding.map((o) => [
        admin
          ? `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
               <input type="checkbox" class="hrep-onb" data-id="${H.esc(o.id)}" ${o.status === 'done' ? 'checked' : ''}
                 style="width:15px;height:15px;cursor:pointer;accent-color:var(--color-primary);" />
               <span style="${o.status === 'done' ? 'color:#94a3b8;text-decoration:line-through;' : ''}">${H.esc(o.item)}</span></label>`
          : `<span style="${o.status === 'done' ? 'color:#94a3b8;text-decoration:line-through;' : ''}">${H.esc(o.item)}</span>`,
        H.fmtDate(o.due_date), o.status === 'done' ? H.fmtDate(o.done_on) : '—',
        H.statusPill(o.status === 'done' ? 'done' : 'pending'),
        admin ? `<button class="btn-ghost btn-xs hrep-onb-del" data-id="${H.esc(o.id)}" style="color:#b91c1c;">Remove</button>` : '',
      ]);
      const pct = Math.round((done / p.onboarding.length) * 100);
      return `
        <div style="margin-bottom:13px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:5px;">
            <span>${done} of ${p.onboarding.length} complete</span><span>${pct}%</span></div>
          <div style="height:7px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${pct === 100 ? '#16a34a' : 'var(--color-primary)'};transition:width .3s;"></div></div>
        </div>
        ${admin ? '<div style="margin-bottom:12px;"><button id="hrep-add-onb" class="btn-secondary btn-sm">+ Add Item</button></div>' : ''}
        ${H.table(['Item', 'Due', 'Completed', 'Status', ''], rows)}`;
    }

    if (_profileTab === 'exit') {
      const x = p.exit;
      if (!x) {
        return `${H.empty('No exit recorded', 'Recording an exit sets the last working day, marks the employee Inactive from that date, and opens the full & final settlement.')}
          ${admin ? '<div style="text-align:center;margin-top:14px;"><button id="hrep-exit" class="btn-primary btn-sm">Record Exit</button></div>' : ''}`;
      }
      return `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
          <div>
            ${H.readout('Exit Type', x.exit_type)}
            ${H.readout('Resignation Date', H.fmtDate(x.resign_date))}
            ${H.readout('Last Working Day', H.fmtDate(x.last_working_day))}
            ${H.readout('Notice Period', x.notice_days ? `${x.notice_days} days` : '—')}
            ${H.readout('Notice Served', x.notice_served ? 'Yes' : 'No')}
          </div>
          <div>
            ${H.readout('Full & Final Amount', x.fnf_amount ? '₹ ' + H.inr(x.fnf_amount) : '—')}
            ${H.readout('Settlement Status', x.fnf_status)}
            ${H.readout('Paid On', H.fmtDate(x.fnf_paid_on))}
            ${H.readout('Reason', x.reason)}
            ${H.readout('Remarks', x.remarks)}
          </div>
        </div>
        ${admin ? '<div style="margin-top:14px;"><button id="hrep-exit" class="btn-secondary btn-sm">Edit Exit Record</button></div>' : ''}`;
    }
    return '';
  }

  const reportingName = (key) => {
    if (!key) return '—';
    const m = (_masters.employees || []).find((x) => x.id === key);
    return m ? `${m.name} (${m.id})` : key;
  };

  function bindProfile() {
    const rerender = () => {
      const box = document.getElementById('hrep-body');
      if (box) { box.innerHTML = profileTabBody(H.isAdmin()); bindProfileBody(); }
      document.querySelectorAll('[data-hrep-tab]').forEach((b) => {
        const on = b.dataset.hrepTab === _profileTab;
        b.style.fontWeight = on ? '700' : '500';
        b.style.color = on ? 'var(--color-primary)' : '#64748b';
        b.style.borderBottomColor = on ? 'var(--color-primary)' : 'transparent';
      });
    };
    document.querySelectorAll('[data-hrep-tab]').forEach((b) => {
      b.addEventListener('click', () => { _profileTab = b.dataset.hrepTab; rerender(); });
    });
    bindProfileBody();
  }

  // Reloads the profile from the server, so a change made in one tab is
  // reflected everywhere (a new salary row also moves the "current" header).
  async function refreshProfile() {
    _profile = await H.api(`/api/hr/employees/${encodeURIComponent(_profile.employee.id)}`);
    const box = document.getElementById('hrep-body');
    if (box) { box.innerHTML = profileTabBody(H.isAdmin()); bindProfileBody(); }
  }

  function bindProfileBody() {
    const id = _profile?.employee?.id;
    const on = (elId, fn) => document.getElementById(elId)?.addEventListener('click', fn);

    on('hrep-add-salary', () => openSalaryForm());
    on('hrep-add-doc', () => openDocForm());
    on('hrep-add-onb', () => openOnbForm());
    on('hrep-exit', () => openExitForm());
    on('hrep-seed-onb', async () => {
      try {
        await H.post('/api/hr/onboarding', { employeeId: id, seedDefaults: true });
        H.toast('Joining checklist started');
        await refreshProfile();
      } catch (e) { H.fail(e); }
    });

    document.querySelectorAll('.hrep-onb').forEach((cb) => cb.addEventListener('change', async () => {
      try {
        await H.patch('/api/hr/onboarding', { id: cb.dataset.id, status: cb.checked ? 'done' : 'pending' });
        await refreshProfile();
      } catch (e) { H.fail(e); cb.checked = !cb.checked; }
    }));
    document.querySelectorAll('.hrep-onb-del').forEach((b) => b.addEventListener('click', async () => {
      try { await H.del('/api/hr/onboarding?id=' + encodeURIComponent(b.dataset.id)); await refreshProfile(); }
      catch (e) { H.fail(e); }
    }));
    document.querySelectorAll('.hrep-doc-del').forEach((b) => b.addEventListener('click', async () => {
      if (!await Utils.showConfirm('Remove this document from the employee record?', { title: 'Remove Document', confirmText: 'Remove', danger: true })) return;
      try { await H.del('/api/hr/documents?id=' + encodeURIComponent(b.dataset.id)); await refreshProfile(); }
      catch (e) { H.fail(e); }
    }));
  }

  /* ── Sub-forms opened from the profile ────────────────────────────── */

  function openSalaryForm() {
    const cur = _profile.current;
    const E = _masters.earnings || [];
    const D = _masters.deductions || [];
    // Pre-filled from the structure in force: a revision is nearly always a
    // change to one or two heads, not a fresh sheet of paper.
    const body = H.grid(`
      ${H.field('hrs-effective_from', 'Effective From', H.todayISO(), { type: 'date', required: true, span: 2,
        hint: 'Payslips from this month onward use these figures' })}
      ${H.sectionTitle('Earnings')}
      ${E.map((x) => H.field('hrs-' + x.key, x.label, cur ? cur[x.key] : 0, { type: 'number', step: '0.01' })).join('')}
      ${H.sectionTitle('Deductions')}
      ${D.map((x) => H.field('hrs-' + x.key, x.label, cur ? cur[x.key] : 0, { type: 'number', step: '0.01' })).join('')}
      ${H.field('hrs-remarks', 'Remarks', '', { span: 2, placeholder: 'e.g. Annual increment 2026' })}
      <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:12px;
           background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;">
        <button type="button" id="hrs-suggest" class="btn-secondary btn-sm">Suggest PF / ESIC / PT</button>
        <div style="text-align:right;font-size:12.5px;color:#475569;">
          Gross <b id="hrs-gross" style="color:#0f172a;">0</b> &nbsp;·&nbsp;
          Deductions <b id="hrs-ded" style="color:#b91c1c;">0</b> &nbsp;·&nbsp;
          Net <b id="hrs-net" style="color:#15803d;">0</b>
        </div>
      </div>
    `);

    H.openModal({
      id: 'hrs-form', title: 'Add Salary Revision', subtitle: `${_profile.employee.name} · ${_profile.employee.id}`,
      width: 640, confirmText: 'Save Revision', bodyHTML: body,
      onOpen: () => {
        const recalc = () => {
          const g = E.reduce((t, x) => t + H.num(H.val('hrs-' + x.key)), 0);
          const d = D.reduce((t, x) => t + H.num(H.val('hrs-' + x.key)), 0);
          document.getElementById('hrs-gross').textContent = '₹ ' + H.inr0(g);
          document.getElementById('hrs-ded').textContent = '₹ ' + H.inr0(d);
          document.getElementById('hrs-net').textContent = '₹ ' + H.inr0(g - d);
        };
        [...E, ...D].forEach((x) => document.getElementById('hrs-' + x.key)?.addEventListener('input', recalc));
        recalc();
        document.getElementById('hrs-suggest')?.addEventListener('click', async () => {
          try {
            const gross = E.reduce((t, x) => t + H.num(H.val('hrs-' + x.key)), 0);
            const s = await H.api(`/api/hr/statutory-suggest?basic=${H.num(H.val('hrs-basic'))}&gross=${gross}&branch=${encodeURIComponent(_profile.employee.branch || '')}`);
            ['pf', 'esic', 'pt'].forEach((k) => { const el = document.getElementById('hrs-' + k); if (el) el.value = s[k]; });
            recalc();
            H.toast('Statutory figures suggested — edit them if your practice differs');
          } catch (e) { H.fail(e); }
        });
      },
      onConfirm: async () => {
        const payload = { employeeId: _profile.employee.id, effective_from: H.val('hrs-effective_from'), remarks: H.val('hrs-remarks') };
        if (!payload.effective_from) { H.toast('Effective from date is required', 'error'); throw new Error('validation'); }
        [...E, ...D].forEach((x) => { payload[x.key] = H.num(H.val('hrs-' + x.key)); });
        await H.post('/api/hr/salary-structure', payload);
        H.closeModal('hrs-form');
        H.toast('Salary revision saved');
        await refreshProfile();
      },
    });
  }

  function openDocForm() {
    const body = H.grid(`
      ${H.select('hrd-doc_type', 'Document Type', 'Other',
        ['Aadhar Card', 'PAN Card', 'Offer Letter', 'Appointment Letter', 'Relieving Letter', 'Education Certificate',
         'Experience Certificate', 'Bank Proof', 'Address Proof', 'Contract', 'Other'])}
      ${H.field('hrd-doc_no', 'Document Number', '')}
      ${H.field('hrd-url', 'Link', '', { span: 2, placeholder: 'https://drive.google.com/…' })}
      ${H.field('hrd-issued_on', 'Issued On', '', { type: 'date' })}
      ${H.field('hrd-expires_on', 'Expires On', '', { type: 'date' })}
      ${H.field('hrd-remarks', 'Remarks', '', { span: 2 })}
    `);
    H.openModal({
      id: 'hrd-form', title: 'Add Document', subtitle: _profile.employee.name, width: 520, bodyHTML: body,
      onConfirm: async () => {
        await H.post('/api/hr/documents', {
          employeeId: _profile.employee.id,
          doc_type: H.val('hrd-doc_type'), doc_no: H.val('hrd-doc_no'), url: H.val('hrd-url'),
          issued_on: H.val('hrd-issued_on'), expires_on: H.val('hrd-expires_on'), remarks: H.val('hrd-remarks'),
        });
        H.closeModal('hrd-form');
        H.toast('Document added');
        await refreshProfile();
      },
    });
  }

  function openOnbForm() {
    const body = H.grid(`
      ${H.field('hro-item', 'Checklist Item', '', { required: true, span: 2 })}
      ${H.field('hro-due_date', 'Due Date', '', { type: 'date' })}
      ${H.field('hro-owner', 'Owner', '')}
    `);
    H.openModal({
      id: 'hro-form', title: 'Add Checklist Item', subtitle: _profile.employee.name, width: 480, bodyHTML: body,
      onConfirm: async () => {
        if (!H.val('hro-item').trim()) { H.toast('Item is required', 'error'); throw new Error('validation'); }
        await H.post('/api/hr/onboarding', {
          employeeId: _profile.employee.id, item: H.val('hro-item'),
          due_date: H.val('hro-due_date'), owner: H.val('hro-owner'),
        });
        H.closeModal('hro-form');
        await refreshProfile();
      },
    });
  }

  function openExitForm() {
    const x = _profile.exit || {};
    const body = H.grid(`
      ${H.select('hrx-exit_type', 'Exit Type', x.exit_type || 'Resignation',
        ['Resignation', 'Retirement', 'Termination', 'End of Contract', 'Absconding', 'Death'])}
      ${H.field('hrx-notice_days', 'Notice Period (days)', x.notice_days || 30, { type: 'number' })}
      ${H.field('hrx-resign_date', 'Resignation Date', x.resign_date || '', { type: 'date' })}
      ${H.field('hrx-last_working_day', 'Last Working Day', x.last_working_day || '', { type: 'date', required: true,
        hint: 'The employee is marked Inactive from this date' })}
      ${H.select('hrx-notice_served', 'Notice Served', x.notice_served ? 'Yes' : 'No', ['Yes', 'No'])}
      ${H.select('hrx-fnf_status', 'Settlement Status', x.fnf_status || 'pending', ['pending', 'processing', 'paid'])}
      ${H.field('hrx-fnf_amount', 'Full & Final Amount', x.fnf_amount || 0, { type: 'number', step: '0.01' })}
      ${H.field('hrx-fnf_paid_on', 'Paid On', x.fnf_paid_on || '', { type: 'date' })}
      ${H.textarea('hrx-reason', 'Reason', x.reason || '', { rows: 2 })}
      ${H.textarea('hrx-remarks', 'Remarks', x.remarks || '', { rows: 2 })}
    `);
    H.openModal({
      id: 'hrx-form', title: 'Exit & Full and Final', subtitle: _profile.employee.name, width: 600, bodyHTML: body,
      confirmText: 'Save Exit Record',
      onConfirm: async () => {
        if (!H.val('hrx-last_working_day')) { H.toast('Last working day is required', 'error'); throw new Error('validation'); }
        await H.post('/api/hr/exits', {
          employeeId: _profile.employee.id,
          exit_type: H.val('hrx-exit_type'), notice_days: H.num(H.val('hrx-notice_days')),
          notice_served: H.val('hrx-notice_served') === 'Yes',
          resign_date: H.val('hrx-resign_date'), last_working_day: H.val('hrx-last_working_day'),
          fnf_status: H.val('hrx-fnf_status'), fnf_amount: H.num(H.val('hrx-fnf_amount')),
          fnf_paid_on: H.val('hrx-fnf_paid_on'), reason: H.val('hrx-reason'), remarks: H.val('hrx-remarks'),
        });
        H.closeModal('hrx-form');
        H.toast('Exit recorded');
        await refreshProfile();
        await load();
      },
    });
  }

  /* ── Login linking & the one-time sheet import ────────────────────── */

  async function linkLogins() {
    try {
      const r = await H.post('/api/hr/link-users', {});
      const msg = r.linked
        ? `Linked ${r.linked} employee${r.linked === 1 ? '' : 's'} to their login.`
        : 'Every employee that has a matching login is already linked.';
      const tail = r.unmatched?.length
        ? `\n\nNo login found for ${r.unmatched.length}: ${r.unmatched.slice(0, 12).join(', ')}${r.unmatched.length > 12 ? '…' : ''}`
        : '';
      await Utils.showConfirm(msg + tail, { title: 'Link Logins', confirmText: 'Done', cancelText: 'Close' });
      await load();
      render();
    } catch (e) { H.fail(e); }
  }

  // Owner-only, and phrased as such: it reads the old HRMS spreadsheet and
  // upserts on the ids already in it, so it is safe to re-run but is still a
  // bulk write nobody should trigger by accident.
  function openImport() {
    if (!H.isOwner()) {
      H.toast('Only the owner account can import from the HRMS sheet', 'error');
      return;
    }
    const body = `
      <div style="font-size:13px;color:#475569;line-height:1.6;">
        Reads the old <b>HRMS (Final)</b> spreadsheet and brings across employees, directors, salary
        structures, leave balances, leave requests, attendance, the holiday calendar and past payslips.
        <div style="margin-top:11px;padding:11px 13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;font-size:12.5px;">
          Every row is matched on the id the sheet already carries (MUM014, SAL-2026-04-009, HOL001),
          so running this twice changes nothing and running it later only brings across what is new.
        </div>
        <div style="margin-top:13px;">
          ${H.field('hri-sheet', 'Spreadsheet ID', '', { placeholder: 'Leave blank to use the configured sheet' })}
        </div>
        <div id="hri-result" style="margin-top:13px;"></div>
      </div>`;
    H.openModal({
      id: 'hri-form', title: 'Import from HRMS Sheet', subtitle: 'Safe to re-run — every row is matched on its existing id',
      width: 560, bodyHTML: body, confirmText: 'Preview',
      onOpen: () => {
        const btn = document.getElementById('hri-form-ok');
        let previewed = false;
        btn?.addEventListener('click', async () => {
          const out = document.getElementById('hri-result');
          try {
            const r = await H.post('/api/hr/import-sheet', {
              sheetId: H.val('hri-sheet') || undefined,
              dryRun: !previewed,
            });
            const c = r.counts;
            const lines = Object.entries(c).filter(([k]) => k !== 'skipped')
              .map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12.5px;">
                 <span style="color:#64748b;text-transform:capitalize;">${H.esc(k)}</span><b>${v}</b></div>`).join('');
            out.innerHTML = `<div style="background:${previewed ? '#f0fdf4' : '#eff6ff'};border:1px solid ${previewed ? '#86efac' : '#bfdbfe'};
                 border-radius:9px;padding:12px 14px;">
                 <div style="font-size:12.5px;font-weight:700;color:${previewed ? '#15803d' : '#1d4ed8'};margin-bottom:6px;">
                   ${previewed ? 'Imported' : 'Preview — nothing has been written yet'}</div>${lines}</div>`;
            if (!previewed) {
              previewed = true;
              btn.disabled = false;
              btn.textContent = 'Import for real';
            } else {
              btn.disabled = true;
              btn.textContent = 'Imported';
              H.toast('Import complete');
              await load();
              render();
            }
          } catch (e) {
            out.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:9px;padding:12px 14px;
                 font-size:12.5px;color:#b91c1c;">${H.esc(e.message)}</div>`;
            btn.disabled = false;
            btn.textContent = previewed ? 'Import for real' : 'Preview';
          }
        });
      },
    });
  }

  return {
    async render() {
      const el = document.getElementById('main-content');
      if (el) el.innerHTML = H.spinner('Loading employees…');
      try { await load(); render(); }
      catch (e) { if (el) el.innerHTML = H.empty('Could not load employees', e.message); }
    },
  };
})();
