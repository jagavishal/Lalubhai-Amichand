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
 * table priced in C&F US$, amount in words, then boilerplate T&C and the
 * two-sided acceptance signature.
 *
 * Grid is A..M (13 columns) — printed LANDSCAPE, unlike PO/PR/GRN.
 */

const LETTERHEAD = {
  company: 'LALLUBHAI AMICHAND LIMITED',
  regd: 'Regd. Office : 48/50, Kansara Chawl, Kalbadevi Road, Mumbai - 400 002, India.   Email : queen1911@laltd.co.in',
  admin: 'Admin. Office : 225/27, J. Dadajee Road, Tardeo, Mumbai - 400 007, India.',
  works: 'Works : 175/3, Ghodasar Village, Near GIDC Vatva, Vatva - 382 445, Ahmedabad, Gujarat, India.',
  title: 'PROFORMA INVOICE / ORDER CONFIRMATION SHEET (OCS)',
};

// Every row number the template depends on, in one place. Changing a row here
// means re-running scripts/rebuild-pi-sheet.js — the map and the painted sheet
// are only ever in step because they come from this object.
const LAYOUT = {
  firstCol: 'A',
  lastCol: 'M',
  colCount: 13,
  rowCount: 80,

  letterheadRows: { company: 1, regd: 2, admin: 3, works: 4, title: 5 },
  partyBlock: { firstRow: 6, lastRow: 13 },   // consignee (A:F) | shipping (G:H label, I:M value)
  shipmentNoteRow: 14,
  itemHeaderRow: 15,
  itemsFirstRow: 16,
  itemsLastRow: 45,                            // 30 item rows
  totalRow: 46,
  wordsRow: 47,
  validityRow: 49,
  bankRow: 50,
  termsHeadingRow: 51,
  termsFirstRow: 52,
  termsLastRow: 61,                            // 10 slots
  confirmRow: 62,
  declarationRow: 63,
  signatureRow: 65,
  signatoryRow: 69,
  lastRow: 69,
};

// Left column of the party block = consignee; right column = shipping terms.
// Labels are painted once by the builder; only the value cells are written
// per PI.
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
  // Shipping block values (each merged I:M), labels sit in G:H
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

// Item table. Column L (Amount) is a live per-row formula painted by the
// builder — it is NEVER written to and NEVER cleared, same discipline as the
// PO template's formula columns. Clearing therefore happens in two ranges
// (A:K and M:M) so L is stepped over.
const ITEMS = {
  srNoCol: 'A',
  amountCol: 'L',
  remarksCol: 'M',
  clearRanges: [['A', 'K'], ['M', 'M']],
  fields: {
    modelNo: 'B',
    itemName: 'C',
    size: 'D',
    swg: 'E',
    packing: 'F',
    qty: 'G',
    boxes: 'H',
    cbm: 'I',
    weight: 'J',
    rate: 'K',
  },
  headers: [
    'Sr No', 'Model No.', 'Item Name', 'Size', 'SWG', 'Per Box Dozen Packing',
    'Total Qty (Pcs / Set)', 'Total Box', 'Total CBM', 'Total Weight (Kgs)',
    'C&F US$ Per Pc', 'Amount (US$)', 'Remarks',
  ],
  // px widths, A..M — sums to ~980px, which is what an A4 landscape page fits
  // at the 0.3" margins _exportSheetTabPdf() uses.
  colWidths: [38, 92, 168, 48, 44, 72, 78, 58, 62, 74, 74, 88, 96],
};

const TOTAL_CELL = 'L46';

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

module.exports = { LETTERHEAD, LAYOUT, PARTY_LABELS, CELLS, ITEMS, TOTAL_CELL, DEFAULTS, validityNote };
