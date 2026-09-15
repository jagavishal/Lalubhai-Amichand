'use strict';
/**
 * An Order Sheet as a real Excel workbook, built from the order's stored form
 * (the Form JSON on "ERP Order sheet Log") rather than exported from the sheet
 * tab: a Drive export of the workbook would carry every tab, log tabs
 * included, and the template tab only ever holds the most recent order.
 *
 * The factory and the loading team work the order in Excel — re-sorting
 * lines, adding a column for what is packed — which the PDF cannot give them.
 * Same header block and the same line columns as the printed sheet, plus the
 * per-box CBM and per-piece weight the totals were worked from and the
 * buyer's own product code.
 */

const XLSX = require('xlsx');
const PI = require('./pi-format');

// dd.mm.yyyy, the form the printed documents use.
function displayDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(dateStr || '');
}

function n(v) {
  const x = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(x) ? x : '';
}

const LINE_HEADERS = ['Sr No', 'Model No.', 'Client Code', 'Item Name', 'Size', 'SWG', 'Per Box Packing', 'Total Qty (Pcs / Set)', 'Total Box',
  'CBM Per Box', 'Total CBM', 'Weight Per Pc (Kgs)', 'Total Weight (Kgs)', 'Remarks', 'Photo'];

// Returns the .xlsx as a Buffer.
function buildOrderSheetXlsx(orderNo, form) {
  const LH = PI.LETTERHEAD;
  const items = Array.isArray(form.items) ? form.items : [];
  const head = [
    [LH.company],
    [LH.regd],
    [LH.admin],
    [LH.works],
    [],
    ['ORDER SHEET'],
    [],
    ['Order No.', orderNo, '', 'Against Pro. Invoice No.', form.piNo || ''],
    ['Order Date', displayDate(form.orderDate), '', 'P.I. Date', displayDate(form.piDate)],
    ['Advance Received On', displayDate(form.advanceReceivedOn), '', 'Delivery / Dispatch Date', displayDate(form.deliveryDate)],
    ['Consignee', form.buyerName || '', '', 'Terms of Payment', form.paymentTerms || ''],
    ['TRN / Tax Reg. No.', form.buyerTrn || '', '', 'Port of Loading', form.portOfLoading || ''],
    ['Address', [form.buyerAddress1, form.buyerAddress2].filter(Boolean).join(', '), '', 'Port of Discharge', form.portOfDischarge || ''],
    ['Contact', [form.buyerContact, form.buyerEmail].filter(Boolean).join(' | '), '', 'Place of Delivery', form.placeOfDelivery || ''],
    ['Shipment', form.shipmentNote || ''],
    [],
    LINE_HEADERS,
  ];
  const headerRowIdx = head.length - 1;
  const body = items.map((it, i) => {
    const qty = n(it.qty), boxes = n(it.boxes), cbm = n(it.cbm), weight = n(it.weight);
    const cbmPerBox = n(it.cbmPerBox) !== '' ? n(it.cbmPerBox) : (boxes > 0 && cbm !== '' ? Math.round((cbm / boxes) * 100000) / 100000 : '');
    const weightPerPc = n(it.weightPerPc) !== '' ? n(it.weightPerPc) : (qty > 0 && weight !== '' ? Math.round((weight / qty) * 1000) / 1000 : '');
    return [i + 1, it.modelNo || '', it.clientCode || '', it.itemName || '', it.size || '', it.swg || '', n(it.packing),
      qty, boxes, cbmPerBox, cbm, weightPerPc, weight, it.remarks || '', it.imageUrl || ''];
  });
  const sum = (idx) => body.reduce((s, r) => s + (typeof r[idx] === 'number' ? r[idx] : 0), 0);
  const totals = ['', '', '', 'TOTAL', '', '', '', sum(7), sum(8), '', Math.round(sum(10) * 10000) / 10000, '', Math.round(sum(12) * 100) / 100, '', ''];
  const notes = (Array.isArray(form.notes) ? form.notes : []).filter(Boolean);
  const tail = [[], ['Special Instructions / Packing & Marking :'], ...notes.map(t => [t]), [], ['Prepared By', '', '', 'Checked By', '', '', 'Approved By']];

  const aoa = head.concat(body, [totals], tail);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [6, 16, 14, 34, 12, 8, 12, 14, 10, 11, 11, 13, 14, 24, 40].map(w => ({ wch: w }));
  const fullWidth = (r) => ({ s: { r, c: 0 }, e: { r, c: LINE_HEADERS.length - 1 } });
  ws['!merges'] = [fullWidth(0), fullWidth(1), fullWidth(2), fullWidth(3), fullWidth(5), { s: { r: 14, c: 1 }, e: { r: 14, c: LINE_HEADERS.length - 1 } }];
  // Number formats on the figure columns, so Excel shows 0.0419 not 4.19E-2.
  const fmtCol = (c, z) => {
    for (let r = headerRowIdx + 1; r <= headerRowIdx + body.length + 1; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number') cell.z = z;
    }
  };
  fmtCol(7, '#,##0'); fmtCol(8, '#,##0'); fmtCol(9, '0.0000'); fmtCol(10, '0.0000'); fmtCol(11, '0.000'); fmtCol(12, '#,##0.00');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Order Sheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// "VTV/ORD/001/26-27" has slashes in it — a filename must not.
function orderSheetXlsxName(orderNo) {
  return `${String(orderNo).replace(/\//g, '-')} - Order Sheet.xlsx`;
}

module.exports = { buildOrderSheetXlsx, orderSheetXlsxName, LINE_HEADERS };
