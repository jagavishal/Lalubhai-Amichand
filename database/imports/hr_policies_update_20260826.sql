-- =============================================================================
-- Load the company's real policy text into hr_policies.
-- Source: management's Drive folder (Employee Handbook March 2026 + posh_policy).
-- MySQL / MariaDB. Overwrites the standard drafts that were seeded earlier.
-- =============================================================================

UPDATE hr_policies SET title = 'Employee Policy', body = '## Welcome

We are pleased to welcome you to Lallubhai Amichand Ltd. This handbook has been designed to help you understand our workplace culture, policies, and expectations. Please read it carefully and use it as a reference guide during your employment.

## 1. Company Values

At Lallubhai Amichand Ltd., we believe in:

- Integrity and honesty in all actions.
- Respect and fairness towards all.
- Teamwork and collaboration.
- Commitment to quality and customer satisfaction.

## 2. Work Timings

- Office Hours: 9:30 AM to 6:00 PM (Monday to Saturday).
- Weekly Off: 2nd and 4th Saturdays of every month, and all Sundays.
- Lunch break: 1:00 PM to 1:30 PM.
- Employees are expected to be punctual; repeated late-coming will be treated as per attendance rules.

## 3. Attendance & Leave

Attendance and leave are governed by the separate **Leave Policy** — see the Leave Policy section of HR Policies for entitlements, application rules, the sandwich rule and half-day rules.

## 4. Dress Code

- Employees must follow a formal dress code during office hours.
- Casual wear is not permitted on weekdays unless specified by management (e.g., casual Fridays, events).
- Clothes must be neat, clean, and professional.

## 5. Asset Management Policy

- Assets such as laptops, mobiles, tools, uniforms, and ID cards are company property.
- Employees are responsible for proper care and safe usage of assigned assets.
- Damage, theft, or loss must be reported immediately.
- No personal use of company assets without permission.
- All assets must be returned in working condition at the time of resignation/exit.
- Any loss/damage due to negligence may be recovered from the employee.

## 6. Code of Conduct

- Maintain professionalism and respect towards colleagues, clients, and vendors.
- Confidential company information must not be disclosed without authorization.
- Misuse of company property or resources is prohibited.
- Any form of harassment, discrimination, or misconduct will not be tolerated — see the POSH Policy.
- Detailed Code of Conduct as explained by the Management / HR.

## 7. Office Etiquette

- Keep your workspace clean and organized.
- Use office resources (internet, phones, printers) responsibly.
- Avoid loud conversations that may disturb others.

## 8. Communication

- Employees are expected to check and respond to official emails and WhatsApp messages regularly.
- Important communication from management/HR will be shared via email, notice boards or the LAL Internal Website.

## 9. Exit Policy

- Employees resigning must provide notice as per their official appointment letter.
- All company property (laptops, ID cards, documents) must be returned before the last working day.
- Full & Final settlement will be processed as per company policy.

## 10. Disclaimer

This handbook provides general guidelines and may be updated by management as required. Employees will be informed of any changes.', updated_by = 'Drive import', updated_at = NOW() WHERE id = 'employee-policy';

UPDATE hr_policies SET title = 'Leave Policy', body = '## Leave Entitlement

All full-time employees are entitled to the following paid leaves annually. All leave balances reset at the end of the year and cannot be carried forward.

- **Privilege Leave (PL)** — 23 days. Cannot be carried forward.
- **Sick Leave (SL)** — 7 days. Cannot be carried forward.
- **Casual Leave (CL)** — 5 days. Cannot be carried forward.
- **Total Annual Leave** — 35 days (excluding National Holidays).
- **National Holidays** — 9 days, as declared annually.
- **Special Leave (Own Marriage)** — 3 days, once a year.
- **Maternity Leave** — 26 weeks, as per law.

## Leave Rules for the First Six Months of Employment

- **Leave Cap:** If an employee takes 10 days of leave in the first month of the year, only 3 days will be counted as Privilege Leave (PL).
- **Unpaid Balance:** The balance days (7 days in this example) will be counted as Leave Without Pay (LWP).
- **Duration:** This rule applies until the first 6 months of employment are completed.

## General Guidelines and Application

