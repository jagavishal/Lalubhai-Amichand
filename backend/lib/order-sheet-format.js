'use strict';
/**
 * Single source of truth for the EXPORT Order Sheet layout — the document
 * raised once a PI is final AND the advance has landed, which is what puts the
 * order into production.
 *
 * Same discipline as backend/lib/pi-format.js: the builder that paints the tab
 * (scripts/build-order-sheet.js) and anything that later fills it per order
 * both read this file, so the cell map cannot drift from the painted sheet.
 *
 * It is NOT a second PI. The PI is the priced offer to the buyer; the Order
 * Sheet is the confirmed instruction that follows it, so it deliberately
 * carries NO rate, NO amount, NO total value and no amount in words. What it
 * does carry that the PI hides is Total Weight — a loading and production
 * figure the factory needs and the buyer's copy never showed.
 *
 * Grid is A..M (13 columns): the PI's fourteen minus its Rate and Amount
 * columns, plus a per-piece weight column of its own — another production /
 * loading figure the factory wants at hand. Printed LANDSCAPE, like the PI.
 */

const PI = require('./pi-format');

// Same letterhead as the PI — same company, same three addresses, same logo
// (and the same one-human-visit caveat on =IMAGE(); see pi-format.js).
const LETTERHEAD = Object.assign({}, PI.LETTERHEAD, {
  title: 'ORDER SHEET',
});

const LAYOUT = {
  firstCol: 'A',
  lastCol: 'M',
  colCount: 13,
  rowCount: 70,

  letterheadRows: { company: 1, regd: 2, admin: 3, works: 4, title: 5 },
  logoCols: { first: 'A', last: 'C' },
  letterheadTextCol: 'D',

  // Customer panel on the left, order label/value pairs on the right. The
  // labels span three columns because the longest ("Against Pro. Invoice
  // No. :") has to sit on one line at 8pt.
  partyBlock: {
    firstRow: 6, lastRow: 15,
    customerFirst: 'A', customerLast: 'F',
    labelFirst: 'G', labelLast: 'I',
    valueFirst: 'J',
  },

  shipmentNoteRow: 16,
  itemHeaderRow: 17,
  itemsFirstRow: 18,
  itemsLastRow: 47,                            // 30 item rows, same as the PI
  totalRow: 48,
  totalLabelFirst: 'A', totalLabelLast: 'G',   // merged "TOTAL" cell

  notesHeadingRow: 49,
  notesFirstRow: 50,
  notesLastRow: 54,                            // 5 slots

  // Three sign-offs across the page, each a tall merged box so the pen space
  // is inside the border rather than a run of loose rows beneath it.
  signatureRow: 56,
  signatureLastRow: 60,
  signatureCols: [
    { first: 'A', last: 'D', caption: 'Prepared By' },
    { first: 'E', last: 'H', caption: 'Checked By' },
    { first: 'I', last: 'M', caption: 'Approved By' },
  ],
  signatoryRow: 61,
  lastRow: 61,

  // Item rows carry a product photo, so they need real height — but only when
  // there is actually an image to show, same as the PI.
  itemRowHeight: 17,
  itemRowHeightWithPhoto: 46,
};

// One per party-block row, in order.
const PARTY_LABELS = [
  'Order No. :',
  'Order Date :',
  'Against Pro. Invoice No. :',
  'P.I. Date :',
  'Advance Received On :',
  'Terms of Payment :',
  'Port of Loading :',
  'Port of Discharge :',
  'Place of Delivery :',
  'Delivery / Dispatch Date :',
];

const CELLS = {
  // Customer block (each merged A:F)
  customerHeading: 'A6',
  buyerName: 'A7',
  buyerTrn: 'A8',
  buyerAddress1: 'A9',
  buyerAddress2: 'A10',
  buyerContact: 'A11',
  buyerEmail: 'A12',
  // Order block values (each merged J:L), labels sit in G:I
  orderNo: 'J6',
  orderDate: 'J7',
  piNo: 'J8',
  piDate: 'J9',
  advanceReceivedOn: 'J10',
  paymentTerms: 'J11',
  portOfLoading: 'J12',
  portOfDischarge: 'J13',
  placeOfDelivery: 'J14',
  deliveryDate: 'J15',
  // Full-width lines
  shipmentNote: 'A16',
  notesHeading: 'A49',
};

