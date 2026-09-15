'use strict';
/**
 * Paints the "Proforma Invoice" template tab into the layout described by
 * backend/lib/pi-format.js — letterhead (seal left, logo right), consignee
 * and shipping blocks, the item table with its live Amount formulas, totals,
 * amount in words, T&C and the two-sided signature box.
 *
 * Two callers:
 *   • server.js, automatically: before filling a PI it compares the version
 *     stamped on the tab (developer metadata, see readTemplateVersion) with
 *     PI_FMT.TEMPLATE_VERSION and repaints when they differ. That is how a
 *     layout change reaches production with an ordinary deploy — the old way
 *     (someone remembering to run the rebuild script) left the live tab on a
 *     layout two versions behind this file for weeks.
 *   • scripts/rebuild-pi-sheet.js, by hand, for a forced repaint.
 *
 * Idempotent: it clears values, formats and merges on that tab first, so
 * running it twice gives the same sheet. It only ever touches the template
 * tab — the "ERP PI Log" tab (which IS the database for every PI ever raised)
 * is never read or written here.
 */

const PI = require('./pi-format');

const { LETTERHEAD, LAYOUT, PARTY_LABELS, CELLS, ITEMS, DEFAULTS } = PI;

/* ── tiny A1 helpers ─────────────────────────────────────────────────── */
const colIdx = (letter) => letter.toUpperCase().charCodeAt(0) - 65;      // single-letter only (grid is A..O)

// Sheets API ranges are half-open and 0-indexed; every range in this module is
// written in 1-indexed row / letter-column terms and converted here.
function gridRange(sheetId, r1, r2, c1Letter, c2Letter) {
  return {
    sheetId,
    startRowIndex: r1 - 1, endRowIndex: r2,
    startColumnIndex: colIdx(c1Letter), endColumnIndex: colIdx(c2Letter) + 1,
  };
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

/* ── the version stamp ───────────────────────────────────────────────── */
// Kept as developer metadata on the tab itself rather than in a cell: a cell
// would print, and a cell outside the print range would be wiped by the very
// clear that starts a repaint. Metadata survives everything below.
function readTemplateVersion(sheetMeta) {
  const hit = (sheetMeta && sheetMeta.developerMetadata || [])
    .find(m => m.metadataKey === PI.TEMPLATE_VERSION_KEY);
  const n = hit ? parseInt(hit.metadataValue, 10) : 0;
  return isNaN(n) ? 0 : n;
}

async function stampTemplateVersion(sheets, spreadsheetId, sheetId) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Delete-then-create rather than update: update needs the metadata id,
        // and a tab that has never been stamped has none to give.
        { deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataKey: PI.TEMPLATE_VERSION_KEY, metadataLocation: { sheetId } } } } },
        { createDeveloperMetadata: { developerMetadata: { metadataKey: PI.TEMPLATE_VERSION_KEY, metadataValue: String(PI.TEMPLATE_VERSION), location: { sheetId }, visibility: 'DOCUMENT' } } },
      ],
    },
  });
}