- **Compulsory Monthly Leave:** Employees must take a minimum of 3 days of leave in a calendar month. These days will be deducted from the available PL or CL balance.
- **Notice for Privilege Leave:** A three-week (21 days) advance notice is mandatory for any Privilege Leave (PL) of more than four consecutive days.
- **Gap Between Long PL:** There must be a gap of at least one full calendar month between two separate Privilege Leave (PL) applications of four consecutive days or more.
- **Unapproved Absences:** Any unapproved absence from work will be treated as Leave Without Pay (LWP).
- **Exceptional Cases:** For any exceptional cases, employees should discuss the matter directly with HR or Management.
- All leaves are to be applied through the ERP and put on the Company WhatsApp group.

## Sandwich Leave Policy (Clubbing of Non-Working Days)

Any non-working day (Saturdays, Sundays, or declared holidays) that falls between two or more approved leave days will be counted as part of the leave taken and deducted from the employee''s Privilege Leave (PL) balance.

- **Example 1:** Leave on Friday and Monday — the non-working Saturday and Sunday are counted. Total leave deducted: 4 days (Fri, Sat, Sun, Mon).
- **Example 2:** Leave on Monday with Tuesday a declared holiday — the non-working Saturday and Sunday, the Monday leave, and the Tuesday holiday all count as one continuous leave period. Total leave deducted: 4 days (Sat, Sun, Mon, Tue).

## Attendance and Half Day Rules

- **Half Day Definition:** A half day is counted as four working hours.
- **Late Coming:** If an employee is 15 minutes late on four occasions in a single month, it is treated as a half-day leave for that month. The late-coming count resets the following month.

## Approval Flow (in the ERP)

- Requests go to the employee''s named Leave Approver, who approves or rejects from the email itself or from Leave Management.
- **Accounts team:** up to 2 days is approved within the team; 3 days or more requires both the Senior Accountant''s and Paresh Shah''s approval.
- Name a **Backup Person** in the application — the colleague who covers your work while you are away.

## Operational Constraints on Leave Approval

- **Team Availability:** When approving leave, managers must ensure that at least one person from each team remains available to cover operations.
- **Accounts Team Specific:** For the Accounts team, a minimum of three persons must be available at all times. All available persons must possess full knowledge of the work to be completed during the period.

This policy is designed to be simple, fair, and supportive. For any exceptional cases, please discuss with HR/Management.', updated_by = 'Drive import', updated_at = NOW() WHERE id = 'leave-policy';

UPDATE hr_policies SET title = 'POSH Policy — Prevention of Sexual Harassment', body = 'PREVENTION OF SEXUAL HARASSMENT POLICY

This Prevention of Sexual Harassment Policy ("Policy") is effective from June 1, 2023 ("Effective Date") and applies to Lallubhai Amichand Ltd., its subsidiaries and joint ventures over which the Lallubhai Amichand Ltd. exercises management control ("We", "Us", "Our", "Company").

Company is committed to creating a safe work environment free from any form of sexual harassment and where all employees are treated with dignity and respect.

As per the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 ("Act"/ "POSH Act") and rules thereunder ("Rules"), the Company has framed this Policy and adopted the same. While this Policy covers all the key aspects of the Act, for any further clarification, reference shall always be made to the Act and provisions of the Act shall prevail.

This Policy aims to prohibit, prevent and deter the commission of acts of sexual harassment at the Workplace and provide the procedure for redressal of complaints pertaining to sexual harassment.

The Company is committed to the effective dissemination of this policy. All stakeholders and managers are required to ensure that they and their team are aware of the policy, and applicable laws, and are encouraged to adhere to it.

## 1. Applicability

1.1. This Policy extends to all employees of the Company, including those employed on a regular, temporary, ad-hoc or daily wage basis, either directly or through an agent, including a contractor, for remuneration or not, and those working on a voluntary basis, with or without express or implied terms of employment.

1.2. In addition to the above, this Policy also extends to those who are not employees of the Company who may be affected in the course of any activity related to the work of the Company or carried out within the premises used for the execution of the Company''s work or day-to-day operations.

## 2. Scope

The scope of this policy extends to all Workplaces including all offices, branches, departments, units, and project locations, as well as the external locations used for the purposes of work carried out by the Company.

## 3. Definitions

3.1. "Aggrieved Woman" means in relation to a Workplace a person of any age, whether employed or not, who alleges to have been subject to any act of sexual harassment by the Respondent and includes contractual, temporary employees and visitors.

3.2. "Complainant" means the aggrieved person or a person having knowledge of the incident and having the consent of the aggrieved person to file a complaint or the legal heir of a deceased aggrieved person.

