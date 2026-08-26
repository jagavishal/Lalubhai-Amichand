'use strict';
/* =====================================================================
   HRMS — Human Resource Management System
   ---------------------------------------------------------------------
   The company already ran an HRMS as a Google Apps Script bolted onto one
   spreadsheet ("HRMS (Final)"): EmployeeDetails, Salary, Leave, Attendance,
   HolidayList, OrganizationChart and friends. This module is that system
   rebuilt inside the ERP, keeping the shapes people already know — the same
   MUM001 employee codes, the same SAL-YYYY-MM-NNN salary ids, the same
   earning and deduction heads, the same PL/CL/SL/EL leave types — so anyone
   moving off the sheet recognises every screen.

   It stays a self-contained CommonJS module rather than another few thousand
   lines inside server.js: the host passes in its own pool and guards (see
   mountHrms), so there is exactly one database connection and one auth model
   in the app. SQL is written Postgres-style ($1, ON CONFLICT) like the rest of
   server.js — the host's pgToMysql() translates it for the live MariaDB.
   ===================================================================== */

/* ── Schema ─────────────────────────────────────────────────────────────
   Spread into server.js's SCHEMA array, so it is created and migrated by the
   same idempotent bootstrap as every other table. Employee codes are the
   primary key everywhere — they are what the sheet, the payslips and the
   staff themselves already use, so an import can run twice without inventing
   a second identity for anybody. ──────────────────────────────────────── */
