'use strict';
/**
 * Paints the "Packing List" tab of the PI workbook into the export
 * department's OWN packing list format — the one their LA-07 / LA-14 / LA-16
 * sheets have always used. The layout lives in
 * backend/lib/packing-list-format.js; this only paints what that file says.
 *
 * There is no letterhead logo and no address block on this document, and that
 * is deliberate: their packing list has never had one. It opens on the company
 * line, "EXPORT DEPT.", three header rows and the product-category band.
 *
 * Only ever touches that one tab. "Proforma Invoice", "Order sheet" and the
 * ERP log tabs are never read or written here.
 *
 * Unlike scripts/build-order-sheet.js this one CREATES the tab when it is
 * missing rather than refusing, so a fresh install needs no hand-made tab
 * before it will run.
 *
 * Idempotent: it clears values, formats, merges and borders on that tab first,
 * so running it twice gives the same sheet. Safe to re-run after editing the
 * format file.
 *
 * Needs the same GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY(_B64) env
 * vars server.js uses (read from .env.local, same as build-order-sheet.js).
 *
 *   node scripts/build-packing-list.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');
const PL = require('../backend/lib/packing-list-format');

// Must match PI_CREATION_SHEET_ID in server.js — the Packing List lives in the
// same workbook as the PI and the Order Sheet it is built from.
const SPREADSHEET_ID = '1jWRILcYuJZh6EyxvOYz_Ol0z9X2X79RcDiKFV8x76XA';
const TAB = 'Packing List';

const { LAYOUT, HEADER_LINES, CELLS, ITEMS, DEFAULTS } = PL;

/* ── tiny A1 helpers ─────────────────────────────────────────────────── */
const colIdx = (letter) => letter.toUpperCase().charCodeAt(0) - 65;      // single-letter only (grid is A..S)

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
  // Same unescaping build-order-sheet.js does: a key pasted into .env.local
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
const BAND = { red: 0.85, green: 0.89, blue: 0.95 };   // table-header fill
const SOFT = { red: 0.96, green: 0.97, blue: 0.99 };   // category band / totals fill

