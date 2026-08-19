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

  // Logo occupies A1:C4; the company name and the three addresses sit to its
  // right in D:N, so they are centred against the text block rather than the
  // whole page. The title band on row 5 still spans the full width.
  letterheadRows: { company: 1, regd: 2, admin: 3, works: 4, title: 5 },
  logoCols: { first: 'A', last: 'C' },
  letterheadTextCol: 'D',

  // Consignee panel on the left, shipping label/value pairs on the right.
  // The labels span three columns because the longest of them ("Country of
  // Origin of Goods :") has to sit on one line at 8pt.
  partyBlock: {
    firstRow: 6, lastRow: 13,
    consigneeFirst: 'A', consigneeLast: 'G',
    labelFirst: 'H', labelLast: 'J',
    valueFirst: 'K',
  },

  shipmentNoteRow: 14,
  itemHeaderRow: 15,
  itemsFirstRow: 16,
  itemsLastRow: 45,                            // 30 item rows
  totalRow: 46,
  totalLabelFirst: 'A', totalLabelLast: 'G',   // merged "TOTAL" cell
  wordsRow: 47,
  wordsFirst: 'A', wordsLast: 'I',             // amount in words
  totalCapFirst: 'J', totalCapLast: 'L',       // total caption — see priceLabels()
  totalValFirst: 'M',                          // the figure itself

  validityRow: 49,
  bankRow: 50,
  termsHeadingRow: 51,
  termsFirstRow: 52,
  termsLastRow: 61,                            // 10 slots
  confirmRow: 62,
  declarationRow: 63,
  // "For, <company>" on the left and "I Accept & By, ..." on the right, each
  // merged down to signatureLastRow so the pen space is inside the box rather
  // than a run of loose rows under it.
  signatureRow: 64,
  signatureLastRow: 68,
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
  // Consignee block (each merged A:G)
  consigneeHeading: 'A6',
  buyerName: 'A7',
  buyerTrn: 'A8',
  buyerAddress1: 'A9',
  buyerAddress2: 'A10',
  buyerContact: 'A11',
  // Shipping block values (each merged K:N), labels sit in H:J
  piNo: 'K6',
  date: 'K7',
  orderNo: 'K8',
  paymentTerms: 'K9',
  portOfLoading: 'K10',
  portOfDischarge: 'K11',
  placeOfDelivery: 'K12',
  countryOfOrigin: 'K13',
  // Full-width lines
  shipmentNote: 'A14',
  amountInWords: 'A47',
  validityNote: 'A49',
  bankNote: 'A50',
  confirmLine: 'A62',
  declaration: 'A63',
  acceptedBy: 'H64',
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
  // Columns the export team works with but the buyer's copy does not show.
  // Total Weight is a loading/costing figure, not something the PI states, so
  // it is still written and still visible on the create form and the Add Price
  // screen — it is only hidden on the sheet, which drops it from the PDF the
  // same way the unused item rows are dropped.
  printHiddenCols: ['K'],   // fields.weight — Total Weight (Kgs)
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
    // The last two money headers are rewritten per PI from its price type
    // and currency (see priceLabels); these are what the template is painted
    // with and what an unpriced PI shows.
    'CNF US$ Per Pc', 'Amount (US$)', 'Remarks',
  ],
  // px widths, A..N — sums to 1065px. That is the printable width of an A4
  // LANDSCAPE page at the 0.3" margins _exportSheetTabPdf() uses; the PDF now
  // prints portrait, whose printable width is ~735px, so the export's scale=4
  // shrinks the sheet to about 68% to fit. Widening a column therefore costs
  // every column a little sharpness, rather than running off the page.
  // G and H are wider than the item table alone needs because the party
  // block's labels sit in H:J, and the longest of them ("Country of Origin of
  // Goods :") wraps to two lines below ~148px, dragging that row out of line.
  colWidths: [34, 72, 96, 170, 44, 40, 68, 84, 58, 60, 70, 70, 86, 113],
};

const TOTAL_CELL = 'M46';

// ── Price basis and currency ────────────────────────────────────────────────
// Both are chosen on the Add Price screen, not at create time — until a rate
// exists there is nothing to label. Everything the printed PI says about money
// is built from these two: the two item-table headers, the total caption and
// the amount in words. The template is painted with the defaults; each fill
// overwrites those three cells, so a PI quoted FOB in EUR prints that way
// without the template being touched.
const PRICE_TYPES = ['CNF', 'CIF', 'FOB', 'Ex Fact'];

