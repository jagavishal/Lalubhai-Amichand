'use strict';
/* =====================================================================
   Leave balances as they stood on the office's leave sheet ("leave.pdf",
   handed over 10 September 2026): per employee, the year's entitlement
   (the sheet's "Op. Bal.") and the days taken so far ("Avail.") for CL,
   SL and PL. Loaded into hr_leave_balances once by applyLeaveBalanceSeed
   in hrms.js, matched to hr_employees by name, and re-runnable from the
   Balances tab after HR fixes a name that did not match.

   The sheet's closing balance is Op. Bal. − Avail., which is exactly what
   the app shows as "Left" when opening = 0, accrued = Op. Bal. and
   used = Avail. — so the numbers on screen equal the sheet's.
   ===================================================================== */

const YEAR = 2026;

// [name, CL entitled, CL used, SL entitled, SL used, PL entitled, PL used]
const ROWS = [
  ['MAHENDRA CHANDULAL SHAH',     7, 0, 5, 1, 23, 12],
  ['ARCHANA SACHIN YERLA',        7, 5, 5, 2, 23, 9],
  ['MANOHAR BABAN PENDURKAR',     7, 2, 5, 0, 23, 8],
  ['MARUTI NAGUJI MOHOL',         7, 5, 5, 2, 23, 7],
  ['JAYESH UDANI',                7, 4, 5, 2, 23, 17],
  ['RAJESH NATVARLAL JOSHI',      7, 2, 5, 0, 23, 4],
  ['SHRAVAN NANDLAL PASSI',       7, 4, 5, 0, 23, 11],
  ['SHAILESH SURESH MANE',        7, 4, 5, 2, 23, 14],
  ['SUSHIL KUMAR KALOYA',         7, 3, 5, 3, 23, 3],
  ['TRUPTI KOLI',                 7, 5, 5, 3, 23, 4],
  ['MAHESH B. SHAH',              7, 0, 5, 0, 23, 0],
  ['SURESH K. SHAH',              7, 0, 5, 0, 23, 0],
  ['SACHIN YASHWANT BHOSALE',     7, 1, 5, 2, 23, 11],
  ['JANHAVI VIJAY GORAKH',        7, 5, 5, 2, 23, 10],
  ['KANAIYALAL NATWARLAL SHAH',   7, 1, 5, 0, 23, 4],
  ['RAMESHCHANDRA M. SHAH',       7, 3, 5, 3, 23, 16],
  ['SHAIKH OBAIDULLA HABIBULLA',  7, 2, 5, 2, 23, 2],
  ['K V PUSHPAN',                 7, 2, 5, 0, 23, 18],
  ['KALPANA ARYA',                7, 3, 5, 1, 23, 11],
  ['RAMCHANDRA DHONDU SHIGAVAN',  7, 0, 5, 0, 23, 0],
  ['SHARAD RATNU PRABHULKAR',     7, 3, 5, 1, 23, 20],
  ['RAVINDRA DATTARAM PALEKAR',   7, 0, 5, 0, 23, 0],
  ['SANDEEP SONU KHAMBE',         7, 0, 5, 0, 23, 0],
  ['VINAYAK PEJALE',              7, 0, 5, 0, 23, 0],
  ['NATHURAM BABU CHAVHAN',       7, 1, 5, 0, 23, 16],
  ['GEETA BHAGAW POL',            7, 0, 5, 0, 23, 0],
];

const BALANCES = ROWS.map(([name, clEnt, clUsed, slEnt, slUsed, plEnt, plUsed]) => ({
  name,
  cells: { CL: { accrued: clEnt, used: clUsed }, SL: { accrued: slEnt, used: slUsed }, PL: { accrued: plEnt, used: plUsed } },
}));

module.exports = { YEAR, BALANCES };