3.3. "District Officer" means the District Magistrate or Additional District Magistrate or the Collector or Deputy Collector as appointed by the appropriate government as a District Officer for every District to exercise powers or discharge functions under the POSH Act.

3.4. "Employee" means a person employed at a Workplace for any work on a regular, temporary, ad hoc or daily wage basis, either directly or through an agent, including a contractor, with or, without the knowledge of the principal Employer, whether for remuneration or not, or working on a voluntary basis or otherwise, whether the terms of employment are express or implied and includes a co-worker, a contract worker, probationer, trainee, apprentice or called by any other such name.

3.5. "Employer" means a person who is responsible for the management, supervision and control of the Company''s work and Workplace.

3.6. "ICC" or "Internal Complaints Committee" means an internal committee constituted as per the Act.

3.7. "Member" means a Member of ICC.

3.8. "Presiding Officer" means the Presiding Officer of the ICC and shall be a senior-level women Employee of the Company.

3.9. "Respondent" means a person against whom a complaint alleging sexual offence has been made.

3.10. "Parties" means collectively the Complainant and the Respondent.

3.11. "Workplace" means establishments, enterprises, institutions, offices, branches, premises, locations or units established, owned controlled by the Company or places visited by the employees out of or during employment including accommodation, transportation provided by the Employer for undertaking such journey.

## 4. Roles And Responsibilities

4.1. All personnel are expected to respect the rights of others and to never encourage any type of harassment.

4.2. All are encouraged to advise others of unwelcome behaviour and deter others from involving any such activities.

4.3. All managers at the Company are required to ensure that nobody is subject to harassment and there is equal treatment at all levels. They also are required to educate the employees about unwelcome behaviours and warn them of the consequences of such actions.

## 5. Sexual Harassment

5.1. Sexual harassment includes any one or more of the following unwelcome acts or behaviour, whether directly or by implication:

5.1.1. physical contact and advances;

5.1.2. a demand or request for sexual favours;

5.1.3. making sexually coloured remarks,

5.1.4. showing pornography; or

5.1.5. any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.

5.2. The following circumstances among other circumstances, if they occur or are present in relation to or connected with any act or behaviour of sexual harassment may amount to sexual harassment:

5.2.1. implied or explicit promise of preferential treatment in employment;

5.2.2. the implied or explicit threat of detrimental treatment in employment;

5.2.3. the implied or explicit threat about the present or future employment status;

5.2.4. interference with work or creating an intimidating or offensive or hostile work environment; or

5.2.5. humiliating treatment likely to affect the lady Employee''s health or safety.

## 6. Internal Complaints Committee

6.1. To prevent instances of sexual harassment and to receive and effectively deal with complaints pertaining to the same an Internal Complaints Committee ("ICC") is constituted at each location the Company has an office or branch with more than 10 (ten) employees.

6.2. Internal Committee shall consist of the following Members as appointed by the management of the Company from time to time:

6.2.1. a Presiding Officer who shall be a woman employed at a senior level at the Workplace from amongst the employees;

6.2.2. not less than two Members from the amongst the employees preferably committed to the cause of women or who have experience in social work or have legal knowledge;

6.2.3. one Member from amongst non-governmental organizations or associations committed to the cause of women or a person familiar with the issues relating to sexual harassment.

6.3. At least one-half of the total Members so nominated shall be women.

6.4. The ICC Members should be sensitive to issues pertaining to gender-based violence and should have good credibility and technical competency to handle grievance procedures.

6.5. The Presiding Officer and every Member of the ICC shall hold for a maximum period of 3 (three) months from the date of their appointment by the management.

6.6. The ICC is responsible for:

6.6.1. receiving complaints of sexual harassment at the Workplace;

6.6.2. initiating the inquiry and procedure as per this Policy;

6.6.3. submitting the report and recommendations to the management;

6.6.4. coordinating with the management in implementing appropriate action;

6.6.5. maintaining strict confidentiality throughout the process as per this Policy; and

6.6.6. submitting annual reports in the prescribed format.

6.7. As per the POSH Act, the ICC shall while inquiring into a complaint of Workplace sexual harassment, have the same powers as vested in a civil court under CPC, 1908 when trying a suit in respect of:

6.7.1. summoning and enforcing the attendance of any person and examining him on oath;

6.7.2. requiring the discovery and production of documents; and

6.7.3. any other matter as reasonably required.

6.8. The ICC Member or Presiding Officer may be removed or replaced in the following event:

6.8.1. contravenes any provision of this Policy;

