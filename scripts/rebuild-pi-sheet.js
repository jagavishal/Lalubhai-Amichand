'use strict';
/**
 * Forces a repaint of the "Proforma Invoice" template tab into the layout in
 * backend/lib/pi-format.js.
 *
 * Normally NOT needed: server.js repaints the tab itself, before the next PI
 * is filled, whenever the version stamped on the tab differs from
 * PI_FMT.TEMPLATE_VERSION (see backend/lib/pi-template.js). This script is
 * for a deliberate repaint — a tab someone edited by hand, or checking the
 * paint before a deploy — and does exactly what the server would do.
 *
 * It only ever touches the "Proforma Invoice" tab — the "ERP PI Log" tab
 * (which IS the database for every PI ever raised) is never read or written.
 *
 * Needs the same GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY(_B64) env
 * vars server.js uses (read from .env.local).
 *
 *   node scripts/rebuild-pi-sheet.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');
const { paintPiTemplate } = require('../backend/lib/pi-template');

// Must match PI_CREATION_SHEET_ID / PI_TEMPLATE_TAB in server.js.
const SPREADSHEET_ID = '1jWRILcYuJZh6EyxvOYz_Ol0z9X2X79RcDiKFV8x76XA';
const TAB = 'Proforma Invoice';

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

async function run() {
  const sheets = getClients();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,sheetId))' });
  const tab = meta.data.sheets.find(s => s.properties.title === TAB);
  if (!tab) throw new Error(`Tab "${TAB}" not found in spreadsheet ${SPREADSHEET_ID}`);
  const sheetId = tab.properties.sheetId;
  console.log(`Found "${TAB}" (sheetId ${sheetId}). Repainting as export PI / OCS…`);

  await paintPiTemplate(sheets, SPREADSHEET_ID, sheetId, TAB, (m) => console.log(m));

  console.log('\n=== DONE ===');
  console.log('Open it: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit#gid=' + sheetId);
  console.log('\n!! ONE MANUAL STEP (first time only): open that link in a desktop browser,');
  console.log('   signed in as a user with edit access, and wait for the two logos to appear');
  console.log('   in A1 and M1. Sheets refuses to fetch an external URL for =IMAGE() when the');
  console.log('   formula was written by a service account — it answers #REF! with "Please use');
  console.log('   a desktop web browser to allow access to fetch data from external urls." A');
  console.log('   single human visit resolves and caches it for the whole document.');
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
