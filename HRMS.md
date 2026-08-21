# HRMS — Human Resource Management System

The company ran its HR on a Google Apps Script bolted onto one spreadsheet,
**HRMS (Final)** (`1jb_mMdzxrH8LRP3bFTCR6MRYnR1fPX3b6uJbOT0_cns`): tabs for
EmployeeDetails, Salary, Leave, Attendance, HolidayList, OrganizationChart and
a dozen more. This module is that system rebuilt inside the ERP.

It keeps the shapes people already know — the same `MUM001` employee codes, the
same `SAL-YYYY-MM-NNN` salary ids, the same earning and deduction heads, the
same PL / CL / SL / EL leave types — so anyone moving off the sheet recognises
every screen.

---

## Where the code lives

| | |
|---|---|
| `backend/hrms.js` | Schema, payroll engine, every `/api/hr/*` route, the printable payslip. One CommonJS module; `server.js` spreads its `HR_SCHEMA` into its own schema array and calls `mountHrms(app, …)` with its pool and guards, so there is one database connection and one definition of "Admin" in the app. |
| `public/js/pages/hr-common.js` | The shared table / modal / field / stat builders the five HR pages are built from. Must load before them. |
| `public/js/pages/hr-employees.js` | Employee Master and the 360° employee record. |
| `public/js/pages/hr-attendance.js` | Punch card, muster roll, marking a day. |
| `public/js/pages/hr-leave.js` | Requests, approvals, balances, holiday calendar, leave types. |
| `public/js/pages/hr-payroll.js` | Monthly runs, payslips, bank sheet. |
| `public/js/pages/hr-reports.js` | HR MIS. |

SQL is written Postgres-style (`$1`, `ON CONFLICT`) like the rest of
`server.js`; the host's `pgToMysql()` translates it for the live MariaDB.

---

## The five screens

**Employee Master** — everyone on the rolls. Deliberately separate from Users
(the login list): most of the factory staff have no login, and one shared
department mailbox can sit behind several logins. An employee record optionally
links to a user account (`hr_employees.user_id`, or the **Link Logins** button,
which matches on email then name and only ever fills blanks).

Opening a person gives seven tabs: Overview, Salary, Leave, Payslips,
Documents, Joining, Exit.

**Attendance** — three views of one `hr_attendance` row per employee per day.
*My Attendance* is the punch card (location captured the way the old Apps
Script did, but never a gate — a refused or missing GPS fix still lets the
punch through). *Muster Roll* is the month as a grid; leave, holidays and
week-offs are filled in by the server on read, so HR only marks the exceptions,
and a leave approved after the fact still shows correctly. *Mark a Day* is the
whole team for one date in a single pass.

**Leave Management** — typed, balanced, approved against those balances. It
writes to the same `leaves` table the older Leave Tracker page uses (extended,
not replaced), so both screens show one truth.

**Payroll** — a month is a run; a run holds one frozen payslip per employee.
The working order is: pick the month → read the preview (computed live, nothing
written) → finish marking attendance → **Generate** → check the register →
**Finalise**. Staff can only see their own slips once a month is finalised, and
only the owner account can reopen one.

**HR Reports** — Overview, Headcount, Joiners & Leavers, Attendance Summary,
Leave Register, Salary Register, Statutory Deductions, Birthdays &
Anniversaries. Every report comes back in one `{ title, summary, columns, rows }`
shape, so a new report is a case in one switch rather than a new page.

---

## How payroll computes a month

Verified against the company's own April 2026 payslips from the old sheet —
MUM008 comes out at ₹38,100 net on the rupee.

```
gross            = Basic + HRA + Education + Conveyance + Telephone
                   + Medical + Special + Bonus + Arrears
total_deductions = PT + Loan + PF + ESIC + TDS
leave_deduction  = gross ÷ days_in_month × lop_days
net_salary       = gross − total_deductions − leave_deduction
```

**Loss-of-pay days** are collected as a *set of dates*, not a running total,
because the reasons overlap: unpaid (`LWP`) leave, an `Absent` day with no leave
behind it, and any part of the month outside the person's employment. An unpaid
leave day that HR also marked Absent is one lost day, not two — a naive sum
would dock the salary twice. Half days are the one thing that cannot collide,
so they add separately.

**Present days** count only days actually worked (Present, Remote, and half of a
Half Day). Leave, holidays and week-offs are paid but not worked, and are
reported on their own lines.

**Salary structures are effective-dated.** A revision writes a new
`hr_salary_structure` row rather than editing the old one, so a payslip already
issued keeps its basis — and "Joining Salary / Current Salary / Last Increment",
three columns the sheet maintained by hand, all fall out of the history. A
payslip reads the row in force on the last day of its month.

**Professional tax** is bumped to ₹300 in February (Maharashtra) — but only when
the stored figure is the standard ₹200 slab. A figure HR has overridden is left
exactly as they set it.

