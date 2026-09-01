'use strict';
/**
 * Paints the "Order sheet" tab of the PI workbook into the export Order Sheet
 * format — the document raised once a PI is final and the advance has landed.
 *
 * Only ever touches that one tab. "Proforma Invoice", "ERP PI Log" and
 * "ERP Order sheet Log" are never read or written here.
 *
 * Idempotent: it clears values, formats, merges and borders on that tab first,
 * so running it twice gives the same sheet. Safe to re-run after editing
 * backend/lib/order-sheet-format.js, which is where the layout actually lives.
 *
 * Needs the same GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY(_B64) env
 * vars server.js uses (read from .env.local, same as rebuild-pi-sheet.js).
 *
 *   node scripts/build-order-sheet.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');
const OS = require('../backend/lib/order-sheet-format');

// Must match PI_CREATION_SHEET_ID in server.js — the Order Sheet lives in the
// same workbook as the PI it comes from.
const SPREADSHEET_ID = '1jWRILcYuJZh6EyxvOYz_Ol0z9X2X79RcDiKFV8x76XA';
const TAB = 'Order sheet';

const { LETTERHEAD, LAYOUT, PARTY_LABELS, CELLS, ITEMS, DEFAULTS } = OS;

/* ── tiny A1 helpers ─────────────────────────────────────────────────── */
const colIdx = (letter) => letter.toUpperCase().charCodeAt(0) - 65;      // single-letter only (grid is A..L)

// Sheets API ranges are half-open and 0-indexed; every range in this script is
// written in 1-indexed row / letter-column terms and converted here.
function gridRange(sheetId, r1, r2, c1Letter, c2Letter) {
  return {
    sheetId,
    startRowIndex: r1 - 1, endRowIndex: r2,
    startColumnIndex: colIdx(c1Letter), endColumnIndex: colIdx(c2Letter) + 1,
  };
}

function getClients() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const b64 = process.env.GOOGLE_PRIVATE_KEY_B64?.trim();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  // Same unescaping rebuild-pi-sheet.js does: a key pasted into .env.local
  // carries literal backslash-n rather than real newlines.
  const key = b64
    ? Buffer.from(b64, 'base64').toString('utf8')
    : (rawKey ? rawKey.split(String.raw`\n`).join('\n') : '');
  if (!email || !key) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/* ── formatting shorthands ───────────────────────────────────────────── */
const BLACK = { red: 0, green: 0, blue: 0 };
const SOLID = { style: 'SOLID', width: 1, color: BLACK };
const MEDIUM = { style: 'SOLID_MEDIUM', width: 2, color: BLACK };
const BAND = { red: 0.85, green: 0.89, blue: 0.95 };   // title / table-header fill
const SOFT = { red: 0.96, green: 0.97, blue: 0.99 };   // totals-row fill

function fmt(sheetId, r1, r2, c1, c2, format, fields) {
  return { repeatCell: { range: gridRange(sheetId, r1, r2, c1, c2), cell: { userEnteredFormat: format }, fields } };
}
function text(sheetId, r1, r2, c1, c2, opts) {
  opts = opts || {};
  const format = {
    horizontalAlignment: opts.align || 'LEFT',
    verticalAlignment: opts.valign || 'MIDDLE',
    wrapStrategy: opts.wrap || 'WRAP',
    textFormat: { bold: !!opts.bold, fontSize: opts.size || 9, fontFamily: 'Arial' },
  };
  if (opts.bg) format.backgroundColor = opts.bg;
  const fields = 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat'
    + (opts.bg ? ',backgroundColor)' : ')');
  return fmt(sheetId, r1, r2, c1, c2, format, fields);
}
function merge(sheetId, r1, r2, c1, c2) {
  return { mergeCells: { range: gridRange(sheetId, r1, r2, c1, c2), mergeType: 'MERGE_ALL' } };
}
function borders(sheetId, r1, r2, c1, c2, sides) {
  return { updateBorders: Object.assign({ range: gridRange(sheetId, r1, r2, c1, c2) }, sides) };
}
function rowHeight(sheetId, r1, r2, px) {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: r1 - 1, endIndex: r2 },
      properties: { pixelSize: px }, fields: 'pixelSize',
    },
  };
}
function numberFormat(sheetId, r1, r2, c1, c2, pattern) {
  return fmt(sheetId, r1, r2, c1, c2,
    { numberFormat: { type: 'NUMBER', pattern } }, 'userEnteredFormat.numberFormat');
}