const CURRENCIES = {
  INR: { label: 'INR', words: 'RUPEES',         subunit: 'PAISE' },
  USD: { label: 'US$', words: 'US DOLLARS',     subunit: 'CENTS' },
  GBP: { label: 'GBP', words: 'POUNDS',         subunit: 'PENCE' },
  SAR: { label: 'SAR', words: 'SAUDI RIYALS',   subunit: 'HALALAS' },
  // The dinar is actually divided into 1000 fils, not 100. The amount in words
  // reads the two decimal places the sheet holds, so a KWD PI says the fils in
  // hundredths — right to two places, and the figure itself is unaffected.
  KWD: { label: 'KWD', words: 'KUWAITI DINARS', subunit: 'FILS' },
  EUR: { label: 'EUR', words: 'EUROS',          subunit: 'CENTS' },
};

// What a PI is quoted in until someone says otherwise — matches what every PI
// printed before the two were selectable ("C&F US$", spelled CNF here).
const PRICE_DEFAULT = { priceType: 'CNF', currency: 'USD' };

// The four money labels for one PI, from its stored priceType/currency. Falls
// back to the default for a PI raised before these existed, so an old draft
// re-prints exactly as it always did.
function priceLabels(priceType, currency) {
  const c = CURRENCIES[String(currency || '').toUpperCase()] || CURRENCIES[PRICE_DEFAULT.currency];
  const type = String(priceType || '').trim() || PRICE_DEFAULT.priceType;
  return {
    type,
    rateHeader: `${type} ${c.label} Per Pc`,
    amountHeader: `Amount (${c.label})`,
    totalCaption: `Total ${type} ${c.label}`,
    words: c.words,
    subunit: c.subunit,
  };
}

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