**PF / ESIC / PT suggestions** (the button on the salary form) are advisory
only: 12% of Basic capped at the ₹15,000 wage ceiling, 0.75% ESIC under ₹21,000
gross, the Maharashtra PT slab. The company's own numbers already deviate — a
flat ₹1,800 PF regardless of Basic — which is exactly why these stay suggestions
and the stored figure is always what HR typed.

---

## Leave balances

`balance = opening + accrued − used`, per employee per year per type.

`used` moves **only** on approval, and moves back if an approval is reversed.
That arithmetic lives in one function, `applyLeaveDecision()` — the older Leave
Tracker's own `PATCH /api/leaves` route delegates to it too, so whichever screen
a leave is approved on, the balance moves the same way.

An exhausted balance produces a **warning, not a block**: a genuine emergency
should not be stopped by a counter, and payroll turns the excess into loss of
pay.

Day counting follows the sheet's own practice — plain calendar days, so 1–10
April is 10 days even with two Sundays in it. Turning on
`hr_leave_exclude_holidays` in HR settings switches to the fairer count that
skips week-offs and the holiday calendar.

Defaults, taken from every row of the sheet's EmployeeDetails tab: PL 23 (carries
forward, capped at 30), CL 5, SL 7, EL 0, LWP 0 and unpaid.

---

## Importing the old sheet

**Employee Master → Import from Sheet** (owner account only). Previews first,
then writes.

It brings across employees, directors, salary structures, leave balances, leave
requests, attendance, the holiday calendar and past payslips. Every row is
matched on the id the sheet already carries (`MUM014`, `SAL-2026-04-009`,
`HOL001`), so **running it twice changes nothing** and running it a month later
only brings across what is new. Historic payslips arrive as *finalised* runs —
they were paid, and nothing about a closed month should be recomputable.

The sheet must be shared (Viewer is enough) with the service account in
`.env.local`: `akhileshvyas@reactwebappav.iam.gserviceaccount.com`. If it is
not, the import says so by name rather than failing vaguely.

Directors sit on their own tab with no employee code, so they are given one
(`DIR001`…) from the order they appear.

---

## Who can see what

Enforced server-side, not by hiding buttons.

| | Employee | Admin / HOD | Owner |
|---|---|---|---|
| Own punch card, own payslips, holiday calendar | ✓ | ✓ | ✓ |
| Own leave requests and balances | ✓ | ✓ | ✓ |
| Own employee record | ✓ | ✓ | ✓ |
| Everyone's leave, balances, muster roll, reports | | ✓ | ✓ |
| Employee list (bank accounts, PAN, Aadhar) | | ✓ | ✓ |
| Salary structures, payroll, bank sheet | | ✓ | ✓ |
| Reopen a finalised month, delete an employee, import the sheet | | | ✓ |

A leave applied for on someone else's behalf is booked against the applicant
unless the applicant is Admin/HOD — HR can raise one for the factory floor,
nobody else can raise one for anybody.

Page-level access is also grantable per user from **Users → Access**
(`hr-employees`, `hr-attendance`, `hr-leave`, `hr-payroll`, `hr-reports`).

---

## Settings

Stored in the existing `app_config` table under an `hr_` prefix, so one settings
store and one backup covers them. Defaults are the company's own — a 09:00–18:00
day and Lallubhai Amichand's registered address, both taken from the sheet's
Settings tab.

`hr_shift_start`, `hr_shift_end`, `hr_grace_minutes`, `hr_week_off`,
`hr_leave_exclude_holidays`, `hr_company_name`, `hr_company_address`,
`hr_company_phone`, `hr_pt_february_extra`, `hr_sheet_id`.

---

## Payslips

`GET /api/hr/payslip/:id/print` renders a self-contained A4 page that calls
`print()` on load — "download the slip" is the browser's own *Save as PDF*.
No Drive round-trip, so it works on a bad line and leaves no copy of anybody's
pay sitting in cloud storage. Amounts print in Indian grouping with the net in
words.

---

## Not carried over from the sheet

These tabs exist in **HRMS (Final)** but have no screen here yet — say the word
and they are straightforward additions on the same foundations:

- **Assets** and **Assets Repair** (93 rows) — asset register and assignment
- **Timesheets** — project/task time logging
- **Work Anniversary** — a whole tab of formulas, now just a filter in the
  Birthdays & Anniversaries report
- **OrganizationChart** — the data is served at `/api/hr/org-chart`, derived
  from `hr_employees.reporting_to` rather than a separate table that could drift
  from the master, but nothing draws the tree yet
- **AuditLogs**, **Notifications**, **Tickets** — the ERP already has its own
  Help Ticket and Announcements modules

The old **Leave Tracker** page (under Basic) is still in the sidebar alongside
the new **Leave Management**. Both write to the same table and approvals agree,
but the two entries are redundant — worth retiring the old one once staff have
moved across.
