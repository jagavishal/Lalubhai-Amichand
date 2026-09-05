-- =============================================================================
-- Take Shubham Tanaji Sable and Sumesh Magesh Kamble off the rolls.
-- MySQL / MariaDB. Safe to run more than once.
--
-- Deactivated, not deleted: their payslips, attendance and leave history stay
-- attached to their employee ids, which a hard DELETE would orphan. An Inactive
-- employee disappears from the org chart, headcount, attendance sheets and
-- payroll generation on its own — everywhere the app looks, it looks at
-- status = 'Active'.
--
-- Their logins are switched off too, so neither can sign in; deleting their
-- user_sessions rows ends any session that is already open.
-- =============================================================================

UPDATE hr_employees
   SET status = 'Inactive',
       dol = COALESCE(dol, CURDATE())
 WHERE LOWER(TRIM(name)) IN ('shubham tanaji sable', 'sumesh magesh kamble');

UPDATE users
   SET active = 0
 WHERE LOWER(TRIM(name)) IN ('shubham tanaji sable', 'sumesh magesh kamble');

-- Any session already open is ended too — the app signs people out by deleting
-- their rows here (see /api/users/signout-all), not via a users column.
DELETE FROM user_sessions
 WHERE user_id IN (
   SELECT id FROM users
    WHERE LOWER(TRIM(name)) IN ('shubham tanaji sable', 'sumesh magesh kamble')
 );

-- ── Check before you close the tab ───────────────────────────────────────────

-- Both rows should show Inactive with today's date of leaving.
SELECT id, name, status, dol
  FROM hr_employees
 WHERE LOWER(TRIM(name)) IN ('shubham tanaji sable', 'sumesh magesh kamble');

-- Both logins should show active = 0 (no rows here simply means they never had
-- a login).
SELECT id, name, email, active
  FROM users
 WHERE LOWER(TRIM(name)) IN ('shubham tanaji sable', 'sumesh magesh kamble');
