'use strict';

// FMS (Flow Management System) — Google-Sheets-backed recurring workflow tracker.
// Row data always lives in the live external Google Sheet (never copied into our
// own DB); only CONFIG (which sheet, which columns mean what, who the doers are)
// lives in the fms_* tables. This module is a factory so it can be handed the
// same `q`/`pool`/`getGoogleAuth` server.js already defines, instead of standing
// up a second DB connection or Google auth client.
module.exports = function createFmsSheetLib({ q, pool, getGoogleAuth }) {

  // Only for the Proforma Invoice tracker below — the one FMS flow this app
  // knows something about beyond its column config.
  const PI_FMT = require('./pi-format.js');

  /* ── id generation ──────────────────────────────────────────────────── */
  function genId(prefix) {
    return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  /* ── low-level sheet I/O ────────────────────────────────────────────── */
  function extractSpreadsheetId(urlOrId) {
    if (!urlOrId) return '';
    const s = String(urlOrId).trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : s;
  }

  function colToIdx(letter) {
    const s = String(letter || '').trim().toUpperCase();
    let idx = 0;
    for (let i = 0; i < s.length; i++) idx = idx * 26 + (s.charCodeAt(i) - 64);
    return idx - 1; // 0-based
  }

  function idxToCol(idx) {
    let n = idx + 1, s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  const ZERO_WIDTH_RE = new RegExp('[' + String.fromCharCode(0x200B, 0x200C, 0x200D, 0xFEFF) + ']', 'g');
  function stripZW(v) {
    return String(v ?? '').replace(ZERO_WIDTH_RE, '').trim();
  }

  async function getSheetsClient() {
    const auth = getGoogleAuth();
    if (!auth) throw new Error('Google credentials not configured');
    const { google } = require('googleapis');
    return google.sheets({ version: 'v4', auth });
  }

  async function fetchHeaders(sheetUrlOrId, tabName, headerRow = 1) {
    const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
    const sheets = await getSheetsClient();
    const range = `'${tabName}'!A${headerRow}:ZZ${headerRow}`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' });
    const row = (res.data.values && res.data.values[0]) || [];
    return row.map((name, i) => ({ name: stripZW(name) || idxToCol(i), col: idxToCol(i), index: i })).filter((h, i) => stripZW(row[i]));
  }

  async function fetchRange(sheetUrlOrId, range) {
    const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' });
    return res.data.values || [];
  }

  async function writeCell(sheetUrlOrId, tabName, colLetter, rowNumber, value) {
    const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!${colLetter}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });
  }

  // DD-MM-YYYY / DD/MM/YYYY / YYYY-MM-DD (+ optional trailing time) -> 'YYYY-MM-DD', else null.
  function parsePlanDate(val) {
    if (!val) return null;
    const s = stripZW(val);
    if (!s) return null;
    const spaceIdx = s.search(/\s/);
    const datePart = (spaceIdx > -1 ? s.slice(0, spaceIdx) : s).trim();
    let m;
    if ((m = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    if ((m = datePart.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/))) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return null;
  }

  // Matches server.js's own _timestampForSheet() convention (IST, regardless of
  // server timezone) in a DD/MM/YYYY form so parsePlanDate() can round-trip it.
  // Slashes, not dashes: Google Sheets' USER_ENTERED auto-detection reliably
  // recognizes "DD/MM/YYYY HH:MM:SS" as a real date/time (same as
  // _timestampForSheet()'s own slash-separated format elsewhere in this app),
  // but does not reliably recognize the dash-separated form — that previously
  // landed as plain text, which is why any date formula reading this column
  // failed. parsePlanDate() already accepts either separator, so this is a
  // safe change with no round-trip-parsing side effect.
  function nowIST() {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t) => parts.find(p => p.type === t).value;
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }

  // An open-ended range (e.g. 'Tab'!A3:ZZ) pulls every row Sheets considers part
  // of the grid — on a sheet with tens of thousands of configured rows that's a
  // multi-megabyte fetch on every single list/detail load, and reliably times out
  // the client's 15s request. Bound it to a generous but finite window instead.
  const FMS_MAX_DATA_ROWS = 5000;

  async function fetchSheetData(sheet) {
    const headerRow = sheet.header_row || 1;
    const lastRow = headerRow + FMS_MAX_DATA_ROWS;
    const rows = await fetchRange(sheet.sheet_id, `'${sheet.sheet_name}'!A${headerRow}:ZZ${lastRow}`);
    const headerRowVals = rows[0] || [];
    const headers = headerRowVals.map((h, i) => stripZW(h) || idxToCol(i));
    const dataRows = rows.slice(1);
    return { headers, dataRows, headerRow };
  }

  function safeParseJson(text, fallback) {
    if (!text) return fallback;
    try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; }
  }

  /* ── config CRUD ─────────────────────────────────────────────────────── */
  async function listFmsSheets() {
    return q('SELECT * FROM fms_sheets ORDER BY created_at DESC');
  }

  async function getFmsSheet(id) {
    const rows = await q('SELECT * FROM fms_sheets WHERE id = $1', [id]);
    return rows[0] || null;
  }

  function inClausePlaceholders(ids) {
    return ids.map((_, i) => `$${i + 1}`).join(',');
  }

  // An "Add Pricing" step is the one kind of step whose work happens on another
  // page of this app (Proforma Invoice → Add Price) rather than in the
  // Mark-as-Done modal, so it is flagged for the frontend. Matched on the step
  // NAME alone, deliberately: keying it to the tracker's spreadsheet id meant a
  // flow pointed at a copied or moved sheet silently fell back to the ordinary
  // modal, with nothing on screen to say why. The flag only ever matters once a
  // PI number can also be found on the row (piNoIndex below) — a pricing-named
  // step on a sheet with no PI column resolves to nothing and behaves exactly
  // as it did before.
  function isPiPricingStep(step) {
    return !!step && PI_FMT.FMS_TRACKER.pricingStepRe.test(step.step_name || '');
  }

  // Which column of an already-fetched sheet holds the PI number: the header
  // the tracker actually uses, falling back to the column this app writes when
  // it opens the row (only meaningful for the tracker itself, whose header
  // block may leave that cell blank).
  function piNoIndex(headers, step) {
    if (!step || !step.piPricing) return -1;
    const byHeader = (headers || []).findIndex(h => PI_FMT.FMS_TRACKER.piNoHeaderRe.test(h || ''));
    if (byHeader >= 0) return byHeader;
    return step.pi_no_col ? colToIdx(step.pi_no_col) : -1;
  }

  async function getFullSteps(fmsId) {
    const steps = await q('SELECT * FROM fms_sheet_steps WHERE fms_id = $1 ORDER BY step_order ASC, id ASC', [fmsId]);
    if (!steps.length) return [];
    const sheet = await getFmsSheet(fmsId);
    const stepIds = steps.map(s => s.id);
    const ph = await inClausePlaceholders(stepIds);
    const [doerRows, extraRows] = await Promise.all([
      q(`SELECT sd.step_id, sd.user_id, u.name AS user_name FROM fms_step_doers sd LEFT JOIN users u ON u.id = sd.user_id WHERE sd.step_id IN (${ph})`, stepIds),
      q(`SELECT * FROM fms_extra_rows WHERE step_id IN (${ph}) ORDER BY id ASC`, stepIds),
    ]);
    const doersByStep = {};
    doerRows.forEach(d => { (doersByStep[d.step_id] || (doersByStep[d.step_id] = [])).push({ user_id: d.user_id, name: d.user_name || '' }); });
    const extrasByStep = {};
    extraRows.forEach(e => { (extrasByStep[e.step_id] || (extrasByStep[e.step_id] = [])).push(e); });
    return steps.map(s => ({
      ...s,
      show_cols: safeParseJson(s.show_cols, []),
      doers: doersByStep[s.id] || [],
      extraRows: extrasByStep[s.id] || [],
      ...(isPiPricingStep(s)
        ? {
            piPricing: true,
            // Only a hint for the flow this app opens rows in itself; every
            // other sheet resolves its PI column by header, see piNoIndex().
            ...(extractSpreadsheetId(sheet && sheet.sheet_id) === PI_FMT.FMS_TRACKER.spreadsheetId
              ? { pi_no_col: PI_FMT.FMS_TRACKER.cols.piNo }
              : {}),
          }
        : {}),
    }));
  }

  async function insertStepsForFms(fmsId, steps) {
    for (let i = 0; i < (steps || []).length; i++) {
      const st = steps[i];
      const stepId = genId('FST');
      await pool.query(
        `INSERT INTO fms_sheet_steps (id, fms_id, step_order, step_name, plan_col, actual_col, extra_input, extra_col, show_cols, delay_reason_col, doer_name_col)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [stepId, fmsId, i, st.stepName || '', String(st.planCol || '').toUpperCase(), String(st.actualCol || '').toUpperCase(),
          st.extraInput ? 'yes' : 'no', String(st.extraCol || '').toUpperCase(), JSON.stringify(st.showCols || []),
          String(st.delayReasonCol || '').toUpperCase(), String(st.doerNameCol || '').toUpperCase()]
      );
      for (const uid of (st.doerIds || [])) {
        await pool.query('INSERT INTO fms_step_doers (step_id, user_id) VALUES ($1,$2)', [stepId, uid]);
      }
      for (const er of (st.extraRows || [])) {
        await pool.query(
          `INSERT INTO fms_extra_rows (id, step_id, row_label, col_letter, field_type, dropdown_options, required) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [genId('FXR'), stepId, er.rowLabel || '', String(er.colLetter || '').toUpperCase(), er.fieldType || 'text', er.dropdownOptions || '', er.required ? 1 : 0]
        );
      }
    }
  }

  async function clearStepsForFms(fmsId) {
    const stepRows = await q('SELECT id FROM fms_sheet_steps WHERE fms_id = $1', [fmsId]);
    const stepIds = stepRows.map(r => r.id);
    if (stepIds.length) {
      const ph = await inClausePlaceholders(stepIds);
      await pool.query(`DELETE FROM fms_step_doers WHERE step_id IN (${ph})`, stepIds);
      await pool.query(`DELETE FROM fms_extra_rows WHERE step_id IN (${ph})`, stepIds);
    }
    await pool.query('DELETE FROM fms_sheet_steps WHERE fms_id = $1', [fmsId]);
  }

  async function createFmsSheet({ fmsName, sheetName, sheetId, headerRow, createdBy, steps, processCoordinatorId, notifyEnabled }) {
    const id = genId('FMS');
    await pool.query(
      `INSERT INTO fms_sheets (id, fms_name, sheet_name, sheet_id, header_row, created_by, process_coordinator_id, notify_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, fmsName || '', sheetName || '', extractSpreadsheetId(sheetId), headerRow || 1, createdBy || null, processCoordinatorId || null,
        notifyEnabled === false ? 0 : 1]
    );
    await insertStepsForFms(id, steps);
    return getFmsSheet(id);
  }

  async function updateFmsSheet(id, { fmsName, sheetName, sheetId, headerRow, steps, processCoordinatorId, notifyEnabled }) {
    await pool.query(
      `UPDATE fms_sheets SET fms_name=$1, sheet_name=$2, sheet_id=$3, header_row=$4, process_coordinator_id=$5, notify_enabled=$6 WHERE id=$7`,
      [fmsName || '', sheetName || '', extractSpreadsheetId(sheetId), headerRow || 1, processCoordinatorId || null,
        notifyEnabled === false ? 0 : 1, id]
    );
    await clearStepsForFms(id);
    await insertStepsForFms(id, steps);
    return getFmsSheet(id);
  }

  async function deleteFmsSheet(id) {
    await clearStepsForFms(id);
    await pool.query('DELETE FROM fms_intake_fields WHERE fms_id = $1', [id]);
    await pool.query('DELETE FROM fms_sheets WHERE id = $1', [id]);
  }

  /* ── intake form config ──────────────────────────────────────────────── */
  async function getIntakeFields(fmsId) {
    return q('SELECT * FROM fms_intake_fields WHERE fms_id = $1 ORDER BY sort_order ASC, id ASC', [fmsId]);
  }

  async function saveIntakeFields(fmsId, fields) {
    await pool.query('DELETE FROM fms_intake_fields WHERE fms_id = $1', [fmsId]);
    for (let i = 0; i < (fields || []).length; i++) {
      const f = fields[i];
      await pool.query(
        `INSERT INTO fms_intake_fields (id, fms_id, field_label, col_letter, field_type, dropdown_options, required, sort_order, auto_fill, auto_fill_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [genId('FIF'), fmsId, f.fieldLabel || '', String(f.colLetter || '').toUpperCase(), f.fieldType || 'text',
          f.dropdownOptions || '', f.required ? 1 : 0, i, f.autoFill || '', f.autoFillValue || '']
      );
    }
  }

  async function saveIntakeSheetConfig(fmsId, { intakeSheetId, intakeSheetName, intakeHeaderRow, intakeFormName }) {
    await pool.query(
      `UPDATE fms_sheets SET intake_sheet_id=$1, intake_sheet_name=$2, intake_header_row=$3, intake_form_name=$4 WHERE id=$5`,
      [intakeSheetId ? extractSpreadsheetId(intakeSheetId) : '', intakeSheetName || '', intakeHeaderRow || null, intakeFormName || '', fmsId]
    );
  }

  function effectiveIntakeSheet(sheet) {
    return {
      sheetId: sheet.intake_sheet_id || sheet.sheet_id,
      sheetName: sheet.intake_sheet_name || sheet.sheet_name,
      headerRow: sheet.intake_header_row || sheet.header_row || 1,
    };
  }

  async function sheetColumnValues(sheetUrlOrId, tabName, colLetter, headerRow = 1) {
    const rows = await fetchRange(sheetUrlOrId, `'${tabName}'!${colLetter}${Number(headerRow) + 1}:${colLetter}`);
    const values = [...new Set(rows.map(r => stripZW(r[0])).filter(Boolean))];
    const users = await q('SELECT id, name, email FROM users');
    const byNameLower = {};
    users.forEach(u => { byNameLower[(u.name || '').trim().toLowerCase()] = u; });
    const matched = [], unmatched = [];
    values.forEach(v => {
      const u = byNameLower[v.trim().toLowerCase()];
      if (u) matched.push({ sheet_name: v, user_id: u.id, user_name: u.name, email: u.email });
      else unmatched.push(v);
    });
    return { matched, unmatched };
  }

  /* ── visibility ──────────────────────────────────────────────────────── */
  async function getFmsSheetsForUser(userId, isAdmin) {
    const sheets = await listFmsSheets();
    if (isAdmin) return sheets;
    if (!userId) return [];
    const stepRows = await q('SELECT step_id FROM fms_step_doers WHERE user_id = $1', [userId]);
    if (!stepRows.length) return [];
    const stepIds = stepRows.map(r => r.step_id);
    const ph = await inClausePlaceholders(stepIds);
    const fmsIdRows = await q(`SELECT DISTINCT fms_id FROM fms_sheet_steps WHERE id IN (${ph})`, stepIds);
    const fmsIdSet = new Set(fmsIdRows.map(r => r.fms_id));
    return sheets.filter(s => fmsIdSet.has(s.id));
  }

  async function getFmsSheetsWithStats(userId, isAdmin) {
    const sheets = await getFmsSheetsForUser(userId, isAdmin);
    if (!sheets.length) return [];
    const users = await q('SELECT id, name FROM users');
    const userMap = {};
    users.forEach(u => { userMap[u.id] = u.name; });
    // Each sheet's stats need one Sheets API round-trip — run them concurrently
    // so N configured FMS sheets don't multiply the list's load time.
    return Promise.all(sheets.map(async (sheet) => {
      const steps = await getFullSteps(sheet.id);
      let totalEntries = 0, totalPending = 0;
      try {
        const sheetData = await fetchSheetData(sheet);
        totalEntries = sheetData.dataRows.filter(row => row.some(c => stripZW(c))).length;
        steps.forEach(step => {
          const { totalPending: tp } = computePendingRows(sheetData, step, { userName: '', isAdmin: true });
          totalPending += tp;
        });
      } catch (e) {
        console.error('[fms] stats fetch failed for', sheet.id, e.message);
      }
      return {
        ...sheet,
        totalSteps: steps.length,
        totalEntries,
        totalPending,
        coordinatorName: userMap[sheet.process_coordinator_id] || '',
      };
    }));
  }

  // Task-facing view of a single FMS shows several steps at once — fetch the
  // sheet's range ONCE here and reuse it across every step, same as getPendingAcrossSteps.
  async function getPendingRowsForFmsSteps(fmsId, steps, { userName, isAdmin }) {
    const sheet = await getFmsSheet(fmsId);
    if (!sheet || !steps.length) return {};
    const sheetData = await fetchSheetData(sheet);
    const out = {};
    steps.forEach(step => { out[step.id] = computePendingRows(sheetData, step, { userName, isAdmin }); });
    return out;
  }

  async function getStepsForTaskView(fmsId, userId, isAdmin) {
    const steps = await getFullSteps(fmsId);
    return steps.map(s => ({ ...s, isMyStep: isAdmin || (s.doers || []).some(d => d.user_id === userId) }));
  }

  /* ── core pending-rows computation ──────────────────────────────────── */
  // Pure function over an already-fetched sheet range — callers must fetch the
  // sheet's full row range ONCE per sheet and reuse it across every step, never
  // re-fetch per step.
  function computePendingRows(sheetData, step, { userName, isAdmin }) {
    const { headers, dataRows, headerRow } = sheetData;
    const planIdx = colToIdx(step.plan_col);
    const actualIdx = colToIdx(step.actual_col);
    const hasDoerCol = !!step.doer_name_col;
    const doerIdx = hasDoerCol ? colToIdx(step.doer_name_col) : -1;
    // Set only on a pricing step (see isPiPricingStep) — the frontend needs the
    // PI number to open the right Add Price screen, and show_cols may well not
    // include that column.
    const piNoIdx = piNoIndex(headers, step);
    let showCols = Array.isArray(step.show_cols) && step.show_cols.length ? step.show_cols.slice() : headers.map((_, i) => i);
    if (!showCols.includes(planIdx)) showCols = [...showCols, planIdx];

    const uName = (userName || '').trim().toLowerCase();
    const allPending = [];
    dataRows.forEach((row, i) => {
      const planValue = stripZW(row[planIdx]);
      const actualValue = stripZW(row[actualIdx]);
      if (!planValue || actualValue) return; // pending = plan filled AND actual empty

      const rowDoerName = doerIdx >= 0 ? stripZW(row[doerIdx]) : '';
      const isMine = isAdmin || !hasDoerCol || (!!rowDoerName && rowDoerName.toLowerCase() === uName);

      const data = {};
      showCols.forEach(ci => { data[headers[ci] || idxToCol(ci)] = row[ci] ?? ''; });

      allPending.push({
        sheetRowNumber: headerRow + 1 + i,
        planValue: row[planIdx] || '',
        actualValue: row[actualIdx] || '',
        rowDoerName,
        isMine,
        data,
        ...(piNoIdx >= 0 ? { piNo: stripZW(row[piNoIdx]) } : {}),
      });
    });

    const totalPending = allPending.length;
    const assignedToMe = allPending.filter(r => r.isMine).length;
    const rows = (isAdmin || !hasDoerCol) ? allPending : allPending.filter(r => r.isMine);
    return { rows, totalPending, assignedToMe };
  }

  async function getPendingRowsForStep({ sheet, step, userName, isAdmin }) {
    const sheetData = await fetchSheetData(sheet);
    return computePendingRows(sheetData, step, { userName, isAdmin });
  }

  // PC View — every step of one FMS, unfiltered by doer, sorted by planned date.
  async function getPendingAcrossSteps(fmsId) {
    const sheet = await getFmsSheet(fmsId);
    if (!sheet) return [];
    const steps = await getFullSteps(fmsId);
    const sheetData = await fetchSheetData(sheet);
    const out = [];
    steps.forEach(step => {
      const { rows } = computePendingRows(sheetData, step, { userName: '', isAdmin: true });
      const doerNames = (step.doers || []).map(d => d.name).filter(Boolean).join(', ');
      rows.forEach(r => {
        out.push({
          stepId: step.id, stepName: step.step_name, stepOrder: step.step_order,
          doer: r.rowDoerName || doerNames || '',
          rowNumber: r.sheetRowNumber, planValue: r.planValue, data: r.data,
          _planDateSort: parsePlanDate(r.planValue) || '9999-99-99',
        });
      });
    });
    out.sort((a, b) => a._planDateSort.localeCompare(b._planDateSort));
    out.forEach(r => delete r._planDateSort);
    return out;
  }

  // THE Dashboard aggregator — every visible sheet, every relevant step, flat
  // task-shaped items mergeable into the app's generic pending-task array.
  async function getMyFmsPendingRows({ userId, userName, isAdmin }) {
    const sheets = await getFmsSheetsForUser(userId, isAdmin);
    const todayStr = new Date().toISOString().slice(0, 10);

    // Each sheet needs its own Sheets API round-trip (steps + full data) — run
    // them concurrently so N configured FMS sheets don't multiply the
    // Dashboard's load time. Same fix as getFmsSheetsWithStats() above for the
    // FMS list page — this aggregator was the one call site that still awaited
    // sheets one at a time inside a for-loop, which is why plain Dashboard
    // loads (which call this on every request, with no caching) were visibly
    // slower than every other page once more than one FMS sheet was configured.
    const perSheet = await Promise.all(sheets.map(async sheet => {
      let steps;
      try { steps = await getFullSteps(sheet.id); } catch { return []; }
      const relevantSteps = isAdmin ? steps : steps.filter(s => (s.doers || []).some(d => d.user_id === userId));
      if (!relevantSteps.length) return [];

      let sheetData;
      try { sheetData = await fetchSheetData(sheet); } catch (e) {
        console.error('[fms] sheet fetch failed for', sheet.id, e.message);
        return [];
      }

      const rowsOut = [];
      relevantSteps.forEach(step => {
        const { rows } = computePendingRows(sheetData, step, { userName, isAdmin });
        rows.forEach(r => {
          const dueDate = parsePlanDate(r.planValue);
          const overdue = !!(dueDate && dueDate < todayStr);
          rowsOut.push({
            id: `FMS-${sheet.id}-${step.id}-${r.sheetRowNumber}`,
            fmsId: sheet.id, stepId: step.id, rowNumber: r.sheetRowNumber,
            type: 'FMS',
            fmsName: sheet.fms_name, stepName: step.step_name,
            doer: r.rowDoerName || (step.doers || []).map(d => d.name).filter(Boolean).join(', '),
            planValue: r.planValue,
            details: Object.entries(r.data).map(([header, value]) => ({ header, value })),
            description: `${sheet.fms_name} · ${step.step_name}`,
            date: dueDate || r.planValue,
            dueDate: dueDate || r.planValue,
            client: '',
            overdue, isLate: overdue,
            status: 'pending',
            ...(step.piPricing ? { piPricing: true, piNo: r.piNo || '' } : {}),
          });
        });
      });
      return rowsOut;
    }));

    return perSheet.flat();
  }

  /* ── write-back ──────────────────────────────────────────────────────── */
  async function submitIntakeRow(sheet, fields, values, { userName }) {
    const target = effectiveIntakeSheet(sheet);
    for (const f of fields) {
      if (f.auto_fill) continue;
      const v = values[f.id] ?? values[f.col_letter] ?? '';
      if (f.required && !String(v).trim()) throw new Error(`${f.field_label} is required`);
    }

    const now = nowIST();
    const resolved = {};
    fields.forEach(f => {
      let v;
      if (f.auto_fill === 'timestamp') v = now;
      else if (f.auto_fill === 'user_name') v = userName || '';
      else if (f.auto_fill === 'fixed') v = f.auto_fill_value || '';
      else v = values[f.id] ?? values[f.col_letter] ?? '';
      resolved[f.col_letter] = v;
    });

    // Find the next empty row by scanning ONLY the configured intake columns —
    // not Sheets' own table autodetection, which would mistake pre-filled
    // dragged-down formulas in later rows for "existing data".
    const colLetters = fields.map(f => f.col_letter);
    const colIdxs = colLetters.map(colToIdx);
    const minColIdx = Math.min(...colIdxs);
    const maxColIdx = Math.max(...colIdxs);
    const range = `'${target.sheetName}'!${idxToCol(minColIdx)}${target.headerRow + 1}:${idxToCol(maxColIdx)}${target.headerRow + 1 + FMS_MAX_DATA_ROWS}`;
    const rows = await fetchRange(target.sheetId, range);
    let rowOffset = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const allBlank = colIdxs.every(ci => !stripZW(row[ci - minColIdx]));
      if (allBlank) { rowOffset = i; break; }
    }
    const rowNumber = target.headerRow + 1 + rowOffset;

    // Write each field to its own cell — never a full-row array write, so
    // untouched cells (including any formulas) are left exactly as they were.
    for (const f of fields) {
      await writeCell(target.sheetId, target.sheetName, f.col_letter, rowNumber, resolved[f.col_letter] ?? '');
    }
    return { rowNumber };
  }

  async function writeStepDone({ sheet, step, rowNumber, delayReason, extraInputs, doerName }) {
    await writeCell(sheet.sheet_id, sheet.sheet_name, step.actual_col, rowNumber, nowIST());
    if (delayReason && step.delay_reason_col) {
      await writeCell(sheet.sheet_id, sheet.sheet_name, step.delay_reason_col, rowNumber, delayReason);
    }
    for (const ei of (extraInputs || [])) {
      if (ei.colLetter && ei.value !== undefined && ei.value !== '') {
        await writeCell(sheet.sheet_id, sheet.sheet_name, ei.colLetter, rowNumber, ei.value);
      }
    }
    if (doerName && step.doer_name_col) {
      await writeCell(sheet.sheet_id, sheet.sheet_name, step.doer_name_col, rowNumber, doerName);
    }
  }

  // The other half of the pricing step: called right after a PI's price is
  // saved on the Proforma Invoice page, it finds that PI's row in whichever
  // flow tracks it and stamps the "Add Pricing" step's Actual cell — so the
  // step closes itself the moment the work it tracks is actually done, however
  // the pricing was reached (from the FMS Done button or straight from the PI
  // List). Returns null when there is nothing to close: no such flow
  // configured, no such step, or no row for that PI.
  async function completePiPricingStep({ piNo, userName }) {
    const key = stripZW(piNo);
    if (!key) return null;

    // Which flows even have a pricing step is a DB-only question, so settle it
    // before spending a Sheets round-trip on any of them.
    const candidates = [];
    for (const sheet of await listFmsSheets()) {
      const step = (await getFullSteps(sheet.id)).find(s => s.piPricing);
      if (step) candidates.push({ sheet, step });
    }

    for (const { sheet, step } of candidates) {
      const { headers, dataRows, headerRow } = await fetchSheetData(sheet);
      const piIdx = piNoIndex(headers, step);
      if (piIdx < 0) continue;   // pricing-named step, but no PI column to match on
      const actualIdx = colToIdx(step.actual_col);
      const i = dataRows.findIndex(r => stripZW(r[piIdx]) === key);
      if (i === -1) continue;

      const rowNumber = headerRow + 1 + i;
      // Re-pricing an already-priced PI must not overwrite the original
      // completion timestamp — the step was closed the first time round.
      if (stripZW(dataRows[i][actualIdx])) return { sheet, step, rowNumber, alreadyDone: true };

      await writeStepDone({ sheet, step, rowNumber, doerName: userName });
      return { sheet, step, rowNumber, alreadyDone: false };
    }
    return null;
  }

  /* ── next-step notification ──────────────────────────────────────────── */
  // Called right after writeStepDone(): works out who now owns this row and what
  // they need to see. Reads only the header row + the single row that changed
  // (never the whole sheet), so the notification costs two cheap Sheets reads.
  // Returns null whenever there is nothing to notify about — last step of the
  // flow, next step already filled in, or nobody resolvable to an email address.
  async function getNextStepNotification({ sheet, step, rowNumber }) {
    const steps = await getFullSteps(sheet.id);
    const idx = steps.findIndex(s => s.id === step.id);
    if (idx === -1 || idx + 1 >= steps.length) return null; // last step — flow ends here
    const next = steps[idx + 1];

    const headerRowNum = sheet.header_row || 1;
    const [headerVals, rowVals] = await Promise.all([
      fetchRange(sheet.sheet_id, `'${sheet.sheet_name}'!A${headerRowNum}:ZZ${headerRowNum}`),
      fetchRange(sheet.sheet_id, `'${sheet.sheet_name}'!A${rowNumber}:ZZ${rowNumber}`),
    ]);
    const headers = (headerVals[0] || []).map((h, i) => stripZW(h) || idxToCol(i));
    const row = rowVals[0] || [];

    // Same "pending" definition computePendingRows() uses — if the next step's
    // actual cell is already filled, that step isn't waiting on anyone.
    if (stripZW(row[colToIdx(next.actual_col)])) return null;
    const planValue = stripZW(row[colToIdx(next.plan_col)]);

    // Row-level doer wins over the step's configured doers, exactly like
    // computePendingRows() decides whose pending list the row lands in.
    const rowDoerName = next.doer_name_col ? stripZW(row[colToIdx(next.doer_name_col)]) : '';
    let recipients = [];
    if (rowDoerName) {
      recipients = await q('SELECT id, name, email FROM users WHERE LOWER(name) = LOWER($1) AND active = 1', [rowDoerName]);
    }
    if (!recipients.length && (next.doers || []).length) {
      const ids = next.doers.map(d => d.user_id).filter(Boolean);
      if (ids.length) {
        const ph = inClausePlaceholders(ids);
        recipients = await q(`SELECT id, name, email FROM users WHERE id IN (${ph}) AND active = 1`, ids);
      }
    }
    const seen = new Set();
    recipients = recipients.filter(u => {
      const e = (u.email || '').trim().toLowerCase();
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
    });
    if (!recipients.length) return null;

    // Show the doer the same columns their pending list would show them.
    const showCols = Array.isArray(next.show_cols) && next.show_cols.length ? next.show_cols : headers.map((_, i) => i);
    const details = showCols
      .map(ci => ({ header: headers[ci] || idxToCol(ci), value: String(row[ci] ?? '').trim() }))
      .filter(d => d.value);

    return { nextStep: next, recipients, planValue, rowDoerName, details };
  }

  /* ── reporting (MIS / digest) ────────────────────────────────────────── */
  async function getFmsMisRows(start, end) {
    const sheets = await listFmsSheets();
    const perEmployee = {};
    for (const sheet of sheets) {
      let steps, sheetData;
      try { steps = await getFullSteps(sheet.id); sheetData = await fetchSheetData(sheet); } catch { continue; }
      steps.forEach(step => {
        const planIdx = colToIdx(step.plan_col), actualIdx = colToIdx(step.actual_col);
        const hasDoerCol = !!step.doer_name_col;
        const doerIdx = hasDoerCol ? colToIdx(step.doer_name_col) : -1;
        const stepDoerNames = (step.doers || []).map(d => d.name).filter(Boolean);
        sheetData.dataRows.forEach(row => {
          const planRaw = row[planIdx];
          const planDate = parsePlanDate(planRaw);
          if (!planDate || planDate < start || planDate > end) return;
          const rowDoer = hasDoerCol ? stripZW(row[doerIdx]) : '';
          const names = rowDoer ? [rowDoer] : (stepDoerNames.length ? stepDoerNames : ['Unassigned']);
          const actualRaw = row[actualIdx];
          const done = !!stripZW(actualRaw);
          names.forEach(name => {
            if (!perEmployee[name]) perEmployee[name] = { name, total: 0, completed: 0, pending: 0, delayed: 0 };
            const rec = perEmployee[name];
            rec.total++;
            if (done) {
              rec.completed++;
              const actualDate = parsePlanDate(actualRaw);
              if (actualDate && actualDate > planDate) rec.delayed++;
            } else {
              rec.pending++;
            }
          });
        });
      });
    }
    return Object.values(perEmployee).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getFmsMisDetailRows(employeeName, start, end) {
    const sheets = await listFmsSheets();
    const out = [];
    const nameLower = (employeeName || '').trim().toLowerCase();
    for (const sheet of sheets) {
      let steps, sheetData;
      try { steps = await getFullSteps(sheet.id); sheetData = await fetchSheetData(sheet); } catch { continue; }
      steps.forEach(step => {
        const planIdx = colToIdx(step.plan_col), actualIdx = colToIdx(step.actual_col);
        const hasDoerCol = !!step.doer_name_col;
        const doerIdx = hasDoerCol ? colToIdx(step.doer_name_col) : -1;
        const stepDoerNames = (step.doers || []).map(d => (d.name || '').toLowerCase());
        sheetData.dataRows.forEach((row, i) => {
          const planRaw = row[planIdx];
          const planDate = parsePlanDate(planRaw);
          if (!planDate || planDate < start || planDate > end) return;
          const rowDoer = hasDoerCol ? stripZW(row[doerIdx]) : '';
          const matchesRowDoer = !!rowDoer && rowDoer.toLowerCase() === nameLower;
          const matchesStepDoer = !rowDoer && stepDoerNames.includes(nameLower);
          if (!matchesRowDoer && !matchesStepDoer) return;
          const actualRaw = row[actualIdx];
          const actualDate = parsePlanDate(actualRaw);
          const done = !!stripZW(actualRaw);
          out.push({
            fmsName: sheet.fms_name, stepName: step.step_name,
            rowNumber: sheetData.headerRow + 1 + i,
            planValue: planRaw || '', actualValue: actualRaw || '',
            status: done ? 'completed' : 'pending',
            delayed: !!(done && actualDate && actualDate > planDate),
          });
        });
      });
    }
    return out.sort((a, b) => (a.planValue || '').localeCompare(b.planValue || ''));
  }

  async function getFmsPendingGroupedByDoer() {
    const sheets = await listFmsSheets();
    const grouped = {};
    for (const sheet of sheets) {
      let steps, sheetData;
      try { steps = await getFullSteps(sheet.id); sheetData = await fetchSheetData(sheet); } catch { continue; }
      steps.forEach(step => {
        const { rows } = computePendingRows(sheetData, step, { userName: '', isAdmin: true });
        const doerNames = (step.doers || []).map(d => d.name).filter(Boolean);
        rows.forEach(r => {
          const names = r.rowDoerName ? [r.rowDoerName] : doerNames;
          names.forEach(name => {
            if (!grouped[name]) grouped[name] = [];
            grouped[name].push({ fmsName: sheet.fms_name, stepName: step.step_name, planValue: r.planValue, rowNumber: r.sheetRowNumber });
          });
        });
      });
    }
    return grouped;
  }

  return {
    extractSpreadsheetId, colToIdx, idxToCol, fetchHeaders, fetchRange, writeCell, parsePlanDate,
    listFmsSheets, getFmsSheet, createFmsSheet, updateFmsSheet, deleteFmsSheet, getFullSteps,
    getIntakeFields, saveIntakeFields, saveIntakeSheetConfig, effectiveIntakeSheet, sheetColumnValues,
    getFmsSheetsForUser, getFmsSheetsWithStats, getStepsForTaskView,
    computePendingRows, getPendingRowsForStep, getPendingRowsForFmsSteps, getPendingAcrossSteps, getMyFmsPendingRows,
    submitIntakeRow, writeStepDone, getNextStepNotification, completePiPricingStep,
    getFmsMisRows, getFmsMisDetailRows, getFmsPendingGroupedByDoer,
  };
};
