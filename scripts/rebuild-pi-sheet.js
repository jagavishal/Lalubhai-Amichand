'use strict';
/**
 * Repaints the existing "Proforma Invoice" template tab into the company's
 * real EXPORT PI / OCS format (letterhead + consignee/shipping blocks + C&F
 * US$ item table + amount in words + T&C + acceptance signature).
 *
 * This REPLACES the old domestic INR/GST/HSN template that
 * scripts/create-pi-sheet.js originally built. It only ever touches the
 * "Proforma Invoice" tab — the "ERP PI Log" tab (which IS the database for
 * every PI ever raised) is never read or written here.
 *
 * Idempotent: it clears values, formats and merges on that tab first, so
 * running it twice gives the same sheet. Safe to re-run after editing
 * backend/lib/pi-format.js, which is where the layout actually lives.
 *
 * Needs the same GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY(_B64) env
 * vars server.js uses (read from .env.local, same as create-pi-sheet.js).
 *
 *   node scripts/rebuild-pi-sheet.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');
const PI = require('../backend/lib/pi-format');

// Must match PI_CREATION_SHEET_ID / PI_TEMPLATE_TAB in server.js.
const SPREADSHEET_ID = '1jWRILcYuJZh6EyxvOYz_Ol0z9X2X79RcDiKFV8x76XA';
const TAB = 'Proforma Invoice';

const { LETTERHEAD, LAYOUT, PARTY_LABELS, CELLS, ITEMS, DEFAULTS } = PI;

/* ── tiny A1 helpers ─────────────────────────────────────────────────── */
const colIdx = (letter) => letter.toUpperCase().charCodeAt(0) - 65;      // single-letter only (grid is A..M)

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
  const key = b64 ? Buffer.from(b64, 'base64').toString('utf8') : process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
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
  if (!tab) throw new Error(`Tab "${TAB}" not found in spreadsheet ${SPREADSHEET_ID}`);
  const sheetId = tab.properties.sheetId;
  console.log(`Found "${TAB}" (sheetId ${sheetId}). Repainting as export PI / OCS…`);

  const L = LAYOUT;
  const FC = L.firstCol, LC = L.lastCol;

  /* 1) Wipe: resize + unmerge + reset formats and borders, THEN clear values.
        Resize first — the old domestic template is only 8 columns x 60 rows,
        and a values.clear over a range wider than the grid is rejected. */
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: L.rowCount, columnCount: L.colCount } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } },
        { unmergeCells: { range: { sheetId } } },
        // server.js collapses the unused item rows per PI; a rebuild has to
        // hand back a template with all of them showing again.
        { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: L.rowCount }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } },
        { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } },
        // Clear leftover borders from the old INR template.
        borders(sheetId, 1, L.rowCount, FC, LC, {
          top: { style: 'NONE' }, bottom: { style: 'NONE' }, left: { style: 'NONE' }, right: { style: 'NONE' },
          innerHorizontal: { style: 'NONE' }, innerVertical: { style: 'NONE' },
        }),
      ],
    },
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A1:${LC}${L.rowCount}` });
  console.log('  cleared values, merges, formats and borders');

  /* 2) Static text: letterhead, block labels, table header, boilerplate. */
  const put = (a1, value) => ({ range: `'${TAB}'!${a1}`, values: [[value]] });
  const TC = L.letterheadTextCol;
  const values = [
    // mode 1 = scale to fit the merged block, keeping the logo's aspect ratio.
    put(`${L.logoCols.first}${L.letterheadRows.company}`, `=IMAGE("${LETTERHEAD.logoUrl}", 1)`),
    put(`${TC}${L.letterheadRows.company}`, LETTERHEAD.company),
    put(`${TC}${L.letterheadRows.regd}`, LETTERHEAD.regd),
    put(`${TC}${L.letterheadRows.admin}`, LETTERHEAD.admin),
    put(`${TC}${L.letterheadRows.works}`, LETTERHEAD.works),
    put(`A${L.letterheadRows.title}`, LETTERHEAD.title),
    put(CELLS.consigneeHeading, 'Consignee :'),
    put(`I${L.wordsRow}`, 'Total C&F US$'),
    put(`A${L.termsHeadingRow}`, 'Terms & Conditions :'),
    put(`A${L.signatureRow}`, 'For, ' + LETTERHEAD.company),
    put(`A${L.signatoryRow}`, 'Authorised Signatory'),
    put(`H${L.signatoryRow}`, 'Authorised Signatory'),
    // Boilerplate the app overwrites per PI — painted here so the tab reads
    // correctly even before the first PI is raised.
    put(CELLS.validityNote, PI.validityNote(DEFAULTS.validity)),
    put(CELLS.bankNote, DEFAULTS.bankNote),
    put(CELLS.confirmLine, DEFAULTS.confirmLine),
    put(CELLS.declaration, DEFAULTS.declaration),
  ];
  // Shipping-block labels, G:H of each party-block row.
  PARTY_LABELS.forEach((label, i) => values.push(put(`G${L.partyBlock.firstRow + i}`, label)));
  // Item-table header, A..M of the header row.
  values.push({ range: `'${TAB}'!A${L.itemHeaderRow}:${LC}${L.itemHeaderRow}`, values: [ITEMS.headers] });
  // Default T&C lines.
  DEFAULTS.terms.forEach((t, i) => {
    if (L.termsFirstRow + i <= L.termsLastRow) values.push(put(`A${L.termsFirstRow + i}`, t));
  });

  /* 3) Live formulas — Amount per row, and the totals row. Written once, by
        this script only; server.js clears around them but never over them. */
  for (let r = L.itemsFirstRow; r <= L.itemsLastRow; r++) {
    values.push({ range: `'${TAB}'!${ITEMS.amountCol}${r}`, values: [[`=IF(G${r}="","",ROUND(G${r}*K${r},2))`]] });
  }
  const sumRange = (col) => `=IF(SUM(${col}${L.itemsFirstRow}:${col}${L.itemsLastRow})=0,"",SUM(${col}${L.itemsFirstRow}:${col}${L.itemsLastRow}))`;
  values.push(put(`A${L.totalRow}`, 'TOTAL'));
  ['G', 'H', 'I', 'J'].forEach(col => values.push({ range: `'${TAB}'!${col}${L.totalRow}`, values: [[sumRange(col)]] }));
  values.push(put(`K${L.totalRow}`, '-'));
  values.push({ range: `'${TAB}'!${ITEMS.amountCol}${L.totalRow}`, values: [[sumRange(ITEMS.amountCol)]] });
  values.push({ range: `'${TAB}'!${ITEMS.amountCol}${L.wordsRow}`, values: [[`=${ITEMS.amountCol}${L.totalRow}`]] });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: values },
  });
  console.log('  wrote letterhead, labels, table header, boilerplate T&C and formulas');

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

  // ── party block: consignee (A:F) | label (G:H) | value (I:M)
  for (let r = L.partyBlock.firstRow; r <= L.partyBlock.lastRow; r++) {
    requests.push(merge(sheetId, r, r, 'A', 'F'));
    requests.push(merge(sheetId, r, r, 'G', 'H'));
    requests.push(merge(sheetId, r, r, 'I', LC));
  }
  requests.push(text(sheetId, L.partyBlock.firstRow, L.partyBlock.lastRow, 'A', 'F', { size: 9 }));
  requests.push(text(sheetId, L.partyBlock.firstRow, L.partyBlock.firstRow, 'A', 'F', { bold: true, size: 9 }));      // "Consignee :"
  requests.push(text(sheetId, L.partyBlock.firstRow + 1, L.partyBlock.firstRow + 1, 'A', 'F', { bold: true, size: 10 })); // buyer name
  requests.push(text(sheetId, L.partyBlock.firstRow, L.partyBlock.lastRow, 'G', 'H', { bold: true, size: 8 }));
  requests.push(text(sheetId, L.partyBlock.firstRow, L.partyBlock.lastRow, 'I', LC, { size: 9 }));
  requests.push(rowHeight(sheetId, L.partyBlock.firstRow, L.partyBlock.lastRow, 16));

  // ── shipment note strip
  requests.push(merge(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, FC, LC));
  requests.push(text(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, FC, LC, { align: 'CENTER', bold: true, size: 10, bg: SOFT }));
  requests.push(rowHeight(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, 20));

  // ── item table
  requests.push(text(sheetId, L.itemHeaderRow, L.itemHeaderRow, FC, LC, { align: 'CENTER', bold: true, size: 8, bg: BAND }));
  requests.push(rowHeight(sheetId, L.itemHeaderRow, L.itemHeaderRow, 32));
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, FC, LC, { align: 'CENTER', size: 9 }));
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, 'C', 'C', { align: 'LEFT', size: 9 }));   // item name reads better left
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, 'M', 'M', { align: 'LEFT', size: 8 }));     // remarks
  requests.push(rowHeight(sheetId, L.itemsFirstRow, L.itemsLastRow, 17));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, 'G', 'H', '#,##0'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, 'I', 'I', '0.0000'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, 'J', 'J', '#,##0.00'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, 'K', 'K', '0.000'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.wordsRow, 'L', 'L', '#,##0.00'));

  // ── totals row + amount-in-words row
  requests.push(merge(sheetId, L.totalRow, L.totalRow, 'A', 'F'));
  requests.push(text(sheetId, L.totalRow, L.totalRow, FC, LC, { align: 'CENTER', bold: true, size: 9, bg: SOFT }));
  requests.push(text(sheetId, L.totalRow, L.totalRow, 'A', 'F', { align: 'RIGHT', bold: true, size: 9, bg: SOFT }));
  requests.push(rowHeight(sheetId, L.totalRow, L.totalRow, 20));
  requests.push(merge(sheetId, L.wordsRow, L.wordsRow, 'A', 'H'));
  requests.push(merge(sheetId, L.wordsRow, L.wordsRow, 'I', 'K'));
  requests.push(merge(sheetId, L.wordsRow, L.wordsRow, 'L', LC));
  requests.push(text(sheetId, L.wordsRow, L.wordsRow, 'A', 'H', { bold: true, size: 9 }));
  requests.push(text(sheetId, L.wordsRow, L.wordsRow, 'I', 'K', { align: 'RIGHT', bold: true, size: 9 }));
  requests.push(text(sheetId, L.wordsRow, L.wordsRow, 'L', LC, { align: 'CENTER', bold: true, size: 10 }));
  requests.push(rowHeight(sheetId, L.wordsRow, L.wordsRow, 22));

  // ── notes, T&C, declaration
  [L.validityRow, L.bankRow, L.termsHeadingRow, L.confirmRow, L.declarationRow].forEach(r => requests.push(merge(sheetId, r, r, FC, LC)));
  for (let r = L.termsFirstRow; r <= L.termsLastRow; r++) requests.push(merge(sheetId, r, r, FC, LC));
  requests.push(text(sheetId, L.validityRow, L.validityRow, FC, LC, { bold: true, size: 8 }));
  requests.push(text(sheetId, L.bankRow, L.bankRow, FC, LC, { bold: true, size: 8 }));
  requests.push(text(sheetId, L.termsHeadingRow, L.termsHeadingRow, FC, LC, { bold: true, size: 9 }));
  requests.push(text(sheetId, L.termsFirstRow, L.termsLastRow, FC, LC, { size: 8 }));
  requests.push(text(sheetId, L.confirmRow, L.confirmRow, FC, LC, { bold: true, size: 9 }));
  requests.push(text(sheetId, L.declarationRow, L.declarationRow, FC, LC, { size: 8 }));
  // Two lines' worth on the note and T&C rows: the validity warning and term 8
  // both wrap, and a merged wrapped cell is clipped, not auto-grown — at 18px
  // the second half of term 8 ("…RELATIONSHIP CERTIFICATE FOR THE SAME.")
  // simply vanished off the printed PI.
  requests.push(rowHeight(sheetId, L.validityRow, L.validityRow, 24));
  requests.push(rowHeight(sheetId, L.bankRow, L.bankRow, 16));
  requests.push(rowHeight(sheetId, L.termsHeadingRow, L.termsHeadingRow, 16));
  requests.push(rowHeight(sheetId, L.termsFirstRow, L.termsLastRow, 22));
  requests.push(rowHeight(sheetId, L.confirmRow, L.declarationRow, 16));
  // Spacer rows — default 21px each is wasted vertical budget on a page that
  // is already fighting to stay on one sheet.
  requests.push(rowHeight(sheetId, L.wordsRow + 1, L.wordsRow + 1, 6));
  requests.push(rowHeight(sheetId, L.declarationRow + 1, L.declarationRow + 1, 6));

  // ── signature block
  requests.push(merge(sheetId, L.signatureRow, L.signatureRow, 'A', 'F'));
  requests.push(merge(sheetId, L.signatureRow, L.signatureRow, 'H', LC));
  requests.push(merge(sheetId, L.signatoryRow, L.signatoryRow, 'A', 'F'));
  requests.push(merge(sheetId, L.signatoryRow, L.signatoryRow, 'H', LC));
  requests.push(text(sheetId, L.signatureRow, L.signatureRow, FC, LC, { bold: true, size: 9 }));
  requests.push(text(sheetId, L.signatoryRow, L.signatoryRow, FC, LC, { bold: true, size: 9 }));
  requests.push(rowHeight(sheetId, L.signatureRow, L.signatureRow, 18));
  requests.push(rowHeight(sheetId, L.signatureRow + 1, L.signatoryRow - 1, 14));   // pen space
  requests.push(rowHeight(sheetId, L.signatoryRow, L.signatoryRow, 16));

  // ── borders: party panels, shipment strip, item grid, page box
  requests.push(borders(sheetId, L.partyBlock.firstRow, L.partyBlock.lastRow, 'A', 'F', { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, L.partyBlock.firstRow, L.partyBlock.lastRow, 'G', LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID }));
  requests.push(borders(sheetId, L.partyBlock.firstRow, L.partyBlock.lastRow, 'I', 'I', { left: SOLID }));
  requests.push(borders(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, L.itemHeaderRow, L.wordsRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID, innerVertical: SOLID }));
  requests.push(borders(sheetId, L.validityRow, L.declarationRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, 1, L.lastRow, FC, LC, { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM }));

  // Sheets caps a batchUpdate at a few hundred requests comfortably; chunk to
  // stay well inside it (30 item rows already generate a lot above).
  for (let i = 0; i < requests.length; i += 100) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: requests.slice(i, i + 100) } });
  }
  console.log(`  applied ${requests.length} formatting requests`);

  console.log('\n=== DONE ===');
  console.log('Open it: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit#gid=' + sheetId);
  console.log('\n!! ONE MANUAL STEP: open that link in a desktop browser, signed in as a user');
  console.log('   with edit access, and wait for the logo to appear in cell A1.');
  console.log('   Sheets refuses to fetch an external URL for =IMAGE() when the formula was');
  console.log('   written by a service account — it answers #REF! with "Please use a desktop');
  console.log('   web browser to allow access to fetch data from external urls." A single');
  console.log('   human visit resolves and caches it; after that every exported PDF has the');
  console.log('   logo, because nothing rewrites A1 again.');
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
