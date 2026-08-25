'use strict';
/**
 * Single source of truth for the EXPORT Packing List layout.
 *
 * This is NOT modelled on the PI or the Order Sheet. It reproduces the export
 * department's OWN packing list, the one they have been keying by hand — see
 * the LA-07 (Zam Zam), LA-14 (Golden Ship House), LA-16 (Saif Plus) and 2040
 * (Middle East) sheets. Header block, the product-category band, the column
 * set and the totals row are all theirs; what this file adds is that the
 * figures now come from the orders instead of being retyped.
 *
 * Same discipline as pi-format.js and order-sheet-format.js: the builder that
 * paints the tab (scripts/build-packing-list.js) and the code that fills it
 * per shipment (server.js) both read this file.
 *
 * THE DOCUMENT IS CARTON-DRIVEN. That is the thing to understand before
 * changing anything here. The packer counts cartons, and five relations do the
 * rest — every one of them verified against their real sheets:
 *
 *     TOTAL PACKED QTY   = TOTAL CARTON NOS. x SET/PCS. IN PER CARTON
 *     TOTAL NET WT.      = NET WT. PER CARTON x TOTAL CARTON NOS.
 *     TOTAL GR. WT.      = GR. WT. PER CARTON x TOTAL CARTON NOS.
 *     TOTAL CBM          = CBM PER CARTON x TOTAL CARTON NOS.
 *     PER PCS WT.        = NET WT. PER CARTON / SET/PCS. IN PER CARTON
 *
 * CARTON NO. is a range ("01-120", "121-180") that runs unbroken from 1 to the
 * carton total across the whole document, line after line. It is computed from
 * the carton counts rather than typed — on their LA-16 the two disagreed
 * (the column summed to 1509 while the ranges ended at 1493), which is exactly
 * the sort of thing a hand-kept serial drifts into.
 *
 * Two things this app carries that their sheet did not:
 *
 *  1. ONE PACKING LIST, MANY ORDERS. Their LA-16 already does this by hand —
 *     "ORDER NO :- P00595,P00660" in the header and a per-line ORDER NO.
 *     column. Both are kept, and now they are filled from the orders picked.
 *  2. TOTAL ORDER QTY. beside TOTAL PACKED QTY., as their LA-07 has. The gap
 *     between the two is the balance still owed, and the next packing list
 *     against that order picks it up (server.js computes that balance from
 *     every live packing list, so nothing ships twice).
 *
 * Grid is A..S (19 columns), printed LANDSCAPE — it is far too wide for
 * portrait, unlike the PI and the Order Sheet.
 */

const COMPANY = 'LALLUBHAI AMICHAND LTD., VATVA , AHMEDABAD';
const DEPARTMENT = 'EXPORT DEPT.';

const LAYOUT = {
  firstCol: 'A',
  lastCol: 'S',
  colCount: 19,
  rowCount: 70,

  companyRow: 1,
  departmentRow: 2,
  // Three header rows, each split into a left block, a middle slot and a right
  // block — the same three-across arrangement every one of their sheets uses.
  headerFirstRow: 3,
  headerLastRow: 5,
  headerLeftFirst: 'A', headerLeftLast: 'G',
  headerMidFirst: 'H', headerMidLast: 'L',
  headerRightFirst: 'M', headerRightLast: 'S',

  // "ALUMINIUM UTENSILS (QUEEN+AL SAIF BRAND)", "SS UTENSILS" — the band that
  // says what class of goods the container holds.
  categoryRow: 6,

  itemHeaderRow: 7,
  itemsFirstRow: 8,
  // 50 lines. Their biggest by hand (the 2040 Middle East list) ran to 40, and
  // a packing list that carries the tails of several orders needs the headroom.
  itemsLastRow: 57,
  totalRow: 58,
  totalLabelFirst: 'A', totalLabelLast: 'F',   // merged "TOTAL" cell
  lastRow: 58,

  itemRowHeight: 15,
};

// The header block's label/value lines. Each is written as ONE cell — label
// and value together — because that is how their sheet reads, and the value
// is what the app fills in.
const HEADER_LINES = [
  { key: 'orderNos',        row: 3, zone: 'left',  label: 'ORDER NO. :- ' },
  { key: 'containerSize',   row: 3, zone: 'right', label: 'CONTAINER SIZE : ' },
  { key: 'invoiceNo',       row: 4, zone: 'left',  label: 'INVOICE NO. :- ' },
  { key: 'plDate',          row: 4, zone: 'mid',   label: 'DATE :- ' },
  { key: 'totalCartons',    row: 4, zone: 'right', label: 'TOTAL CARTONS :- ' },
  { key: 'partyName',       row: 5, zone: 'left',  label: 'PARTY NAME : ' },
  { key: 'cha',             row: 5, zone: 'right', label: 'CHA - ' },
];

const CELLS = {
  company: 'A1',
  department: 'A2',
  orderNos: 'A3',
  containerSize: 'M3',
  invoiceNo: 'A4',
  plDate: 'H4',
  totalCartons: 'M4',
  partyName: 'A5',
  cha: 'M5',
  productCategory: 'A6',
};

