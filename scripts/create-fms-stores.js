'use strict';
/**
 * One-time script to create the "FMS (Stores)" flow directly in the database,
 * reading real column headers/doer names live from the Google Sheet.
 * Run on server (needs the SAME DB_* / DATABASE_URL / GOOGLE_* env vars server.js
 * uses, pointing at the real production DB — NOT this local checkout's .env.local
 * unless you've filled in production values there):
 *
 *   node scripts/create-fms-stores.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');

const SPREADSHEET_ID = '1J-JxWsTmWPm8v1QwkkQQCv29Xw6dmxajj1fIVoybfzQ';
const TAB_NAME = 'Monitoring';
const HEADER_ROW = 3;
const FMS_NAME = 'FMS (Stores)';

// Rename these freely — column letters are what actually matter.
const STEPS = [
  { name: 'Factory Approval',              planCol: 'V',  actualCol: 'W',  doerNameCol: 'C'  },
  { name: 'PR Approval',                   planCol: 'AD', actualCol: 'AE', doerNameCol: 'Y'  },
  { name: 'Secondary Approval',            planCol: 'AL', actualCol: 'AM', doerNameCol: 'AG' },
  { name: 'Vendor Comparison',             planCol: 'BA', actualCol: 'BB', doerNameCol: 'AO' },
  { name: 'Vendor Finalization',           planCol: 'BS', actualCol: 'BT', doerNameCol: 'BD' },
  { name: 'PO Creation',                   planCol: 'CC', actualCol: 'CE', doerNameCol: 'BM' },
  { name: 'Advance Payment / Delivery',    planCol: 'CK', actualCol: 'CL', doerNameCol: 'BW' },
  { name: 'GRN / Goods Received',          planCol: 'CU', actualCol: 'CV', doerNameCol: 'CG' },
  { name: 'Supervisor Sign-off',           planCol: 'DM', actualCol: 'DN', doerNameCol: 'CO' },
];

function genId(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function colToIdx(letter) {
  let idx = 0;
  const s = String(letter).trim().toUpperCase();
  for (let i = 0; i < s.length; i++) idx = idx * 26 + (s.charCodeAt(i) - 64);
  return idx - 1;
}

function idxToCol(idx) {
  let n = idx + 1, s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function getSheetsClient() {
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
  const DB_TYPE = (process.env.DB_TYPE || '').toLowerCase();
  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  let pool, dialect;
  if (DB_TYPE === 'mysql' || (!dbUrl && process.env.DB_HOST)) {
    const mysql = require('mysql2/promise');
    pool = await mysql.createPool(dbUrl
      ? { uri: dbUrl }
      : { host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    dialect = 'mysql';
  } else if (dbUrl || process.env.DB_HOST) {
    const { Pool } = require('pg');
    const connStr = dbUrl || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'postgres'}`;
    pool = new Pool({ connectionString: connStr });
    dialect = 'postgres';
  } else {
    throw new Error('No DB_* / DATABASE_URL env vars found — this needs a real database (the JSON-store fallback does not support FMS).');
  }

  const q = async (sql, params) => {
    if (dialect === 'mysql') {
      const [rows] = await pool.execute(sql.replace(/\$(\d+)/g, '?'), params);
      return rows;
    }
    const { rows } = await pool.query(sql, params);
    return rows;
  };

  console.log(`Connected to ${dialect} DB.`);
  const sheets = await getSheetsClient();
  console.log('Google Sheets client ready.');

  const users = await q('SELECT id, name FROM users');
  const byNameLower = {};
  users.forEach(u => { byNameLower[(u.name || '').trim().toLowerCase()] = u; });

  const fmsId = genId('FMS');
  await q(
    `INSERT INTO fms_sheets (id, fms_name, sheet_name, sheet_id, header_row, created_by, process_coordinator_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [fmsId, FMS_NAME, TAB_NAME, SPREADSHEET_ID, HEADER_ROW, null, null]
  );
  console.log(`\nCreated fms_sheets row: ${fmsId} (${FMS_NAME})`);

  for (let i = 0; i < STEPS.length; i++) {
    const st = STEPS[i];
    const stepId = genId('FST');
    await q(
      `INSERT INTO fms_sheet_steps (id, fms_id, step_order, step_name, plan_col, actual_col, extra_input, extra_col, show_cols, delay_reason_col, doer_name_col)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [stepId, fmsId, i, st.name, st.planCol, st.actualCol, 'no', '', '[]', '', st.doerNameCol]
    );
    console.log(`\nStep ${i + 1}: ${st.name} (${stepId}) — Plan ${st.planCol}, Actual ${st.actualCol}, Doer col ${st.doerNameCol}`);

    // Auto-match doers the same way "Load Doers From Column" does in the UI —
    // scan that step's Name column for unique values and match against users.
    const colLetter = st.doerNameCol;
    const range = `'${TAB_NAME}'!${colLetter}${HEADER_ROW + 1}:${colLetter}${HEADER_ROW + 5000}`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range, valueRenderOption: 'FORMATTED_VALUE' });
    const names = [...new Set((res.data.values || []).map(r => (r[0] || '').trim()).filter(Boolean))];
    const matchedIds = new Set();
    const unmatched = [];
    for (const n of names) {
      const u = byNameLower[n.toLowerCase()];
      if (u) matchedIds.add(u.id); else unmatched.push(n);
    }
    for (const uid of matchedIds) {
      await q('INSERT INTO fms_step_doers (step_id, user_id) VALUES ($1,$2)', [stepId, uid]).catch(() => {});
    }
    const matchedNames = [...matchedIds].map(id => users.find(u => u.id === id)?.name).filter(Boolean);
    console.log(`  matched doers: ${matchedNames.join(', ') || '(none found in that column)'}`);
    if (unmatched.length) console.log(`  unmatched names in sheet: ${unmatched.join(', ')}`);
  }

  await pool.end();
  console.log(`\nDone. FMS id: ${fmsId} — open it in the app to review/rename steps or adjust doers.`);
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
