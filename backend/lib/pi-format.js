'use strict';
/**
 * Single source of truth for the EXPORT Proforma Invoice / OCS layout.
 *
 * Both the sheet builder (scripts/rebuild-pi-sheet.js, which paints the
 * template) and server.js (which fills it per PI) read this file, so the cell
 * map can never drift from the sheet that was actually built — the failure
 * mode PO Creation's reverse-engineered map still lives with.
 *
 * Layout follows the company's real PI ("Zam Zam" sample): letterhead,
 * consignee block on the left / shipping block on the right, an export item
 * table priced in C&F US$ with a product photo per line, amount in words,
 * then boilerplate T&C and the two-sided acceptance signature.
 *
 * Grid is A..N (14 columns) — printed LANDSCAPE, unlike PO/PR/GRN.
 */

const LETTERHEAD = {
  // Rendered by an =IMAGE() formula in the merged logo block, so the URL has
  // to be publicly fetchable by Google's servers — not just by a logged-in
  // browser. public/logo.png is served unauthenticated, which is why the app's
  // own origin is used rather than a Drive link.
  //
  // NOTE: Sheets refuses external fetches for =IMAGE() written by a service
  // account until a human has opened the spreadsheet once in a desktop
  // browser ("Please use a desktop web browser to allow access to fetch data
  // from external urls"). That authorisation then covers the whole document,
  // including formulas written later — which is what makes the per-item
  // product photos below workable at all. If the PI ever moves to a new
  // spreadsheet, someone has to open it once.
  logoUrl: 'https://laltdoffice.com/logo.png',
  company: 'LALLUBHAI AMICHAND LIMITED',
  regd: 'Regd. Office : 48/50, Kansara Chawl, Kalbadevi Road, Mumbai - 400 002, India.   Email : queen1911@laltd.co.in',
  admin: 'Admin. Office : 225/27, J. Dadajee Road, Tardeo, Mumbai - 400 007, India.',
  works: 'Works : 175/3, Ghodasar Village, Near GIDC Vatva, Vatva - 382 445, Ahmedabad, Gujarat, India.',
  title: 'PROFORMA INVOICE / ORDER CONFIRMATION SHEET (OCS)',
};

// Every row and column span the template depends on, in one place. Changing
// anything here means re-running scripts/rebuild-pi-sheet.js — the map and the
// painted sheet are only ever in step because they come from this object.
const LAYOUT = {
  firstCol: 'A',
  lastCol: 'N',
  colCount: 14,
  rowCount: 80,

  // Logo occupies A1:B4; the company name and the three addresses sit to its
  // right in C:N, so they are centred against the text block rather than the
  // whole page. The title band on row 5 still spans the full width.
  letterheadRows: { company: 1, regd: 2, admin: 3, works: 4, title: 5 },
  logoCols: { first: 'A', last: 'B' },
  letterheadTextCol: 'C',

  // Consignee panel on the left, shipping label/value pairs on the right.
  partyBlock: {
    firstRow: 6, lastRow: 13,
    consigneeFirst: 'A', consigneeLast: 'F',
    labelFirst: 'G', labelLast: 'H',
    valueFirst: 'I',
  },

  shipmentNoteRow: 14,
  itemHeaderRow: 15,
  itemsFirstRow: 16,
  itemsLastRow: 45,                            // 30 item rows
  totalRow: 46,
  totalLabelFirst: 'A', totalLabelLast: 'G',   // merged "TOTAL" cell
  wordsRow: 47,
  wordsFirst: 'A', wordsLast: 'I',             // amount in words
  totalCapFirst: 'J', totalCapLast: 'L',       // "Total C&F US$" caption
  totalValFirst: 'M',                          // the figure itself

  validityRow: 49,
  bankRow: 50,
  termsHeadingRow: 51,
  termsFirstRow: 52,
  termsLastRow: 61,                            // 10 slots
  confirmRow: 62,
  declarationRow: 63,
  signatureRow: 65,
  signatureRightCol: 'H',
  signatoryRow: 69,
  lastRow: 69,

  // Item rows carry a product photo, so they need real height — but only when
  // there is actually an image to show. server.js sets each used row to one of
  // these; unused rows are hidden outright.
  itemRowHeight: 17,
  itemRowHeightWithPhoto: 46,
};