function fmt(sheetId, r1, r2, c1, c2, format, fields) {
  return { repeatCell: { range: gridRange(sheetId, r1, r2, c1, c2), cell: { userEnteredFormat: format }, fields } };
}
function text(sheetId, r1, r2, c1, c2, opts) {
  opts = opts || {};
  const format = {
    horizontalAlignment: opts.align || 'LEFT',
    verticalAlignment: opts.valign || 'MIDDLE',
    wrapStrategy: opts.wrap || 'WRAP',
    // Sheets takes fontSize as an int32 and rejects the whole batch on a
    // fractional one ("Invalid value ... (TYPE_INT32), 8.5"), so it is rounded
    // here rather than trusted to every call site.
    textFormat: { bold: !!opts.bold, fontSize: Math.round(opts.size || 9), fontFamily: 'Arial' },
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

// Which columns one header zone spans.
function zoneCols(zone) {
  const L = LAYOUT;
  if (zone === 'left') return [L.headerLeftFirst, L.headerLeftLast];
  if (zone === 'mid') return [L.headerMidFirst, L.headerMidLast];
  return [L.headerRightFirst, L.headerRightLast];
}

async function run() {
  const sheets = getClients();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  let tab = meta.data.sheets.find(s => s.properties.title === TAB);
  if (!tab) {
    console.log('Tab "' + TAB + '" not found — creating it.');
    const added = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: TAB, gridProperties: { rowCount: LAYOUT.rowCount, columnCount: LAYOUT.colCount } },
          },
        }],
      },
    });
    tab = { properties: added.data.replies[0].addSheet.properties };
  }
  const sheetId = tab.properties.sheetId;
  console.log('Using "' + TAB + '" (sheetId ' + sheetId + '). Painting the export Packing List…');

  const L = LAYOUT;
  const FC = L.firstCol, LC = L.lastCol;

  /* 1) Wipe: resize + unmerge + reset formats and borders, THEN clear values.
        Resize first — a values.clear over a range wider than the grid is
        rejected, and a fresh tab is 26 columns of the wrong shape. */
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: L.rowCount, columnCount: L.colCount } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } },
        { unmergeCells: { range: { sheetId } } },
        // A fill collapses the unused item rows per shipment; a rebuild has to
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

  /* 2) Static text: company line, department, header labels, category band,
        table header. The header rows are painted with their LABEL only — the
        fill writes label+value together over the top. */
  const put = (a1, value) => ({ range: "'" + TAB + "'!" + a1, values: [[value]] });
  const values = [
    put(CELLS.company, DEFAULTS.company),
    put(CELLS.department, DEFAULTS.department),
    put(CELLS.productCategory, DEFAULTS.productCategory),
    put('A' + L.totalRow, 'TOTAL'),
  ];
  HEADER_LINES.forEach(h => values.push(put(CELLS[h.key], h.label)));
  values.push({ range: "'" + TAB + "'!A" + L.itemHeaderRow + ':' + LC + L.itemHeaderRow, values: [ITEMS.headers] });

  /* 3) Totals row. The only live formulas on the sheet — every per-line figure
        is written as a plain value by the fill (see the note in the format
        file on why TOTAL PACKED QTY. cannot be a formula). */
  const sumRange = (col) => '=IF(SUM(' + col + L.itemsFirstRow + ':' + col + L.itemsLastRow + ')=0,"",SUM('
    + col + L.itemsFirstRow + ':' + col + L.itemsLastRow + '))';
  ITEMS.totalCols.forEach(col => values.push({ range: "'" + TAB + "'!" + col + L.totalRow, values: [[sumRange(col)]] }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: values },
  });
  console.log('  wrote company line, header labels, category band, table header and totals formulas');

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

  // ── company line + department, both full width and centred
  requests.push(merge(sheetId, L.companyRow, L.companyRow, FC, LC));
  requests.push(merge(sheetId, L.departmentRow, L.departmentRow, FC, LC));
  requests.push(text(sheetId, L.companyRow, L.companyRow, FC, LC, { align: 'CENTER', bold: true, size: 14 }));
  requests.push(text(sheetId, L.departmentRow, L.departmentRow, FC, LC, { align: 'CENTER', bold: true, size: 11 }));
  requests.push(rowHeight(sheetId, L.companyRow, L.companyRow, 24));
  requests.push(rowHeight(sheetId, L.departmentRow, L.departmentRow, 18));

  // ── three header rows, each split left | middle | right
  for (let r = L.headerFirstRow; r <= L.headerLastRow; r++) {
    requests.push(merge(sheetId, r, r, L.headerLeftFirst, L.headerLeftLast));
    requests.push(merge(sheetId, r, r, L.headerMidFirst, L.headerMidLast));
    requests.push(merge(sheetId, r, r, L.headerRightFirst, L.headerRightLast));
  }
  requests.push(text(sheetId, L.headerFirstRow, L.headerLastRow, FC, LC, { bold: true, size: 10 }));
  requests.push(rowHeight(sheetId, L.headerFirstRow, L.headerLastRow, 18));

  // ── product-category band
  requests.push(merge(sheetId, L.categoryRow, L.categoryRow, FC, LC));
  requests.push(text(sheetId, L.categoryRow, L.categoryRow, FC, LC, { bold: true, size: 10, bg: SOFT }));
  requests.push(rowHeight(sheetId, L.categoryRow, L.categoryRow, 18));

  // ── item table
  requests.push(text(sheetId, L.itemHeaderRow, L.itemHeaderRow, FC, LC, { align: 'CENTER', bold: true, size: 7, bg: BAND }));
  requests.push(rowHeight(sheetId, L.itemHeaderRow, L.itemHeaderRow, 46));
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, FC, LC, { align: 'CENTER', size: 8 }));
  // Description is the one column read as prose rather than scanned as a figure.
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.description, ITEMS.fields.description, { align: 'LEFT', size: 8 }));
  // The two columns the whole document is read for.
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.packedQty, ITEMS.fields.packedQty, { align: 'CENTER', bold: true, size: 9 }));
  requests.push(text(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.cartons, ITEMS.fields.cartons, { align: 'CENTER', bold: true, size: 9 }));
  requests.push(rowHeight(sheetId, L.itemsFirstRow, L.itemsLastRow, L.itemRowHeight));
  ITEMS.numberFormats.forEach(nf => requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, nf.first, nf.last, nf.pattern)));

  // ── totals row
  requests.push(merge(sheetId, L.totalRow, L.totalRow, L.totalLabelFirst, L.totalLabelLast));
  requests.push(text(sheetId, L.totalRow, L.totalRow, FC, LC, { align: 'CENTER', bold: true, size: 9, bg: SOFT }));
  requests.push(text(sheetId, L.totalRow, L.totalRow, L.totalLabelFirst, L.totalLabelLast, { align: 'RIGHT', bold: true, size: 9, bg: SOFT }));
  requests.push(rowHeight(sheetId, L.totalRow, L.totalRow, 20));

  // ── borders: header block, item grid, page box
  requests.push(borders(sheetId, L.headerFirstRow, L.categoryRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID }));
  requests.push(borders(sheetId, L.headerFirstRow, L.headerLastRow, L.headerMidFirst, L.headerMidFirst, { left: SOLID }));
  requests.push(borders(sheetId, L.headerFirstRow, L.headerLastRow, L.headerRightFirst, L.headerRightFirst, { left: SOLID }));
  requests.push(borders(sheetId, L.itemHeaderRow, L.totalRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID, innerVertical: SOLID }));
  requests.push(borders(sheetId, 1, L.lastRow, FC, LC, { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM }));

  // Sheets caps a batchUpdate at a few hundred requests comfortably; chunk to
  // stay well inside it.
  for (let i = 0; i < requests.length; i += 100) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: requests.slice(i, i + 100) } });
  }
  console.log('  applied ' + requests.length + ' formatting requests');

  console.log('\n=== DONE ===');
  console.log('Open it: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit#gid=' + sheetId);
  console.log('\nPrints A4 LANDSCAPE — 19 columns is far too wide for portrait.');
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