// Item table. No formula column here — the PI's Amount column was the only
// one, and it has no counterpart on an order sheet — so a fill can clear the
// whole item grid in one range.
const ITEMS = {
  srNoCol: 'A',
  photoCol: 'B',
  qtyCol: 'H',
  remarksCol: 'M',
  clearRanges: [['A', 'M']],
  // Nothing is hidden on this document. Total Weight in particular is exactly
  // what the factory and the loading team are reading it for.
  printHiddenCols: [],
  fields: {
    modelNo: 'C',
    itemName: 'D',
    size: 'E',
    swg: 'F',
    packing: 'G',
    qty: 'H',
    boxes: 'I',
    cbm: 'J',
    weight: 'K',
    // Per-piece weight — not on the PI. Defaults to Total Weight ÷ Qty on the
    // create form, editable there like the other quantity columns.
    weightPerPc: 'L',
  },
  headers: [
    'Sr No', 'Photo', 'Model No.', 'Item Name', 'Size', 'SWG', 'Per Box Dozen Packing',
    'Total Qty (Pcs / Set)', 'Total Box', 'Total CBM', 'Total Weight (Kgs)', 'Weight Per Pc (Kgs)', 'Remarks',
  ],
  // px widths, A..M — sums to 1065px, the same printable width the PI's
  // fourteen columns were fitted to, so both documents export at one scale.
  // Item Name and Remarks gave up the width the Weight Per Pc column takes.
  colWidths: [34, 72, 96, 172, 48, 44, 76, 92, 64, 66, 78, 64, 159],
};

// Boilerplate the sheet is painted with. The first three carry over from the
// PI's T&C because they bind production the same way; the remaining slots are
// left blank for the per-order note (shipping marks, carton stencil, anything
// the buyer asked for on the call).
const DEFAULTS = {
  shipmentNote: PI.DEFAULTS.shipmentNote,
  notesHeading: 'Special Instructions / Packing & Marking :',
  notes: [
    '1) PACKING IN PACKAGES, AS PER STANDARD EXPORT PACKING.',
    '2) WEIGHT & CBM VARIATION +/- 5% WILL BE ALLOWED.',
    '3) SHIPPING MARKS TO BE CONFIRMED BEFORE DISPATCH.',
  ],
};

// "Order to dispatch" — the second flow in the same Export Marketing FMS
// workbook the PI opens a row in. Where PI_FMT.FMS_TRACKER covers lead → PI →
// advance, this one picks the order up from there and runs it to the shipment
// being paid for. Raising an Order Sheet is what opens its row.
//
// Its header sits on row 6 under the same five rows of WHO/HOW/WHEN process
// notes, so rows are placed by finding the first free one rather than by
// values.append.
const FMS_TRACKER = {
  spreadsheetId: PI.FMS_TRACKER.spreadsheetId,
  tab: 'Order to dispatch',
  headerRow: 6,
  firstDataRow: 7,
  // Two blocks, not one contiguous range. A..F is what raising the order
  // knows; L and M are the two documents. Everything between them belongs to
  // the dispatch team or to the sheet itself — G ("TODAY'S DATE") and H
  // ("Overdue days") are its own working columns, and I..K are filled in as
  // the shipment actually moves. Writing across them would wipe that.
  cols: {
    timestamp: 'A', party: 'B', location: 'C', orderNo: 'D',
    advanceDate: 'E', dueDate: 'F', orderPdf: 'L', piPdf: 'M',
  },
};

// Column layout of the "ERP Order sheet Log" tab — the database for every
// order sheet raised, mirroring "ERP PI Log". Defined here so the tab and the
// code that will fill it are described in one place; nothing writes it yet.
const ORDER_LOG_HEADER = [
  'Order No', 'Order Date', 'PI No', 'Customer', 'Total Qty', 'PDF Link',
  'Created By', 'Created At', 'Form JSON', 'Status',
];

module.exports = { LETTERHEAD, LAYOUT, PARTY_LABELS, CELLS, ITEMS, DEFAULTS, FMS_TRACKER, ORDER_LOG_HEADER };
