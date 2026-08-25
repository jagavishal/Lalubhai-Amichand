-- =============================================================================
-- Reporting lines, from the "Work Flow - Reporting" sheet.
-- MySQL / MariaDB. Safe to run more than once.
--
-- Two columns carry a reporting line, and they are read at different moments:
--
--   hr_employees.reporting_to   the org tree (/api/hr/org-chart), and the
--                               fallback the leave router uses when nobody
--                               more deliberate is named.
--   users.leave_approver        the first thing the leave router looks at, and
--                               the field Users -> Add/Edit -> Leave Approver
--                               edits. Holds a user id, not a name.
--
-- Setting both means the tree and the approval mail always agree, and neither
-- depends on the other having been filled in.
--
-- Managers are written as plain names because six of the seven are directors or
-- business managers who have a login but no employee record -- they draw no
-- salary here, so hr_employees has nothing to hold them. Both readers resolve a
-- name against hr_employees first and users second.
--
-- Matching is on LOWER(TRIM(name)), so a difference of case or stray spacing in
-- the master does not silently skip a row. The two SELECTs at the bottom report
-- anything that did not match -- read them, do not just run and walk away.
-- =============================================================================

-- reporting_to was sized for an employee code (MUM014), not a name: at
-- VARCHAR(16) "MAHENDRA CHANDULAL SHAH" is stored as "MAHENDRA CHANDUL" and
-- matches nobody, so all seven peons would drop out of the tree. The app widens
-- this column on its next start too; doing it here as well means the order the
-- two are run in does not matter.
ALTER TABLE hr_employees MODIFY reporting_to VARCHAR(255) DEFAULT '';

DROP TABLE IF EXISTS hr_reporting_seed;
CREATE TABLE hr_reporting_seed (
  emp    VARCHAR(255) NOT NULL,
  mgr    VARCHAR(255) NOT NULL,
  mgr_id VARCHAR(16) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO hr_reporting_seed (emp, mgr) VALUES
  -- Admin
  ('MAHENDRA CHANDULAL SHAH',   'Paresh Shah'),
  ('ARCHANA SACHIN YERLA',      'Saloni Anchan'),
  ('MANOHAR BABAN PENDURKAR',   'Saloni Anchan'),
  ('MARUTI NAGUJI MOHOL',       'Saloni Anchan'),
  -- Accounts.  MAHESH B. SHAH is deliberately absent: the sheet leaves his
  -- reporting blank, so he stays a root of the tree rather than being guessed at.
  ('JAYESH UDANI',              'Paresh Shah'),
  ('RAJESH NATVARLAL JOSHI',    'Paresh Shah'),
  ('SHRAVAN NANDLAL PASSI',     'JAYESH UDANI'),
  ('SHAILESH SURESH MANE',      'JAYESH UDANI'),
  ('SUSHIL KUMAR KALOYA',       'JAYESH UDANI'),
  ('TRUPTI KOLI',               'JAYESH UDANI'),
  -- Trading
  ('SURESH K. SHAH',            'Brinda Kapur'),
  ('SACHIN YASHWANT BHOSALE',   'Brinda Kapur'),
  ('JANHAVI VIJAY GORAKH',      'Brinda Kapur'),
  -- Export.  The sheet reads "Dhiren / Sajil Shah" for the first two; a request
  -- can only be routed to one inbox, so it goes to Sajil Shah, who is already the
  -- sole approver for the rest of the department. Dhiren Shah is an Admin and can
  -- still decide any request in the app, so nothing is taken away from him.
  ('KANAIYALAL NATWARLAL SHAH', 'Sajil Shah'),
  ('RAMESHCHANDRA M. SHAH',     'Sajil Shah'),
  ('SHAIKH OBAIDULLA HABIBULLA','Shival Shah'),
  ('K V PUSHPAN',               'Sajil Shah'),
  ('KALPANA ARYA',              'Sajil Shah'),
  -- Office peons
  ('RAMCHANDRA DHONDU SHIGAVAN','MAHENDRA CHANDULAL SHAH'),
  ('SHARAD RATNU PRABHULKAR',   'MAHENDRA CHANDULAL SHAH'),
  ('RAVINDRA DATTARAM PALEKAR', 'MAHENDRA CHANDULAL SHAH'),
  ('SANDEEP SONU KHAMBE',       'MAHENDRA CHANDULAL SHAH'),
  ('VINAYAK PEJALE',            'MAHENDRA CHANDULAL SHAH'),
  ('NATHURAM BABU CHAVHAN',     'MAHENDRA CHANDULAL SHAH'),
  ('GEETA BHAGAW POL',          'MAHENDRA CHANDULAL SHAH');

-- 1. The employee master -- drives the org tree.
UPDATE hr_employees e
  JOIN hr_reporting_seed s ON LOWER(TRIM(e.name)) = LOWER(TRIM(s.emp))
   SET e.reporting_to = s.mgr;

-- 2. The login record -- drives who the leave request is mailed to. It holds a
--    user id, so the manager's id is resolved into the seed table first: reading
--    and writing `users` in one statement is what MySQL refuses once it decides
--    to merge the subquery rather than materialise it.
UPDATE hr_reporting_seed s
  JOIN users m ON LOWER(TRIM(m.name)) = LOWER(TRIM(s.mgr)) AND m.active = 1
   SET s.mgr_id = m.id;

UPDATE users u
  JOIN hr_reporting_seed s ON LOWER(TRIM(u.name)) = LOWER(TRIM(s.emp))
   SET u.leave_approver = s.mgr_id
 WHERE s.mgr_id IS NOT NULL;

-- ── Check before you close the tab ───────────────────────────────────────────

-- (a) Anybody on the sheet with no matching employee record. Expect this to be
--     empty; a name here means the master spells it differently.
SELECT s.emp AS 'sheet name with no employee record', s.mgr AS 'was to report to'
  FROM hr_reporting_seed s
  LEFT JOIN hr_employees e ON LOWER(TRIM(e.name)) = LOWER(TRIM(s.emp))
 WHERE e.id IS NULL;

-- (b) Any manager on the sheet who is neither an employee nor an active login.
--     A name here gets no approval mail, because there is no address to send to.
SELECT DISTINCT s.mgr AS 'manager with no employee record and no login'
  FROM hr_reporting_seed s
  LEFT JOIN hr_employees e ON LOWER(TRIM(e.name)) = LOWER(TRIM(s.mgr))
  LEFT JOIN users        u ON LOWER(TRIM(u.name)) = LOWER(TRIM(s.mgr)) AND u.active = 1
 WHERE e.id IS NULL AND u.id IS NULL;

-- (c) What the tree will look like.
SELECT COALESCE(NULLIF(e.reporting_to, ''), '(no manager - top of tree)') AS manager,
       COUNT(*) AS reports,
       GROUP_CONCAT(e.name ORDER BY e.name SEPARATOR ', ') AS team
  FROM hr_employees e
 WHERE e.status = 'Active'
 GROUP BY manager
 ORDER BY reports DESC;

DROP TABLE hr_reporting_seed;