const HR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hr_employees (
     id VARCHAR(16) PRIMARY KEY,
     user_id VARCHAR(16) DEFAULT NULL,
     name VARCHAR(255) NOT NULL,
     email VARCHAR(255) DEFAULT '',
     phone VARCHAR(64) DEFAULT '',
     designation VARCHAR(128) DEFAULT '',
     department VARCHAR(128) DEFAULT '',
     branch VARCHAR(64) DEFAULT '',
     doj DATE DEFAULT NULL,
     dol DATE DEFAULT NULL,
     status VARCHAR(32) NOT NULL DEFAULT 'Active',
     emp_type VARCHAR(32) NOT NULL DEFAULT 'Staff',
     address TEXT DEFAULT NULL,
     blood_group VARCHAR(8) DEFAULT '',
     gender VARCHAR(16) DEFAULT '',
     dob DATE DEFAULT NULL,
     marital_status VARCHAR(32) DEFAULT '',
     experience VARCHAR(64) DEFAULT '',
     qualification VARCHAR(255) DEFAULT '',
     reporting_to VARCHAR(255) DEFAULT '',
     emergency_name VARCHAR(255) DEFAULT '',
     emergency_phone VARCHAR(64) DEFAULT '',
     uan VARCHAR(32) DEFAULT '',
     aadhar_no VARCHAR(32) DEFAULT '',
     aadhar_url TEXT DEFAULT NULL,
     pan_no VARCHAR(32) DEFAULT '',
     pan_url TEXT DEFAULT NULL,
     bank_name VARCHAR(255) DEFAULT '',
     account_no VARCHAR(64) DEFAULT '',
     ifsc VARCHAR(32) DEFAULT '',
     avatar_url TEXT DEFAULT NULL,
     notes TEXT DEFAULT NULL,
     probation_months INT NOT NULL DEFAULT 0,
     confirmed_on DATE DEFAULT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_hremp_status ON hr_employees (status)`,
  `CREATE INDEX idx_hremp_branch ON hr_employees (branch)`,
  `CREATE INDEX idx_hremp_dept ON hr_employees (department)`,
  `CREATE INDEX idx_hremp_user ON hr_employees (user_id)`,

  /* Effective-dated, never edited in place: an increment writes a new row so
     "Joining Salary / Current Salary / Last Increment" — three columns the
     sheet had to maintain by hand — all fall out of the same history. A
     payslip reads the row in force on the last day of its month. */
  `CREATE TABLE IF NOT EXISTS hr_salary_structure (
     id VARCHAR(24) PRIMARY KEY,
     employee_id VARCHAR(16) NOT NULL,
     effective_from DATE NOT NULL,
     basic DECIMAL(12,2) NOT NULL DEFAULT 0,
     hra DECIMAL(12,2) NOT NULL DEFAULT 0,
     education_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     conveyance_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     telephone_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     medical_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     special_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
     arrears DECIMAL(12,2) NOT NULL DEFAULT 0,
     pt DECIMAL(12,2) NOT NULL DEFAULT 0,
     loan DECIMAL(12,2) NOT NULL DEFAULT 0,
     pf DECIMAL(12,2) NOT NULL DEFAULT 0,
     esic DECIMAL(12,2) NOT NULL DEFAULT 0,
     tds DECIMAL(12,2) NOT NULL DEFAULT 0,
     remarks VARCHAR(255) DEFAULT '',
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_hrsal_emp ON hr_salary_structure (employee_id, effective_from)`,

  `CREATE TABLE IF NOT EXISTS hr_leave_types (
     code VARCHAR(8) PRIMARY KEY,
     name VARCHAR(64) NOT NULL,
     annual_quota DECIMAL(6,2) NOT NULL DEFAULT 0,
     paid SMALLINT NOT NULL DEFAULT 1,
     carry_forward SMALLINT NOT NULL DEFAULT 0,
     max_carry DECIMAL(6,2) NOT NULL DEFAULT 0,
     sort_order INT NOT NULL DEFAULT 0
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  /* One row per employee / year / type. `used` is maintained by the approval
     path rather than recomputed on read, so a balance stays correct even when
     an old leave is edited or a year is closed. */
  `CREATE TABLE IF NOT EXISTS hr_leave_balances (
     employee_id VARCHAR(16) NOT NULL,
     year INT NOT NULL,
     type_code VARCHAR(8) NOT NULL,
     opening DECIMAL(6,2) NOT NULL DEFAULT 0,
     accrued DECIMAL(6,2) NOT NULL DEFAULT 0,
     used DECIMAL(6,2) NOT NULL DEFAULT 0,
     PRIMARY KEY (employee_id, year, type_code)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS hr_attendance (
     id VARCHAR(24) PRIMARY KEY,
     employee_id VARCHAR(16) NOT NULL,
     att_date DATE NOT NULL,
     check_in DATETIME DEFAULT NULL,
     check_out DATETIME DEFAULT NULL,
     in_lat VARCHAR(32) DEFAULT '',
     in_lon VARCHAR(32) DEFAULT '',
     out_lat VARCHAR(32) DEFAULT '',
     out_lon VARCHAR(32) DEFAULT '',
     device VARCHAR(255) DEFAULT '',
     working_hours DECIMAL(5,2) NOT NULL DEFAULT 0,
     late_mark SMALLINT NOT NULL DEFAULT 0,
     status VARCHAR(24) NOT NULL DEFAULT 'Present',
     notes VARCHAR(255) DEFAULT '',
     marked_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_hr_att (employee_id, att_date)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_hratt_date ON hr_attendance (att_date)`,

  `CREATE TABLE IF NOT EXISTS hr_payroll_runs (
     id VARCHAR(24) PRIMARY KEY,
     month INT NOT NULL,
     year INT NOT NULL,
     status VARCHAR(16) NOT NULL DEFAULT 'draft',
     generated_by VARCHAR(255) DEFAULT '',
     generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     finalised_at DATETIME DEFAULT NULL,
     notes VARCHAR(255) DEFAULT '',
     UNIQUE KEY uq_hr_run (year, month)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  /* Every figure is frozen onto the payslip at generation time. A payslip must
     read the same a year later even after the employee's structure changes,
     so nothing here is a join to hr_salary_structure. */
  `CREATE TABLE IF NOT EXISTS hr_payslips (
     id VARCHAR(24) PRIMARY KEY,
     run_id VARCHAR(24) NOT NULL,
     employee_id VARCHAR(16) NOT NULL,
     employee_name VARCHAR(255) NOT NULL DEFAULT '',
     designation VARCHAR(128) DEFAULT '',
     department VARCHAR(128) DEFAULT '',
     branch VARCHAR(64) DEFAULT '',
     month INT NOT NULL,
     year INT NOT NULL,
     basic DECIMAL(12,2) NOT NULL DEFAULT 0,
     hra DECIMAL(12,2) NOT NULL DEFAULT 0,
     education_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     conveyance_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     telephone_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     medical_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     special_allow DECIMAL(12,2) NOT NULL DEFAULT 0,
     bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
     arrears DECIMAL(12,2) NOT NULL DEFAULT 0,
     total_gross DECIMAL(12,2) NOT NULL DEFAULT 0,
     pt DECIMAL(12,2) NOT NULL DEFAULT 0,
     loan DECIMAL(12,2) NOT NULL DEFAULT 0,
     pf DECIMAL(12,2) NOT NULL DEFAULT 0,
     esic DECIMAL(12,2) NOT NULL DEFAULT 0,
     tds DECIMAL(12,2) NOT NULL DEFAULT 0,
     total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
     month_days INT NOT NULL DEFAULT 30,
     present_days DECIMAL(5,2) NOT NULL DEFAULT 0,
     leave_days DECIMAL(5,2) NOT NULL DEFAULT 0,
     lop_days DECIMAL(5,2) NOT NULL DEFAULT 0,
     paid_days DECIMAL(5,2) NOT NULL DEFAULT 0,
     leave_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
     net_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
     bank_name VARCHAR(255) DEFAULT '',
     account_no VARCHAR(64) DEFAULT '',
     note VARCHAR(255) DEFAULT '',
     generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_hr_slip (run_id, employee_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_hrslip_emp ON hr_payslips (employee_id, year, month)`,

  `CREATE TABLE IF NOT EXISTS hr_onboarding (
     id VARCHAR(24) PRIMARY KEY,
     employee_id VARCHAR(16) NOT NULL,
     item VARCHAR(255) NOT NULL,
     status VARCHAR(24) NOT NULL DEFAULT 'pending',
     due_date DATE DEFAULT NULL,
     done_on DATE DEFAULT NULL,
     owner VARCHAR(255) DEFAULT '',
     remarks VARCHAR(255) DEFAULT '',
     sort_order INT NOT NULL DEFAULT 0,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_hronb_emp ON hr_onboarding (employee_id)`,

  `CREATE TABLE IF NOT EXISTS hr_exits (
     id VARCHAR(24) PRIMARY KEY,
     employee_id VARCHAR(16) NOT NULL,
     resign_date DATE DEFAULT NULL,
     last_working_day DATE DEFAULT NULL,
     exit_type VARCHAR(32) DEFAULT 'Resignation',
     reason TEXT DEFAULT NULL,
     notice_days INT NOT NULL DEFAULT 0,
     notice_served SMALLINT NOT NULL DEFAULT 1,
     clearance TEXT DEFAULT NULL,
     fnf_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
     fnf_status VARCHAR(24) NOT NULL DEFAULT 'pending',
     fnf_paid_on DATE DEFAULT NULL,
     remarks TEXT DEFAULT NULL,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_hr_exit (employee_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS hr_documents (
     id VARCHAR(24) PRIMARY KEY,
     employee_id VARCHAR(16) NOT NULL,
     doc_type VARCHAR(64) NOT NULL DEFAULT 'Other',
     doc_no VARCHAR(128) DEFAULT '',
     url TEXT DEFAULT NULL,
     issued_on DATE DEFAULT NULL,
     expires_on DATE DEFAULT NULL,
     remarks VARCHAR(255) DEFAULT '',
     uploaded_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_hrdoc_emp ON hr_documents (employee_id)`,

  /* reporting_to was sized for an employee code (MUM014) but is also allowed to
     hold a manager's plain name — which VARCHAR(16) silently cut in half, so
     "MAHENDRA CHANDULAL SHAH" was stored as "MAHENDRA CHANDUL" and matched
     nobody. Widened to hold a name. Both dialects are attempted; the one that
     does not apply is logged and stepped over. */
  `ALTER TABLE hr_employees MODIFY reporting_to VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE hr_employees ALTER COLUMN reporting_to TYPE VARCHAR(255)`,

  /* The Leave Tracker predates the HRMS and its rows must keep working, so the
     leave request table is extended rather than replaced: `type` stays whatever
     the old page wrote, `leave_type` carries the HRMS's PL/CL/SL/EL/LWP. */
  /* Policy documents — the code of conduct, the leave rules, POSH. Stored as
     rows rather than files so they open on a phone, are searchable, and an
     Admin can correct a line without a round-trip through a PDF. */
  `CREATE TABLE IF NOT EXISTS hr_policies (
     id VARCHAR(32) PRIMARY KEY,
     title VARCHAR(255) NOT NULL,
     body TEXT,
     sort_order INT NOT NULL DEFAULT 0,
     updated_by VARCHAR(255) DEFAULT '',
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS employee_id VARCHAR(16) DEFAULT NULL`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS leave_type VARCHAR(8) DEFAULT 'CL'`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS half_day VARCHAR(16) DEFAULT 'full'`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS total_days DECIMAL(6,2) DEFAULT 0`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approver_email VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approver_name VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approver_comments TEXT DEFAULT NULL`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS balance_after DECIMAL(6,2) DEFAULT NULL`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS decided_by VARCHAR(255) DEFAULT ''`,
  // Who covers the work while they are away — picked on the Apply form, shown
  // wherever "on leave today" is shown, so nobody has to ask around.
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS backup_name VARCHAR(255) DEFAULT ''`,
  /* Two-signature approvals (Accounts, 3+ days: Jayesh AND Paresh). The row
     goes to approver_* first; next_approver_* is who it moves on to when the
     first approval lands, and level1_by records who gave that first one.
     approver_mailto is the exact mailbox the request mail was sent to — the
     email Approve/Reject buttons act only when their token names it, so a
     level-1 link cannot finalise what still needs the level-2 signature. */
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS next_approver_name VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS next_approver_email VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS level1_by VARCHAR(255) DEFAULT ''`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approver_mailto VARCHAR(255) DEFAULT ''`,
  `CREATE INDEX idx_leaves_emp ON leaves (employee_id)`,

  /* The holiday calendar gains the three things the sheet's HolidayList had
     and this table did not: which site it applies to, who it covers, and a note. */
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS branch VARCHAR(64) DEFAULT 'All'`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS applies_to VARCHAR(128) DEFAULT 'All'`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS notes VARCHAR(255) DEFAULT ''`,
];

/* ── Small shared helpers ───────────────────────────────────────────── */

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// Earning and deduction heads, in the order the sheet's Salary tab printed
// them. Everything downstream — the structure form, the payroll engine, the
// payslip, the salary register — is driven off these two lists, so adding a
// head later is one line here plus one column in the two tables.
const EARNINGS = [
  { key: 'basic',            label: 'Basic' },
  { key: 'hra',              label: 'HRA' },
  { key: 'education_allow',  label: 'Education Allowance' },
  { key: 'conveyance_allow', label: 'Conveyance Allowance' },
  { key: 'telephone_allow',  label: 'Telephone Allowance' },
  { key: 'medical_allow',    label: 'Medical Allowance' },
  { key: 'special_allow',    label: 'Special Allowance' },
  { key: 'bonus',            label: 'Bonus' },
  { key: 'arrears',          label: 'Arrears' },
];
const DEDUCTIONS = [
  { key: 'pt',   label: 'Professional Tax' },
  { key: 'loan',  label: 'Loan Deduction' },
  { key: 'pf',    label: 'PF' },
  { key: 'esic',  label: 'ESIC' },
  { key: 'tds',   label: 'TDS' },
];

/* The statuses a day can carry. Only Absent and Half Day cost pay here —
   unpaid leave costs pay through the leave record instead, so that a leave
   approved after the muster was marked still lands correctly (see the LOP
   set in computeMonth). Colours are shared with the muster roll grid. */
const ATT_STATUS = {
  'Present':  { label: 'Present',  short: 'P',  bg: '#dcfce7', fg: '#166534' },
  'Remote':   { label: 'Remote',   short: 'R',  bg: '#e0f2fe', fg: '#075985' },
  'Half Day': { label: 'Half Day', short: 'H',  bg: '#fef3c7', fg: '#92400e' },
  'Leave':    { label: 'On Leave', short: 'L',  bg: '#ede9fe', fg: '#5b21b6' },
  'Holiday':  { label: 'Holiday',  short: 'HO', bg: '#f1f5f9', fg: '#64748b' },
  'Week Off': { label: 'Week Off', short: 'WO', bg: '#f8fafc', fg: '#94a3b8' },
  'Absent':   { label: 'Absent',   short: 'A',  bg: '#fee2e2', fg: '#991b1b' },
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => Math.round(num(v) * 100) / 100;
const pad = (n, w) => String(n).padStart(w, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Dates land here from three places that each spell them differently: a
// <input type="date"> (ISO), MySQL (a Date object), and the old sheet
// (dd/mm/yyyy or m/d/yyyy). Everything is normalised to ISO yyyy-mm-dd on the
// way in so a comparison is always a string comparison.
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${pad(v.getMonth() + 1, 2)}-${pad(v.getDate(), 2)}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2], 2)}-${pad(m[1], 2)}`;   // dd/mm/yyyy
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : isoDate(d);
}

// The sheet is not consistent: EmployeeDetails writes dd/mm/yyyy while Leave
// and Attendance write m/d/yyyy. The importer says which it is reading.
function sheetDate(v, order = 'dmy') {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === '#N/A') return null;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    const [dd, mm] = order === 'mdy' ? [b, a] : [a, b];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${m[3]}-${pad(mm, 2)}-${pad(dd, 2)}`;
  }
  return isoDate(s);
}

function sheetDateTime(v, order = 'mdy') {
  if (!v) return null;
  const s = String(v).trim();
  const day = sheetDate(s, order);
  if (!day) return null;
  const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return t ? `${day} ${pad(t[1], 2)}:${t[2]}:${t[3] || '00'}` : `${day} 00:00:00`;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Inclusive list of dates between two ISO days, capped so a typo in an end
// date can never spin a request for years.
function dateRange(fromIso, toIso, cap = 400) {
  const out = [];
  if (!fromIso || !toIso || toIso < fromIso) return out;
  let cur = fromIso;
  while (cur <= toIso && out.length < cap) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inr = (n) => num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Used where a query must be scoped to one person and there is nobody to
   scope it to — an account with no employee record behind it. Binding this
   instead of an empty string keeps the query shape identical and returns
   nothing, rather than quietly widening to every row. */
const NO_MATCH = '-no-such-employee';

/* Rupees in words, the way a payslip prints them. Indian grouping, so
   1,25,000 reads "One Lakh Twenty Five Thousand". */
function rupeesInWords(amount) {
  const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve',
    'Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two = (n) => n < 20 ? ONES[n] : (TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
  const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  let rupees = Math.floor(Math.abs(num(amount)));
  const paise = Math.round((Math.abs(num(amount)) - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Only';
  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh  = Math.floor(rupees / 100000);   rupees %= 100000;
  const thou  = Math.floor(rupees / 1000);     rupees %= 1000;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh)  parts.push(three(lakh)  + ' Lakh');
  if (thou)  parts.push(three(thou)  + ' Thousand');
  if (rupees) parts.push(three(rupees));
  let out = parts.join(' ').trim() || 'Zero';
  if (paise) out += ' and ' + two(paise) + ' Paise';
  return out + ' Only';
}

/* ── Statutory suggestions ──────────────────────────────────────────────
   Offered by the salary-structure form as a starting point, never applied
   behind anyone's back: the stored figure is always what HR typed. The
   company's own numbers already deviate (a flat 1800 PF regardless of Basic),
   which is exactly why these stay suggestions. ────────────────────────── */
function suggestStatutory({ basic = 0, gross = 0, branch = '' } = {}) {
  const pf = Math.round(Math.min(num(basic), 15000) * 0.12);        // 12% of Basic, wage ceiling 15,000
  const esic = num(gross) <= 21000 ? Math.ceil(num(gross) * 0.0075) : 0;  // 0.75% employee share
  // Professional Tax — Maharashtra slab (Mumbai). Other states differ, so a
  // non-Maharashtra branch gets 0 rather than a wrong number.
  let pt = 0;
  if (/mumbai|maharashtra/i.test(branch)) {
    const g = num(gross);
    if (g > 10000) pt = 200;            // 300 in February, applied at payroll time
    else if (g > 7500) pt = 175;
  }
  return { pf, esic, pt };
}

/* =====================================================================
   mountHrms(app, ctx)
   ---------------------------------------------------------------------
   ctx carries the host's own database pool and guards, so this module never
   opens a second connection or invents a second idea of who is an Admin:
     { pool, q, requireAuth, requireAdmin, requireSuperAdmin, isAdminUser }
   ===================================================================== */
function mountHrms(app, ctx) {
  const { pool, q, requireAuth, requireAdmin, requireSuperAdmin, isAdminUser } = ctx;
  // Everything the Employee Master page calls. An Admin passes as before; a
  // non-admin passes when Users → Access granted them the page — the grant
  // would be decorative if the sidebar showed the page and every request 403'd.
  const empMaster = ctx.requireEmployeeMaster || requireAdmin;
  // Falls back to the old COUNT(*) scheme only when this module is mounted
  // without server.js (tests), where nothing is ever deleted anyway.
  const withSeqId = ctx.withSeqId || (async (table, prefix, width, run) => {
    const c = await q(`SELECT COUNT(*) AS cnt FROM ${table}`);
    const id = prefix + String(Number(c[0]?.cnt || 0) + 1).padStart(width, '0');
    await run(id);
    return id;
  });
  // Department spelling is owned by server.js (one master list, one casing rule)
  // — the fallbacks keep this module working standalone in tests, where ctx
  // carries only the database handles.
  const canonicalDept = ctx.canonicalDept || (async (d) => String(d == null ? '' : d).trim());
  const listDepartments = ctx.listDepartments || (async () => []);

  /* ── Settings ─────────────────────────────────────────────────────────
     Kept in the app_config table the rest of the app already uses, under an
     hr_ prefix, so there is one settings store and one backup covering it.
     Defaults are the company's own: the sheet's Settings tab recorded a
     09:00–18:00 day and Lallubhai Amichand's registered address. ─────── */
  const HR_DEFAULTS = {
    hr_shift_start: '09:00',
    hr_shift_end: '18:00',
    hr_grace_minutes: '15',
    hr_week_off: '0',                    // comma-separated JS weekdays; 0 = Sunday
    hr_leave_exclude_holidays: 'false',  // the sheet counted plain calendar days
    hr_company_name: 'Lallubhai Amichand Limited',
    hr_company_address: '225/27, Dun Apartments, Javji Dadaji Marg, Talmakiwadi, Tardeo, Mumbai, Maharashtra 400007',
    hr_company_phone: '9653405815',
    hr_pt_february_extra: '100',         // Maharashtra PT is 300 in February, 200 otherwise
    hr_sheet_id: '1jb_mMdzxrH8LRP3bFTCR6MRYnR1fPX3b6uJbOT0_cns',
  };

  async function getSettings() {
    const keys = Object.keys(HR_DEFAULTS);
    const rows = await q(
      `SELECT "key", "value" FROM app_config WHERE "key" IN (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
      keys,
    ).catch(() => []);
    const out = { ...HR_DEFAULTS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async function setSetting(key, value) {
    await pool.query(
      `INSERT INTO app_config ("key", "value") VALUES ($1, $2) ON CONFLICT ("key") DO UPDATE SET "value" = $3`,
      [key, String(value), String(value)],
    );
  }

  /* ── Reference data seeding ───────────────────────────────────────────
     Runs once per process, lazily, so a cold start never blocks on it and a
     fresh database still comes up with the five leave types the company
     actually uses. Quotas are the ones carried on every row of the sheet's
     EmployeeDetails tab (PL 23 / CL 5 / SL 7). ─────────────────────────── */
  const DEFAULT_LEAVE_TYPES = [
    { code: 'PL',  name: 'Privilege Leave', annual_quota: 23, paid: 1, carry_forward: 1, max_carry: 30, sort_order: 1 },
    { code: 'CL',  name: 'Casual Leave',    annual_quota: 5,  paid: 1, carry_forward: 0, max_carry: 0,  sort_order: 2 },
    { code: 'SL',  name: 'Sick Leave',      annual_quota: 7,  paid: 1, carry_forward: 0, max_carry: 0,  sort_order: 3 },
    { code: 'EL',  name: 'Emergency Leave', annual_quota: 0,  paid: 1, carry_forward: 0, max_carry: 0,  sort_order: 4 },
    { code: 'LWP', name: 'Leave Without Pay', annual_quota: 0, paid: 0, carry_forward: 0, max_carry: 0, sort_order: 5 },
  ];

  let _seeded = null;
  function seedReferenceData() {
    if (_seeded) return _seeded;
    _seeded = (async () => {
      for (const t of DEFAULT_LEAVE_TYPES) {
        await pool.query(
          `INSERT INTO hr_leave_types (code, name, annual_quota, paid, carry_forward, max_carry, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`,
          [t.code, t.name, t.annual_quota, t.paid, t.carry_forward, t.max_carry, t.sort_order],
        ).catch(() => {});
      }
      // DO NOTHING on purpose: this text is the starting version, and an
      // Admin's edits from the HR Policies page must survive every deploy.
      const { POLICIES } = require('./hr-policies-seed.js');
      for (const pol of POLICIES) {
        await pool.query(
          `INSERT INTO hr_policies (id, title, body, sort_order) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO NOTHING`,
          [pol.id, pol.title, pol.body, pol.sort_order],
        ).catch(() => {});
      }
    })().catch((e) => { console.error('[hrms] seed failed:', e.message); });
    return _seeded;
  }

  /* Every HR route runs this first: the host's own schema bootstrap (cached
     after its first call, exactly as the rest of server.js relies on) and then
     this module's reference data. Both are no-ops from the second request on. */
  async function hrReady(req, res, next) {
    try {
      if (ctx.ensureSchema) await ctx.ensureSchema();
      await seedReferenceData();
    } catch (e) {
      console.error('[hrms] bootstrap failed:', e.message);
    }
    next();
  }

  /* ── Id generation ────────────────────────────────────────────────────
     Ids are read by people (MUM014 is said out loud in the office), so they
     are the sequence-with-prefix the sheet used rather than a random string.
     MAX(suffix)+1 rather than COUNT+1: a deleted row must never hand its
     number to somebody new. ──────────────────────────────────────────── */
  async function nextCode(table, column, prefix, width) {
    const rows = await q(
      `SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE $1 ORDER BY ${column} DESC LIMIT 200`,
      [prefix + '%'],
    ).catch(() => []);
    let max = 0;
    for (const r of rows) {
      const n = parseInt(String(r.code).slice(prefix.length).replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return prefix + pad(max + 1, width);
  }

  const BRANCH_PREFIX = { mumbai: 'MUM', ahmedabad: 'AHM', ahemdabad: 'AHM', rajkot: 'RAJ' };
  function branchPrefix(branch) {
    const key = String(branch || '').trim().toLowerCase();
    if (BRANCH_PREFIX[key]) return BRANCH_PREFIX[key];
    const letters = key.replace(/[^a-z]/g, '').toUpperCase();
    return (letters.slice(0, 3) || 'EMP');
  }

  // A short unique key for rows nobody quotes by number (attendance, documents).
  let _seq = 0;
  function rowId(prefix) {
    _seq = (_seq + 1) % 1000;
    return prefix + Date.now().toString(36).toUpperCase() + pad(_seq, 3);
  }

  /* ── Employee helpers ─────────────────────────────────────────────── */

  const EMP_FIELDS = [
    'user_id', 'name', 'email', 'phone', 'designation', 'department', 'branch',
    'doj', 'dol', 'status', 'emp_type', 'address', 'blood_group', 'gender', 'dob',
    'marital_status', 'experience', 'qualification', 'reporting_to',
    'emergency_name', 'emergency_phone', 'uan', 'aadhar_no', 'aadhar_url',
    'pan_no', 'pan_url', 'bank_name', 'account_no', 'ifsc', 'avatar_url', 'notes',
    'probation_months', 'confirmed_on',
  ];
  const EMP_DATE_FIELDS = new Set(['doj', 'dol', 'dob', 'confirmed_on']);

  function shapeEmployee(r) {
    if (!r) return null;
    return {
      ...r,
      doj: isoDate(r.doj), dol: isoDate(r.dol), dob: isoDate(r.dob),
      confirmed_on: isoDate(r.confirmed_on),
    };
  }

  // The salary structure in force on a given day — the most recent row whose
  // effective_from has already arrived. Returns null when an employee has
  // never had one, which payroll reports rather than guessing at.
  async function structureOn(employeeId, onIso) {
    const rows = await q(
      `SELECT * FROM hr_salary_structure
        WHERE employee_id = $1 AND effective_from <= $2
        ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
      [employeeId, onIso],
    );
    return rows[0] || null;
  }

  function grossOf(s) {
    if (!s) return 0;
    return money(EARNINGS.reduce((t, e) => t + num(s[e.key]), 0));
  }
  function deductionsOf(s) {
    if (!s) return 0;
    return money(DEDUCTIONS.reduce((t, d) => t + num(s[d.key]), 0));
  }

  /* ── Leave balance helpers ────────────────────────────────────────── */

  async function leaveTypes() {
    const rows = await q(`SELECT * FROM hr_leave_types ORDER BY sort_order ASC, code ASC`);
    return rows.length ? rows : DEFAULT_LEAVE_TYPES;
  }

  // Reads a balance row, creating it from the leave type's annual quota the
  // first time an employee touches that type in a year. Without this an
  // employee added mid-year would show every balance as zero.
  async function ensureBalance(employeeId, year, code) {
    const rows = await q(
      `SELECT * FROM hr_leave_balances WHERE employee_id = $1 AND year = $2 AND type_code = $3`,
      [employeeId, year, code],
    );
    if (rows[0]) return rows[0];
    const types = await leaveTypes();
    const t = types.find((x) => x.code === code);
    const accrued = num(t?.annual_quota);
    await pool.query(
      `INSERT INTO hr_leave_balances (employee_id, year, type_code, opening, accrued, used)
       VALUES ($1,$2,$3,0,$4,0) ON CONFLICT (employee_id, year, type_code) DO NOTHING`,
      [employeeId, year, code, accrued],
    ).catch(() => {});
    return { employee_id: employeeId, year, type_code: code, opening: 0, accrued, used: 0 };
  }

  const balanceOf = (b) => money(num(b.opening) + num(b.accrued) - num(b.used));

  /* The employee record behind a login.
     ---------------------------------------------------------------------
     Matched by the explicit link first, then by email, then by name, so
     punching in and "my payslips" work before HR has mapped anybody — and
     keep working after, on the mapping rather than a guess. Every route that
     scopes to "me" goes through this one function; there used to be two
     near-identical copies, which is how the three self-service screens end
     up disagreeing about who you are. */
  async function selfEmployee(user) {
    if (!user) return null;
    const rows = await q(
      `SELECT * FROM hr_employees
        WHERE user_id = $1 OR (email <> '' AND LOWER(email) = LOWER($2)) OR LOWER(name) = LOWER($3)
        ORDER BY CASE WHEN user_id = $4 THEN 0 ELSE 1 END LIMIT 1`,
      [user.id || '', user.email || '', user.name || '', user.id || ''],
    ).catch(() => []);
    return rows[0] || null;
  }

  async function bumpUsed(employeeId, year, code, delta) {
    if (!employeeId || !code || !delta) return;
    await ensureBalance(employeeId, year, code);
    await pool.query(
      `UPDATE hr_leave_balances SET used = GREATEST(0, used + $1)
        WHERE employee_id = $2 AND year = $3 AND type_code = $4`,
      [delta, employeeId, year, code],
    ).catch(() => {});
  }

  /* Working days a leave actually costs. The sheet counted plain calendar
     days (a 1–10 April leave was 10 days even though two Sundays fell in it),
     so that is the default; turning on hr_leave_exclude_holidays switches to
     the fairer count that skips week-offs and the holiday calendar. */
  async function leaveDayCount(fromIso, toIso, halfDay, branch) {
    if (String(halfDay || 'full') !== 'full') return 0.5;
    const days = dateRange(fromIso, toIso);
    if (!days.length) return 0;
    const s = await getSettings();
    if (s.hr_leave_exclude_holidays !== 'true') return days.length;
    const offs = new Set(String(s.hr_week_off || '').split(',').map((x) => x.trim()).filter(Boolean));
    const hol = await q(
      `SELECT date FROM holidays WHERE date BETWEEN $1 AND $2 AND (branch = 'All' OR branch = $3 OR branch IS NULL)`,
      [fromIso, toIso, branch || 'All'],
    ).catch(() => []);
    const holSet = new Set(hol.map((h) => isoDate(h.date)));
    return days.filter((d) => {
      if (holSet.has(d)) return false;
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      return !offs.has(String(dow));
    }).length;
  }

  /* The one place a leave decision moves a balance.
     ---------------------------------------------------------------------
     The older Leave Tracker page has its own PATCH /api/leaves route and
     predates balances entirely. If it kept deciding requests on its own,
     a leave approved there would never be deducted and the two screens
     would quietly disagree about how much leave somebody has left. So
     that route calls this instead of doing its own arithmetic — see the
     mountHrms(...) call in server.js.

     Approving books the days; moving away from Approved hands them back.
     Both directions are needed: a mistaken approval is reversed far more
     often than anybody expects. */
  async function applyLeaveDecision(leaveId, status, decidedBy) {
    const lv = (await q(`SELECT * FROM leaves WHERE id = $1`, [leaveId]))[0];
    if (!lv) return null;
    const code = lv.leave_type || 'CL';
    const year = Number(String(isoDate(lv.from_date) || '').slice(0, 4)) || new Date().getFullYear();
    const days = num(lv.total_days);
    const wasApproved = /^approved$/i.test(String(lv.status || ''));
    const nowApproved = /^approved$/i.test(String(status || ''));
    let balanceAfter = null;

    if (lv.employee_id && code !== 'LWP' && days) {
      if (!wasApproved && nowApproved) await bumpUsed(lv.employee_id, year, code, days);
      if (wasApproved && !nowApproved) await bumpUsed(lv.employee_id, year, code, -days);
      balanceAfter = balanceOf(await ensureBalance(lv.employee_id, year, code));
    }
    await pool.query(
      `UPDATE leaves SET status = $1, decided_at = NOW(), decided_by = $2, balance_after = $3 WHERE id = $4`,
      [status, decidedBy || '', balanceAfter, leaveId],
    );

    /* Tell the applicant what was decided. Fire-and-forget for the same reason
       as the request mail: the decision is already recorded, and a slow or
       unreachable SMTP server must not hold up the person clicking Approve.
       It lives here rather than in the route so that a decision made from the
       older Leave Tracker page sends the same mail. */
    if (ctx.sendLeaveDecisionEmail) {
      (async () => {
        const applicant = lv.user_id
          ? (await q(`SELECT id, name, email FROM users WHERE id = $1`, [lv.user_id]).catch(() => []))[0]
          : (await q(`SELECT id, name, email FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1`, [lv.user_name || ''])
              .catch(() => []))[0];
        const loginEmail = applicant?.email || '';
        const address = ctx.notifyAddressFor
          ? await ctx.notifyAddressFor(applicant?.id, loginEmail)
          : loginEmail;
        await ctx.sendLeaveDecisionEmail({
          toEmail: address,
          toName: applicant?.name || lv.user_name || '',
          status,
          decidedBy: decidedBy || '',
          leaveType: code,
          fromDate: isoDate(lv.from_date),
          toDate: isoDate(lv.to_date) === isoDate(lv.from_date) ? '' : isoDate(lv.to_date),
          days,
          comments: lv.approver_comments || '',
          balanceAfter,
        });
      })().catch((e) => console.error('[hrms] leave decision mail failed:', e.message));
    }

    return { balanceAfter, days, code };
  }

  mountEmployeeRoutes();
  mountAttendanceRoutes();
  mountLeaveRoutes();
  mountPayrollRoutes();
  mountReportRoutes();
  mountAdminRoutes();

  // Handed back to server.js so its own leave route can share the balance
  // logic above rather than growing a second, divergent copy.
  return { applyLeaveDecision, hrReady };

  /* ===================================================================
     Employee master
     =================================================================== */
  function mountEmployeeRoutes() {

    // Everything the HR forms need to render their dropdowns in one trip.
    app.get('/api/hr/masters', requireAuth, hrReady, async (req, res) => {
      try {
        const [emps, types, settings, master] = await Promise.all([
          // user_id rides along so the Users list can show which login each
          // employee record belongs to. Names and departments only — the
          // salary-bearing columns stay behind /api/hr/employees.
          q(`SELECT id, user_id, name, designation, department, branch, status FROM hr_employees ORDER BY name ASC`),
          leaveTypes(),
          getSettings(),
          // The app-wide departments master, so the HR Department dropdown offers
          // the same names as PR/PO/IMS instead of only whatever HR happens to
          // have typed so far.
          listDepartments().catch(() => []),
        ]);
        const uniq = (arr) => [...new Set(arr.filter((x) => x && String(x).trim()))].sort();
        // Case-insensitive dedupe: a department still stored on an old employee row
        // in a different case must not show up as a second option next to the
        // master's spelling — the master's wins.
        const uniqDept = (arr) => {
          const out = [];
          for (const v of arr) {
            const name = String(v == null ? '' : v).trim();
            if (!name) continue;
            if (!out.some((d) => d.toLowerCase() === name.toLowerCase())) out.push(name);
          }
          return out;
        };
        res.json({
          employees: emps,
          leaveTypes: types,
          departments: uniqDept([...master, ...emps.map((e) => e.department).sort()]),
          designations: uniq(emps.map((e) => e.designation)),
          branches: uniq(emps.map((e) => e.branch)).concat(['Mumbai', 'Ahmedabad'])
            .filter((v, i, a) => a.indexOf(v) === i).sort(),
          earnings: EARNINGS,
          deductions: DEDUCTIONS,
          attendanceStatuses: Object.entries(ATT_STATUS).map(([key, v]) => ({ key, ...v })),
          settings,
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* Admin-only, and it has to be: these rows carry bank accounts, PAN,
       Aadhar and salary-bearing detail. The light directory every other HR
       screen needs for its dropdowns is /api/hr/masters, which returns names
       and departments and nothing else. */
    app.get('/api/hr/employees', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const { status, branch, department, q: search } = req.query;
        const where = [];
        const params = [];
        if (status && status !== 'All')         { params.push(status);      where.push(`status = $${params.length}`); }
        if (branch && branch !== 'All')         { params.push(branch);      where.push(`branch = $${params.length}`); }
        if (department && department !== 'All') { params.push(department);  where.push(`department = $${params.length}`); }
        if (search) {
          params.push('%' + search + '%'); const a = params.length;
          params.push('%' + search + '%'); const b = params.length;
          params.push('%' + search + '%'); const c = params.length;
          where.push(`(name LIKE $${a} OR id LIKE $${b} OR designation LIKE $${c})`);
        }
        const rows = await q(
          `SELECT * FROM hr_employees ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ASC`,
          params,
        );
        res.json(rows.map(shapeEmployee));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // The whole 360° view of one person, in one request: the master record,
    // every salary revision, this year's leave balances, their leave history,
    // documents, joining checklist and exit record.
    /* ── My record ────────────────────────────────────────────────────
       Everything the Profile page shows about a person's employment, in one
       call and with no id to pass: the subject is whoever is signed in, so
       this route cannot be pointed at somebody else. Salary appears because
       it is their own — the same figures already printed on their payslips.

       `linked: false` is a normal answer, not an error: an account with no
       employee record behind it is what every new login looks like until HR
       runs Link Logins, and the page says so rather than showing blanks. ── */
    app.get('/api/hr/me', requireAuth, hrReady, async (req, res) => {
      try {
        const user = req.session?.user;
        const e = await selfEmployee(user);
        if (!e) return res.json({ linked: false });

        const now = new Date();
        const year = now.getFullYear();
        const monthStart = `${year}-${pad(now.getMonth() + 1, 2)}-01`;
        const today = isoDate(now);

        const [types, structure, att, slips, docs, team, exits, settings] = await Promise.all([
          leaveTypes(),
          structureOn(e.id, today),
          // The whole month including today, so the strip on the Dashboard can
          // show the punch state without a second round trip.
          q(`SELECT att_date, status, late_mark, working_hours, check_in, check_out FROM hr_attendance
              WHERE employee_id = $1 AND att_date BETWEEN $2 AND $3`, [e.id, monthStart, today]).catch(() => []),
          q(`SELECT p.id, p.month, p.year, p.total_gross, p.total_deductions, p.leave_deduction, p.net_salary
               FROM hr_payslips p JOIN hr_payroll_runs r ON r.id = p.run_id
              WHERE p.employee_id = $1 AND r.status = 'finalised'
              ORDER BY p.year DESC, p.month DESC LIMIT 12`, [e.id]).catch(() => []),
          q(`SELECT id, doc_type, doc_no, url, expires_on FROM hr_documents
              WHERE employee_id = $1 ORDER BY created_at DESC`, [e.id]).catch(() => []),
          // Who reports to this person — the half of the reporting line that
          // is invisible from their own record.
          q(`SELECT id, name, designation FROM hr_employees
              WHERE status = 'Active' AND reporting_to <> '' AND (reporting_to = $1 OR LOWER(reporting_to) = LOWER($2))
              ORDER BY name ASC`, [e.id, e.name]).catch(() => []),
          q(`SELECT * FROM hr_exits WHERE employee_id = $1`, [e.id]).catch(() => []),
          getSettings(),
        ]);

        const balances = [];
        for (const t of types) {
          const b = await ensureBalance(e.id, year, t.code);
          balances.push({
            code: t.code, name: t.name, paid: num(t.paid),
            entitled: money(num(b.opening) + num(b.accrued)),
            used: money(num(b.used)), balance: balanceOf(b),
          });
        }

        const tally = { present: 0, absent: 0, halfDay: 0, remote: 0, leave: 0, late: 0, hours: 0 };
        for (const a of att) {
          if (a.status === 'Present') tally.present += 1;
          else if (a.status === 'Absent') tally.absent += 1;
          else if (a.status === 'Half Day') tally.halfDay += 1;
          else if (a.status === 'Remote') tally.remote += 1;
          else if (a.status === 'Leave') tally.leave += 1;
          if (a.late_mark) tally.late += 1;
          tally.hours += num(a.working_hours);
        }
        tally.hours = money(tally.hours);

        // reporting_to holds a code on records this app created and a plain
        // name on the ones imported from the sheet — resolve either to a name.
        let reportingTo = e.reporting_to || '';
        if (reportingTo) {
          const m = await q(
            `SELECT name FROM hr_employees WHERE id = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
            [reportingTo, reportingTo],
          ).catch(() => []);
          if (m[0]) reportingTo = m[0].name;
        }

        res.json({
          linked: true,
          employee: shapeEmployee(e),
          reportingTo,
          team,
          year,
          month: now.getMonth() + 1,
          monthName: MONTHS[now.getMonth()],
          salary: structure ? {
            effective_from: isoDate(structure.effective_from),
            earnings: EARNINGS.map((x) => ({ ...x, amount: money(structure[x.key]) })),
            deductionLines: DEDUCTIONS.map((x) => ({ ...x, amount: money(structure[x.key]) })),
            gross: grossOf(structure),
            deductions: deductionsOf(structure),
            net: money(grossOf(structure) - deductionsOf(structure)),
          } : null,
          balances,
          attendance: tally,
          // Today's own row, so a punch button can render its correct state
          // (not in yet / in but not out / done) from this one response.
          today: (() => {
            const t = att.find((a) => isoDate(a.att_date) === today);
            return t ? {
              date: today, status: t.status, late: !!t.late_mark,
              check_in: t.check_in || null, check_out: t.check_out || null,
              working_hours: money(t.working_hours),
            } : null;
          })(),
          shift: { start: settings.hr_shift_start, end: settings.hr_shift_end, grace: num(settings.hr_grace_minutes) },
          payslips: slips,
          documents: docs.map((d) => ({ ...d, expires_on: isoDate(d.expires_on) })),
          exit: exits[0] ? { last_working_day: isoDate(exits[0].last_working_day), exit_type: exits[0].exit_type } : null,
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Admin, or your own record — the same rule the payslip print uses. This
    // response carries salary history and bank details, so "the page never
    // links there" is not protection.
    app.get('/api/hr/employees/:id', requireAuth, hrReady, async (req, res) => {
      try {
        const id = req.params.id;
        const rows = await q(`SELECT * FROM hr_employees WHERE id = $1`, [id]);
        if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
        const user = req.session?.user;
        if (!isAdminUser(user)) {
          const e = rows[0];
          const mine = (e.user_id && e.user_id === user?.id)
            || (e.email && String(e.email).toLowerCase() === String(user?.email || '').toLowerCase())
            || String(e.name).toLowerCase() === String(user?.name || '').toLowerCase();
          if (!mine) return res.status(403).json({ error: 'Not allowed' });
        }
        const year = Number(req.query.year) || new Date().getFullYear();
        const [structures, leaves, docs, onboarding, exits, slips, types] = await Promise.all([
          q(`SELECT * FROM hr_salary_structure WHERE employee_id = $1 ORDER BY effective_from DESC`, [id]),
          q(`SELECT id, leave_type, from_date, to_date, total_days, half_day, reason, status, approver_name,
                    approver_comments, balance_after, created_at, decided_at
               FROM leaves WHERE employee_id = $1 ORDER BY from_date DESC LIMIT 100`, [id]),
          q(`SELECT * FROM hr_documents WHERE employee_id = $1 ORDER BY created_at DESC`, [id]),
          q(`SELECT * FROM hr_onboarding WHERE employee_id = $1 ORDER BY sort_order ASC, created_at ASC`, [id]),
          q(`SELECT * FROM hr_exits WHERE employee_id = $1`, [id]),
          q(`SELECT id, month, year, total_gross, total_deductions, leave_deduction, net_salary
               FROM hr_payslips WHERE employee_id = $1 ORDER BY year DESC, month DESC LIMIT 24`, [id]),
          leaveTypes(),
        ]);
        const balances = [];
        for (const t of types) {
          const b = await ensureBalance(id, year, t.code);
          balances.push({ ...b, code: t.code, name: t.name, balance: balanceOf(b) });
        }
        const current = structures[0] || null;
        res.json({
          employee: shapeEmployee(rows[0]),
          structures: structures.map((s) => ({ ...s, effective_from: isoDate(s.effective_from), gross: grossOf(s), deductions: deductionsOf(s) })),
          current: current ? { ...current, effective_from: isoDate(current.effective_from), gross: grossOf(current), deductions: deductionsOf(current) } : null,
          balances, year,
          leaves: leaves.map((l) => ({ ...l, from_date: isoDate(l.from_date), to_date: isoDate(l.to_date) })),
          documents: docs.map((d) => ({ ...d, issued_on: isoDate(d.issued_on), expires_on: isoDate(d.expires_on) })),
          onboarding: onboarding.map((o) => ({ ...o, due_date: isoDate(o.due_date), done_on: isoDate(o.done_on) })),
          exit: exits[0] ? { ...exits[0], resign_date: isoDate(exits[0].resign_date), last_working_day: isoDate(exits[0].last_working_day), fnf_paid_on: isoDate(exits[0].fnf_paid_on) } : null,
          payslips: slips,
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/employees', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Employee name is required' });
        // A code typed in by hand wins (it lets an old sheet code be preserved
        // exactly); otherwise it is minted from the branch, MUM014-style.
        let id = String(b.id || '').trim().toUpperCase();
        if (id) {
          const clash = await q(`SELECT id FROM hr_employees WHERE id = $1`, [id]);
          if (clash.length) return res.status(409).json({ error: `Employee code ${id} already exists` });
        } else {
          id = await nextCode('hr_employees', 'id', branchPrefix(b.branch), 3);
        }
        // Department goes in spelled the way the departments master spells it, so
        // the HR list and every other page agree — see canonicalDept in server.js.
        const dept = await canonicalDept(b.department);
        const vals = EMP_FIELDS.map((f) => {
          const v = b[f];
          if (f === 'department') return dept;
          if (EMP_DATE_FIELDS.has(f)) return isoDate(v);
          if (f === 'probation_months') return num(v);
          return v === undefined || v === null ? '' : v;
        });
        await pool.query(
          `INSERT INTO hr_employees (id, ${EMP_FIELDS.join(', ')})
           VALUES ($1, ${EMP_FIELDS.map((_, i) => '$' + (i + 2)).join(', ')})`,
          [id, ...vals],
        );
        // Seed this year's leave balances up front, so the new joiner's card
        // shows real entitlements instead of a row of zeros.
        const year = new Date().getFullYear();
        for (const t of await leaveTypes()) await ensureBalance(id, year, t.code);
        res.json({ success: true, id });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.patch('/api/hr/employees', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Employee id is required' });
        const sets = [];
        const params = [];
        for (const f of EMP_FIELDS) {
          if (!(f in b)) continue;
          let v = b[f];
          if (f === 'department') v = await canonicalDept(v);
          else if (EMP_DATE_FIELDS.has(f)) v = isoDate(v);
          else if (f === 'probation_months') v = num(v);
          params.push(v === undefined ? null : v);
          sets.push(`${f} = $${params.length}`);
        }
        if (!sets.length) return res.json({ success: true });
        params.push(id);
        await pool.query(`UPDATE hr_employees SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Owner-only, and deliberately so: an employee row anchors payslips,
    // leave history and attendance. Marking someone Inactive is the normal
    // way to retire a record; this removes it and its dependants outright.
    app.delete('/api/hr/employees', requireAuth, requireSuperAdmin, hrReady, async (req, res) => {
      try {
        const id = String(req.query.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Employee id is required' });
        for (const t of ['hr_salary_structure', 'hr_leave_balances', 'hr_attendance',
                         'hr_onboarding', 'hr_exits', 'hr_documents', 'hr_payslips']) {
          await pool.query(`DELETE FROM ${t} WHERE employee_id = $1`, [id]).catch(() => {});
        }
        await pool.query(`DELETE FROM hr_employees WHERE id = $1`, [id]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* ── Salary structure ─────────────────────────────────────────── */

    app.get('/api/hr/salary-structure', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const employeeId = String(req.query.employeeId || '').trim();
        if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
        const rows = await q(
          `SELECT * FROM hr_salary_structure WHERE employee_id = $1 ORDER BY effective_from DESC`, [employeeId]);
        res.json(rows.map((s) => ({ ...s, effective_from: isoDate(s.effective_from), gross: grossOf(s), deductions: deductionsOf(s) })));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Always an insert — a revision is a new effective-dated row, never an
    // edit of the old one, so a payslip already issued keeps its basis.
    app.post('/api/hr/salary-structure', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const employeeId = String(b.employeeId || b.employee_id || '').trim();
        const effective = isoDate(b.effective_from || b.effectiveFrom);
        if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
        if (!effective)  return res.status(400).json({ error: 'Effective from date is required' });
        const id = rowId('SS');
        const cols = [...EARNINGS, ...DEDUCTIONS].map((c) => c.key);
        await pool.query(
          `INSERT INTO hr_salary_structure (id, employee_id, effective_from, ${cols.join(', ')}, remarks, created_by)
           VALUES ($1,$2,$3, ${cols.map((_, i) => '$' + (i + 4)).join(', ')}, $${cols.length + 4}, $${cols.length + 5})`,
          [id, employeeId, effective, ...cols.map((c) => money(b[c])), b.remarks || '', req.session?.user?.name || ''],
        );
        res.json({ success: true, id });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/hr/salary-structure', requireAuth, requireSuperAdmin, hrReady, async (req, res) => {
      try {
        const id = String(req.query.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id is required' });
        await pool.query(`DELETE FROM hr_salary_structure WHERE id = $1`, [id]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // What PF/ESIC/PT would be under the statutory formulas, for the form's
    // "suggest" button. Advisory only — see suggestStatutory.
    app.get('/api/hr/statutory-suggest', requireAuth, empMaster, (req, res) => {
      res.json(suggestStatutory({
        basic: req.query.basic, gross: req.query.gross, branch: req.query.branch,
      }));
    });

    /* ── Documents ────────────────────────────────────────────────── */

    app.post('/api/hr/documents', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        if (!b.employeeId) return res.status(400).json({ error: 'employeeId is required' });
        const id = rowId('DOC');
        await pool.query(
          `INSERT INTO hr_documents (id, employee_id, doc_type, doc_no, url, issued_on, expires_on, remarks, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, b.employeeId, b.doc_type || 'Other', b.doc_no || '', b.url || '',
           isoDate(b.issued_on), isoDate(b.expires_on), b.remarks || '', req.session?.user?.name || ''],
        );
        res.json({ success: true, id });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/hr/documents', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        await pool.query(`DELETE FROM hr_documents WHERE id = $1`, [String(req.query.id || '')]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* ── Onboarding checklist ─────────────────────────────────────── */

    // The joining formalities every new hire goes through. Seeded from one
    // default list so HR does not retype it per person; each line can then be
    // added to, renamed or dropped for that individual.
    const DEFAULT_ONBOARDING = [
      'Offer letter signed', 'Appointment letter issued', 'Documents collected (Aadhar, PAN, photos)',
      'Previous employment proof / relieving letter', 'Bank account details collected',
      'PF / UAN registration', 'ESIC registration', 'Email ID and system access created',
      'Assets issued (laptop / SIM / ID card)', 'Induction and policy briefing', 'Reporting manager introduction',
    ];

    app.post('/api/hr/onboarding', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const employeeId = String(b.employeeId || '').trim();
        if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
        if (b.seedDefaults) {
          const existing = await q(`SELECT COUNT(*) AS cnt FROM hr_onboarding WHERE employee_id = $1`, [employeeId]);
          if (Number(existing[0]?.cnt) > 0) return res.status(409).json({ error: 'Checklist already started for this employee' });
          let i = 0;
          for (const item of DEFAULT_ONBOARDING) {
            await pool.query(
              `INSERT INTO hr_onboarding (id, employee_id, item, status, sort_order) VALUES ($1,$2,$3,'pending',$4)`,
              [rowId('ONB'), employeeId, item, i++],
            );
          }
          return res.json({ success: true, seeded: DEFAULT_ONBOARDING.length });
        }
        if (!String(b.item || '').trim()) return res.status(400).json({ error: 'Checklist item is required' });
        const maxRow = await q(`SELECT MAX(sort_order) AS m FROM hr_onboarding WHERE employee_id = $1`, [employeeId]);
        const id = rowId('ONB');
        await pool.query(
          `INSERT INTO hr_onboarding (id, employee_id, item, status, due_date, owner, remarks, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, employeeId, b.item, b.status || 'pending', isoDate(b.due_date), b.owner || '', b.remarks || '',
           (Number(maxRow[0]?.m) || 0) + 1],
        );
        res.json({ success: true, id });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.patch('/api/hr/onboarding', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        if (!b.id) return res.status(400).json({ error: 'id is required' });
        const done = b.status === 'done';
        await pool.query(
          `UPDATE hr_onboarding SET status = $1, done_on = $2, remarks = COALESCE($3, remarks) WHERE id = $4`,
          [b.status || 'pending', done ? (isoDate(b.done_on) || isoDate(new Date())) : null, b.remarks ?? null, b.id],
        );
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/hr/onboarding', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        await pool.query(`DELETE FROM hr_onboarding WHERE id = $1`, [String(req.query.id || '')]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* ── Exit / full & final ──────────────────────────────────────── */

    app.get('/api/hr/exits', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const rows = await q(
          `SELECT x.*, e.name, e.designation, e.department, e.branch, e.doj
             FROM hr_exits x LEFT JOIN hr_employees e ON e.id = x.employee_id
            ORDER BY x.last_working_day DESC`);
        res.json(rows.map((r) => ({
          ...r, resign_date: isoDate(r.resign_date), last_working_day: isoDate(r.last_working_day),
          fnf_paid_on: isoDate(r.fnf_paid_on), doj: isoDate(r.doj),
        })));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Recording an exit also retires the employee: status goes Inactive and
    // dol is set, which is what every headcount and payroll query keys off.
    // Doing it here means nobody can leave the two records disagreeing.
    app.post('/api/hr/exits', requireAuth, empMaster, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const employeeId = String(b.employeeId || '').trim();
        if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
        const lwd = isoDate(b.last_working_day);
        const id = rowId('EXT');
        await pool.query(
          `INSERT INTO hr_exits (id, employee_id, resign_date, last_working_day, exit_type, reason,
                                 notice_days, notice_served, clearance, fnf_amount, fnf_status, fnf_paid_on, remarks, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (employee_id) DO UPDATE SET
             resign_date = $15, last_working_day = $16, exit_type = $17, reason = $18,
             notice_days = $19, notice_served = $20, clearance = $21, fnf_amount = $22,
             fnf_status = $23, fnf_paid_on = $24, remarks = $25`,
          [id, employeeId, isoDate(b.resign_date), lwd, b.exit_type || 'Resignation', b.reason || '',
           num(b.notice_days), b.notice_served ? 1 : 0, JSON.stringify(b.clearance || {}),
           money(b.fnf_amount), b.fnf_status || 'pending', isoDate(b.fnf_paid_on), b.remarks || '',
           req.session?.user?.name || '',
           isoDate(b.resign_date), lwd, b.exit_type || 'Resignation', b.reason || '',
           num(b.notice_days), b.notice_served ? 1 : 0, JSON.stringify(b.clearance || {}),
           money(b.fnf_amount), b.fnf_status || 'pending', isoDate(b.fnf_paid_on), b.remarks || ''],
        );
        if (lwd) {
          await pool.query(`UPDATE hr_employees SET dol = $1, status = $2 WHERE id = $3`,
            [lwd, lwd <= isoDate(new Date()) ? 'Inactive' : 'Active', employeeId]);
        }
        res.json({ success: true, id });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }

  /* ===================================================================
     Attendance
     -------------------------------------------------------------------
     Two ways in, both landing on the same one-row-per-employee-per-day
     table: staff punch themselves in from their phone (the sheet's Apps
     Script captured GPS and device, so this does too), and HR fills or
     corrects a day from the muster roll.
     =================================================================== */
  function mountAttendanceRoutes() {

    function hhmmToMinutes(hhmm) {
      const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
      return m ? (+m[1]) * 60 + (+m[2]) : 0;
    }

    app.get('/api/hr/attendance/me', requireAuth, hrReady, async (req, res) => {
      try {
        const emp = await selfEmployee(req.session?.user);
        if (!emp) return res.json({ employee: null, today: null, month: [] });
        const today = isoDate(new Date());
        const monthStart = today.slice(0, 8) + '01';
        const rows = await q(
          `SELECT * FROM hr_attendance WHERE employee_id = $1 AND att_date BETWEEN $2 AND $3 ORDER BY att_date DESC`,
          [emp.id, monthStart, today],
        );
        res.json({
          employee: { id: emp.id, name: emp.name, designation: emp.designation, branch: emp.branch },
          today: rows.find((r) => isoDate(r.att_date) === today) || null,
          month: rows.map((r) => ({ ...r, att_date: isoDate(r.att_date) })),
          settings: await getSettings(),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Punch in / out. The first punch of the day creates the row and decides
    // the late mark against the shift start plus its grace; the last punch
    // closes it and fills in the hours worked.
    app.post('/api/hr/attendance/punch', requireAuth, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const user = req.session?.user;
        const emp = await selfEmployee(user);
        if (!emp) return res.status(400).json({ error: 'No employee record is linked to your login — ask HR to link it.' });
        const s = await getSettings();
        const now = new Date();
        const today = isoDate(now);
        const stamp = `${today} ${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}`;
        const device = String(req.headers['user-agent'] || '').slice(0, 250);
        const existing = (await q(`SELECT * FROM hr_attendance WHERE employee_id = $1 AND att_date = $2`, [emp.id, today]))[0];

        if (String(b.type || 'in') === 'out') {
          if (!existing) return res.status(400).json({ error: 'You have not checked in today' });
          const inAt = existing.check_in ? new Date(existing.check_in) : null;
          const hours = inAt ? Math.max(0, Math.round(((now - inAt) / 3600000) * 100) / 100) : 0;
          await pool.query(
            `UPDATE hr_attendance SET check_out = $1, out_lat = $2, out_lon = $3, working_hours = $4 WHERE id = $5`,
            [stamp, String(b.lat || ''), String(b.lon || ''), hours, existing.id],
          );
          return res.json({ success: true, action: 'out', workingHours: hours });
        }

        if (existing && existing.check_in) return res.status(409).json({ error: 'Already checked in today' });
        const lateAfter = hhmmToMinutes(s.hr_shift_start) + num(s.hr_grace_minutes);
        const late = (now.getHours() * 60 + now.getMinutes()) > lateAfter ? 1 : 0;
        if (existing) {
          await pool.query(
            `UPDATE hr_attendance SET check_in = $1, in_lat = $2, in_lon = $3, device = $4, late_mark = $5, status = $6 WHERE id = $7`,
            [stamp, String(b.lat || ''), String(b.lon || ''), device, late, b.status || 'Present', existing.id],
          );
        } else {
          await pool.query(
            `INSERT INTO hr_attendance (id, employee_id, att_date, check_in, in_lat, in_lon, device, late_mark, status, marked_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [rowId('ATT'), emp.id, today, stamp, String(b.lat || ''), String(b.lon || ''), device, late,
             b.status || 'Present', 'self'],
          );
        }
        res.json({ success: true, action: 'in', late: !!late });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* The muster roll: one row per employee, one cell per day of the month.
       Approved leaves and the holiday calendar are folded in on read rather
       than written as attendance rows, so a leave approved after the fact
       still shows correctly and nothing has to be back-filled. */
    app.get('/api/hr/attendance', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const now = new Date();
        const year = Number(req.query.year) || now.getFullYear();
        const month = Number(req.query.month) || (now.getMonth() + 1);
        const branch = req.query.branch && req.query.branch !== 'All' ? req.query.branch : null;
        const from = `${year}-${pad(month, 2)}-01`;
        const to = `${year}-${pad(month, 2)}-${pad(daysInMonth(year, month), 2)}`;
        const s = await getSettings();
        const offs = new Set(String(s.hr_week_off || '').split(',').map((x) => x.trim()).filter(Boolean));

        const emps = await q(
          `SELECT id, name, designation, department, branch, doj, dol, status FROM hr_employees
            WHERE (dol IS NULL OR dol >= $1) AND (doj IS NULL OR doj <= $2) ${branch ? 'AND branch = $3' : ''}
            ORDER BY id ASC`,
          branch ? [from, to, branch] : [from, to],
        );
        const ids = emps.map((e) => e.id);
        const att = ids.length ? await q(
          `SELECT * FROM hr_attendance WHERE att_date BETWEEN $1 AND $2`, [from, to]) : [];
        const leaves = await q(
          `SELECT employee_id, leave_type, from_date, to_date, half_day, status FROM leaves
            WHERE status = 'Approved' AND employee_id IS NOT NULL AND to_date >= $1 AND from_date <= $2`,
          [from, to],
        ).catch(() => []);
        const hols = await q(`SELECT date, name, branch FROM holidays WHERE date BETWEEN $1 AND $2`, [from, to]).catch(() => []);

        const holByDate = {};
        for (const h of hols) holByDate[isoDate(h.date)] = { name: h.name, branch: h.branch || 'All' };
        const attByKey = {};
        for (const a of att) attByKey[a.employee_id + '|' + isoDate(a.att_date)] = a;
        const leaveByKey = {};
        for (const l of leaves) {
          for (const d of dateRange(isoDate(l.from_date), isoDate(l.to_date))) {
            if (d >= from && d <= to) leaveByKey[l.employee_id + '|' + d] = l.leave_type || 'CL';
          }
        }

        const days = dateRange(from, to);
        const rows = emps.map((e) => {
          const cells = days.map((d) => {
            const a = attByKey[e.id + '|' + d];
            if (a) return { date: d, status: a.status, in: a.check_in, out: a.check_out, late: !!a.late_mark, hours: num(a.working_hours), id: a.id };
            const lv = leaveByKey[e.id + '|' + d];
            if (lv) return { date: d, status: 'Leave', leaveType: lv };
            const hol = holByDate[d];
            if (hol && (hol.branch === 'All' || hol.branch === e.branch)) return { date: d, status: 'Holiday', name: hol.name };
            if (offs.has(String(new Date(d + 'T00:00:00Z').getUTCDay()))) return { date: d, status: 'Week Off' };
            const joined = !e.doj || isoDate(e.doj) <= d;
            const left = e.dol && isoDate(e.dol) < d;
            if (!joined || left) return { date: d, status: '' };
            if (d > isoDate(new Date())) return { date: d, status: '' };
            return { date: d, status: 'Absent' };
          });
          const tally = { Present: 0, Absent: 0, 'Half Day': 0, Leave: 0, Holiday: 0, 'Week Off': 0, Remote: 0, late: 0 };
          for (const c of cells) {
            if (c.status && tally[c.status] !== undefined) tally[c.status] += 1;
            if (c.late) tally.late += 1;
          }
          return { ...e, doj: isoDate(e.doj), dol: isoDate(e.dol), cells, tally };
        });
        res.json({ year, month, from, to, days, rows, holidays: holByDate });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // HR marking or correcting a day. Accepts one row or a whole day's worth,
    // and upserts on (employee, date) so re-marking is always safe.
    app.post('/api/hr/attendance', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const marks = Array.isArray(b.marks) ? b.marks : [b];
        const by = req.session?.user?.name || '';
        let saved = 0;
        for (const m of marks) {
          const employeeId = String(m.employeeId || m.employee_id || '').trim();
          const date = isoDate(m.date || m.att_date);
          if (!employeeId || !date) continue;
          const status = ATT_STATUS[m.status] ? m.status : 'Present';
          const checkIn  = m.check_in  ? `${date} ${String(m.check_in).slice(0, 5)}:00`  : null;
          const checkOut = m.check_out ? `${date} ${String(m.check_out).slice(0, 5)}:00` : null;
          let hours = num(m.working_hours);
          if (!hours && checkIn && checkOut) {
            hours = Math.max(0, Math.round(((new Date(checkOut) - new Date(checkIn)) / 3600000) * 100) / 100);
          }
          await pool.query(
            `INSERT INTO hr_attendance (id, employee_id, att_date, check_in, check_out, working_hours, late_mark, status, notes, marked_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (employee_id, att_date) DO UPDATE SET
               check_in = $11, check_out = $12, working_hours = $13, late_mark = $14, status = $15, notes = $16, marked_by = $17`,
            [rowId('ATT'), employeeId, date, checkIn, checkOut, hours, m.late_mark ? 1 : 0, status, m.notes || '', by,
             checkIn, checkOut, hours, m.late_mark ? 1 : 0, status, m.notes || '', by],
          );
          saved += 1;
        }
        res.json({ success: true, saved });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/hr/attendance', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const { id, employeeId, date } = req.query;
        if (id) await pool.query(`DELETE FROM hr_attendance WHERE id = $1`, [String(id)]);
        else if (employeeId && date) await pool.query(`DELETE FROM hr_attendance WHERE employee_id = $1 AND att_date = $2`, [String(employeeId), isoDate(date)]);
        else return res.status(400).json({ error: 'id, or employeeId and date, is required' });
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }

  /* ===================================================================
     Leave and the holiday calendar
     -------------------------------------------------------------------
     Requests live in the same `leaves` table the older Leave Tracker page
     writes to — extended, not replaced — so both screens show one truth.
     What the HRMS adds is the leave type, half days, a running balance and
     the balance-after figure that the sheet recorded per request.
     =================================================================== */
  function mountLeaveRoutes() {

    const yearOf = (iso) => Number(String(iso || '').slice(0, 4)) || new Date().getFullYear();

    /* Leave reasons are personal — illness, bereavement, family trouble. An
       Admin or HOD sees the whole company because approving is their job;
       everyone else sees only their own requests, whatever they ask for.
       The scope is applied here rather than in the page, so hiding a filter
       in the UI is never what is actually protecting anybody. */
    app.get('/api/hr/leaves', requireAuth, hrReady, async (req, res) => {
      try {
        const where = [];
        const params = [];
        const user = req.session?.user;

        /* forApprover=me is the Approvals page asking for the requests this
           person has to decide — never their own, which they cannot approve. */
        if (String(req.query.forApprover || '') === 'me') {
          params.push(user?.name || NO_MATCH);
          params.push(user?.email || NO_MATCH);
          params.push(user?.id || NO_MATCH);
          where.push(`(LOWER(l.approver_name) = LOWER($${params.length - 2})`
            + ` OR LOWER(l.approver_email) = LOWER($${params.length - 1}))`
            + ` AND (l.user_id IS NULL OR l.user_id <> $${params.length})`);
        } else if (!(ctx.isSuperAdminUser && ctx.isSuperAdminUser(user))) {
          /* Their own requests, plus anything naming them as the approver —
             and NOBODY else's. This used to except every Admin/HOD, but all
             seven approvers here carry the Admin role, so each of them saw —
             and could decide — the whole company's queue. Management's
             instruction: a request is visible to its applicant and its
             current approver, and to the owner login alone beyond that. */
          const me = await selfEmployee(user);
          params.push(me?.id || NO_MATCH);
          params.push(user?.id || NO_MATCH);
          params.push(user?.name || NO_MATCH);
          params.push(user?.email || NO_MATCH);
          where.push(`(l.employee_id = $${params.length - 3} OR l.user_id = $${params.length - 2}`
            + ` OR LOWER(l.approver_name) = LOWER($${params.length - 1})`
            + ` OR LOWER(l.approver_email) = LOWER($${params.length}))`);
        } else if (req.query.employeeId) {
          params.push(req.query.employeeId);
          where.push(`l.employee_id = $${params.length}`);
        }
        if (req.query.status && req.query.status !== 'All') { params.push(req.query.status); where.push(`l.status = $${params.length}`); }
        if (req.query.year) {
          params.push(`${req.query.year}-01-01`); const a = params.length;
          params.push(`${req.query.year}-12-31`); const b = params.length;
          where.push(`l.from_date BETWEEN $${a} AND $${b}`);
        }
        const rows = await q(
          `SELECT l.*, e.name AS employee_name, e.department, e.branch, e.designation
             FROM leaves l LEFT JOIN hr_employees e ON e.id = l.employee_id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY l.created_at DESC LIMIT 500`,
          params,
        );
        res.json(rows.map((r) => ({
          ...r, from_date: isoDate(r.from_date), to_date: isoDate(r.to_date),
          employee_name: r.employee_name || r.user_name,
        })));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/leaves', requireAuth, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const from = isoDate(b.from_date || b.fromDate);
        const to = isoDate(b.to_date || b.toDate) || from;
        if (!from) return res.status(400).json({ error: 'From date is required' });
        if (to < from) return res.status(400).json({ error: 'To date cannot be before the from date' });
        /* Who the request is for. HR can raise one on somebody's behalf —
           half the factory floor has no login — but everyone else applies
           for themselves regardless of what the payload says. */
        const user = req.session?.user;
        const employeeId = isAdminUser(user)
          ? String(b.employeeId || b.employee_id || '').trim()
          : ((await selfEmployee(user))?.id || '');
        const emp = employeeId ? (await q(`SELECT * FROM hr_employees WHERE id = $1`, [employeeId]))[0] : null;
        const code = String(b.leave_type || b.leaveType || 'CL').toUpperCase();
        const halfDay = ['full', 'first', 'second'].includes(b.half_day) ? b.half_day : 'full';
        const days = num(b.total_days) || await leaveDayCount(from, to, halfDay, emp?.branch);
        if (!days) return res.status(400).json({ error: 'This request works out to zero leave days' });

        // Warn, but do not block: a genuine emergency should not be stopped by
        // an exhausted balance — payroll turns the excess into loss of pay.
        let warning = null;
        if (employeeId) {
          const bal = await ensureBalance(employeeId, yearOf(from), code);
          const available = balanceOf(bal);
          if (code !== 'LWP' && days > available) {
            warning = `Only ${available} ${code} left — ${money(days - available)} day(s) will be treated as loss of pay.`;
          }
        }
        /* Who this request goes to. The approver picked on the applicant's
           user record (Users → Add/Edit → Leave Approver) is the single
           source when it is set — management's instruction: whoever is chosen
           there is who the request and its mail go to, over anything the
           payload carries and over the department tier. Everything below the
           first block only runs for applicants nobody has picked an approver
           for yet. Resolved once, here, and stamped onto the row — so a
           request keeps the approver it was raised against even if the
           setting changes afterwards. */
        let approverName = String(b.approver_name || '').trim();
        let approverEmail = String(b.approver_email || '').trim();

        /* The applicant's LOGIN. The employee row's link first, then the id
           the payload names — and the session only when the request is the
           person's own. It used to start from the session, so HR raising a
           request on somebody's behalf silently used HR's OWN leave approver. */
        const applicantLoginId = emp?.user_id
          || String(b.userId || '').trim()
          || (!isAdminUser(user) || !employeeId || (await selfEmployee(user))?.id === employeeId
                ? user?.id || '' : '');

        let pickedApprover = null;
        if (applicantLoginId) {
          const link = (await q(`SELECT leave_approver FROM users WHERE id = $1`, [applicantLoginId]).catch(() => []))[0];
          if (link?.leave_approver) {
            pickedApprover = (await q(
              `SELECT name, email FROM users WHERE id = $1 AND active = 1`,
              [link.leave_approver],
            ).catch(() => []))[0] || null;
          }
        }

        /* The department tier, per the written policy for Accounts:
           up to 2 days needs no Paresh sign-off (the within-team approver or
           the picked one handles it); 3 days or more MUST go to Paresh, over
           whoever is picked on the Users page — the whole point of the rule is
           that a long absence cannot be signed off inside the department.
           Jayesh Udani & above are exempt from the tier entirely and route as
           per their own authority — leaveAuthorityFor returns null for them. */
        /* The employee master is the department of record, but plenty of office
           staff apply before anyone has made them an employee row — for those
           the login's own department is what there is. Only ever the session
           user's own, and only when the request is for themselves: an Admin
           raising one against an employee id that does not resolve must not
           quietly have their own department's rule applied to it. */
        const applicantDept = emp?.department
          || (employeeId ? '' : (req.session?.user?.department || ''));
        const applicantName = emp?.name || b.userName || (!employeeId ? user?.name : '') || '';
        const tier = ctx.leaveAuthorityFor
          ? await ctx.leaveAuthorityFor(applicantDept, days, applicantName).catch(() => null)
          : null;
        let tierNote = null;

        let nextApproverName = '', nextApproverEmail = '';
        if (tier?.escalated) {
          approverName = tier.name;
          approverEmail = tier.email;
          if (tier.then) {
            nextApproverName = tier.then.name || '';
            nextApproverEmail = tier.then.email || '';
            tierNote = `${days} day(s) — this needs ${tier.name}'s and then ${nextApproverName}'s approval.`;
          } else {
            tierNote = `${days} day(s) — this needs ${tier.name}'s approval, so it has been sent there.`;
          }
        } else if (pickedApprover) {
          approverName = pickedApprover.name || '';
          approverEmail = pickedApprover.email || '';
        }

        if (!approverName) {
          // Nobody picked and no tier — fall back to the reporting line the
          // employee record already carries. It holds a code on records this
          // app created and a plain name on the ones imported from the sheet.
          if (!approverName && emp?.reporting_to) {
            const mgr = (await q(
              `SELECT name, email FROM hr_employees WHERE id = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
              [emp.reporting_to, emp.reporting_to],
            ).catch(() => []))[0];
            if (mgr) { approverName = mgr.name || ''; approverEmail = mgr.email || ''; }
            // Most reporting lines end at a director or business manager who
            // has a login but no employee record — they draw no salary here.
            // Without this the request would fall through to plain 'HOD' and
            // nobody would be mailed, which is exactly the case the reporting
            // sheet exists to cover.
            if (!approverName) {
              const boss = (await q(
                `SELECT name, email FROM users WHERE LOWER(name) = LOWER($1) AND active = 1 LIMIT 1`,
                [emp.reporting_to],
              ).catch(() => []))[0];
              if (boss) { approverName = boss.name || ''; approverEmail = boss.email || ''; }
            }
          }
          // Still nobody named, and the department has a tier — its within-team
          // approver is a better answer than falling through to plain "HOD".
          if (!approverName && tier && !tier.escalated) {
            approverName = tier.name;
            approverEmail = tier.email;
          }
        }

        /* Was 'LV' + (COUNT(*) + 1). Leave rows do get deleted — a rejected or
           withdrawn request, a cleanup — and the moment one does, the count drops
           and the next application is minted with an id that already exists, so
           the primary key rejects it and the employee sees a 500. Minted from the
           highest id in use instead. */
        const id = await withSeqId('leaves', 'LV', 4, (newId) => pool.query(
          `INSERT INTO leaves (id, user_id, user_name, employee_id, type, leave_type, half_day, total_days,
                               from_date, to_date, reason, status, approver, approver_email, approver_name, backup_name,
                               next_approver_name, next_approver_email)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,$15,$16,$17)`,
          [newId, b.userId || req.session?.user?.id || null,
           b.userName || emp?.name || req.session?.user?.name || 'Unknown',
           employeeId || null, 'Leave', code, halfDay, days, from, to, b.reason || '',
           approverName || b.approver || 'HOD', approverEmail, approverName,
           String(b.backup_name || '').trim().slice(0, 255),
           nextApproverName, nextApproverEmail],
        ));
        /* Tell the approver. Fire-and-forget on purpose: SMTP is somebody
           else's server and can be slow or down, and a leave request that is
           already safely stored must not fail — or make the applicant wait —
           because a mail did not go out. Failures are logged, not raised. */
        if (approverName && ctx.sendLeaveRequestEmail) {
          (async () => {
            // The approver's login row, so their Notification Email can be
            // preferred over the login address (see notifyAddressFor).
            const approverUser = (await q(
              `SELECT id, email FROM users WHERE ${approverEmail ? 'LOWER(email) = LOWER($1)' : 'LOWER(name) = LOWER($1)'} LIMIT 1`,
              [approverEmail || approverName],
            ).catch(() => []))[0];
            const loginEmail = approverEmail || approverUser?.email || '';
            const address = ctx.notifyAddressFor
              ? await ctx.notifyAddressFor(approverUser?.id, loginEmail)
              : loginEmail;
            // The buttons in the mail act only for the mailbox they were sent
            // to — recorded here so a level-1 link can never finalise a row
            // that has moved on to its level-2 approver.
            if (address) await pool.query(`UPDATE leaves SET approver_mailto = $1 WHERE id = $2`, [address, id]).catch(() => {});
            await ctx.sendLeaveRequestEmail({
              // Carries the Approve / Reject buttons in the mail. Without an id
              // there is nothing to sign a link against, so the mail falls back
              // to telling them to open the ERP.
              leaveId: id,
              nextApproverName,
              toEmail: address,
              toName: approverName,
              applicantName: emp?.name || b.userName || req.session?.user?.name || 'An employee',
              leaveType: code,
              fromDate: from,
              toDate: to === from ? '' : to,
              days, halfDay,
              reason: b.reason || '',
              balanceNote: warning || '',
            });
          })().catch((e) => console.error('[hrms] leave request mail failed:', e.message));
        }

        // `notice` is separate from `warning`: a warning is about the balance
        // and is the applicant's problem, a notice explains why the request
        // went somewhere other than their usual approver.
        res.json({ success: true, id, days, warning, notice: tierNote, approver: approverName });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* Who is away today, for the dashboard. requireAuth only — knowing a
       colleague is out, and who covers for them, is exactly what every employee
       opens the dashboard to find out. Names and the backup, nothing more. */
    app.get('/api/hr/on-leave-today', requireAuth, hrReady, async (req, res) => {
      try {
        const todayIso = isoDate(new Date());
        const rows = await q(
          `SELECT COALESCE(e.name, l.user_name) AS name, l.leave_type, l.half_day, l.backup_name, l.to_date
             FROM leaves l LEFT JOIN hr_employees e ON e.id = l.employee_id
            WHERE LOWER(l.status) = 'approved' AND l.from_date <= $1 AND l.to_date >= $2
            ORDER BY name ASC`, [todayIso, todayIso]).catch(() => []);
        res.json(rows.map((r) => ({
          name: r.name || '—',
          type: r.leave_type || 'CL',
          half: String(r.half_day || 'full') !== 'full',
          backup: r.backup_name || '',
          till: isoDate(r.to_date) || '',
        })));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* Approve / reject / cancel. The balance moves here and only here: an
       approval books the days, and un-approving a request that was already
       approved hands them back. Doing the arithmetic anywhere else is how a
       balance and its history drift apart. */
    /* Deciding a request. Admin and HOD can decide anything, as before — and so
       can the person actually named as its approver, who is frequently neither.
       Naming somebody as approver and then refusing them the button would make
       the whole setting decorative. requireAdmin is therefore not used here;
       the check below is the gate. */
    app.patch('/api/hr/leaves', requireAuth, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const id = String(b.id || '').trim();
        const status = String(b.status || '').trim();
        if (!id || !status) return res.status(400).json({ error: 'id and status are required' });

        const user = req.session?.user;
        const row = (await q(`SELECT * FROM leaves WHERE id = $1`, [id]))[0];
        if (!row) return res.status(404).json({ error: 'Leave request not found' });
        const same = (a, c) => String(a || '').trim().toLowerCase() === String(c || '').trim().toLowerCase();
        /* Only the request's CURRENT approver decides it — not every Admin.
           All seven approvers here carry the Admin role, so the old admin
           bypass meant any of them could sign off anybody's leave. The owner
           login keeps the override for the day an approver is unreachable. */
        if (!(ctx.isSuperAdminUser && ctx.isSuperAdminUser(user))) {
          const named = same(row.approver_name, user?.name)
            || (row.approver_email && same(row.approver_email, user?.email));
          // Nobody decides their own leave, whoever they are named as.
          if (!named || row.user_id === user?.id) {
            return res.status(403).json({ error: 'Only this request' + String.fromCharCode(39) + 's approver can decide it' });
          }
        }

        /* Two-signature rows (Accounts, 3+ days). A first approval does not
           book the days — it forwards the request to the second approver and
           mails them; the balance moves only on THEIR approval. A rejection at
           either level ends it there. When the person deciding IS the second
           approver (Paresh acting directly, in app or as Admin), both
           signatures collapse into one and the row approves outright. */
        if (/^approved$/i.test(status) && /^pending$/i.test(String(row.status || '')) && row.next_approver_name) {
          const isFinal = same(row.next_approver_name, user?.name)
            || (row.next_approver_email && same(row.next_approver_email, user?.email));
          if (!isFinal) {
            await pool.query(
              `UPDATE leaves SET approver = $1, approver_name = $2, approver_email = $3,
                      next_approver_name = '', next_approver_email = '', level1_by = $4 WHERE id = $5`,
              [row.next_approver_name, row.next_approver_name, row.next_approver_email || '', user?.name || '', id],
            );
            if (b.comments != null) {
              await pool.query(`UPDATE leaves SET approver_comments = $1 WHERE id = $2`, [b.comments, id]);
            }
            // Tell the second approver it is with them now — same mail, same
            // buttons, their own signed links.
            if (ctx.sendLeaveRequestEmail) {
              (async () => {
                const au = (await q(
                  `SELECT id, email FROM users WHERE ${row.next_approver_email ? 'LOWER(email) = LOWER($1)' : 'LOWER(name) = LOWER($1)'} LIMIT 1`,
                  [row.next_approver_email || row.next_approver_name],
                ).catch(() => []))[0];
                const loginEmail = row.next_approver_email || au?.email || '';
                const address = ctx.notifyAddressFor ? await ctx.notifyAddressFor(au?.id, loginEmail) : loginEmail;
                if (address) await pool.query(`UPDATE leaves SET approver_mailto = $1 WHERE id = $2`, [address, id]).catch(() => {});
                await ctx.sendLeaveRequestEmail({
                  leaveId: id,
                  toEmail: address,
                  toName: row.next_approver_name,
                  applicantName: row.user_name,
                  leaveType: row.leave_type || row.type,
                  fromDate: isoDate(row.from_date),
                  toDate: isoDate(row.to_date) === isoDate(row.from_date) ? '' : isoDate(row.to_date),
                  days: num(row.total_days), halfDay: row.half_day,
                  reason: row.reason || '',
                  firstApprovedBy: user?.name || row.approver_name || '',
                });
              })().catch((e) => console.error('[hrms] level-2 mail failed:', e.message));
            }
            return res.json({ success: true, forwardedTo: row.next_approver_name });
          }
        }

        const decision = await applyLeaveDecision(id, status, req.session?.user?.name || '');
        if (!decision) return res.status(404).json({ error: 'Leave request not found' });
        if (b.comments != null) {
          await pool.query(`UPDATE leaves SET approver_comments = $1 WHERE id = $2`, [b.comments, id]);
        }
        res.json({ success: true, balanceAfter: decision.balanceAfter });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* ── Balances ─────────────────────────────────────────────────── */

    app.get('/api/hr/leave-balances', requireAuth, hrReady, async (req, res) => {
      try {
        const year = Number(req.query.year) || new Date().getFullYear();
        const types = await leaveTypes();
        // Same scoping as the request list: your own balances unless you are
        // the one who approves leave.
        const scopedId = isAdminUser(req.session?.user)
          ? String(req.query.employeeId || '')
          : ((await selfEmployee(req.session?.user))?.id || NO_MATCH);
        const emps = scopedId
          ? await q(`SELECT id, name, department, branch FROM hr_employees WHERE id = $1`, [scopedId])
          : await q(`SELECT id, name, department, branch FROM hr_employees WHERE status = 'Active' ORDER BY id ASC`);
        const stored = await q(`SELECT * FROM hr_leave_balances WHERE year = $1`, [year]).catch(() => []);
        const byKey = {};
        for (const s of stored) byKey[s.employee_id + '|' + s.type_code] = s;
        const rows = emps.map((e) => {
          const cells = {};
          for (const t of types) {
            const s = byKey[e.id + '|' + t.code] || { opening: 0, accrued: num(t.annual_quota), used: 0 };
            cells[t.code] = { opening: num(s.opening), accrued: num(s.accrued), used: num(s.used), balance: balanceOf(s) };
          }
          return { ...e, cells };
        });
        res.json({ year, types, rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Setting an opening or an entitlement by hand — a mid-year joiner with a
    // pro-rated quota, or a carry-forward brought over from last year.
    app.post('/api/hr/leave-balances', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const year = Number(b.year) || new Date().getFullYear();
        const rows = Array.isArray(b.rows) ? b.rows : [b];
        for (const r of rows) {
          if (!r.employeeId || !r.code) continue;
          await pool.query(
            `INSERT INTO hr_leave_balances (employee_id, year, type_code, opening, accrued, used)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (employee_id, year, type_code) DO UPDATE SET opening = $7, accrued = $8, used = $9`,
            [r.employeeId, year, r.code, money(r.opening), money(r.accrued), money(r.used),
             money(r.opening), money(r.accrued), money(r.used)],
          );
        }
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* Year-end carry forward. PL carries (capped at max_carry), CL and SL
       lapse — which is what the leave-type table says, so the rule lives
       there rather than in this code. */
    app.post('/api/hr/leave-balances/carry-forward', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const fromYear = Number(req.body?.fromYear) || (new Date().getFullYear() - 1);
        const toYear = fromYear + 1;
        const types = await leaveTypes();
        const emps = await q(`SELECT id FROM hr_employees WHERE status = 'Active'`);
        let carried = 0;
        for (const e of emps) {
          for (const t of types) {
            const prev = await ensureBalance(e.id, fromYear, t.code);
            const left = t.carry_forward ? Math.min(balanceOf(prev), num(t.max_carry) || Infinity) : 0;
            await pool.query(
              `INSERT INTO hr_leave_balances (employee_id, year, type_code, opening, accrued, used)
               VALUES ($1,$2,$3,$4,$5,0) ON CONFLICT (employee_id, year, type_code) DO UPDATE SET opening = $6, accrued = $7`,
              [e.id, toYear, t.code, money(left), num(t.annual_quota), money(left), num(t.annual_quota)],
            );
            if (left) carried += 1;
          }
        }
        res.json({ success: true, toYear, carried });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* ── Leave types ──────────────────────────────────────────────── */

    app.get('/api/hr/leave-types', requireAuth, hrReady, async (req, res) => {
      try { res.json(await leaveTypes()); }
      catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/leave-types', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const code = String(b.code || '').trim().toUpperCase();
        if (!code) return res.status(400).json({ error: 'Leave code is required' });
        await pool.query(
          `INSERT INTO hr_leave_types (code, name, annual_quota, paid, carry_forward, max_carry, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (code) DO UPDATE SET name = $8, annual_quota = $9, paid = $10, carry_forward = $11, max_carry = $12, sort_order = $13`,
          [code, b.name || code, num(b.annual_quota), b.paid ? 1 : 0, b.carry_forward ? 1 : 0, num(b.max_carry), num(b.sort_order),
           b.name || code, num(b.annual_quota), b.paid ? 1 : 0, b.carry_forward ? 1 : 0, num(b.max_carry), num(b.sort_order)],
        );
        res.json({ success: true, code });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* ── Holiday calendar ─────────────────────────────────────────── */

    app.get('/api/hr/holidays', requireAuth, hrReady, async (req, res) => {
      try {
        const year = Number(req.query.year) || new Date().getFullYear();
        const rows = await q(
          `SELECT * FROM holidays WHERE date BETWEEN $1 AND $2 ORDER BY date ASC`,
          [`${year}-01-01`, `${year}-12-31`],
        );
        res.json(rows.map((h) => ({ ...h, date: isoDate(h.date), branch: h.branch || 'All', applies_to: h.applies_to || 'All' })));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/holidays', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const list = Array.isArray(b.rows) ? b.rows : [b];
        let saved = 0;
        for (const h of list) {
          const date = isoDate(h.date);
          if (!date || !String(h.name || '').trim()) continue;
          const id = await nextCode('holidays', 'id', 'H', 3);
          await pool.query(
            `INSERT INTO holidays (id, date, name, type, branch, applies_to, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, date, h.name, h.type || 'Public', h.branch || 'All', h.applies_to || 'All', h.notes || ''],
          );
          saved += 1;
        }
        res.json({ success: true, saved });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/hr/holidays', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        await pool.query(`DELETE FROM holidays WHERE id = $1`, [String(req.query.id || '')]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }

  /* ===================================================================
     Payroll
     -------------------------------------------------------------------
     A month is a run; a run holds one frozen payslip per employee. Running
     it again re-computes the draft in place, which is the point — HR marks
     the last of the attendance, regenerates, and only then finalises. After
     that the run is read-only and the figures can never move under a payslip
     somebody has already been handed.
     =================================================================== */
  function mountPayrollRoutes() {

    /* The one place that decides what a month costs. Everything the payslip
       shows is computed here so the register, the slip and the bank sheet can
       never disagree — they all read the same stored row. */
    async function computeMonth(month, year, settings) {
      const mdays = daysInMonth(year, month);
      const from = `${year}-${pad(month, 2)}-01`;
      const to = `${year}-${pad(month, 2)}-${pad(mdays, 2)}`;

      const [emps, att, leaves, types] = await Promise.all([
        q(`SELECT * FROM hr_employees
            WHERE (doj IS NULL OR doj <= $1) AND (dol IS NULL OR dol >= $2)
            ORDER BY id ASC`, [to, from]),
        q(`SELECT employee_id, att_date, status FROM hr_attendance WHERE att_date BETWEEN $1 AND $2`, [from, to]),
        q(`SELECT employee_id, leave_type, from_date, to_date, half_day FROM leaves
            WHERE status = 'Approved' AND employee_id IS NOT NULL AND to_date >= $1 AND from_date <= $2`, [from, to])
          .catch(() => []),
        leaveTypes(),
      ]);

      const unpaid = new Set(types.filter((t) => !num(t.paid)).map((t) => t.code));
      const attByEmp = {};
      for (const a of att) (attByEmp[a.employee_id] ||= []).push(a);
      const leaveByEmp = {};
      for (const l of leaves) (leaveByEmp[l.employee_id] ||= []).push(l);

      const out = [];
      for (const e of emps) {
        const structure = await structureOn(e.id, to);
        const gross = grossOf(structure);

        /* Days the company is not paying for, whatever the reason: unpaid
           leave, an absence with no leave behind it, and the part of the month
           that falls outside the person's employment. Collected as a set of
           dates rather than a running total, because those reasons overlap —
           an unpaid leave day that HR also marked Absent is one lost day, not
           two, and a naive sum would dock the salary twice.

           Half days are collected as a set of DATES for the same reason. They
           used to be summed into a running total on the assumption that they
           "cannot collide" — but an unpaid half-day leave and an attendance row
           marked Half Day on that same date each added 0.5, so one half day off
           was docked as a whole day. A half day on a date that is already a full
           day of loss now costs nothing extra, too. */
        const lopDates = new Set();
        const lopHalfDates = new Set();
        const inMonth = (d) => d >= from && d <= to;
        const doj = isoDate(e.doj), dol = isoDate(e.dol);

        for (const d of dateRange(from, to)) {
          if ((doj && d < doj) || (dol && d > dol)) lopDates.add(d);
        }
        for (const l of (leaveByEmp[e.id] || [])) {
          if (!unpaid.has(l.leave_type)) continue;
          const days = dateRange(isoDate(l.from_date), isoDate(l.to_date)).filter(inMonth);
          if (String(l.half_day || 'full') === 'full') days.forEach((d) => lopDates.add(d));
          else if (days.length) lopHalfDates.add(days[0]);
        }

        // Present days count only days actually worked. Leave, holidays and
        // week-offs are paid but not worked, so they are reported on their own
        // lines — rolling them in here is what makes a muster roll unreadable.
        let presentDays = 0;
        for (const a of (attByEmp[e.id] || [])) {
          const day = isoDate(a.att_date);
          if (a.status === 'Present' || a.status === 'Remote') presentDays += 1;
          else if (a.status === 'Half Day') { presentDays += 0.5; lopHalfDates.add(day); }
          else if (a.status === 'Absent') lopDates.add(day);
        }

        let leaveDays = 0;
        for (const l of (leaveByEmp[e.id] || [])) {
          if (unpaid.has(l.leave_type)) continue;
          const days = dateRange(isoDate(l.from_date), isoDate(l.to_date)).filter(inMonth);
          leaveDays += String(l.half_day || 'full') === 'full' ? days.length : 0.5;
        }
        // One half-day charge per date, and none at all on a date already lost in full.
        let lopHalves = 0;
        for (const d of lopHalfDates) if (!lopDates.has(d)) lopHalves += 0.5;
        const lop = Math.min(money(lopDates.size + lopHalves), mdays);

        // Maharashtra charges 300 of professional tax in February against 200
        // the rest of the year. Only the standard slab is bumped — a figure HR
        // has overridden is left exactly as they set it.
        let pt = num(structure?.pt);
        const febExtra = num(settings.hr_pt_february_extra);
        if (month === 2 && pt === 200 && febExtra) pt += febExtra;

        const deductionValues = { pt, loan: num(structure?.loan), pf: num(structure?.pf), esic: num(structure?.esic), tds: num(structure?.tds) };
        const totalDeductions = money(Object.values(deductionValues).reduce((a, b) => a + b, 0));
        const leaveDeduction = money(mdays ? (gross / mdays) * lop : 0);
        const net = money(gross - totalDeductions - leaveDeduction);

        out.push({
          employee: e, structure,
          row: {
            employee_id: e.id, employee_name: e.name, designation: e.designation || '',
            department: e.department || '', branch: e.branch || '',
            month, year,
            ...Object.fromEntries(EARNINGS.map((k) => [k.key, money(structure?.[k.key])])),
            total_gross: gross,
            ...deductionValues,
            total_deductions: totalDeductions,
            month_days: mdays, present_days: money(presentDays), leave_days: money(leaveDays),
            lop_days: lop, paid_days: money(mdays - lop),
            leave_deduction: leaveDeduction, net_salary: net,
            bank_name: e.bank_name || '', account_no: e.account_no || '',
            note: !structure ? 'No salary structure on record' : (pt === 0 ? 'PT exempt (employee PT = 0)' : ''),
          },
        });
      }
      return { from, to, mdays, results: out };
    }

    // The list of months, newest first, with what each one totalled.
    app.get('/api/hr/payroll', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const runs = await q(
          `SELECT r.*,
                  (SELECT COUNT(*) FROM hr_payslips p WHERE p.run_id = r.id) AS employees,
                  (SELECT COALESCE(SUM(p.total_gross),0) FROM hr_payslips p WHERE p.run_id = r.id) AS gross,
                  (SELECT COALESCE(SUM(p.net_salary),0) FROM hr_payslips p WHERE p.run_id = r.id) AS net
             FROM hr_payroll_runs r ORDER BY r.year DESC, r.month DESC LIMIT 60`);
        res.json(runs.map((r) => ({ ...r, monthName: MONTHS[r.month - 1] })));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // One month in full. Before it has been generated this returns a preview
    // computed on the fly, so HR can see what a run would produce — and what
    // is missing from it — without committing anything.
    app.get('/api/hr/payroll/run', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const now = new Date();
        const year = Number(req.query.year) || now.getFullYear();
        const month = Number(req.query.month) || (now.getMonth() + 1);
        const runs = await q(`SELECT * FROM hr_payroll_runs WHERE year = $1 AND month = $2`, [year, month]);
        const run = runs[0] || null;
        if (run) {
          const slips = await q(`SELECT * FROM hr_payslips WHERE run_id = $1 ORDER BY id ASC`, [run.id]);
          return res.json({ run: { ...run, monthName: MONTHS[month - 1] }, slips, preview: false });
        }
        const settings = await getSettings();
        const { results } = await computeMonth(month, year, settings);
        res.json({
          run: null, preview: true, month, year, monthName: MONTHS[month - 1],
          slips: results.map((r, i) => ({ id: `SAL-${year}-${pad(month, 2)}-${pad(i + 1, 3)}`, ...r.row })),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/payroll/generate', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const now = new Date();
        const year = Number(b.year) || now.getFullYear();
        const month = Number(b.month) || (now.getMonth() + 1);
        if (month < 1 || month > 12) return res.status(400).json({ error: 'Month must be between 1 and 12' });

        const existing = (await q(`SELECT * FROM hr_payroll_runs WHERE year = $1 AND month = $2`, [year, month]))[0];
        if (existing && existing.status === 'finalised') {
          return res.status(409).json({ error: `${MONTHS[month - 1]} ${year} is already finalised. Reopen it first to regenerate.` });
        }
        const runId = existing ? existing.id : `RUN-${year}-${pad(month, 2)}`;
        if (!existing) {
          await pool.query(
            `INSERT INTO hr_payroll_runs (id, month, year, status, generated_by) VALUES ($1,$2,$3,'draft',$4)`,
            [runId, month, year, req.session?.user?.name || ''],
          );
        } else {
          await pool.query(`UPDATE hr_payroll_runs SET generated_at = NOW(), generated_by = $1 WHERE id = $2`,
            [req.session?.user?.name || '', runId]);
        }

        // A regenerate is a clean rebuild: rows for people no longer in the
        // month (a wrong joining date fixed, say) must not survive as ghosts.
        await pool.query(`DELETE FROM hr_payslips WHERE run_id = $1`, [runId]);

        const settings = await getSettings();
        const { results } = await computeMonth(month, year, settings);
        const cols = ['id', 'run_id', 'employee_id', 'employee_name', 'designation', 'department', 'branch',
          'month', 'year', ...EARNINGS.map((e) => e.key), 'total_gross',
          ...DEDUCTIONS.map((d) => d.key), 'total_deductions',
          'month_days', 'present_days', 'leave_days', 'lop_days', 'paid_days',
          'leave_deduction', 'net_salary', 'bank_name', 'account_no', 'note'];

        let i = 0;
        for (const r of results) {
          const id = `SAL-${year}-${pad(month, 2)}-${pad(++i, 3)}`;
          const row = { id, run_id: runId, ...r.row };
          await pool.query(
            `INSERT INTO hr_payslips (${cols.join(', ')}) VALUES (${cols.map((_, n) => '$' + (n + 1)).join(', ')})`,
            cols.map((c) => row[c] ?? ''),
          );
        }
        const totals = results.reduce((t, r) => ({
          gross: t.gross + r.row.total_gross, net: t.net + r.row.net_salary,
        }), { gross: 0, net: 0 });
        res.json({ success: true, runId, employees: results.length, gross: money(totals.gross), net: money(totals.net) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/payroll/finalise', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const year = Number(req.body?.year), month = Number(req.body?.month);
        const run = (await q(`SELECT * FROM hr_payroll_runs WHERE year = $1 AND month = $2`, [year, month]))[0];
        if (!run) return res.status(404).json({ error: 'Generate the payroll for this month first' });
        await pool.query(`UPDATE hr_payroll_runs SET status = 'finalised', finalised_at = NOW() WHERE id = $1`, [run.id]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Reopening is owner-only. A finalised month has been paid out and its
    // slips handed over; putting it back in play is a decision, not a click.
    app.post('/api/hr/payroll/reopen', requireAuth, requireSuperAdmin, hrReady, async (req, res) => {
      try {
        const year = Number(req.body?.year), month = Number(req.body?.month);
        await pool.query(
          `UPDATE hr_payroll_runs SET status = 'draft', finalised_at = NULL WHERE year = $1 AND month = $2`, [year, month]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Hand-editing one figure on a draft slip — an arrear, a one-off bonus, a
    // loan instalment. Totals are always recomputed from the parts, so an edit
    // can never leave a slip that does not add up.
    app.patch('/api/hr/payslip', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const slip = (await q(`SELECT * FROM hr_payslips WHERE id = $1`, [String(b.id || '')]))[0];
        if (!slip) return res.status(404).json({ error: 'Payslip not found' });
        const run = (await q(`SELECT * FROM hr_payroll_runs WHERE id = $1`, [slip.run_id]))[0];
        if (run?.status === 'finalised') return res.status(409).json({ error: 'This month is finalised — reopen it to edit.' });

        const merged = { ...slip };
        for (const k of [...EARNINGS.map((e) => e.key), ...DEDUCTIONS.map((d) => d.key), 'lop_days', 'note']) {
          if (k in b) merged[k] = k === 'note' ? String(b[k]).slice(0, 250) : money(b[k]);
        }
        const gross = money(EARNINGS.reduce((t, e) => t + num(merged[e.key]), 0));
        const ded = money(DEDUCTIONS.reduce((t, d) => t + num(merged[d.key]), 0));
        const mdays = num(merged.month_days) || 30;
        const lop = Math.min(num(merged.lop_days), mdays);
        const leaveDeduction = money((gross / mdays) * lop);
        await pool.query(
          `UPDATE hr_payslips SET ${[...EARNINGS, ...DEDUCTIONS].map((c, i) => `${c.key} = $${i + 1}`).join(', ')},
                  total_gross = $${EARNINGS.length + DEDUCTIONS.length + 1},
                  total_deductions = $${EARNINGS.length + DEDUCTIONS.length + 2},
                  lop_days = $${EARNINGS.length + DEDUCTIONS.length + 3},
                  paid_days = $${EARNINGS.length + DEDUCTIONS.length + 4},
                  leave_deduction = $${EARNINGS.length + DEDUCTIONS.length + 5},
                  net_salary = $${EARNINGS.length + DEDUCTIONS.length + 6},
                  note = $${EARNINGS.length + DEDUCTIONS.length + 7}
            WHERE id = $${EARNINGS.length + DEDUCTIONS.length + 8}`,
          [...[...EARNINGS, ...DEDUCTIONS].map((c) => money(merged[c.key])),
           gross, ded, lop, money(mdays - lop), leaveDeduction, money(gross - ded - leaveDeduction),
           merged.note || '', slip.id],
        );
        res.json({ success: true, net: money(gross - ded - leaveDeduction) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // The bank's own upload format: who to pay, where, how much. Nothing else
    // belongs in a file that leaves the building.
    app.get('/api/hr/payroll/bank-sheet', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const year = Number(req.query.year), month = Number(req.query.month);
        const rows = await q(
          `SELECT p.employee_id, p.employee_name, p.net_salary, e.bank_name, e.account_no, e.ifsc
             FROM hr_payslips p LEFT JOIN hr_employees e ON e.id = p.employee_id
            WHERE p.year = $1 AND p.month = $2 AND p.net_salary > 0
            ORDER BY p.employee_id ASC`, [year, month]);
        res.json({ month, year, monthName: MONTHS[month - 1], rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* An employee's own slips. Deliberately not behind requireAdmin — the
       filter is the person's own employee record, so this can never return
       somebody else's pay. */
    app.get('/api/hr/my-payslips', requireAuth, hrReady, async (req, res) => {
      try {
        const user = req.session?.user;
        const emp = (await q(
          `SELECT id FROM hr_employees WHERE user_id = $1 OR (email <> '' AND LOWER(email) = LOWER($2)) OR LOWER(name) = LOWER($3) LIMIT 1`,
          [user?.id || '', user?.email || '', user?.name || ''],
        ).catch(() => []))[0];
        if (!emp) return res.json([]);
        const slips = await q(
          `SELECT p.* FROM hr_payslips p
             JOIN hr_payroll_runs r ON r.id = p.run_id
            WHERE p.employee_id = $1 AND r.status = 'finalised'
            ORDER BY p.year DESC, p.month DESC LIMIT 36`, [emp.id]);
        res.json(slips);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* The printable slip. Rendered server-side as a self-contained page the
       browser prints (or saves as PDF) — no Drive round-trip, so it works on
       a bad line and leaves no copy of anybody's pay sitting in cloud storage. */
    app.get('/api/hr/payslip/:id/print', requireAuth, hrReady, async (req, res) => {
      try {
        const slip = (await q(`SELECT * FROM hr_payslips WHERE id = $1`, [req.params.id]))[0];
        if (!slip) return res.status(404).send('Payslip not found');
        const user = req.session?.user;
        if (!isAdminUser(user)) {
          const own = (await q(
            `SELECT id FROM hr_employees WHERE id = $1 AND (user_id = $2 OR LOWER(email) = LOWER($3) OR LOWER(name) = LOWER($4))`,
            [slip.employee_id, user?.id || '', user?.email || '', user?.name || ''],
          ).catch(() => []))[0];
          if (!own) return res.status(403).send('Not allowed');
        }
        const emp = (await q(`SELECT * FROM hr_employees WHERE id = $1`, [slip.employee_id]))[0] || {};
        const settings = await getSettings();
        res.set('Content-Type', 'text/html; charset=utf-8').send(payslipHtml(slip, emp, settings));
      } catch (e) { res.status(500).send('Error: ' + esc(e.message)); }
    });
  }

  /* ===================================================================
     HR MIS
     -------------------------------------------------------------------
     One endpoint, one `type` per report, all returning the same
     { title, summary, columns, rows } shape — so the report page renders
     any of them without knowing which it asked for, and a new report is a
     case in this switch rather than a new page.
     =================================================================== */
  function mountReportRoutes() {

    // Whole years of service as of today, which is what "tenure" means to
    // everyone who reads these reports.
    function yearsSince(iso) {
      if (!iso) return null;
      const d = new Date(iso + 'T00:00:00Z');
      if (isNaN(d.getTime())) return null;
      return Math.round(((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)) * 10) / 10;
    }
    const groupCount = (rows, key) => {
      const m = {};
      for (const r of rows) { const k = String(r[key] || '—'); m[k] = (m[k] || 0) + 1; }
      return Object.entries(m).map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count);
    };

    app.get('/api/hr/reports', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const now = new Date();
        const type = String(req.query.type || 'summary');
        const year = Number(req.query.year) || now.getFullYear();
        const month = Number(req.query.month) || (now.getMonth() + 1);
        const emps = (await q(`SELECT * FROM hr_employees ORDER BY id ASC`)).map(shapeEmployee);
        const active = emps.filter((e) => e.status === 'Active');

        if (type === 'summary') {
          const todayIso = isoDate(now);
          const [pendingLeave, todayAtt, todayLeave, runs] = await Promise.all([
            q(`SELECT COUNT(*) AS cnt FROM leaves WHERE status IN ('pending','Pending')`).catch(() => [{ cnt: 0 }]),
            q(`SELECT status, COUNT(*) AS cnt FROM hr_attendance WHERE att_date = $1 GROUP BY status`, [todayIso]).catch(() => []),
            // Who is away right now. Attendance is marked at the end of the day
            // (often not at all), so on most mornings the card above is empty
            // while the leave register already knows exactly who is out — which
            // is the one thing anyone opening this page before lunch wants.
            // Approved only: a request nobody has decided on is not an absence.
            // $1/$2 are the same date; the MySQL translator maps $N positionally
            // so a repeated placeholder would lose a parameter.
            q(`SELECT COALESCE(e.name, l.user_name) AS name, l.leave_type, l.half_day, l.backup_name
                 FROM leaves l LEFT JOIN hr_employees e ON e.id = l.employee_id
                WHERE LOWER(l.status) = 'approved' AND l.from_date <= $1 AND l.to_date >= $2
                ORDER BY name ASC`, [todayIso, todayIso]).catch(() => []),
            q(`SELECT * FROM hr_payroll_runs ORDER BY year DESC, month DESC LIMIT 1`).catch(() => []),
          ]);
          const tenures = active.map((e) => yearsSince(e.doj)).filter((v) => v != null);
          return res.json({
            title: 'HR Overview',
            summary: {
              'Total Employees': emps.length,
              'Active': active.length,
              'Inactive': emps.length - active.length,
              'Departments': new Set(active.map((e) => e.department).filter(Boolean)).size,
              'Average Tenure': tenures.length ? (Math.round((tenures.reduce((a, b) => a + b, 0) / tenures.length) * 10) / 10) + ' yrs' : '—',
              'Pending Leave Requests': Number(pendingLeave[0]?.cnt || 0),
              'Last Payroll': runs[0] ? `${MONTHS[runs[0].month - 1]} ${runs[0].year} (${runs[0].status})` : 'Not run yet',
            },
            byDepartment: groupCount(active, 'department'),
            byBranch: groupCount(active, 'branch'),
            byGender: groupCount(active, 'gender'),
            byDesignation: groupCount(active, 'designation').slice(0, 12),
            todayAttendance: todayAtt.map((r) => ({ name: r.status, count: Number(r.cnt) })),
            todayLeave: todayLeave.map((r) => ({
              name: r.name || '—',
              type: r.leave_type || 'CL',
              half: String(r.half_day || 'full') !== 'full',
              backup: r.backup_name || '',
            })),
          });
        }

        if (type === 'headcount') {
          return res.json({
            title: 'Headcount Register',
            summary: { 'Active': active.length, 'Inactive': emps.length - active.length, 'Total': emps.length },
            columns: ['Code', 'Name', 'Designation', 'Department', 'Branch', 'Date of Joining', 'Tenure (yrs)', 'Status'],
            rows: emps.map((e) => [e.id, e.name, e.designation, e.department, e.branch, e.doj || '—', yearsSince(e.doj) ?? '—', e.status]),
          });
        }

        if (type === 'attrition') {
          const joiners = emps.filter((e) => e.doj && e.doj.slice(0, 4) === String(year));
          const leavers = emps.filter((e) => e.dol && e.dol.slice(0, 4) === String(year));
          // Attrition against the average of opening and closing headcount —
          // the standard denominator, and the one that does not flatter a year
          // in which the company grew.
          const opening = emps.filter((e) => e.doj && e.doj < `${year}-01-01` && (!e.dol || e.dol >= `${year}-01-01`)).length;
          const closing = emps.filter((e) => e.doj && e.doj <= `${year}-12-31` && (!e.dol || e.dol > `${year}-12-31`)).length;
          const avg = (opening + closing) / 2;
          const byMonth = MONTHS.map((m, i) => ({
            name: m,
            joined: joiners.filter((e) => Number(e.doj.slice(5, 7)) === i + 1).length,
            left: leavers.filter((e) => Number(e.dol.slice(5, 7)) === i + 1).length,
          }));
          return res.json({
            title: `Joiners & Leavers — ${year}`,
            summary: {
              'Opening Headcount': opening, 'Joined': joiners.length, 'Left': leavers.length,
              'Closing Headcount': closing,
              'Attrition Rate': avg ? (Math.round((leavers.length / avg) * 1000) / 10) + '%' : '—',
            },
            chart: byMonth,
            columns: ['Code', 'Name', 'Department', 'Joined', 'Left', 'Tenure at exit (yrs)'],
            rows: [...joiners, ...leavers].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)
              .map((e) => [e.id, e.name, e.department, e.doj || '—', e.dol || '—',
                e.dol && e.doj ? Math.round(((new Date(e.dol) - new Date(e.doj)) / (365.25 * 864e5)) * 10) / 10 : '—']),
          });
        }

        if (type === 'attendance') {
          const mdays = daysInMonth(year, month);
          const from = `${year}-${pad(month, 2)}-01`;
          const to = `${year}-${pad(month, 2)}-${pad(mdays, 2)}`;
          const att = await q(`SELECT * FROM hr_attendance WHERE att_date BETWEEN $1 AND $2`, [from, to]);
          const byEmp = {};
          for (const a of att) {
            const t = (byEmp[a.employee_id] ||= { present: 0, absent: 0, half: 0, remote: 0, late: 0, hours: 0 });
            if (a.status === 'Present') t.present += 1;
            else if (a.status === 'Absent') t.absent += 1;
            else if (a.status === 'Half Day') t.half += 1;
            else if (a.status === 'Remote') t.remote += 1;
            if (a.late_mark) t.late += 1;
            t.hours += num(a.working_hours);
          }
          const rows = active.map((e) => {
            const t = byEmp[e.id] || { present: 0, absent: 0, half: 0, remote: 0, late: 0, hours: 0 };
            return [e.id, e.name, e.department, t.present, t.remote, t.half, t.absent, t.late, Math.round(t.hours * 10) / 10];
          });
          return res.json({
            title: `Attendance Summary — ${MONTHS[month - 1]} ${year}`,
            summary: {
              'Employees': active.length, 'Days in Month': mdays,
              'Marked Days': att.length,
              'Late Marks': att.filter((a) => a.late_mark).length,
              'Absent Days': att.filter((a) => a.status === 'Absent').length,
            },
            columns: ['Code', 'Name', 'Department', 'Present', 'Remote', 'Half Day', 'Absent', 'Late Marks', 'Hours'],
            rows,
          });
        }

        if (type === 'salary-register') {
          const slips = await q(
            `SELECT * FROM hr_payslips WHERE year = $1 AND month = $2 ORDER BY employee_id ASC`, [year, month]);
          const sum = (k) => money(slips.reduce((t, s) => t + num(s[k]), 0));
          return res.json({
            title: `Salary Register — ${MONTHS[month - 1]} ${year}`,
            summary: {
              'Employees': slips.length,
              'Total Gross': inr(sum('total_gross')),
              'Total Deductions': inr(sum('total_deductions')),
              'Loss of Pay': inr(sum('leave_deduction')),
              'Net Payable': inr(sum('net_salary')),
            },
            columns: ['Slip No', 'Code', 'Name', 'Department', ...EARNINGS.map((e) => e.label), 'Gross',
              ...DEDUCTIONS.map((d) => d.label), 'Deductions', 'LOP Days', 'LOP Amount', 'Net Salary'],
            rows: slips.map((s) => [s.id, s.employee_id, s.employee_name, s.department,
              ...EARNINGS.map((e) => inr(s[e.key])), inr(s.total_gross),
              ...DEDUCTIONS.map((d) => inr(s[d.key])), inr(s.total_deductions),
              num(s.lop_days), inr(s.leave_deduction), inr(s.net_salary)]),
          });
        }

        if (type === 'leave') {
          const types = await leaveTypes();
          const balances = await q(`SELECT * FROM hr_leave_balances WHERE year = $1`, [year]).catch(() => []);
          const taken = await q(
            `SELECT employee_id, leave_type, SUM(total_days) AS days FROM leaves
              WHERE status = 'Approved' AND employee_id IS NOT NULL AND from_date BETWEEN $1 AND $2
              GROUP BY employee_id, leave_type`, [`${year}-01-01`, `${year}-12-31`]).catch(() => []);
          const balByKey = {}; for (const b of balances) balByKey[b.employee_id + '|' + b.type_code] = b;
          const takenByKey = {}; for (const t of taken) takenByKey[t.employee_id + '|' + t.leave_type] = num(t.days);
          return res.json({
            title: `Leave Register — ${year}`,
            summary: {
              'Employees': active.length,
              'Leave Days Taken': money(taken.reduce((t, r) => t + num(r.days), 0)),
              'Requests Approved': taken.length,
            },
            columns: ['Code', 'Name', 'Department',
              ...types.flatMap((t) => [`${t.code} Entitled`, `${t.code} Taken`, `${t.code} Balance`])],
            rows: active.map((e) => [e.id, e.name, e.department,
              ...types.flatMap((t) => {
                const b = balByKey[e.id + '|' + t.code] || { opening: 0, accrued: num(t.annual_quota), used: 0 };
                return [money(num(b.opening) + num(b.accrued)), takenByKey[e.id + '|' + t.code] || 0, balanceOf(b)];
              })]),
          });
        }

        if (type === 'celebrations') {
          // Birthdays and work anniversaries falling in the chosen month — the
          // sheet kept a whole tab of formulas for this; here it is a filter.
          const mm = pad(month, 2);
          const bd = active.filter((e) => e.dob && e.dob.slice(5, 7) === mm)
            .sort((a, b) => a.dob.slice(8) .localeCompare(b.dob.slice(8)));
          const wa = active.filter((e) => e.doj && e.doj.slice(5, 7) === mm)
            .sort((a, b) => a.doj.slice(8).localeCompare(b.doj.slice(8)));
          return res.json({
            title: `Birthdays & Work Anniversaries — ${MONTHS[month - 1]}`,
            summary: { 'Birthdays': bd.length, 'Work Anniversaries': wa.length },
            columns: ['Occasion', 'Date', 'Code', 'Name', 'Designation', 'Department', 'Years'],
            rows: [
              ...bd.map((e) => ['Birthday', e.dob.slice(8) + ' ' + MONTHS[month - 1].slice(0, 3), e.id, e.name, e.designation, e.department, yearsSince(e.dob) ? Math.floor(yearsSince(e.dob)) : '—']),
              ...wa.map((e) => ['Work Anniversary', e.doj.slice(8) + ' ' + MONTHS[month - 1].slice(0, 3), e.id, e.name, e.designation, e.department, yearsSince(e.doj) ? Math.floor(yearsSince(e.doj)) : '—']),
            ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
          });
        }

        if (type === 'statutory') {
          const slips = await q(`SELECT * FROM hr_payslips WHERE year = $1 AND month = $2 ORDER BY employee_id`, [year, month]);
          const sum = (k) => money(slips.reduce((t, s) => t + num(s[k]), 0));
          return res.json({
            title: `Statutory Deductions — ${MONTHS[month - 1]} ${year}`,
            summary: { 'PF': inr(sum('pf')), 'ESIC': inr(sum('esic')), 'Professional Tax': inr(sum('pt')), 'TDS': inr(sum('tds')) },
            columns: ['Code', 'Name', 'UAN', 'Gross', 'PF', 'ESIC', 'PT', 'TDS', 'Total'],
            rows: await Promise.all(slips.map(async (s) => {
              const e = emps.find((x) => x.id === s.employee_id) || {};
              return [s.employee_id, s.employee_name, e.uan || '—', inr(s.total_gross),
                inr(s.pf), inr(s.esic), inr(s.pt), inr(s.tds),
                inr(num(s.pf) + num(s.esic) + num(s.pt) + num(s.tds))];
            })),
          });
        }

        res.status(400).json({ error: 'Unknown report type: ' + type });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // The reporting tree, straight off hr_employees.reporting_to — the sheet
    // maintained a separate OrganizationChart tab that could and did drift
    // from the master, so this is derived rather than stored.
    //
    // Half the company's reporting lines end at a director or business manager
    // who has a login but was never given an employee record — they draw no
    // salary here, so there is nothing for hr_employees to hold. Resolving a
    // manager against `users` as well means those people appear as the branch
    // they actually are, instead of every one of their reports being stranded
    // at the top of the tree as its own root.
    app.get('/api/hr/org-chart', requireAuth, hrReady, async (req, res) => {
      try {
        const [emps, logins] = await Promise.all([
          q(`SELECT id, name, designation, department, branch, reporting_to, avatar_url
               FROM hr_employees WHERE status = 'Active' ORDER BY name ASC`),
          q(`SELECT id, name, email, department FROM users WHERE active = 1`).catch(() => []),
        ]);

        const byId = new Map(emps.map((e) => [e.id, { ...e, reports: [] }]));
        const byName = new Map(emps.map((e) => [String(e.name).trim().toLowerCase(), e.id]));

        // Managers who exist only as a login. Keyed 'user:<id>' so a synthetic
        // node can never collide with a real employee code.
        const loginByName = new Map(logins.map((u) => [String(u.name || '').trim().toLowerCase(), u]));
        const managerNode = (key) => {
          const u = loginByName.get(key);
          if (!u) return null;
          const nid = 'user:' + u.id;
          if (!byId.has(nid)) {
            byId.set(nid, {
              id: nid, name: u.name, designation: u.department || 'Management',
              department: u.department || '', branch: '', reporting_to: '',
              avatar_url: '', loginOnly: true, email: u.email || '', reports: [],
            });
          }
          return nid;
        };

        for (const e of emps) {
          const node = byId.get(e.id);
          // reporting_to holds a code on records this app created and a plain
          // name on the ones imported from the sheet; accept either.
          const key = String(e.reporting_to || '').trim();
          const lower = key.toLowerCase();
          const parentId = byId.has(key) ? key : (byName.get(lower) || managerNode(lower));
          if (parentId && parentId !== e.id && byId.has(parentId)) byId.get(parentId).reports.push(node);
          else node.orphan = true;
        }

        // Roots are whatever nothing else claims. Walking down from them and
        // promoting anything the walk never reaches keeps a mistyped pair of
        // mutual managers (A reports to B, B reports to A) visible as two
        // branches instead of silently dropping both from the page.
        const roots = [...byId.values()].filter((n) => n.orphan || n.loginOnly);
        const seen = new Set();
        const walk = (n) => { if (seen.has(n.id)) return; seen.add(n.id); n.reports.forEach(walk); };
        roots.forEach(walk);
        for (const n of byId.values()) if (!seen.has(n.id)) { n.cycle = true; roots.push(n); walk(n); }

        const byDepth = (a, b) => (b.reports.length - a.reports.length)
          || String(a.name || '').localeCompare(String(b.name || ''));
        const sortTree = (n) => { n.reports.sort(byDepth); n.reports.forEach(sortTree); };
        roots.sort(byDepth); roots.forEach(sortTree);

        // The company name crowns the chart, so the page does not have to
        // hard-code what the business is called.
        const company = (await getSettings().catch(() => ({})))?.hr_company_name || 'Company';
        res.json({ company, roots, total: emps.length, managers: roots.filter((r) => r.loginOnly).length });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }

  /* ===================================================================
     Settings, user linking, and the one-time import from the old sheet
     =================================================================== */
  function mountAdminRoutes() {

    /* ── Policies ── read by every employee, edited by Admin. ── */
    app.get('/api/hr/policies', requireAuth, hrReady, async (req, res) => {
      try {
        res.json(await q(`SELECT id, title, body, sort_order, updated_by, updated_at
                            FROM hr_policies ORDER BY sort_order ASC, title ASC`));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/policies', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id is required' });
        const r = await pool.query(
          `UPDATE hr_policies SET title = COALESCE($1, title), body = COALESCE($2, body),
                  updated_by = $3, updated_at = NOW() WHERE id = $4`,
          [b.title ?? null, b.body ?? null, req.session?.user?.name || '', id],
        );
        if (!r.rowCount) return res.status(404).json({ error: 'No such policy' });
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/hr/settings', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try { res.json(await getSettings()); }
      catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/hr/settings', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        for (const k of Object.keys(HR_DEFAULTS)) {
          if (k in b) await setSetting(k, b[k]);
        }
        res.json({ success: true, settings: await getSettings() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* Ties employee records to login accounts by email, so punching in, "my
       payslips" and "my leave" find the right person. Only fills blanks — a
       link HR set by hand is never overwritten by a guess. */
    app.post('/api/hr/link-users', requireAuth, requireAdmin, hrReady, async (req, res) => {
      try {
        const [emps, users] = await Promise.all([
          q(`SELECT id, name, email, user_id FROM hr_employees`),
          q(`SELECT id, name, email FROM users`),
        ]);
        const byEmail = new Map();
        const byName = new Map();
        for (const u of users) {
          if (u.email) byEmail.set(String(u.email).trim().toLowerCase(), u.id);
          if (u.name) byName.set(String(u.name).trim().toLowerCase(), u.id);
        }
        let linked = 0;
        const unmatched = [];
        for (const e of emps) {
          if (e.user_id) continue;
          const uid = byEmail.get(String(e.email || '').trim().toLowerCase())
                   || byName.get(String(e.name || '').trim().toLowerCase());
          if (!uid) { unmatched.push(`${e.id} — ${e.name}`); continue; }
          await pool.query(`UPDATE hr_employees SET user_id = $1 WHERE id = $2`, [uid, e.id]);
          linked += 1;
        }
        res.json({ success: true, linked, unmatched });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /* ── Import from the old HRMS spreadsheet ─────────────────────────
       Owner-only and idempotent: every write is an upsert keyed on the id
       the sheet already carries (MUM014, SAL-2026-04-009, HOL001), so
       running it twice changes nothing and running it after a month of live
       use only tops up what is genuinely new. `dryRun` reports what it would
       do without touching a row. ─────────────────────────────────────── */
    app.post('/api/hr/import-sheet', requireAuth, requireSuperAdmin, hrReady, async (req, res) => {
      try {
        const b = req.body || {};
        const settings = await getSettings();
        const sheetId = String(b.sheetId || settings.hr_sheet_id || '').trim();
        if (!sheetId) return res.status(400).json({ error: 'No HRMS sheet id configured' });
        /* Auth comes from the host's getGoogleAuth(), never from a second copy
           built here. That helper exists because a PEM private key does not
           survive a hosting panel's environment editor intact — surrounding
           quotes get kept, CRLF sneaks in, only some escaped "\n" sequences
           become real newlines, and long values get truncated outright — so
           production sets GOOGLE_PRIVATE_KEY_B64 instead and the helper
           decodes that first. This route originally read GOOGLE_PRIVATE_KEY
           directly and did the one naive \n replacement, which works on a
           developer's machine and fails on the server with OpenSSL's
           "error:1E08010C:DECODER routines::unsupported" — a message that
           says nothing about why. Every other Google call in the app already
           goes through the helper; this one now does too. */
        const dryRun = !!b.dryRun;
        const auth = ctx.getGoogleAuth ? ctx.getGoogleAuth() : null;
        if (!auth) {
          return res.status(400).json({
            error: 'Google service account is not configured on the server — set GOOGLE_SERVICE_ACCOUNT_EMAIL and '
                 + 'GOOGLE_PRIVATE_KEY_B64 (or GOOGLE_PRIVATE_KEY) in the environment.',
          });
        }
        const { google } = require('googleapis');
        const sheets = google.sheets({ version: 'v4', auth });

        const TABS = ['EmployeeDetails', 'Directors Salary Details', 'HolidayList', 'Leave', 'Attendance', 'Salary'];
        let batch;
        try {
          batch = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: sheetId,
            ranges: TABS.map((t) => `'${t}'!A1:BD2000`),
            valueRenderOption: 'FORMATTED_VALUE',
          });
        } catch (err) {
          /* Google's own wording is no help to whoever is standing at this
             button, so the three failures that actually happen are named.
             The quota one matters most: it reads like a hard failure but is
             a per-minute cap that clears on its own — and pressing the button
             again immediately is exactly what makes it worse. */
          const raw = err.message || '';
          let msg = raw;
          if (/permission/i.test(raw)) {
            msg = `The sheet is not shared with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} — give that address Viewer access, then try again.`;
          } else if (/quota|rate limit|too many requests|\b429\b/i.test(raw)) {
            msg = 'Google\'s per-minute read limit for this project has been reached. Nothing was written. '
                + 'Wait about a minute and press Preview again — pressing it repeatedly keeps the limit used up.';
          } else if (/not found|requested entity was not found/i.test(raw)) {
            msg = 'No spreadsheet with that id — check the HRMS sheet id in HR settings, or paste the id above.';
          }
          console.error('[hrms] sheet read failed:', raw);
          return res.status(400).json({ error: msg });
        }

        // Sheets come back as arrays of arrays; turn each tab into objects
        // keyed by its own header row so the mapping below reads by column name.
        const tab = {};
        (batch.data.valueRanges || []).forEach((vr, i) => {
          const v = vr.values || [];
          const head = v[0] || [];
          tab[TABS[i]] = v.slice(1).map((r) => Object.fromEntries(head.map((k, n) => [k, r[n] ?? ''])));
        });
        const val = (r, k) => { const s = String(r[k] ?? '').trim(); return s === '#N/A' ? '' : s; };
        const counts = { employees: 0, directors: 0, structures: 0, balances: 0, holidays: 0, leaves: 0, attendance: 0, payslips: 0, skipped: [] };

        /* Employees + their salary structure + their leave balances. The
           sheet carried all three on one very wide row; they land in three
           tables here, which is what makes history and payroll possible. */
        const year = new Date().getFullYear();
        const types = await leaveTypes();
        async function importPerson(r, code, empType, nameKey) {
          const name = val(r, nameKey);
          if (!code || !name) return false;
          const doj = sheetDate(val(r, 'DOJ'), 'dmy');
          const fields = {
            name,
            email: val(r, 'Email ID'), phone: val(r, 'Contact No'),
            designation: val(r, 'Designation'), department: await canonicalDept(val(r, 'Department')),
            branch: val(r, 'Branch') || 'Mumbai',
            doj, dol: sheetDate(val(r, 'DOL'), 'dmy'),
            status: val(r, 'Employee Status') || 'Active',
            emp_type: empType,
            address: val(r, 'Addresses'), blood_group: val(r, 'Blood Group').slice(0, 8),
            gender: val(r, 'Gender'), dob: sheetDate(val(r, 'DOB'), 'dmy'),
            marital_status: val(r, 'Married Status'), experience: val(r, 'Experience'),
            qualification: '', reporting_to: val(r, 'Reporting to'),
            emergency_name: '', emergency_phone: '',
            uan: val(r, 'UAN'), aadhar_no: val(r, 'Aadhar Card No.'), aadhar_url: val(r, 'Aadhar Card (Upload)'),
            pan_no: val(r, 'Pan Card No'), pan_url: val(r, 'Pan Card (Upload)'),
            bank_name: val(r, 'Bank Name'), account_no: val(r, 'Account No'), ifsc: val(r, 'IFSC Code'),
            avatar_url: val(r, 'Avatar URL'), notes: val(r, 'Notes'),
            user_id: null, probation_months: 0, confirmed_on: null,
          };
          if (!dryRun) {
            const keys = Object.keys(fields);
            await pool.query(
              `INSERT INTO hr_employees (id, ${keys.join(', ')})
               VALUES ($1, ${keys.map((_, i) => '$' + (i + 2)).join(', ')})
               ON CONFLICT (id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${keys.length + 2 + i}`).join(', ')}`,
              [code, ...keys.map((k) => fields[k]), ...keys.map((k) => fields[k])],
            );
            // The structure is dated from the joining date where there is one,
            // so a payslip for any past month finds a basis to compute from.
            const structure = {
              basic: money(val(r, 'Basic')), hra: money(val(r, 'HRA')),
              education_allow: money(val(r, 'Education Allowance')),
              conveyance_allow: money(val(r, 'Conveyance Allowance')),
              telephone_allow: money(val(r, 'Telephone Allowance')),
              medical_allow: money(val(r, 'Medical Allowance')),
              special_allow: money(val(r, 'Special Allowance')),
              bonus: money(val(r, 'Bonus')), arrears: money(val(r, 'Arrears')),
              pt: money(val(r, 'Tax Deduction (PT)')), loan: money(val(r, 'Loan Deduction')),
              pf: money(val(r, 'PF')), esic: money(val(r, 'ESIC')), tds: money(val(r, 'TDS')),
            };
            if (Object.values(structure).some((v) => v > 0)) {
              const sKeys = Object.keys(structure);
              await pool.query(
                `INSERT INTO hr_salary_structure (id, employee_id, effective_from, ${sKeys.join(', ')}, remarks, created_by)
                 VALUES ($1,$2,$3,${sKeys.map((_, i) => '$' + (i + 4)).join(', ')},$${sKeys.length + 4},$${sKeys.length + 5})
                 ON CONFLICT (id) DO UPDATE SET ${sKeys.map((k, i) => `${k} = $${sKeys.length + 6 + i}`).join(', ')}`,
                ['SS-IMPORT-' + code, code, doj || '2020-04-01', ...sKeys.map((k) => structure[k]),
                 'Imported from HRMS sheet', 'import', ...sKeys.map((k) => structure[k])],
              );
              counts.structures += 1;
            }
            // "Leave PL 23 / Remaining PL 16" on the sheet is an entitlement
            // and a balance; here that is accrued 23 with 7 already used.
            for (const t of types) {
              const entitled = val(r, `Leave ${t.code}`);
              const remaining = val(r, `Remaining ${t.code}`);
              if (entitled === '' && remaining === '') continue;
              const accrued = entitled === '' ? num(t.annual_quota) : num(entitled);
              const used = remaining === '' ? 0 : Math.max(0, accrued - num(remaining));
              await pool.query(
                `INSERT INTO hr_leave_balances (employee_id, year, type_code, opening, accrued, used)
                 VALUES ($1,$2,$3,0,$4,$5) ON CONFLICT (employee_id, year, type_code) DO UPDATE SET accrued = $6, used = $7`,
                [code, year, t.code, accrued, used, accrued, used],
              );
              counts.balances += 1;
            }
          }
          return true;
        }

        for (const r of (tab['EmployeeDetails'] || [])) {
          const code = val(r, 'Employee ID').toUpperCase();
          if (!code) continue;
          if (await importPerson(r, code, 'Staff', 'Employee Name')) counts.employees += 1;
        }
        // Directors sit on their own tab with no employee code at all, so they
        // are given one (DIR001…) keyed on the order they appear — stable
        // across re-imports because the tab is append-only.
        let d = 0;
        for (const r of (tab['Directors Salary Details'] || [])) {
          const name = val(r, 'Boss');
          if (!name) continue;
          const code = 'DIR' + pad(++d, 3);
          if (await importPerson(r, code, 'Director', 'Boss')) counts.directors += 1;
        }

        for (const r of (tab['HolidayList'] || [])) {
          const id = val(r, 'Holiday ID');
          const date = sheetDate(val(r, 'Date'), 'dmy');
          const name = val(r, 'Title');
          if (!id || !date || !name) continue;
          if (!dryRun) {
            await pool.query(
              `INSERT INTO holidays (id, date, name, type, branch, applies_to, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (id) DO UPDATE SET date = $8, name = $9, type = $10, branch = $11, applies_to = $12, notes = $13`,
              [id, date, name, val(r, 'Type (Public/Company/NonHoliday)') || 'Public',
               val(r, 'Region/Branch') || 'All', val(r, 'Applies To (Dept/All)') || 'All', val(r, 'Notes'),
               date, name, val(r, 'Type (Public/Company/NonHoliday)') || 'Public',
               val(r, 'Region/Branch') || 'All', val(r, 'Applies To (Dept/All)') || 'All', val(r, 'Notes')],
            );
          }
          counts.holidays += 1;
        }

        for (const r of (tab['Leave'] || [])) {
          const sid = val(r, 'Leave ID');
          const from = sheetDate(val(r, 'Start Date'), 'mdy');
          const to = sheetDate(val(r, 'End Date'), 'mdy') || from;
          const empId = val(r, 'Employee ID').toUpperCase();
          if (!sid || !from || !empId) continue;
          const id = 'LVS' + pad(sid, 4);
          if (!dryRun) {
            await pool.query(
              `INSERT INTO leaves (id, user_id, user_name, employee_id, type, leave_type, half_day, total_days,
                                   from_date, to_date, reason, status, approver, approver_email, approver_name,
                                   approver_comments, balance_after)
               VALUES ($1,NULL,$2,$3,'Leave',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               ON CONFLICT (id) DO UPDATE SET leave_type = $16, half_day = $17, total_days = $18,
                 from_date = $19, to_date = $20, status = $21, balance_after = $22`,
              [id, val(r, 'Employee Name'), empId,
               val(r, 'Leave Type') || 'CL', val(r, 'Half Day') || 'full', num(val(r, 'Total Days')),
               from, to, val(r, 'Reason'), val(r, 'Status') || 'Approved',
               val(r, 'Approval Authority') || 'HOD', val(r, 'Approver Email'), val(r, 'Approval Authority'),
               val(r, 'Approver Comments'), val(r, 'Leave Balance After') === '' ? null : num(val(r, 'Leave Balance After')),
               val(r, 'Leave Type') || 'CL', val(r, 'Half Day') || 'full', num(val(r, 'Total Days')),
               from, to, val(r, 'Status') || 'Approved',
               val(r, 'Leave Balance After') === '' ? null : num(val(r, 'Leave Balance After'))],
            );
          }
          counts.leaves += 1;
        }

        for (const r of (tab['Attendance'] || [])) {
          const empId = val(r, 'Employee ID').toUpperCase();
          const date = sheetDate(val(r, 'Date'), 'mdy');
          if (!empId || !date) continue;
          if (!dryRun) {
            await pool.query(
              `INSERT INTO hr_attendance (id, employee_id, att_date, check_in, check_out, in_lat, in_lon,
                                          out_lat, out_lon, device, working_hours, late_mark, status, notes, marked_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'import')
               ON CONFLICT (employee_id, att_date) DO UPDATE SET check_in = $15, check_out = $16,
                 working_hours = $17, late_mark = $18, status = $19`,
              ['ATTIMP' + empId + date.replace(/-/g, ''), empId, date,
               sheetDateTime(val(r, 'CheckIn Time'), 'mdy'), sheetDateTime(val(r, 'CheckOut Time'), 'mdy'),
               val(r, 'CheckIn Lat'), val(r, 'CheckIn Lon'), val(r, 'CheckOut Lat'), val(r, 'CheckOut Lon'),
               val(r, 'Device/IP').slice(0, 250), num(val(r, 'Working Hours')),
               /late/i.test(val(r, 'Late Mark')) ? 1 : 0, val(r, 'Status') || 'Present', val(r, 'Notes'),
               sheetDateTime(val(r, 'CheckIn Time'), 'mdy'), sheetDateTime(val(r, 'CheckOut Time'), 'mdy'),
               num(val(r, 'Working Hours')), /late/i.test(val(r, 'Late Mark')) ? 1 : 0, val(r, 'Status') || 'Present'],
            );
          }
          counts.attendance += 1;
        }

        /* Historic payslips come across as finalised runs — they were paid,
           and nothing about a closed month should be recomputable here. */
        const runsSeen = new Set();
        for (const r of (tab['Salary'] || [])) {
          const id = val(r, 'Salary ID');
          const empId = val(r, 'Employee ID').toUpperCase();
          const month = Number(val(r, 'Month')), yr = Number(val(r, 'Year'));
          if (!id || !empId || !month || !yr) continue;
          const runId = `RUN-${yr}-${pad(month, 2)}`;
          if (!dryRun && !runsSeen.has(runId)) {
            runsSeen.add(runId);
            await pool.query(
              `INSERT INTO hr_payroll_runs (id, month, year, status, generated_by, finalised_at, notes)
               VALUES ($1,$2,$3,'finalised','HRMS sheet import',NOW(),'Imported from the old HRMS spreadsheet')
               ON CONFLICT (year, month) DO NOTHING`,
              [runId, month, yr],
            );
          }
          if (!dryRun) {
            const gross = money(val(r, 'Total Gross'));
            const ded = money(val(r, 'Total Deductions'));
            const lopAmt = money(val(r, 'Leave Deduction Amount'));
            const mdays = daysInMonth(yr, month);
            const lop = money(val(r, 'UL Leave Days'));
            await pool.query(
              `INSERT INTO hr_payslips (id, run_id, employee_id, employee_name, month, year,
                 basic, hra, education_allow, conveyance_allow, telephone_allow, medical_allow, special_allow,
                 bonus, arrears, total_gross, pt, loan, pf, esic, tds, total_deductions,
                 month_days, lop_days, paid_days, leave_deduction, net_salary, note)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
               ON CONFLICT (id) DO UPDATE SET total_gross = $29, total_deductions = $30, net_salary = $31`,
              [id, runId, empId, val(r, 'Employee Name'), month, yr,
               money(val(r, 'Basic')), money(val(r, 'HRA')), money(val(r, 'Education Allowance')),
               money(val(r, 'Conveyance Allowance')), money(val(r, 'Telephone Allowance')),
               money(val(r, 'Medical Allowance')), money(val(r, 'Special Allowance')),
               money(val(r, 'Bonus')), money(val(r, 'Arrears')), gross,
               money(val(r, 'Tax Deduction (PT)')), money(val(r, 'Loan Deduction')), money(val(r, 'PF')),
               money(val(r, 'ESIC')), money(val(r, 'TDS')), ded,
               mdays, lop, money(mdays - lop), lopAmt, money(val(r, 'Final Net Salary')),
               'Imported from the old HRMS spreadsheet',
               gross, ded, money(val(r, 'Final Net Salary'))],
            );
          }
          counts.payslips += 1;
        }

        res.json({ success: true, dryRun, counts });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }
}

/* ── The printable payslip ────────────────────────────────────────────
   One page, no external assets, sized for A4. It opens in a tab and calls
   print() on load, so "download the slip" is the browser's own Save as PDF
   and there is no server-side PDF pipeline to keep alive. ─────────────── */
function payslipHtml(slip, emp, settings) {
  const period = `${MONTHS[slip.month - 1]} ${slip.year}`;
  const earnRows = EARNINGS.filter((e) => num(slip[e.key]) !== 0);
  const dedRows = DEDUCTIONS.filter((d) => num(slip[d.key]) !== 0);
  const lines = Math.max(earnRows.length, dedRows.length, 5);
  const cell = (row, side) => {
    const list = side === 'e' ? earnRows : dedRows;
    const item = list[row];
    if (!item) return '<td></td><td class="amt"></td>';
    return `<td>${esc(item.label)}</td><td class="amt">${inr(slip[item.key])}</td>`;
  };
  const field = (label, value) => `<div class="f"><span>${esc(label)}</span><b>${esc(value || '—')}</b></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Payslip ${esc(slip.id)} — ${esc(slip.employee_name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; background: #f1f5f9; color: #0f172a; }
  .sheet { width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff; padding: 16mm 14mm; }
  h1 { font-size: 17px; margin: 0; letter-spacing: -.01em; }
  .addr { font-size: 10.5px; color: #475569; margin-top: 3px; line-height: 1.45; }
  .title { text-align: center; margin: 18px 0 14px; font-size: 13px; font-weight: 700;
           text-transform: uppercase; letter-spacing: .08em; border-top: 1.5px solid #0f172a;
           border-bottom: 1.5px solid #0f172a; padding: 7px 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin-bottom: 14px; }
  .f { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; padding: 3.5px 0; border-bottom: 1px dotted #cbd5e1; }
  .f span { color: #64748b; }
  .f b { font-weight: 600; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f8fafc; text-align: left; padding: 6px 8px; border: 1px solid #cbd5e1;
       font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #475569; }
  td { padding: 5px 8px; border: 1px solid #e2e8f0; height: 22px; }
  td.amt, th.amt { text-align: right; }
  tfoot td { font-weight: 700; background: #f8fafc; border-color: #cbd5e1; }
  .net { margin-top: 14px; padding: 11px 14px; background: #f0fdf4; border: 1.5px solid #86efac;
         border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
  .net .label { font-size: 12px; font-weight: 700; color: #14532d; }
  .net .value { font-size: 19px; font-weight: 800; color: #14532d; }
  .words { font-size: 10.5px; color: #475569; margin-top: 6px; font-style: italic; }
  .note { margin-top: 10px; font-size: 10px; color: #b45309; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; }
  .sign { text-align: center; }
  .sign .line { border-top: 1px solid #94a3b8; width: 130px; margin-bottom: 4px; }
  .disclaimer { margin-top: 22px; font-size: 9px; color: #94a3b8; text-align: center; }
  .bar { position: fixed; top: 0; left: 0; right: 0; background: #0f172a; color: #fff; padding: 8px 14px;
         font-size: 12px; display: flex; gap: 10px; justify-content: center; align-items: center; }
  .bar button { font: inherit; padding: 4px 14px; border-radius: 6px; border: none; cursor: pointer;
                background: #38bdf8; color: #04263a; font-weight: 700; }
  @media print { .bar { display: none; } body { background: #fff; } .sheet { margin: 0; width: auto; padding: 12mm; } @page { size: A4; margin: 0; } }
</style></head>
<body>
<div class="bar">Press Ctrl+P (or use the button) and choose “Save as PDF”. <button onclick="window.print()">Print / Save PDF</button></div>
<div class="sheet">
  <h1>${esc(settings.hr_company_name)}</h1>
  <div class="addr">${esc(settings.hr_company_address)}${settings.hr_company_phone ? ' &middot; Ph: ' + esc(settings.hr_company_phone) : ''}</div>
  <div class="title">Salary Slip for ${esc(period)}</div>
  <div class="grid">
    ${field('Employee Code', slip.employee_id)}
    ${field('Slip No', slip.id)}
    ${field('Employee Name', slip.employee_name)}
    ${field('Designation', slip.designation || emp.designation)}
    ${field('Department', slip.department || emp.department)}
    ${field('Branch', slip.branch || emp.branch)}
    ${field('Date of Joining', isoDate(emp.doj) || '—')}
    ${field('Bank / A/c No', [emp.bank_name, emp.account_no].filter(Boolean).join(' — '))}
    ${field('PAN', emp.pan_no)}
    ${field('UAN', emp.uan)}
    ${field('Days in Month', slip.month_days)}
    ${field('Paid Days', `${num(slip.paid_days)}${num(slip.lop_days) ? ` (LOP ${num(slip.lop_days)})` : ''}`)}
  </div>
  <table>
    <thead><tr>
      <th style="width:32%">Earnings</th><th class="amt" style="width:18%">Amount (₹)</th>
      <th style="width:32%">Deductions</th><th class="amt" style="width:18%">Amount (₹)</th>
    </tr></thead>
    <tbody>
      ${Array.from({ length: lines }, (_, i) => `<tr>${cell(i, 'e')}${cell(i, 'd')}</tr>`).join('')}
    </tbody>
    <tfoot>
      <tr><td>Gross Earnings</td><td class="amt">${inr(slip.total_gross)}</td>
          <td>Total Deductions</td><td class="amt">${inr(slip.total_deductions)}</td></tr>
      ${num(slip.leave_deduction) ? `<tr><td>Loss of Pay (${num(slip.lop_days)} day${num(slip.lop_days) === 1 ? '' : 's'})</td>
          <td class="amt">-${inr(slip.leave_deduction)}</td><td></td><td class="amt"></td></tr>` : ''}
    </tfoot>
  </table>
  <div class="net"><div class="label">Net Salary Payable</div><div class="value">₹ ${inr(slip.net_salary)}</div></div>
  <div class="words">Rupees ${esc(rupeesInWords(slip.net_salary))}</div>
  ${slip.note ? `<div class="note">Note: ${esc(slip.note)}</div>` : ''}
  <div class="foot">
    <div>Generated on ${esc(isoDate(slip.generated_at) || isoDate(new Date()))}</div>
    <div class="sign"><div class="line"></div>Authorised Signatory</div>
  </div>
  <div class="disclaimer">This is a computer-generated salary slip and does not require a signature.</div>
</div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });</script>
</body></html>`;
}

module.exports = { HR_SCHEMA, mountHrms, EARNINGS, DEDUCTIONS, ATT_STATUS, MONTHS, suggestStatutory };