const PARTY_LABELS = [
  'Pro. Invoice No. :',
  'Date :',
  'Order No. :',
  'Terms of Payment :',
  'Port of Loading :',
  'Port of Discharge :',
  'Place of Delivery :',
  'Country of Origin of Goods :',
];

const CELLS = {
  // Consignee block (each merged A:F)
  consigneeHeading: 'A6',
  buyerName: 'A7',
  buyerTrn: 'A8',
  buyerAddress1: 'A9',
  buyerAddress2: 'A10',
  buyerContact: 'A11',
  // Shipping block values (each merged I:N), labels sit in G:H
  piNo: 'I6',
  date: 'I7',
  orderNo: 'I8',
  paymentTerms: 'I9',
  portOfLoading: 'I10',
  portOfDischarge: 'I11',
  placeOfDelivery: 'I12',
  countryOfOrigin: 'I13',
  // Full-width lines
  shipmentNote: 'A14',
  amountInWords: 'A47',
  validityNote: 'A49',
  bankNote: 'A50',
  confirmLine: 'A62',
  declaration: 'A63',
  acceptedBy: 'H65',
};

// Item table. Column M (Amount) is a live per-row formula painted by the
// builder — it is NEVER written to and NEVER cleared, same discipline as the
// PO template's formula columns. Clearing therefore happens in two ranges
// (A:L and N:N) so M is stepped over.
const ITEMS = {
  srNoCol: 'A',
  photoCol: 'B',
  qtyCol: 'H',
  amountCol: 'M',
  remarksCol: 'N',
  clearRanges: [['A', 'L'], ['N', 'N']],
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
    rate: 'L',
  },
  headers: [
    'Sr No', 'Photo', 'Model No.', 'Item Name', 'Size', 'SWG', 'Per Box Dozen Packing',
    'Total Qty (Pcs / Set)', 'Total Box', 'Total CBM', 'Total Weight (Kgs)',
    'C&F US$ Per Pc', 'Amount (US$)', 'Remarks',
  ],
  // px widths, A..N — sums to 1065px, exactly the printable width of an A4
  // landscape page at the 0.3" margins _exportSheetTabPdf() uses, so the
  // export neither scales the sheet up nor leaves a bare strip down the right.
  // G and H are wider than the item table alone needs because the party
  // block's labels sit in G:H, and the longest of them ("Country of Origin of
  // Goods :") wraps to two lines below ~148px, dragging that row out of line.
  colWidths: [34, 72, 96, 170, 44, 40, 68, 84, 58, 60, 70, 70, 86, 113],
};

const TOTAL_CELL = 'M46';

// The product master the item typeahead and the photos come from — the
// customer's own "PI Export (Final)" workbook, not this app's sheet. Its
// fetch_product tab is already exactly the PI's item columns, image URL
// included, so nothing has to be re-keyed.
const PRODUCT_SOURCE = {
  spreadsheetId: '1V9N17f4S6ZgVZfxaIBsAohcU14rooN6SA1HujPsJYIQ',
  tab: 'fetch_product',
  range: 'A2:I2000',
  // Column offsets within that range.
  cols: { modelNo: 1, itemName: 2, size: 3, swg: 4, perBoxPacking: 5, perBoxCbm: 6, perPcsWeight: 7, imageUrl: 8 },
};

