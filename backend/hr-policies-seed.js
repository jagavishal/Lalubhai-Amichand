'use strict';
/* =====================================================================
   The three HR policy documents, seeded once into hr_policies.
   ---------------------------------------------------------------------
   Text lives here rather than inline in hrms.js because each policy is a
   page long and hrms.js is already the largest module in the app. Seeded
   with ON CONFLICT DO NOTHING, so an Admin's edits from the HR Policies
   page are never overwritten by a deploy — this file is the starting
   text, the database is the truth.

   Body is a restricted markdown: `## ` headings, `- ` bullets, `**bold**`
   and blank-line paragraphs. hr-policies.js renders exactly that and
   nothing more, so the page never has to trust rich HTML from anywhere.
   ===================================================================== */

const POLICIES = [
  {
    id: 'employee-policy',
    title: 'Employee Policy',
    sort_order: 1,
    body: `## Purpose

This policy sets out the terms of employment and the standards of conduct expected of every employee of Lallubhai Amichand Limited ("the Company"). It applies to all employees at every branch and site, permanent or on probation, unless a written contract states otherwise.

## Working Hours & Attendance

- Office hours are 9:00 AM to 6:00 PM, Monday to Saturday, with Sunday as the weekly off. Site and branch timings may differ where notified.
- Attendance must be marked daily through the ERP. Arrival after the grace period is recorded as a late mark; repeated late marks may be treated as a half day as per the attendance rules in force.
- Absence without approved leave or prior intimation is treated as leave without pay, and repeated instances invite disciplinary action.

## Code of Conduct

- Employees shall deal honestly and courteously with colleagues, customers, vendors and visitors alike.
- Company property — equipment, vehicles, stock, systems and data — is to be used for Company work only and with due care.
- Information about the Company's business, prices, customers, suppliers and employees is confidential. It must not be shared outside the Company, during or after employment, except where the work itself requires it.
- No employee may accept money, gifts of more than token value, or favours from any party dealing with the Company.
- Consumption of alcohol or intoxicants during work, and reporting for work under their influence, is prohibited.

## Employment Records

- Employees must keep their personal details — address, contact number, bank account, nominee — up to date with HR, and inform HR of any change within 7 days.
- Original certificates submitted for verification are returned after verification; the Company retains copies only.

## Separation

- Resignation must be given in writing. The notice period is 30 days unless the appointment letter provides otherwise; the Company may waive or adjust it at its discretion.
- Full and final settlement, including leave encashment where applicable, is processed with the next payroll cycle after the last working day, subject to return of all Company property and completion of handover.

## Discipline

Breach of this policy invites action proportionate to the breach — counselling, written warning, suspension, or termination in serious cases. Serious misconduct (theft, fraud, violence, harassment, wilful damage, breach of confidentiality) may lead to termination without notice.

## Interpretation

HR administers this policy. Where anything here conflicts with an individual appointment letter or with applicable law, the appointment letter and the law prevail. The Company may amend this policy from time to time; the version published in the ERP is the version in force.`,
  },
  {
    id: 'leave-policy',
    title: 'Leave Policy',
    sort_order: 2,
    body: `## Purpose

This policy states the kinds of leave available, how they accrue, and how they are applied for and approved. Leave balances, applications and approvals are maintained in the ERP, which is the single record of leave for the Company.

## Leave Types

- **Privilege Leave (PL)** — 23 days a year, credited annually. Unused PL carries forward up to a maximum of 30 days.
- **Casual Leave (CL)** — 5 days a year, for short personal needs. CL does not carry forward.
- **Sick Leave (SL)** — 7 days a year. For absence of 3 or more consecutive days, a medical certificate may be asked for. SL does not carry forward.
- **Emergency Leave (EL)** — granted at management's discretion for genuine emergencies.
- **Leave Without Pay (LWP)** — applies when leave is availed beyond the available balance, or when unapproved absence is regularised. LWP days are deducted from salary.

Leave year runs January to December. Employees joining mid-year receive quotas on a proportionate basis.

## Applying for Leave

- Apply through the ERP (Dashboard → Apply Leave, or Leave Management) before the leave, except in emergencies, where the application must follow within 2 working days of resuming.
- Name a backup person in the application — the colleague who covers your work while you are away. This is shown on the dashboard so the office knows whom to approach.
- The application goes to your named approver. The balance moves only when the request is approved; applying does not block the days.
- Leave applied for beyond the available balance is sanctioned, if at all, as leave without pay for the excess days.

## Approval

- The approver decides the request in the ERP or from the request email. The applicant is informed of the decision by email automatically.
- Half days are supported — first half or second half — and count as 0.5 day.
- An approved leave that is no longer needed should be cancelled in the ERP so the days return to balance.

## Holidays & Weekly Offs

The Company's holiday calendar is published in the ERP. Whether holidays and weekly offs falling within a leave spell are counted as leave follows the setting in force in the HR module, applied uniformly to all.

## General

- Leave cannot be claimed as a matter of right on specific dates; sanction depends on work requirements. The Company may recall an employee from sanctioned leave in exigencies.
- Absence without sanctioned leave for 7 consecutive days, without intimation, may be treated as abandonment of employment after due notice.
- On separation, unused PL is dealt with as per the terms of appointment and law; CL and SL lapse.`,
  },
  {
    id: 'posh-policy',
    title: 'POSH Policy — Prevention of Sexual Harassment',
    sort_order: 3,
    body: `## Commitment

Lallubhai Amichand Limited is committed to a workplace free of sexual harassment, in letter and spirit of the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 ("the POSH Act") and the rules under it. Every employee is entitled to be treated with dignity and respect. This policy applies to all employees, at every office, branch, factory and site, and extends to work-related travel, off-site meetings and Company events.

## What Constitutes Sexual Harassment

Sexual harassment includes any one or more of the following unwelcome acts or behaviour, directly or by implication:

- Physical contact and advances;
- A demand or request for sexual favours;
- Making sexually coloured remarks;
- Showing pornography;
- Any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.

The following circumstances, among others, if connected with any act above, also amount to sexual harassment: an implied or explicit promise of preferential treatment; a threat of detrimental treatment; a threat about present or future employment status; interference with work or creating an intimidating, offensive or hostile work environment; humiliating treatment likely to affect health or safety.

## Internal Committee (IC)

- The Company constitutes an Internal Committee as required by the POSH Act, with a woman Presiding Officer, at least half the members women, and an external member from an NGO or association familiar with the issues of sexual harassment. The current names and contact details of the IC members are displayed on the office notice board and available from HR.
- The IC is the body that receives and inquires into complaints under this policy.

## Making a Complaint

- An aggrieved person may make a written complaint to the IC within **3 months** of the incident (or the last incident in a series). The IC may extend this period by a further 3 months for reasons recorded in writing.
- Where the aggrieved person cannot make the complaint themselves, their legal heir, relative, friend or co-worker may do so on their behalf as provided in the rules.
- Complaints may be handed to any IC member or emailed to the IC's notified address. A complaint made in good faith will never be held against the complainant.

## How Complaints Are Handled

- **Conciliation** — before inquiry, and only at the complainant's request, the IC may attempt settlement between the parties. No monetary settlement can be made the basis of conciliation.
- **Inquiry** — the IC completes its inquiry within **90 days**, following the principles of natural justice: both parties are heard, both may produce evidence and witnesses, and neither party's identity is disclosed to anyone not involved in the proceedings.
- **Interim measures** — during inquiry, at the complainant's written request, the IC may recommend transfer of either party, leave of up to 3 months to the aggrieved (over and above her entitlement), or other relief.
- **Report** — the IC gives its report within 10 days of completing the inquiry. Where the complaint is proved, the Company acts on the IC's recommendations within 60 days — action as per service rules, which may include warning, withholding of increment or promotion, transfer, or termination, and deduction/payment of compensation as the Act provides.
- **Malicious complaints** — a complaint proved to be made with malicious intent, or false evidence knowingly given, invites action as per the Act. Inability to prove a complaint is NOT malice.

## Confidentiality

The identity of the complainant, respondent and witnesses, the contents of the complaint, and the proceedings and recommendations of the IC shall not be published or made known to the public, press or media in any manner, as section 16 of the POSH Act requires.

## No Retaliation

Retaliation of any kind against a complainant, witness or IC member — including intimidation, adverse work allocation or exclusion — is itself misconduct and will be dealt with severely.

## Awareness

The Company displays the penal consequences of sexual harassment and the constitution of the IC at conspicuous places, and conducts periodic awareness programmes as the Act requires. Questions about this policy may be raised with HR or any IC member at any time.`,
  },
];

module.exports = { POLICIES };