// Item table. Every derived column is written by the server as a plain value
// rather than painted as a per-row formula: TOTAL PACKED QTY. has to stay
// overridable for a part carton, and a formula there could not be written over
// without destroying it. The TOTALS row keeps live SUM formulas, same as the
// Order Sheet's.
const ITEMS = {
  srNoCol: 'A',
  qtyCol: 'K',
  clearRanges: [['A', 'S']],
  fields: {
    description: 'B',      // ← the order line's Item Name
    itemCode: 'C',         // ← the order line's Model No.
    size: 'D',
    sizeMm: 'E',           // ← the order line's SWG, which is the gauge in mm
    barcode: 'F',
    cartonNo: 'G',         // computed range, e.g. "121-180"
    cartons: 'H',
    perCarton: 'I',        // SET/PCS. IN PER CARTON
    orderQty: 'J',
    packedQty: 'K',        // = cartons x perCarton, overridable
    netPerCarton: 'L',
    netTotal: 'M',         // = netPerCarton x cartons
    grossPerCarton: 'N',
    grossTotal: 'O',       // = grossPerCarton x cartons
    cbmPerCarton: 'P',
    cbmTotal: 'Q',         // = cbmPerCarton x cartons
    perPcsWt: 'R',         // = netPerCarton / perCarton
    orderNo: 'S',
  },
  // What the packer actually keys; everything else on the line is either the
  // order's own figure or computed from these.
  entryFields: ['barcode', 'cartons', 'perCarton', 'packedQty', 'netPerCarton', 'grossPerCarton', 'cbmPerCarton'],
  // The columns the TOTAL row sums, in sheet order. The per-carton columns are
  // deliberately left blank on it — averaging them would be meaningless, and
  // their own sheets leave them blank too.
  totalCols: ['H', 'J', 'K', 'M', 'O', 'Q'],
  headers: [
    'S.NO.', 'DESCRIPTION', 'ITEM CODE', 'SIZE', 'SIZE\n (MM)', 'BARCODE',
    'CARTON NO.', 'TOTAL CARTON NOS.', 'SET/PCS. IN PER CARTON',
    'TOTAL ORDER QTY.', 'TOTAL  PACKED QTY.',
    'NET WT. PER CARTON (Kg)', 'TOTAL NET WT. CARTON\n(Kg)',
    'GR. WT. PER CARTON (Kg)', 'TOTAL GR. WT. CARTON (Kg)',
    'CBM PER CARTON', 'TOTAL CBM', 'PER PCS WT. (Kg)', 'ORDER NO.',
  ],
  // px widths, A..S — sums to 1065px, the printable width of an A4 LANDSCAPE
  // page at the 0.3" margins _exportSheetTabPdf() uses.
  colWidths: [28, 135, 60, 48, 48, 76, 54, 48, 48, 50, 50, 50, 58, 50, 58, 48, 48, 50, 58],
  // Number formats, by column. Decimal places follow their sheets exactly —
  // three on the weights, five on CBM per carton, four on total CBM.
  numberFormats: [
    { first: 'H', last: 'K', pattern: '#,##0' },
    { first: 'L', last: 'M', pattern: '#,##0.000' },
    { first: 'N', last: 'O', pattern: '#,##0.000' },
    { first: 'P', last: 'P', pattern: '0.00000' },
    { first: 'Q', last: 'Q', pattern: '#,##0.0000' },
    { first: 'R', last: 'R', pattern: '0.000' },
  ],
};

const DEFAULTS = {
  company: COMPANY,
  department: DEPARTMENT,
  // The two their sheets actually show; the field stays free text for anything
  // else that turns up.
  containerSizeOptions: ['20 FT HC', '40 FT HC'],
  containerSize: '20 FT HC',
  // The band above the table. Free text — these are the three their sheets use.
  productCategoryOptions: [
    'ALUMINIUM UTENSILS (QUEEN BRAND)',
    'ALUMINIUM UTENSILS (QUEEN+AL SAIF BRAND)',
    'SS UTENSILS',
  ],
  productCategory: 'ALUMINIUM UTENSILS (QUEEN BRAND)',
};

// Column layout of the "ERP Packing List Log" tab — the database for every
// packing list raised, mirroring "ERP PI Log" and "ERP Order sheet Log".
// Order Nos and PI Nos are comma-joined because one packing list can answer to
// several of each; the authoritative per-line breakdown is in Form JSON, which
// is also what the balance-still-to-ship is computed from.
const PACKING_LOG_HEADER = [
  'Packing List No', 'Date', 'Invoice No', 'Order Nos', 'PI Nos', 'Customer',
  'Total Packed Qty', 'Total Cartons', 'PDF Link', 'Created By', 'Created At',
  'Form JSON', 'Status',
];
// Status column of that log, for the Cancel-in-place route.
const PACKING_LOG_STATUS_COL = 'M';

// How far along an order sheet is, written back onto the "ERP Order sheet Log"
// Status column as packing lists are raised against it. 'Open' is what raising
// the order sets; the middle two are ours, and Cancelled is the order's own.
const ORDER_STATUS = {
  open: 'Open',
  partly: 'Partly Packed',
  packed: 'Packed',
  cancelled: 'Cancelled',
};
// Status column of the order log — see ORDER_LOG_HEADER in order-sheet-format.js.
const ORDER_LOG_STATUS_COL = 'J';

module.exports = {
  COMPANY, DEPARTMENT, LAYOUT, HEADER_LINES, CELLS, ITEMS, DEFAULTS,
  PACKING_LOG_HEADER, PACKING_LOG_STATUS_COL, ORDER_STATUS, ORDER_LOG_STATUS_COL,
};