// "Export Marketing FMS" — the follow-up tracker the export team runs the PI
// through (add pricing, send final PDF, chase the signed copy, chase the
// advance, and so on). Creating a PI opens its row here; every column from
// the first process step onward is filled in by that team, not by this app.
//
// Its header sits on row 6, under five rows of WHO/HOW/WHEN process notes, so
// rows are placed by finding the first free row rather than by values.append —
// append's table detection is not reliable under a header block like that.
const FMS_TRACKER = {
  spreadsheetId: '1Uf2CXMaOEWybb3ZQETPVGFSUG3l1vTUgnhvUAJCqkZE',
  tab: 'Sheet1',
  headerRow: 6,
  firstDataRow: 7,
  cols: { timestamp: 'A', piNo: 'B', assignedTo: 'C', customerName: 'D', quantity: 'E', targetDate: 'F' },
  // Row 3 of the tracker names who a PI can be assigned to. Kept here so the
  // create form's dropdown and the sheet stay in step; the field is free text
  // as well, so an unlisted name still goes through.
  assignees: ['Shival', 'Paresh', 'Obaid'],
};

// Boilerplate the form pre-fills and the buyer sees verbatim. Editable per PI
// on the create form — these are only the defaults.
const DEFAULTS = {
  portOfLoading: 'Mundra / India',
  countryOfOrigin: 'INDIA',
  validity: '03 WORKING DAYS',
  shipmentNote: "Total 01 Container (20' FCL Container) Order",
  bankNote: 'WE HAVE SENT THE BANK DETAILS BY MAIL & BY WHATSAPP, SO KINDLY TALLY ALL BANK DETAILS AND THEN MAKE THE PAYMENT.',
  confirmLine: 'PLEASE CONFIRM THIS PROFORMA INVOICE BY RETURN MAIL OR WHATSAPP.',
  declaration: 'IT IS FURTHER DECLARED THAT THE ABOVE GOODS ARE NOT OF ISRAELI ORIGIN / MANUFACTURE NOR DO THEY CONTAIN ANY ISRAELI MATERIAL.',
  terms: [
    '1) WEIGHT & CBM VARIATION +/- 5% WILL BE ALLOWED.',
    '2) PACKING IN PACKAGES.',
    '3) SHIPMENT AS PER THE AGREED DELIVERY SCHEDULE, SUBJECT TO TIMELY RECEIPT OF CONFIRMATION AND ADVANCE PAYMENT.',
    '4) INSURANCE / LEGALISATION / SGS CHARGES WILL BE EXTRA AS ACTUAL.',
    "5) FOREIGN BANK CHARGES WILL BE ON BUYER'S ACCOUNT.",
    '6) THIS PROFORMA INVOICE IS SUBJECT TO OUR FINAL CONFIRMATION.',
    '7) IN CASE OF NATURAL DISASTER & UNCONTROLLABLE CIRCUMSTANCES WE ARE NOT BOUND FOR THE DELIVERY PERIOD.',
    '8) IMPORTANT NOTE : IF WE RECEIVE ANY ADVANCE PAYMENT OR INVOICE PAYMENT OTHER THAN THE NAME MENTIONED IN THIS PROFORMA INVOICE, YOU HAVE TO GIVE US A THIRD PARTY RELATIONSHIP CERTIFICATE FOR THE SAME.',
  ],
};

// The validity line is one sentence with the validity period spliced in, so
// changing "03 WORKING DAYS" on the form rewrites the whole warning.
function validityNote(validity) {
  const v = String(validity || DEFAULTS.validity).trim().toUpperCase();
  return '*** THIS PRICE / P.I. IS VALID FOR ' + v + ' ONLY, AND THIS PRICE IS VALID ONLY FOR THIS ORDER. '
    + 'IF A NEW ORDER IS GIVEN AFTER THIS ORDER, A NEW PRICE WILL BE APPLICABLE '
    + '(INCREASE IN PRICE 5% OR AS PER THE MARKET SITUATION).';
}

module.exports = { LETTERHEAD, LAYOUT, PARTY_LABELS, CELLS, ITEMS, TOTAL_CELL, PRODUCT_SOURCE, FMS_TRACKER, DEFAULTS, validityNote };