6.8.2. has been convicted for an offence or an inquiry into an offence under any law for the time being in force is pending against him/her;

6.8.3. has been found guilty in any disciplinary proceedings or disciplinary proceedings pending against him/her; or

6.8.4. has so abused his/her position as to render his/her continuance in office (prejudicial to the public interest, such Presiding Officer or Member as the case may be, shall be removed from the POSH committee.

## 7. Lodging A Complaint

7.1. Any Aggrieved Woman may make, in writing a complaint (6 copies) of sexual harassment at the Workplace to the ICC along with any documentary evidence available, and names of witnesses, within three months from the date of the incident and in case of a series of incidents, within three months from the date of the last incident.

7.2. If the Employee cannot make such a complaint in writing, the Presiding Officer or any Member of ICC would render all reasonable assistance to the woman for making the complaint in writing.

7.3. If the Aggrieved woman fails to submit the complaint within three months from the date of the incident, the ICC may extend the time limit up to three months and in that case, the reason for such extension shall be recorded in writing.

7.4. It is always advised to not delay in filing the complaint if any such untoward incident happens at the Workplace to conduct a thorough investigation and take prompt action.

7.5. Even though there is no exact form of making the complaint, the Complainant is advised to:

7.5.1. to submit the complaint to the ICC Members and not to the Employer or HR representative;

7.5.2. to write the complaint in simple language;

7.5.3. to include details of the exact incident, date and time, witness, etc.;

7.5.4. to include circumstances preceding and following the incident;

7.5.5. include whether the Complainant responded/resisted to the actions of Respondent and details thereto;

7.5.6. submit maximum pieces of evidence supporting the complaint including relevant emails, screenshots of SMS''s, WhatsApp or other social media platforms, call details, photographs, recordings, etc.;

7.5.7. not state any false or incorrect facts; and

7.5.8. state the relief that is sought from the Employer.

7.6. If the Aggrieved Woman is unable to make a complaint on account of her physical or mental incapacity or death or otherwise, her legal heir or such other person as authorized may make a complaint to the ICC.

7.7. The Complaint shall be submitted by the Complainant to the ICC in writing or shall be submitted electronically at the following email: brindakapur@laltd.in. The complaint can also be submitted physically to an ICC Member.

7.8. If the complaint is received by any person other than an ICC Member, upon receiving such a complaint, it is the responsibility of the complaint receiver to report the same to the committee immediately.

7.9. If the complaint is made against a guest or any other person who is not an Employee of the Company, the ICC shall advise the Complainant to file a complaint with the police immediately. The option of whether the complaint should be filed with the police or not is left with the Complainant, but the support of Company in filing the complaint will always be ensured.

7.10. Upon receipt of the complaint, one copy of the complaint shall be sent to the Respondent within 7 (seven) days.

7.11. Upon receipt of the copy of the complaint, the Respondent is required to reply to the complaint along with a list of supporting documents, and names and addresses of witnesses within 10 (ten) working days.

7.12. The ICC maintains a register to endorse the complaint received by it and keeps content highly confidential if it so desires, except to use the same for discreet investigation.

7.13. Upon receiving such a complaint ICC shall act swiftly to find the veracity and take further actions as required.

## 8. Receiving A Complaint

8.1. The recipient of the complaint is required to keep the following points in mind while receiving the complaint:

8.1.1. shall make sure that the complaint has been listened to completely without any prejudice;

8.1.2. inform the Complainant that the proper escalation, investigation and prompt actions will be taken on such complaint; and

8.1.3. if possible, the complaint shall be written down as narrated by the Complainant itself and shall confirm the same upon completion by getting the signature at the end of the sheet.

## 9. Conciliation

9.1. The Aggrieved Woman has the option to opt for conciliation proceedings before initiating an enquiry. Upon receipt of such a request for conciliation, the ICC may take steps to settle the matter between her and the Respondent through conciliation. ICC shall ensure that monetary settlement shall not be a basis of conciliation.

9.2. Resolution through conciliation has to be completed within the following period of 15 (fifteen) days.

9.3. Where settlement has arrived under conciliation, the ICC shall record the settlement so arrived and forward the same to the management to take action as specified in the recommendation and the ICC shall not conduct any further inquiry on such incident.

9.4. A copy of such settlement shall be provided to both the Complainant and the Respondent.

## 10. Enquiry

10.1. The Committee shall initiate an inquiry in the following cases:

10.1.1. no conciliation is requested by the Complainant;

10.1.2. conciliation initiated has not resulted in any settlement between the Parties; or

10.1.3. complainant informs the ICC of the failure of the Respondent in complying with the settlement entered through conciliation.

10.2. The ICC initiates the inquiry within a period of 7 (seven) days of receipt of the written complaint/closure of conciliation/repeat complaint.

10.3. The inquiry shall be initiated in the following manner:

10.3.1. The Complainant shall submit the written complaint (7 copies) along with supporting documents and names of witnesses to ICC;

10.3.2. Upon receipt of such a complaint, a copy shall be sent to the Respondent within 7 (seven) working days by the ICC;

10.3.3. Respondent upon receipt of such complaint shall submit the reply along with supporting documents and a list of witnesses within 10 (ten) working days of receipt of such complaint;

10.3.4. The ICC shall provide every reasonable opportunity to the Complainant and the Respondent to put forward and defend their respective case.

10.3.5. The inquiry shall be completed by the ICC within a total of 90 (ninety) days from the receipt of the complaint;

10.3.6. No legal practitioner will be allowed to represent any party at any stage of the inquiry procedure;

10.3.7. All statements made orally before the ICC employees, witnesses or other persons in relation to an investigation shall be minuted and signed by the person making the statement;

10.3.8. It shall be incumbent on every Employee to respond to queries of ICC honestly and present the facts in an objective and unbiased manner;

10.3.9. The ICC shall conduct an inquiry into the matter of the principles of natural justice and shall hear both Parties and their submission before taking any decision;

10.3.10. Where the conduct of Sexual Harassment amounts to a specific offence under the Bharatiya Nyaya Sanhita, 2023, or under any other law, it shall be the duty of the ICC to immediately inform the Complainant of her right to initiate action in accordance with the law with appropriate authority and to give guidance and support on the same. Any such action or proceedings initiated shall be in addition to proceedings initiated and/or any action taken under this Policy;

10.3.11. In conducting the inquiry, a minimum of 3 (three) Members including the Chairman shall be present;

10.3.12. The inquiry report has to be issued within 10 (ten) days from the date of completion of the inquiry to both the management and the concerned Parties;

10.3.13. The Company is required to act on the recommendations of the ICC within 60 (sixty) days of receipt of the inquiry report; and

10.3.14. The aggrieved party can appeal against the decision of the committee within 90 (ninety) days from the date of recommendations to the concerned forum/court.

## 11. Interim Relief

11.1. During the pendency of an enquiry, if the Complainant makes a written request, the ICC may recommend the Company to:

11.1.1. transfer the Aggrieved Woman or the Respondent to any other Workplace;

11.1.2. grant leaves to the Aggrieved Woman for up to a period of three months. Such leave shall be in addition to other leaves granted to the Aggrieved Woman; or

11.1.3. grant other such relief to the Aggrieved Woman as may be appropriate.

11.2. On the recommendation of the ICC, the Company shall implement the recommendation made under this clause and send the report of such implementation to the ICC.

## 12. Termination Of Inquiry

12.1. The ICC has the right to terminate the inquiry proceedings or to give an ex-parte decision on the complaint, if the Complainant or the Respondent fails, without sufficient cause to present herself or himself for three consecutive hearings convened by the Chairperson, as the case may be, provided that such termination or ex-parte order may not be passed without giving a notice of 15 (fifteen) days to the concerned party.

## 13. Complaint Unsubstantiated

13.1. When the ICC concludes that the allegation against the Respondent has not been substantiated, it sends a report to the management to close the complaint.

13.2. Further, the ICC shall ensure that both Parties are informed about the investigation and closure of the Complainant.

## 14. Complaint Substantiated

14.1. Where the ICC concludes that the allegation against the Respondent has been proved, it shall recommend to the management:

14.1.1. to take action for sexual harassment as a misconduct in accordance with company rules;

14.1.2. to deduct, notwithstanding anything in the employment terms applicable to the Respondent, from the salary or wages of the Respondent such sum as it may consider appropriate to be paid to the Aggrieved Woman or her legal heirs; or

14.1.3. such compensation may be determined in accordance with Clause named Compensation under this Policy or Section 15 of the POSH Act.

14.2. In case the management is unable to make such a deduction from the salary of the Respondent due to his being absent from duty or cessation of the employment it may direct the Respondent to pay such sum to Aggrieved Woman.

14.3. Provided further that in case the Respondent fails to pay the sum as ordered by the ICC, may forward the order for recovery of the sum as an arrear of land revenue to the concerned District Officer.

14.4. The Employer or the District Officer will act upon the recommendation within 60 days of receipt of the report by him/her from the ICC.

## 15. Compensation

15.1. To determine the compensation to be paid to the Aggrieved Woman, the ICC shall consider the following points:

15.1.1. the mental trauma, pain, suffering and emotional distress caused to the Aggrieved Woman;

15.1.2. the loss of the career opportunity due to the incident of sexual harassment;

15.1.3. medical expenses incurred by the victim for physical or psychiatric treatment;

15.1.4. the income and financial status of the Respondent; and

15.1.5. feasibility of such payment in a lump sum or instalments.

## 16. Penal Consequences Of Sexual Harassment

16.1. As per the POSH Act, the Company may impose the following punishments on an Employee for indulging in an act of sexual harassment in accordance with the gravity of the offence committed by him:

16.1.1. written apology;

16.1.2. warning;

16.1.3. Withholding of promotion;

16.1.4. withholding of pay rise or increments;

16.1.5. terminating the Respondent from service;

16.1.6. deduction of compensation payable to the Aggrieved Woman from the wages of the Respondent;

16.1.7. inappropriate cases initiating a criminal complaint.

## 17. Malicious Allegations

17.1. Where the ICC concludes that the allegation against the Respondent is malicious or the Aggrieved Woman or any other person making the complaint has made the complaint knowing it to be false or the Aggrieved Woman or any other person making the complaint has produced any forged or misleading document, it may recommend to the management to take appropriate action against such person.

17.2. The actions recommended against such malicious complaints shall be similar to those of punishments if such a complaint was substantiated against the Respondent.

17.3. The inability to substantiate a complaint or provide adequate proof need not mean that the complaint is false or malicious.

## 18. No Retaliation

18.1. Regardless of the outcome of the complaint made in good faith, the Complainant, witnesses and any other person providing the information will be protected from any form of retaliation. While dealing with complaints, the ICC shall ensure that the Complainant, witnesses, etc. are not victimized or discriminated against in any manner.

18.2. Anyone suspecting or experiencing retaliation should report to the ICC immediately. Any such retaliation cases will be treated seriously and appropriate disciplinary actions will be taken including termination of employment.

## 19. Confidentiality

19.1. The contents of the complaint made under this Policy, the identity and address of the Aggrieved Woman, Respondent and witnesses, any information relating to conciliation and inquiry proceedings, recommendations of ICC and the actions taken by the management under the provisions of this Policy shall not be published, communicated or made known to the public press and media in any manner unless specifically allowed under the POSH Act.

19.2. Where any person entrusted with the duty to handle or deal with the complaint, inquiry or any recommendations or action to be taken under the provision of this Policy, contravenes this clause, shall be treated as major misconduct and the management will take appropriate disciplinary action including termination of employment.

## 20. Appeal

Any person aggrieved from the recommendations of ICC under this Policy or non-implementation of such recommendations may prefer an appeal to the court or tribunal without prejudice to provisions contained in any other law for the time being in force. Such appeal shall be preferred within a period of 90 (ninety) days of the recommendations of ICC.

## 21. Awareness Programmes

21.1. The Company will display the details of ICC, penal consequences of sexual harassment and other information in a visible place on the premises of the Company and every personnel is required to read and understand the same.

21.2. The Company will conduct workshops and awareness programmes at regular intervals and employees are required to attend those programmes.

21.3. The Company will conduct regular orientation programmes for the Members of the Internal Committee in the manner as decided from time to time.

## 22. Legal Compliance

22.1. The ICC shall in each calendar year prepare an annual report and submit the same to the management and District Officer. The report shall include the following details:

22.1.1. number of sexual harassment cases received;

22.1.2. number of cases disposed of;

22.1.3. number of cases pending for more than 90 (ninety) days with the ICC;

22.1.4. number of workshops or awareness programs against sexual harassment carried out by the Company; and

22.1.5. nature of actions taken by the management and the District Officer in the preceding year.

## Annexure A — Internal Complaints Committee

(INTERNAL COMPLAINTS COMMITTEE)

- **Chairperson** — Saloni Anchan

- **Member** — Brinda Kapur

- **Member** — Paresh Shah

- **External Member** — Mansi Shetty', updated_by = 'Drive import', updated_at = NOW() WHERE id = 'posh-policy';

SELECT id, title, LENGTH(body) AS body_chars, updated_by FROM hr_policies;