async function run() {
  const sheets = getClients();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tab = meta.data.sheets.find(s => s.properties.title === TAB);
  if (!tab) throw new Error('Tab "' + TAB + '" not found in spreadsheet ' + SPREADSHEET_ID);
  const sheetId = tab.properties.sheetId;
  console.log('Found "' + TAB + '" (sheetId ' + sheetId + '). Painting the export Order Sheet…');

  const L = LAYOUT;
  const FC = L.firstCol, LC = L.lastCol;
  const PB = L.partyBlock;

  /* 1) Wipe: resize + unmerge + reset formats and borders, THEN clear values.
        Resize first — a values.clear over a range wider than the grid is
        rejected, and a fresh tab is 26 columns of the wrong shape. */
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: L.rowCount, columnCount: L.colCount } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } },
        { unmergeCells: { range: { sheetId } } },
        // A fill collapses the unused item rows per order; a rebuild has to
        // hand back a template with all of them showing again.
        { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: L.rowCount }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } },
        { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } },
        borders(sheetId, 1, L.rowCount, FC, LC, {
          top: { style: 'NONE' }, bottom: { style: 'NONE' }, left: { style: 'NONE' }, right: { style: 'NONE' },
          innerHorizontal: { style: 'NONE' }, innerVertical: { style: 'NONE' },
        }),
      ],
    },
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: "'" + TAB + "'!A1:" + LC + L.rowCount });
  console.log('  cleared values, merges, formats and borders');

  /* 2) Static text: letterhead, block labels, table header, boilerplate. */
  const put = (a1, value) => ({ range: "'" + TAB + "'!" + a1, values: [[value]] });
  const TC = L.letterheadTextCol;
  const values = [
    // mode 1 = scale to fit the merged block, keeping the logo's aspect ratio.
    put(L.logoCols.first + L.letterheadRows.company, '=IMAGE("' + LETTERHEAD.logoUrl + '", 1)'),
    put(TC + L.letterheadRows.company, LETTERHEAD.company),
    put(TC + L.letterheadRows.regd, LETTERHEAD.regd),
    put(TC + L.letterheadRows.admin, LETTERHEAD.admin),
    put(TC + L.letterheadRows.works, LETTERHEAD.works),
    put('A' + L.letterheadRows.title, LETTERHEAD.title),
    put(CELLS.customerHeading, 'Customer :'),
    put(CELLS.shipmentNote, DEFAULTS.shipmentNote),
    put(CELLS.notesHeading, DEFAULTS.notesHeading),
    put('A' + L.totalRow, 'TOTAL'),
  ];
  // Order-block labels, one per party-block row.
  PARTY_LABELS.forEach((label, i) => values.push(put(PB.labelFirst + (PB.firstRow + i), label)));
  // Item-table header, full width.
  values.push({ range: "'" + TAB + "'!A" + L.itemHeaderRow + ':' + LC + L.itemHeaderRow, values: [ITEMS.headers] });
  // Standing instructions; the remaining slots stay blank for the per-order note.
  DEFAULTS.notes.forEach((t, i) => {
    if (L.notesFirstRow + i <= L.notesLastRow) values.push(put('A' + (L.notesFirstRow + i), t));
  });
  // Sign-off captions.
  L.signatureCols.forEach(s => values.push(put(s.first + L.signatoryRow, s.caption)));

  /* 3) Totals row. No Amount column and no rate, so these four loading figures
        are the only live formulas on the sheet. */
  const sumRange = (col) => '=IF(SUM(' + col + L.itemsFirstRow + ':' + col + L.itemsLastRow + ')=0,"",SUM('
    + col + L.itemsFirstRow + ':' + col + L.itemsLastRow + '))';
  [ITEMS.fields.qty, ITEMS.fields.boxes, ITEMS.fields.cbm, ITEMS.fields.weight]
    .forEach(col => values.push({ range: "'" + TAB + "'!" + col + L.totalRow, values: [[sumRange(col)]] }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: values },
  });
  console.log('  wrote letterhead, labels, table header, standing notes and totals formulas');

  /* 4) Column widths, merges, fonts, fills, borders, row heights. */
  const requests = [];

  ITEMS.colWidths.forEach((px, i) => requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px }, fields: 'pixelSize',
    },
  }));

  // Base look for the whole sheet, then overrides on top.
  requests.push(text(sheetId, 1, L.rowCount, FC, LC, { size: 9 }));

  // ── letterhead: logo block on the left, name + addresses to its right
  requests.push(merge(sheetId, L.letterheadRows.company, L.letterheadRows.works, L.logoCols.first, L.logoCols.last));
  [L.letterheadRows.company, L.letterheadRows.regd, L.letterheadRows.admin, L.letterheadRows.works]
    .forEach(r => requests.push(merge(sheetId, r, r, TC, LC)));
  requests.push(merge(sheetId, L.letterheadRows.title, L.letterheadRows.title, FC, LC));
  requests.push(text(sheetId, L.letterheadRows.company, L.letterheadRows.works, L.logoCols.first, L.logoCols.last, { align: 'CENTER', valign: 'MIDDLE', size: 9 }));
  requests.push(text(sheetId, L.letterheadRows.company, L.letterheadRows.company, TC, LC, { align: 'CENTER', bold: true, size: 16 }));
  requests.push(text(sheetId, L.letterheadRows.regd, L.letterheadRows.works, TC, LC, { align: 'CENTER', size: 8 }));
  requests.push(text(sheetId, L.letterheadRows.title, L.letterheadRows.title, FC, LC, { align: 'CENTER', bold: true, size: 12, bg: BAND }));
  requests.push(rowHeight(sheetId, L.letterheadRows.company, L.letterheadRows.company, 26));
  requests.push(rowHeight(sheetId, L.letterheadRows.regd, L.letterheadRows.works, 13));
  requests.push(rowHeight(sheetId, L.letterheadRows.title, L.letterheadRows.title, 22));

  // ── party block: customer | label | value
  for (let r = PB.firstRow; r <= PB.lastRow; r++) {
    requests.push(merge(sheetId, r, r, PB.customerFirst, PB.customerLast));
    requests.push(merge(sheetId, r, r, PB.labelFirst, PB.labelLast));
    requests.push(merge(sheetId, r, r, PB.valueFirst, LC));
  }
  requests.push(text(sheetId, PB.firstRow, PB.lastRow, PB.customerFirst, PB.customerLast, { size: 9 }));
  requests.push(text(sheetId, PB.firstRow, PB.firstRow, PB.customerFirst, PB.customerLast, { bold: true, size: 9 }));          // "Customer :"
  requests.push(text(sheetId, PB.firstRow + 1, PB.firstRow + 1, PB.customerFirst, PB.customerLast, { bold: true, size: 10 })); // buyer name
  requests.push(text(sheetId, PB.firstRow, PB.lastRow, PB.labelFirst, PB.labelLast, { bold: true, size: 8 }));
  requests.push(text(sheetId, PB.firstRow, PB.lastRow, PB.valueFirst, LC, { size: 9 }));
  // The Order No. and the PI it answers to are the two anyone looks for first.
  requests.push(text(sheetId, PB.firstRow, PB.firstRow, PB.valueFirst, LC, { bold: true, size: 10 }));
  requests.push(text(sheetId, PB.firstRow + 2, PB.firstRow + 2, PB.valueFirst, LC, { bold: true, size: 9 }));
  requests.push(rowHeight(sheetId, PB.firstRow, PB.lastRow, 16));

  // ── shipment note strip
  requests.push(merge(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, FC, LC));
  requests.push(text(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, FC, LC, { align: 'CENTER', bold: true, size: 10, bg: SOFT }));
  requests.push(rowHeight(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, 20));

  // ── item table
  requests.push(text(sheetId, L.itemHeaderRow, L.itemHeaderRow, FC, LC, { align: 'CENTER', bold: true, size: 8, bg: BAND }));
  requests.push(rowHeight(sheetId, L.itemHeaderRow, L.itemHeaderRow, 32));
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, FC, LC, { align: 'CENTER', size: 9 }));
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.itemName, ITEMS.fields.itemName, { align: 'LEFT', size: 9 }));
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.remarksCol, ITEMS.remarksCol, { align: 'LEFT', size: 8 }));
  requests.push(rowHeight(sheetId, L.itemsFirstRow, L.itemsLastRow, L.itemRowHeight));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.packing, ITEMS.fields.qty, '#,##0'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.boxes, ITEMS.fields.boxes, '#,##0'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.cbm, ITEMS.fields.cbm, '0.0000'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.weight, ITEMS.fields.weight, '#,##0.00'));
  // Per-piece weight runs to grams; no TOTAL — summing a per-piece figure
  // across lines would mean nothing.
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.weightPerPc, ITEMS.fields.weightPerPc, '0.000'));

  // ── totals row
  requests.push(merge(sheetId, L.totalRow, L.totalRow, L.totalLabelFirst, L.totalLabelLast));
  requests.push(text(sheetId, L.totalRow, L.totalRow, FC, LC, { align: 'CENTER', bold: true, size: 9, bg: SOFT }));
  requests.push(text(sheetId, L.totalRow, L.totalRow, L.totalLabelFirst, L.totalLabelLast, { align: 'RIGHT', bold: true, size: 9, bg: SOFT }));
  requests.push(rowHeight(sheetId, L.totalRow, L.totalRow, 20));

  // ── special instructions box
  requests.push(merge(sheetId, L.notesHeadingRow, L.notesHeadingRow, FC, LC));
  for (let r = L.notesFirstRow; r <= L.notesLastRow; r++) requests.push(merge(sheetId, r, r, FC, LC));
  requests.push(text(sheetId, L.notesHeadingRow, L.notesHeadingRow, FC, LC, { bold: true, size: 9, bg: SOFT }));
  requests.push(text(sheetId, L.notesFirstRow, L.notesLastRow, FC, LC, { size: 8 }));
  requests.push(rowHeight(sheetId, L.notesHeadingRow, L.notesHeadingRow, 18));
  requests.push(rowHeight(sheetId, L.notesFirstRow, L.notesLastRow, 18));
  // Spacer between the notes box and the sign-offs — the default 21px is
  // wasted vertical budget on a page already fighting to stay on one sheet.
  requests.push(rowHeight(sheetId, L.notesLastRow + 1, L.notesLastRow + 1, 8));

  // ── sign-off blocks: three tall merged boxes side by side
  L.signatureCols.forEach(s => {
    requests.push(merge(sheetId, L.signatureRow, L.signatureLastRow, s.first, s.last));
    requests.push(merge(sheetId, L.signatoryRow, L.signatoryRow, s.first, s.last));
  });
  requests.push(text(sheetId, L.signatureRow, L.signatureLastRow, FC, LC, { bold: true, size: 9 }));
  requests.push(text(sheetId, L.signatoryRow, L.signatoryRow, FC, LC, { align: 'CENTER', bold: true, size: 9 }));
  requests.push(rowHeight(sheetId, L.signatureRow, L.signatureLastRow, 25));
  requests.push(rowHeight(sheetId, L.signatoryRow, L.signatoryRow, 16));

  // ── borders: party panels, shipment strip, item grid, notes box, page box
  requests.push(borders(sheetId, PB.firstRow, PB.lastRow, PB.customerFirst, PB.customerLast, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, PB.firstRow, PB.lastRow, PB.labelFirst, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID }));
  requests.push(borders(sheetId, PB.firstRow, PB.lastRow, PB.valueFirst, PB.valueFirst, { left: SOLID }));
  requests.push(borders(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, L.itemHeaderRow, L.totalRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID, innerVertical: SOLID }));
  requests.push(borders(sheetId, L.notesHeadingRow, L.notesLastRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, L.signatureRow, L.signatoryRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerVertical: SOLID }));
  requests.push(borders(sheetId, 1, L.lastRow, FC, LC, { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM }));

  // Sheets caps a batchUpdate at a few hundred requests comfortably; chunk to
  // stay well inside it.
  for (let i = 0; i < requests.length; i += 100) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: requests.slice(i, i + 100) } });
  }
  console.log('  applied ' + requests.length + ' formatting requests');

  console.log('\n=== DONE ===');
  console.log('Open it: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit#gid=' + sheetId);
  console.log('\nThe logo in A1 is an =IMAGE() formula. It should resolve straight away —');
  console.log('a human has already opened this workbook once for the PI tab, and that');
  console.log('authorisation covers the whole document, this tab included.');
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