/* ── the painter ─────────────────────────────────────────────────────── */
async function paintPiTemplate(sheets, spreadsheetId, sheetId, tabTitle, log) {
  const say = log || (() => {});
  const TAB = tabTitle;
  const L = LAYOUT;
  const FC = L.firstCol, LC = L.lastCol;

  /* 1) Wipe: resize + unmerge + reset formats and borders, THEN clear values.
        Resize first — a values.clear over a range wider than the grid is
        rejected, and the live tab may be on an older, smaller grid. */
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: L.rowCount, columnCount: L.colCount } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } },
        { unmergeCells: { range: { sheetId } } },
        // server.js collapses the unused item rows per PI and hides the
        // working columns; a rebuild has to hand back a template with all of
        // them showing again.
        { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: L.rowCount }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: L.colCount }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } },
        { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } },
        borders(sheetId, 1, L.rowCount, FC, LC, {
          top: { style: 'NONE' }, bottom: { style: 'NONE' }, left: { style: 'NONE' }, right: { style: 'NONE' },
          innerHorizontal: { style: 'NONE' }, innerVertical: { style: 'NONE' },
        }),
      ],
    },
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${TAB}'!A1:${LC}${L.rowCount}` });
  say('  cleared values, merges, formats and borders');

  /* 2) Static text: letterhead, block labels, table header, boilerplate. */
  const put = (a1, value) => ({ range: `'${TAB}'!${a1}`, values: [[value]] });
  const TC = L.letterheadTextCol;
  const values = [
    // mode 1 = scale to fit the merged block, keeping the image's aspect ratio.
    put(`${L.logoCols.first}${L.letterheadRows.company}`, `=IMAGE("${LETTERHEAD.sealUrl}", 1)`),
    put(`${L.logoRightCols.first}${L.letterheadRows.company}`, `=IMAGE("${LETTERHEAD.logoUrl}", 1)`),
    put(`${TC}${L.letterheadRows.company}`, LETTERHEAD.company),
    put(`${TC}${L.letterheadRows.regd}`, LETTERHEAD.regd),
    put(`${TC}${L.letterheadRows.admin}`, LETTERHEAD.admin),
    put(`${TC}${L.letterheadRows.works}`, LETTERHEAD.works),
    put(`A${L.letterheadRows.title}`, LETTERHEAD.title),
    put(CELLS.consigneeHeading, 'Consignee :'),
    put(`${L.totalCapFirst}${L.wordsRow}`, PI.priceLabels().totalCaption),
    put(`A${L.termsHeadingRow}`, 'Terms & Conditions :'),
    put(`A${L.signatureRow}`, 'For, ' + LETTERHEAD.company),
    put(`A${L.signatoryRow}`, 'Authorised Signatory'),
    put(`${L.signatureRightCol}${L.signatoryRow}`, 'Authorised Signatory'),
    // Boilerplate the app overwrites per PI — painted here so the tab reads
    // correctly even before the first PI is raised.
    put(CELLS.validityNote, PI.validityNote(DEFAULTS.validity)),
    put(CELLS.bankNote, DEFAULTS.bankNote),
    put(CELLS.confirmLine, DEFAULTS.confirmLine),
    put(CELLS.declaration, DEFAULTS.declaration),
  ];
  // Shipping-block labels, one per party-block row.
  PARTY_LABELS.forEach((label, i) => values.push(put(`${L.partyBlock.labelFirst}${L.partyBlock.firstRow + i}`, label)));
  // Item-table header, full width.
  values.push({ range: `'${TAB}'!A${L.itemHeaderRow}:${LC}${L.itemHeaderRow}`, values: [ITEMS.headers] });
  // Default T&C lines.
  DEFAULTS.terms.forEach((t, i) => {
    if (L.termsFirstRow + i <= L.termsLastRow) values.push(put(`A${L.termsFirstRow + i}`, t));
  });

  /* 3) Live formulas — Amount per row, and the totals row. Written once, by
        this painter only; server.js clears around them but never over them. */
  const QTY = ITEMS.qtyCol, RATE = ITEMS.fields.rate;
  for (let r = L.itemsFirstRow; r <= L.itemsLastRow; r++) {
    values.push({ range: `'${TAB}'!${ITEMS.amountCol}${r}`, values: [[`=IF(${QTY}${r}="","",ROUND(${QTY}${r}*${RATE}${r},2))`]] });
  }
  const sumRange = (col) => `=IF(SUM(${col}${L.itemsFirstRow}:${col}${L.itemsLastRow})=0,"",SUM(${col}${L.itemsFirstRow}:${col}${L.itemsLastRow}))`;
  values.push(put(`A${L.totalRow}`, 'TOTAL'));
  // Qty, Boxes, CBM and Weight total; the per-piece rate cannot be summed.
  [ITEMS.fields.qty, ITEMS.fields.boxes, ITEMS.fields.cbm, ITEMS.fields.weight]
    .forEach(col => values.push({ range: `'${TAB}'!${col}${L.totalRow}`, values: [[sumRange(col)]] }));
  values.push(put(`${RATE}${L.totalRow}`, '-'));
  values.push({ range: `'${TAB}'!${ITEMS.amountCol}${L.totalRow}`, values: [[sumRange(ITEMS.amountCol)]] });
  values.push({ range: `'${TAB}'!${L.totalValFirst}${L.wordsRow}`, values: [[`=${ITEMS.amountCol}${L.totalRow}`]] });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data: values },
  });
  say('  wrote letterhead, labels, table header, boilerplate T&C and formulas');

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

  // ── letterhead: seal on the left, logo on the right, name + addresses between
  const LH = L.letterheadRows;
  const TL = L.letterheadTextLast;
  requests.push(merge(sheetId, LH.company, LH.works, L.logoCols.first, L.logoCols.last));
  requests.push(merge(sheetId, LH.company, LH.works, L.logoRightCols.first, L.logoRightCols.last));
  [LH.company, LH.regd, LH.admin, LH.works].forEach(r => requests.push(merge(sheetId, r, r, TC, TL)));
  requests.push(merge(sheetId, LH.title, LH.title, FC, LC));
  requests.push(text(sheetId, LH.company, LH.works, L.logoCols.first, L.logoCols.last, { align: 'CENTER', valign: 'MIDDLE', size: 9 }));
  requests.push(text(sheetId, LH.company, LH.works, L.logoRightCols.first, L.logoRightCols.last, { align: 'CENTER', valign: 'MIDDLE', size: 9 }));
  requests.push(text(sheetId, LH.company, LH.company, TC, TL, { align: 'CENTER', bold: true, size: 16 }));
  requests.push(text(sheetId, LH.regd, LH.works, TC, TL, { align: 'CENTER', size: 8 }));
  requests.push(text(sheetId, LH.title, LH.title, FC, LC, { align: 'CENTER', bold: true, size: 12, bg: BAND }));
  // 28 + 3 × 14 = 70px for the two logo blocks — enough for the round seal
  // to read at letterhead size without the header eating the page.
  requests.push(rowHeight(sheetId, LH.company, LH.company, 28));
  requests.push(rowHeight(sheetId, LH.regd, LH.works, 14));
  requests.push(rowHeight(sheetId, LH.title, LH.title, 22));

  // ── party block: consignee | label | value
  const PB = L.partyBlock;
  for (let r = PB.firstRow; r <= PB.lastRow; r++) {
    requests.push(merge(sheetId, r, r, PB.consigneeFirst, PB.consigneeLast));
    requests.push(merge(sheetId, r, r, PB.labelFirst, PB.labelLast));
    requests.push(merge(sheetId, r, r, PB.valueFirst, LC));
  }
  requests.push(text(sheetId, PB.firstRow, PB.lastRow, PB.consigneeFirst, PB.consigneeLast, { size: 9 }));
  requests.push(text(sheetId, PB.firstRow, PB.firstRow, PB.consigneeFirst, PB.consigneeLast, { bold: true, size: 9 }));      // "Consignee :"
  requests.push(text(sheetId, PB.firstRow + 1, PB.firstRow + 1, PB.consigneeFirst, PB.consigneeLast, { bold: true, size: 10 })); // buyer name
  requests.push(text(sheetId, PB.firstRow, PB.lastRow, PB.labelFirst, PB.labelLast, { bold: true, size: 8 }));
  requests.push(text(sheetId, PB.firstRow, PB.lastRow, PB.valueFirst, LC, { size: 9 }));
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
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.totalRow, ITEMS.fields.rate, ITEMS.fields.rate, '0.000'));
  requests.push(numberFormat(sheetId, L.itemsFirstRow, L.wordsRow, ITEMS.amountCol, ITEMS.amountCol, '#,##0.00'));

  // ── totals row + amount-in-words row
  requests.push(merge(sheetId, L.totalRow, L.totalRow, L.totalLabelFirst, L.totalLabelLast));
  requests.push(text(sheetId, L.totalRow, L.totalRow, FC, LC, { align: 'CENTER', bold: true, size: 9, bg: SOFT }));
  requests.push(text(sheetId, L.totalRow, L.totalRow, L.totalLabelFirst, L.totalLabelLast, { align: 'RIGHT', bold: true, size: 9, bg: SOFT }));
  requests.push(rowHeight(sheetId, L.totalRow, L.totalRow, 20));
  requests.push(merge(sheetId, L.wordsRow, L.wordsRow, L.wordsFirst, L.wordsLast));
  requests.push(merge(sheetId, L.wordsRow, L.wordsRow, L.totalCapFirst, L.totalCapLast));
  requests.push(merge(sheetId, L.wordsRow, L.wordsRow, L.totalValFirst, LC));
  requests.push(text(sheetId, L.wordsRow, L.wordsRow, L.wordsFirst, L.wordsLast, { bold: true, size: 9 }));
  requests.push(text(sheetId, L.wordsRow, L.wordsRow, L.totalCapFirst, L.totalCapLast, { align: 'RIGHT', bold: true, size: 9 }));
  requests.push(text(sheetId, L.wordsRow, L.wordsRow, L.totalValFirst, LC, { align: 'CENTER', bold: true, size: 10 }));
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
  // Each side is one tall merged box (signatureRow..signatureLastRow) rather
  // than a caption row with loose rows beneath it, so the pen space sits
  // inside the bordered box. The split is the same one the party block uses,
  // so the two line up down the page.
  const SR = L.signatureRightCol;
  const SLR = L.signatureLastRow;
  requests.push(merge(sheetId, L.signatureRow, SLR, FC, PB.consigneeLast));
  requests.push(merge(sheetId, L.signatureRow, SLR, SR, LC));
  requests.push(merge(sheetId, L.signatoryRow, L.signatoryRow, FC, PB.consigneeLast));
  requests.push(merge(sheetId, L.signatoryRow, L.signatoryRow, SR, LC));
  requests.push(text(sheetId, L.signatureRow, SLR, FC, LC, { bold: true, size: 9 }));
  requests.push(text(sheetId, L.signatoryRow, L.signatoryRow, FC, LC, { bold: true, size: 9 }));
  requests.push(rowHeight(sheetId, L.signatureRow, SLR, 25));
  requests.push(rowHeight(sheetId, L.signatoryRow, L.signatoryRow, 16));

  // ── borders: party panels, shipment strip, item grid, page box
  requests.push(borders(sheetId, PB.firstRow, PB.lastRow, PB.consigneeFirst, PB.consigneeLast, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, PB.firstRow, PB.lastRow, PB.labelFirst, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID }));
  requests.push(borders(sheetId, PB.firstRow, PB.lastRow, PB.valueFirst, PB.valueFirst, { left: SOLID }));
  requests.push(borders(sheetId, L.shipmentNoteRow, L.shipmentNoteRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, L.itemHeaderRow, L.wordsRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID, innerHorizontal: SOLID, innerVertical: SOLID }));
  requests.push(borders(sheetId, L.validityRow, L.declarationRow, FC, LC, { top: SOLID, bottom: SOLID, left: SOLID, right: SOLID }));
  requests.push(borders(sheetId, 1, L.lastRow, FC, LC, { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM }));

  // Sheets caps a batchUpdate at a few hundred requests comfortably; chunk to
  // stay well inside it.
  for (let i = 0; i < requests.length; i += 100) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: requests.slice(i, i + 100) } });
  }
  say(`  applied ${requests.length} formatting requests`);

  await stampTemplateVersion(sheets, spreadsheetId, sheetId);
  say(`  stamped template version ${PI.TEMPLATE_VERSION}`);
}

module.exports = { paintPiTemplate, readTemplateVersion, stampTemplateVersion };