// The consignee master, from the fetch_consignee tab of that same workbook —
// the export team's own buyer list, which the app has no equivalent of (there
// is a Vendor Master, but no Buyer/Customer one).
//
// The tab holds TWO blocks side by side, and neither is complete on its own:
//   A:F  the team's own list — typed names, ports and place of delivery, with
//        Address a VLOOKUP into the block on the right. No phone/email at all,
//        and the Terms of Payment column is empty top to bottom. THE ONLY
//        WRITABLE BLOCK: the Consignee Master page appends here.
//   J:P  not data — one IMPORTRANGE in J1 pulling "Final Consignee" out of a
//        different workbook (1iLgWmb87HO-Y9QHOcayJ83rvaHM944k4X4M-8fFTds0,
//        which this service account cannot open). It is the only place Contact
//        No. and Email ID live, and it still lists a few buyers the left block
//        has dropped.
// So both are read and merged by name: A:F wins on ports/address where it has
// them, J:P supplies contact/email and any name missing on the left.
const CONSIGNEE_SOURCE = {
  spreadsheetId: '1V9N17f4S6ZgVZfxaIBsAohcU14rooN6SA1HujPsJYIQ',
  tab: 'fetch_consignee',
  range: 'A2:P500',
  // Column offsets within that range.
  left:  { name: 0, paymentTerms: 1, placeOfDelivery: 2, portOfLoading: 3, portOfDischarge: 4, address: 5 },
  right: { name: 9, address: 10, contact: 11, placeOfDelivery: 12, portOfLoading: 13, portOfDischarge: 14, email: 15 },
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
  // Every PI opens its tracker row against the same person, so the create form
  // does not ask — it used to, and the answer was always this. Row 3 of the
  // tracker still lists the others (Paresh, Obaid); re-assigning a PI to one
  // of them is done in the tracker itself, which is where that call is made.
  defaultAssignee: 'Shival',
  // The one tracker step this app completes on the doer's behalf. Clicking
  // Done on it does not open the generic Mark-as-Done modal: it opens the PI's
  // own Add Price screen, and saving the price is what fills the step's Actual
  // cell (see completePiPricingStep() in backend/lib/fmsSheet.js). Matched
  // case-insensitively against the step name configured in FMS, so renaming it
  // to "Add Pricing (US$)" or "Price Update" keeps working. Deliberately not a
  // bare /pric/ — a tracker step like "Price Confirmation from Buyer" is
  // ordinary follow-up work and must keep its normal Mark-as-Done modal.
  pricingStepRe: /^\s*(add\s*pric|pric(e|ing)\s*update)/i,
  // Which of the flow's columns holds the PI number. `cols.piNo` above is only
  // the column THIS app writes when it opens the row; the step is matched by
  // header instead, so a tracker kept in a different (or copied) spreadsheet,
  // or with its columns rearranged, still resolves — the spreadsheet id is not
  // part of the test.
  piNoHeaderRe: /^\s*(p\.?\s*i\.?|(pro\.?\s*(forma)?\s*)?invoice)\s*(no\.?|number|#)?\s*$/i,
};

// Boilerplate the form pre-fills and the buyer sees verbatim. Editable per PI
// on the create form — these are only the defaults.
const DEFAULTS = {
  // The buyer's own list, given verbatim. The create form offers these as a
  // dropdown; "Other…" is still there for a one-off, but a PI should almost
  // always print one of these four word for word.
  paymentTermsOptions: [
    '10% ADVANCE AND BALANCE AGAINST COPY OF BL',
    '30% ADVANCE AND BALANCE AGAINST COPY OF BL',
    '50% ADVANCE AND BALANCE AGAINST COPY OF BL',
    '50% AGAINST COPY OF BL AND BALANCE IN 15 DAYS OF DELIVERY AT PORT.',
  ],
  // The three ports the company actually ships out of. Replaces the free-text
  // field (and the list scraped off the consignee master, which carried
  // NHAVASHEVA, NSICT, JNPT and GTI as four spellings of two places).
  portOfLoadingOptions: ['Mundra Port', 'Kandla Port', 'Nhava Sheva Port'],
  portOfLoading: 'Mundra Port',
  countryOfOrigin: 'INDIA',
  validity: '03 WORKING DAYS',
  shipmentNote: "Total 01 Container (20' FCL Container) Order",
  bankNote: 'WE HAVE SENT THE BANK DETAILS BY MAIL & BY WHATSAPP, SO KINDLY TALLY ALL BANK DETAILS AND THEN MAKE THE PAYMENT.',
  confirmLine: 'PLEASE CONFIRM THIS PROFORMA INVOICE BY RETURN MAIL OR WHATSAPP.',
  declaration: 'IT IS FURTHER DECLARED THAT THE ABOVE GOODS ARE NOT OF ISRAELI ORIGIN / MANUFACTURE NOR DO THEY CONTAIN ANY ISRAELI MATERIAL.',
  terms: [
    '1) WEIGHT & CBM VARIATION +/- 5% WILL BE ALLOWED.',
    '2) PACKING IN PACKAGES.',
    // The blank is filled per PI from the create form's "Shipment in (days)"
    // box — see SHIPMENT_DAYS_RE below, which is what finds it. A PI must
    // never print with the blank still in it.
    '3) SHIPMENT TO BE DISPATCHED ____ DAYS FROM RECEIPT OF CONFIRMATION AND ADVANCE PAYMENT.',
    '4) INSURANCE / LEGALISATION / SGS CHARGES WILL BE EXTRA AS ACTUAL.',
    "5) FOREIGN BANK CHARGES WILL BE ON BUYER'S ACCOUNT.",
    '6) THIS PROFORMA INVOICE IS SUBJECT TO OUR FINAL CONFIRMATION.',
    '7) IN CASE OF NATURAL DISASTER & UNCONTROLLABLE CIRCUMSTANCES WE ARE NOT BOUND FOR THE DELIVERY PERIOD.',
    '8) IMPORTANT NOTE : IF WE RECEIVE ANY ADVANCE PAYMENT OR INVOICE PAYMENT OTHER THAN THE NAME MENTIONED IN THIS PROFORMA INVOICE, YOU HAVE TO GIVE US A THIRD PARTY RELATIONSHIP CERTIFICATE FOR THE SAME.',
  ],
};

// Finds the dispatch-days slot in term 3 — matching the blank AND whatever was
// last put in it, so the form can rewrite the number as often as the user
// changes their mind. Group 1 is the bit that gets replaced.
const SHIPMENT_DAYS_RE = /(?:^|\b)(?:SHIPMENT TO BE DISPATCHED)\s+(\S+)\s+DAYS\b/i;

// The validity line is one sentence with the validity period spliced in, so
// changing "03 WORKING DAYS" on the form rewrites the whole warning.
function validityNote(validity) {
  const v = String(validity || DEFAULTS.validity).trim().toUpperCase();
  return '*** THIS PRICE / P.I. IS VALID FOR ' + v + ' ONLY, AND THIS PRICE IS VALID ONLY FOR THIS ORDER. '
    + 'IF A NEW ORDER IS GIVEN AFTER THIS ORDER, A NEW PRICE WILL BE APPLICABLE '
    + '(INCREASE IN PRICE 5% OR AS PER THE MARKET SITUATION).';
}

module.exports = { LETTERHEAD, LAYOUT, PARTY_LABELS, CELLS, ITEMS, TOTAL_CELL, PRODUCT_SOURCE, CONSIGNEE_SOURCE, FMS_TRACKER, DEFAULTS, SHIPMENT_DAYS_RE, PRICE_TYPES, CURRENCIES, PRICE_DEFAULT, priceLabels, validityNote };
