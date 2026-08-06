'use strict';
/**
 * One-time script to create the live "Proforma Invoice" spreadsheet (a brand
 * new sheet, dedicated to the PI feature) plus its Drive PDF folder, both
 * inside the same Shared Drive the PO/PR/GRN PDFs already live in
 * (service accounts have zero personal storage quota — file creation only
 * works inside a Shared Drive; see server.js's PO_PDF_DRIVE_FOLDER_ID
 * comment for the full explanation).
 *
 * Needs the SAME GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY(_B64) env
 * vars server.js uses. Safe to run against this checkout's .env.local since
 * Sheets/Drive creds are shared between local + production here (unlike the
 * DB, which is prod-only) — see [[project_local_dev_no_db]].
 *
 *   node scripts/create-pi-sheet.js
 *
 * Prints the new spreadsheet ID + Drive folder ID to hardcode into server.js
 * as PI_CREATION_SHEET_ID / PI_PDF_DRIVE_FOLDER_ID, plus a URL to open and
 * eyeball the template before wiring it up.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');

const SHARED_DRIVE_ID = '0AO3U0bKj4seJUk9PVA'; // "PR/PO/GRN ERP pdfs" Shared Drive
const SHARE_WITH_EMAIL = 'akhileshvyas@e-marketingtech.in'; // gets Editor access, not "anyone"

async function getClients() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const b64 = process.env.GOOGLE_PRIVATE_KEY_B64?.trim();
  const key = b64 ? Buffer.from(b64, 'base64').toString('utf8') : process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), drive: google.drive({ version: 'v3', auth }) };
}

function colToIdx(letter) {
  let idx = 0;
  for (let i = 0; i < letter.length; i++) idx = idx * 26 + (letter.charCodeAt(i) - 64);
  return idx - 1;
}

async function run() {
  const { sheets, drive } = await getClients();
  console.log('Google clients ready.');

  // 1) Drive folder for PI PDFs, inside the Shared Drive.
  const folder = await drive.files.create({
    requestBody: { name: 'Proforma Invoice PDFs', mimeType: 'application/vnd.google-apps.folder', parents: [SHARED_DRIVE_ID] },
    fields: 'id',
    supportsAllDrives: true,
  });
  const piPdfFolderId = folder.data.id;
  console.log('Created Drive folder for PI PDFs:', piPdfFolderId);

  // 2) The spreadsheet itself, also inside the Shared Drive (so it's a real
  // file the service account can freely write to, not blocked by the
  // zero-personal-quota limit).
  const file = await drive.files.create({
    requestBody: { name: 'ERP - Proforma Invoice', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [SHARED_DRIVE_ID] },
    fields: 'id',
    supportsAllDrives: true,
  });
  const spreadsheetId = file.data.id;
  console.log('Created spreadsheet:', spreadsheetId);

  // Share edit access with the real human owner of this ERP (not "anyone" —
  // unlike generated PDFs, the raw sheet holds every buyer's data).
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { role: 'writer', type: 'user', emailAddress: SHARE_WITH_EMAIL },
    supportsAllDrives: true,
    sendNotificationEmail: false,
  }).catch(e => console.error('  (share with', SHARE_WITH_EMAIL, 'failed, continuing:', e.message, ')'));

  // 3) Rename the default "Sheet1" tab to "Proforma Invoice" and grab its
  // numeric sheetId (needed later for PDF export's `gid` param).
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const defaultSheetId = meta.data.sheets[0].properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateSheetProperties: { properties: { sheetId: defaultSheetId, title: 'Proforma Invoice', gridProperties: { rowCount: 60, columnCount: 8 } }, fields: 'title,gridProperties.rowCount,gridProperties.columnCount' } },
      ],
    },
  });
  console.log('Renamed default tab to "Proforma Invoice" (sheetId', defaultSheetId, ')');

  // 4) Header labels, item-table header, and the summary block's labels —
  // written as plain values first; formulas + merges + formatting follow.
  const put = (a1, value) => ({ range: `'Proforma Invoice'!${a1}`, values: [[value]] });
  const labelData = [
    put('A1', 'PROFORMA INVOICE'),
    put('A3', 'PI No'), put('D3', 'Date'),
    put('A4', 'Buyer Name'),
    put('A5', 'Buyer Address'),
    put('A6', 'Buyer GSTIN'), put('D6', 'Payment Terms'),
    put('A7', 'Validity'), put('D7', 'PI Made By'),
    put('A9', 'Sr No'), put('B9', 'Item Code'), put('C9', 'Description'), put('D9', 'HSN Code'),
    put('E9', 'Qty'), put('F9', 'UOM'), put('G9', 'Rate (INR)'), put('H9', 'Amount (INR)'),
    put('G41', 'Subtotal'),
    put('G42', 'GST %'),
    put('G43', 'GST Amount'),
    put('G44', 'Freight / Other Charges'),
    put('G45', 'TOTAL'),
    // Formulas — the sheet's own computed values, never overwritten by the app.
    { range: `'Proforma Invoice'!H41`, values: [['=SUM(H10:H39)']] },
    { range: `'Proforma Invoice'!H42`, values: [[0]] },
    { range: `'Proforma Invoice'!H43`, values: [['=H41*H42/100']] },
    { range: `'Proforma Invoice'!H44`, values: [[0]] },
    { range: `'Proforma Invoice'!H45`, values: [['=H41+H43+H44']] },
  ];
  for (let r = 10; r <= 39; r++) labelData.push({ range: `'Proforma Invoice'!H${r}`, values: [[`=IF(E${r}="","",E${r}*G${r})`]] });
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: labelData } });
  console.log('Wrote header labels, item-table header, summary labels, and per-row Amount/Subtotal/GST/Total formulas.');

  // 5) Merges (value cells that need room for long text) + light formatting
  // (title bold+large, labels bold, item header row bold+shaded).
  const mergeRange = (sheetId, r1, r2, c1, c2) => ({ mergeCells: { range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }, mergeType: 'MERGE_ALL' } });
  const bold = (sheetId, r1, r2, c1, c2, size) => ({ repeatCell: { range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: size || 10 } } }, fields: 'userEnteredFormat.textFormat' } });
  const shade = (sheetId, r1, r2, c1, c2) => ({ repeatCell: { range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.90, green: 0.93, blue: 0.98 } } }, fields: 'userEnteredFormat.backgroundColor' } });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        mergeRange(defaultSheetId, 0, 1, 0, 8),   // A1:H1 title
        mergeRange(defaultSheetId, 2, 3, 1, 3),   // B3:C3 PI No value
        mergeRange(defaultSheetId, 2, 3, 4, 6),   // E3:F3 Date value
        mergeRange(defaultSheetId, 3, 4, 1, 8),   // B4:H4 Buyer Name value
        mergeRange(defaultSheetId, 4, 5, 1, 8),   // B5:H5 Buyer Address value
        mergeRange(defaultSheetId, 5, 6, 1, 3),   // B6:C6 Buyer GSTIN value
        mergeRange(defaultSheetId, 5, 6, 4, 8),   // E6:H6 Payment Terms value
        mergeRange(defaultSheetId, 6, 7, 1, 3),   // B7:C7 Validity value
        mergeRange(defaultSheetId, 6, 7, 4, 8),   // E7:H7 PI Made By value
        bold(defaultSheetId, 0, 1, 0, 8, 16),
        bold(defaultSheetId, 2, 7, 0, 8),
        bold(defaultSheetId, 8, 9, 0, 8),
        shade(defaultSheetId, 8, 9, 0, 8),
        bold(defaultSheetId, 40, 45, 6, 8),
      ],
    },
  });
  console.log('Applied merges + basic formatting.');

  // 6) "ERP PI Log" tab — same idempotent create-if-missing recipe server.js's
  // ensureLogTab() uses, inlined here since this script runs standalone.
  const LOG_HEADER = ['PI No', 'Date', 'Buyer', 'Total Amount (INR)', 'PDF Link', 'Created By', 'Created At', 'Priced By', 'Priced At', 'Form JSON', 'Status'];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'ERP PI Log' } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `'ERP PI Log'!A1`, valueInputOption: 'RAW', requestBody: { values: [LOG_HEADER] } });
  console.log('Created "ERP PI Log" tab with header row.');

  console.log('\n=== DONE ===');
  console.log('PI_CREATION_SHEET_ID =', spreadsheetId);
  console.log('PI_PDF_DRIVE_FOLDER_ID =', piPdfFolderId);
  console.log('Template sheetId (gid) =', defaultSheetId);
  console.log('Open it: https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit');
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
